const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

// MP3がこのステータスで拒否されたらMP4フォールバックに切り替える
const MP3_FALLBACK_STATUSES = [401, 403, 404];

// 環境変数 TWOBRAIN_BASE でオーバーライド可能（デフォルトは固定パス）
const TWOBRAIN_BASE = process.env.TWOBRAIN_BASE
  || '/Users/watanabehidetaka/Claudecode/260307_2nd-Brain/03_知識ベース/音楽';

// アーティスト名と保存先ディレクトリのマッピング
const ARTIST_DIRS = {
  darari_nu: path.join(TWOBRAIN_BASE, 'dara', 'songs'),
  coban3137: path.join(TWOBRAIN_BASE, 'coban', 'songs'),
};

/**
 * ファイル名に使用できない文字をサニタイズする
 */
function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

/**
 * ISO日付文字列を YYYY-MM-DD 形式にフォーマットする
 */
function formatDate(iso) {
  if (!iso) return '不明';
  return iso.split('T')[0];
}

/**
 * 再生時間を分:秒形式にフォーマットする
 */
function formatDuration(sec) {
  if (!sec) return '不明';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')} (${sec}秒)`;
}

/**
 * 曲の詳細データから 2nd Brain 向けの Markdown 文字列を生成する
 */
function generateMd(data) {
  const m = data.metadata || {};
  const title = data.title || 'Untitled';
  const tags = m.tags || '（なし）';
  const negativeTags = m.negative_tags || '（なし）';
  const prompt = m.prompt || '（なし）';
  const displayTags = data.display_tags || '（なし）';
  const caption = data.caption || '—';
  const task = m.task || '不明';
  const sliders = m.control_sliders || null;

  let paramSection;
  if (sliders && Object.keys(sliders).length > 0) {
    paramSection = `| パラメータ | 値 |
|-----------|-----|
| audio_weight | ${sliders.audio_weight ?? '—'} |
| style_weight | ${sliders.style_weight ?? '—'} |
| weirdness_constraint | ${sliders.weirdness_constraint ?? '—'} |`;
  } else {
    paramSection = '生成パラメータ情報なし';
  }

  return `# ${title}

## 基本情報

| 項目 | 値 |
|------|-----|
| アーティスト | ${data.display_name} (${data.handle}) |
| ペルソナ | ${data.persona ? data.persona.name : '—'} |
| モデル | ${data.major_model_version} (${data.model_name}) |
| タスク | ${task} |
| 尺 | ${formatDuration(m.duration)} |
| 公開日 | ${formatDate(data.created_at)} |
| キャプション | ${caption} |

## 実績

| 指標 | 数値 |
|------|------|
| 再生数 | ${(data.play_count || 0).toLocaleString()} |
| いいね | ${(data.upvote_count || 0).toLocaleString()} |
| コメント | ${(data.comment_count || 0)} |

## 歌詞

\`\`\`
${prompt}
\`\`\`

## スタイルプロンプト

\`\`\`
${tags}
\`\`\`

**表示タグ**: ${displayTags}

## 除外プロンプト

\`\`\`
${negativeTags}
\`\`\`

## 生成パラメータ

${paramSection}

## リンク

- [SUNO](https://suno.com/song/${data.id})
- [MP3](https://cdn1.suno.ai/${data.id}.mp3)
- [MP4](https://cdn1.suno.ai/${data.id}.mp4)
`;
}

/**
 * URLを指定パスにストリーミングダウンロードする（リダイレクト追従つき）。
 * 200以外は statusCode を持たせた Error で reject する。失敗時は途中ファイルを掃除する。
 */
function streamDownload(url, destPath) {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + '.tmp';
    const file = fs.createWriteStream(tmpPath);
    // res を渡した場合は resume() で本文を捨てる。読み捨てないとソケットが解放されず、
    // 403フォールバック後にプロセスが終了しなくなる。
    const cleanup = (res) => {
      if (res) res.resume();
      file.close();
      fs.unlink(tmpPath, () => {});
    };
    const req = https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        cleanup(res);
        return streamDownload(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        cleanup(res);
        const err = new Error(`download failed: HTTP ${res.statusCode} (${url})`);
        err.statusCode = res.statusCode;
        return reject(err);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close((err) => {
          if (err) return reject(err);
          fs.rename(tmpPath, destPath, (e) => e ? reject(e) : resolve());
        });
      });
    });
    req.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * MP4から音声トラックだけをMP3として抜き出す（ffmpegが必要）。
 */
function extractAudioFromMp4(mp4Path, destPath) {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + '.tmp';
    // 出力先が .tmp 拡張子なので -f mp3 で明示（拡張子からフォーマットを推定できない）
    execFile('ffmpeg', [
      '-v', 'error', '-y', '-i', mp4Path, '-vn',
      '-acodec', 'libmp3lame', '-q:a', '2', '-f', 'mp3', tmpPath,
    ], (err) => {
      if (err) {
        fs.unlink(tmpPath, () => {});
        return reject(err);
      }
      fs.rename(tmpPath, destPath, (e) => e ? reject(e) : resolve());
    });
  });
}

/**
 * MP3を指定パスに保存する。既存ファイルは上書きしない。
 *
 * SUNOは2026-08末に cdn1.suno.ai のMP3直リンクをCloudFrontの署名付きURL必須にした。
 * 未認証だと 403 MissingKey が返り、APIの audio_url も /api/forbidden に差し替えられている。
 * 一方MP4（曲の再生用動画）は素のURLのまま落とせるので、MP3が拒否されたらMP4を取って
 * ffmpegで音声トラックだけ抜き出す。音声は同じマスター由来なので実質劣化しない。
 * 詳細は tama の memory/facts/suno-cdn-signed-url.md を参照。
 */
async function downloadMp3(url, destPath) {
  if (fs.existsSync(destPath)) return { skipped: true };
  try {
    await streamDownload(url, destPath);
    return { skipped: false, viaMp4: false };
  } catch (e) {
    const mp4Url = url.replace(/\.mp3$/, '.mp4');
    if (!MP3_FALLBACK_STATUSES.includes(e.statusCode) || mp4Url === url) throw e;
    const mp4Path = destPath + '.fallback.mp4';
    try {
      await streamDownload(mp4Url, mp4Path);
      await extractAudioFromMp4(mp4Path, destPath);
      return { skipped: false, viaMp4: true };
    } finally {
      if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path);
    }
  }
}

/**
 * Suno APIから特定の曲の詳細データを取得する
 */
async function fetchClipDetail(page, songId) {
  const url = `https://studio-api-prod.suno.com/api/clip/${songId}`;
  return page.evaluate(async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }, url);
}

/**
 * 新曲の詳細（歌詞含む）を集めて返す。ファイルは一切書かない。
 *
 * 毎時の tracker.yml から呼ばれる。以前はここで 2nd Brain のローカル絶対パスに
 * MD/MP3 を書こうとしていたが、CIランナー上にそのパスは存在せず、try/catchで
 * 握り潰されて毎回黙ってスキップされていた（＝死んだコード）。
 * 知識ベースへのMD同期は Dara_Brain 側の sync-music.yml（毎日）が担当する。
 * この関数の唯一の役目は、SRT自動生成をdispatchするための材料集めである。
 *
 * @param {Array<{songId: string, handle: string}>} targetSongs
 * @returns {Promise<{songs: Array<{songId: string, handle: string, songName: string, title: string, lyrics: string, mp3Url: string}>}>}
 */
async function collectSongDetails(targetSongs) {
  if (!targetSongs || targetSongs.length === 0) {
    console.log('[song-detail] 対象の曲はありません。');
    return { songs: [] };
  }

  console.log(`[song-detail] ${targetSongs.length}曲の詳細取得を開始します...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // API叩くための初期遷移
    await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const songs = [];

    for (let i = 0; i < targetSongs.length; i++) {
      const { songId, handle } = targetSongs[i];
      try {
        const detail = await fetchClipDetail(page, songId);
        songs.push({
          songId,
          handle,
          songName: sanitizeFilename(detail.title || 'Untitled'),
          title: detail.title || 'Untitled',
          lyrics: (detail.metadata && detail.metadata.prompt) || '',  // 歌詞は metadata.prompt
          mp3Url: `https://cdn1.suno.ai/${detail.id}.mp3`,
        });
        console.log(`    [${i+1}/${targetSongs.length}] OK: ${detail.title} (${handle})`);
      } catch (e) {
        console.error(`    [${i+1}/${targetSongs.length}] FAIL: songId ${songId} (${handle}) - ${e.message}`);
      }

      if (i < targetSongs.length - 1) {
        await page.waitForTimeout(800);
      }
    }

    console.log(`[song-detail] 詳細取得完了: ${songs.length}/${targetSongs.length}曲`);
    return { songs };
  } finally {
    await browser.close();
  }
}

module.exports = {
  TWOBRAIN_BASE,
  ARTIST_DIRS,
  sanitizeFilename,
  formatDate,
  formatDuration,
  generateMd,
  fetchClipDetail,
  collectSongDetails,
  downloadMp3,
};
