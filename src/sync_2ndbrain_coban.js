/**
 * coban3137のSuno全曲を取得し、2ndBrainのcoban/songsに差分追加する
 * 実行: node src/sync_2ndbrain_coban.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COBAN_HANDLE = 'coban3137';
const TWOBRAIN_COBAN_DIR = '/Users/watanabehidetaka/Claudecode/260307_2nd-Brain/03_知識ベース/音楽/coban/songs';

const { downloadMp3 } = require('./2ndbrain-publisher');

function listExistingSongs(dir) {
  const existing = new Set();
  if (!fs.existsSync(dir)) return existing;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    if (entry.isDirectory()) {
      const name = entry.name;
      if (fs.existsSync(path.join(dir, name, `${name}.md`))) {
        existing.add(name);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      existing.add(entry.name.replace(/\.md$/, ''));
    }
  }
  return existing;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function formatDate(iso) {
  if (!iso) return '不明';
  return iso.split('T')[0];
}

function formatDuration(sec) {
  if (!sec) return '不明';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')} (${sec}秒)`;
}

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

async function fetchAllClips(page, handle) {
  const allClips = [];
  let pageNum = 1;

  while (true) {
    const url = `https://studio-api-prod.suno.com/api/profiles/${handle}?playlists_sort_by=upvote_count&clips_sort_by=created_at&page=${pageNum}`;
    const result = await page.evaluate(async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    }, url);

    const totalClips = result.num_total_clips || 0;
    const clips = result.clips || [];

    for (const clip of clips) {
      if (!allClips.some(c => c.id === clip.id)) {
        allClips.push(clip);
      }
    }

    console.log(`  page ${pageNum}: ${clips.length}曲 (累計: ${allClips.length}/${totalClips})`);
    if (clips.length === 0 || allClips.length >= totalClips) break;
    pageNum++;
  }

  return allClips;
}

async function fetchClipDetail(page, songId) {
  const url = `https://studio-api-prod.suno.com/api/clip/${songId}`;
  return page.evaluate(async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }, url);
}

async function main() {
  // 既存一覧（新フォルダ構造ベース、旧フラット.mdも互換用に含める）
  const existingFiles = listExistingSongs(TWOBRAIN_COBAN_DIR);
  console.log(`既存ファイル数: ${existingFiles.size}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log(`\ncoban3137の全曲リスト取得中...`);
  const allClips = await fetchAllClips(page, COBAN_HANDLE);
  console.log(`合計: ${allClips.length}曲`);

  // 新曲を特定
  const newClips = allClips.filter(clip => {
    const filename = sanitizeFilename(clip.title || 'Untitled');
    return !existingFiles.has(filename);
  });
  console.log(`\n新曲（2ndBrainに未保存）: ${newClips.length}曲`);

  if (newClips.length === 0) {
    console.log('追加すべき新曲はありません。');
    await browser.close();
    return;
  }

  // 新曲の詳細取得 & MD生成 & MP3DL
  let added = 0;
  for (let i = 0; i < newClips.length; i++) {
    const clip = newClips[i];
    try {
      const detail = await fetchClipDetail(page, clip.id);
      const songName = sanitizeFilename(detail.title || 'Untitled');
      const songDir = path.join(TWOBRAIN_COBAN_DIR, songName);
      fs.mkdirSync(songDir, { recursive: true });
      fs.writeFileSync(path.join(songDir, `${songName}.md`), generateMd(detail));
      console.log(`[${i+1}/${newClips.length}] MD: ${detail.title}`);
      added++;
      try {
        const result = await downloadMp3(`https://cdn1.suno.ai/${detail.id}.mp3`, path.join(songDir, `${songName}.mp3`));
        console.log(`[${i+1}/${newClips.length}] MP3: ${result.skipped ? 'SKIP' : 'DL'} ${songName}.mp3`);
      } catch (e) {
        console.error(`[${i+1}/${newClips.length}] FAIL MP3: ${songName} - ${e.message}`);
      }
    } catch (e) {
      console.error(`[${i+1}/${newClips.length}] FAIL: ${clip.title} - ${e.message}`);
    }
    if (i < newClips.length - 1) await page.waitForTimeout(800);
  }

  console.log(`\n完了: ${added}曲を2ndBrainに追加`);
  console.log(`保存先: ${TWOBRAIN_COBAN_DIR}`);

  await browser.close();
}

main().catch(console.error);
