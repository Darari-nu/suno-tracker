const https = require('https');

// dispatch先（vocal-srt-generator）。環境変数でオーバーライド可能。
const DISPATCH_REPO = process.env.VOCAL_SRT_REPO || 'Darari-nu/260525_vocal-srt-generator';

/**
 * 新曲を vocal-srt-generator の GitHub Actions へ dispatch し、SRT自動生成をトリガーする。
 * REPO_ACCESS_TOKEN が未設定なら何もしない（ローカル実行時など）。
 * @param {Array<{songId: string, handle: string, songName: string, title: string, lyrics: string}>} songs
 */
async function dispatchSrtGeneration(songs) {
  if (!songs || songs.length === 0) return;

  const token = process.env.REPO_ACCESS_TOKEN;
  if (!token) {
    console.log('[srt-dispatcher] REPO_ACCESS_TOKEN 未設定のため SRT自動生成の dispatch をスキップします。');
    return;
  }

  for (const song of songs) {
    if (!song.lyrics) {
      console.log(`[srt-dispatcher] SKIP: 歌詞が取得できなかったため dispatch しません: ${song.title}`);
      continue;
    }
    try {
      await sendDispatch(token, song);
      console.log(`[srt-dispatcher] dispatch成功: ${song.title} (${song.handle})`);
    } catch (e) {
      console.error(`[srt-dispatcher] dispatch失敗: ${song.title} - ${e.message}`);
    }
  }
}

/**
 * GitHub の repository_dispatch API を叩く（成功時 204 No Content）。
 */
function sendDispatch(token, song) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      event_type: 'new-song',
      client_payload: {
        song_id: song.songId,
        handle: song.handle,
        song_name: song.songName,
        lyrics: song.lyrics,
      },
    });
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${DISPATCH_REPO}/dispatches`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'suno-tracker',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode === 204) resolve();
        else reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { dispatchSrtGeneration };
