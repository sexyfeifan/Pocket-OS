const test=require('node:test'),assert=require('node:assert/strict'),W=require('../workflow'),S=require('../schedule');
const step=()=>({key:'shoot',name:'拍摄',startDate:'2026-09-10',endDate:'2026-09-12'});
const auto=steps=>({id:'p',title:'自动推进',progressionMode:'calendar',timeZone:'Asia/Shanghai',productionSteps:steps});
test('自动推进遵守完整结束日，结束日期当天仍进行中，翌日按计划结束',()=>{
  const s=step(),p=auto([s]),raw=JSON.stringify(p);
  assert.equal(W.stepState(p,s,'2026-09-09'),'upcoming');
  assert.equal(W.stepState(p,s,'2026-09-10'),'active');
  assert.equal(W.stepState(p,s,'2026-09-12'),'active');
  assert.equal(W.stepState(p,s,'2026-09-13'),'elapsed');
  assert.equal(W.stats(p,'2026-09-13').done,0);assert.equal(W.stats(p,'2026-09-13').planned,1);
  assert.equal(JSON.stringify(p),raw);assert.equal(p.completed,undefined);
});
test('旧项目没有新字段时仍然手动完成，不自动批量迁移',()=>{
  const s=step(),old={productionSteps:[s]};
  assert.equal(W.mode(old),'manual');assert.equal(W.stepState(old,s,'2026-09-13'),'overdue');
  assert.equal(W.stats(old,'2026-09-13').percent,0);
});
test('项目时区决定跨日，服务器统一时刻不依赖查看设备所在时区',()=>{
  const p=auto([step()]),utc='2026-09-12T16:00:00Z';
  assert.equal(W.day(p,utc),'2026-09-13');
  assert.equal(W.day({...p,timeZone:'America/Los_Angeles'},utc),'2026-09-12');
  assert.equal(W.stepState(p,p.productionSteps[0],W.day(p,utc)),'elapsed');
  assert.equal(W.day(p,'2026-09-12T15:59:59Z'),'2026-09-12');
  assert.equal(W.zone({timeZone:'bad/zone'}),'Asia/Shanghai');
});
test('夏令时不改变全天节点边界，跨年和闰年日期按日历处理',()=>{
  const p={timeZone:'America/New_York'};
  assert.equal(W.day(p,'2026-03-08T06:59:00Z'),'2026-03-08');
  assert.equal(W.day(p,'2026-03-08T07:01:00Z'),'2026-03-08');
  assert.equal(W.day({timeZone:'Asia/Shanghai'},'2027-12-31T16:00:00Z'),'2028-01-01');
  assert.equal(W.day({timeZone:'Asia/Shanghai'},'2028-02-29T16:00:00Z'),'2028-03-01');
});
test('无日期不自动结束，不适用不计进度或日历，可恢复原日期',()=>{
  const s={...step(),skipped:true},empty={key:'review',cleared:true},p=auto([s,empty]);
  assert.equal(W.stepState(p,empty,'2026-10-01'),'undated');
  assert.equal(W.stats(p,'2026-10-01').total,1);assert.equal(W.stats(p,'2026-10-01').planned,0);
  assert.equal(W.events([p],'2026-01-01','2027-01-01').length,0);
  s.skipped=false;assert.equal(S.ranges(s)[0].start,'2026-09-10');
});
test('延期、暂停、等待反馈都阻止自动结束，不制造后续日期',()=>{
  for(const kind of W.exceptionKinds){
    const s={...step(),exception:{kind,reason:'现场变化'}},p=auto([s]);
    assert.equal(W.stepState(p,s,'2026-10-01'),kind);
    assert.equal(W.stats(p,'2026-10-01').planned,0);
    const a=W.attention([p],'2026-10-01');assert.equal(a.upcoming.length+a.today.length+a.overdue.length,0);assert.equal(a.exceptions.length,1);
    assert.match(W.dateText(s),/原计划/);
  }
});
test('分段空档等待后续段，不自动结束第一段；整个节点按最后结束日判断',()=>{
  const s={...step(),segments:[{start:'2026-09-10',end:'2026-09-11'},{start:'2026-09-20',end:'2026-09-21'}]},p=auto([s]);
  assert.equal(W.stepState(p,s,'2026-09-12'),'between');
  assert.equal(W.stepState(p,s,'2026-09-21'),'active');
  assert.equal(W.stepState(p,s,'2026-09-22'),'elapsed');
  assert.equal(W.stats(p,'2026-09-22').planned,1);
});
test('自动结束后改到未来恢复未开始，但人工确认的完成不会因改期而消失',()=>{
  const s=step(),p=auto([s]);
  assert.equal(W.stepState(p,s,'2026-09-13'),'elapsed');
  S.move(s,'2026-10-01');assert.equal(W.stepState(p,s,'2026-09-13'),'upcoming');
  s.done=true;S.move(s,'2026-11-01');assert.equal(W.stepState(p,s,'2026-09-13'),'done');
});
test('已自动结束的节点不报逾期，旧手动项目仍有待核对提醒',()=>{
  const p=auto([step()]);
  assert.equal(W.attention([p],'2026-10-01').overdue.length,0);
  assert.equal(W.attention([{...p,progressionMode:'manual'}],'2026-10-01').overdue.length,1);
});
test('只读投影保留推进方式、时区、异常和不适用，不把自动结束伪造成 done',()=>{
  const p=auto([{...step(),exception:{kind:'waiting',reason:'等待客户',secret:'SECRET'}},{key:'custom',skipped:true}]);
  const raw=JSON.stringify(p),out=W.publicTopic(p);
  assert.equal(out.progressionMode,'calendar');assert.equal(out.timeZone,'Asia/Shanghai');
  assert.equal(out.productionSteps[0].exception.kind,'waiting');assert.equal(out.productionSteps[1].skipped,true);
  assert(!JSON.stringify(out).includes('SECRET'));assert.equal(JSON.stringify(p),raw);
  assert.equal(out.productionSteps[0].done,false);
});
