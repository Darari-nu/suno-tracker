// data/latest.json: 最新の時点だけの小さな JSON（Rondo が読む）。
// 取得に成功した回だけ書き直す。失敗・0件・一部欠けの回は前のファイルを残す（0 や欠けで上書きしない）。
const fs = require('fs');
const path = require('path');

const LATEST_FILE = path.resolve(__dirname, '..', 'data', 'latest.json');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * artistData: scrapeAllArtists() の結果（saveSongsData に渡すものと同じ）
 * hooksByArtist: fetchAllHooks() の結果 { [name]: { success, found, hooks } }
 * artistNames: 揃っていなければならないアーティスト名（config.artists）
 * previous: 前回の latest.json の中身（フックの取得に失敗した名義だけ前の値を引き継ぐ）
 * 戻り値: 書くべき JSON のオブジェクト。書かない回は null。
 */
function buildLatestSnapshot({ artistData, hooksByArtist = {}, artistNames, now = new Date(), previous = null }) {
  const names = artistNames || Object.keys(artistData || {});
  if (!artistData || names.length === 0) return null;

  const prevByName = {};
  if (previous && Array.isArray(previous.artists)) {
    for (const a of previous.artists) if (a && a.name) prevByName[a.name] = a;
  }

  const artists = [];
  for (const name of names) {
    const d = artistData[name];
    // 既存の「0 件は記録しない」と同じ判断。1 名義でも欠けたら全体を書かない
    if (!d || !d.success || !Array.isArray(d.songs) || d.songs.length === 0) return null;

    const hasFollowers = !!(d.followers || d.following);
    const songs = d.songs.map((s) => ({
      songId: s.songId,
      title: s.title,
      url: s.url,
      plays: num(s.plays),
      likes: num(s.likes),
      comments: num(s.comments),
      createdAt: s.createdAt || ''
    }));

    const h = hooksByArtist[name];
    let hooks;
    if (h && h.success && h.found) {
      hooks = h.hooks.map((x) => ({
        hookId: x.hookId,
        songId: x.songId,
        songTitle: x.songTitle,
        views: num(x.views),
        likes: num(x.likes),
        comments: num(x.comments),
        createdAt: x.createdAt || ''
      }));
    } else {
      hooks = (prevByName[name] && prevByName[name].hooks) || [];
    }

    artists.push({
      name,
      followers: hasFollowers ? num(d.followers) : null,
      following: hasFollowers ? num(d.following) : null,
      songs,
      hooks
    });
  }
  return { generatedAt: now.toISOString(), artists };
}

function readPrevious(filePath = LATEST_FILE) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

/** 作れたときだけ書く。書いたら true */
function writeLatestSnapshot(args, filePath = LATEST_FILE) {
  const snap = buildLatestSnapshot({ previous: readPrevious(filePath), ...args });
  if (!snap) {
    console.warn('[latest] 取得が揃っていないため latest.json を書き直さない（前のファイルを残す）');
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snap, null, 1) + '\n', 'utf-8');
  console.log(`[latest] latest.json 更新: ${snap.artists.map((a) => `${a.name} 曲${a.songs.length}/フック${a.hooks.length}`).join(', ')}`);
  return true;
}

module.exports = { buildLatestSnapshot, writeLatestSnapshot, readPrevious, LATEST_FILE };
