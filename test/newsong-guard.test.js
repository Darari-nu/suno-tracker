// node test/newsong-guard.test.js  （失敗時 exit 1。ネットワーク・SUNO・dispatch には一切出ない）
const assert = require('assert');
const { detectAnomalies } = require('../src/anomaly-detector');
const { normalizeDomSongs } = require('../src/song-normalize');
const { getKnownSongIds } = require('../src/csv-store');

let failed = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('ok   ' + name),
    (e) => { failed++; console.log('FAIL ' + name + ': ' + e.message); }
  );
}
const ids = (n, p = 'id') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const mk = (list) => list.map(id => ({ songId: id, title: id, plays: 1, likes: 1, comments: 0 }));
const A = 'coban3137';
const cur = (list, method) => ({ [A]: { success: true, method, songs: mk(list), songCount: list.length } });
const prev = (list) => ({ [A]: { songs: mk(list), songCount: list.length } });
const count = (an, type) => an.filter(a => a.type === type).length;

(async () => {
  const all48 = ids(48);
  const dom40 = [...all48.slice(0, 20), ...all48.slice(0, 20).map(i => i + '?show_comments=true')];

  await t('A: 22:46(48曲)→00:49 DOM40件 で NEW_SONG 0', () => {
    const an = detectAnomalies(cur(dom40, 'dom'), prev(all48), [], { [A]: new Set(all48) });
    assert.strictEqual(count(an, 'NEW_SONG'), 0);
    const an2 = detectAnomalies(cur(dom40, 'dom'), prev(all48), []); // フォールバック経路でも
    assert.strictEqual(count(an2, 'NEW_SONG'), 0);
  });
  await t('B: 壊れたprev(40行)+API48曲+全履歴 で NEW_SONG 0', () => {
    const an = detectAnomalies(cur(all48, 'api'), prev(dom40), [], { [A]: new Set(all48) });
    assert.strictEqual(count(an, 'NEW_SONG'), 0);
    assert.strictEqual(count(an, 'NEW_SONG_BURST'), 0);
  });
  await t('C: 履歴に無い1件+api で NEW_SONG 1', () => {
    const an = detectAnomalies(cur([...all48, 'brandnew'], 'api'), prev(all48), [], { [A]: new Set(all48) });
    assert.strictEqual(count(an, 'NEW_SONG'), 1);
    assert.strictEqual(an.find(a => a.type === 'NEW_SONG').songId, 'brandnew');
  });
  await t('D: 履歴に無い5件 で NEW_SONG 0 / BURST 1', () => {
    const an = detectAnomalies(cur([...all48, ...ids(5, 'n')], 'api'), prev(all48), [], { [A]: new Set(all48) });
    assert.strictEqual(count(an, 'NEW_SONG'), 0);
    assert.strictEqual(count(an, 'NEW_SONG_BURST'), 1);
  });
  await t('E: 正規化（?付き除外・重複1件・url正規化）', () => {
    const out = normalizeDomSongs([
      { href: 'https://suno.com/song/abc', title: 'T' },
      { href: 'https://suno.com/song/abc?show_comments=true', title: '12' },
      { href: 'https://suno.com/song/abc', title: 'T' },
      { href: 'https://suno.com/song/def#x', title: 'U' },
      { href: 'https://suno.com/song/', title: 'empty' },
    ]);
    assert.deepStrictEqual(out.map(o => o.songId), ['abc', 'def']);
    assert.strictEqual(out[0].url, 'https://suno.com/song/abc');
    assert.ok(!('href' in out[0]));
  });
  await t('E2: getKnownSongIds は全履歴(48曲以上)・?無し', () => {
    const k = getKnownSongIds(A);
    assert.ok(k.size >= 48);
    for (const id of k) assert.ok(!/[?#]/.test(id));
    assert.strictEqual(getKnownSongIds('no_such_artist').size, 0);
  });
  await t('F: dispatch は5件→send 3回（スタブ）', async () => {
    const saved = process.env.REPO_ACCESS_TOKEN;
    process.env.REPO_ACCESS_TOKEN = 'dummy-test-token';
    try {
      const { dispatchSrtGeneration } = require('../src/srt-dispatcher');
      const calls = [];
      const songs = ids(5, 's').map(id => ({ songId: id, handle: 'h', songName: id, title: id, lyrics: 'l' }));
      await dispatchSrtGeneration(songs, { send: async (tok, s) => { calls.push(s.songId); } });
      assert.strictEqual(calls.length, 3);
    } finally {
      if (saved === undefined) delete process.env.REPO_ACCESS_TOKEN; else process.env.REPO_ACCESS_TOKEN = saved;
    }
  });

  process.exit(failed ? 1 : 0);
})();
