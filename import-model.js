'use strict';

// A deliberately small, versioned contract. Agent input never becomes a topic directly.
const S = require('./schedule');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fields = {
  title: '项目名称', projectCode: '项目号', formats: '横竖屏', advertising: '广告项目',
  cooperationPlatforms: '合作渠道', platforms: '发布平台',
  outlineDocument: '大纲文档', scriptDocument: '脚本文档'
};
const steps = {
  outline: ['大纲提交', '#C2B4DB'], script: ['脚本', '#A3D9A5'], shoot: ['拍摄', '#A5C8E1'],
  acopy: ['ACO', '#F2D98B'], bcopy: ['BCO', '#E8C97A'], publish: ['发布', '#B37D56']
};
const protectedKeys = ['feishuBinding', 'integrationHistory', 'integrationReceipts'];
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' 必须是对象');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(label + ' 不支持字段：' + key);
}
function string(value, label, max = 200, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(label + ' 格式无效');
  return value.trim();
}
function id(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail(label + ' 格式无效');
  return value;
}
function instant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
      || !S.validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)))
    fail(label + ' 需要带时区的 ISO 时间，格式如：2026-09-20T22:00:00+08:00 或 2026-09-20T22:00:00Z');
  return new Date(value).toISOString();
}
function link(value, label) {
  if (value === null || value === '') return '';
  string(value, label, 2000);
  let url; try { url = new URL(value); } catch { fail(label + ' 不是有效链接'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail(label + ' 只接受不含凭证的 HTTPS 链接');
  return url.href;
}
function fieldValue(key, value) {
  // 接受 null 值，转换为空值
  if (value === null) {
    if (key === 'title') fail('项目名称不能为 null');
    if (['formats', 'cooperationPlatforms', 'platforms'].includes(key)) return [];
    if (key === 'advertising') return '';
    if (key.endsWith('Document')) return '';
    return '';
  }
  if (['formats', 'cooperationPlatforms', 'platforms'].includes(key)) {
    if (!Array.isArray(value) || value.length > 20) fail(fields[key] + ' 需要数组或 null');
    const values = [...new Set(value.map(v => string(v, fields[key], 60)))].sort();
    if (key === 'formats' && values.some(v => !['横屏', '竖屏'].includes(v))) fail('横竖屏仅接受横屏、竖屏');
    return values;
  }
  if (key === 'advertising') {
    if (value === '') return '';
    if (!['有广告', '无广告'].includes(value)) fail('广告项目仅接受有广告、无广告、null 或空字符串');
    return value;
  }
  if (key.endsWith('Document')) return link(value, fields[key]);
  return string(value, fields[key], key === 'projectCode' ? 100 : 200, key !== 'title');
}
function sourceKey(source) { return [source.host, source.projectKey, source.workItemType, source.workItemId].join('/'); }
function templateKey(source) { return [source.host, source.projectKey, source.workItemType, source.templateId].join('/'); }
function normalize(input, now = Date.now()) {
  object(input, '导入', ['schemaVersion', 'source', 'fields', 'nodes', 'fieldKeys']);
  if (input.schemaVersion !== 1) fail('schemaVersion 必须为 1');
  object(input.source, 'source', ['host', 'projectKey', 'workItemType', 'workItemId', 'templateId', 'url', 'updatedAt', 'fetchedAt']);
  const source = { host: input.source.host };
  if (!['project.feishu.cn', 'meegle.com'].includes(source.host)) fail('仅支持官方飞书项目 / Meegle 来源');
  for (const key of ['projectKey', 'workItemType', 'workItemId', 'templateId']) source[key] = id(input.source[key], key);
  source.url = link(input.source.url, '来源链接');
  if (!source.url || new URL(source.url).hostname !== source.host) fail('来源链接必须属于来源站点');
  for (const key of ['updatedAt', 'fetchedAt']) source[key] = instant(input.source[key], key);
  if (Date.parse(source.updatedAt) > Date.parse(source.fetchedAt) || Date.parse(source.fetchedAt) > now + 300000)
    fail('来源时间无效：更新时间不能晚于读取时间，读取时间不能在未来');
  object(input.fields, 'fields', [...Object.keys(fields), 'publishDate']);
  object(input.fieldKeys, 'fieldKeys', [...Object.keys(fields), 'publishDate']);
  const values = {}, fieldKeys = {};
  for (const key of Object.keys(input.fields).sort()) {
    if (key === 'publishDate') {
      if (input.fields[key] !== null && input.fields[key] !== '' && !S.validDate(input.fields[key])) fail('发布时间不是有效日期，格式如：2026-09-20');
      values[key] = input.fields[key] || '';
    } else values[key] = fieldValue(key, input.fields[key]);
    // fieldKeys 接受 null 或空字符串，使用默认值
    const fieldKey = input.fieldKeys?.[key];
    if (fieldKey === null || fieldKey === '' || fieldKey === undefined) {
      fieldKeys[key] = key === 'title' ? 'name' : '';
    } else {
      fieldKeys[key] = id(fieldKey, key + ' 对应的飞书字段 ID');
    }
  }
  if (!Array.isArray(input.nodes) || input.nodes.length > 6) fail('nodes 需要数组，最多六个映射节点');
  const seen = new Set();
  const nodes = input.nodes.map(node => {
    object(node, 'node', ['key', 'sourceNodeId', 'sourceName', 'ranges', 'status', 'actualStart', 'actualEnd']);
    if (!own(steps, node.key) || seen.has(node.key)) fail('未知或重复节点：' + node.key);
    seen.add(node.key);
    const result = { key: node.key, sourceNodeId: id(node.sourceNodeId, '来源节点 ID'),
      sourceName: string(node.sourceName, '来源节点名称', 100) };
    if (!Array.isArray(node.ranges) || node.ranges.length > (node.key === 'shoot' ? 30 : 1)) fail('仅拍摄支持多个不连续日期段');
    const rs = node.ranges.map(r => { object(r, '日期段', ['start', 'end']); return { start: r.start, end: r.end }; });
    const step = { key: node.key };
    try { S.setRanges(step, rs); } catch (error) { fail(error.message); }
    result.ranges = S.ranges(step);
    if (!['not_started', 'doing', 'finished', 'unknown'].includes(node.status)) fail('来源节点状态无效');
    result.status = node.status;
    for (const key of ['actualStart', 'actualEnd']) if (node[key] != null) result[key] = instant(node[key], key);
    if (result.actualStart && result.actualEnd && result.actualStart > result.actualEnd) fail('实际结束时间不能早于开始时间');
    return result;
  }).sort((a, b) => a.key.localeCompare(b.key));
  return { schemaVersion: 1, source, fields: values, fieldKeys, nodes };
}
function rawRanges(step) {
  return S.ranges(step ? { ...step, skipped: false } : null).map(({ start, end }) => ({ start, end }));
}
function currentField(topic, key) {
  const value = topic[key];
  if (['formats', 'cooperationPlatforms', 'platforms'].includes(key)) return Array.isArray(value) ? [...value].sort() : [];
  return value ?? '';
}
function empty(value) { return value === '' || value === null || (Array.isArray(value) && !value.length); }
function rowsFor(topic, payload, mode) {
  const base = topic.feishuBinding?.lastSourceValues || {}, oldMapping = topic.feishuBinding?.mapping || {};
  const templateChanged = !!topic.feishuBinding?.source && templateKey(topic.feishuBinding.source) !== templateKey(payload.source);
  const rows = Object.keys(fields).filter(k => own(payload.fields, k)).map(key => ({
    id: 'field:' + key, label: fields[key], kind: 'field', key, current: currentField(topic, key),
    incoming: payload.fields[key], sourceKey: payload.fieldKeys[key]
  }));
  for (const key of Object.keys(steps)) {
    const node = payload.nodes.find(n => n.key === key);
    if (!node && !(key === 'publish' && own(payload.fields, 'publishDate'))) continue;
    const currentStep = (topic.productionSteps || []).find(s => s.key === key);
    const current = rawRanges(currentStep);
    if (key === 'publish' && !currentStep && S.validDate(topic.publishDate)) current.push({ start: topic.publishDate, end: topic.publishDate });
    const row = { id: 'step:' + key, key, kind: 'step', label: steps[key][0], current,
      incoming: node?.ranges || [], sourceKey: node?.sourceNodeId || payload.fieldKeys.publishDate,
      sourceName: node?.sourceName, sourceStatus: node?.status, skipped: !!currentStep?.skipped };
    if (key === 'publish' && payload.fields.publishDate) {
      const fromField = [{ start: payload.fields.publishDate, end: payload.fields.publishDate }];
      if (node?.ranges.length && !same(node.ranges, fromField)) {
        row.options = [
          { id: 'node', label: '发布节点', value: node.ranges, sourceKey: node.sourceNodeId },
          { id: 'field', label: '发布时间字段', value: fromField, sourceKey: payload.fieldKeys.publishDate }
        ];
      } else if (!node?.ranges.length) { row.incoming = fromField; row.sourceKey = payload.fieldKeys.publishDate; }
    }
    rows.push(row);
  }
  for (const row of rows) {
    row.previous = own(base, row.id) ? base[row.id] : null;
    row.changed = !same(row.current, row.incoming);
    row.clear = empty(row.incoming) && !empty(row.current);
    row.conflict = row.changed && !empty(row.current);
    row.bothChanged = own(base, row.id) && !same(row.current, base[row.id]) && !same(row.incoming, base[row.id]) && row.changed;
    row.mappingChanged = templateChanged || (!!oldMapping[row.id] &&
      (oldMapping[row.id] !== row.sourceKey || row.options?.some(o => o.sourceKey !== oldMapping[row.id])));
    row.selected = !row.options && !row.mappingChanged && !empty(row.incoming) && (mode === 'create' || empty(row.current));
  }
  return rows;
}
function newTopic(topicId, title, now) {
  return { id: topicId, title, category: '内容', platforms: [], productionSteps: S.blankSteps(
    Object.entries(steps).map(([key, [name, color]]) => ({ key, name, color }))),
  preparationTasks: [], publishDate: '', progressionMode: 'calendar', timeZone: 'Asia/Shanghai',
  projectStatus: 'normal', completed: false, createdAt: now, updatedAt: now, _version: 0 };
}
function applyRows(topic, rows, selected, options = {}) {
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(k => !rows.some(r => r.id === k)))
    fail('只能应用预览中列出的字段');
  const out = clone(topic), applied = [], values = {}, mapping = {};
  if (!Array.isArray(out.productionSteps)) out.productionSteps = [];
  for (const row of rows) {
    let incoming = row.incoming, sourceId = row.sourceKey;
    if (selected.includes(row.id) && row.options) {
      const option = row.options.find(o => o.id === options.choices?.[row.id]);
      if (!option) fail('发布时间有两个不同来源，请先选择');
      incoming = option.value; sourceId = option.sourceKey;
    }
    values[row.id] = clone(incoming);
    if (!selected.includes(row.id)) continue;
    if (row.locked) fail('新项目名称使用你在上一步确认的名称，请返回上一步修改');
    if (empty(incoming) && !empty(row.current) && options.allowClear !== true) fail('清空现有值需要单独确认');
    if (row.mappingChanged && options.allowMappingChange !== true) fail('来源字段 / 节点已改变，请确认映射变化');
    if (row.kind === 'field') out[row.key] = clone(incoming);
    else {
      let step = out.productionSteps.find(s => s.key === row.key);
      if (!step) { step = S.blankSteps([{ key: row.key, name: steps[row.key][0], color: steps[row.key][1] }])[0]; out.productionSteps.push(step); }
      const flags = {};
      for (const key of ['skipped', 'delayed', '_prevStart', '_prevEnd']) if (own(step, key)) flags[key] = clone(step[key]);
      S.setRanges(step, incoming);
      // Date imports never silently change applicability, actual completion, or exceptions.
      Object.assign(step, flags);
      if (row.key === 'publish') S.syncPublish(out);
    }
    mapping[row.id] = sourceId;
    applied.push({ id: row.id, label: row.label, before: clone(row.current), after: clone(incoming), sourceKey: sourceId });
  }
  return { topic: out, applied, values, mapping };
}
function protectedMetadata(existing, next) {
  for (const key of protectedKeys) {
    if (existing && own(existing, key)) next[key] = clone(existing[key]);
    else delete next[key];
  }
}
function businessFieldsValid(topic) {
  for (const key of Object.keys(fields).filter(k => k !== 'title')) if (own(topic, key)) fieldValue(key, topic[key]);
}
module.exports = { normalize, sourceKey, templateKey, rowsFor, applyRows, newTopic, protectedMetadata,
  businessFieldsValid, clone, same, fields, steps, fail, id, string, empty };
