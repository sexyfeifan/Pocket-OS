const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'data', 'schedule_data.json');
const STARTUP_TIME = new Date().toISOString();
const BUILD_VERSION = process.env.APP_VERSION || JSON.parse(fsSync.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/index.html', express.static(path.join(__dirname, 'index.html')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/canbox', (req, res) => res.sendFile(path.join(__dirname, 'canbox.html')));
app.get('/package.json', (req, res) => res.sendFile(path.join(__dirname, 'package.json')));

const dataDir = path.dirname(DATA_FILE);
if (!fsSync.existsSync(dataDir)) {
  fsSync.mkdirSync(dataDir, { recursive: true });
}
if (!fsSync.existsSync(DATA_FILE)) {
  const defaultData = {
    version: BUILD_VERSION,
    lastModified: new Date().toISOString(),
    topics: [],
    settings: { theme: 'beige-light' }
  };
  fsSync.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
}

// GET /api/data — 读取全部排期数据
app.get('/api/data', async (req, res) => {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/data — 保存全部排期数据
app.post('/api/data', async (req, res) => {
  try {
    const payload = req.body;
    payload.lastModified = new Date().toISOString();
    const tmp = DATA_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
    await fs.rename(tmp, DATA_FILE);
    res.json({ success: true, message: '数据已同步到服务器', lastModified: payload.lastModified });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/export — 导出 JSON 文件下载
app.get('/api/export', async (req, res) => {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pocket-os-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 操作日志 (R04) ──
const LOG_DIR = path.join(__dirname, 'data', 'logs');
if (!fsSync.existsSync(LOG_DIR)) fsSync.mkdirSync(LOG_DIR, { recursive: true });

function getLogFilePath(date) {
  return path.join(LOG_DIR, `activity_log_${date}.json`);
}

// POST /api/log — 写入一条日志
app.post('/api/log', async (req, res) => {
  try {
    const entry = req.body;
    entry.timestamp = entry.timestamp || new Date().toISOString();
    entry.ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const date = entry.timestamp.slice(0, 10);
    const logFile = getLogFilePath(date);
    let logs = [];
    try { logs = JSON.parse(await fs.readFile(logFile, 'utf-8')); } catch {}
    logs.push(entry);
    await fs.writeFile(logFile, JSON.stringify(logs, null, 2));
    // 清理超过 30 天的日志
    try {
      const files = await fs.readdir(LOG_DIR);
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      for (const f of files) {
        const m = f.match(/activity_log_(\d{4}-\d{2}-\d{2})\.json/);
        if (m && m[1] < cutoffStr) await fs.unlink(path.join(LOG_DIR, f)).catch(() => {});
      }
    } catch {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/logs?date=2026-07-14&page=1 — 查询日志
app.get('/api/logs', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = 50;
    const logFile = getLogFilePath(date);
    let logs = [];
    try { logs = JSON.parse(await fs.readFile(logFile, 'utf-8')); } catch {}
    const total = logs.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    res.json({ logs: logs.slice(start, start + pageSize), total, page, totalPages, date });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Canbox API 代理 ──
// 从已保存的配置中读取允许的 Canbox 主机
async function getAllowedCanboxHosts() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const url = data?.settings?.canbox?.url;
    if (!url) return [];
    const parsed = new URL(url);
    return [parsed.host];
  } catch { return []; }
}

app.get('/api/canbox/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'missing url parameter' });

  let parsed;
  try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: 'invalid url' }); }

  // SSRF 防护：只允许访问已配置的 Canbox 主机
  const allowed = await getAllowedCanboxHosts();
  if (!allowed.includes(parsed.host)) {
    return res.status(403).json({ error: 'target host not in allowlist', detail: `allowed: ${allowed.join(', ') || '(none)'}` });
  }

  const headers = { 'Accept': 'application/json' };
  if (req.query.password) headers['X-Admin-Password'] = req.query.password;
  if (req.query.token) headers['Authorization'] = `Bearer ${req.query.token}`;

  const transport = parsed.protocol === 'https:' ? https : http;
  const proxyReq = transport.get(targetUrl, { headers, rejectUnauthorized: true }, proxyRes => {
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
