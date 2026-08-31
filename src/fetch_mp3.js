/**
 * 手元にSUNOの音源が欲しいときだけ使う単発スクリプト。
 *
 *   node src/fetch_mp3.js "曲名"            # 1曲だけ落とす（部分一致・大文字小文字は無視）
 *   node src/fetch_mp3.js --all             # 全曲落とす
 *   node src/fetch_mp3.js "曲名" --out ~/x  # 保存先を指定（既定: ~/Music/SUNO）
 *
 * 保存先はリポジトリの外。gitには入れない。
 *
 * なぜ単発スクリプトなのか:
 * 以前は毎日のCI（Dara_Brainのsync-music.yml）が全曲のMP3を落としていたが、
 * Dara_Brainの.gitignoreに *.mp3 があるため一度もcommitされず毎回捨てられていた。
 * 音源が要るのは「MV制作でその曲だけ」という場面なので、毎日全曲ではなく
 * 必要なときに必要な分だけ落とす形にした（2026-08-31）。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { sanitizeFilename, downloadMp3 } = require('./2ndbrain-publisher');

const HANDLES = ['darari_nu', 'coban3137'];

function parseArgs(argv) {
  const args = argv.slice(2);
  let out = path.join(os.homedir(), 'Music', 'SUNO');
  let all = false;
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all') all = true;
    else if (args[i] === '--out') out = args[++i];
    else words.push(args[i]);
  }
  return { query: words.join(' ').trim(), all, out };
}

/** アーティストの全曲（id/title/handle）をプロフィールAPIから集める */
async function fetchClips(page, handle) {
  const clips = [];
  for (let pageNum = 0; pageNum < 30; pageNum++) {
    const url = `https://studio-api-prod.suno.com/api/profiles/${handle}?playlists_sort_by=upvote_count&clips_sort_by=created_at&page=${pageNum}`;
    const data = await page.evaluate(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }, url);
    const got = (data && data.clips) || [];
    if (got.length === 0) break;
    for (const c of got) clips.push({ id: c.id, title: c.title || 'Untitled', handle });
    await page.waitForTimeout(300);
  }
  return clips;
}

async function main() {
  const { query, all, out } = parseArgs(process.argv);
  if (!query && !all) {
    console.error('使い方: node src/fetch_mp3.js "曲名"  /  node src/fetch_mp3.js --all');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    let clips = [];
    for (const h of HANDLES) clips = clips.concat(await fetchClips(page, h));
    console.log(`全${clips.length}曲を取得`);

    const targets = all
      ? clips
      : clips.filter(c => c.title.toLowerCase().includes(query.toLowerCase()));

    if (targets.length === 0) {
      console.error(`「${query}」に一致する曲が見つかりません。`);
      process.exit(1);
    }
    console.log(`対象: ${targets.length}曲 → 保存先: ${out}`);
    fs.mkdirSync(out, { recursive: true });

    let ok = 0;
    const used = new Set();
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      // 同名タイトルが複数ある（別バージョン）ことがある。1曲目に上書き/スキップされて
      // 消えないよう、2曲目以降はsongIdの先頭8桁を付けて別ファイルにする。
      let dest = path.join(out, `${sanitizeFilename(c.title)}.mp3`);
      if (used.has(dest)) dest = path.join(out, `${sanitizeFilename(c.title)}_${c.id.slice(0, 8)}.mp3`);
      used.add(dest);
      try {
        // MP3が403ならMP4から音声を抜くフォールバックが downloadMp3 に入っている
        const r = await downloadMp3(`https://cdn1.suno.ai/${c.id}.mp3`, dest);
        console.log(`  [${i+1}/${targets.length}] ${r.skipped ? 'SKIP（既にある）' : (r.viaMp4 ? 'DL（MP4経由）' : 'DL')}: ${path.basename(dest)}`);
        ok++;
      } catch (e) {
        console.error(`  [${i+1}/${targets.length}] FAIL: ${c.title} - ${e.message}`);
      }
    }
    console.log(`\n完了: ${ok}/${targets.length}曲`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
