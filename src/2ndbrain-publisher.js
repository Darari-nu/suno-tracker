const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

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
 * MP3を指定パスにストリーミングダウンロードする。
 * 既存ファイルは上書きしない。失敗時は途中ファイルを掃除する。
 */
function downloadMp3(url, destPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      return resolve({ skipped: true });
    }
    const tmpPath = destPath + '.tmp';
    const file = fs.createWriteStream(tmpPath);
    const req = https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlink(tmpPath, () => {});
        return downloadMp3(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(tmpPath, () => {});
        return reject(new Error(`MP3 download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close((err) => {
          if (err) return reject(err);
          fs.rename(tmpPath, destPath, (e) => e ? reject(e) : resolve({ skipped: false }));
        });
      });
    });
    req.on('error', (err) => {
      file.close();
      fs.unlink(tmpPath, () => {});
      reject(err);
    });
  });
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
 * 新曲リストを 2nd Brain に同期する。
 * 併せて、SRT自動生成のdispatch用に各曲の詳細（歌詞含む）を集めて返す。
 * @param {Array<{songId: string, handle: string}>} targetSongs
 * @returns {Promise<{added: number, songs: Array<{songId: string, handle: string, songName: string, title: string, lyrics: string, mp3Url: string}>}>}
 */
async function syncSongsToBrain(targetSongs) {
  if (!targetSongs || targetSongs.length === 0) {
    console.log('[2ndbrain-publisher] 同期対象の曲はありません。');
    return { added: 0, songs: [] };
  }

  console.log(`[2ndbrain-publisher] ${targetSongs.length}曲の歌詞同期を開始します...`);

  // 新規 Playwright セッションの起動
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // API叩くための初期遷移
    await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    let added = 0;
    const syncedSongs = [];

    for (let i = 0; i < targetSongs.length; i++) {
      const { songId, handle } = targetSongs[i];
      const dir = ARTIST_DIRS[handle];

      if (!dir) {
        console.error(`[2ndbrain-publisher] [${i+1}/${targetSongs.length}] FAIL: 未定義のアーティストハンドル: ${handle}`);
        continue;
      }

      try {
        const detail = await fetchClipDetail(page, songId);
        const songName = sanitizeFilename(detail.title || 'Untitled');
        const mp3Url = `https://cdn1.suno.ai/${detail.id}.mp3`;

        // SRT自動生成のdispatch用に詳細を先に収集（歌詞は metadata.prompt）。
        // 以降のローカル保存(MD/MP3)が失敗してもdispatchできるよう、ここで確定させる。
        syncedSongs.push({
          songId,
          handle,
          songName,
          title: detail.title || 'Untitled',
          lyrics: (detail.metadata && detail.metadata.prompt) || '',
          mp3Url,
        });

        // --- ローカル 2nd Brain への保存（ベストエフォート）---
        // GitHub Actions などローカルパスが無い環境では失敗してもよい（dispatchは上で確定済み）
        try {
          const songDir = path.join(dir, songName);
          const mdPath = path.join(songDir, `${songName}.md`);
          const mp3Path = path.join(songDir, `${songName}.mp3`);
          fs.mkdirSync(songDir, { recursive: true });

          // 既存ファイルの重複チェック（MDが既にあればスキップ。MP3だけ別途試す）
          if (fs.existsSync(mdPath)) {
            console.log(`    [${i+1}/${targetSongs.length}] SKIP MD: 既に存在します: ${detail.title}`);
          } else {
            fs.writeFileSync(mdPath, generateMd(detail), 'utf-8');
            console.log(`    [${i+1}/${targetSongs.length}] SYNC MD: ${detail.title} (${handle})`);
            added++;
          }

          // MP3 自動ダウンロード（既存ならスキップ）
          try {
            const result = await downloadMp3(mp3Url, mp3Path);
            if (result.skipped) {
              console.log(`    [${i+1}/${targetSongs.length}] SKIP MP3: 既に存在: ${songName}.mp3`);
            } else {
              console.log(`    [${i+1}/${targetSongs.length}] DL MP3: ${songName}.mp3`);
            }
          } catch (e) {
            console.error(`    [${i+1}/${targetSongs.length}] FAIL MP3: ${songName} - ${e.message}`);
          }
        } catch (e) {
          console.error(`    [${i+1}/${targetSongs.length}] SKIP ローカル保存（パス利用不可など）: ${songName} - ${e.message}`);
        }
      } catch (e) {
        console.error(`    [${i+1}/${targetSongs.length}] FAIL: songId ${songId} (${handle}) - ${e.message}`);
      }

      if (i < targetSongs.length - 1) {
        await page.waitForTimeout(800);
      }
    }

    console.log(`[2ndbrain-publisher] 歌詞同期完了: ${added}曲追加しました。`);
    return { added, songs: syncedSongs };
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
  syncSongsToBrain,
};
