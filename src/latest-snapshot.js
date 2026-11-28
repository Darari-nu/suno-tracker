// data/latest.json: 最新の時点だけの小さな JSON（Rondo が読む）。
// 取得に成功した回だけ書き直す。失敗・0件・一部欠けの回は前のファイルを残す（0 や欠けで上書きしない）。
const fs = require('fs');
const path = require('path');

const LATEST_FILE = path.resolve(__dirname, '..', 'data', 'latest.json');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// 取れなかったものは 0 にせず null
const cnt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * artistData: scrapeAllArtists() の結果（saveSongsData に渡すものと同じ）
 * hooksByArtist: fetchAllHooks() の結果 { [name]: { success, found, hooks } }
 * artistNames: 揃っていなければならないアーティスト名（config.artists）
 * 戻り値: 書くべき JSON のオブジェクト。書かない回は null。
 */
function buildLatestSnapshot({ artistData, hooksByArtist = {}, artistNames, now = new Date() }) {
  const names = artistNames || Object.keys(artistData || {});
  if (!artistData || names.length === 0) return null;

  const artists = [];
  for (const name of names) {
    const d = artistData[name];
    // 既存の「0 件は記録しない」と同じ判断。1 名義でも欠けたら全体を書かない
    if (!d || !d.success || !Array.isArray(d.songs) || d.songs.length === 0) return null;

    // 曲の一覧を最後まで取り切れたと分かった回だけ（API 方式の complete 印）
    if (d.complete !== true) return null;

    const songs = [];
    for (const s of d.songs) {
      const raw = s.rawCounts || { plays: s.plays, likes: s.likes, comments: s.comments };
      const plays = cnt(raw.plays);
      // plays が取れていない曲が 1 つでもあれば、その回は書かない
      if (plays === null) return null;
      songs.push({
        songId: s.songId,
        title: s.title,
        url: s.url,
        plays,
        likes: cnt(raw.likes),
        comments: cnt(raw.comments),
        createdAt: s.createdAt || ''
      });
    }
    const followers = cnt('rawFollowers' in d ? d.rawFollowers : d.followers);
    const following = cnt('rawFollowing' in d ? d.rawFollowing : d.following);

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
      hooks = null; // この回はフックを更新していない（前回の値は持ち越さない）
    }

    artists.push({
      name,
      followers,
      following,
      songs,
      hooks
    });
  }
  return { generatedAt: now.toISOString(), artists };
}

/** 作れたときだけ書く。書いたら true */
function writeLatestSnapshot(args, filePath = LATEST_FILE) {
  const snap = buildLatestSnapshot(args);
  if (!snap) {
    console.warn('[latest] 取得が揃っていないため latest.json を書き直さない（前のファイルを残す）');
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // 原子的に: 一時ファイルに書いてから rename（途中で失敗しても旧版を壊さない）
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(snap, null, 1) + '\n', 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    // 一時ファイルを残さない（Actions の git add data/ で公開されないように）
    try { fs.unlinkSync(tmpPath); } catch { /* 無ければよい */ }
    throw e;
  }
  console.log(`[latest] latest.json 更新: ${snap.artists.map((a) => `${a.name} 曲${a.songs.length}/フック${a.hooks === null ? '未更新' : a.hooks.length}`).join(', ')}`);
  return true;
}

module.exports = { buildLatestSnapshot, writeLatestSnapshot, LATEST_FILE };
