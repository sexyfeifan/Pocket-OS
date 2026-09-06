const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
let child,dir,base;
const headers=role=>({Authorization:'Basic '+Buffer.from(role+':'+(role==='editor'?'test-editor-only':'test-viewer-only')).toString('base64'),'Content-Type':'application/json'});
async function request(url,role='viewer',method='GET',body){const res=await fetch(base+url,{method,headers:headers(role),...(body?{body:JSON.stringify(body)}:{})});return res;}
test.before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-view-test-'));const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),POCKET_OS_DATA_DIR:dir,POCKET_OS_PASSWORD:'test-editor-only',POCKET_OS_VIEW_PASSWORD:'test-viewer-only'},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await request('/api/system','editor')).ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw new Error('server did not start');
});
test.after(async()=>{if(child){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}if(dir)await fs.rm(dir,{recursive:true,force:true});});
test('只读入口要求身份，管理凭证与查看凭证隔离',async()=>{
  assert.equal((await fetch(base+'/view')).status,401);
  assert.equal((await request('/view')).status,200);assert.equal((await request('/canbox')).status,200);
  assert.equal((await request('/timeline.js')).status,200);
  assert.equal((await request('/index.html')).status,403);assert.equal((await request('/','editor')).status,200);
  const manifest=await(await request('/view.webmanifest')).json();assert.equal(manifest.start_url,'/view');
  for(const p of ['/api/data','/api/export','/api/logs','/api/events','/api/public/topics','/workbench.js','/editor.js'])assert.equal((await request(p)).status,403,p);
  for(const [p,m] of [['/api/topic/test','POST'],['/api/topic/test','DELETE'],['/api/settings','POST'],['/api/settings/apikey','POST'],['/api/log','POST'],['/api/data','POST']])assert.equal((await request(p,'viewer',m,{})).status,403,p);
});
test('只读数据使用白名单并保留拍摄间隔，连续读取不会改动文件',async()=>{
  const topic={id:'secure',title:'只读回归',_version:0,productionSteps:[{key:'shoot',name:'拍摄',startDate:'2026-09-01',endDate:'2026-09-06',segments:[{start:'2026-09-01',end:'2026-09-02'},{start:'2026-09-06',end:'2026-09-06'}]},{key:'custom',name:'审片',cleared:true}],canboxImport:{password:'SECRET'},tmlNote:'SECRET',internalSecret:'SECRET'};
  assert.equal((await request('/api/topic/secure','editor','POST',topic)).status,200);
  const file=path.join(dir,'topics','secure.json'),before=await fs.readFile(file,'utf8');
  for(let i=0;i<3;i++){const res=await request('/api/view/data'),text=await res.text();assert(!text.includes('SECRET'));const data=JSON.parse(text);assert.equal(data.topics[0].productionSteps[0].segments.length,2);assert.equal(data.topics[0].productionSteps.length,2);assert.equal(data.settings,undefined);}
  assert.equal(await fs.readFile(file,'utf8'),before);
});
test('历史由服务器记录，刷新保留，普通修改不删除历史，旧版本无法覆盖',async()=>{
  let topic=(await(await request('/api/data','editor')).json()).topics.find(t=>t.id==='secure');
  const count=topic.scheduleHistory.length;topic.productionSteps[0].segments[1]={start:'2026-09-08',end:'2026-09-08'};topic.productionSteps[0].endDate='2026-09-08';
  const stale=JSON.parse(JSON.stringify(topic));let saved=await(await request('/api/topic/secure','editor','POST',topic)).json();
  assert.equal(saved.scheduleHistory.length,count+1);assert.equal(saved.scheduleHistory.at(-1).changes[0].key,'shoot');
  assert.equal((await request('/api/topic/secure','editor','POST',stale)).status,409);
  topic=(await(await request('/api/data','editor')).json()).topics.find(t=>t.id==='secure');assert.equal(topic.scheduleHistory.length,count+1);
  topic.title='仅改标题';topic.scheduleHistory=[];saved=await(await request('/api/topic/secure','editor','POST',topic)).json();assert.equal(saved.scheduleHistory.length,count+1);
});
test('自动推进项目读写保留模式、时区与异常，查看不会写入 done 或自动归档',async()=>{
  const topic={id:'auto_mode',title:'日期自动推进',_version:0,progressionMode:'calendar',timeZone:'Asia/Shanghai',productionSteps:[{key:'shoot',name:'拍摄',startDate:'2000-01-01',endDate:'2000-01-02',done:false},{key:'review',name:'审片',startDate:'2000-01-03',endDate:'2000-01-04',exception:{kind:'waiting',reason:'等反馈'}},{key:'unused',name:'不需要',skipped:true}]};
  assert.equal((await request('/api/topic/auto_mode','editor','POST',topic)).status,200);
  const file=path.join(dir,'topics','auto_mode.json'),before=await fs.readFile(file,'utf8');
  for(let i=0;i<3;i++){
    const dto=await(await request('/api/view/data')).json(),out=dto.topics.find(t=>t.id==='auto_mode');
    assert(Number.isFinite(Date.parse(dto.serverTime)));assert.equal(out.progressionMode,'calendar');assert.equal(out.timeZone,'Asia/Shanghai');
    assert.equal(out.productionSteps[0].done,false);assert.equal(out.productionSteps[1].exception.kind,'waiting');assert.equal(out.completed,false);
  }
  assert.equal(await fs.readFile(file,'utf8'),before);
});
test('跨站写请求被拒绝，SSE 查看流不暴露项目内容',async()=>{
  const res=await fetch(base+'/api/settings',{method:'POST',headers:{...headers('editor'),Origin:'https://untrusted.invalid'},body:'{}'});assert.equal(res.status,403);
  const controller=new AbortController();const stream=await fetch(base+'/api/view/events',{headers:headers('viewer'),signal:controller.signal});
  const reader=stream.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert(first.includes('connected'));assert(!first.includes('secure'));controller.abort();
});

test('兼容公开日历 API 也不会把拍摄间隔输出成连续事件',async()=>{
  const key=(await(await request('/api/settings/apikey','editor','POST',{})).json()).apiKey;
  const res=await fetch(base+'/api/public/calendar?from=2026-09-03&to=2026-09-04',{headers:{...headers('editor'),'x-api-key':key}});
  assert.equal(res.status,200);assert.equal((await res.json()).events.length,0);
});
