const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', 'data');
const RUN_LOG_NAME = 'run-log.jsonl';
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

function logPath(dataDir) {
  return path.join(dataDir || DEFAULT_DATA_DIR, RUN_LOG_NAME);
}

function parseLines(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push(row);
    } catch (_) { /* 壊れた行は飛ばす */ }
  }
  return rows;
}

/**
 * 実行結果を1行追記する。30日より古い行は追記時に落とす。
 * entry: { ts, artists: { [name]: { success, method, songCount } }, anomalies: [{ type, severity, artist?, message }] }
 * options: { dataDir, nowMs }
 */
function appendRunLog(entry, options = {}) {
  const file = logPath(options.dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const nowMs = options.nowMs !== undefined ? options.nowMs : Date.now();
  const cutoff = nowMs - RETAIN_MS;

  let kept = [];
  if (fs.existsSync(file)) {
    kept = parseLines(fs.readFileSync(file, 'utf-8')).filter(r => {
      const t = Date.parse(r.ts);
      return Number.isNaN(t) ? false : t >= cutoff;
    });
  }
  kept.push(entry);
  fs.writeFileSync(file, kept.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

/**
 * sinceMs 以降の行を配列で返す。壊れた行は飛ばす。ファイルが無ければ []。
 */
function readRunLog(sinceMs, options = {}) {
  const file = logPath(options.dataDir);
  if (!fs.existsSync(file)) return [];
  return parseLines(fs.readFileSync(file, 'utf-8')).filter(r => {
    const t = Date.parse(r.ts);
    return !Number.isNaN(t) && t >= (sinceMs || 0);
  });
}

module.exports = { appendRunLog, readRunLog, DEFAULT_DATA_DIR };
