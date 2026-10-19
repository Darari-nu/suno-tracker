// node test/daily-report.test.js  （失敗時 exit 1。実データ・Discord・SUNOには一切触らない。fixtureは一時ディレクトリ）
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDailyReport, shouldSendDailyReport, runDailyReportIfDue, readState } = require('../src/daily-report');
const { appendRunLog, readRunLog } = require('../src/run-log');
const { notifyAnomalies, buildImmediateMessage } = require('../src/notifier');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

const H = 3600 * 1000;
const NOW = new Date('2026-10-19T19:05:00Z'); // JST 10/20 04:05
const iso = (ms) => new Date(ms).toISOString();
const at = (hoursAgo) => iso(NOW.getTime() - hoursAgo * H);
const SH = 'timestamp,artist,songId,title,url,plays,likes,comments,imageUrl,createdAt';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dr-test-')); }

// snaps: [{hoursAgo, songs:{id:[title,plays]}}]
function writeSongs(dir, artist, snaps) {
  const lines = [SH];
  for (const s of snaps) {
    for (const [id, [title, plays]] of Object.entries(s.songs)) {
      lines.push(`${at(s.hoursAgo)},${artist},${id},${title},https://suno.com/song/${id},${plays},1,0,,`);
    }
  }
  fs.writeFileSync(path.join(dir, `${artist}.csv`), lines.join('\n') + '\n');
}
function writeFollowers(dir, rows) { // [{hoursAgo, artist, n}]
  const lines = ['timestamp,artist,followers,following'];
  for (const r of rows) lines.push(`${at(r.hoursAgo)},${r.artist},${r.n},10`);
  fs.writeFileSync(path.join(dir, 'followers.csv'), lines.join('\n') + '\n');
}
function writeTrends(dir, rows) { // [{hoursAgo, region, period, artist, title, rank}]
  const lines = ['timestamp,region,period,artist,songId,title,rank,plays,likes'];
  for (const r of rows) lines.push(`${at(r.hoursAgo)},${r.region},${r.period},${r.artist || '-'},${r.artist ? 'x' : '-'},${r.title || '-'},${r.rank || 0},0,0`);
  fs.writeFileSync(path.join(dir, 'trends.csv'), lines.join('\n') + '\n');
}
function writeRuns(dir, runs) { // [{hoursAgo, artists:{name:[success,method]}, anomalies}]
  for (const r of runs) {
    const artists = {};
    for (const [n, [s, m]] of Object.entries(r.artists)) artists[n] = { success: s, method: m, songCount: 3 };
    appendRunLog({ ts: at(r.hoursAgo), artists, anomalies: r.anomalies || [] }, { dataDir: dir, nowMs: NOW.getTime() });
  }
}
const okRuns = (n) => Array.from({ length: n }, (_, i) => ({ hoursAgo: 1 + i * 3, artists: { darari_nu: [true, 'api'], coban3137: [true, 'api'] } }));

// 7日分の日次スナップショット(k日前 = k*24h前)。dailyGrowth[k]=その日の伸び(日k-1→日k)ではなく、
// 日0(=24h前)からの累積を作る: 24h前 = base, 以降 base - sum(...)
function dailySnaps(base, perDay, todayGrowth, extra = {}) {
  // 時刻: 0.5h前(最新)=base+todayGrowth, 24h前=base, 48h前=base-perDay ...
  const snaps = [{ hoursAgo: 0.5, songs: { s1: ['曲A', base + todayGrowth], ...extra } }];
  for (let k = 1; k <= 7; k++) snaps.push({ hoursAgo: 24 * k, songs: { s1: ['曲A', base - perDay * (k - 1)] } });
  return snaps;
}

(async () => {
  await t('G: 正常日', () => {
    const d = mkDir();
    writeSongs(d, 'darari_nu', dailySnaps(10000, 100, 100));
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    writeFollowers(d, [{ hoursAgo: 0.5, artist: 'darari_nu', n: 946 }, { hoursAgo: 24, artist: 'darari_nu', n: 944 }]);
    writeRuns(d, okRuns(8));
    const r = buildDailyReport({ now: NOW, dataDir: d });
    assert(r.includes('✅ データ取得：正常（8回中8回成功）'), r);
    assert(r.includes('🆕 新曲：なし'), r);
    assert(r.includes('いつも通り'), r);
    assert(r.includes('946（+2）'), r);
    assert(r.length <= 2000);
  });

  await t('H: 伸びた日3.0倍 / 少ない日📉', () => {
    const d = mkDir();
    writeSongs(d, 'darari_nu', dailySnaps(10000, 100, 300));
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 20));
    writeRuns(d, okRuns(8));
    const r = buildDailyReport({ now: NOW, dataDir: d });
    assert(r.includes('📈 いつもの3.0倍'), r);
    assert(r.includes('📉'), r);
  });

  await t('I: 新曲(窓内初出は出る/CSV最初のスナップショットは出ない)', () => {
    const d = mkDir();
    const snaps = dailySnaps(10000, 100, 100, { newone: ['ニューソング', 5] });
    snaps[snaps.length - 1].songs.old1 = ['最初からいた曲', 50]; // 最古スナップショットに存在
    snaps.forEach(s => { if (s.hoursAgo !== 0.5) s.songs.old1 = ['最初からいた曲', 50]; });
    writeSongs(d, 'darari_nu', snaps);
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    writeRuns(d, okRuns(8));
    const r = buildDailyReport({ now: NOW, dataDir: d });
    assert(r.includes('🆕 新曲：「ニューソング」(Dara)'), r);
    assert(!r.includes('最初からいた曲」'), r);
    // 最初のTSだけで初出した曲(s1以外のsX)は新曲扱いにならない
    assert(!r.includes('「曲A」'), r);
  });

  await t('J: 失敗1回・dom1回', () => {
    const d = mkDir();
    writeSongs(d, 'darari_nu', dailySnaps(10000, 100, 100));
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    const runs = okRuns(8);
    runs[2].artists.darari_nu = [false, undefined];
    runs[4].artists.coban3137 = [true, 'dom'];
    writeRuns(d, runs);
    const r = buildDailyReport({ now: NOW, dataDir: d });
    assert(r.includes('⚠️ データ取得：8回中1回失敗／1回は予備方式'), r);
  });

  await t('J2: run-logが空 → 実行記録なし', () => {
    const d = mkDir();
    writeSongs(d, 'darari_nu', dailySnaps(10000, 100, 100));
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    const r = buildDailyReport({ now: NOW, dataDir: d });
    assert(r.includes('実行記録なし（CSVには記録あり）'), r);
  });

  await t('K: フォロワー減少', () => {
    const d = mkDir();
    writeSongs(d, 'darari_nu', dailySnaps(10000, 100, 100));
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    writeFollowers(d, [{ hoursAgo: 0.5, artist: 'coban3137', n: 1601 }, { hoursAgo: 24, artist: 'coban3137', n: 1604 }]);
    writeRuns(d, okRuns(8));
    const r = buildDailyReport({ now: NOW, dataDir: d });
    assert(r.includes('⚠️ −3'), r);
  });

  await t('L: 前日の曲数が多い(取得異常)→共通曲だけで差', () => {
    const d = mkDir();
    // 最新は曲A(10100)のみ(1曲)。24h前は曲A(10000)+曲B(5000)の2曲。過去も同様に2曲。
    const snaps = [{ hoursAgo: 0.5, songs: { s1: ['曲A', 10100] } }];
    for (let k = 1; k <= 7; k++) snaps.push({ hoursAgo: 24 * k, songs: { s1: ['曲A', 10000 - 100 * (k - 1)], s2: ['曲B', 5000] } });
    writeSongs(d, 'darari_nu', snaps);
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    writeRuns(d, okRuns(8));
    const r = buildDailyReport({ now: NOW, dataDir: d });
    const line = r.split('\n').find(l => l.includes('総再生') && l.includes('10,100'));
    assert(line, r);
    assert(line.includes('（+100）'), line);
    assert(!line.includes('−'), line);
  });

  await t('M: 日報送信判定', async () => {
    const jst = (s) => new Date(s + '+09:00');
    assert.strictEqual(shouldSendDailyReport({ now: jst('2026-10-20T03:59:00'), state: { lastSentDateJst: '2026-10-19' } }), false);
    assert.strictEqual(shouldSendDailyReport({ now: jst('2026-10-20T04:05:00'), state: { lastSentDateJst: '2026-10-19' } }), true);
    assert.strictEqual(shouldSendDailyReport({ now: jst('2026-10-20T08:00:00'), state: { lastSentDateJst: '2026-10-20' } }), false);
    // UTCでは前日19:05 = JST 翌4:05 でも送る
    assert.strictEqual(shouldSendDailyReport({ now: new Date('2026-10-19T19:05:00Z'), state: { lastSentDateJst: '2026-10-19' } }), true);

    const d = mkDir();
    writeSongs(d, 'darari_nu', dailySnaps(10000, 100, 100));
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    let calls = 0;
    const build = () => 'REPORT';
    // 失敗 → state更新なし
    let r1 = await runDailyReportIfDue({ now: NOW, dataDir: d, send: async () => { calls++; return false; }, build });
    assert.strictEqual(r1.sent, false);
    assert.strictEqual(readState(d).lastSentDateJst, undefined);
    // 成功 → 更新
    r1 = await runDailyReportIfDue({ now: NOW, dataDir: d, send: async () => { calls++; return true; }, build });
    assert.strictEqual(r1.sent, true);
    assert.strictEqual(readState(d).lastSentDateJst, '2026-10-20');
    // 同日2回目は送らない
    r1 = await runDailyReportIfDue({ now: new Date(NOW.getTime() + 3 * H), dataDir: d, send: async () => { calls++; return true; }, build });
    assert.strictEqual(r1.sent, false);
    assert.strictEqual(calls, 2);
  });

  await t('N: 即時通知の振り分け', async () => {
    const sent = [];
    const send = async (m) => { sent.push(m); return true; };
    await notifyAnomalies([{ type: 'STALE_DATA', severity: 'info', artist: 'darari_nu', message: 'x' }], send);
    assert.strictEqual(sent.length, 0);
    await notifyAnomalies([{ type: 'PLAY_COUNT_DECREASE', severity: 'warning', artist: 'darari_nu', message: 'x' }, { type: 'TREND_ERROR', severity: 'warning', message: 'y' }], send);
    assert.strictEqual(sent.length, 0);
    await notifyAnomalies([{ type: 'NEW_SONG', severity: 'info', artist: 'coban3137', songId: 'a', detail: { title: 'テスト曲' } }, { type: 'STALE_DATA', severity: 'info', artist: 'coban3137', message: 'z' }], send);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0], '🆕 新曲：「テスト曲」(coban)');
    await notifyAnomalies([{ type: 'FETCH_ERROR', severity: 'critical', artist: 'darari_nu', message: '失敗' }, { type: 'STALE_DATA', severity: 'info', artist: 'x', message: 'stale-msg' }], send);
    assert.strictEqual(sent.length, 2);
    assert(sent[1].startsWith('<@982891457000136715> 🔔 **SUNO Tracker 異常検知**'), sent[1]);
    assert(sent[1].includes('失敗') && !sent[1].includes('stale-msg'), sent[1]);
    // 異常のみ(メンション無し)
    const m = buildImmediateMessage([{ type: 'API_FALLBACK', severity: 'warning', artist: 'a', message: 'fb' }]);
    assert(m.startsWith('🔔') && !m.includes('<@'), m);
  });

  await t('注意行 / run-log 30日削除・壊れ行', () => {
    const d = mkDir();
    writeSongs(d, 'darari_nu', dailySnaps(10000, 100, 100));
    writeSongs(d, 'coban3137', dailySnaps(20000, 200, 200));
    const runs = okRuns(3);
    runs[0].anomalies = [{ type: 'TREND_ERROR', severity: 'warning', message: 'a' }, { type: 'TREND_ERROR', severity: 'warning', message: 'b' }, { type: 'PLAY_COUNT_DECREASE', severity: 'warning', message: 'c' }, { type: 'FETCH_ERROR', severity: 'critical', message: 'd' }];
    writeRuns(d, runs);
    fs.appendFileSync(path.join(d, 'run-log.jsonl'), '{broken\n');
    const r = buildDailyReport({ now: NOW, dataDir: d });
    assert(r.includes('ℹ️ 注意：トレンド一時エラー2回、再生数減少1件'), r);
    appendRunLog({ ts: iso(NOW.getTime() - 40 * 24 * H), artists: {}, anomalies: [] }, { dataDir: d, nowMs: NOW.getTime() - 40 * 24 * H });
    appendRunLog({ ts: at(0), artists: {}, anomalies: [] }, { dataDir: d, nowMs: NOW.getTime() });
    const all = readRunLog(0, { dataDir: d });
    assert(all.every(x => Date.parse(x.ts) > NOW.getTime() - 31 * 24 * H));
    assert.deepStrictEqual(readRunLog(0, { dataDir: path.join(d, 'none') }), []);
  });

  if (failed) { console.log(`\n${failed} 件失敗`); process.exit(1); }
  console.log('\n全部成功');
})();
