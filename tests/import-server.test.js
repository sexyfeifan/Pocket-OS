'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fixture = require('./import-fixture');
let dir, base, port, child, token;
const adminBase = '/api/integrations/feishu', agentBase = '/api/agent/v1';
const auth = role => ({ Authorization:'Basic ' + Buffer.from(role + ':' + (role === 'editor' ? 'import-test-editor' : 'import-test-viewer')).toString('base64') });
async function call(url, { method='GET', body, role='editor', key, bearer=token, headers={} } = {}) {
  return fetch(base + url, { method, headers:{'Content-Type':'application/json',
    ...(role === 'agent' ? {Authorization:'Bearer ' + bearer} : role ? auth(role) : {}),
    ...(key ? {'Idempotency-Key':key} : {}), ...headers },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
}
async function json(res, status=200) { const text = await res.text(); assert.equal(res.status,status,text); return JSON.parse(text); }
async function start(protectedMode=true) {
  child = spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),
    env:{...process.env,PORT:String(port),POCKET_OS_DATA_DIR:dir,POCKET_OS_PASSWORD:protectedMode?'import-test-editor':'',POCKET_OS_VIEW_PASSWORD:protectedMode?'import-test-viewer':''},stdio:'ignore'});
  for(let i=0;i<120;i++) { try { if((await call('/api/system')).ok)return; } catch {} await new Promise(r=>setTimeout(r,30)); }
  throw new Error('isolated server did not start');
}
async function stop() { if(child?.exitCode === null) { const done = new Promise(r=>child.once('exit',r)); child.kill(); await done; } }
async function createToken() { token = (await json(await call(adminBase+'/token',{method:'POST',body:{}}))).token; return token; }
async function submit(name, edit) {
  const payload = fixture(name); if(edit)edit(payload);
  return {payload,...await json(await call(agentBase+'/imports',{method:'POST',role:'agent',key:crypto.randomUUID(),body:payload}),201)};
}
async function preview(item, mode='create', extra={}) {
  return json(await call(adminBase+'/imports/'+item.id+'/preview',{method:'POST',body:{mode,title:'人工确认名称',...extra}}));
}
async function apply(item, p, selected=p.rows.filter(r=>r.selected).map(r=>r.id), extra={}) {
  return json(await call(adminBase+'/imports/'+item.id+'/apply',{method:'POST',body:{previewId:p.previewId,selected,...extra}}));
}
async function topic(id) { return (await json(await call('/api/data'))).topics.find(t=>t.id===id); }
test.before(async()=>{
  dir = await fs.mkdtemp(path.join(os.tmpdir(),'pocket-import-test-'));
  const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));port=s.address().port;await new Promise(r=>s.close(r));
  base='http://127.0.0.1:'+port;await start();await createToken();
});
test.after(async()=>{await stop();if(dir)await fs.rm(dir,{recursive:true,force:true});});

test('Agent / 管理 / 查看凭证完全隔离，Token 不泄露到备份或配置',async()=>{
  for(const role of [null,'viewer','editor']) assert.equal((await call(agentBase+'/schema',{role})).status,401);
  assert.equal((await call(agentBase+'/schema',{role:'agent'})).status,200);
  for(const p of ['/api/data','/api/export','/api/settings',adminBase+'/config','/imports.js'])
    assert.equal((await call(p,{role:'agent'})).status,403,p);
  for(const p of [adminBase+'/config',adminBase+'/imports','/imports.js','/imports.css'])
    assert.equal((await call(p,{role:'viewer'})).status,403,p);
  for(const [p,method] of [[agentBase+'/topics','POST'],[agentBase+'/imports/fi_'+'a'.repeat(40),'DELETE'],['/api/topic/test','POST']])
    assert.equal((await call(p,{role:'agent',method,body:{}})).status,403,p);
  const config = await json(await call(adminBase+'/config')), backup=await(await call('/api/export')).text();
  assert(!JSON.stringify(config).includes(token)); assert(!backup.includes(token));
  const credentials=await fs.readFile(path.join(dir,'integrations','feishu-credentials.json'),'utf8');
  assert(!credentials.includes(token)); assert(credentials.includes('digest'));
});
test('输入白名单、无效日期、目录穿越、跨站和超大请求被拒绝',async()=>{
  for(const edit of [p=>p.settings={},p=>p.source.workItemId='../escape',p=>p.nodes[0].ranges[0].end='2026-02-30']) {
    const p=fixture();edit(p);assert.equal((await call(agentBase+'/imports',{method:'POST',role:'agent',key:crypto.randomUUID(),body:p})).status,400);
  }
  assert.equal((await call(agentBase+'/imports',{method:'POST',role:'agent',body:fixture()})).status,400);
  assert.equal((await call(agentBase+'/imports',{method:'POST',role:'agent',key:'cross',body:fixture(),headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await call(agentBase+'/imports',{method:'POST',role:'agent',key:'large',body:{huge:'x'.repeat(70000)}})).status,413);
  assert.equal((await fs.readdir(path.join(dir,'topics'))).length,0);
});
test('提交与预览都不写项目；相同请求去重，不同正文复用键返回冲突',async()=>{
  const p=fixture('retry'),key='same-operation';
  const first=await json(await call(agentBase+'/imports',{method:'POST',role:'agent',key,body:p}),201);
  const retry=await json(await call(agentBase+'/imports',{method:'POST',role:'agent',key,body:p}));
  assert.equal(first.id,retry.id); assert.equal(retry.repeated,true);
  p.fields.title='different';assert.equal((await call(agentBase+'/imports',{method:'POST',role:'agent',key,body:p})).status,409);
  const before=await fs.readdir(path.join(dir,'topics'));await preview(first);
  assert.deepEqual(await fs.readdir(path.join(dir,'topics')),before);
});
test('新建由人确认名称，两个并发确认只创建一次，日期与发布一致且状态不伪造',async()=>{
  const item=await submit('create'),p=await preview(item);
  const selected=p.rows.filter(r=>r.selected).map(r=>r.id);
  const results=await Promise.all([apply(item,p,selected),apply(item,p,selected)]);
  assert.equal(results[0].topicId,results[1].topicId);assert.equal(results[0].version,1);
  const t=await topic(results[0].topicId);
  assert.equal(t.title,'人工确认名称');assert.equal(t.projectCode,'DEMO-001');assert.equal(t.advertising,'有广告');
  assert.deepEqual(t.cooperationPlatforms,['抖音']);assert.deepEqual(t.platforms,[]);
  assert.equal(t.publishDate,'2026-01-20');assert.equal(t.productionSteps.find(s=>s.key==='shoot').segments.length,2);
  assert(t.productionSteps.every(s=>s.done===false));assert.equal(t.completed,false);
  assert.equal(t.feishuBinding.source.workItemId,'create');assert.equal(t.integrationHistory.length,1);
  assert.equal(t.feishuBinding.lastSourceValues['field:title'],item.payload.fields.title);
  assert.equal((await json(await call(agentBase+'/imports/'+item.id,{role:'agent'}))).status,'applied');
  const viewer=await(await call('/api/view/data',{role:'viewer'})).text();
  assert(viewer.includes('DEMO-001'));assert(!viewer.includes('feishuBinding'));assert(!viewer.includes('integrationHistory'));
});
test('绑定已有项目只改勾选项，保留备注、Canbox、人工完成、暂停和其他日期',async()=>{
  const local={id:'existing',title:'保留本地名',_version:0,projectCode:'LOCAL',notes:{'2026-01-08':'备注'},canboxImport:{marker:'保留'},
    publishDate:'2026-03-01',productionSteps:[{key:'acopy',name:'自定义剪辑名',startDate:'2026-02-01',endDate:'2026-02-03',done:true,exception:{kind:'waiting',reason:'原异常'}},
      {key:'publish',name:'发布',startDate:'2026-03-01',endDate:'2026-03-01'}]};
  await json(await call('/api/topic/existing',{method:'POST',body:local}));
  const item=await submit('bind'),p=await preview(item,'bind',{topicId:'existing'});
  assert.equal(p.rows.find(r=>r.id==='field:title').selected,false);
  await apply(item,p,['step:acopy']);
  const t=await topic('existing');assert.equal(t.title,local.title);assert.equal(t.projectCode,'LOCAL');
  assert.deepEqual(t.notes,local.notes);assert.deepEqual(t.canboxImport,local.canboxImport);
  assert.equal(t.publishDate,'2026-03-01');assert.deepEqual(t.productionSteps[1],local.productionSteps[1]);
  assert.equal(t.productionSteps[0].done,true);assert.deepEqual(t.productionSteps[0].exception,local.productionSteps[0].exception);
  assert.equal(t.productionSteps[0].name,'自定义剪辑名');assert.equal(t.productionSteps[0].startDate,'2026-01-15');
  assert.equal(t.integrationHistory.at(-1).changes.length,1);
});
test('唯一来源禁止重复绑定；只建立绑定不改内容；不按同名自动匹配',async()=>{
  const duplicate=await submit('bind');assert.equal((await call(adminBase+'/imports/'+duplicate.id+'/preview',{method:'POST',body:{mode:'create',title:'同名也不建'}})).status,409);
  const item=await submit('bind-only'),p=await preview(item);
  const result=await apply(item,p,[]),t=await topic(result.topicId);
  assert.equal(t.title,'人工确认名称');assert.equal(t.publishDate,'');assert(t.productionSteps.every(s=>s.cleared));assert.equal(t.advertising,undefined);
  const other=await submit('another-source');
  assert.equal((await call(adminBase+'/imports/'+other.id+'/preview',{method:'POST',body:{mode:'bind',topicId:t.id}})).status,409);
});
test('预览后的项目修改导致 409，过期预览不覆盖新日期',async()=>{
  const item=await submit('bind'),p=await preview(item,'bind',{topicId:'existing'});
  const t=await topic('existing');t.title='预览之后的新名称';
  await json(await call('/api/topic/existing',{method:'POST',body:t}));
  const result=await call(adminBase+'/imports/'+item.id+'/apply',{method:'POST',body:{previewId:p.previewId,selected:['field:title']}});
  assert.equal(result.status,409);assert.equal((await topic('existing')).title,t.title);
  assert.equal((await call(adminBase+'/imports/'+item.id+'/apply',{method:'POST',body:{previewId:'missing',selected:[]}})).status,409);
});
test('发布时间双来源冲突必须选择；清空日期需要独立确认',async()=>{
  const item=await submit('publish-conflict',p=>p.fields.publishDate='2026-01-21'),p=await preview(item);
  assert.equal((await call(adminBase+'/imports/'+item.id+'/apply',{method:'POST',body:{previewId:p.previewId,selected:['step:publish']}})).status,400);
  const result=await apply(item,p,['step:publish'],{choices:{'step:publish':'field'}});
  assert.equal((await topic(result.topicId)).publishDate,'2026-01-21');
  const clear=await submit('publish-conflict',p=>{p.nodes=p.nodes.filter(n=>n.key==='publish');p.nodes[0].ranges=[];p.fields={publishDate:null};p.fieldKeys={publishDate:'field_publish'};});
  const cp=await preview(clear,'bind',{topicId:result.topicId});
  assert.equal((await call(adminBase+'/imports/'+clear.id+'/apply',{method:'POST',body:{previewId:cp.previewId,selected:['step:publish']}})).status,400);
  await apply(clear,cp,['step:publish'],{allowClear:true,allowMappingChange:true});
  assert.equal((await topic(result.topicId)).publishDate,'');
});
test('普通保存不能伪造或清除绑定、回执与导入历史；较旧的飞书快照拒绝应用',async()=>{
  const t=await topic('existing'),binding=t.feishuBinding;
  t.feishuBinding={source:{workItemId:'forged'}};t.integrationHistory=[];t.integrationReceipts=[];
  await json(await call('/api/topic/existing',{method:'POST',body:t}));
  const saved=await topic('existing');assert.deepEqual(saved.feishuBinding,binding);assert(saved.integrationHistory.length);assert(saved.integrationReceipts.length);
  const old=await submit('bind',p=>{p.source.updatedAt='2025-01-01T00:00:00Z';p.source.fetchedAt='2025-01-01T01:00:00Z';});
  assert.equal((await call(adminBase+'/imports/'+old.id+'/preview',{method:'POST',body:{mode:'bind',topicId:'existing'}})).status,409);
});
test('导入可预览撤回；新项目保留，已修改项目不能被整体回退',async()=>{
  const item=await submit('undo'),p=await preview(item),result=await apply(item,p);
  const up=await json(await call(adminBase+'/topics/'+result.topicId+'/preview-action',{method:'POST',body:{action:'undo'}}));
  assert.equal((await topic(result.topicId)).projectCode,'DEMO-001');
  await json(await call(adminBase+'/topics/'+result.topicId+'/apply-action',{method:'POST',body:{previewId:up.previewId}}));
  const t=await topic(result.topicId);assert(t);assert.equal(t.feishuBinding,undefined);assert.equal(t.projectCode,undefined);assert.equal(t.title,'人工确认名称');
  assert.equal(t.publishDate,'');assert.equal(t.integrationHistory.at(-1).kind,'undo');
  assert.equal((await call(adminBase+'/topics/existing/preview-action',{method:'POST',body:{action:'undo'}})).status,409);
});
test('解除绑定需预览确认，仅解除关系，项目与日期保持不变',async()=>{
  const before=await topic('existing'),p=await json(await call(adminBase+'/topics/existing/preview-action',{method:'POST',body:{action:'unlink'}}));
  assert((await topic('existing')).feishuBinding);
  await json(await call(adminBase+'/topics/existing/apply-action',{method:'POST',body:{previewId:p.previewId}}));
  const t=await topic('existing');assert.equal(t.feishuBinding,undefined);assert.deepEqual(t.productionSteps,before.productionSteps);assert.deepEqual(t.notes,before.notes);
});
test('来源映射可按模板查询，不泄露项目内容；忽略候选保留可查询记录',async()=>{
  const response=await json(await call(agentBase+'/mappings?projectKey=example_space&workItemType=example_type&templateId=example_template',{role:'agent'}));
  assert.equal(response.mapping['field:projectCode'],'field_code');assert(!JSON.stringify(response).includes('DEMO-001'));
  const item=await submit('dismiss');
  await json(await call(adminBase+'/imports/'+item.id+'/dismiss',{method:'POST',body:{}}));
  assert.equal((await json(await call(agentBase+'/imports/'+item.id,{role:'agent'}))).status,'dismissed');
  assert.equal((await call(adminBase+'/imports/'+item.id+'/preview',{method:'POST',body:{mode:'create',title:'不会创建'}})).status,409);
});
test('重启后从项目提交回执恢复中断的收件箱状态，重试不重复写入',async()=>{
  const item=await submit('crash'),p=await preview(item),result=await apply(item,p);
  const file=path.join(dir,'integrations','feishu',item.id+'.json'),record=JSON.parse(await fs.readFile(file,'utf8'));
  record.status='pending';delete record.result;
  await fs.writeFile(file,JSON.stringify(record));
  await stop();await start();
  const repaired=await json(await call(agentBase+'/imports/'+item.id,{role:'agent'}));
  assert.equal(repaired.status,'applied');assert.equal(repaired.result.topicId,result.topicId);
  const retried=await apply(item,p);
  assert.equal(retried.version,1);assert.equal((await topic(result.topicId)).integrationHistory.length,1);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).status,'applied');
});
test('模板改变时全部重新确认，不沿用旧模板中未选择的映射',async()=>{
  const first=await submit('template-change'),fp=await preview(first),created=await apply(first,fp);
  const update=await submit('template-change',p=>{p.source.templateId='new_template';p.fields.projectCode='DEMO-002';});
  const p=await preview(update,'bind',{topicId:created.topicId});
  assert(p.rows.every(r=>r.mappingChanged&&!r.selected));
  assert.equal((await call(adminBase+'/imports/'+update.id+'/apply',{method:'POST',body:{previewId:p.previewId,selected:['field:projectCode']}})).status,400);
  await apply(update,p,['field:projectCode'],{allowMappingChange:true});
  const t=await topic(created.topicId);assert.equal(t.projectCode,'DEMO-002');
  assert.deepEqual(t.feishuBinding.mapping,{'field:projectCode':'field_code'});
  assert.equal(t.publishDate,'2026-01-20');
});
test('管理接口拒绝错误正文和伪造锁定项，失败不写入项目',async()=>{
  assert.equal((await call(adminBase+'/token',{method:'POST',body:[]})).status,400);
  const item=await submit('locked-name'),p=await preview(item);
  assert.equal((await call(adminBase+'/imports/'+item.id+'/apply',{method:'POST',body:{previewId:p.previewId,selected:['field:title']}})).status,400);
  assert.equal(await topic(p.topicId),undefined);
  const created=await apply(item,p,[]);assert.equal((await topic(created.topicId)).title,'人工确认名称');
});
test('凭证轮换撤销旧权限，新凭证不能读取旧凭证的请求；撤销立即生效',async()=>{
  const item=await submit('rotation'),old=token;await createToken();
  assert.equal((await call(agentBase+'/schema',{role:'agent',bearer:old})).status,401);
  assert.equal((await call(agentBase+'/imports/'+item.id,{role:'agent'})).status,403);
  assert.equal((await call(adminBase+'/imports/'+item.id)).status,200);
  await json(await call(adminBase+'/token',{method:'DELETE'}));
  assert.equal((await call(agentBase+'/schema',{role:'agent'})).status,401);
});
test('没有管理密码时所有 Agent 及导入写入禁用，不能意外继承匿名管理权限',async()=>{
  await stop();await start(false);
  assert.equal((await json(await call(adminBase+'/config',{role:null}))).enabled,false);
  assert.equal((await call(adminBase+'/token',{method:'POST',body:{},role:null})).status,403);
  assert.equal((await call(agentBase+'/imports',{method:'POST',role:'agent',key:'no-password',body:fixture()})).status,403);
  assert.equal((await call('/api/data',{role:'agent'})).status,403);
  assert.equal((await call('/api/data',{role:null,headers:{Authorization:'bearer '+token}})).status,403);
});
