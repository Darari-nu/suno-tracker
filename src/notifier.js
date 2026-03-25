const https = require('https');
const http = require('http');
const config = require('../config.json');

/**
 * Discord Webhook にメッセージを送信する
 */
function sendWebhook(message) {
  return new Promise((resolve, reject) => {
    if (!config.notification.enabled || !config.notification.discordWebhookUrl) {
      console.log('[notify] Webhook未設定。通知をスキップ');
      console.log('[notify] メッセージ内容:', message.substring(0, 200));
      resolve(false);
      return;
    }

    const url = new URL(config.notification.discordWebhookUrl);
    const payload = JSON.stringify({
      content: message.substring(0, 2000) // Discord の文字数制限
    });

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[notify] Webhook送信成功');
          resolve(true);
        } else {
          console.error(`[notify] Webhook送信失敗: ${res.statusCode} ${data}`);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[notify] Webhook送信エラー:', err.message);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * 異常通知を送る
 */
async function notifyAnomalies(anomalySummary) {
  const message = `🔔 **SUNO Tracker 異常検知**\n${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n\n${anomalySummary}`;
  return sendWebhook(message);
}

/**
 * 定期レポートを送る
 */
async function notifyDailyReport(artistData, trendResults) {
  let message = `📊 **SUNO Tracker 定期レポート**\n${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n\n`;

  // 各アーティストのサマリー
  for (const [artist, data] of Object.entries(artistData)) {
    if (!data.success) {
      message += `**${artist}**: データ取得失敗\n`;
      continue;
    }
    const totalPlays = data.songs.reduce((sum, s) => sum + s.plays, 0);
    const totalLikes = data.songs.reduce((sum, s) => sum + s.likes, 0);
    message += `**${artist}**: ${data.songCount}曲 / 総再生${totalPlays.toLocaleString()} / 総いいね${totalLikes.toLocaleString()}\n`;

    // Top3
    const top3 = [...data.songs].sort((a, b) => b.plays - a.plays).slice(0, 3);
    for (let i = 0; i < top3.length; i++) {
      message += `  ${i + 1}. ${top3[i].title} (${top3[i].plays.toLocaleString()}再生)\n`;
    }
    message += '\n';
  }

  // トレンドランクイン
  const allMatches = trendResults.flatMap(r => r.matches || []).filter(m => m);
  if (allMatches.length > 0) {
    message += '🏆 **トレンドランクイン**\n';
    for (const m of allMatches) {
      message += `- ${m.artist} "${m.title}" (${m.rank}位)\n`;
    }
  } else {
    message += 'トレンドランクイン: なし\n';
  }

  message += '\n✅ 異常なし';
  return sendWebhook(message);
}

/**
 * 正常完了の簡易通知（3時間ごとの定期実行時）
 */
async function notifySuccess(artistData) {
  // 定期レポートの時間かどうかチェック
  const now = new Date();
  const hour = now.getHours();

  if (hour === config.schedule.dailyReportHour) {
    return false; // 定期レポート時間は別途送信
  }

  // 通常時は通知しない（異常時のみ通知）
  console.log('[notify] 正常完了。通知不要');
  return false;
}

module.exports = { sendWebhook, notifyAnomalies, notifyDailyReport, notifySuccess };
