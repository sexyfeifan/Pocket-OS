'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const M = require('./import-model');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const route = fn => (req, res) => Promise.resolve(fn(req, res)).catch(error => {
  if (!error.status) console.error('Import service:', error.message);
  res.status(error.status || 500).json({ error: error.status ? error.message : '导入服务暂时失败，请重试；相同请求不会重复创建项目' });
});

module.exports = function createImportService({ dataDir, passwordEnabled, lock, atomicWrite, readTopics, saveTopic, broadcast }) {
  const directory = path.join(dataDir, 'integrations', 'feishu');
  const credentialsFile = path.join(dataDir, 'integrations', 'feishu-credentials.json');
  const previews = new Map(), rates = new Map();
  const agent = express.Router(), admin = express.Router();
  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async function write(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await atomicWrite(file, value); }
  async function credentials() { return readJson(credentialsFile, {}); }
  function draftPath(id) {
    if (!/^fi_[a-f0-9]{40}$/.test(id)) M.fail('导入记录 ID 无效');
    return path.join(directory, id + '.json');
  }
  async function draft(id) {
    const value = await readJson(draftPath(id), null);
    if (!value) M.fail('导入记录不存在', 404);
    return value;
  }
  async function drafts() {
    let files; try { files = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const values = [];
    for (const file of files.filter(f => /^fi_[a-f0-9]{40}\.json$/.test(f))) values.push(await readJson(path.join(directory, file), null));
    return values.filter(Boolean).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }
  function requireProtection() { if (!passwordEnabled) M.fail('请先设置 POCKET_OS_PASSWORD 管理密码，再启用 Agent 导入', 403); }
  function rate(key, max) {
    const now = Date.now();
    for (const [id, entry] of rates) if (entry.until < now) rates.delete(id);
    if (!rates.has(key) && rates.size >= 500) M.fail('请求过多，请稍后重试', 429);
    const value = rates.get(key) || { until: now + 60000, count: 0 };
    if (++value.count > max) M.fail('请求过多，请一分钟后重试', 429);
    rates.set(key, value);
  }
  async function authenticate(req) {
    requireProtection();
    const token = /^Bearer (poi_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
    const config = await credentials();
    const digest = token ? hash(token) : '';
    if (!config.digest || !digest || !crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(config.digest)))
      M.fail('需要有效的 Agent Bearer Token', 401);
    return config;
  }
  function summary(item) {
    return { id: item.id, status: item.status, receivedAt: item.receivedAt, source: item.payload.source,
      title: item.payload.fields.title || '未提供项目名称', projectCode: item.payload.fields.projectCode || '',
      ...(item.result ? { result: item.result } : {}) };
  }
  function receipt(topics, draftId) {
    for (const topic of topics) {
      const found = topic.integrationReceipts?.find(r => r.draftId === draftId);
      if (found) return { topic, found };
    }
    return null;
  }
  // Topic write is the commit point. Its receipt repairs a crash before the inbox write.
  async function recover(item, topics) {
    if (item.status !== 'pending') return item;
    const hit = receipt(topics, item.id);
    if (hit) {
      item.status = 'applied';
      item.result = { topicId: hit.topic.id, version: hit.found.version, appliedAt: hit.found.at, previewId: hit.found.previewId };
      await write(draftPath(item.id), item);
    }
    return item;
  }
  function checkBinding(topic, payload, topics) {
    const key = M.sourceKey(payload.source);
    const other = topics.find(t => t.id !== topic.id && t.feishuBinding && M.sourceKey(t.feishuBinding.source) === key);
    if (other) M.fail('这个飞书项目已经绑定到“' + other.title + '”，请先解除原绑定', 409);
    if (topic.feishuBinding) {
      if (M.sourceKey(topic.feishuBinding.source) !== key) M.fail('当前 Pocket OS 项目已绑定其他飞书项目，请先解除绑定', 409);
      if (Date.parse(payload.source.updatedAt) < Date.parse(topic.feishuBinding.source.updatedAt))
        M.fail('飞书数据比上次导入的版本更旧，请重新读取来源后提交', 409);
    }
  }
  function preview(value) {
    for (const [key, item] of previews) if (item.expiresAt < Date.now()) previews.delete(key);
    if (previews.size >= 200) M.fail('预览过多，请十分钟后重试', 429);
    const id = crypto.randomUUID(), item = { ...value, id, expiresAt: Date.now() + 600000 };
    previews.set(id, item); return item;
  }
  function getPreview(id, type) {
    const item = previews.get(id);
    if (!item || item.expiresAt < Date.now() || item.type !== type) M.fail('预览已失效，请重新预览', 409);
    return item;
  }
  function projectSnapshot(topic) {
    const out = { productionSteps: M.clone(topic.productionSteps || []), publishDate: topic.publishDate || '' };
    for (const key of [...Object.keys(M.fields), 'feishuBinding']) if (Object.prototype.hasOwnProperty.call(topic, key)) out[key] = M.clone(topic[key]);
    return out;
  }
  function restoreSnapshot(topic, snapshot) {
    const out = M.clone(topic);
    for (const key of [...Object.keys(M.fields), 'feishuBinding', 'productionSteps', 'publishDate']) {
      if (Object.prototype.hasOwnProperty.call(snapshot, key)) out[key] = M.clone(snapshot[key]);
      else delete out[key];
    }
    return out;
  }
  function addHistory(topic, entry) { topic.integrationHistory = [...(topic.integrationHistory || []), entry].slice(-30); }
  function announce(topic) { broadcast('topic-update', { id: topic.id, _version: topic._version, updatedAt: topic.updatedAt, title: topic.title }); }

  agent.use((req, res, next) => {
    route(async () => {
      rate('ip:' + req.socket.remoteAddress, 240);
      req.agentIdentity = (await authenticate(req)).id;
      rate('token:' + req.agentIdentity, 90);
      next();
    })(req, res);
  });
  agent.get('/schema', (req, res) => res.json(require('./import-openapi.json')));
  agent.post('/imports', route(async (req, res) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) M.fail('需要 Idempotency-Key 请求头（1～128 个字母、数字或 _ . : -）');
    const payload = M.normalize(req.body), digest = hash(JSON.stringify(payload));
    const result = await lock(async () => {
      const config = await authenticate(req);
      const id = 'fi_' + hash(config.id + ':' + key).slice(0, 40);
      const existing = await readJson(draftPath(id), null);
      if (existing) {
        if (existing.digest !== digest) M.fail('相同 Idempotency-Key 对应不同内容，请用新请求键', 409);
        return { item: await recover(existing, await readTopics()), repeated: true };
      }
      if ((await drafts()).filter(d => d.status === 'pending').length >= 250) M.fail('待确认导入已达 250 条，请先处理或忽略已有记录', 409);
      const item = { id, digest, owner: config.id, payload, status: 'pending', receivedAt: new Date().toISOString() };
      await write(draftPath(id), item);
      return { item, repeated: false };
    });
    broadcast('import-update', {});
    res.status(result.repeated ? 200 : 201).json({ ...summary(result.item), reviewPath: '/?import=' + result.item.id, repeated: result.repeated });
  }));
  agent.get('/imports/:id', route(async (req, res) => {
    const item = await lock(async () => {
      const value = await draft(req.params.id);
      if (value.owner !== req.agentIdentity) M.fail('该导入不属于当前凭证', 403);
      return recover(value, await readTopics());
    });
    res.json(summary(item));
  }));
  agent.get('/mappings', route(async (req, res) => {
    const source = { host: req.query.host || 'project.feishu.cn' };
    if (!['project.feishu.cn', 'meegle.com'].includes(source.host)) M.fail('来源站点无效');
    for (const key of ['projectKey', 'workItemType', 'templateId']) source[key] = M.id(req.query[key], key);
    const bindings = (await lock(readTopics)).map(t => t.feishuBinding).filter(b => b && M.templateKey(b.source) === M.templateKey(source));
    const mapping = {}, conflicts = new Set();
    for (const binding of bindings) for (const [key, value] of Object.entries(binding.mapping || {})) {
      if (mapping[key] && mapping[key] !== value) conflicts.add(key);
      mapping[key] = value;
    }
    res.json({ template: source, mapping, conflicts: [...conflicts], message: '仅为已确认的来源 ID 映射；日期和业务数据仍需从飞书重新读取。冲突字段必须由用户确认。' });
  }));
  agent.use((req, res) => res.status(403).json({ error: 'Agent 仅能提交导入草稿、读取自身处理结果和已确认映射，不能直接修改项目' }));

  admin.get('/config', route(async (req, res) => {
    const config = await credentials();
    res.json({ enabled: !!passwordEnabled, token: config.digest ? { active: true, createdAt: config.createdAt, suffix: config.suffix } : { active: false } });
  }));
  admin.use((req, res, next) => { try { requireProtection(); next(); } catch (e) { res.status(e.status).json({ error: e.message }); } });
  admin.use((req, res, next) => {
    if (req.method === 'POST' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)))
      return res.status(400).json({ error: '请求正文必须是 JSON 对象' });
    next();
  });
  admin.get('/schema', (req, res) => res.json(require('./import-openapi.json')));
  admin.post('/token', route(async (req, res) => {
    const token = 'poi_' + crypto.randomBytes(32).toString('base64url');
    await lock(() => write(credentialsFile, { id: crypto.randomUUID(), digest: hash(token), suffix: token.slice(-6), createdAt: new Date().toISOString() }));
    res.json({ token, message: '只显示一次；重新生成会立即撤销旧凭证。请存放在 Agent 密钥配置中。' });
  }));
  admin.delete('/token', route(async (req, res) => {
    await lock(() => write(credentialsFile, {})); res.json({ success: true });
  }));
  admin.get('/imports', route(async (req, res) => {
    const items = await lock(async () => {
      const topics = await readTopics(), result = [];
      for (const item of await drafts()) result.push(await recover(item, topics));
      return result;
    });
    const status = ['pending', 'applied', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
    const query = String(req.query.q || '').slice(0, 200).toLowerCase();
    const filtered = items.filter(d => d.status === status && [d.payload.fields.title, d.payload.fields.projectCode, d.payload.source.workItemId].join(' ').toLowerCase().includes(query));
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    res.json({ total: filtered.length, page, pages: Math.ceil(filtered.length / 30), items: filtered.slice((page - 1) * 30, page * 30).map(summary) });
  }));
  admin.get('/imports/:id', route(async (req, res) => {
    const result = await lock(async () => {
      const topics = await readTopics(), item = await recover(await draft(req.params.id), topics);
      const bound = topics.find(t => t.feishuBinding && M.sourceKey(t.feishuBinding.source) === M.sourceKey(item.payload.source));
      return { ...summary(item), payload: item.payload, boundTopicId: bound?.id || null };
    });
    res.json(result);
  }));
  admin.post('/imports/:id/dismiss', route(async (req, res) => {
    await lock(async () => {
      const item = await recover(await draft(req.params.id), await readTopics());
      if (item.status !== 'pending') M.fail('只能忽略待确认记录', 409);
      item.status = 'dismissed'; await write(draftPath(item.id), item);
    });
    res.json({ success: true });
  }));
  admin.post('/imports/:id/preview', route(async (req, res) => {
    const value = await lock(async () => {
      const topics = await readTopics(), item = await recover(await draft(req.params.id), topics);
      if (item.status !== 'pending') M.fail('该导入已处理，请提交新的导入记录', 409);
      if (!['bind', 'create'].includes(req.body.mode)) M.fail('请选择绑定已有项目或创建项目');
      let topic;
      if (req.body.mode === 'bind') {
        topic = topics.find(t => t.id === req.body.topicId);
        if (!topic) M.fail('请选择一个存在的 Pocket OS 项目', 404);
      } else {
        const title = M.string(req.body.title, '新项目名称');
        topic = M.newTopic('t_' + item.id, title, new Date().toISOString());
        if (topics.some(t => t.id === topic.id)) M.fail('目标项目已存在，请选择绑定或提交新记录', 409);
      }
      checkBinding(topic, item.payload, topics);
      const rows = M.rowsFor(topic, item.payload, req.body.mode);
      // The human-selected new name wins over the Agent's suggested title.
      if (req.body.mode === 'create') {
        const titleRow = rows.find(r => r.id === 'field:title');
        if (titleRow) { titleRow.locked = true; titleRow.selected = false; }
      }
      return preview({ type: 'import', draftId: item.id, mode: req.body.mode, topicId: topic.id,
        topicVersion: topic._version || 0, before: projectSnapshot(topic), newTopic: req.body.mode === 'create' ? topic : null, rows });
    });
    res.json({ previewId: value.id, expiresAt: value.expiresAt, topicId: value.topicId, topicVersion: value.topicVersion, rows: value.rows });
  }));
  admin.post('/imports/:id/apply', route(async (req, res) => {
    const result = await lock(async () => {
      const topics = await readTopics(), item = await recover(await draft(req.params.id), topics);
      if (item.status === 'applied' && item.result.previewId === req.body.previewId) return item.result;
      if (item.status !== 'pending') M.fail('导入已处理', 409);
      const p = getPreview(req.body.previewId, 'import');
      if (p.draftId !== item.id) M.fail('预览不匹配', 409);
      let topic = topics.find(t => t.id === p.topicId);
      if (p.mode === 'create') { if (topic) M.fail('目标项目已存在', 409); topic = p.newTopic; }
      else if (!topic || (topic._version || 0) !== p.topicVersion) M.fail('项目已被修改或删除，请重新预览', 409);
      checkBinding(topic, item.payload, topics);
      const applied = M.applyRows(topic, p.rows, req.body.selected, req.body);
      const at = new Date().toISOString(), next = applied.topic;
      const previousBinding = topic.feishuBinding && M.templateKey(topic.feishuBinding.source) === M.templateKey(item.payload.source)
        ? topic.feishuBinding : {};
      next.feishuBinding = { source: item.payload.source, lastImportedAt: at,
        lastSourceValues: { ...(previousBinding.lastSourceValues || {}), ...applied.values },
        mapping: { ...(previousBinding.mapping || {}), ...applied.mapping }, nodeStates: item.payload.nodes };
      const version = (topic._version || 0) + 1;
      next.integrationReceipts = [...(topic.integrationReceipts || []), { draftId: item.id, previewId: p.id, version, at }].slice(-1000);
      addHistory(next, { id: crypto.randomUUID(), kind: 'import', at, source: item.payload.source,
        draftId: item.id, before: p.before, changes: applied.applied, afterVersion: version, created: p.mode === 'create' });
      const saved = await saveTopic(p.mode === 'create' ? null : topic, next);
      // Never report failure after the topic commit; receipt recovery completes the inbox on retry.
      item.status = 'applied'; item.result = { topicId: saved.id, version: saved._version, appliedAt: at, previewId: p.id };
      await write(draftPath(item.id), item).catch(error => console.error('Import receipt pending:', error.message));
      announce(saved); previews.delete(p.id); return item.result;
    });
    res.json({ success: true, ...result });
  }));
  admin.post('/topics/:id/preview-action', route(async (req, res) => {
    const p = await lock(async () => {
      const topic = (await readTopics()).find(t => t.id === req.params.id);
      if (!topic) M.fail('项目不存在', 404);
      if (!['unlink', 'undo'].includes(req.body.action)) M.fail('未知操作');
      let history;
      if (req.body.action === 'unlink' && !topic.feishuBinding) M.fail('项目没有飞书绑定', 409);
      if (req.body.action === 'undo') {
        history = topic.integrationHistory?.at(-1);
        if (history?.kind !== 'import' || history.afterVersion !== topic._version) M.fail('导入后项目已有其他修改，不能整体撤回；请使用排期变更记录逐项恢复', 409);
      }
      return preview({ type: 'action', action: req.body.action, topicId: topic.id, topicVersion: topic._version,
        title: topic.title, history });
    });
    res.json({ previewId: p.id, action: p.action, title: p.title, changes: p.history?.changes || [],
      message: p.action === 'unlink' ? '仅解除飞书绑定，保留项目、全部日期和备注。' : '恢复到此次导入之前；新建项目仍保留，不会删除。' });
  }));
  admin.post('/topics/:id/apply-action', route(async (req, res) => {
    const result = await lock(async () => {
      const p = getPreview(req.body.previewId, 'action');
      if (p.topicId !== req.params.id) M.fail('预览不匹配', 409);
      const topics = await readTopics(), topic = topics.find(t => t.id === p.topicId);
      if (!topic || topic._version !== p.topicVersion) M.fail('项目已变化，请重新预览', 409);
      let next = M.clone(topic);
      if (p.action === 'unlink') delete next.feishuBinding;
      else {
        next = restoreSnapshot(topic, p.history.before);
        if (next.feishuBinding) checkBinding({ ...next, feishuBinding: undefined }, { source: next.feishuBinding.source }, topics);
      }
      addHistory(next, { id: crypto.randomUUID(), kind: p.action, at: new Date().toISOString(), changes: p.history?.changes || [] });
      const saved = await saveTopic(topic, next);
      announce(saved); previews.delete(p.id);
      return { topicId: saved.id, version: saved._version };
    });
    res.json({ success: true, ...result });
  }));
  admin.use((req, res) => res.status(404).json({ error: '导入接口不存在' }));
  return { agent, admin };
};
