/**
 * SUNO の音源(mp3)とジャケットを SSD に保存するローカル専用の単発スクリプト（2026-10-20）。
 *
 *   node src/save_to_ssd.js --dry-run        # 何をするかの一覧だけ。書き込みなし
 *   node src/save_to_ssd.js                  # 実行（LaunchAgent から毎日 05:30）
 *   node src/save_to_ssd.js --root <path>    # 保存先（既定 /Volumes/DevSSD/00_楽曲申請）
 *
 * 保存先: <root>/{Dara|coban}/曲名/
 *  - 音源: フォルダ直下に .wav があれば落とさない。曲名.mp3 が既にあれば落とさない。
 *  - ジャケット: 全曲 曲名_jacket.jpg。既にあれば落とさない。
 * 既存ファイルの上書き・削除・既存フォルダの改名はしない。
 * root が無い（SSD 未接続）ときは何もせず exit 0。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { sanitizeFilename, downloadMp3 } = require('./2ndbrain-publisher');

const DEFAULT_ROOT = '/Volumes/DevSSD/00_楽曲申請';
const ARTISTS = [
  { handle: 'darari_nu', dir: 'Dara' },
  { handle: 'coban3137', dir: 'coban' },
];
const WAIT_MS = 800;

const norm = (s) => s.trim().toLowerCase();
const hasWav = (files) => files.some((f) => /\.wav$/i.test(f));

/** フォルダ直下と、1階層下のサブフォルダ（Stems/ 等）に .wav があるか */
function folderHasWav(folderPath) {
  const files = listDirSafe(folderPath);
  if (hasWav(files)) return true;
  for (const n of files) {
    const sub = path.join(folderPath, n);
    try { if (fs.statSync(sub).isDirectory() && hasWav(listDirSafe(sub))) return true; } catch (e) { /* ignore */ }
  }
  return false;
}

/** フォルダ名の安全化: ドット始まり・空は Untitled に */
function safeFolderBase(title) {
  const b = sanitizeFilename(title || 'Untitled');
  return (!b || b.startsWith('.')) ? 'Untitled' : b;
}

/** ジャケットURLは suno.ai / suno.com 系のみ */
function isAllowedImageHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ['suno.ai', 'suno.com'].some((d) => h === d || h.endsWith('.' + d));
  } catch (e) { return false; }
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function listDirSafe(p) {
  try { return fs.readdirSync(p); } catch (e) { return []; }
}

/**
 * 純粋寄りの判定部分。clips は古い順（1曲目＝最古）で渡す。
 * artistDir 配下の既存状態を見るだけで、何も書かない。
 * @returns {Array<{id,title,folder,isNewFolder,folderPath,audio:'wav-skip'|'mp3-exists'|'download',
 *   jacket:'exists'|'no-url'|'download',mp3Dest,jacketDest,imageUrl}>}
 */
function planArtist(artistDir, clips) {
  const existing = listDirSafe(artistDir).filter((n) => {
    try { return fs.statSync(path.join(artistDir, n)).isDirectory(); } catch (e) { return false; }
  });
  const existingByNorm = new Map();
  for (const n of existing) if (!existingByNorm.has(norm(n))) existingByNorm.set(norm(n), n);

  const firstOfTitle = new Map(); // norm(title) -> { folder, wav }
  const seenIds = new Set();
  const plans = [];

  for (const c of clips) {
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    const base = safeFolderBase(c.title);
    const key = norm(base);
    let folder;
    let siblingHasWav = false;
    const first = firstOfTitle.get(key);
    if (!first) {
      folder = existingByNorm.get(key) || base;
      firstOfTitle.set(key, { folder });
    } else {
      const alt = `${base}_${c.id.slice(0, 8)}`;
      folder = existingByNorm.get(norm(alt)) || alt;
      siblingHasWav = folderHasWav(path.join(artistDir, first.folder));
    }
    const folderPath = path.join(artistDir, folder);
    if (!isInside(artistDir, folderPath)) {
      plans.push({ id: c.id, title: c.title, folder, unsafe: true });
      continue;
    }
    const isNewFolder = !existing.includes(folder);
    const files = listDirSafe(folderPath);
    const mp3Dest = path.join(folderPath, `${folder}.mp3`);
    const jacketDest = path.join(folderPath, `${folder}_jacket.jpg`);

    let audio;
    if (folderHasWav(folderPath) || siblingHasWav) audio = 'wav-skip';
    else if (files.includes(`${folder}.mp3`)) audio = 'mp3-exists';
    else audio = 'download';

    const imageUrl = c.imageUrl || '';
    let jacket;
    if (files.includes(`${folder}_jacket.jpg`)) jacket = 'exists';
    else if (!imageUrl) jacket = 'no-url';
    else if (!isAllowedImageHost(imageUrl)) jacket = 'bad-host';
    else jacket = 'download';

    plans.push({ id: c.id, title: c.title, folder, isNewFolder, folderPath, audio, jacket, mp3Dest, jacketDest, imageUrl });
  }
  return plans;
}

/** root が無ければ SSD 未接続としてスキップ判定 */
function shouldSkipRoot(root, statFn = fs.statSync) {
  try { return !statFn(root).isDirectory(); } catch (e) {
    if (e && e.code === 'ENOENT') return true;
    const err = new Error('SSD exists but cannot be accessed (permission?): ' + e.message);
    err.code = 'ROOT_UNACCESSIBLE';
    throw err;
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let root = DEFAULT_ROOT;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--root') root = args[++i];
  }
  return { root, dryRun };
}

/** プロフィール API から全曲（新しい順で返る）。page=1 始まり。429 は 10 秒待って 1 回だけ再試行 */
async function fetchClips(page, handle) {
  const clips = [];
  for (let pageNum = 1; pageNum <= 30; pageNum++) {
    const url = `https://studio-api-prod.suno.com/api/profiles/${handle}?playlists_sort_by=upvote_count&clips_sort_by=created_at&page=${pageNum}`;
    const call = () => page.evaluate(async (u) => {
      const r = await fetch(u);
      if (!r.ok) return { status: r.status };
      return { data: await r.json() };
    }, url);
    let res = await call();
    if (res.status === 429) {
      await page.waitForTimeout(10000);
      res = await call();
    }
    if (res.status) throw new Error(`HTTP ${res.status} (${handle} page=${pageNum})`);
    const got = (res.data && res.data.clips) || [];
    if (got.length === 0) break;
    for (const c of got) {
      clips.push({ id: c.id, title: c.title || 'Untitled', imageUrl: c.image_large_url || c.image_url || '' });
    }
    await page.waitForTimeout(300);
  }
  return clips;
}

/** https で保存。リダイレクトは1回まで。一時ファイル→rename */
function downloadImage(url, dest, redirects = 1) {
  return new Promise((resolve, reject) => {
    if (!isAllowedImageHost(url)) return reject(new Error('host not allowed: ' + url));
    const tmp = dest + '.tmp';
    // User-Agent が無いと SUNO の画像 CDN は 403 を返す
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) suno-tracker' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('redirect too many'));
        return downloadImage(new URL(res.headers.location, url).toString(), dest, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(tmp);
      const fail = (e) => { file.destroy(); fs.unlink(tmp, () => {}); reject(e); };
      res.on('error', fail);
      file.on('error', fail);
      res.pipe(file);
      file.on('finish', () => file.close((err) => {
        if (err) return fail(err);
        fs.rename(tmp, dest, (e) => (e ? reject(e) : resolve()));
      }));
    });
    req.on('error', (e) => { fs.unlink(tmp, () => {}); reject(e); });
  });
}

// テスト用: SAVE_TO_SSD_TEST_STAT_ERROR=EPERM で stat を失敗させる
const rootStat = process.env.SAVE_TO_SSD_TEST_STAT_ERROR
  ? () => { const e = new Error('simulated'); e.code = process.env.SAVE_TO_SSD_TEST_STAT_ERROR; throw e; }
  : fs.statSync;

async function main() {
  const { root, dryRun } = parseArgs(process.argv);
  try {
    if (shouldSkipRoot(root, rootStat)) {
      console.log('SSD 未接続のためスキップ');
      process.exit(0);
    }
  } catch (e) {
    console.error('SSD は存在するがアクセスできません（権限？）: ' + e.message);
    process.exit(1);
  }
  const { chromium } = require('playwright');
  console.log(`${dryRun ? '[dry-run] ' : ''}保存先: ${root}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const summary = {};
  const failedArtists = [];
  try {
    await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    for (const a of ARTISTS) {
      const s = summary[a.dir] = { newFolders: [], mp3: 0, wavSkip: 0, jacket: 0, noUrl: 0, fail: 0, total: 0 };
      let clips;
      try {
        clips = await fetchClips(page, a.handle);
      } catch (e) {
        console.error(`${a.dir}: 曲一覧の取得に失敗、飛ばします - ${e.message}`);
        failedArtists.push(a.dir);
        continue;
      }
      clips.reverse(); // 古い順（同名の別版は古い方を1曲目＝本来のフォルダにする）
      const artistDir = path.join(root, a.dir);
      const plans = planArtist(artistDir, clips);
      s.total = plans.length;
      console.log(`${a.dir}: ${plans.length}曲`);

      for (const p of plans) {
        if (p.unsafe) {
          s.fail++;
          console.error(`  FAIL unsafe folder: ${p.folder}`);
          continue;
        }
        if (p.isNewFolder) s.newFolders.push(p.folder);
        if (p.audio === 'wav-skip') s.wavSkip++;
        if (p.jacket === 'no-url') s.noUrl++;
        if (p.jacket === 'bad-host') {
          s.fail++;
          console.error(`  FAIL jacket host not allowed: ${p.folder}`);
        }
        const todo = [];
        if (p.isNewFolder) todo.push('新規フォルダ');
        if (p.audio === 'download') todo.push('mp3');
        if (p.jacket === 'download') todo.push('jacket');
        if (todo.length === 0) continue;

        if (dryRun) {
          console.log(`  [dry] ${a.dir}/${p.folder}: ${todo.join(', ')}`);
          if (p.audio === 'download') s.mp3++;
          if (p.jacket === 'download') s.jacket++;
          continue;
        }
        try {
          fs.mkdirSync(p.folderPath, { recursive: true });
        } catch (e) {
          s.fail++;
          console.error(`  FAIL mkdir: ${p.folder} - ${e.message}`);
          continue;
        }
        if (p.audio === 'download') {
          try {
            const r = await downloadMp3(`https://cdn1.suno.ai/${p.id}.mp3`, p.mp3Dest);
            if (!r.skipped) s.mp3++;
            console.log(`  mp3: ${p.folder}${r.viaMp4 ? '（MP4経由）' : ''}`);
          } catch (e) {
            s.fail++;
            console.error(`  FAIL mp3: ${p.folder} - ${e.message}`);
          }
          await page.waitForTimeout(WAIT_MS);
        }
        if (p.jacket === 'download') {
          try {
            await downloadImage(p.imageUrl, p.jacketDest);
            s.jacket++;
            console.log(`  jacket: ${p.folder}`);
          } catch (e) {
            s.fail++;
            console.error(`  FAIL jacket: ${p.folder} - ${e.message}`);
          }
          await page.waitForTimeout(WAIT_MS);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n=== 集計${dryRun ? '（dry-run・書き込みなし）' : ''} ===`);
  for (const [dir, s] of Object.entries(summary)) {
    console.log(`${dir}: 全${s.total}曲 / 新規フォルダ ${s.newFolders.length} / mp3${dryRun ? '予定' : '保存'} ${s.mp3} / wavありでSKIP ${s.wavSkip} / jacket${dryRun ? '予定' : '保存'} ${s.jacket} / 画像URLなし ${s.noUrl} / 失敗 ${s.fail}`);
    if (s.newFolders.length) {
      console.log(`  新規フォルダ:`);
      for (const n of s.newFolders) console.log(`    ${dir}/${n}`);
    }
  }
  if (failedArtists.length) {
    console.error(`失敗（一覧取得）: ${failedArtists.join(', ')}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { planArtist, shouldSkipRoot, hasWav, isAllowedImageHost, safeFolderBase };
