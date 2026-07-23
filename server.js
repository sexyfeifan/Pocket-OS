const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const TOPICS_DIR = path.join(DATA_DIR, 'topics');
const APP_STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'schedule_data.json');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const STARTUP_TIME = new Date().toISOString();
const BUILD_VERSION = process.env.APP_VERSION || (() => { try { return JSON.parse(fsSync.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version; } catch { return 'dev'; } })();

app.use(express.json({ limit: '10mb' }));
app.use('/index.html', express.static(path.join(__dirname, 'index.html')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/canbox', (req, res) => res.sendFile(path.join(__dirname, 'canbox.html')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/icon-192.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-192.png')));
app.get('/icon-512.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-512.png')));
app.get('/apple-touch-icon.png', (req, res) => res.sendFile(path.join(__dirname, 'apple-touch-icon.png')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'favicon.ico')));
app.get('/html2canvas.min.js', (req, res) => res.sendFile(path.join(__dirname, 'html2canvas.min.js')));

// ── 初始化目录结构 ──
if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });
if (!fsSync.existsSync(TOPICS_DIR)) fsSync.mkdirSync(TOPICS_DIR, { recursive: true });

// 迁移旧版单文件 → 分文件存储
async function migrateFromLegacy() {
  if (!fsSync.existsSync(LEGACY_DATA_FILE)) return;
  try {
    const raw = await fs.readFile(LEGACY_DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.topics && data.topics.length) {
      for (const topic of data.topics) {
        if (!topic._version) topic._version = 1;
        const topicFile = path.join(TOPICS_DIR, `${topic.id}.json`);
        if (!fsSync.existsSync(topicFile)) {
          await fs.writeFile(topicFile, JSON.stringify(topic, null, 2));
        }
      }
    }
    const appState = { version: data.version || BUILD_VERSION, lastModified: data.lastModified, settings: data.settings || { theme: 'beige-light' } };
    if (!fsSync.existsSync(APP_STATE_FILE)) {
      await fs.writeFile(APP_STATE_FILE, JSON.stringify(appState, null, 2));
    }
    await fs.rename(LEGACY_DATA_FILE, LEGACY_DATA_FILE + '.bak');
    console.log('  ✅ 已从旧版数据迁移');
  } catch (e) { console.error('  ⚠️ 迁移失败:', e.message); }
}

// ── SSE 实时推送 ──
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ── 读取辅助 ──
async function readAppState() {
  try { return JSON.parse(await fs.readFile(APP_STATE_FILE, 'utf-8')); }
  catch { return { version: BUILD_VERSION, lastModified: new Date().toISOString(), settings: { theme: 'beige-light' } }; }
}

async function readAllTopics() {
  const topics = [];
  try {
    const files = await fs.readdir(TOPICS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try { topics.push(JSON.parse(await fs.readFile(path.join(TOPICS_DIR, f), 'utf-8'))); } catch {}
    }
  } catch {}
  return topics;
}

async function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, filePath);
}

// ── GET /api/data — 读取全部数据（兼容旧格式）──
app.get('/api/data', async (req, res) => {
  try {
    const [appState, topics] = await Promise.all([readAppState(), readAllTopics()]);
    // 动态版本号：取所有 updatedAt 最大值的时间戳部分
    let maxTs = Date.parse(appState.lastModified || 0) || 0;
    for (const t of topics) {
      const ts = Date.parse(t.updatedAt || 0) || 0;
      if (ts > maxTs) maxTs = ts;
    }
    const dataVersion = BUILD_VERSION + '.' + Math.floor(maxTs / 1000);
    res.json({ ...appState, version: dataVersion, topics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/topic/:id — 保存单个选题（带版本校验）──
app.post('/api/topic/:id', async (req, res) => {
  try {
    const topic = req.body;
    const topicFile = path.join(TOPICS_DIR, `${req.params.id}.json`);
    const clientVersion = topic._version || 0;

    // 版本校验：如果服务端已有该文件，检查版本号
    if (fsSync.existsSync(topicFile)) {
      try {
        const existing = JSON.parse(await fs.readFile(topicFile, 'utf-8'));
        if (existing._version && existing._version > clientVersion) {
          return res.status(409).json({
            success: false, error: 'conflict',
            message: '该选题已被其他设备修改，请刷新后重试',
            serverVersion: existing._version, clientVersion
          });
        }
      } catch {}
    }

    topic._version = clientVersion + 1;
    topic.updatedAt = new Date().toISOString();
    await atomicWrite(topicFile, topic);

    // 广播变更
    broadcastSSE('topic-update', { id: topic.id, _version: topic._version, updatedAt: topic.updatedAt, title: topic.title });

    res.json({ success: true, _version: topic._version });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/topic/:id — 删除选题 ──
app.delete('/api/topic/:id', async (req, res) => {
  try {
    const topicFile = path.join(TOPICS_DIR, `${req.params.id}.json`);
    if (fsSync.existsSync(topicFile)) await fs.unlink(topicFile);
    broadcastSSE('topic-delete', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/settings — 保存设置 ──
app.post('/api/settings', async (req, res) => {
  try {
    const appState = await readAppState();
    appState.settings = req.body;
    appState.lastModified = new Date().toISOString();
    await atomicWrite(APP_STATE_FILE, appState);
    broadcastSSE('settings-update', { lastModified: appState.lastModified });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/data — 全量保存（兼容旧前端 + 导入）──
app.post('/api/data', async (req, res) => {
  try {
    const payload = req.body;
    payload.lastModified = new Date().toISOString();

    // 保存设置
    const appState = { version: payload.version || BUILD_VERSION, lastModified: payload.lastModified, settings: payload.settings || { theme: 'beige-light' } };
    await atomicWrite(APP_STATE_FILE, appState);

    // 保存每个选题
    if (payload.topics && Array.isArray(payload.topics)) {
      for (const topic of payload.topics) {
        if (!topic._version) topic._version = 1;
        const topicFile = path.join(TOPICS_DIR, `${topic.id}.json`);
        await atomicWrite(topicFile, topic);
      }
    }

    broadcastSSE('full-sync', { lastModified: payload.lastModified, topicCount: payload.topics?.length || 0 });
    res.json({ success: true, message: '数据已同步到服务器', lastModified: payload.lastModified });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/export — 导出 JSON ──
app.get('/api/export', async (req, res) => {
  try {
    const [appState, topics] = await Promise.all([readAppState(), readAllTopics()]);
    const data = { ...appState, topics };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pocket-os-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 操作日志 ──
if (!fsSync.existsSync(LOG_DIR)) fsSync.mkdirSync(LOG_DIR, { recursive: true });

function getLogFilePath(date) { return path.join(LOG_DIR, `activity_log_${date}.json`); }

app.post('/api/log', async (req, res) => {
  try {
    const entry = req.body;
    entry.timestamp = entry.timestamp || new Date().toISOString();
    entry.ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = entry.userAgent || '';
    const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/?[\d.]+/i)?.[0] || ua.match(/(Mozilla\/[\d.]+)/)?.[0] || '未知';
    const os = ua.match(/(Mac OS X|Windows|Linux|Android|iOS)[^;)]*/i)?.[0] || ua.match(/\(([^)]+)\)/)?.[1] || '未知';
    const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    entry.device = { browser: browser.trim(), os: os.trim(), mobile };
    const date = entry.timestamp.slice(0, 10);
    const logFile = getLogFilePath(date);
    let logs = [];
    try { logs = JSON.parse(await fs.readFile(logFile, 'utf-8')); } catch {}
    logs.push(entry);
    await atomicWrite(logFile, logs);
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
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/logs', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = 50;
    let logs = [];
    try { logs = JSON.parse(await fs.readFile(getLogFilePath(date), 'utf-8')); } catch {}
    res.json({ logs: logs.slice((page - 1) * pageSize, page * pageSize), total: logs.length, page, totalPages: Math.ceil(logs.length / pageSize) || 1, date });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Canbox API 代理 ──
async function getAllowedCanboxHosts() {
  try {
    const appState = await readAppState();
    const url = appState?.settings?.canbox?.url;
    if (!url) return [];
    return [new URL(url).host];
  } catch { return []; }
}

app.get('/api/canbox/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'missing url parameter' });
  let parsed;
  try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: 'invalid url' }); }
  const allowed = await getAllowedCanboxHosts();
  if (!allowed.includes(parsed.host)) return res.status(403).json({ error: 'target host not in allowlist', detail: `allowed: ${allowed.join(', ') || '(none)'}` });
  const headers = { 'Accept': 'application/json' };
  if (req.query.password) headers['X-Admin-Password'] = req.query.password;
  if (req.query.token) headers['Authorization'] = `Bearer ${req.query.token}`;
  const appState = await readAppState();
  const allowSelfSigned = appState?.settings?.canbox?.allowSelfSigned || false;
  const transport = parsed.protocol === 'https:' ? https : http;
  const proxyReq = transport.get(targetUrl, { headers, rejectUnauthorized: !allowSelfSigned }, proxyRes => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => res.status(proxyRes.statusCode).setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json').send(body));
  });
  proxyReq.on('error', err => res.status(502).json({ error: 'proxy error', detail: err.message }));
  proxyReq.setTimeout(10000, () => { proxyReq.destroy(); res.status(504).json({ error: 'timeout' }); });
});

// ── 系统状态 ──
app.get('/api/system', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - new Date(STARTUP_TIME).getTime()) / 1000);
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptime = days > 0 ? `${days}天 ${hours}小时 ${minutes}分钟` : hours > 0 ? `${hours}小时 ${minutes}分钟` : `${minutes}分钟`;
  res.json({ version: BUILD_VERSION, startupTime: STARTUP_TIME, uptime, uptimeSeconds, clients: sseClients.size });
});

// ── 公开只读 API ──
async function checkApiKey(req, res, next) {
  const key = req.query.key || req.headers['x-api-key'] || '';
  const appState = await readAppState();
  const storedKey = appState?.settings?.apiKey || '';
  if (!storedKey) return res.status(403).json({ error: 'API Key 未设置，请在 Pocket OS 设置中生成' });
  if (key !== storedKey) return res.status(401).json({ error: 'API Key 无效' });
  next();
}

// 生成 API Key
app.post('/api/settings/apikey', express.json(), async (req, res) => {
  try {
    const appState = await readAppState();
    if (!appState.settings) appState.settings = {};
    const key = 'pk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    appState.settings.apiKey = key;
    await atomicWrite(APP_STATE_FILE, appState);
    res.json({ success: true, apiKey: key });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/public/topics — 所有选题概览
app.get('/api/public/topics', checkApiKey, async (req, res) => {
  try {
    const topics = await readAllTopics();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const start = (page - 1) * limit;
    const sorted = topics.sort((a, b) => (a.publishDate || 'z').localeCompare(b.publishDate || 'z'));
    const items = sorted.slice(start, start + limit).map(t => ({
      id: t.id, title: t.title, category: t.category, platforms: t.platforms,
      publishDate: t.publishDate, completed: t.completed || false,
      progress: (() => {
        const active = (t.productionSteps || []).filter(s => !s.cleared);
        return active.length ? Math.round(active.filter(s => s.done).length / active.length * 100) : 0;
      })(),
      createdAt: t.createdAt, updatedAt: t.updatedAt
    }));
    res.json({ page, limit, total: topics.length, topics: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/topics/:id — 单个选题详情
app.get('/api/public/topics/:id', checkApiKey, async (req, res) => {
  try {
    const topicFile = path.join(TOPICS_DIR, `${req.params.id}.json`);
    if (!fsSync.existsSync(topicFile)) return res.status(404).json({ error: '选题不存在' });
    const raw = await fs.readFile(topicFile, 'utf-8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/calendar — 指定时间范围排期
app.get('/api/public/calendar', checkApiKey, async (req, res) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to = req.query.to || addDays(from, 30);
    const topics = await readAllTopics();
    const events = [];
    topics.filter(t => !t.completed).forEach(t => {
      (t.productionSteps || []).filter(s => !s.cleared && s.startDate).forEach(s => {
        if (s.endDate >= from && s.startDate <= to) {
          events.push({ topicId: t.id, topicTitle: t.title, stepKey: s.key, stepName: s.name, startDate: s.startDate, endDate: s.endDate, done: s.done, color: s.color });
        }
      });
      if (t.notes) {
        Object.entries(t.notes).forEach(([date, text]) => {
          if (date >= from && date <= to) {
            events.push({ topicId: t.id, topicTitle: t.title, stepKey: 'note', stepName: '备注', startDate: date, endDate: date, done: false, color: '#FFF3CD', note: text });
          }
        });
      }
    });
    events.sort((a, b) => a.startDate.localeCompare(b.startDate));
    res.json({ from, to, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── 启动 ──
migrateFromLegacy().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  ✨ Pocket OS v${BUILD_VERSION} 已启动`);
    console.log(`  ➜ 本地访问: http://localhost:${PORT}`);
    console.log(`  ➜ 数据目录: ${DATA_DIR}`);
    console.log(`  ➜ 多点同步: 已启用 (SSE + 分文件存储)\n`);
  });
});
