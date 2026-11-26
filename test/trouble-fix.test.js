// node test/trouble-fix.test.js  （Discord・SUNOには一切触らない。待ちは差し替え）
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { withRetry, fetchNonEmptyWithRetry, API_RETRY_DELAYS_MS } = require('../src/retry');
const { buildPayload, notifyAnomalies, MENTION } = require('../src/notifier');
const { runDailyReportIfDue } = require('../src/daily-report');
const { detectAnomalies } = require('../src/anomaly-detector');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

(async () => {
  await t('再試行: 待ちは5秒→15秒の最大2回', () => {
    assert.deepStrictEqual(API_RETRY_DELAYS_MS, [5000, 15000]);
  });
  await t('再試行: 2回失敗→3回目成功（計3回・待ち5000,15000）', async () => {
    let n = 0; const waits = [];
    const r = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok'; }, { sleep: async (ms) => waits.push(ms) });
    assert.strictEqual(r, 'ok'); assert.strictEqual(n, 3); assert.deepStrictEqual(waits, [5000, 15000]);
  });
  await t('再試行: 全部失敗なら最後のエラー（計3回）', async () => {
    let n = 0;
    await assert.rejects(() => withRetry(async () => { n++; throw new Error('boom' + n); }, { sleep: async () => {} }), /boom3/);
    assert.strictEqual(n, 3);
  });
  await t('再試行: 1回で成功なら待たない', async () => {
    const waits = [];
    await withRetry(async () => 1, { sleep: async (ms) => waits.push(ms) });
    assert.strictEqual(waits.length, 0);
  });

  await t('API空(0曲)→再試行で回復（計2回・待ち5000）', async () => {
    let n = 0; const waits = [];
    const r = await fetchNonEmptyWithRetry(async () => (++n < 2 ? [] : [{ songId: 'a' }]), { sleep: async (ms) => waits.push(ms) });
    assert.strictEqual(r.length, 1); assert.strictEqual(n, 2); assert.deepStrictEqual(waits, [5000]);
  });
  await t('API 3回とも空 → 投げる（呼び出し側が DOM に移る）', async () => {
    let n = 0;
    await assert.rejects(() => fetchNonEmptyWithRetry(async () => { n++; return []; }, { sleep: async () => {} }), /0件/);
    assert.strictEqual(n, 3);
  });
  await t('DOM も0件 → 今どおり NO_SONGS（CSV は書かない＝上のテスト）', () => {
    const a = detectAnomalies({ x: { success: true, songs: [], songCount: 0, method: 'dom', timestamp: 't' } }, null, [], { x: new Set() });
    assert(a.some(v => v.type === 'NO_SONGS'), JSON.stringify(a));
  });

  await t('0件・フォロワー0は CSV に書かない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-'));
    const cfgPath = require.resolve('../config.json');
    // csv-store は data/ 固定のため、作業ツリーを汚さないよう cwd 依存ではなく一時コピーで検証
    const src = fs.readFileSync(require.resolve('../src/csv-store.js'), 'utf-8');
    fs.mkdirSync(path.join(dir, 'src')); fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'src', 'csv-store.js'), src);
    fs.copyFileSync(cfgPath, path.join(dir, 'config.json'));
    const cs = require(path.join(dir, 'src', 'csv-store.js'));
    const ts = '2026-11-27T00:00:00Z';
    const song = { songId: 's1', title: 'a', url: 'u', plays: 1, likes: 1, comments: 0 };
    const data = {
      zero: { success: true, songs: [], songCount: 0, timestamp: ts, followers: 5, following: 1 },
      nofol: { success: true, songs: [song], songCount: 1, timestamp: ts, followers: 0, following: 0 },
      good: { success: true, songs: [song], songCount: 1, timestamp: ts, followers: 5, following: 1 }
    };
    cs.saveSongsData(data); cs.saveFollowersData(data);
    assert(!fs.existsSync(path.join(dir, 'data', 'zero.csv')));
    const f = fs.readFileSync(path.join(dir, 'data', 'followers.csv'), 'utf-8').trim().split('\n');
    assert.strictEqual(f.length, 2); assert(f[1].includes(',good,'), f.join('|'));
    assert(fs.readFileSync(path.join(dir, 'data', 'nofol.csv'), 'utf-8').includes('s1')); // 曲は書く
  });

  await t('通知: トラブルだけメンション・日報は無し', async () => {
    const p1 = buildPayload(MENTION + 'x', true);
    assert.deepStrictEqual(p1.allowed_mentions, { users: ['982891457000136715'] });
    assert.deepStrictEqual(buildPayload('日報', false).allowed_mentions, { parse: [] });
    const calls = [];
    const send = async (m, o) => { calls.push([m, o]); return true; };
    await notifyAnomalies([{ type: 'NO_SONGS', severity: 'critical', artist: 'a', message: 'm' }], send);
    assert(calls[0][0].startsWith('<@982891457000136715> ') && calls[0][1].mention === true);
    await notifyAnomalies([{ type: 'NEW_SONG', severity: 'info', artist: 'a', songId: 'x', detail: { title: 't' } }], send);
    assert(!calls[1][0].includes('<@') && calls[1][1].mention === false);
    // 日報: send は message だけ渡される → mention 無し
    let got;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tf2-'));
    await runDailyReportIfDue({ now: new Date('2026-11-27T20:00:00Z'), dataDir: d, reportHour: 4, build: () => '日報本文', send: async (...a) => { got = a; return true; } });
    assert.deepStrictEqual(got, ['日報本文']);
    assert(!JSON.stringify(buildPayload(got[0], !!(got[1] || {}).mention)).includes('<@'));
  });

  if (failed) { console.log(`\n${failed} 件失敗`); process.exit(1); }
  console.log('\n全部成功');
})();
