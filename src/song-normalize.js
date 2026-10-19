/**
 * DOM から拾ったリンク候補を曲リストに正規化する（純粋関数・テスト可能）。
 * - href に `?` を含むリンク（show_comments 等）は曲として扱わない
 * - songId は `/song/` の後ろを `?` `#` の手前で切る。空なら捨てる
 * - 同じ songId は最初の1件だけ残す
 * - url は https://suno.com/song/<id> に正規化
 * @param {Array<{href: string}>} items
 */
function normalizeDomSongs(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const href = String(item.href || '');
    if (href.includes('?')) continue;
    const rest = href.split('/song/')[1];
    if (rest === undefined) continue;
    const songId = rest.split(/[?#]/)[0].replace(/\/+$/, '');
    if (!songId || seen.has(songId)) continue;
    seen.add(songId);
    const { href: _h, ...rest2 } = item;
    out.push({ ...rest2, songId, url: `https://suno.com/song/${songId}` });
  }
  return out;
}

module.exports = { normalizeDomSongs };
