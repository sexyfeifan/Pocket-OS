const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const Workflow = require('./workflow');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.POCKET_OS_DATA_DIR
  ? path.resolve(process.env.POCKET_OS_DATA_DIR)
  : path.join(__dirname, 'data');
const TOPICS_DIR = path.join(DATA_DIR, 'topics');
const APP_STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'schedule_data.json');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const STARTUP_TIME = new Date().toISOString();
const BUILD_VERSION = process.env.APP_VERSION || (() => { try { return JSON.parse(fsSync.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version; } catch { return 'dev'; } })();
const ACCESS_PASSWORD = process.env.POCKET_OS_PASSWORD || '';
const VIEW_PASSWORD = process.env.POCKET_OS_VIEW_PASSWORD || '';
if (VIEW_PASSWORD && (!ACCESS_PASSWORD || VIEW_PASSWORD === ACCESS_PASSWORD)) {
  throw new Error('查看密码要求同时设置不同的管理密码 POCKET_OS_PASSWORD');
}

app.use(express.json({ limit: '10mb' }));

// 可选的整站 Basic Auth。默认关闭，公网或反向代理部署时建议设置 POCKET_OS_PASSWORD。
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()))
      return res.status(403).json({ error: '不接受跨站修改请求' });
  }
  if (!ACCESS_PASSWORD) { req.accessRole = 'editor'; return next(); }
  const header = req.headers.authorization || '';
  const encoded = header.startsWith('Basic ') ? header.slice(6) : '';
  let password = '';
  try { password = Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':'); } catch {}
  const matches = value => {
    const actual = Buffer.from(password), expected = Buffer.from(value);
    return !!value && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  };
  if (matches(ACCESS_PASSWORD)) { req.accessRole = 'editor'; return next(); }
  if (matches(VIEW_PASSWORD)) {
    req.accessRole = 'viewer';
    const allowed = ['/view','/canbox','/view.webmanifest','/api/view/data','/api/view/events','/schedule.js','/workflow.js','/viewer.js','/viewer.css','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/favicon.ico'];
    if (['GET','HEAD'].includes(req.method) && allowed.includes(req.path)) return next();
    return res.status(403).json({ error: '查看权限不能访问管理功能或修改项目' });
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Pocket OS"');
  return res.status(401).send('需要 Pocket OS 访问密码');
});
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get(['/view','/canbox'], (req, res) => res.sendFile(path.join(__dirname, 'view.html')));
app.get('/view.webmanifest', (req, res) => res.json({ name:'Pocket OS 只读看板', short_name:'排期看板', start_url:'/view', scope:'/view', display:'standalone', theme_color:'#FAF7F2', background_color:'#FAF7F2', icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icon-512.png',sizes:'512x512',type:'image/png'}] }));
for (const file of ['workflow.js','viewer.js','viewer.css','workbench.js','workbench.css'])
  app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, file)));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/icon-192.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-192.png')));
app.get('/icon-512.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-512.png')));
app.get('/apple-touch-icon.png', (req, res) => res.sendFile(path.join(__dirname, 'apple-touch-icon.png')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'favicon.ico')));
app.get('/html2canvas.min.js', (req, res) => res.sendFile(path.join(__dirname, 'html2canvas.min.js')));
app.get('/schedule.js', (req, res) => res.sendFile(path.join(__dirname, 'schedule.js')));

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
        if (!isValidTopicId(topic.id)) throw new Error(`旧数据包含非法选题 ID: ${topic.id}`);
        if (!topic._version) topic._version = 1;
        const topicFile = path.join(TOPICS_DIR, `${topic.id}.json`);
        if (!fsSync.existsSync(topicFile)) {
          await fs.writeFile(topicFile, JSON.stringify(topic, null, 2));
        }
      }
    }
    const appState = { version: BUILD_VERSION, lastModified: data.lastModified, settings: sanitizeSettings(data.settings || { theme: 'beige-light' }) };
    if (!fsSync.existsSync(APP_STATE_FILE)) {
      await fs.writeFile(APP_STATE_FILE, JSON.stringify(appState, null, 2));
    }
    await fs.rename(LEGACY_DATA_FILE, LEGACY_DATA_FILE + '.bak');
    console.log('  ✅ 已从旧版数据迁移');
  } catch (e) { console.error('  ⚠️ 迁移失败:', e.message); }
}

// ── SSE 实时推送 ──
const sseClients = new Set();
const viewClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
  for (const res of viewClients) { try { res.write('event: changed\ndata: {}\n\n'); } catch { viewClients.delete(res); } }
}

app.get('/api/view/data', async (req, res) => {
  try {
    const topics = await withMutationLock(readAllTopics);
    res.json({ version: BUILD_VERSION, fetchedAt: new Date().toISOString(), topics: topics.map(Workflow.publicTopic) });
  } catch { res.status(500).json({ error: '看板数据读取失败' }); }
});
app.get('/api/view/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('event: connected\ndata: {}\n\n'); viewClients.add(res);
  const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => { clearInterval(timer); viewClients.delete(res); });
});
app.get('/api/access', (req, res) => res.json({ protected: !!ACCESS_PASSWORD, viewerEnabled: !!VIEW_PASSWORD }));

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
  try {
    const state = JSON.parse(await fs.readFile(APP_STATE_FILE, 'utf-8'));
    state.settings = sanitizeSettings(state.settings || {});
    return state;
  }
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
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, filePath);
}

// 串行化所有会改变 JSON 文件的操作，避免并发 read-modify-write 丢数据。
let mutationQueue = Promise.resolve();
function withMutationLock(task) {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.catch(() => {});
  return result;
}

// ── GET /api/data — 读取全部数据（兼容旧格式）──
app.get('/api/data', async (req, res) => {
  try {
    const [appState, topics] = await withMutationLock(() => Promise.all([readAppState(), readAllTopics()]));
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

// ── 校验选题 ID（防止路径遍历）──
function isValidTopicId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}

// ── POST /api/topic/:id — 保存单个选题（带版本校验）──
app.post('/api/topic/:id', async (req, res) => {
  if (!isValidTopicId(req.params.id)) return res.status(400).json({ success: false, error: 'invalid topic id' });
  try {
    const topic = req.body;
    if (!topic || topic.id !== req.params.id || !isValidTopicId(topic.id)) {
      return res.status(400).json({ success: false, error: 'topic id mismatch' });
    }
    const topicFile = path.join(TOPICS_DIR, `${req.params.id}.json`);
    const clientVersion = topic._version || 0;

    const saveResult = await withMutationLock(async () => {
      let existing = null;
      if (fsSync.existsSync(topicFile)) {
        existing = JSON.parse(await fs.readFile(topicFile, 'utf-8'));
        const serverVersion = existing._version || 0;
        if (serverVersion !== clientVersion) {
          return { conflict: true, existing, serverVersion };
        }
      } else if (clientVersion !== 0) {
        return { conflict: true, existing: null, serverVersion: 0 };
      }

      const saved = { ...topic, _version: clientVersion + 1, updatedAt: new Date().toISOString() };
      saved.scheduleHistory = (Array.isArray(existing?.scheduleHistory) ? existing.scheduleHistory : []).slice(-30);
      const before = Workflow.snapshot(existing || {}), after = Workflow.snapshot(saved);
      const changes = Workflow.diff(before, after);
      if (changes.length) {
        saved.scheduleHistory.push({ id: crypto.randomUUID(), at: saved.updatedAt, before, after, changes });
        saved.scheduleHistory = saved.scheduleHistory.slice(-30);
        if (existing?.scheduleConfirmed) saved.scheduleConfirmed = false;
      }
      await atomicWrite(topicFile, saved);
      return { saved };
    });

    if (saveResult.conflict) {
      return res.status(409).json({
        success: false, error: 'conflict',
        message: '该选题已被其他设备修改，请选择保留哪一版',
        serverVersion: saveResult.serverVersion,
        clientVersion,
        serverTopic: saveResult.existing
      });
    }

    const saved = saveResult.saved;

    // 广播变更
    broadcastSSE('topic-update', { id: saved.id, _version: saved._version, updatedAt: saved.updatedAt, title: saved.title });

    res.json({ success: true, _version: saved._version, updatedAt: saved.updatedAt, scheduleHistory: saved.scheduleHistory, scheduleConfirmed: saved.scheduleConfirmed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/topic/:id — 删除选题 ──
app.delete('/api/topic/:id', async (req, res) => {
  if (!isValidTopicId(req.params.id)) return res.status(400).json({ success: false, error: 'invalid topic id' });
  try {
    const topicFile = path.join(TOPICS_DIR, `${req.params.id}.json`);
    await withMutationLock(async () => {
      if (fsSync.existsSync(topicFile)) await fs.unlink(topicFile);
    });
    broadcastSSE('topic-delete', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/settings — 保存设置 ──
app.post('/api/settings', async (req, res) => {
  try {
    const appState = await withMutationLock(async () => {
      const state = await readAppState();
      state.settings = sanitizeSettings(req.body);
      state.lastModified = new Date().toISOString();
      await atomicWrite(APP_STATE_FILE, state);
      return state;
    });
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
    if (!payload || !Array.isArray(payload.topics)) {
      return res.status(400).json({ success: false, error: 'topics must be an array' });
    }
    const seen = new Set();
    for (const topic of payload.topics) {
      if (!topic || !isValidTopicId(topic.id) || seen.has(topic.id)) {
        return res.status(400).json({ success: false, error: `invalid or duplicate topic id: ${topic?.id || ''}` });
      }
      seen.add(topic.id);
    }

    const lastModified = new Date().toISOString();
    const appState = {
      version: BUILD_VERSION,
      lastModified,
      settings: sanitizeSettings(payload.settings || { theme: 'beige-light' })
    };

    await withMutationLock(async () => {
      const stageDir = path.join(DATA_DIR, `.topics-import-${crypto.randomUUID()}`);
      const backupDir = path.join(DATA_DIR, `.topics-backup-${crypto.randomUUID()}`);
      await fs.mkdir(stageDir, { recursive: true });
      try {
        for (const topic of payload.topics) {
          // 恢复后使用新的版本纪元，确保仍打开旧页面的设备无法覆盖刚恢复的数据。
          const saved = { ...topic, _version: Math.max(Date.now(), (Number(topic._version) || 0) + 1), updatedAt: lastModified };
          await fs.writeFile(path.join(stageDir, `${topic.id}.json`), JSON.stringify(saved, null, 2));
        }
        await fs.rename(TOPICS_DIR, backupDir);
        try {
          await fs.rename(stageDir, TOPICS_DIR);
          await atomicWrite(APP_STATE_FILE, appState);
          await fs.rm(backupDir, { recursive: true, force: true });
        } catch (err) {
          await fs.rm(TOPICS_DIR, { recursive: true, force: true }).catch(() => {});
          await fs.rename(backupDir, TOPICS_DIR).catch(() => {});
          throw err;
        }
      } finally {
        await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    broadcastSSE('full-sync', { lastModified, topicCount: payload.topics.length });
    res.json({ success: true, message: '备份已完整恢复', lastModified, topicCount: payload.topics.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function sanitizeSettings(settings) {
  const clean = settings && typeof settings === 'object' ? JSON.parse(JSON.stringify(settings)) : {};
  if (clean.canbox) delete clean.canbox.password;
  return clean;
}

// ── GET /api/export — 导出 JSON ──
app.get('/api/export', async (req, res) => {
  try {
    const [appState, topics] = await withMutationLock(() => Promise.all([readAppState(), readAllTopics()]));
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

function getLogFilePath(date) {
  // 校验日期格式，防止路径遍历
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `activity_log_${safe}.json`);
}

app.post('/api/log', async (req, res) => {
  try {
    const entry = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    entry.timestamp = entry.timestamp || new Date().toISOString();
    entry.ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = entry.userAgent || '';
    const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/?[\d.]+/i)?.[0] || ua.match(/(Mozilla\/[\d.]+)/)?.[0] || '未知';
    const os = ua.match(/(Mac OS X|Windows|Linux|Android|iOS)[^;)]*/i)?.[0] || ua.match(/\(([^)]+)\)/)?.[1] || '未知';
    const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    entry.device = { browser: browser.trim(), os: os.trim(), mobile };
    const date = entry.timestamp.slice(0, 10);
    const logFile = getLogFilePath(date);
    await withMutationLock(async () => {
      let logs = [];
      try { logs = JSON.parse(await fs.readFile(logFile, 'utf-8')); } catch {}
      logs.push(entry);
      await atomicWrite(logFile, logs);
    });
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
    const rawDate = req.query.date || new Date().toISOString().slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = 50;
    let logs = [];
    try { logs = JSON.parse(await fs.readFile(getLogFilePath(date), 'utf-8')); } catch {}
    const newestFirst = logs.slice().reverse();
    res.json({ logs: newestFirst.slice((page - 1) * pageSize, page * pageSize), total: logs.length, page, totalPages: Math.ceil(logs.length / pageSize) || 1, date });
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

app.post('/api/canbox/proxy', async (req, res) => {
  const targetUrl = req.body?.url;
  if (!targetUrl) return res.status(400).json({ error: 'missing url parameter' });
  let parsed;
  try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: 'invalid url' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'only http/https are allowed' });
  const allowed = await getAllowedCanboxHosts();
  if (!allowed.includes(parsed.host)) return res.status(403).json({ error: 'target host not in allowlist', detail: `allowed: ${allowed.join(', ') || '(none)'}` });
  const headers = { 'Accept': 'application/json' };
  if (req.body?.password) headers['X-Admin-Password'] = req.body.password;
  if (req.body?.token) headers['Authorization'] = `Bearer ${req.body.token}`;
  const appState = await readAppState();
  const allowSelfSigned = appState?.settings?.canbox?.allowSelfSigned || false;
  const transport = parsed.protocol === 'https:' ? https : http;
  let replied = false;
  const proxyReq = transport.get(targetUrl, { headers, rejectUnauthorized: !allowSelfSigned }, proxyRes => {
    let body = '';
    proxyRes.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) proxyReq.destroy(new Error('response too large'));
    });
    proxyRes.on('end', () => {
      if (replied) return;
      replied = true;
      res.status(proxyRes.statusCode).setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json').send(body);
    });
  });
  proxyReq.on('error', err => {
    if (replied) return;
    replied = true;
    res.status(502).json({ error: 'proxy error', detail: err.message });
  });
  proxyReq.setTimeout(10000, () => {
    if (replied) return;
    replied = true;
    proxyReq.destroy();
    res.status(504).json({ error: 'timeout' });
  });
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
    const key = 'pk_' + crypto.randomBytes(24).toString('base64url');
    await withMutationLock(async () => {
      const appState = await readAppState();
      if (!appState.settings) appState.settings = {};
      appState.settings.apiKey = key;
      appState.lastModified = new Date().toISOString();
      await atomicWrite(APP_STATE_FILE, appState);
    });
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
      progress: Workflow.stats(t).percent,
      createdAt: t.createdAt, updatedAt: t.updatedAt
    }));
    res.json({ page, limit, total: topics.length, topics: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/topics/:id — 单个选题详情
app.get('/api/public/topics/:id', checkApiKey, async (req, res) => {
  if (!isValidTopicId(req.params.id)) return res.status(400).json({ error: 'invalid topic id' });
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
    if (!require('./schedule').validDate(from) || !require('./schedule').validDate(to) || from > to) return res.status(400).json({error:'无效日期范围'});
    const events = Workflow.events(topics, from, to).map(e => ({
      topicId:e.topicId,topicTitle:e.title,stepKey:e.key,stepName:e.note?'备注':e.name,
      startDate:e.start,endDate:e.end,done:e.done||false,color:e.color||'#FFF3CD',
      ...(e.note?{note:e.name}:{rangeIndex:e.rangeIndex})
    }));
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
