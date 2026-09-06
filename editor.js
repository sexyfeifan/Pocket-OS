// Project-first editing UI; every mutation still uses the existing save queue.
function workflowDialog(id) {
  let dialog=document.getElementById(id);
  if(!dialog){dialog=document.createElement('dialog');dialog.id=id;dialog.className='workflow-review';document.body.appendChild(dialog);}
  return dialog;
}
let newProjectDraft=null, nodeExceptionDraft=null, progressionDraft=null;
function openNewProject(templateId='',sourceId=null) {
  const source=appState.topics.find(t=>t.id===sourceId);
  newProjectDraft={sourceId:source?.id};
  const dialog=workflowDialog('new-project-dialog');
  dialog.innerHTML=`<form onsubmit="event.preventDefault();submitNewProject()"><h2>${source?'复制为新项目':'新建项目'}</h2><p class="workflow-help">先记下项目名称，只安排已经确定的日期。取消不会创建空项目。</p><label class="editor-field">项目名称<input id="new-project-name" aria-label="新项目名称" required maxlength="200" placeholder="例如：秋季品牌拍摄" value="${escapeHtml(source?source.title+' · 副本':'')}"></label>${source?'<p class="workflow-help">复制工序结构与准备事项，日期、状态、备注和通告绑定不会复制。</p>':`<label class="editor-field">工序模板<select id="create-template" aria-label="工序模板"><option value="">标准工序</option>${[...PocketWorkflow.templates,...(appState.settings.projectTemplates||[])].map(t=>`<option value="${escapeHtml(t.id)}" ${t.id===templateId?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></label>`}<label class="editor-field">推进方式<select id="create-progression" aria-label="新项目推进方式"><option value="calendar">按日期自动推进（推荐）</option><option value="manual">手动确认完成</option></select></label><p class="workflow-help">自动推进：结束日过后显示“按计划结束”，不代表实际验收。出现延期、暂停或等待反馈时再干预。默认时区：Asia/Shanghai，可在项目管理中修改。</p><div class="review-actions"><button type="button" onclick="document.getElementById('new-project-dialog').close()">取消</button><button class="editor-button" type="submit">创建并安排日期</button></div></form>`;
  dialog.showModal();document.getElementById('new-project-name').focus();
}
function submitNewProject() {
  const title=document.getElementById('new-project-name').value.trim();
  if(!title){showToast('请输入项目名称','warn');return;}
  const mode=document.getElementById('create-progression').value==='manual'?'manual':'calendar';
  if(newProjectDraft?.sourceId)duplicateProject(newProjectDraft.sourceId,title,mode);
  else createTopic(document.getElementById('create-template').value,title,mode);
  document.getElementById('new-project-dialog').close();newProjectDraft=null;
}
function statusBadge(t,s) {
  const state=PocketWorkflow.stepState(t,s);
  return `<span class="node-status status-${state}" data-node-status="${escapeHtml(s.key)}">${PocketWorkflow.stateLabels[state]}</span>`;
}
function nodeCompletionIcon(t,s) {
  const state=PocketWorkflow.stepState(t,s);
  return `<span class="node-completion status-${state}" aria-label="${PocketWorkflow.stateLabels[state]}">${state==='done'?'✓':state==='elapsed'?'◷':state==='skipped'?'—':''}</span>`;
}
function editorStepHtml(t,s,index) {
  const W=PocketWorkflow,rs=getStepRanges(s),multi=rs.length>1;
  const input=(r,i,field)=>{
    const isStart=field==='start',fn=multi?`updateStepSegmentDate('${t.id}',${index},${i},'${field}',this.value)`:`updateStepDate('${t.id}',${index},'${isStart?'startDate':'endDate'}',this.value)`;
    return `<label class="date-label">${s.key==='publish'?'日期':isStart?'开始':'结束'}<input id="${isStart?'step-start-'+index+(i?'-'+i:''):'step-end-'+index+'-'+i}" type="date" aria-label="${escapeHtml(s.name)} ${multi?'第'+(i+1)+'段 ':''}${s.key==='publish'?'日期':isStart?'开始':'结束'}" data-schedule-date data-step="${index}" data-range="${i}" data-field="${field}" value="${r[field]}" onchange="${fn}" class="date-input"></label>`;
  };
  const dates=(rs.length?rs:[{start:'',end:''}]).map((r,i)=>`<div class="node-dates">${multi?'<small>第 '+(i+1)+' 段</small>':''}${input(r,i,'start')}${s.key==='publish'?'':input(r,i,'end')}${multi?`<button class="editor-button" onclick="deleteShootSegment('${t.id}',${index},${i})" aria-label="移除${escapeHtml(s.name)}第${i+1}段">移除此段</button>`:''}</div>`).join('');
  return `<div id="step-row-${index}" data-step-idx="${index}" class="wf-row node-editor ${s.skipped?'node-skipped':''}">
    <div class="node-heading"><input aria-label="${escapeHtml(s.name)} 节点名称" value="${escapeHtml(s.name)}" onchange="updateStepName('${t.id}',${index},this.value)" class="node-name"><span id="step-duration-${index}" class="workflow-help">${rs.length?calculateStepDuration(s)+'天':''}</span>${statusBadge(t,s)}</div>
    ${s.skipped?'<p class="workflow-help">不计入进度；恢复适用时保留原来的日期。</p>':`<div class="node-date-area">${W.exceptionKinds.includes(s.exception?.kind)?`<p class="node-exception">原计划仅供参考 · ${escapeHtml(s.exception.reason||'未填写原因')}。修改日期不会自动解除异常。</p>`:''}${dates}</div>`}
    <div class="node-actions">${s.skipped?'':`<button class="editor-button" onclick="openNodeException('${t.id}','${s.key}')">延期 / 暂停</button>${s.exception?`<button class="editor-button" onclick="resumeNode('${t.id}','${s.key}')">恢复推进</button>`:''}`}
    <details id="node-more-${index}" data-remember class="node-more"><summary>更多</summary><div class="node-more-actions">
      <button class="editor-button" onclick="toggleStep('${t.id}',${index})">${s.done?'撤回人工确认':'确认实际完成'}</button>
      <button class="editor-button" onclick="setNodeSkipped('${t.id}',${index})">${s.skipped?'恢复适用':'标为不适用'}</button>
      <button class="editor-button" data-needs-date ${rs.length?'':'disabled'} onclick="delayStep('${t.id}',${index},-1)">前移一天</button><button class="editor-button" data-needs-date ${rs.length?'':'disabled'} onclick="delayStep('${t.id}',${index},1)">后移一天</button>
      <button class="editor-button" onclick="moveStepOrder('${t.id}',${index},-1)" ${index?'':'disabled'}>上移顺序</button><button class="editor-button" onclick="moveStepOrder('${t.id}',${index},1)" ${index===t.productionSteps.length-1?'disabled':''}>下移顺序</button>
      <button class="editor-button" data-needs-date ${rs.length?'':'disabled'} onclick="clearStep('${t.id}',${index})">清空日期</button><button class="editor-button danger-action" onclick="deleteStep('${t.id}','${s.key}')">删除节点</button>
      ${s.key==='shoot'?`<label class="date-label">新增拍摄段<input type="date" id="new-segment-${index}" data-draft aria-label="新增拍摄段日期" class="date-input"></label><button class="editor-button" onclick="addShootSegment('${t.id}',${index})">添加拍摄段</button>`:''}
    </div></details></div></div>`;
}
function projectEditorHtml(t) {
  const W=PocketWorkflow,cb=t.canboxImport,tasks=t.preparationTasks||[],conflict=_topicConflicts.get(t.id);
  return `<article id="card-${t.id}" class="project-editor topic-card">
  <div class="editor-top"><span>项目 · 直接编辑</span><button data-save-status onclick="flushSave()" aria-live="polite">已保存</button></div>
  ${conflict?`<div class="node-exception"><p>其他设备已修改或删除这个项目，请先解决同步冲突。</p><button onclick="resolveConflictUseServer('${t.id}')">采用服务器版本</button><button onclick="resolveConflictOverwrite('${t.id}')">保留当前版本</button></div>`:''}
  <label class="editor-field">项目名称<input id="topic-title" aria-label="项目名称" value="${escapeHtml(t.title)}" oninput="commitTitle('${t.id}',this.value)" onblur="if(!this.value.trim())this.value='新选题'" class="project-title"></label>
  <div class="editor-outlook" id="editor-outlook">${escapeHtml(W.outlookText(t))}</div>
  <details id="project-basics" data-remember><summary>分类与平台 · ${escapeHtml(t.category||'内容')}${t.platforms?.length?' · '+escapeHtml(t.platforms.join(' / ')):''}</summary><div class="workflow-fields">
  <label>分类<select aria-label="项目分类" onchange="selectCategory('${t.id}',this.value)">${CATEGORIES.map(c=>`<option ${t.category===c?'selected':''}>${c}</option>`).join('')}</select></label>
  ${PLATFORMS.map(p=>`<button onclick="togglePlatform('${t.id}','${p}')" aria-pressed="${(t.platforms||[]).includes(p)}" class="editor-button">${p}</button>`).join('')}</div></details>
  <section class="schedule-entry"><h3>安排已知日期</h3><p class="workflow-help">直接填写下方节点日期，或从已有安排导入。不要求填满，也不按发布日期倒排。</p><div class="workflow-fields"><button class="editor-button" onclick="focusSchedule()">手动安排</button><button class="editor-button" onclick="openCanboxLink('${t.id}')">${cb?'更换 / 同步通告':'绑定拍摄通告'}</button><button class="editor-button" onclick="openTmlModal('${t.id}')">导入 TML</button></div></section>
  <section class="editor-calendar-section"><div class="editor-section-head"><h3>项目日历</h3><button class="editor-button" onclick="scrollEditorCalendar('first')">首个安排</button><button class="editor-button" onclick="scrollEditorCalendar('today')">今天</button><button class="editor-button" onclick="scrollEditorCalendar('last')">最后安排</button></div><p class="workflow-help">横向滚动查看日期；拖动色块只修改该节点，其他节点不会移动。</p><div id="edit-gantt-wrapper" class="gantt-scroll"><div id="edit-gantt-container"></div></div></section>
  <section aria-label="制作流程"><div class="editor-section-head"><h3>制作节点</h3><button id="undo-schedule" onclick="undoSchedule('${t.id}')" ${scheduleHistory.get(t.id)?.length?'':'disabled'} class="editor-button">撤销排期修改</button></div>
  <p id="edit-progress" class="workflow-help">${escapeHtml(W.progressText(t))}</p><p class="workflow-help">${W.mode(t)==='calendar'?'结束日过后自动显示“按计划结束”，不代表人工验收。':'此项目保持手动确认完成。'} · 时区 ${escapeHtml(W.zone(t))}</p>
  <div class="node-list">${t.productionSteps.map((s,i)=>editorStepHtml(t,s,i)).join('')}</div>
  <form onsubmit="event.preventDefault();addCustomStep('${t.id}')" class="workflow-fields"><input id="new-step-name" data-draft aria-label="新工序名称" placeholder="新节点，如：审片、调色"><button class="editor-button">添加节点</button></form></section>
  <details id="prep-section" data-remember ${tasks.length?'open':''}><summary>准备事项 · ${tasks.length} 项</summary><form onsubmit="event.preventDefault();addPrepFromInput('${t.id}')" class="workflow-fields"><input id="prep-input-${t.id}" data-draft aria-label="新增准备事项" placeholder="输入事项，回车添加"><button class="editor-button">添加事项</button></form>${tasks.map((p,i)=>`<div class="prep-row"><input type="checkbox" aria-label="完成准备事项${i+1}" ${p.done?'checked':''} onchange="togglePrep('${t.id}',${i})"><input aria-label="准备事项${i+1}" value="${escapeHtml(p.text)}" oninput="updatePrepText('${t.id}',${i},this.value)"><button class="editor-button" onclick="deletePrep('${t.id}',${i})">删除</button></div>`).join('')}</details>
  <details id="project-notes" data-remember><summary>日期备注 · ${Object.keys(t.notes||{}).length} 条</summary><p class="workflow-help">点击项目日历的空日期可添加或修改备注。</p>${Object.entries(t.notes||{}).sort().map(([d,n])=>`<p class="workflow-help">${escapeHtml(d)} · ${escapeHtml(n)}</p>`).join('')}</details>
  ${cb?`<details id="bound-canbox" data-remember><summary>已绑定拍摄通告</summary><p class="workflow-help">${escapeHtml(PocketWorkflow.rangeText(cb.shootSegments||cb.segments||detectShootSegments(cb.dates||[])))}</p>${canboxMetadata(cb)}<div class="workflow-fields"><button class="editor-button" onclick="importShootDates('${t.id}')">预览应用拍摄日期</button><button class="editor-button" onclick="unlinkCanbox('${t.id}')">解除绑定</button></div></details>`:''}
  ${t.tmlNote?`<details id="project-tml" data-remember><summary>TML 原文</summary><pre id="tml-note-display" class="workflow-help">${escapeHtml(t.tmlNote)}</pre><button class="editor-button" onclick="editTmlNote('${t.id}')">编辑原文</button></details>`:''}
  ${workflowEditorHtml(t)}<div id="history-container">${workflowHistoryHtml(t)}</div>
  <p class="time-meta">创建 ${shortTime(t.createdAt)} · 修改 ${shortTime(t.updatedAt)}</p></article>`;
}
function focusSchedule(){document.querySelector('.node-list input[type=date]')?.focus();}
function quickStepAction(id,key) {
  const t=appState.topics.find(t=>t.id===id),s=t?.productionSteps.find(s=>s.key===key);
  if(!s)return;
  if(PocketWorkflow.mode(t)==='calendar'||s.exception)selectTopic(id);else toggleStepByKey(id,key);
}
function scrollEditorCalendar(target) {
  const topic=appState.topics.find(t=>t.id===selectedTopicId);if(!topic)return;
  const events=PocketWorkflow.events([topic],'0001-01-01','9999-12-31',true),dates=getGanttDates();
  const date=(target==='first'?events[0]?.start:target==='last'?events.reduce((d,e)=>e.end>d?e.end:d,''):null)||PocketWorkflow.day(topic);
  if(!date)return;
  if(!dates.includes(date)){ganttStartDate=new Date(addDays(date,-10)+'T12:00:00');ganttTotalDays=GANTT_INITIAL_DAYS;refreshScheduleViews();}
  const wrapper=document.getElementById('edit-gantt-wrapper');
  // The editor uses the same fixed day-cell width as its existing drag calculations.
  if(wrapper)wrapper.scrollLeft=Math.max(0,(getGanttDates().indexOf(date)-2)*CELL_W);
}
function onEditorGanttScroll() {
  const wrapper=document.getElementById('edit-gantt-wrapper'),topic=appState.topics.find(t=>t.id===selectedTopicId);
  if(!wrapper||!topic||wrapper.dataset.extending)return;
  let left=wrapper.scrollLeft;
  if(left<150){ganttStartDate.setDate(ganttStartDate.getDate()-30);ganttTotalDays+=30;left+=30*CELL_W;}
  else if(left+wrapper.clientWidth>wrapper.scrollWidth-150)ganttTotalDays+=30;
  else return;
  wrapper.dataset.extending='true';renderGanttTable('edit-gantt-container',getGanttDates(),[topic],false,true);wrapper.scrollLeft=left;
  requestAnimationFrame(()=>delete wrapper.dataset.extending);
}
function setNodeSkipped(id,index) {
  const t=appState.topics.find(t=>t.id===id),s=t?.productionSteps[index];if(!s)return;
  changeSchedule(t,()=>{s.skipped=!s.skipped;},{action:'applicability',step:s.name});
}
function openNodeException(id,key,forceDates=false) {
  const t=appState.topics.find(t=>t.id===id),s=t?.productionSteps.find(s=>s.key===key);if(!s||s.skipped)return;
  nodeExceptionDraft={id,key,baseline:JSON.stringify(s)};
  const rs=getStepRanges(s),dialog=workflowDialog('node-exception-dialog');
  dialog.innerHTML=`<form onsubmit="event.preventDefault();applyNodeException()"><h2>${escapeHtml(s.name)} · 调整安排</h2><p class="workflow-help">只处理当前节点，其他节点不会自动改期。原计划：${escapeHtml(PocketWorkflow.rangeText(rs))}</p><label class="editor-field">处理方式<select id="exception-kind" aria-label="处理方式" onchange="renderExceptionDates()"><option value="reschedule">改到具体日期</option><option value="delayed" ${!forceDates?'selected':''}>延期，日期待定</option><option value="paused">暂停</option><option value="waiting">等待反馈</option></select></label><div id="exception-dates">${(rs.length?rs:[{start:'',end:''}]).map((r,i)=>`<div class="node-dates"><label>第 ${i+1} 段开始<input type="date" aria-label="调整第${i+1}段开始" data-exception-start value="${r.start}"></label>${s.key==='publish'?'':`<label>结束<input type="date" aria-label="调整第${i+1}段结束" data-exception-end value="${r.end}"></label>`}</div>`).join('')}</div><label class="editor-field">原因（选填）<input id="exception-reason" aria-label="延期或暂停原因" maxlength="500" value="${escapeHtml(s.exception?.reason||'')}" placeholder="例如：客户反馈未到"></label><p class="workflow-help">日期待定、暂停或等待会停止自动推进，原日期保留为参考。具体新日期的最后结束日不能早于今天；保存后恢复推进，撤回该节点原有的人工完成确认。</p><div class="review-actions"><button type="button" onclick="document.getElementById('node-exception-dialog').close()">取消</button><button type="submit" class="editor-button">应用到此节点</button></div></form>`;
  dialog.showModal();renderExceptionDates();
}
function renderExceptionDates(){document.getElementById('exception-dates').hidden=document.getElementById('exception-kind').value!=='reschedule';}
function applyNodeException() {
  const d=nodeExceptionDraft,t=appState.topics.find(t=>t.id===d?.id),s=t?.productionSteps.find(s=>s.key===d?.key);if(!s)return;
  if(JSON.stringify(s)!==d.baseline){showToast('节点已变化，请关闭后重新打开调整窗口','warn');return;}
  const kind=document.getElementById('exception-kind').value,reason=document.getElementById('exception-reason').value.trim();
  const before=JSON.stringify(s);
  if(kind==='reschedule'){
    const starts=[...document.querySelectorAll('[data-exception-start]')],ends=[...document.querySelectorAll('[data-exception-end]')];
    const ranges=starts.map((e,i)=>({start:e.value,end:s.key==='publish'?e.value:ends[i].value}));
    if(!ranges.length||ranges.some(r=>!PocketSchedule.validDate(r.start)||!PocketSchedule.validDate(r.end))||ranges.reduce((d,r)=>r.end>d?r.end:d,'')<PocketWorkflow.day(t)){showToast('请选择有效日期，最后结束日不能早于今天','warn');return;}
    if(!changeSchedule(t,()=>{PocketSchedule.setRanges(s,ranges);s.done=false;delete s.exception;},{action:'reschedule',step:s.name,reason}))return;
  }else{
    if(!PocketWorkflow.exceptionKinds.includes(kind))return;
    s.exception={kind,reason,at:nowISO()};s.done=false;
    markUpdated(t);saveData();renderAll();
  }
  logAction('step.exception',t.id,{step:s.name,kind,reason,before:JSON.parse(before),after:s});document.getElementById('node-exception-dialog').close();nodeExceptionDraft=null;
}
function resumeNode(id,key) {
  const t=appState.topics.find(t=>t.id===id),s=t?.productionSteps.find(s=>s.key===key);if(!s?.exception)return;
  if(PocketWorkflow.mode(t)==='calendar'&&getStepRanges(s).at(-1)?.end<PocketWorkflow.day(t)){openNodeException(id,key,true);return;}
  delete s.exception;markUpdated(t);saveData();logAction('step.exception',id,{step:s.name,kind:'resume'});renderAll();
}
function openProgressionSettings(id) {
  const t=appState.topics.find(t=>t.id===id);if(!t)return;progressionDraft={id,version:t._version};
  const W=PocketWorkflow,zones=[...new Set([W.zone(t),'Asia/Shanghai','Asia/Tokyo','Europe/London','America/New_York','America/Los_Angeles','UTC'])];
  const dialog=workflowDialog('progression-dialog');
  dialog.innerHTML=`<h2>推进方式与项目时区</h2><label class="editor-field">推进方式<select id="progression-mode" aria-label="推进方式" onchange="previewProgression()"><option value="manual" ${W.mode(t)==='manual'?'selected':''}>手动确认完成</option><option value="calendar" ${W.mode(t)==='calendar'?'selected':''}>按日期自动推进</option></select></label><label class="editor-field">项目时区<select id="progression-zone" aria-label="项目时区" onchange="previewProgression()">${zones.map(z=>`<option ${z===W.zone(t)?'selected':''}>${z}</option>`).join('')}</select></label><p id="progression-preview" class="workflow-help"></p><p class="workflow-help">结束日之后才算按计划结束。此设置不改日期、不清除人工确认，也不会自动归档项目。</p><div class="review-actions"><button onclick="document.getElementById('progression-dialog').close()">取消</button><button class="editor-button" onclick="applyProgression()">确认应用</button></div>`;
  dialog.showModal();previewProgression();
}
function previewProgression() {
  const t=appState.topics.find(t=>t.id===progressionDraft?.id);if(!t)return;
  const copy={...t,progressionMode:document.getElementById('progression-mode').value,timeZone:document.getElementById('progression-zone').value};
  document.getElementById('progression-preview').textContent='切换后：'+PocketWorkflow.progressText(copy)+'。项目今天为 '+PocketWorkflow.day(copy)+'。';
}
function applyProgression() {
  const t=appState.topics.find(t=>t.id===progressionDraft?.id);if(!t)return;
  if(t._version!==progressionDraft.version){showToast('项目已更新，请关闭后重新核对','warn');return;}
  const mode=document.getElementById('progression-mode').value,zone=document.getElementById('progression-zone').value;
  if(!['calendar','manual'].includes(mode)||!PocketWorkflow.validZone(zone))return;
  t.progressionMode=mode;t.timeZone=zone;markUpdated(t);saveData();logAction('topic.progression',t.id,{mode,zone});document.getElementById('progression-dialog').close();renderAll();
}

function canboxMetadata(cb) {
  return [['location','拍摄地'],['director','导演'],['photographer','摄影'],['production','制片'],['rd','研发'],['operational','运营'],['audio','收音'],['business','商务'],['advertiserNo','商单']].filter(([key])=>cb[key]).map(([key,label])=>`<p class="workflow-help">${label}：${escapeHtml(cb[key])}</p>`).join('');
}
