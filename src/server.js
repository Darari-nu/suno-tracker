const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(__dirname, '..');
const PORT = 3456;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS ヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');

  let urlPath = req.url.split('?')[0];

  // ルーティング
  if (urlPath === '/' || urlPath === '/dashboard' || urlPath === '/dashboard/') {
    urlPath = '/dashboard/index.html';
  }

  // API: CSVデータをJSONで返す
  if (urlPath === '/api/songs') {
    return serveCSVAsJSON(res, path.join(BASE_DIR, 'data/songs.csv'));
  }
  if (urlPath === '/api/trends') {
    return serveCSVAsJSON(res, path.join(BASE_DIR, 'data/trends.csv'));
  }

  // 静的ファイル
  const filePath = path.join(BASE_DIR, urlPath);

  // ディレクトリトラバーサル防止
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

function serveCSVAsJSON(res, csvPath) {
  if (!fs.existsSync(csvPath)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
    return;
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length <= 1) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
    return;
  }

  const headers = parseCSVLine(lines[0]);
  const data = lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim() ?? '');
    return obj;
  });

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
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

server.listen(PORT, () => {
  console.log(`SUNO Tracker Dashboard → http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/songs`);
  console.log(`API: http://localhost:${PORT}/api/trends`);
});
