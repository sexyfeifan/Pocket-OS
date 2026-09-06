const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schedule = require('../schedule');

// Run the actual frontend handlers against isolated data; no real server or user data.
function app() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const code = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('const CATEGORIES'));
  const elements = new Map(), storage = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', dataset: {},
      style: {}, classList: { add() {}, remove() {}, toggle() {} }, focus() {}, select() {}, contains() {return false;}, showModal() {this.open=true;}, close() {this.open=false;}, querySelectorAll: () => [] });
    return elements.get(id);
  }
  const context = vm.createContext({ console, PocketSchedule: schedule, PocketWorkflow: require('../workflow'), structuredClone,
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {},
    document: { addEventListener() {}, removeEventListener() {}, activeElement: null,
      getElementById: element, querySelector: () => element('query'), querySelectorAll: () => [],
      createElement: () => element('created') },
    window: { addEventListener() {}, innerWidth: 1200 }, navigator: { userAgent: 'test' },
    localStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) || null },
    confirm: () => true, alert() {}, fetch: async () => ({ ok: true, json: async () => ({ _version: 1 }) })
  });
  const workbench = fs.readFileSync(path.join(__dirname,'..','workbench.js'),'utf8');
  vm.runInContext(workbench.slice(0,workbench.lastIndexOf('initWorkbench();')), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','editor.js'),'utf8'),context);
  vm.runInContext(code.slice(0, code.indexOf('  // ── 初始化 ──')), context);
  vm.runInContext(`renderAll = renderEditPage = renderTopicList = refreshScheduleViews = refreshWorkflowStatus = showToast = logAction = switchView = loadSystemInfo = initMobile = () => {};
    appState.topics = [{id:'test', title:'Example', _version:0, publishDate:'2026-09-20', preparationTasks:[], productionSteps:[
      {key:'script',name:'脚本',startDate:'2026-09-01',endDate:'2026-09-02',duration:2,done:true},
      {key:'shoot',name:'拍摄',startDate:'2026-09-03',endDate:'2026-09-08',duration:3,segments:[{start:'2026-09-03',end:'2026-09-04'},{start:'2026-09-08',end:'2026-09-08'}]},
      {key:'acopy',name:'ACO',startDate:'2026-09-09',endDate:'2026-09-11',duration:3},
      {key:'custom_review',name:'审片',startDate:'2026-09-12',endDate:'2026-09-12',duration:1},
      {key:'publish',name:'发布',startDate:'2026-09-20',endDate:'2026-09-20',duration:1}
    ]}]; selectedTopicId = 'test';`, context);
  return { context, element, run: code => vm.runInContext(code, context),
    data: () => JSON.parse(vm.runInContext('JSON.stringify(appState.topics[0])', context)) };
}

test('新建先输入名称，打开和取消不写入空项目，提交后默认自动推进',()=>{
  const a=app(),before=a.data();a.run('createTopic()');
  assert.equal(a.run('appState.topics.length'),1);assert.deepEqual(a.data(),before);
  a.element('new-project-name').value='';a.run('submitNewProject()');assert.equal(a.run('appState.topics.length'),1);
  a.element('new-project-name').value='新项目';a.element('create-template').value='talk';a.element('create-progression').value='calendar';a.run('submitNewProject()');
  assert.equal(a.run('appState.topics.length'),2);assert.equal(a.run('appState.topics[1].progressionMode'),'calendar');
});
test('编辑页、侧栏和卡片使用真实渲染函数，日期入口在节点前，管理操作在末尾',()=>{
  const a=app();const html=a.run('projectEditorHtml(appState.topics[0])');
  assert(html.indexOf('安排已知日期')<html.indexOf('项目日历'));assert(html.indexOf('项目日历')<html.indexOf('制作节点'));
  assert(html.indexOf('制作节点')<html.indexOf('项目管理'));assert(!html.includes('id="topic-publish"'));
  assert.match(a.run('renderTopicItem(appState.topics[0])'),/topic-item/);
  a.run('renderCardList(); renderTopicSummaries()');
});
test('异常暂停不改任何日期；过期窗口被拒绝；人工完成可解除异常',()=>{
  const a=app(),before=a.data();a.run("openNodeException('test','shoot')");
  a.element('exception-kind').value='waiting';a.element('exception-reason').value='客户未反馈';a.run('applyNodeException()');
  const after=a.data();assert.deepEqual(after.productionSteps[1].segments,before.productionSteps[1].segments);
  assert.equal(after.productionSteps[1].exception.kind,'waiting');
  assert.deepEqual(after.productionSteps[2],before.productionSteps[2]);
  a.run("openNodeException('test','shoot');appState.topics[0].productionSteps[1].name='已变更'");
  a.element('exception-kind').value='paused';a.run('applyNodeException()');
  assert.equal(a.data().productionSteps[1].exception.kind,'waiting');
  a.run("toggleStep('test',1)");assert.equal(a.data().productionSteps[1].done,true);assert.equal(a.data().productionSteps[1].exception,undefined);
});
test('具体延期只改当前节点并撤回其人工确认，无效日期不清除原异常',()=>{
  const a=app();a.run("appState.topics[0].productionSteps[2].exception={kind:'paused'};openNodeException('test','acopy',true)");
  const start={value:'2099-01-10'},end={value:'2099-01-09'};a.context.document.querySelectorAll=selector=>selector==='[data-exception-start]'?[start]:selector==='[data-exception-end]'?[end]:[];
  a.element('exception-kind').value='reschedule';a.run('applyNodeException()');assert.equal(a.data().productionSteps[2].exception.kind,'paused');
  end.value='2099-01-12';a.run('applyNodeException()');assert.equal(a.data().productionSteps[2].startDate,'2099-01-10');assert.equal(a.data().productionSteps[2].exception,undefined);
  assert.equal(a.data().publishDate,'2026-09-20');
});
test('标为不适用可恢复原日期，发布字段一致；日期撤销保留后来添加的暂停',()=>{
  const a=app();a.run("setNodeSkipped('test',4)");assert.equal(a.data().publishDate,'');
  a.run("setNodeSkipped('test',4)");assert.equal(a.data().publishDate,'2026-09-20');
  a.run("updateStepDate('test',2,'startDate','2026-09-10');appState.topics[0].productionSteps[2].exception={kind:'paused'};undoSchedule('test')");
  assert.equal(a.data().productionSteps[2].exception.kind,'paused');
});
test('工作台色块与概览一致，多段拍摄尚有后续段不误报前段延期',()=>{
  const a=app();
  a.run("todayStr = () => '2026-09-06'");
  const blocks=JSON.parse(a.run("JSON.stringify(buildMergedBlocks([appState.topics[0].productionSteps[1]],['2026-09-03','2026-09-04','2026-09-05','2026-09-06','2026-09-07','2026-09-08']))"));
  assert.equal(blocks.length,2);assert(blocks.every(b=>!b.conflict));
});

test('新建项目全部未安排，Canbox 仅填写实际拍摄日期', () => {
  const a = app(); a.run("createTopic('', '测试新项目')");
  const topic = JSON.parse(a.run('JSON.stringify(appState.topics[1])'));
  assert.equal(topic.publishDate, '');
  assert.ok(topic.productionSteps.every(s => !s.startDate && s.cleared));
  const imported = JSON.parse(a.run("JSON.stringify(stepsFromCanbox([{start:'2026-09-03',end:'2026-09-04'},{start:'2026-09-08',end:'2026-09-08'}]))"));
  assert.equal(imported.filter(s => s.startDate).length, 1);
  assert.equal(imported.find(s => s.key === 'shoot').duration, 3);
});

test('模板和复制项目只保留结构，不复制日期、完成状态、通告或历史', () => {
  const a=app();a.run("createTopic('commercial','商业测试')");
  const templated=JSON.parse(a.run('JSON.stringify(appState.topics[1])'));
  assert(templated.productionSteps.some(s=>s.key==='review'));
  assert(templated.productionSteps.every(s=>s.cleared&&!s.done&&!s.startDate));
  assert.equal(templated.preparationTasks.length,3);
  a.run("appState.topics[0].canboxImport={secret:'old'}; appState.topics[0].scheduleHistory=[{}]; duplicateProject('test','复制测试')");
  const copy=JSON.parse(a.run('JSON.stringify(appState.topics[2])'));
  assert(copy.productionSteps.every(s=>!s.startDate&&!s.done));
  assert.equal(copy.canboxImport,undefined);assert.equal(copy.scheduleHistory,undefined);assert.equal(copy.publishDate,'');
});

test('逐项预览只修改勾选节点，过期预览不能覆盖更新后的排期',()=>{
  const a=app(),before=a.data();
  a.run("openScheduleReview(appState.topics[0],{script:{name:'脚本',ranges:[{start:'2026-10-01',end:'2026-10-02'}]},acopy:{name:'ACO',ranges:[{start:'2026-10-03',end:'2026-10-03'}]}})");
  a.context.document.querySelectorAll=()=>[{dataset:{reviewIndex:'1'}}];
  a.run('applyScheduleReview()');
  assert.deepEqual(a.data().productionSteps[0],before.productionSteps[0]);
  assert.equal(a.data().productionSteps[2].startDate,'2026-10-03');
  a.run("openScheduleReview(appState.topics[0],{script:{name:'脚本',ranges:[{start:'2026-11-01',end:'2026-11-02'}]}}); updateStepDate('test',2,'endDate','2026-10-05')");
  a.context.document.querySelectorAll=()=>[{dataset:{reviewIndex:'0'}}];a.run('applyScheduleReview()');
  assert.deepEqual(a.data().productionSteps[0],before.productionSteps[0]);
});

test('排期确认不会更改项目状态；改期撤回确认，排序不撤回确认',()=>{
  const a=app();a.run("appState.topics[0].lifecycle='feedback';confirmNewSchedule('test')");
  assert.equal(a.data().scheduleConfirmed,true);assert.equal(a.data().lifecycle,'feedback');
  a.run("moveStepOrder('test',0,1)");assert.equal(a.data().scheduleConfirmed,true);
  a.run("updatePublishDate('test','2026-10-01')");assert.equal(a.data().scheduleConfirmed,false);assert.equal(a.data().lifecycle,'feedback');
});

test('TML 可取消单个节点与备注，不改变未勾选内容',()=>{
  const a=app(),before=a.data();
  a.run("tmlTopicId='test';tmlParsed={steps:{script:{selected:false,startDate:'2026-10-01',endDate:'2026-10-02'},acopy:{startDate:'2026-10-03',endDate:'2026-10-04'}},notes:{'2026-10-03':['不应用']},selectedNotes:{'2026-10-03':false}};applyTml()");
  assert.deepEqual(a.data().productionSteps[0],before.productionSteps[0]);assert.equal(a.data().productionSteps[2].endDate,'2026-10-04');assert.equal(a.data().notes['2026-10-03'],undefined);
});

test('日历放置可与其他节点重叠，不推挤前后节点；保留拍摄段间隔', () => {
  const a = app(), before = a.data();
  a.run("addStepFromPopup('test','shoot','2026-09-01')");
  const after = a.data();
  assert.deepEqual(after.productionSteps.filter(s => s.key !== 'shoot'), before.productionSteps.filter(s => s.key !== 'shoot'));
  assert.deepEqual(after.productionSteps[1].segments.map(r => [r.start, r.end]), [['2026-09-01','2026-09-02'],['2026-09-06','2026-09-06']]);
  assert.equal(after.publishDate, before.publishDate);
});

test('拖动第二拍摄段只移动所选段，支持自定义节点，禁止跨项目误放', () => {
  const a = app(), before = a.data();
  a.run("dragData={topicId:'test',stepKey:'shoot',rangeIndex:1}; ganttDrop({preventDefault(){},currentTarget:{classList:{remove(){}}}},'test','2026-09-10')");
  const after = a.data();
  assert.deepEqual(after.productionSteps[1].segments[0], before.productionSteps[1].segments[0]);
  assert.equal(after.productionSteps[1].segments[1].start, '2026-09-10');
  assert.deepEqual(after.productionSteps.filter(s => s.key !== 'shoot'), before.productionSteps.filter(s => s.key !== 'shoot'));
  a.run("dragData={topicId:'test',stepKey:'custom_review'}; ganttDrop({preventDefault(){},currentTarget:{classList:{remove(){}}}},'test','2026-09-20')");
  assert.equal(a.data().productionSteps[3].startDate, '2026-09-20');
  const snapshot = a.data();
  a.run("dragData={topicId:'test',stepKey:'script'}; ganttDrop({preventDefault(){},currentTarget:{classList:{remove(){}}}},'another','2026-09-20')");
  assert.deepEqual(a.data(), snapshot);
});

test('直接日期编辑、前后移和缩放只修改当前节点，撤销恢复日期', () => {
  const a = app(), before = a.data();
  a.run("updateStepDate('test',2,'endDate','2026-09-25'); delayStep('test',2,-1)");
  assert.deepEqual(a.data().productionSteps.filter(s => s.key !== 'acopy'), before.productionSteps.filter(s => s.key !== 'acopy'));
  a.run("ganttResizeStart({preventDefault(){},stopPropagation(){},clientX:0},'test','acopy','right'); ganttResizeMove({clientX:CELL_W*2}); ganttResizeEnd()");
  assert.equal(a.data().productionSteps[2].endDate, '2026-09-26');
  a.run("undoSchedule('test')");
  assert.equal(a.data().productionSteps[2].endDate, '2026-09-24');
});

test('发布节点在所有操作后保持同一天且与发布日期一致', () => {
  const a = app(), before = a.data().productionSteps.slice(0,4);
  a.run("updatePublishDate('test','2026-09-05'); delayStep('test',4,1)");
  assert.equal(a.data().publishDate, '2026-09-06');
  assert.equal(a.data().productionSteps[4].endDate, '2026-09-06');
  a.run("clearStep('test',4)"); assert.equal(a.data().publishDate, '');
  a.run("undoSchedule('test')"); assert.equal(a.data().publishDate, '2026-09-06');
  assert.deepEqual(a.data().productionSteps.slice(0,4), before);
});

test('无效日期或拍摄段重叠会拒绝，原排期不变；清空不会留下幽灵拍摄段', () => {
  const a = app(), before = a.data();
  a.run("updateStepDate('test',0,'endDate','2026-02-30'); updateStepSegmentDate('test',1,1,'start','2026-09-04')");
  assert.deepEqual(a.data(), before);
  a.run("clearStep('test',1)");
  assert.equal(schedule.ranges(a.data().productionSteps[1]).length, 0);
  a.run("undoSchedule('test')");
  assert.deepEqual(a.data().productionSteps, before.productionSteps);
});

test('节点可任意顺序完成；删除和排序在重新加载时不会还原', async () => {
  const a = app();
  a.run("toggleStep('test',3); moveStepOrder('test',3,-1); deleteStep('test','script')");
  assert.equal(a.data().productionSteps.find(s => s.key === 'custom_review').done, true);
  const saved = a.data();
  a.context.fetch = async () => ({ ok: true, json: async () => ({topics:[saved],settings:{}}) });
  a.run('localStorage.setItem("pocket_os_pending", "{}")');
  await a.run('loadData()');
  assert.deepEqual(a.data().productionSteps, saved.productionSteps);
});

test('TML 仅修改指定工序，不删除其他排期，过去月份不猜成明年', () => {
  const a = app(), before = a.data();
  a.element('tml-input').value = 'ACO 9.15';
  a.run("tmlTopicId='test'; tmlParsed={steps:{acopy:{startDate:'2026-09-15',endDate:'2026-09-15'}},notes:{}}; applyTml()");
  assert.deepEqual(a.data().productionSteps.filter(s => s.key !== 'acopy'), before.productionSteps.filter(s => s.key !== 'acopy'));
  assert.equal(a.run("parseTmlDate('1.15',2026)"), '2026-01-15');
  assert.equal(a.run("parseTmlRange('9.15-12',2026)"), null);
  a.run("openTmlModal('test')"); assert.equal(a.element('tml-year').value, 2026);
});

test('保存中继续编辑会顺序保存，版本号连续，不取消在途请求', async () => {
  const a = app(), requests = [];
  let release;
  a.context.fetch = async (url, options) => {
    assert.equal(options.signal, undefined);
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({_version:requests.length}) };
  };
  a.run("markDirty('test')");
  const first = a.run('flushSave()');
  a.run("updateStepDate('test',2,'endDate','2026-09-24')");
  const coalesced = a.run('flushSave()');
  assert.equal(requests.length, 1);
  release(); await first; await coalesced;
  await a.run('flushSave()');
  assert.equal(requests.length, 2);
  assert.equal(requests[0]._version, 0); assert.equal(requests[1]._version, 1);
  assert.equal(requests[1].productionSteps[2].endDate, '2026-09-24');
  assert.equal(a.run('_topicConflicts.size'), 0);
});

test('单日工序改开始日期仍为一天；无开始日期时设置结束也可建立单日节点', () => {
  const step = {key:'edit',startDate:'2026-09-10',endDate:'2026-09-10'};
  schedule.updateDate(step, 'startDate', '2026-09-25');
  assert.equal(step.endDate, '2026-09-25');
  schedule.clear(step); schedule.updateDate(step, 'endDate', '2026-09-29');
  assert.equal(step.startDate, '2026-09-29');
  assert.equal(step.duration, 1);
});

test('通告绑定只补空拍摄节点，不覆盖现有拍摄或其他节点', () => {
  const a = app(), before = a.data();
  a.run("canboxProjects=[{name:'通告',dates:['2026-10-01','2026-10-03']}]; canboxSelected=new Set([0]); bindCanboxSelected()");
  assert.deepEqual(a.data().productionSteps, before.productionSteps);
  a.run("clearStep('test',1); bindCanboxSelected()");
  assert.equal(a.data().productionSteps[1].segments.length, 2);
  assert.deepEqual(a.data().productionSteps.filter(s=>s.key!=='shoot'), before.productionSteps.filter(s=>s.key!=='shoot'));
});

test('撤销日期修改保留随后更改的节点名称和完成状态', () => {
  const a = app();
  a.run("delayStep('test',2,1); updateStepName('test',2,'剪辑初版'); toggleStep('test',2); undoSchedule('test')");
  assert.equal(a.data().productionSteps[2].name, '剪辑初版');
  assert.equal(a.data().productionSteps[2].done, true);
  assert.equal(a.data().productionSteps[2].startDate, '2026-09-09');
});

test('TML 识别已存在的自定义工序，保留原节点与其他日期', () => {
  const a = app(), before = a.data();
  a.run("openTmlModal('test')");
  a.element('tml-input').value = '审片 9.21';
  a.run('parseTml(); applyTml()');
  assert.equal(a.data().productionSteps.find(s=>s.key==='custom_review').startDate, '2026-09-21');
  assert.deepEqual(a.data().productionSteps.filter(s=>s.key!=='custom_review'), before.productionSteps.filter(s=>s.key!=='custom_review'));
});

test('页面内联脚本和共享日期模块可解析', () => {
  for (const file of ['index.html', 'canbox.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: file });
  }
});

test('从色块中部拖动保持抓取偏移，覆盖其他色块也可独立落位', () => {
  const a = app(), before = a.data();
  a.run("ganttDragStart({clientX:81,clientY:10,currentTarget:{getBoundingClientRect(){return {left:0}},classList:{add(){}}}},'test','acopy',0,'2026-09-09'); ganttDropOnRow({clientX:CELL_W*12+1,preventDefault(){},currentTarget:{getBoundingClientRect(){return {left:0,width:CELL_W*30}},classList:{remove(){}}}},'test','2026-09-01')");
  // CELL_W is 80: a grab one day into the block lands on Sep 13, so its start is Sep 12.
  assert.equal(a.data().productionSteps[2].startDate, '2026-09-12');
  assert.deepEqual(a.data().productionSteps.filter(s=>s.key!=='acopy'), before.productionSteps.filter(s=>s.key!=='acopy'));
});
