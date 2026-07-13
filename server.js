const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'data', 'schedule_data.json');
const STARTUP_TIME = new Date().toISOString();
const BUILD_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/index.html', express.static(path.join(__dirname, 'index.html')));

// 显式路由：只暴露必要文件
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/canbox', (req, res) => res.sendFile(path.join(__dirname, 'canbox.html')));
app.get('/package.json', (req, res) => res.sendFile(path.join(__dirname, 'package.json')));

// 初始化数据目录和文件
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  const defaultData = {
    version: BUILD_VERSION,
    lastModified: new Date().toISOString(),
    topics: [],
    settings: {
      theme: 'beige-light'
    }
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
}

// GET /api/data — 读取全部排期数据
app.get('/api/data', (req, res) => {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/data — 保存全部排期数据
app.post('/api/data', (req, res) => {
  try {
    const payload = req.body;
    payload.lastModified = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
    res.json({ success: true, message: '数据已同步到服务器', lastModified: payload.lastModified });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/export — 导出 JSON 文件下载
app.get('/api/export', (req, res) => {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pocket-os-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Canbox API 代理 ──
// GET /api/canbox/proxy?url=<encoded_url>&password=<optional>
app.get('/api/canbox/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'missing url parameter' });

  let parsed;
  try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: 'invalid url' }); }

  const headers = { 'Accept': 'application/json' };
  if (req.query.password) headers['X-Admin-Password'] = req.query.password;
  if (req.query.token) headers['Authorization'] = `Bearer ${req.query.token}`;

  const transport = parsed.protocol === 'https:' ? https : http;
  const proxyReq = transport.get(targetUrl, { headers, rejectUnauthorized: false }, proxyRes => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode).setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json').send(body);
    });
  });
  proxyReq.on('error', err => res.status(502).json({ error: 'proxy error', detail: err.message }));
  proxyReq.setTimeout(10000, () => { proxyReq.destroy(); res.status(504).json({ error: 'timeout' }); });
});

// GET /api/system — 系统状态信息
app.get('/api/system', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - new Date(STARTUP_TIME).getTime()) / 1000);
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptime = days > 0 ? `${days}天 ${hours}小时 ${minutes}分钟` : hours > 0 ? `${hours}小时 ${minutes}分钟` : `${minutes}分钟`;
  res.json({ version: BUILD_VERSION, startupTime: STARTUP_TIME, uptime, uptimeSeconds });
});

app.listen(PORT, () => {
  console.log(`\n  ✨ Pocket OS 已启动`);
  console.log(`  ➜ 本地访问: http://localhost:${PORT}`);
  console.log(`  ➜ 数据文件: ${DATA_FILE}\n`);
});
