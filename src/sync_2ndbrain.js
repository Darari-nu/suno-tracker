/**
 * dara(darari_nu) + coban(coban3137)の全曲をSuno APIから取得し
 * 2ndBrainのartist/songsフォルダに差分追加する
 * 実行: node src/sync_2ndbrain.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const {
  ARTIST_DIRS,
  sanitizeFilename,
  generateMd,
  fetchClipDetail,
} = require('./2ndbrain-publisher');

const ARTISTS = [
  {
    handle: 'darari_nu',
    dir: ARTIST_DIRS.darari_nu,
  },
  {
    handle: 'coban3137',
    dir: ARTIST_DIRS.coban3137,
  },
];

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

function listExistingSongs(dir) {
  // 新構造: dir/{曲名}/{曲名}.md があるサブフォルダ名を集める
  // 旧構造: dir/{曲名}.md も互換用に含める（移行期）
  const existing = new Set();
  if (!fs.existsSync(dir)) return existing;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    if (entry.isDirectory()) {
      const name = entry.name;
      // 念のためmd実在チェック
      if (fs.existsSync(path.join(dir, name, `${name}.md`))) {
        existing.add(name);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      existing.add(entry.name.replace(/\.md$/, ''));
    }
  }
  return existing;
}

async function syncArtist(page, handle, dir) {
  const existingFiles = listExistingSongs(dir);
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
      const songName = sanitizeFilename(detail.title || 'Untitled');
      const songDir = path.join(dir, songName);
      fs.mkdirSync(songDir, { recursive: true });
      fs.writeFileSync(path.join(songDir, `${songName}.md`), generateMd(detail));
      console.log(`    [${i+1}/${newClips.length}] MD: ${detail.title}`);
      added++;
      // MP3はここでは落とさない。Dara_Brainの.gitignoreに *.mp3 があるため、
      // CIで落としても一度もcommitされず毎回捨てられていた（2026-08-31に廃止）。
      // 手元に音源が欲しいときは `node src/fetch_mp3.js "曲名"` を使う。
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
