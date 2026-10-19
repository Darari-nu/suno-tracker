const fs = require('fs');
const path = require('path');
const { readRunLog, DEFAULT_DATA_DIR } = require('./run-log');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TOLERANCE = 3 * HOUR;
const JST_OFFSET = 9 * HOUR;
const STATE_NAME = 'daily-report-state.json';
const DISPLAY_NAMES = { darari_nu: 'Dara', coban3137: 'coban' };
const DEFAULT_ARTISTS = ['darari_nu', 'coban3137'];

function artistDisplay(name) {
  return DISPLAY_NAMES[name] || name;
}

// ---------- JST ----------
function jstParts(now) {
  const d = new Date(new Date(now).getTime() + JST_OFFSET);
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    hm: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  };
}

// ---------- CSV ----------
function parseCSVLine(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const fields = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

function readCsvRows(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    rows.push(parseCSVLine(lines[i]));
  }
  return rows;
}

function normId(id) {
  return String(id || '').split(/[?#]/)[0];
}

/** アーティストCSV → スナップショット配列（時刻昇順）。{ t, plays: Map(id→plays), titles: Map(id→title) } */
function loadSnapshots(dataDir, artist) {
  const rows = readCsvRows(path.join(dataDir, `${artist}.csv`));
  const byTs = new Map();
  for (const f of rows) {
    const t = Date.parse(f[0]);
    if (Number.isNaN(t)) continue;
    const id = normId(f[2]);
    if (!id) continue;
    let snap = byTs.get(f[0]);
    if (!snap) { snap = { t, plays: new Map(), titles: new Map() }; byTs.set(f[0], snap); }
    const plays = parseInt(f[5], 10) || 0;
    // DOMフォールバックの `?` 付き重複は二重計上しない
    if (!snap.plays.has(id) || plays > snap.plays.get(id)) snap.plays.set(id, plays);
    if (!snap.titles.has(id)) snap.titles.set(id, f[3]);
  }
  return [...byTs.values()].sort((a, b) => a.t - b.t);
}

function loadFollowers(dataDir, artist) {
  return readCsvRows(path.join(dataDir, 'followers.csv'))
    .filter(f => f[1] === artist)
    .map(f => ({ t: Date.parse(f[0]), followers: parseInt(f[2], 10) || 0 }))
    .filter(r => !Number.isNaN(r.t))
    .sort((a, b) => a.t - b.t);
}

function nearest(items, target, tol = TOLERANCE) {
  let best = null;
  let bestD = Infinity;
  for (const it of items) {
    const d = Math.abs(it.t - target);
    if (d <= tol && d < bestD) { best = it; bestD = d; }
  }
  return best;
}

function latestAtOrBefore(items, nowMs) {
  let best = null;
  for (const it of items) if (it.t <= nowMs) best = it;
  return best;
}

function sumPlays(map) {
  let s = 0;
  for (const v of map.values()) s += v;
  return s;
}

/** b(前) → a(後) の総再生の差。a の曲数が b より少ないときは共通 songId だけで比べる */
function playsDiff(a, b) {
  if (a.plays.size < b.plays.size) {
    let d = 0;
    for (const [id, p] of a.plays) if (b.plays.has(id)) d += p - b.plays.get(id);
    return d;
  }
  return sumPlays(a.plays) - sumPlays(b.plays);
}

function topGrowers(a, b, n = 2) {
  const list = [];
  for (const [id, p] of a.plays) {
    if (!b.plays.has(id)) continue;
    const d = p - b.plays.get(id);
    if (d > 0) list.push({ title: a.titles.get(id) || id, diff: d });
  }
  return list.sort((x, y) => y.diff - x.diff).slice(0, n);
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : '±0');

// ---------- 各セクション ----------
function acquisitionLine(runs, anyCsvInWindow) {
  if (runs.length === 0) {
    return `ℹ️ データ取得：実行記録なし${anyCsvInWindow ? '（CSVには記録あり）' : ''}`;
  }
  let failed = 0;
  let dom = 0;
  const detail = {};
  for (const r of runs) {
    let rf = false;
    let rd = false;
    for (const [name, a] of Object.entries(r.artists || {})) {
      const d = detail[name] || (detail[name] = { fail: 0, dom: 0 });
      if (!a || a.success === false) { rf = true; d.fail++; }
      else if (a.method === 'dom') { rd = true; d.dom++; }
    }
    if (rf) failed++;
    else if (rd) dom++;
  }
  const total = runs.length;
  if (failed === 0 && dom === 0) return `✅ データ取得：正常（${total}回中${total}回成功）`;
  const parts = Object.entries(detail)
    .filter(([, d]) => d.fail || d.dom)
    .map(([n, d]) => `${artistDisplay(n)}${d.fail ? ` 失敗${d.fail}` : ''}${d.dom ? ` 予備${d.dom}` : ''}`);
  return `⚠️ データ取得：${total}回中${failed}回失敗／${dom}回は予備方式（${parts.join('、')}）`;
}

function newSongsLine(dataDir, artists, nowMs) {
  const found = [];
  for (const artist of artists) {
    const snaps = loadSnapshots(dataDir, artist);
    if (snaps.length === 0) continue;
    const firstTs = snaps[0].t;
    const seen = new Set();
    for (const s of snaps) {
      for (const id of s.plays.keys()) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (s.t === firstTs) continue; // CSV最初のスナップショットは導入時の全曲
        if (s.t > nowMs - DAY && s.t <= nowMs) {
          found.push(`「${s.titles.get(id) || id}」(${artistDisplay(artist)})`);
        }
      }
    }
  }
  return found.length === 0 ? '🆕 新曲：なし' : `🆕 新曲：${found.join('、')}`;
}

function artistSection(dataDir, artist, nowMs) {
  const name = artistDisplay(artist);
  const lines = [`**${name}**`];
  let growers = null;

  const snaps = loadSnapshots(dataDir, artist).filter(s => s.t <= nowMs);
  const latest = snaps[snaps.length - 1];
  if (!latest) {
    lines.push('・総再生：データなし');
  } else {
    const total = sumPlays(latest.plays);
    const prev = nearest(snaps, nowMs - DAY);
    if (!prev || prev === latest) {
      lines.push(`・総再生 ${fmt(total)}（比較なし）`);
    } else {
      const growth = playsDiff(latest, prev);
      // 過去7日の「いつも通り」基準
      const pts = [];
      for (let k = 1; k <= 7; k++) pts.push(nearest(snaps, nowMs - k * DAY));
      const diffs = [];
      for (let k = 0; k < pts.length - 1; k++) {
        if (pts[k] && pts[k + 1] && pts[k] !== pts[k + 1]) diffs.push(playsDiff(pts[k], pts[k + 1]));
      }
      let verdict = '';
      if (diffs.length >= 3) {
        const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        if (avg > 0) {
          const ratio = growth / avg;
          if (ratio > 2) verdict = ` 📈 いつもの${ratio.toFixed(1)}倍`;
          else if (ratio < 0.5) verdict = ' 📉 いつもより少なめ';
          else verdict = ' いつも通り';
        }
      }
      lines.push(`・総再生 ${fmt(total)}（${signed(growth)}）${verdict}`);
      growers = topGrowers(latest, prev);
    }
  }

  const fol = loadFollowers(dataDir, artist).filter(r => r.t <= nowMs);
  const fl = fol[fol.length - 1];
  if (fl) {
    const fp = nearest(fol, nowMs - DAY);
    if (!fp || fp === fl) lines.push(`・フォロワー ${fmt(fl.followers)}（比較なし）`);
    else {
      const d = fl.followers - fp.followers;
      const ds = d > 0 ? `+${d}` : d < 0 ? `⚠️ −${Math.abs(d)}` : '±0';
      lines.push(`・フォロワー ${fmt(fl.followers)}（${ds}）`);
    }
  }

  return { text: lines.join('\n'), growers: growers && growers.length ? `・よく伸びた曲：${growers.map(g => `${g.title} ${signed(g.diff)}`).join('、')}` : null };
}

function trendsLine(dataDir, nowMs) {
  const rows = readCsvRows(path.join(dataDir, 'trends.csv'))
    .map(f => ({ ts: f[0], t: Date.parse(f[0]), period: f[2], artist: f[3], title: f[5], rank: f[6] }))
    .filter(r => !Number.isNaN(r.t) && r.t <= nowMs);
  if (rows.length === 0) return '🏆 トレンド：ランクインなし';
  const maxT = Math.max(...rows.map(r => r.t));
  const hits = rows.filter(r => r.t === maxT && r.artist !== '-');
  if (hits.length === 0) return '🏆 トレンド：ランクインなし';
  return `🏆 トレンド：${hits.map(r => `${r.title} ${r.rank}位（${r.period}）`).join('、')}`;
}

const NOTICE_LABELS = {
  STALE_DATA: ['データ更新なし', '回'],
  TREND_ERROR: ['トレンド一時エラー', '回'],
  TREND_RETRY_RECOVERED: ['トレンドリトライ回復', '回'],
  PLAY_COUNT_DECREASE: ['再生数減少', '件']
};

function noticeLine(runs, immediateTypes) {
  const counts = {};
  for (const r of runs) {
    for (const a of r.anomalies || []) {
      if (!a || !a.type || immediateTypes.includes(a.type)) continue;
      counts[a.type] = (counts[a.type] || 0) + 1;
    }
  }
  const parts = Object.entries(counts).map(([type, n]) => {
    const [label, unit] = NOTICE_LABELS[type] || [type, '件'];
    return `${label}${n}${unit}`;
  });
  return parts.length ? `ℹ️ 注意：${parts.join('、')}` : null;
}

// ---------- 日報本体 ----------
function resolveArtists(dataDir, opt) {
  if (opt && opt.length) return opt;
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dataDir, 'artists.json'), 'utf-8'));
    const names = list.map(a => a.name).filter(Boolean);
    if (names.length) return names;
  } catch (_) { /* フォールバック */ }
  return DEFAULT_ARTISTS;
}

/**
 * Discord本文を返す。CSVとrun-logを読むだけで、送信も書き込みもしない。
 * options: { now: Date, dataDir, artists, immediateTypes }
 */
function buildDailyReport(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const nowMs = now.getTime();
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const artists = resolveArtists(dataDir, options.artists);
  const immediateTypes = options.immediateTypes || require('./notifier').IMMEDIATE_TYPES;

  const runs = readRunLog(nowMs - DAY, { dataDir }).filter(r => Date.parse(r.ts) <= nowMs);

  let anyCsv = false;
  for (const a of artists) {
    if (loadSnapshots(dataDir, a).some(s => s.t > nowMs - DAY && s.t <= nowMs)) { anyCsv = true; break; }
  }

  const jst = jstParts(now);
  const head = `📊 **SUNO Tracker 日報** ${jst.date} ${jst.hm} JST（直近24時間）`;
  const acq = acquisitionLine(runs, anyCsv);
  const songs = newSongsLine(dataDir, artists, nowMs);
  const sections = artists.map(a => artistSection(dataDir, a, nowMs));
  const trend = trendsLine(dataDir, nowMs);
  const notice = noticeLine(runs, immediateTypes);

  const compose = (withGrowers, withTrend) => {
    const out = [head, acq, songs, ''];
    for (const s of sections) {
      out.push(s.text);
      if (withGrowers && s.growers) out.push(s.growers);
      out.push('');
    }
    if (withTrend) out.push(trend);
    if (notice) out.push(notice);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  let text = compose(true, true);
  if (text.length > 2000) text = compose(false, true);
  if (text.length > 2000) text = compose(false, false);
  if (text.length > 2000) text = text.slice(0, 2000);
  return text;
}

// ---------- 送信判定 ----------
function statePath(dataDir) {
  return path.join(dataDir || DEFAULT_DATA_DIR, STATE_NAME);
}

function readState(dataDir) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(dataDir), 'utf-8'));
    return s && typeof s === 'object' ? s : {};
  } catch (_) {
    return {};
  }
}

function writeState(dataDir, state) {
  fs.mkdirSync(path.dirname(statePath(dataDir)), { recursive: true });
  fs.writeFileSync(statePath(dataDir), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/** JSTで reportHour 時以降、かつ今日(JST)まだ送っていなければ true */
function shouldSendDailyReport({ now, state, reportHour = 4 }) {
  const jst = jstParts(now);
  if (jst.hour < reportHour) return false;
  return !state || state.lastSentDateJst !== jst.date;
}

/**
 * 日報が必要なら作って送る。送信成功時のみ state を保存する。
 * options: { now, dataDir, reportHour, send(message)→Promise<boolean>, build(opts)→string }
 */
async function runDailyReportIfDue(options) {
  const now = options.now ? new Date(options.now) : new Date();
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const state = readState(dataDir);
  if (!shouldSendDailyReport({ now, state, reportHour: options.reportHour })) {
    return { sent: false, reason: 'not-due' };
  }
  const build = options.build || buildDailyReport;
  const message = build({ now, dataDir, artists: options.artists });
  const ok = await options.send(message);
  if (!ok) return { sent: false, reason: 'send-failed', message };
  writeState(dataDir, { lastSentDateJst: jstParts(now).date });
  return { sent: true, reason: 'sent', message };
}

module.exports = {
  buildDailyReport, shouldSendDailyReport, runDailyReportIfDue,
  readState, writeState, jstParts, artistDisplay
};
