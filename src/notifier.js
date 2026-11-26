const https = require('https');
const http = require('http');
const config = require('../config.json');
const { formatAnomalySummary } = require('./anomaly-detector');
const { artistDisplay } = require('./daily-report');

/**
 * Discord Webhook にメッセージを送信する
 */
const MENTION_USER_ID = '982891457000136715';
const MENTION = `<@${MENTION_USER_ID}> `;

/** Webhook の本文(JSON文字列用オブジェクト)を作る。mention=true のときだけ darari にメンションを許可する */
function buildPayload(message, mention = false) {
  return {
    content: message.substring(0, 2000), // Discord の文字数制限
    allowed_mentions: mention ? { users: [MENTION_USER_ID] } : { parse: [] }
  };
}

/**
 * @param {string} message
 * @param {{mention?: boolean}} [opts] - トラブル通知のときだけ mention:true（日報などは付けない）
 */
function sendWebhook(message, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!config.notification.enabled || !config.notification.discordWebhookUrl) {
      console.log('[notify] Webhook未設定。通知をスキップ');
      console.log('[notify] メッセージ内容:', message.substring(0, 200));
      resolve(false);
      return;
    }

    const url = new URL(config.notification.discordWebhookUrl);
    const payload = JSON.stringify(buildPayload(message, !!opts.mention));

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
          console.error(`[notify] Webhook送信失敗: HTTP ${res.statusCode}（応答本文は記録しない）`);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[notify] Webhook送信エラー:', err.code || 'network error');
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

// 即時に送る type（これ以外は run-log に残り、日報の「注意」に出る）
const IMMEDIATE_TYPES = ['FETCH_ERROR', 'NO_SONGS', 'API_FALLBACK', 'SONG_COUNT_DECREASE', 'NEW_SONG_BURST', 'ALL_TRENDS_FAILED', 'NEW_SONG'];

/**
 * 即時通知の本文を作る。送るものが無ければ null。
 */
function buildImmediateMessage(anomalies = []) {
  const immediate = anomalies.filter(a => IMMEDIATE_TYPES.includes(a.type));
  if (immediate.length === 0) return null;

  // 新曲だけのときは短い1通
  if (immediate.every(a => a.type === 'NEW_SONG')) {
    return immediate
      .map(a => `🆕 新曲：「${(a.detail && a.detail.title) || a.songId}」(${artistDisplay(a.artist)})`)
      .join('\n');
  }

  // 新曲だけでなければ全部トラブル通知 → メンション付き
  return `${MENTION}🔔 **SUNO Tracker 異常検知**\n${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n\n${formatAnomalySummary(immediate)}`;
}

/**
 * 異常通知を送る（IMMEDIATE_TYPES に該当するものだけ）
 * @param {Array} anomalies - 異常リスト
 * @param {Function} [send] - 送信関数（テストでスタブ可）
 */
async function notifyAnomalies(anomalies = [], send = sendWebhook) {
  const message = buildImmediateMessage(anomalies);
  if (!message) return false;
  return send(message, { mention: message.startsWith(MENTION) });
}

module.exports = { MENTION, MENTION_USER_ID, buildPayload, sendWebhook, notifyAnomalies, buildImmediateMessage, IMMEDIATE_TYPES };
