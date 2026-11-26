const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

/** API失敗時の再試行までの待ち時間（ミリ秒）。5秒→15秒の最大2回再試行 */
const API_RETRY_DELAYS_MS = [5000, 15000];

/**
 * fn() が例外を投げたら、delays の数だけ待って再試行する。全部失敗したら最後のエラーを投げる。
 * @param {Function} fn
 * @param {{delays?: number[], sleep?: Function, onRetry?: Function}} [opts] - テストでは sleep を差し替える
 */
async function withRetry(fn, { delays = API_RETRY_DELAYS_MS, sleep = defaultSleep, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length) {
        if (onRetry) onRetry(err, attempt + 1, delays[attempt]);
        await sleep(delays[attempt]);
      }
    }
  }
  throw lastErr;
}

/**
 * API が HTTP 成功でも曲0件なら「失敗」とみなして再試行する（一時的な空応答対策）。
 * 全部空 or 全部失敗なら最後のエラーを投げ、呼び出し側が DOM 予備に回す。
 */
async function fetchNonEmptyWithRetry(fn, opts) {
  return withRetry(async () => {
    const songs = await fn();
    if (!songs || songs.length === 0) throw new Error('APIが曲0件を返した');
    return songs;
  }, opts);
}

module.exports = { fetchNonEmptyWithRetry, withRetry, API_RETRY_DELAYS_MS };
