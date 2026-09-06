const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const W=require('../workflow'),S=require('../schedule');
const topic={id:'sample',title:'样例',productionSteps:[{key:'shoot',name:'拍摄',done:true,startDate:'2026-09-01',endDate:'2026-09-05',segments:[{start:'2026-09-01',end:'2026-09-02'},{start:'2026-09-05',end:'2026-09-05'}]},{key:'custom',name:'客户审片',cleared:true,done:false}]};
test('工作台和看板统计包含未排期节点，多段拍摄使用同一日期模型',()=>{
  assert.deepEqual(W.stats(topic),{total:2,done:1,scheduled:1,unscheduled:1,percent:50});
  assert.equal(W.progressText(topic),'已完成 1/2 个节点');
  assert.equal(W.events([topic],'2026-09-03','2026-09-04').length,0);
  assert.equal(W.events([topic],'2026-09-01','2026-09-05').length,2);
  assert.equal(W.stats(W.publicTopic(topic)).percent,W.stats(topic).percent);
  assert.deepEqual(S.ranges(W.publicTopic(topic).productionSteps[0]),S.ranges(topic.productionSteps[0]));
});
test('待反馈与调整中独立；并行节点不被当成冲突，完成项目不提醒逾期',()=>{
  const t={...topic,lifecycle:'feedback',projectStatus:'pending',productionSteps:topic.productionSteps.map(s=>({...s,done:false}))};
  assert.equal(W.lifecycle(t),'feedback');assert.equal(W.scheduleStatus(t),'调整中');
  const a=W.attention([t],'2026-09-01');assert.equal(a.today.length,1);assert.equal(a.overdue.length,0);
  assert.equal(W.attention([{...t,completed:true}],'2026-09-10').overdue.length,0);
});
test('只读投影不返回管理配置、导入原文、历史和敏感字段',()=>{
  const out=W.publicTopic({...topic,settings:{apiKey:'SECRET'},canboxImport:{password:'SECRET'},tmlNote:'SECRET',scheduleHistory:[{secret:'SECRET'}],private:'SECRET'});
  assert(!JSON.stringify(out).includes('SECRET'));
  assert.equal(out.productionSteps.length,2);
});
test('日期差异忽略顺序和完成状态，按节点表达变更',()=>{
  const before=W.snapshot(topic),after=W.snapshot({...topic,productionSteps:[...topic.productionSteps].reverse().map(s=>({...s,done:!s.done}))});
  assert.deepEqual(W.diff(before,after),[]);
  after.find(s=>s.key==='custom').ranges=[{start:'2026-09-06',end:'2026-09-06'}];
  assert.equal(W.diff(before,after)[0].key,'custom');
});

test('旧数据发布日期统一只在显示模型中处理，不修改原始数据',()=>{
  const old={id:'old',publishDate:'2026-09-20',productionSteps:[{key:'publish',name:'发布',startDate:'2026-09-19',endDate:'2026-09-19'}]};
  assert.equal(W.publicTopic(old).publishDate,'2026-09-19');assert.equal(old.publishDate,'2026-09-20');
  const absent={id:'absent',publishDate:'2026-09-21',productionSteps:[]};
  assert.equal(W.publicTopic(absent).productionSteps.length,1);assert.equal(absent.productionSteps.length,0);
});
test('新模块和页面脚本均可解析，只读前端仅使用查看 API',()=>{
  for(const file of ['workflow.js','timeline.js','viewer.js','workbench.js'])new vm.Script(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  const source=fs.readFileSync(path.join(__dirname,'..','viewer.js'),'utf8');
  assert(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(source));
  assert(!/\/api\/(?:data|topic|settings|log|export)/.test(source));
  const html=fs.readFileSync(path.join(__dirname,'..','view.html'),'utf8');assert(!html.includes('draggable'));assert(!html.includes('workbench.js'));
});
