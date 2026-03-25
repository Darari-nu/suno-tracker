const config = require('../config.json');

/**
 * 異常を検知する
 * @param {Object} currentData - 今回取得したアーティストデータ
 * @param {Object|null} previousData - 前回のアーティストデータ（csv-store.getLastSongsDataの結果）
 * @param {Array} trendResults - トレンド結果
 * @returns {Array} 検知された異常のリスト
 */
function detectAnomalies(currentData, previousData, trendResults) {
  const anomalies = [];

  // 1. データ取得失敗チェック
  for (const [artist, data] of Object.entries(currentData)) {
    if (!data.success) {
      anomalies.push({
        type: 'FETCH_ERROR',
        severity: 'critical',
        artist,
        message: `${artist} のデータ取得に失敗: ${data.error}`
      });
      continue;
    }

    // 1.5. API→DOMフォールバック検知
    if (data.success && data.method === 'dom') {
      anomalies.push({
        type: 'API_FALLBACK',
        severity: 'warning',
        artist,
        message: `${artist}: SUNO非公式APIが使用不可。DOMスクレイピングにフォールバック中。APIが廃止された可能性あり`
      });
    }

    // 2. 曲数ゼロチェック
    if (data.songCount === 0) {
      anomalies.push({
        type: 'NO_SONGS',
        severity: 'critical',
        artist,
        message: `${artist} の曲が0件。ページ構造の変更の可能性あり`
      });
      continue;
    }

    // 前回データとの比較
    if (previousData && previousData[artist]) {
      const prev = previousData[artist];

      // 3. 曲数減少チェック
      if (data.songCount < prev.songCount) {
        anomalies.push({
          type: 'SONG_COUNT_DECREASE',
          severity: 'warning',
          artist,
          message: `${artist} の曲数が減少: ${prev.songCount} → ${data.songCount}`,
          detail: { previous: prev.songCount, current: data.songCount }
        });
      }

      // 4. 再生数減少チェック
      if (!config.anomaly.playCountDecreaseAllowed) {
        for (const song of data.songs) {
          const prevSong = prev.songs.find(s => s.songId === song.songId);
          if (prevSong && song.plays < prevSong.plays) {
            anomalies.push({
              type: 'PLAY_COUNT_DECREASE',
              severity: 'warning',
              artist,
              message: `${artist} "${song.title}" の再生数が減少: ${prevSong.plays} → ${song.plays}`,
              detail: { songId: song.songId, previous: prevSong.plays, current: song.plays }
            });
          }
        }
      }

      // 5. 全曲の値が完全に同じ（スタック検知）
      const allSame = data.songs.every(song => {
        const prevSong = prev.songs.find(s => s.songId === song.songId);
        return prevSong && song.plays === prevSong.plays && song.likes === prevSong.likes;
      });
      if (allSame && data.songs.length > 0) {
        anomalies.push({
          type: 'STALE_DATA',
          severity: 'info',
          artist,
          message: `${artist} の全データが前回と同一。取得がスタックしている可能性あり`
        });
      }
    }
  }

  // 6. トレンドチェック失敗
  for (const result of trendResults) {
    if (!result.success) {
      anomalies.push({
        type: 'TREND_ERROR',
        severity: 'warning',
        message: `トレンド ${result.region}/${result.period} の取得に失敗: ${result.error}`
      });
    }
  }

  // 7. 全トレンドチェック失敗（UI変更の可能性大）
  const allTrendsFailed = trendResults.length > 0 && trendResults.every(r => !r.success);
  if (allTrendsFailed) {
    anomalies.push({
      type: 'ALL_TRENDS_FAILED',
      severity: 'critical',
      message: 'トレンドページの全チェックが失敗。UI変更の可能性大'
    });
  }

  return anomalies;
}

/**
 * 異常リストのサマリーを生成
 */
function formatAnomalySummary(anomalies) {
  if (anomalies.length === 0) return null;

  const critical = anomalies.filter(a => a.severity === 'critical');
  const warnings = anomalies.filter(a => a.severity === 'warning');
  const info = anomalies.filter(a => a.severity === 'info');

  let summary = '';
  if (critical.length > 0) {
    summary += '🚨 **重大な異常**\n';
    for (const a of critical) summary += `- ${a.message}\n`;
  }
  if (warnings.length > 0) {
    summary += '⚠️ **警告**\n';
    for (const a of warnings) summary += `- ${a.message}\n`;
  }
  if (info.length > 0) {
    summary += 'ℹ️ **情報**\n';
    for (const a of info) summary += `- ${a.message}\n`;
  }

  return summary;
}

module.exports = { detectAnomalies, formatAnomalySummary };
