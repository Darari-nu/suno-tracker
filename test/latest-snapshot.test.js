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
const artist = (songs, followers = 10, following = 5) => ({ success: true, songs, songCount: songs.length, followers, following, timestamp: 't' });
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

t('フォロワーが片方の名義で欠けたらその名義の followers を null にする', () => {
  const a = base();
  a.artistData.b = artist([song('s2', 50)], 0, 0);
  const j = buildLatestSnapshot(a);
  assert.strictEqual(j.artists[1].followers, null);
  assert.strictEqual(j.artists[1].following, null);
  assert.strictEqual(j.artists[0].followers, 10);
});

t('フックの取得に失敗した名義は前回のフックを引き継ぐ', () => {
  const f = tmp();
  writeLatestSnapshot(base(), f);
  const a = base();
  a.hooksByArtist.a = { success: false };
  writeLatestSnapshot(a, f);
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf-8')).artists[0].hooks[0].hookId, 'h1');
});

if (failed) { console.log(failed + ' 件失敗'); process.exit(1); }
console.log('全緑');
