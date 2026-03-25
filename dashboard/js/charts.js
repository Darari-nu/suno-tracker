// === データ管理 ===
let songsData = [];
let trendsData = [];
let artistsInfo = {}; // { name: { avatar: url } }
let overviewChart = null;
let songPlaysChart = null;
let songLikesChart = null;
let tableSortKey = 'plays';
let tableSortAsc = false;

// === CSV パーサー ===
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length <= 1) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim() ?? '');
    return obj;
  });
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { current += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { fields.push(current); current = ''; }
      else { current += c; }
    }
  }
  fields.push(current);
  return fields;
}

// === ファイル読み込み（手動ドラッグ＆ドロップ） ===
const fileInputArea = document.getElementById('file-input-area');
const fileInput = document.getElementById('file-input');

fileInputArea.addEventListener('click', () => fileInput.click());
fileInputArea.addEventListener('dragover', e => { e.preventDefault(); fileInputArea.style.borderColor = '#6c5ce7'; });
fileInputArea.addEventListener('dragleave', () => { fileInputArea.style.borderColor = '#dfe6e9'; });
fileInputArea.addEventListener('drop', e => {
  e.preventDefault();
  fileInputArea.style.borderColor = '#dfe6e9';
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => handleFiles(e.target.files));

function handleFiles(files) {
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (file.name.includes('trends')) {
        trendsData = parseCSV(text);
      } else if (file.name.endsWith('.csv')) {
        const parsed = parseCSV(text);
        songsData = songsData.concat(parsed);
      }
      updateDashboard();
    };
    reader.readAsText(file);
  }
  fileInputArea.style.display = 'none';
}

// === 自動読み込み（GitHub Pages 用：相対パスCSV） ===
async function loadFromCSV() {
  try {
    const artistsRes = await fetch('../data/artists.json');
    if (!artistsRes.ok) throw new Error('artists.json not found');
    const artistsRaw = await artistsRes.json();

    // artists.json の形式を自動判定（文字列配列 or オブジェクト配列）
    const artists = Array.isArray(artistsRaw) && typeof artistsRaw[0] === 'string'
      ? artistsRaw.map(name => ({ name, avatar: '' }))
      : artistsRaw;

    // アーティスト情報を保持
    for (const a of artists) {
      artistsInfo[a.name] = { avatar: a.avatar || '' };
    }

    const allSongs = [];
    for (const artist of artists) {
      try {
        const res = await fetch(`../data/${artist.name}.csv`);
        if (res.ok) {
          const text = await res.text();
          const parsed = parseCSV(text);
          allSongs.push(...parsed);
        }
      } catch (e) {
        console.warn(`${artist.name}.csv 読み込み失敗:`, e.message);
      }
    }
    songsData = allSongs;

    try {
      const trendsRes = await fetch('../data/trends.csv');
      if (trendsRes.ok) {
        const text = await trendsRes.text();
        trendsData = parseCSV(text);
      }
    } catch (e) {
      console.warn('trends.csv 読み込み失敗:', e.message);
    }

    if (songsData.length > 0) {
      fileInputArea.style.display = 'none';
      updateDashboard();
      return true;
    }
  } catch (e) {
    console.log('CSV自動読み込み失敗:', e.message);
  }
  return false;
}

// === フォールバック: ローカルAPI読み込み ===
async function loadFromAPI() {
  try {
    const [songsRes, trendsRes] = await Promise.all([
      fetch('/api/songs'),
      fetch('/api/trends')
    ]);
    if (songsRes.ok) songsData = await songsRes.json();
    if (trendsRes.ok) trendsData = await trendsRes.json();
    if (songsData.length > 0) {
      fileInputArea.style.display = 'none';
      updateDashboard();
      return true;
    }
  } catch (e) {
    console.log('API読み込み失敗:', e.message);
  }
  return false;
}

// ページ読み込み時
(async () => {
  const loaded = await loadFromCSV();
  if (!loaded) await loadFromAPI();
})();

// === フィルター ===
const artistSelect = document.getElementById('artist-select');
const metricSelect = document.getElementById('metric-select');
const periodSelect = document.getElementById('period-select');
const songSelect = document.getElementById('song-select');

[artistSelect, metricSelect, periodSelect].forEach(el => {
  el.addEventListener('change', () => {
    updateDashboard();
  });
});

songSelect.addEventListener('change', () => {
  updateSongDetail();
});

function getFilteredData() {
  const artist = artistSelect.value;
  const period = periodSelect.value;
  let filtered = songsData;
  if (artist !== 'all') {
    filtered = filtered.filter(d => d.artist === artist);
  }
  if (period !== 'all') {
    const cutoff = new Date();
    if (period === '24h') cutoff.setHours(cutoff.getHours() - 24);
    else if (period === '7d') cutoff.setDate(cutoff.getDate() - 7);
    else if (period === '30d') cutoff.setDate(cutoff.getDate() - 30);
    filtered = filtered.filter(d => new Date(d.timestamp) >= cutoff);
  }
  return filtered;
}

// === ダッシュボード更新 ===
function updateDashboard() {
  updateArtistOptions();
  updateArtistAvatar();
  updateSongOptions();
  updateStats();
  updateOverviewChart();
  updateSongDetail();
  updateSongsTable();
  updateTrendsTable();
  document.getElementById('stats-row').style.display = 'flex';
}

function updateArtistAvatar() {
  const selected = artistSelect.value;
  const avatarArea = document.getElementById('artist-avatar-area');
  const avatarImg = document.getElementById('artist-avatar');
  if (selected !== 'all' && artistsInfo[selected]?.avatar) {
    avatarImg.src = artistsInfo[selected].avatar;
    avatarImg.alt = selected;
    avatarArea.style.display = 'block';
  } else {
    avatarArea.style.display = 'none';
  }
}

function isNewSong(createdAt) {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  return created >= oneMonthAgo;
}

function updateArtistOptions() {
  const artists = [...new Set(songsData.map(d => d.artist))];
  const current = artistSelect.value;
  artistSelect.innerHTML = '<option value="all">全アーティスト</option>';
  artists.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    artistSelect.appendChild(opt);
  });
  artistSelect.value = current;
}

function updateSongOptions() {
  const data = getFilteredData();
  const timestamps = [...new Set(data.map(d => d.timestamp))].sort();
  const latestTs = timestamps[timestamps.length - 1];
  const latest = data.filter(d => d.timestamp === latestTs);

  // 再生数順でソート
  latest.sort((a, b) => (parseInt(b.plays) || 0) - (parseInt(a.plays) || 0));

  const current = songSelect.value;
  songSelect.innerHTML = '<option value="">曲を選択してください</option>';
  let currentExists = false;
  for (const song of latest) {
    const opt = document.createElement('option');
    opt.value = song.songId;
    const newTag = isNewSong(song.createdAt) ? '🆕 ' : '';
    opt.textContent = `${newTag}${song.title} (${song.artist}) - ${parseInt(song.plays || 0).toLocaleString()}再生`;
    songSelect.appendChild(opt);
    if (song.songId === current) currentExists = true;
  }
  songSelect.value = currentExists ? current : '';
}

function updateStats() {
  const data = getFilteredData();
  if (data.length === 0) return;

  const timestamps = [...new Set(data.map(d => d.timestamp))].sort();
  const latestTs = timestamps[timestamps.length - 1];
  const latest = data.filter(d => d.timestamp === latestTs);

  const totalPlays = latest.reduce((s, d) => s + (parseInt(d.plays) || 0), 0);
  const totalLikes = latest.reduce((s, d) => s + (parseInt(d.likes) || 0), 0);
  const songCount = latest.length;

  document.getElementById('stat-plays').textContent = totalPlays.toLocaleString();
  document.getElementById('stat-likes').textContent = totalLikes.toLocaleString();
  document.getElementById('stat-songs').textContent = songCount;

  const trendMatches = trendsData.filter(d => d.artist !== '-').length;
  document.getElementById('stat-trending').textContent = trendMatches;
}

// === 総合チャート ===
const COLORS = [
  '#6c5ce7', '#fdcb6e', '#00b894', '#e17055', '#0984e3',
  '#fd79a8', '#00cec9', '#f39c12', '#a29bfe', '#55efc4'
];
const GRAY = '#dfe6e9';

function updateOverviewChart() {
  const data = getFilteredData();
  if (data.length === 0) return;

  const metric = metricSelect.value;
  const metricLabel = metric === 'plays' ? '再生数' : 'いいね数';
  document.getElementById('overview-chart-title').textContent =
    `${metricLabel}ランキング（最新）`;

  const timestamps = [...new Set(data.map(d => d.timestamp))].sort();
  const latestTs = timestamps[timestamps.length - 1];
  const latest = data.filter(d => d.timestamp === latestTs);

  // 指標でソート（降順）
  latest.sort((a, b) => (parseInt(b[metric]) || 0) - (parseInt(a[metric]) || 0));

  // 上位20曲を表示（多すぎると見にくい）
  const display = latest.slice(0, 20);

  const labels = display.map(d => {
    const isNew = isNewSong(d.createdAt);
    return isNew ? `🆕 ${d.title}` : d.title;
  });
  const values = display.map(d => parseInt(d[metric]) || 0);
  const NEW_COLOR = '#ef4444';
  const bgColors = display.map((d, i) => {
    if (isNewSong(d.createdAt)) return NEW_COLOR + 'cc';
    return i < 10 ? COLORS[i] + 'cc' : GRAY + '80';
  });
  const borderColors = display.map((d, i) => {
    if (isNewSong(d.createdAt)) return NEW_COLOR;
    return i < 10 ? COLORS[i] : GRAY;
  });

  if (overviewChart) overviewChart.destroy();
  overviewChart = new Chart(document.getElementById('overview-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 0,
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: metricLabel, color: '#8395a7' },
          grid: { color: '#f0f2f5' },
          ticks: {
            color: '#8395a7',
            callback: (v) => v.toLocaleString()
          }
        },
        y: {
          grid: { display: false },
          ticks: {
            color: '#2d3436',
            font: { size: 12 },
            autoSkip: false
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${metricLabel}: ${ctx.parsed.x.toLocaleString()}`
          }
        }
      },
      onClick: (e, elements) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const song = display[idx];
          songSelect.value = song.songId;
          updateSongDetail();
          document.getElementById('song-info-row').scrollIntoView({ behavior: 'smooth' });
        }
      }
    }
  });
}

// === 曲別詳細 ===
function updateSongDetail() {
  const selectedId = songSelect.value;
  const placeholder = document.getElementById('song-detail-placeholder');
  const chartsArea = document.getElementById('song-detail-charts');
  const infoRow = document.getElementById('song-info-row');

  if (!selectedId) {
    placeholder.style.display = 'block';
    chartsArea.style.display = 'none';
    infoRow.style.display = 'none';
    return;
  }

  placeholder.style.display = 'none';
  chartsArea.style.display = 'block';
  infoRow.style.display = 'flex';

  const data = getFilteredData();
  const songData = data.filter(d => d.songId === selectedId);
  if (songData.length === 0) return;

  const timestamps = [...new Set(songData.map(d => d.timestamp))].sort();
  const latestTs = timestamps[timestamps.length - 1];
  const prevTs = timestamps.length >= 2 ? timestamps[timestamps.length - 2] : null;

  const latest = songData.find(d => d.timestamp === latestTs);
  const prev = prevTs ? songData.find(d => d.timestamp === prevTs) : null;

  // ジャケット画像
  const songImg = document.getElementById('song-image');
  if (latest.imageUrl) {
    songImg.src = latest.imageUrl;
    songImg.alt = latest.title;
    songImg.style.display = 'block';
  } else {
    songImg.style.display = 'none';
  }

  // 情報カード更新
  const plays = parseInt(latest.plays) || 0;
  const likes = parseInt(latest.likes) || 0;
  const comments = parseInt(latest.comments) || 0;
  const likeRate = plays > 0 ? ((likes / plays) * 100).toFixed(1) : '0.0';

  document.getElementById('song-plays').textContent = plays.toLocaleString();
  document.getElementById('song-likes').textContent = likes.toLocaleString();
  document.getElementById('song-like-rate').textContent = likeRate + '%';
  document.getElementById('song-comments').textContent = comments.toLocaleString();

  // 前回比
  if (prev) {
    const playsDiff = plays - (parseInt(prev.plays) || 0);
    const likesDiff = likes - (parseInt(prev.likes) || 0);
    document.getElementById('song-plays-diff').innerHTML = formatDiffSmall(playsDiff);
    document.getElementById('song-likes-diff').innerHTML = formatDiffSmall(likesDiff);
  } else {
    document.getElementById('song-plays-diff').textContent = '';
    document.getElementById('song-likes-diff').textContent = '';
  }

  // トレンド状態
  const songTrends = trendsData.filter(d => d.songId === selectedId && d.artist !== '-');
  if (songTrends.length > 0) {
    const latestTrend = songTrends.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    document.getElementById('song-trend-status').innerHTML =
      `<span style="color:#f59e0b;">${latestTrend.region}/${latestTrend.period} ${latestTrend.rank}位</span>`;
  } else {
    document.getElementById('song-trend-status').textContent = 'なし';
  }

  // トレンドのアノテーション
  const annotations = {};
  songTrends.forEach((match, idx) => {
    const ts = new Date(match.timestamp);
    annotations[`trend_${idx}`] = {
      type: 'line',
      xMin: ts,
      xMax: ts,
      borderColor: '#f59e0b88',
      borderWidth: 2,
      borderDash: [4, 4],
      label: {
        display: true,
        content: `${match.region}/${match.period} ${match.rank}位`,
        position: 'start',
        backgroundColor: '#f59e0b33',
        color: '#f59e0b',
        font: { size: 10 },
        padding: 3
      }
    };
  });

  const songTitle = latest.title;
  const color = '#6c5ce7';

  // 再生数チャート
  const playsDataset = {
    label: songTitle,
    data: timestamps.map(ts => {
      const entry = songData.find(d => d.timestamp === ts);
      return entry ? { x: new Date(ts), y: parseInt(entry.plays) || 0 } : null;
    }).filter(d => d),
    borderColor: color,
    backgroundColor: color + '20',
    borderWidth: 2,
    pointRadius: 2,
    tension: 0.3,
    fill: true
  };

  if (songPlaysChart) songPlaysChart.destroy();
  songPlaysChart = new Chart(document.getElementById('song-plays-chart'), {
    type: 'line',
    data: { datasets: [playsDataset] },
    options: songChartOptions('再生数', annotations)
  });

  // いいねチャート
  const likesDataset = {
    label: songTitle,
    data: timestamps.map(ts => {
      const entry = songData.find(d => d.timestamp === ts);
      return entry ? { x: new Date(ts), y: parseInt(entry.likes) || 0 } : null;
    }).filter(d => d),
    borderColor: '#fd79a8',
    backgroundColor: '#fd79a820',
    borderWidth: 2,
    pointRadius: 2,
    tension: 0.3,
    fill: true
  };

  if (songLikesChart) songLikesChart.destroy();
  songLikesChart = new Chart(document.getElementById('song-likes-chart'), {
    type: 'line',
    data: { datasets: [likesDataset] },
    options: songChartOptions('いいね数', annotations)
  });
}

function songChartOptions(yLabel, annotations) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { tooltipFormat: 'yyyy/MM/dd HH:mm' },
        grid: { color: '#f0f2f5' },
        ticks: { color: '#8395a7' }
      },
      y: {
        title: { display: true, text: yLabel, color: '#8395a7' },
        grid: { color: '#f0f2f5' },
        ticks: { color: '#8395a7' }
      }
    },
    plugins: {
      legend: {
        labels: { color: '#2d3436', boxWidth: 12, font: { size: 11 } },
        position: 'bottom'
      },
      annotation: { annotations }
    }
  };
}

// === テーブル ===
function setupTableSort() {
  const headers = document.querySelectorAll('#songs-table th[data-sort]');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (tableSortKey === key) {
        tableSortAsc = !tableSortAsc;
      } else {
        tableSortKey = key;
        tableSortAsc = false;
      }
      updateSongsTable();
    });
  });
}
setupTableSort();

function updateSongsTable() {
  const data = getFilteredData();
  if (data.length === 0) return;

  const timestamps = [...new Set(data.map(d => d.timestamp))].sort();
  const latestTs = timestamps[timestamps.length - 1];
  const prevTs = timestamps.length >= 2 ? timestamps[timestamps.length - 2] : null;

  let latest = data.filter(d => d.timestamp === latestTs);
  const prev = prevTs ? data.filter(d => d.timestamp === prevTs) : [];

  // いいね率を計算して付与
  latest = latest.map(song => {
    const plays = parseInt(song.plays) || 0;
    const likes = parseInt(song.likes) || 0;
    const prevSong = prev.find(p => p.songId === song.songId);
    const playsDiff = prevSong ? plays - (parseInt(prevSong.plays) || 0) : 0;
    return {
      ...song,
      playsNum: plays,
      likesNum: likes,
      commentsNum: parseInt(song.comments) || 0,
      likeRate: plays > 0 ? (likes / plays) * 100 : 0,
      playsDiff
    };
  });

  // ソート
  const sortFn = (a, b) => {
    let va, vb;
    switch (tableSortKey) {
      case 'title': va = a.title; vb = b.title; break;
      case 'artist': va = a.artist; vb = b.artist; break;
      case 'plays': va = a.playsNum; vb = b.playsNum; break;
      case 'likes': va = a.likesNum; vb = b.likesNum; break;
      case 'likeRate': va = a.likeRate; vb = b.likeRate; break;
      case 'comments': va = a.commentsNum; vb = b.commentsNum; break;
      case 'diff': va = a.playsDiff; vb = b.playsDiff; break;
      default: va = a.playsNum; vb = b.playsNum;
    }
    if (typeof va === 'string') {
      return tableSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return tableSortAsc ? va - vb : vb - va;
  };
  latest.sort(sortFn);

  // ソートアイコン更新
  document.querySelectorAll('#songs-table th[data-sort] .sort-icon').forEach(icon => {
    const key = icon.parentElement.dataset.sort;
    if (key === tableSortKey) {
      icon.textContent = tableSortAsc ? '▲' : '▼';
    } else {
      icon.textContent = '';
    }
  });

  const tbody = document.querySelector('#songs-table tbody');
  tbody.innerHTML = '';

  for (const song of latest) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => {
      songSelect.value = song.songId;
      updateSongDetail();
      document.getElementById('song-info-row').scrollIntoView({ behavior: 'smooth' });
    });
    const isNew = isNewSong(song.createdAt);
    const titleStyle = isNew ? ' style="color:#ef4444;font-weight:600;"' : '';
    const newBadge = isNew ? '<span style="color:#ef4444;font-size:10px;margin-left:4px;">NEW</span>' : '';
    tr.innerHTML = `
      <td${titleStyle}>${escapeHtml(song.title)}${newBadge}</td>
      <td>${escapeHtml(song.artist)}</td>
      <td class="num">${song.playsNum.toLocaleString()}</td>
      <td class="num">${song.likesNum.toLocaleString()}</td>
      <td class="num">${song.likeRate.toFixed(1)}%</td>
      <td class="num">${song.commentsNum.toLocaleString()}</td>
      <td class="num">${formatDiff(song.playsDiff)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function updateTrendsTable() {
  const tbody = document.querySelector('#trends-table tbody');
  tbody.innerHTML = '';

  const trendMatches = trendsData
    .filter(d => d.artist !== '-')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 50);

  if (trendMatches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8395a7;">ランクインデータなし</td></tr>';
    return;
  }

  for (const t of trendMatches) {
    const tr = document.createElement('tr');
    const date = new Date(t.timestamp);
    tr.innerHTML = `
      <td>${date.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${escapeHtml(t.region)}</td>
      <td>${escapeHtml(t.period)}</td>
      <td>${escapeHtml(t.title)}</td>
      <td class="num">${t.rank}</td>
    `;
    tbody.appendChild(tr);
  }
}

function formatDiff(diff) {
  if (diff > 0) return `<span class="trend-badge trend-up">+${diff.toLocaleString()}</span>`;
  if (diff < 0) return `<span class="trend-badge trend-down">${diff.toLocaleString()}</span>`;
  return `<span class="trend-badge trend-same">-</span>`;
}

function formatDiffSmall(diff) {
  if (diff > 0) return `<span style="color:#34d399;">+${diff.toLocaleString()}</span>`;
  if (diff < 0) return `<span style="color:#fca5a5;">${diff.toLocaleString()}</span>`;
  return '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
