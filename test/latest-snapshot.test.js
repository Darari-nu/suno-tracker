// node test/latest-snapshot.test.js  （失敗時 exit 1。ネットワークには一切出ない）
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLatestSnapshot, writeLatestSnapshot } = require('../src/latest-snapshot');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

const song = (id, plays) => ({ songId: id, title: 'T' + id, url: 'https://suno.com/song/' + id, plays, likes: 2, comments: 1, imageUrl: 'x', createdAt: '2026-01-01T00:00:00Z' });
const artist = (songs, followers = 10, following = 5) => ({ success: true, complete: true, rawFollowers: followers, rawFollowing: following, songs, songCount: songs.length, followers, following, timestamp: 't' });
const hook = (id) => ({ hookId: id, songId: 's1', songTitle: 'T1', views: 7, likes: 1, comments: 0, createdAt: '2026-10-20T00:00:00Z' });
const names = ['a', 'b'];
const base = () => ({
  artistData: { a: artist([song('s1', 100)]), b: artist([song('s2', 50), song('s3', 5)], 20, 8) },
  hooksByArtist: { a: { success: true, found: true, hooks: [hook('h1')] }, b: { success: true, found: true, hooks: [] } },
  artistNames: names,
  now: new Date('2026-11-28T00:00:00Z')
});
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'latest-')), 'latest.json');

t('形とキーの順', () => {
  const j = buildLatestSnapshot(base());
  assert.deepStrictEqual(Object.keys(j), ['generatedAt', 'artists']);
  assert.strictEqual(j.generatedAt, '2026-11-28T00:00:00.000Z');
  assert.deepStrictEqual(Object.keys(j.artists[0]), ['name', 'followers', 'following', 'songs', 'hooks']);
  assert.deepStrictEqual(Object.keys(j.artists[0].songs[0]), ['songId', 'title', 'url', 'plays', 'likes', 'comments', 'createdAt']);
  assert.deepStrictEqual(Object.keys(j.artists[0].hooks[0]), ['hookId', 'songId', 'songTitle', 'views', 'likes', 'comments', 'createdAt']);
  assert.strictEqual(j.artists[1].songs.length, 2);
  assert.strictEqual(j.artists[0].followers, 10);
});

t('成功の回は書く', () => {
  const f = tmp();
  assert.strictEqual(writeLatestSnapshot(base(), f), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf-8')).artists.length, 2);
});

t('曲0件の名義があれば書かない（前のファイルを残す）', () => {
  const f = tmp();
  writeLatestSnapshot(base(), f);
  const before = fs.readFileSync(f, 'utf-8');
  const a = base();
  a.artistData.b = artist([]);
  assert.strictEqual(writeLatestSnapshot(a, f), false);
  assert.strictEqual(fs.readFileSync(f, 'utf-8'), before);
});

t('失敗・欠けた名義があれば書かない', () => {
  const a = base();
  a.artistData.b = { success: false };
  assert.strictEqual(buildLatestSnapshot(a), null);
  const c = base();
  delete c.artistData.b;
  assert.strictEqual(buildLatestSnapshot(c), null);
});

t('フォロワー: 取れなかった方だけ null（0 にしない）', () => {
  const a = base();
  a.artistData.b = { ...artist([song('s2', 50)]), rawFollowers: null, rawFollowing: 8 };
  const j = buildLatestSnapshot(a);
  assert.strictEqual(j.artists[1].followers, null);
  assert.strictEqual(j.artists[1].following, 8);
  assert.strictEqual(j.artists[0].followers, 10);
});

t('フォロワー 0 は 0 のまま', () => {
  const a = base();
  a.artistData.b = { ...artist([song('s2', 50)]), rawFollowers: 0, rawFollowing: 0 };
  assert.strictEqual(buildLatestSnapshot(a).artists[1].followers, 0);
});

t('取り切れていない回（complete でない）は書かない', () => {
  const a = base();
  a.artistData.b.complete = false;
  assert.strictEqual(buildLatestSnapshot(a), null);
  const c = base();
  delete c.artistData.b.complete;
  assert.strictEqual(buildLatestSnapshot(c), null);
});

t('plays が取れていない曲があれば書かない／likes・comments は null', () => {
  const a = base();
  a.artistData.b.songs[0].rawCounts = { plays: null, likes: 1, comments: 1 };
  assert.strictEqual(buildLatestSnapshot(a), null);
  const c = base();
  c.artistData.b.songs[0].rawCounts = { plays: 0, likes: null, comments: null };
  const j = buildLatestSnapshot(c);
  assert.strictEqual(j.artists[1].songs[0].plays, 0);
  assert.strictEqual(j.artists[1].songs[0].likes, null);
  assert.strictEqual(j.artists[1].songs[0].comments, null);
});

t('フックだけ取れなかった名義は hooks: null（持ち越さない）', () => {
  const f = tmp();
  writeLatestSnapshot(base(), f);
  const a = base();
  a.hooksByArtist.a = { success: false };
  writeLatestSnapshot(a, f);
  const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
  assert.strictEqual(j.artists[0].hooks, null);
  assert.strictEqual(j.artists[1].hooks.length, 0);
});

t('原子的に書く: 一時ファイルが残らず、rename の失敗で旧版が残る', () => {
  const f = tmp();
  writeLatestSnapshot(base(), f);
  assert.ok(!fs.existsSync(f + '.tmp'));
  const before = fs.readFileSync(f, 'utf-8');
  const orig = fs.renameSync;
  fs.renameSync = () => { throw new Error('boom'); };
  try { assert.throws(() => writeLatestSnapshot({ ...base(), now: new Date('2027-01-01') }, f)); }
  finally { fs.renameSync = orig; }
  assert.strictEqual(fs.readFileSync(f, 'utf-8'), before);
});

if (failed) { console.log(failed + ' 件失敗'); process.exit(1); }
console.log('全緑');
