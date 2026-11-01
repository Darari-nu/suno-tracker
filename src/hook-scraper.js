const https = require('https');

// SUNO の「フック（曲に付く短い動画）」の視聴数・いいね・コメントを、
// ログインなしの公開プロフィールページ https://suno.com/@{handle} から読む。
// ページには RSC の push 文字列として JSON が埋まっている（"entityType":"hook_schema"）。
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20000;
const WARN_HOOK_COUNT = 20;

const MARKER = '{"entityType":"hook_schema"';

/** JSON 文字列リテラル("...")を JSON.parse で復元する。壊れていたら null */
function decodeLiteral(lit) {
  try {
    const v = JSON.parse(lit);
    return typeof v === 'string' ? v : null;
  } catch (_) {
    return null;
  }
}

/**
 * `{`（または `[`）の位置から、文字列とエスケープを正しく扱って対応する閉じ括弧までを切り出す。閉じなければ null
 */
function sliceObject(text, start, open = '{', close = '}') {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * HTML 内の self.__next_f.push([1,"..."]) の文字列を全部復元して順につなぐ。
 * マーカーが出てこなければ、その段の中の文字列リテラルをさらに復元して探す（もう一段包まれている場合）。
 */
function extractFlight(html) {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let flight = '';
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const s = decodeLiteral(m[1]);
    if (s !== null) flight += s;
  }
  if (flight.includes(MARKER) || !flight.includes('hook_schema')) return flight;
  // もう一段: 文字列リテラルとして包まれている部分を復元して足す
  let inner = '';
  const lit = /"(?:[^"\\]|\\.)*"/g;
  while ((m = lit.exec(flight)) !== null) {
    if (!m[0].includes('hook_schema')) continue;
    const s = decodeLiteral(m[0]);
    if (s !== null) inner += s;
  }
  return inner;
}

/**
 * user_hooks feed の object を丸ごと切り出して JSON.parse し、その items 配列を返す（別の feed のフックを混ぜないため）。
 * feed object は `{"feedId":"user_hooks",...}` の形で始まる。そうでない形や items が配列でないものは使わない。
 * ページには同じ feed が2回出るので、見つかった分を全部返す。
 */
function userHooksItems(text) {
  const lists = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('"feedId":"user_hooks"', from);
    if (at < 0) break;
    from = at + 1;
    if (text[at - 1] !== '{') continue;
    const raw = sliceObject(text, at - 1);
    if (raw === null) continue;
    let feed;
    try { feed = JSON.parse(raw); } catch (_) { continue; }
    if (feed && feed.feedId === 'user_hooks' && Array.isArray(feed.items)) lists.push(feed.items);
  }
  return lists;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * HTML から hook を1本ずつ取り出す（純粋関数）。
 * push 文字列を JSON.parse で復元してつなぎ、user_hooks feed の object を括弧合わせで切り出して JSON.parse し、その items から読む。
 * 戻り値: { found, hooks: [{ hookId, songId, songTitle, views, likes, comments, createdAt }] }
 */
function parseHooksFromHtml(html) {
  const lists = userHooksItems(extractFlight(html));
  if (lists.length === 0) return { found: false, hooks: [] };

  const hooks = [];
  const seen = new Set();
  for (const items of lists) {
    for (const item of items) {
      // 実ページでは item.contentItem が hook。item そのものが hook の形も受ける
      const o = item && item.entityType === 'hook_schema' ? item
        : item && item.contentItem && item.contentItem.entityType === 'hook_schema' ? item.contentItem
        : null;
      if (!o || typeof o.id !== 'string') continue;
      // 数値が拾えない hook は捨てる（0 で埋めない）
      if (!isNum(o.viewCount) || !isNum(o.likeCount) || !isNum(o.commentCount)) continue;
      if (seen.has(o.id)) continue; // 同じ feed がページに2回出る
      seen.add(o.id);
      hooks.push({
        hookId: o.id,
        songId: typeof o.originalClipId === 'string' ? o.originalClipId : '',
        // 改行は空白にする（ダッシュボードの CSV 読み込みは引用符内の改行に対応していない）
        songTitle: o.clip && typeof o.clip.title === 'string' ? o.clip.title.replace(/[\r\n]+/g, ' ') : '',
        views: o.viewCount,
        likes: o.likeCount,
        comments: o.commentCount,
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : ''
      });
    }
  }
  return { found: true, hooks };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    let done = false;
    let deadline = null;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      fn(v);
    };
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: TIMEOUT_MS
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        finish(reject, new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => finish(resolve, body));
      res.on('error', (e) => finish(reject, e));
      res.on('aborted', () => finish(reject, new Error('通信が途中で切れた')));
    });
    // 無通信タイムアウトとは別に、通信全体を TIMEOUT_MS で打ち切る
    deadline = setTimeout(() => {
      finish(reject, new Error('タイムアウト'));
      req.destroy();
    }, TIMEOUT_MS);
    req.on('timeout', () => req.destroy(new Error('タイムアウト')));
    req.on('error', (e) => finish(reject, e));
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 1名義ぶんのフックを取る。失敗時は1回だけリトライ。例外は外へ出さない。
 * 戻り値: { success, found, hooks, error? }
 */
async function fetchHooks(handle) {
  const url = `https://suno.com/@${handle}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const html = await httpGet(url);
      const { found, hooks } = parseHooksFromHtml(html);
      if (hooks.length >= WARN_HOOK_COUNT) {
        console.warn(`[フック] ${handle}: ${hooks.length}本。ページに全部載っていないかもしれない`);
      }
      return { success: true, found, hooks };
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await sleep(2000);
    }
  }
  return { success: false, found: false, hooks: [], error: lastErr ? lastErr.message : '不明' };
}

/**
 * 名義ごとに順番に取る（間に1秒あける）。戻り値: { [handle]: result }
 */
async function fetchAllHooks(handles) {
  const out = {};
  for (let i = 0; i < handles.length; i++) {
    if (i > 0) await sleep(1000);
    out[handles[i]] = await fetchHooks(handles[i]);
  }
  return out;
}

module.exports = { parseHooksFromHtml, fetchHooks, fetchAllHooks };
