// === データ管理 ===
let songsData = [];
let trendsData = [];
let playsChart = null;
let likesChart = null;

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
fileInputArea.addEventListener('dragover', e => { e.preventDefault(); fileInputArea.style.borderColor = '#2563eb'; });
fileInputArea.addEventListener('dragleave', () => { fileInputArea.style.borderColor = '#333'; });
fileInputArea.addEventListener('drop', e => {
  e.preventDefault();
  fileInputArea.style.borderColor = '#333';
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
        console.log(`trends.csv: ${trendsData.length}行読み込み`);
      } else if (file.name.endsWith('.csv')) {
        // アーティスト別CSVを結合
        const parsed = parseCSV(text);
        songsData = songsData.concat(parsed);
        console.log(`${file.name}: ${parsed.length}行読み込み (累計: ${songsData.length})`);
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
    // artists.json からアーティスト一覧を取得
    const artistsRes = await fetch('../data/artists.json');
    if (!artistsRes.ok) throw new Error('artists.json not found');
    const artists = await artistsRes.json();

    // 各アーティストのCSVを読み込み
    const allSongs = [];
    for (const artist of artists) {
      try {
        const res = await fetch(`../data/${artist}.csv`);
        if (res.ok) {
          const text = await res.text();
          const parsed = parseCSV(text);
          allSongs.push(...parsed);
          console.log(`${artist}.csv: ${parsed.length}行読み込み`);
        }
      } catch (e) {
        console.warn(`${artist}.csv 読み込み失敗:`, e.message);
      }
    }
    songsData = allSongs;

    // trends.csv を読み込み
    try {
      const trendsRes = await fetch('../data/trends.csv');
      if (trendsRes.ok) {
        const text = await trendsRes.text();
        trendsData = parseCSV(text);
        console.log(`trends.csv: ${trendsData.length}行読み込み`);
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
    console.log('CSV自動読み込み失敗（手動アップロードを使用）:', e.message);
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
    if (songsRes.ok) {
      songsData = await songsRes.json();
      console.log(`API: songs ${songsData.length}行読み込み`);
    }
    if (trendsRes.ok) {
      trendsData = await trendsRes.json();
      console.log(`API: trends ${trendsData.length}行読み込み`);
    }
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

// ページ読み込み時に自動読み込みを試行（CSV → API → 手動アップロード）
(async () => {
  const loaded = await loadFromCSV();
  if (!loaded) await loadFromAPI();
})();

// === フィルター ===
const artistSelect = document.getElementById('artist-select');
const metricSelect = document.getElementById('metric-select');
const periodSelect = document.getElementById('period-select');

[artistSelect, metricSelect, periodSelect].forEach(el => {
  el.addEventListener('change', updateDashboard);
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
  updateStats();
  updateCharts();
  updateSongsTable();
  updateTrendsTable();
  document.getElementById('stats-row').style.display = 'flex';
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

function updateStats() {
  const data = getFilteredData();
  if (data.length === 0) return;

  // 最新タイムスタンプのデータ
  const timestamps = [...new Set(data.map(d => d.timestamp))].sort();
  const latestTs = timestamps[timestamps.length - 1];
  const latest = data.filter(d => d.timestamp === latestTs);

  const totalPlays = latest.reduce((s, d) => s + (parseInt(d.plays) || 0), 0);
  const totalLikes = latest.reduce((s, d) => s + (parseInt(d.likes) || 0), 0);
  const songCount = latest.length;

  document.getElementById('stat-plays').textContent = totalPlays.toLocaleString();
  document.getElementById('stat-likes').textContent = totalLikes.toLocaleString();
  document.getElementById('stat-songs').textContent = songCount;

  // トレンドランクイン数
  const trendMatches = trendsData.filter(d => d.artist !== '-').length;
  document.getElementById('stat-trending').textContent = trendMatches;
}

// === グラフ ===
const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#e11d48', '#10b981', '#d97706', '#7c3aed',
  '#be185d', '#0d9488', '#ea580c', '#4f46e5', '#65a30d',
  '#0891b2', '#9f1239', '#059669', '#b45309', '#6d28d9',
  '#a21caf', '#0f766e', '#c2410c', '#4338ca', '#4d7c0f',
  '#0e7490', '#881337', '#047857', '#92400e', '#5b21b6'
];

function updateCharts() {
  const data = getFilteredData();
  if (data.length === 0) return;

  // タイムスタンプごと・曲ごとにグループ化
  const songNames = [...new Set(data.map(d => d.title))];
  const timestamps = [...new Set(data.map(d => d.timestamp))].sort();

  // 再生数チャート
  const playsDatasets = songNames.map((song, i) => {
    const songData = data.filter(d => d.title === song);
    return {
      label: song,
      data: timestamps.map(ts => {
        const entry = songData.find(d => d.timestamp === ts);
        return entry ? { x: new Date(ts), y: parseInt(entry.plays) || 0 } : null;
      }).filter(d => d),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length] + '20',
      borderWidth: 2,
      pointRadius: 1,
      tension: 0.3
    };
  });

  if (playsChart) playsChart.destroy();
  playsChart = new Chart(document.getElementById('plays-chart'), {
    type: 'line',
    data: { datasets: playsDatasets },
    options: chartOptions('再生数')
  });

  // いいねチャート
  const likesDatasets = songNames.map((song, i) => {
    const songData = data.filter(d => d.title === song);
    return {
      label: song,
      data: timestamps.map(ts => {
        const entry = songData.find(d => d.timestamp === ts);
        return entry ? { x: new Date(ts), y: parseInt(entry.likes) || 0 } : null;
      }).filter(d => d),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length] + '20',
      borderWidth: 2,
      pointRadius: 1,
      tension: 0.3
    };
  });

  if (likesChart) likesChart.destroy();
  likesChart = new Chart(document.getElementById('likes-chart'), {
    type: 'line',
    data: { datasets: likesDatasets },
    options: chartOptions('いいね数')
  });
}

function chartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { tooltipFormat: 'yyyy/MM/dd HH:mm' },
        grid: { color: '#222' },
        ticks: { color: '#666' }
      },
      y: {
        title: { display: true, text: yLabel, color: '#666' },
        grid: { color: '#222' },
        ticks: { color: '#666' }
      }
    },
    plugins: {
      legend: {
        labels: { color: '#ccc', boxWidth: 12, font: { size: 11 } },
        position: 'bottom'
      }
    }
  };
}

// === テーブル ===
function updateSongsTable() {
  const data = getFilteredData();
  if (data.length === 0) return;

  const timestamps = [...new Set(data.map(d => d.timestamp))].sort();
  const latestTs = timestamps[timestamps.length - 1];
  const prevTs = timestamps.length >= 2 ? timestamps[timestamps.length - 2] : null;

  const latest = data.filter(d => d.timestamp === latestTs);
  const prev = prevTs ? data.filter(d => d.timestamp === prevTs) : [];

  const tbody = document.querySelector('#songs-table tbody');
  tbody.innerHTML = '';

  // 再生数でソート
  latest.sort((a, b) => (parseInt(b.plays) || 0) - (parseInt(a.plays) || 0));

  for (const song of latest) {
    const prevSong = prev.find(p => p.songId === song.songId);
    const playsDiff = prevSong ? (parseInt(song.plays) || 0) - (parseInt(prevSong.plays) || 0) : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(song.title)}</td>
      <td>${escapeHtml(song.artist)}</td>
      <td class="num">${parseInt(song.plays || 0).toLocaleString()}</td>
      <td class="num">${parseInt(song.likes || 0).toLocaleString()}</td>
      <td class="num">${parseInt(song.comments || 0).toLocaleString()}</td>
      <td class="num">${formatDiff(playsDiff)}</td>
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666;">ランクインデータなし</td></tr>';
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
