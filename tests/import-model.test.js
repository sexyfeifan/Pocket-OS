'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const M = require('../import-model'), S = require('../schedule'), W = require('../workflow'), fixture = require('./import-fixture');
const fresh = () => M.newTopic('local','本地名称','2026-01-01T00:00:00Z');
test('导入字段严格白名单，广告三态、横竖屏多选和渠道分离', () => {
  const p = fixture(), out = M.normalize(p);
  assert.equal(out.fields.advertising, '有广告'); assert.equal(out.fields.formats.length, 2);
  p.fields.advertising = null; assert.equal(M.normalize(p).fields.advertising, '');
  p.fields.advertising = '无广告'; assert.equal(M.normalize(p).fields.advertising, '无广告');
  p.fields.advertising = false; assert.throws(() => M.normalize(p), /广告/);
  for (const extra of [{completed:true},{_version:5},{settings:{}},{productionSteps:[]}])
    assert.throws(() => M.normalize({ ...fixture(), ...extra }), /不支持字段/);
  const poison = JSON.parse(JSON.stringify(fixture())); poison.fields = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => M.normalize(poison), /不支持字段/); assert.equal({}.polluted, undefined);
});
test('日期、范围、重复节点、路径、来源时间和文档链接均拒绝非法值', () => {
  const invalid = [
    p => p.nodes[0].ranges[0].start = '2026-02-30',
    p => p.nodes[0].ranges[0].end = '2025-01-01',
    p => p.nodes[2].ranges[1] = {start:'2026-01-07',end:'2026-01-08'},
    p => p.nodes.push(p.nodes[0]),
    p => p.nodes[0].sourceNodeId = '../escape',
    p => p.source.workItemId = '../escape',
    p => p.source.url = 'http://project.feishu.cn/',
    p => p.source.url = 'https://other.invalid/',
    p => p.source.fetchedAt = '2099-01-01T00:00:00Z',
    p => p.source.updatedAt = '2026-01-01',
    p => p.fields.scriptDocument = 'javascript:alert(1)',
    p => p.nodes[0].ranges.push({start:'2026-01-05',end:'2026-01-05'}),
    p => p.nodes[5].ranges[0].end = '2026-01-21'
  ];
  for (const edit of invalid) { const p = fixture(); edit(p); assert.throws(() => M.normalize(p), e => e.status === 400); }
  // fieldKeys 接受 null 或空字符串，使用默认值
  const p = fixture(); delete p.fieldKeys.projectCode;
  const out = M.normalize(p);
  assert.equal(out.fieldKeys.projectCode, ''); // 删除后使用默认空字符串
});
test('发布日期字段为空仍从发布节点取日期；两个来源不同必须手选', () => {
  const topic = fresh(), p = M.normalize(fixture());
  let rows = M.rowsFor(topic,p,'create'), publish = rows.find(r => r.id === 'step:publish');
  assert.equal(publish.incoming[0].start,'2026-01-20');
  assert.equal(M.applyRows(topic, rows, ['step:publish']).topic.publishDate,'2026-01-20');
  p.fields.publishDate = '2026-01-21';
  rows = M.rowsFor(topic,p,'create'); publish = rows.find(r => r.id === 'step:publish');
  assert.equal(publish.selected,false); assert.equal(publish.options.length,2);
  assert.throws(() => M.applyRows(topic,rows,['step:publish']), /两个不同来源/);
  const applied = M.applyRows(topic,rows,['step:publish'],{choices:{'step:publish':'field'}});
  assert.equal(applied.topic.publishDate,'2026-01-21'); assert.equal(applied.mapping['step:publish'],'field_publish');
});
test('只改勾选节点，不倒排、不合并拍摄间隔，不改变人工完成、跳过或暂停', () => {
  const topic = fresh();
  S.setRanges(topic.productionSteps[3],[{start:'2026-05-01',end:'2026-05-03'}]);
  const shoot = topic.productionSteps[2]; shoot.done = true; shoot.skipped = true; shoot.exception = {kind:'paused',reason:'人工暂停'};
  topic.canboxImport = { marker:'保留通告' }; topic.notes = {'2026-01-08':'保留备注'};
  topic.completed = true; topic.completedAt = '2026-01-01';
  const before = M.clone(topic), rows = M.rowsFor(topic,M.normalize(fixture()),'bind');
  const out = M.applyRows(topic,rows,['step:shoot']).topic;
  assert.deepEqual(out.productionSteps[3], before.productionSteps[3]);
  assert.equal(out.productionSteps[2].segments.length,2); assert.equal(out.productionSteps[2].done,true);
  assert.equal(out.productionSteps[2].skipped,true); assert.deepEqual(out.productionSteps[2].exception,shoot.exception);
  assert.deepEqual(out.notes,topic.notes); assert.deepEqual(out.canboxImport,topic.canboxImport); assert.equal(out.completed,true);
  assert.deepEqual(topic,before);
});
test('空值默认不覆盖；清空需要额外确认；未提交字段不出现', () => {
  const topic = fresh(); topic.projectCode = 'EXISTING'; topic.advertising = '有广告';
  const p = fixture(); p.fields.projectCode = null; delete p.fields.advertising;
  const rows = M.rowsFor(topic,M.normalize(p),'bind');
  const row = rows.find(r => r.id === 'field:projectCode');
  assert.equal(row.clear,true); assert.equal(row.selected,false);
  assert(!rows.some(r => r.id === 'field:advertising'));
  assert.throws(() => M.applyRows(topic,rows,['field:projectCode']), /单独确认/);
  assert.equal(M.applyRows(topic,rows,['field:projectCode'],{allowClear:true}).topic.projectCode,'');
  assert.equal(M.applyRows(topic,rows,[]).topic.advertising,'有广告');
});
test('两边变化与来源 ID 改动明确提示，模板身份不混用', () => {
  const topic = fresh(); topic.projectCode = 'LOCAL';
  topic.feishuBinding = {lastSourceValues:{'field:projectCode':'OLD'},mapping:{'field:projectCode':'old_field'}};
  const rows = M.rowsFor(topic,M.normalize(fixture()),'bind'), r = rows.find(r => r.id === 'field:projectCode');
  assert(r.bothChanged); assert(r.mappingChanged); assert(!r.selected);
  assert.throws(() => M.applyRows(topic,rows,['field:projectCode']), /映射变化/);
  assert.equal(M.applyRows(topic,rows,['field:projectCode'],{allowMappingChange:true}).topic.projectCode,'DEMO-001');
  assert.notEqual(M.templateKey(fixture().source),M.templateKey({...fixture().source,templateId:'another'}));
  topic.feishuBinding.source = {...fixture().source,templateId:'another'};
  const changed = M.rowsFor(topic,M.normalize(fixture()),'bind');
  assert(changed.every(r => r.mappingChanged && !r.selected));
});
test('清空导入日期保留旧版延期与当前异常，不影响其他节点', () => {
  const topic = fresh(), step = topic.productionSteps[1];
  S.setRanges(step,[{start:'2026-01-04',end:'2026-01-04'}]);
  Object.assign(step,{delayed:true,_prevStart:'2026-01-03',_prevEnd:'2026-01-03',done:true,exception:{kind:'waiting'}});
  const p = fixture(); p.nodes.find(n => n.key === 'script').ranges=[];
  const out = M.applyRows(topic,M.rowsFor(topic,M.normalize(p),'bind'),['step:script'],{allowClear:true}).topic;
  assert.equal(out.productionSteps[1].startDate,''); assert(out.productionSteps[1].delayed); assert(out.productionSteps[1].done);
  assert.equal(out.productionSteps[1]._prevStart,'2026-01-03'); assert.deepEqual(out.productionSteps[1].exception,step.exception);
  assert.deepEqual(out.productionSteps[0],topic.productionSteps[0]);
});
test('新建人工名称锁定时仍保留真实的来源名称基线', () => {
  const topic=fresh(), p=M.normalize(fixture()), rows=M.rowsFor(topic,p,'create');
  const row=rows.find(r=>r.id==='field:title'); row.locked=true; row.selected=false;
  const result=M.applyRows(topic,rows,[]);
  assert.equal(result.topic.title,'本地名称'); assert.equal(result.values['field:title'],p.fields.title);
  assert.throws(()=>M.applyRows(topic,rows,['field:title']),/上一步/);
});
test('接口规范版本及字段与实现一致，所有本地引用可以解析', () => {
  const doc=JSON.parse(fs.readFileSync(path.join(__dirname,'..','import-openapi.json'),'utf8'));
  assert.equal(doc.openapi,'3.1.0');
  const schema=doc.components.schemas.Import;
  assert.deepEqual(Object.keys(schema.properties.fields.properties).sort(),[...Object.keys(M.fields),'publishDate'].sort());
  assert(schema.required.every(k=>Object.hasOwn(fixture(),k)));
  function visit(v) { if (!v || typeof v!=='object')return;
    if(v.$ref) assert(v.$ref.split('/').slice(1).reduce((o,k)=>o?.[k],doc),v.$ref);
    Object.values(v).forEach(visit);
  }
  visit(doc);
  assert.doesNotThrow(()=>W.businessText({formats:null,cooperationPlatforms:'legacy'}));
});
test('导入的新项目不按飞书状态自动完成；只读只展示业务资料', () => {
  const topic = fresh(), p = M.normalize(fixture()), rows = M.rowsFor(topic,p,'create');
  const out = M.applyRows(topic,rows,rows.filter(r=>r.selected).map(r=>r.id)).topic;
  out.feishuBinding = {secret:'HIDDEN'}; out.integrationHistory = [{secret:'HIDDEN'}]; out.scriptDocument = 'https://example.invalid/HIDDEN';
  assert(out.productionSteps.every(s=>!s.done)); assert.equal(out.completed,false);
  const view = W.publicTopic(out);
  assert.equal(view.projectCode,'DEMO-001'); assert.equal(view.advertising,'有广告'); assert(!JSON.stringify(view).includes('HIDDEN'));
  assert(W.businessText(view).includes('合作：抖音')); assert.equal(view.platforms.length,0);
});
test('界面转义来源文本，不执行链接脚本；前后端新脚本可解析', () => {
  const context = vm.createContext({URL,PocketWorkflow:W});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','imports.js'),'utf8'),context);
  const t = fresh(); t.title = '<script>'; t.projectCode = '<img src=x onerror=alert(1)>'; t.scriptDocument = 'javascript:evil()';
  t.feishuBinding = {source:{url:'javascript:evil()',workItemId:'<img>',fetchedAt:'2026-01-01'},nodeStates:[{sourceName:'<svg onload=alert(1)>',ranges:[],status:'doing'}]};
  context.topic = t;
  const html = vm.runInContext('PocketImports.businessHtml(topic)+PocketImports.bindingHtml(topic)',context);
  assert(!html.includes('<img')); assert(!html.includes('<svg')); assert(!html.includes('href="javascript:'));
  for(const file of ['imports.js','imports-server.js','import-model.js']) new vm.Script(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
});
