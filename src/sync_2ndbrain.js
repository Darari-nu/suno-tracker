/**
 * dara(darari_nu) + coban(coban3137)の全曲をSuno APIから取得し
 * 2ndBrainのartist/songsフォルダに差分追加する
 * 実行: node src/sync_2ndbrain.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 環境変数 TWOBRAIN_BASE でオーバーライド可能（GitHub Actions用）
const TWOBRAIN_BASE = process.env.TWOBRAIN_BASE
  || '/Users/watanabehidetaka/Claudecode/260307_2nd-Brain/03_知識ベース/音楽';

const ARTISTS = [
  {
    handle: 'darari_nu',
    dir: path.join(TWOBRAIN_BASE, 'dara', 'songs'),
  },
  {
    handle: 'coban3137',
    dir: path.join(TWOBRAIN_BASE, 'coban', 'songs'),
  },
];

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
    paramSection = `| パラメータ | 値 |\n|-----------|-----|\n| audio_weight | ${sliders.audio_weight ?? '—'} |\n| style_weight | ${sliders.style_weight ?? '—'} |\n| weirdness_constraint | ${sliders.weirdness_constraint ?? '—'} |`;
  } else {
    paramSection = '生成パラメータ情報なし';
  }

  return `# ${title}\n\n## 基本情報\n\n| 項目 | 値 |\n|------|-----|\n| アーティスト | ${data.display_name} (${data.handle}) |\n| ペルソナ | ${data.persona ? data.persona.name : '—'} |\n| モデル | ${data.major_model_version} (${data.model_name}) |\n| タスク | ${task} |\n| 尺 | ${formatDuration(m.duration)} |\n| 公開日 | ${formatDate(data.created_at)} |\n| キャプション | ${caption} |\n\n## 実績\n\n| 指標 | 数値 |\n|------|------|\n| 再生数 | ${(data.play_count || 0).toLocaleString()} |\n| いいね | ${(data.upvote_count || 0).toLocaleString()} |\n| コメント | ${(data.comment_count || 0)} |\n\n## 歌詞\n\n\`\`\`\n${prompt}\n\`\`\`\n\n## スタイルプロンプト\n\n\`\`\`\n${tags}\n\`\`\`\n\n**表示タグ**: ${displayTags}\n\n## 除外プロンプト\n\n\`\`\`\n${negativeTags}\n\`\`\`\n\n## 生成パラメータ\n\n${paramSection}\n\n## リンク\n\n- [SUNO](https://suno.com/song/${data.id})\n- [MP3](https://cdn1.suno.ai/${data.id}.mp3)\n- [MP4](https://cdn1.suno.ai/${data.id}.mp4)\n`;
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

async function syncArtist(page, handle, dir) {
  const existingFiles = new Set(
    fs.readdirSync(dir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace(/\.md$/, ''))
  );
  console.log(`  既存ファイル: ${existingFiles.size}曲`);

  const allClips = await fetchAllClips(page, handle);
  console.log(`  Suno合計: ${allClips.length}曲`);

  const newClips = allClips.filter(clip => {
    const filename = sanitizeFilename(clip.title || 'Untitled');
    return !existingFiles.has(filename);
  });
  console.log(`  新曲: ${newClips.length}曲`);

  let added = 0;
  for (let i = 0; i < newClips.length; i++) {
    const clip = newClips[i];
    try {
      const detail = await fetchClipDetail(page, clip.id);
      const filename = sanitizeFilename(detail.title || 'Untitled') + '.md';
      fs.writeFileSync(path.join(dir, filename), generateMd(detail));
      console.log(`    [${i+1}/${newClips.length}] 追加: ${detail.title}`);
      added++;
    } catch (e) {
      console.error(`    [${i+1}/${newClips.length}] FAIL: ${clip.title} - ${e.message}`);
    }
    if (i < newClips.length - 1) await page.waitForTimeout(800);
  }

  return { total: allClips.length, added };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const summary = [];

  for (const artist of ARTISTS) {
    console.log(`\n=== ${artist.handle} ===`);
    fs.mkdirSync(artist.dir, { recursive: true });
    const result = await syncArtist(page, artist.handle, artist.dir);
    summary.push({ handle: artist.handle, ...result });
  }

  console.log('\n=== 完了 ===');
  for (const s of summary) {
    console.log(`${s.handle}: 合計${s.total}曲, 新規追加${s.added}曲`);
  }

  await browser.close();
}

main().catch(console.error);
