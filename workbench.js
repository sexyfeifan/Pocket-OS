// Enhancements use the editor's existing mutation/save pipeline, never a second writer.
let workbenchFilter = { query:'', lifecycle:'', completed:false };
let workbenchReturn = { view:'calendar', top:0, left:0 };
let workbenchCompact = false;
try { workbenchFilter = { ...workbenchFilter, ...JSON.parse(localStorage.getItem('pocket-workbench-filter') || '{}') }; workbenchCompact = localStorage.getItem('pocket-workbench-compact') === 'true'; } catch {}
function filteredWorkbenchTopics() {
  const q=workbenchFilter.query.toLowerCase().trim();
  return appState.topics.filter(t=>(!q || [t.title,...(t.productionSteps||[]).map(s=>s.name)].join(' ').toLowerCase().includes(q))
    && (!workbenchFilter.lifecycle || PocketWorkflow.lifecycle(t)===workbenchFilter.lifecycle));
}
function setWorkbenchFilter() {
  workbenchFilter={query:document.getElementById('workbench-search').value,lifecycle:document.getElementById('workbench-phase').value,completed:document.getElementById('workbench-completed').checked};
  try{localStorage.setItem('pocket-workbench-filter',JSON.stringify(workbenchFilter));}catch{}renderAll();
}
function renderWorkflowOverview() {
  const toolbar=document.getElementById('workflow-toolbar');if(!toolbar)return;
  toolbar.hidden=currentView==='edit';
  const box=document.getElementById('workflow-overview');box.hidden=currentView==='edit';
  const a=PocketWorkflow.attention(filteredWorkbenchTopics(),todayStr());
  const entries=[['今天进行中',a.today],['七天内拍摄 / 发布',a.upcoming],['逾期未完成',a.overdue],['待排 / 待反馈 / 调整中',a.unresolved]];
  const open=box.querySelector('details')?.open ?? true;
  box.innerHTML=`<details ${open?'open':''}><summary>工作概览 · 提醒不会自动改期</summary><div class="attention-grid">${entries.map(([name,rows])=>`<section><h4>${name} · ${rows.length}</h4>${rows.slice(0,5).map(r=>`<button onclick="selectTopic('${r.topicId||r.id}')">${escapeHtml(r.title)}${r.name?' · '+escapeHtml(r.name):''}<small>${r.start?escapeHtml(PocketWorkflow.rangeText([{start:r.start,end:r.end}])):escapeHtml(PocketWorkflow.scheduleStatus(r))}</small></button>`).join('')}${!rows.length?'<p class="workflow-help">暂无</p>':''}${rows.length>5?'<a href="/view" target="_blank" rel="noopener" class="workflow-help">在只读看板查看全部 ↗</a>':''}</section>`).join('')}</div></details>`;
  const select=document.getElementById('new-project-template'),selected=select.value;
  select.innerHTML='<option value="">标准工序</option>'+[...PocketWorkflow.templates,...(appState.settings.projectTemplates||[])].map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');select.value=selected;
}
function workflowEditorHtml(t) {
  return `<div id="workflow-status" class="workflow-fields"><label>项目状态<select aria-label="项目状态" onchange="setLifecycle('${t.id}',this.value)">${Object.entries(PocketWorkflow.lifecycleLabels).map(([k,v])=>`<option value="${k}" ${PocketWorkflow.lifecycle(t)===k?'selected':''}>${v}</option>`).join('')}</select></label><span id="schedule-status" class="workflow-help">排期：${escapeHtml(PocketWorkflow.scheduleStatus(t))}</span><button class="editor-button" onclick="confirmNewSchedule('${t.id}')">确认当前排期</button><label>变动原因<input aria-label="排期变动原因" id="pending-reason" data-draft placeholder="场地 / 客户反馈…" value="${escapeHtml(t.pendingReason||'')}"></label><button class="editor-button" onclick="markProjectPending('${t.id}')">标记调整中</button></div>
  <div class="workflow-fields"><button class="editor-button" onclick="duplicateProject('${t.id}')">复制为新项目</button><label><input type="checkbox" onchange="toggleCompact(this.checked)" ${workbenchCompact?'checked':''}>紧凑排期</label></div>
  <p class="workflow-help">项目状态与排期状态相互独立。确认后改期会重新待确认，不改动其他节点。</p>`;
}
function workflowHistoryHtml(t) {
  const history=[...(t.scheduleHistory||[])].reverse();
  return `<details class="workflow-history" id="workflow-history"><summary>排期变更记录 · 最近 ${history.length} 次已保存变更</summary><p class="workflow-help">记录从 v1.9.7 开始积累，刷新后保留。恢复前可选择节点；已有节点的名称、完成状态和其他项目字段不会被回退。</p>${history.map(h=>`<div class="history-entry"><time>${escapeHtml(new Date(h.at).toLocaleString('zh-CN'))}</time>${(h.changes||[]).map(c=>`<p><strong>${escapeHtml(c.name)}</strong>：${c.added?'新增节点 · ':c.removed?'删除节点 · ':''}${escapeHtml(PocketWorkflow.rangeText(c.before))} → ${escapeHtml(PocketWorkflow.rangeText(c.after))}</p>`).join('')}<button class="editor-button" onclick="previewHistory('${t.id}','${h.id}')">预览恢复修改前</button></div>`).join('')||'<p class="workflow-help">暂无记录；下次保存排期变化后会出现在这里。</p>'}</details>
  <details class="workflow-history"><summary>保存为项目模板</summary><p class="workflow-help">只保留工序结构和准备事项，不包含日期、完成状态、备注或通告绑定。</p><div class="workflow-fields"><input id="template-name" data-draft aria-label="模板名称" placeholder="输入模板名称"><button class="editor-button" onclick="saveProjectTemplate('${t.id}')">保存模板</button></div><div>${(appState.settings.projectTemplates||[]).map(p=>`<p class="workflow-help">${escapeHtml(p.name)} <button onclick="deleteProjectTemplate('${p.id}')">删除模板</button></p>`).join('')}</div></details>`;
}
function refreshWorkflowStatus(t) {
  const el=document.getElementById('schedule-status');if(el)el.textContent='排期：'+PocketWorkflow.scheduleStatus(t);
  const progress=document.getElementById('edit-progress');if(progress)progress.textContent=PocketWorkflow.progressText(t);
}
function toggleCompact(enabled){workbenchCompact=enabled;try{localStorage.setItem('pocket-workbench-compact',String(enabled));}catch{}document.getElementById('edit-card-content').classList.toggle('workflow-compact',enabled);}
function setLifecycle(id,value){const t=appState.topics.find(t=>t.id===id);if(!t)return;if(value==='completed'){completeProject(id);return;}t.lifecycle=value;t.completed=false;delete t.completedAt;markUpdated(t);saveData();logAction('topic.status',id,{lifecycle:value});renderAll();}
function duplicateProject(id){const source=appState.topics.find(t=>t.id===id);if(!source)return;const copy=PocketWorkflow.copyStructure(source);const now=nowISO();const t={id:genId(),title:copy.title,category:copy.category,platforms:copy.platforms,productionSteps:copy.productionSteps,preparationTasks:copy.tasks.map((text,i)=>({id:'prep_'+Date.now()+'_'+i,text,done:false})),publishDate:'',completed:false,lifecycle:'preparation',projectStatus:'normal',createdAt:now,updatedAt:now};appState.topics.push(t);markDirty(t.id);saveData();selectTopic(t.id);logAction('topic.duplicate',t.id,{sourceId:id});}
function saveProjectTemplate(id){const t=appState.topics.find(t=>t.id===id),name=document.getElementById('template-name').value.trim();if(!t||!name){showToast('请输入模板名称','warn');return;}const list=appState.settings.projectTemplates||=[];if(list.length>=20){showToast('最多保存 20 个自定义模板','warn');return;}list.push({id:'template_'+Date.now(),name,steps:t.productionSteps.map(s=>({key:s.key,name:s.name,color:s.color})),tasks:t.preparationTasks.map(p=>p.text)});markSettingsDirty();saveData();renderAll();showToast('模板已保存，日期不会复制','success');}
function deleteProjectTemplate(id){if(!confirm('删除此模板？已创建的项目不会受到影响。'))return;appState.settings.projectTemplates=(appState.settings.projectTemplates||[]).filter(t=>t.id!==id);markSettingsDirty();saveData();renderAll();}

let scheduleReview=null;
function openScheduleReview(topic, incoming, options={}) {
  const current=PocketWorkflow.snapshot(topic);
  const rows=Object.entries(incoming).map(([key,item])=>({key,item,current:current.find(s=>s.key===key)}));
  scheduleReview={topicId:topic.id,baseline:JSON.stringify(current),rows,options};
  let dialog=document.getElementById('schedule-review');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='schedule-review';dialog.className='workflow-review';document.body.appendChild(dialog);}
  dialog.innerHTML=`<h2>${escapeHtml(options.title||'确认排期变化')}</h2><p class="workflow-help">只应用勾选的节点。未勾选节点及其他日期保持不变。</p>${rows.map((r,i)=>`<label class="review-row"><input type="checkbox" data-review-index="${i}" ${options.unchecked?'':'checked'}><div><strong>${escapeHtml(r.item?.name||r.current?.name||r.key)}</strong><p>当前：${escapeHtml(PocketWorkflow.rangeText(r.current?.ranges||[]))}</p><p>应用后：${r.item===null?'删除该节点':escapeHtml(PocketWorkflow.rangeText(r.item.ranges))}</p></div></label>`).join('')}${!rows.length?'<p class="workflow-help">日期保持不变。</p>':''}<div class="review-actions"><button class="editor-button" onclick="document.getElementById('schedule-review').close()">取消</button><button class="editor-button" onclick="applyScheduleReview()">确认应用所选</button></div>`;
  dialog.showModal();
}
function applyScheduleReview(){
  const review=scheduleReview,topic=appState.topics.find(t=>t.id===review?.topicId);if(!topic)return;
  if(JSON.stringify(PocketWorkflow.snapshot(topic))!==review.baseline){showToast('预览后排期已变化，请关闭后重新预览','warn');return;}
  const selected=[...document.querySelectorAll('[data-review-index]:checked')].map(el=>review.rows[Number(el.dataset.reviewIndex)]);
  if(!selected.length&&!review.options.onApplied){showToast('请至少勾选一个节点','warn');return;}
  const applied=changeSchedule(topic,()=>selected.forEach(({key,item})=>{
    const idx=topic.productionSteps.findIndex(s=>s.key===key);
    if(item===null){if(idx>=0)topic.productionSteps.splice(idx,1);return;}
    let step=topic.productionSteps[idx];if(!step){step=PocketSchedule.blankSteps([{key,name:item.name,color:item.color||'#B8D4E3'}])[0];topic.productionSteps.push(step);}
    PocketSchedule.setRanges(step,item.ranges);
  }),{source:review.options.source||'history',steps:selected.map(s=>s.key)});
  if(!applied)return;document.getElementById('schedule-review').close();review.options.onApplied?.();scheduleReview=null;
}
function previewHistory(id,historyId){const t=appState.topics.find(t=>t.id===id),h=t?.scheduleHistory?.find(h=>h.id===historyId);if(!h)return;const incoming={};for(const c of h.changes)incoming[c.key]=h.before.find(s=>s.key===c.key)||null;openScheduleReview(t,incoming,{title:'恢复前预览 · '+new Date(h.at).toLocaleString('zh-CN'),source:'history'});}
function previewCanboxBinding(){
  if(canboxSelected.size!==1){showToast('请选择一个通告','warn');return;}
  const p=canboxProjects[[...canboxSelected][0]],t=appState.topics.find(t=>t.id===selectedTopicId);if(!p||!t)return;
  const ranges=p.segments||detectShootSegments(p.dates),shoot=t.productionSteps.find(s=>s.key==='shoot');
  openScheduleReview(t,{shoot:{name:shoot?.name||'拍摄',ranges,color:'#A5C8E1'}},{title:'绑定通告 · 核对拍摄日期',source:'canbox',unchecked:!!getStepRanges(shoot).length,onApplied:()=>bindCanboxSelected(false)});
}
function initWorkbench(){
  document.getElementById('workbench-search').value=workbenchFilter.query;document.getElementById('workbench-phase').value=workbenchFilter.lifecycle;document.getElementById('workbench-completed').checked=workbenchFilter.completed;
  fetch('/api/access').then(r=>r.json()).then(data=>{document.getElementById('viewer-access-note').textContent=data.viewerEnabled?'已启用独立查看密码，可将 /view 分享给查看者。':data.protected?'当前只接受管理密码。对外只读分享需配置独立查看密码。':'当前未设置访问密码，仅适合可信本地网络；不要直接公开分享。';}).catch(()=>{});
}
initWorkbench();
