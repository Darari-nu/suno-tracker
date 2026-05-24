const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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
 * 新曲リストを 2nd Brain に同期する
 * @param {Array<{songId: string, handle: string}>} targetSongs
 * @returns {Promise<number>} 追加に成功した曲数
 */
async function syncSongsToBrain(targetSongs) {
  if (!targetSongs || targetSongs.length === 0) {
    console.log('[2ndbrain-publisher] 同期対象の曲はありません。');
    return 0;
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

    for (let i = 0; i < targetSongs.length; i++) {
      const { songId, handle } = targetSongs[i];
      const dir = ARTIST_DIRS[handle];

      if (!dir) {
        console.error(`[2ndbrain-publisher] [${i+1}/${targetSongs.length}] FAIL: 未定義のアーティストハンドル: ${handle}`);
        continue;
      }

      fs.mkdirSync(dir, { recursive: true });

      try {
        const detail = await fetchClipDetail(page, songId);
        const filename = sanitizeFilename(detail.title || 'Untitled') + '.md';
        const destPath = path.join(dir, filename);

        // 既存ファイルの重複チェック
        if (fs.existsSync(destPath)) {
          console.log(`    [${i+1}/${targetSongs.length}] SKIP: 既に存在します: ${detail.title}`);
          continue;
        }

        fs.writeFileSync(destPath, generateMd(detail), 'utf-8');
        console.log(`    [${i+1}/${targetSongs.length}] SYNC: ${detail.title} (${handle})`);
        added++;
      } catch (e) {
        console.error(`    [${i+1}/${targetSongs.length}] FAIL: songId ${songId} (${handle}) - ${e.message}`);
      }

      if (i < targetSongs.length - 1) {
        await page.waitForTimeout(800);
      }
    }

    console.log(`[2ndbrain-publisher] 歌詞同期完了: ${added}曲追加しました。`);
    return added;
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
