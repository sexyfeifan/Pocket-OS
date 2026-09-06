const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let child;
let dataDir;
let baseUrl;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', err => err ? reject(err) : resolve()));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/system`);
      if (res.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('test server did not start');
}

async function json(pathname, options = {}) {
  const res = await fetch(baseUrl + pathname, options);
  const body = await res.json();
  return { res, body };
}

test.before(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pocket-os-test-'));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), POCKET_OS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();
});

test.after(async () => {
  if (child && !child.killed) child.kill('SIGTERM');
  await fsp.rm(dataDir, { recursive: true, force: true });
});

test('完整恢复会删除备份中不存在的旧选题', async () => {
  const first = {
    settings: {},
    topics: [
      { id: 'keep', title: 'Keep', productionSteps: [] },
      { id: 'stale', title: 'Stale', productionSteps: [] }
    ]
  };
  assert.equal((await json('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(first) })).res.status, 200);

  const second = { settings: {}, topics: [{ id: 'keep', title: 'Keep updated', productionSteps: [] }] };
  assert.equal((await json('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(second) })).res.status, 200);

  const latest = await json('/api/data');
  assert.deepEqual(latest.body.topics.map(topic => topic.id), ['keep']);
});

test('全量导入拒绝目录穿越和重复 ID', async () => {
  const traversal = await json('/api/data', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: {}, topics: [{ id: '../escaped', title: 'bad' }] })
  });
  assert.equal(traversal.res.status, 400);
  assert.equal(fs.existsSync(path.join(dataDir, 'escaped.json')), false);

  const duplicate = await json('/api/data', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: {}, topics: [{ id: 'same' }, { id: 'same' }] })
  });
  assert.equal(duplicate.res.status, 400);
});

test('旧版本保存返回冲突且不会覆盖服务器数据', async () => {
  const created = await json('/api/topic/conflict_test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'conflict_test', title: 'server copy', _version: 0, productionSteps: [] })
  });
  assert.equal(created.res.status, 200);
  assert.equal(created.body._version, 1);

  const stale = await json('/api/topic/conflict_test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'conflict_test', title: 'stale overwrite', _version: 0, productionSteps: [] })
  });
  assert.equal(stale.res.status, 409);
  assert.equal(stale.body.serverTopic.title, 'server copy');

  const latest = await json('/api/data');
  assert.equal(latest.body.topics.find(topic => topic.id === 'conflict_test').title, 'server copy');
});

test('单选题保存要求 URL 与正文 ID 一致', async () => {
  const result = await json('/api/topic/url_id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'body_id', title: 'bad', _version: 0 })
  });
  assert.equal(result.res.status, 400);
});

test('日志查询按最新记录优先返回', async () => {
  const date = new Date().toISOString().slice(0, 10);
  for (const action of ['first', 'second']) {
    const result = await json('/api/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, timestamp: `${date}T12:00:00.000Z` })
    });
    assert.equal(result.res.status, 200);
  }
  const logs = await json(`/api/logs?date=${date}&page=1`);
  assert.deepEqual(logs.body.logs.slice(0, 2).map(log => log.action), ['second', 'first']);
});
