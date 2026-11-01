// node test/hooks.test.js  （失敗時 exit 1。ネットワークには一切出ない）
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseHooksFromHtml } = require('../src/hook-scraper');
const { saveHooksData, HOOKS_HEADER } = require('../src/csv-store');

let failed = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('ok   ' + name),
    (e) => { failed++; console.log('FAIL ' + name + ': ' + e.message); }
  );
}

// 実ページと同じ形: JSON を文字列にして self.__next_f.push([1,"..."]) に入れる（JSON.stringify で二重エスケープ）
const hookObj = (id, songId, view, like, comment, title, noClip) => {
  const o = { entityType: 'hook_schema', id, userId: -1, originalClipId: songId, title: '' };
  if (view !== null) o.viewCount = view;
  if (like !== null) o.likeCount = like;
  o.caption = 'line1\nsay "hi", \\ ok';
  if (comment !== null) o.commentCount = comment;
  o.createdAt = '2026-10-20T01:02:03Z';
  if (!noClip) o.clip = { id: songId, title, playCount: 9999, createdAt: '2026-01-01T00:00:00Z' };
  return o;
};
const feed = (hooks) => '4c:' + JSON.stringify({ feedId: 'user_hooks', items: hooks });
const push = (text) => `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;
const page = (body) => `<html>${push(body)}</html>`;

(async () => {
  await t('A: 2本・重複除去・複数push分割・数値と曲名とsongId', () => {
    const h1 = hookObj('h-1', 'song-1', 618, 12, 3, '遠吠え');
    const h2 = hookObj('h-2', 'song-2', 746, 20, 5, '満月と亀');
    const body = feed([h1, h2]) + '\n' + feed([h1, h2]);
    const cut = Math.floor(body.length / 3); // 1つのJSONが途中でpushを跨ぐ
    const html = '<html>' + push(body.slice(0, cut)) + push(body.slice(cut)) + '</html>';
    const r = parseHooksFromHtml(html);
    assert.strictEqual(r.found, true);
    assert.strictEqual(r.hooks.length, 2);
    assert.deepStrictEqual(r.hooks[0], { hookId: 'h-1', songId: 'song-1', songTitle: '遠吠え', views: 618, likes: 12, comments: 3, createdAt: '2026-10-20T01:02:03Z' });
    assert.strictEqual(r.hooks[1].songTitle, '満月と亀');
    assert.strictEqual(r.hooks[1].views, 746);
    assert.strictEqual(r.hooks[1].songId, 'song-2');
  });
  await t('B: user_hooks が無い HTML → found=false / hooks 空', () => {
    const r = parseHooksFromHtml('<html><body>no hooks here</body></html>');
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.hooks.length, 0);
  });
  await t('C: viewCount の欠けた hook は捨てる（後ろの別 viewCount を拾わない）', () => {
    const h1 = hookObj('h-1', 'song-1', null, 12, 3, 'A');
    const h2 = hookObj('h-2', 'song-2', 5, 1, 0, 'B');
    const r = parseHooksFromHtml(page(feed([h1, h2])));
    assert.strictEqual(r.found, true);
    assert.deepStrictEqual(r.hooks.map(h => h.hookId), ['h-2']);
  });
  await t('D: saveHooksData は success かつ found の名義だけ書く', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-')), 'hooks.csv');
    const hk = (id, v) => ({ hookId: id, songId: 's' + id, songTitle: 'T,"' + id, views: v, likes: 1, comments: 0, createdAt: '2026-10-20T01:02:03Z' });
    const n = saveHooksData({
      ok: { success: true, found: true, hooks: [hk('a', 1), hk('b', 2)] },
      failed: { success: false, found: false, hooks: [hk('c', 3)] },
      nofound: { success: true, found: false, hooks: [hk('d', 4)] }
    }, '2026-11-01T00:00:00.000Z', file);
    assert.strictEqual(n, 2);
    saveHooksData({ ok: { success: true, found: true, hooks: [hk('a', 5)] } }, '2026-11-01T01:00:00.000Z', file);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    assert.strictEqual(lines[0], HOOKS_HEADER);
    assert.strictEqual(lines.filter(l => l === HOOKS_HEADER).length, 1);
    assert.strictEqual(lines.length, 1 + 3);
    assert.ok(!lines.join('\n').includes(',c,') && !lines.join('\n').includes(',d,'));
  });
  await t('E: 最後の hook の clip が欠け、後ろに無関係な clip → 別の曲名を拾わない', () => {
    const h1 = hookObj('h-1', 'song-1', 10, 1, 1, '正しい曲');
    const h2 = hookObj('h-2', 'song-2', 20, 2, 2, 'x', true);
    const body = feed([h1, h2]) + '\n' + JSON.stringify({ clip: { title: '無関係な曲', viewCount: 99999 } });
    const r = parseHooksFromHtml(page(body));
    assert.strictEqual(r.hooks.length, 2);
    assert.strictEqual(r.hooks[1].songTitle, '');
    assert.strictEqual(r.hooks[1].views, 20);
  });
  await t('F: 引用符・バックスラッシュ入りの曲名が復元され、改行は空白になる', () => {
    const title = 'a"b\nc\\d,e';
    const r = parseHooksFromHtml(page(feed([hookObj('h-1', 's', 1, 1, 1, title)])));
    assert.strictEqual(r.hooks[0].songTitle, 'a"b c\\d,e');
  });
  await t('G: likes / comments が欠けている → 捨てる', () => {
    const r = parseHooksFromHtml(page(feed([
      hookObj('h-1', 's1', 1, null, 1, 'A'),
      hookObj('h-2', 's2', 1, 1, null, 'B'),
      hookObj('h-3', 's3', 1, 1, 1, 'C')
    ])));
    assert.deepStrictEqual(r.hooks.map(h => h.hookId), ['h-3']);
  });
  await t('H: user_hooks なし・hook_schema あり → found=false で hooks 空', () => {
    const body = JSON.stringify({ feedId: 'other_feed', items: [hookObj('h-1', 's1', 1, 1, 1, 'A')] });
    const r = parseHooksFromHtml(page(body));
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.hooks.length, 0);
  });

  await t('I: user_hooks と別 feed が同じページにある → 別 feed のフックは混ぜない', () => {
    const own = hookObj('own', 's1', 1, 1, 1, '自分の');
    const other = hookObj('other', 's2', 2, 2, 2, '他人の');
    const body = JSON.stringify({ feedId: 'other_feed', items: [other] }) + '\n' +
      JSON.stringify({ feedId: 'user_hooks', feedContainerType: 'synthetic_playlist', feedTitle: 'Hooks', items: [own] }) + '\n' +
      JSON.stringify({ feedId: 'trending', items: [other] });
    const r = parseHooksFromHtml(page(body));
    assert.strictEqual(r.found, true);
    assert.deepStrictEqual(r.hooks.map(h => h.hookId), ['own']);
  });
  await t('K: items が feedId より前・items が null の user_hooks の直後に別 feed → 別 feed のフックは混ぜない', () => {
    const other = hookObj('other', 's2', 2, 2, 2, '他人の');
    const tail = JSON.stringify({ feedId: 'trending', items: [other] });
    const r1 = parseHooksFromHtml(page('{"items":[],"feedId":"user_hooks"}' + tail));
    assert.strictEqual(r1.hooks.length, 0);
    const r2 = parseHooksFromHtml(page(JSON.stringify({ feedId: 'user_hooks', items: null }) + tail));
    assert.strictEqual(r2.found, false);
    assert.strictEqual(r2.hooks.length, 0);
  });
  await t('L: 実ページの形（item.contentItem が hook）も読める', () => {
    const h = hookObj('h-9', 's9', 621, 10, 28, '遠吠え');
    const body = JSON.stringify({ feed: { feedId: 'user_hooks', feedContainerType: 'synthetic_playlist', feedTitle: 'Hooks',
      items: [{ contentId: 'h-9', contentType: 'hook', contentItem: h }] } });
    const r = parseHooksFromHtml(page(body));
    assert.deepStrictEqual(r.hooks.map(x => [x.hookId, x.songTitle, x.views]), [['h-9', '遠吠え', 621]]);
  });
  await t('J: 改行入り曲名の行を CSV に書いても1行のまま', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-')), 'hooks.csv');
    const r = parseHooksFromHtml(page(feed([hookObj('h-1', 's', 7, 1, 1, '上の句\r\n下の句')])));
    saveHooksData({ a: { success: true, found: true, hooks: r.hooks } }, '2026-11-01T00:00:00.000Z', file);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[1].includes('上の句 下の句'));
  });

  if (failed) { console.log(`\n${failed} 件失敗`); process.exit(1); }
  console.log('\n全部 ok');
})();
