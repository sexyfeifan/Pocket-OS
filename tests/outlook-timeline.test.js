const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../workflow'),T=require('../timeline');
const step=(key,start,end=start)=>({key,name:key,startDate:start,endDate:end});
const project=productionSteps=>({id:'p',title:'测试',productionSteps});

test('缺少前置节点日期不等于排期未完成，确认也不要求所有节点有日期',()=>{
  const p=project([{key:'script',cleared:true},step('shoot','2026-09-12'),{key:'review',cleared:true}]);
  const before=JSON.stringify(p);
  assert.equal(W.scheduleStatus(p),'已有安排');
  assert.equal(W.scheduleStatus({...p,scheduleConfirmed:true}),'已确认');
  assert.equal(W.attention([p],'2026-09-06').unresolved.length,0);
  assert.equal(W.outlook(p,'2026-09-06').next[0].key,'shoot');
  assert.match(W.outlookText(p,'2026-09-06'),/shoot · 2026-09-12 开始/);
  assert.equal(JSON.stringify(p),before);
});
test('下一节点按日期而非工序顺序查找，超过七天、并行自定义节点也提示',()=>{
  const p=project([step('publish','2026-11-01'),step('review','2026-10-01','2026-10-03'),step('music','2026-10-01')]);
  assert.deepEqual(W.outlook(p,'2026-09-06').next.map(e=>e.key),['review','music']);
  const panels=W.overviewPanels([p],'2026-09-06');
  assert.equal(panels[1].rows.length,2);assert.match(panels[1].rows[0].text,/2026-10-01 开始/);
});
test('当前节点提示结束日期，多段拍摄的空档展示下一段而不是连续进行中',()=>{
  const p=project([{key:'shoot',name:'拍摄',segments:[{start:'2026-09-01',end:'2026-09-02'},{start:'2026-09-06',end:'2026-09-07'}]}]);
  assert.equal(W.outlook(p,'2026-09-03').current.length,0);
  assert.equal(W.outlook(p,'2026-09-03').next[0].start,'2026-09-06');
  assert.equal(W.outlook(p,'2026-09-03').overdue.length,0);
  assert.equal(W.outlook(p,'2026-09-08').overdue.length,1);
  assert.equal(W.outlook(p,'2026-09-08').overdue[0].end,'2026-09-07');
  assert.match(W.outlookText(p,'2026-09-06'),/2026-09-07 结束/);
});
test('未填日期、所有有日期节点已完成、整个项目完成均不产生虚假待处理',()=>{
  const p=project([{key:'script',cleared:true},{...step('shoot','2026-09-01'),done:true}]);
  const a=W.attention([p],'2026-09-06');
  assert.equal(a.today.length+a.upcoming.length+a.overdue.length+a.unresolved.length,0);
  assert.equal(a.quiet.length,1);assert.match(W.outlookText(p,'2026-09-06'),/不代表排期未完成/);
  const completed={...p,completed:true,productionSteps:[step('shoot','2026-09-20')]};
  assert.equal(W.outlook(completed,'2026-09-06').next.length,0);
});
test('只有手动待反馈或调整中才进入该面板，日期逾期单独列出',()=>{
  const p=project([step('shoot','2026-09-01')]);
  assert.equal(W.attention([p],'2026-09-06').unresolved.length,0);
  assert.equal(W.attention([p],'2026-09-06').overdue.length,1);
  assert.equal(W.attention([{...p,lifecycle:'feedback'}],'2026-09-06').unresolved.length,1);
  assert.equal(W.attention([{...p,projectStatus:'pending'}],'2026-09-06').unresolved.length,1);
});
test('短节点完整标签单独占位，实际色条仍严格为单日或含首尾的天数',()=>{
  const events=[{name:'很长的客户确认节点',start:'2026-09-01',end:'2026-09-01'},{name:'精剪',start:'2026-09-02',end:'2026-09-03'}];
  const before=JSON.stringify(events),out=T.layout(events,'2026-09-01',14,72);
  assert.equal(out.blocks[0].width,68);assert.equal(out.blocks[1].width,140);
  assert.equal(out.blocks[0].labelWidth,220);assert.equal(out.lanes,2);
  assert.equal(JSON.stringify(events),before);
  assert.equal(T.layout(events,'2026-09-01',14,72,150).blocks[0].labelWidth,150);
});
test('窗口裁剪、拍摄段间隔和跨年视野不改变原日期',()=>{
  const events=[{start:'2026-12-28',end:'2027-01-02'},{start:'2027-01-08',end:'2027-01-08'}];
  const out=T.layout(events,'2027-01-01',14,72);
  assert.equal(out.blocks[0].clippedStart,true);assert.equal(out.blocks[0].width,140);
  assert.equal(out.blocks[1].left,506);
  assert.deepEqual(T.bounds(events),{first:'2026-12-28',last:'2027-01-08'});
  assert.equal(T.add('2027-01-01',-1),'2026-12-31');
});
test('连续窗口可越过两周和六周范围，日期上下界不会溢出',()=>{
  const left='2028-03-01',start=T.windowStart(left);
  assert.equal(T.number(left)-T.number(start),45);
  assert.equal(T.windowStart('0001-01-01'),'0001-01-01');
  assert.equal(T.add(T.windowStart('9999-12-31'),179),'9999-12-31');
  assert.equal(T.add('9999-12-31',2),'9999-12-31');
  assert.equal(T.cellWidth(1188,180,14),72);
  assert.equal(T.cellWidth(350,120,14),72);
});
test('鼠标轻点可打开详情，横拖或来回拖动后不会误触打开，也不包含日期写入',()=>{
  const g=T.gesture();g.start(200,50);assert.equal(g.move(202,51),null);assert.equal(g.end(),false);
  g.start(200,50);assert.deepEqual(g.move(100,50),{dx:100,dy:0});assert.deepEqual(g.move(200,50),{dx:-100,dy:0});assert.equal(g.end(),true);
  assert.equal(g.move(300,50),null);
});
