'use strict';
(() => {
  const W = PocketWorkflow, S = PocketSchedule, T = PocketTimeline, $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('pocket-view-prefs') || '{}'); } catch {}
  let view = ['overview','cards','calendar','panorama'].includes(prefs.view) ? prefs.view : 'overview';
  let anchor = today(), topics = [], loaded = false, loading = false, queued = false, lastGood = '', live = false, source, detail = null;
  const dateText = ranges => W.rangeText(ranges).replaceAll(`${today().slice(0,4)}-`, '');
  ['search','phase','category','calendar-mode','zoom'].forEach(id => { if (prefs[id] != null) $(id).value = prefs[id]; });
  if (prefs.timelineRevision !== 198) $('zoom').value = '14';
  $('completed').checked = !!prefs.completed;
  const timelineStates = new Map(), timelineData = new Map();
  function savePrefs() {
    prefs = { view, completed: $('completed').checked, timelineRevision:198 };
    ['search','phase','category','calendar-mode','zoom'].forEach(id => prefs[id] = $(id).value);
    try { localStorage.setItem('pocket-view-prefs', JSON.stringify(prefs)); } catch {}
  }
  function filtered() {
    const query = $('search').value.trim().toLowerCase(), phase = $('phase').value;
    return topics.filter(t => ($('completed').checked || phase === 'completed' || !t.completed)
      && (!$('category').value || t.category === $('category').value)
      && (!phase || W.lifecycle(t) === phase)
      && (!query || [t.title,...t.productionSteps.map(s => s.name),...Object.values(t.notes || {})].join(' ').toLowerCase().includes(query)))
      .sort((a,b) => (a.publishDate || 'z').localeCompare(b.publishDate || 'z') || a.title.localeCompare(b.title));
  }
  function badges(t) { return `<span class="badge">${esc(W.lifecycleLabels[W.lifecycle(t)])}</span><span class="badge">排期 · ${esc(W.scheduleStatus(t))}</span>`; }
  function nodes(t, limit = Infinity) {
    return t.productionSteps.slice(0,limit).map(s => `<div class="node"><span class="${s.done ? 'done' : ''}">${s.done ? '✓ ' : ''}${esc(s.name)}</span><time>${esc(dateText(S.ranges(s)))}</time></div>`).join('');
  }
  function cards(items) {
    return `<div class="cards">${items.map(t => {
      const st = W.stats(t);
      return `<article class="card"><div class="card-top"><span class="badge">${esc(t.category)}</span><small>${esc(t.platforms.join(' · '))}</small></div>
      <h2>${esc(t.title)}</h2><div class="badges">${badges(t)}</div><p class="date">${t.publishDate ? `发布 ${esc(t.publishDate)}` : '发布日期未定'}</p>
      <div class="progress"><span style="width:${st.percent}%"></span></div><small>${esc(W.progressText(t))}</small>
      <div>${nodes(t,6)}</div>${t.productionSteps.length > 6 ? `<span class="extra">另有 ${t.productionSteps.length-6} 个节点</span>` : ''}
      <button data-topic="${esc(t.id)}">查看项目详情 ↗</button></article>`;
    }).join('')}</div>`;
  }
  function overview(items) {
    const panels = W.overviewPanels(items,today()), quiet = W.attention(items,today()).quiet;
    return `<p class="help">未填日期不代表排期未完成。下一节点按实际日期查找，跳过没有日期的前置节点；并行节点分别显示。</p><div class="overview-grid">${panels.map(({title,rows,empty}) => `<section class="panel"><h2>${title}<span>${rows.length}</span></h2>${rows.length ? rows.map(r => `<button class="attention-row" data-topic="${esc(r.id)}">${esc(r.title)}<small>${esc(r.text)}</small></button>`).join('') : `<p class="empty">${empty}</p>`}</section>`).join('')}</div>${quiet.length ? `<details class="quiet-projects"><summary>另有 ${quiet.length} 个项目暂无后续日期安排 · 不作为待处理事项</summary>${quiet.map(t=>`<button class="attention-row" data-topic="${esc(t.id)}">${esc(t.title)}<small>${esc(W.progressText(t))} · 可在项目详情查看全部节点</small></button>`).join('')}</details>` : ''}`;
  }
  function calendar(items) {
    const week = $('calendar-mode').value === 'week';
    const first = week ? anchor : anchor.slice(0,8)+'01';
    const weekday = (new Date(first+'T00:00:00').getDay()+6)%7;
    const start = S.addDays(first,-weekday), count = week ? 7 : 42, end = S.addDays(start,count-1);
    $('date-label').textContent = week ? `${start} ~ ${end}` : anchor.slice(0,7);
    const events = W.events(items,start,end,true);
    if (week && innerWidth <= 640) return `<div class="week-agenda">${Array.from({length:7},(_,i)=>{
      const day=S.addDays(start,i),rows=events.filter(e=>e.start<=day&&e.end>=day);
      return `<section class="panel ${day===today()?'agenda-today':''}" data-agenda-date="${day}"><h3><button data-day="${day}">${day} · 周${['一','二','三','四','五','六','日'][i]}${day===today()?' · 今天':''}</button></h3>${rows.length?rows.map(e=>`<button class="attention-row" data-topic="${esc(e.topicId)}">${e.done?'✓ ':''}${esc(e.title)}<small>${esc(e.name)}</small></button>`).join(''):'<p class="muted">暂无安排</p>'}</section>`;
    }).join('')}</div>`;
    return `<p class="help">点击日期查看当天全部安排；点击节点查看项目。拍摄间隔日不会显示成连续拍摄。</p><div class="calendar-scroll"><div class="month-grid">${['一','二','三','四','五','六','日'].map(d => `<div class="weekday">周${d}</div>`).join('')}${Array.from({length:count},(_,i) => {
      const day = S.addDays(start,i), rows = events.filter(e => e.start<=day && e.end>=day);
      return `<div class="day ${day.slice(0,7)!==anchor.slice(0,7) ? 'outside' : ''} ${day===today() ? 'today' : ''}"><button class="day-number" data-day="${day}" aria-label="查看 ${day} 的安排">${Number(day.slice(-2))}${day===today() ? ' · 今天' : ''}</button>${rows.slice(0,4).map(e => `<button class="event" data-topic="${esc(e.topicId)}" style="--event-bg:${e.color || '#F2D98B'}44" title="${esc(e.title+' · '+e.name)}">${e.done?'✓ ':''}${esc(e.title)} · ${esc(e.name)}</button>`).join('')}${rows.length>4 ? `<button class="event" data-day="${day}">另有 ${rows.length-4} 项，展开全部</button>` : ''}</div>`;
    }).join('')}</div></div>`;
  }
  function timelinePanel(items, key, single = false) {
    const events = W.events(items,'0001-01-01','9999-12-31',true), bounds = T.bounds(events);
    if (!timelineStates.has(key)) timelineStates.set(key,{date:T.add(single && bounds ? bounds.first : today(),innerWidth<=640?0:-3),fraction:0,top:0});
    timelineData.set(key,{items,events,bounds,single});
    return `<section class="timeline-panel" data-timeline-panel="${esc(key)}"><div class="timeline-tools"><strong>${single?'项目排期日历':'连续时间轴'}</strong><button data-timeline-jump="first" ${bounds?'':'disabled'}>首个安排</button><button data-timeline-jump="last" ${bounds?'':'disabled'}>最后安排</button><button data-timeline-jump="today">今天</button><label>跳到日期 <input type="date" aria-label="${single?'项目日历':'全景时间轴'}跳到日期" data-timeline-date></label></div><p class="help">按住鼠标左右拖动、触控板横滑或使用 ← → 键浏览；这里只移动视野，不改变日期。<span data-timeline-range></span></p><div class="timeline-scroll" tabindex="0" role="region" aria-label="${single?'项目排期日历':'全景时间轴'}" data-timeline-key="${esc(key)}"></div></section>`;
  }
  function panorama(items) { return timelinePanel(items,'panorama'); }
  function timelineState(root) { return timelineStates.get(root.dataset.timelineKey); }
  function rememberTimeline(root) {
    const state=timelineState(root), day=root.scrollLeft/state.cell;
    state.date=T.add(state.start,Math.floor(day));state.fraction=day-Math.floor(day);state.top=root.scrollTop;
    const end=T.add(state.date,Math.max(0,Math.ceil((root.clientWidth-state.titleW)/state.cell+state.fraction)-1));
    root.closest('.timeline-panel').querySelector('[data-timeline-range]').textContent='当前可见：'+state.date+' ~ '+end;
    if(root.dataset.timelineKey==='panorama')$('date-label').textContent=state.date+' ~ '+end;
  }
  function drawTimeline(root) {
    const key=root.dataset.timelineKey, state=timelineState(root), data=timelineData.get(key);
    const count=180, titleW=innerWidth<=640?120:180, cell=T.cellWidth(root.clientWidth,titleW,data.single?14:Number($('zoom').value)||14);
    const start=T.windowStart(state.date,count), dates=Array.from({length:count},(_,i)=>T.add(start,i));
    Object.assign(state,{start,cell,titleW});
    const rows=data.single ? data.items[0].productionSteps.filter(s=>S.ranges(s).length).map(s=>({title:s.name,subtitle:S.ranges(s).length?(s.done?'已完成':'制作节点'):'未设置日期',events:data.events.filter(e=>!e.note&&e.key===s.key)})) : data.items.map(t=>({id:t.id,title:t.title,subtitle:W.scheduleStatus(t)+' · '+W.stats(t).done+'/'+W.stats(t).total+' 已完成',events:data.events.filter(e=>e.topicId===t.id)}));
    if(data.single && data.events.some(e=>e.note))rows.push({title:'日期备注',subtitle:'仅查看',events:data.events.filter(e=>e.note)});
    if (!rows.length) rows.push({title:'制作节点',subtitle:'暂无日期',events:[]});
    const todayIndex=dates.indexOf(today());
    root.innerHTML=`<div class="timeline" style="width:${titleW+cell*count}px"><div class="timeline-head"><div class="timeline-name" style="width:${titleW}px">${data.single?'节点 / 日期':'项目 / 制作节点'}</div>${dates.map(d=>`<div class="timeline-date ${d===today()?'today':''}" style="width:${cell}px"><small>${d.slice(0,4)}</small>${d.slice(5)}</div>`).join('')}</div>${rows.map(row=>{
      const layout=T.layout(row.events,start,count,cell,Math.max(80,Math.min(220,root.clientWidth-titleW-14)));
      return `<div class="timeline-row">${row.id?`<button class="timeline-name" style="width:${titleW}px" data-topic="${esc(row.id)}">`:`<div class="timeline-name" style="width:${titleW}px">`}<strong>${esc(row.title)}</strong><small>${esc(row.subtitle)}</small>${row.id?'</button>':'</div>'}<div class="tracks" style="width:${count*cell}px;background-size:${cell}px 100%">${todayIndex<0?'':`<div class="today-line" style="left:${todayIndex*cell}px"></div>`}${layout.blocks.map(e=>`<button class="time-item" data-lane="${e.lane}" ${data.single?'':`data-topic="${esc(e.topicId)}"`} aria-label="${esc(e.name+' · '+e.start+' ~ '+e.end)}" style="left:${e.left}px;width:${Math.max(e.width,e.labelWidth)}px"><span class="time-label" style="width:${e.labelWidth}px">${e.done?'✓ ':''}${esc(e.name)}<time>${esc(W.rangeText([{start:e.start,end:e.end}]))}</time></span><span class="time-bar ${e.done?'bar-done':''}" style="width:${e.width}px;background:${e.color||'#F2D98B'}">${e.clippedStart?'←':''}${e.clippedEnd?'→':''}</span></button>`).join('')}${layout.blocks.length?'':'<p class="timeline-empty">此时间段暂无安排</p>'}</div></div>`;
    }).join('')}</div>`;
    // Measure wrapped labels so even long custom names never overlap the next lane.
    root.querySelectorAll('.tracks').forEach(track=>{
      const blocks=[...track.querySelectorAll('.time-item')], heights=[];
      blocks.forEach(b=>{const i=Number(b.dataset.lane);heights[i]=Math.max(heights[i]||0,b.offsetHeight+14);});
      const offsets=[];let height=12;heights.forEach((h,i)=>{offsets[i]=height;height+=h;});
      blocks.forEach(b=>b.style.top=offsets[Number(b.dataset.lane)]+'px');
      track.style.height=Math.max(80,height)+'px';
    });
    root.scrollLeft=(T.number(state.date)-T.number(start)+state.fraction)*cell;root.scrollTop=state.top;
    rememberTimeline(root);
  }
  function mountTimelines(scope) {
    scope.querySelectorAll('[data-timeline-key]').forEach(root=>{
      drawTimeline(root);
      const drag=T.gesture();let pointer=null,suppressClick=false,frame=null;
      root.addEventListener('scroll',()=>{
        rememberTimeline(root);
        if(frame)return;
        frame=requestAnimationFrame(()=>{
          frame=null;if(!root.isConnected)return;
          const state=timelineState(root), max=root.scrollWidth-root.clientWidth;
          if((root.scrollLeft<state.cell*7 && state.start>'0001-01-01') || (root.scrollLeft>max-state.cell*7 && T.add(state.start,179)<'9999-12-31'))drawTimeline(root);
        });
      });
      root.addEventListener('pointerdown',e=>{
        if(e.pointerType!=='mouse'||e.button!==0)return;
        pointer=e.pointerId;suppressClick=false;drag.start(e.clientX,e.clientY);
      });
      root.addEventListener('pointermove',e=>{
        if(pointer!==e.pointerId)return;
        const delta=drag.move(e.clientX,e.clientY);if(!delta)return;
        root.setPointerCapture(e.pointerId);root.classList.add('panning');suppressClick=true;
        root.scrollLeft+=delta.dx;root.scrollTop+=delta.dy;e.preventDefault();
      });
      const end=()=>{if(pointer===null)return;drag.end();pointer=null;root.classList.remove('panning');};
      root.addEventListener('pointerup',end);root.addEventListener('pointercancel',end);root.addEventListener('lostpointercapture',end);
      root.addEventListener('pointerleave',()=>{if(!root.classList.contains('panning'))end();});
      root.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;}},true);
      root.addEventListener('dragstart',e=>e.preventDefault());
      root.addEventListener('keydown',e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        e.preventDefault();
        if(e.key==='Home'||e.key==='End')jumpTimeline(root,e.key==='Home'?'first':'last');
        else {const state=timelineState(root);state.date=T.add(state.date,(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?14:1));drawTimeline(root);}
        root.focus({preventScroll:true});
      });
    });
  }
  function jumpTimeline(root,target) {
    const data=timelineData.get(root.dataset.timelineKey),state=timelineState(root);
    const date=target==='first'?data.bounds?.first:target==='last'?data.bounds?.last:target==='today'?today():target;
    if(!S.validDate(date))return;
    state.date=T.add(date,innerWidth<=640?0:-2);state.fraction=0;drawTimeline(root);
  }
  function render() {
    const scroll = document.querySelector('#content .calendar-scroll');
    const position = scroll ? [scroll.scrollLeft,scroll.scrollTop] : [0,0];
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
    $('date-controls').hidden=!['calendar','panorama'].includes(view);
    $('calendar-mode').hidden=view!=='calendar'; $('zoom').hidden=view!=='panorama';
    const items=filtered(); $('count').textContent=`${items.length} 个项目`;
    $('content').innerHTML=items.length ? ({overview,cards,calendar,panorama}[view])(items) : `<p class="empty">${loaded?'没有符合条件的项目。可清除筛选，或在工作台创建项目。':'尚未获取数据，请检查连接后刷新。'}</p>`;
    const next=document.querySelector('#content .calendar-scroll');if(next){next.scrollLeft=position[0];next.scrollTop=position[1];}
    mountTimelines($('content'));
    if(detail && $('detail').open)renderDetail();
  }
  function renderDetail() {
    const y=$('detail').scrollTop;
    if(detail.type==='topic') {
      const t=topics.find(t=>t.id===detail.id);
      $('detail-content').innerHTML=t ? `<h2>${esc(t.title)}</h2>${timelinePanel([t],'topic:'+t.id,true)}<article class="detail-project-card"><p class="outlook">${esc(W.outlookText(t,today()))}</p><p>${badges(t)}</p><p class="muted">${esc(t.category)} · ${esc(t.platforms.join(' · '))}</p><p class="date">${t.publishDate?'发布 '+esc(t.publishDate):'发布日期未定'}</p><p>${esc(W.progressText(t))}</p>${t.pendingReason?`<p>调整原因：${esc(t.pendingReason)}</p>`:''}
      <section><h3>全部制作节点</h3>${nodes(t)}</section><section><h3>准备事项</h3>${t.preparationTasks.length?t.preparationTasks.map(p=>`<p>${p.done?'✓':'○'} ${esc(p.text)}</p>`).join(''):'<p class="muted">暂无事项</p>'}</section>
      <section><h3>日期备注</h3>${Object.keys(t.notes).length?Object.entries(t.notes).sort().map(([d,n])=>`<p><strong>${esc(d)}</strong><br>${esc(n)}</p>`).join(''):'<p class="muted">暂无备注</p>'}</section><p class="help">最近修改：${t.updatedAt?esc(new Date(t.updatedAt).toLocaleString('zh-CN')):'—'}</p></article>` : '<p class="empty">该项目已从工作台移除。</p>';
    } else {
      const rows=W.events(filtered(),detail.id,detail.id,true);
      $('detail-content').innerHTML=`<h2>${detail.id} · 当天安排</h2>${rows.length?rows.map(e=>`<button class="attention-row" data-topic="${esc(e.topicId)}">${esc(e.title)} · ${esc(e.name)}<small>${esc(W.rangeText([{start:e.start,end:e.end}]))}${e.done?' · 已完成':''}</small></button>`).join(''):'<p class="empty">当天暂无安排</p>'}`;
    }
    mountTimelines($('detail-content'));
    $('detail').scrollTop=y;
  }
  function status(failed=false) {
    $('connection').textContent=failed ? (lastGood?`连接失败 · 当前为 ${lastGood} 的旧数据`:'连接失败，请刷新或检查访问密码') : `${live?'实时同步':'已读取 · 定时刷新'}${lastGood?' · '+lastGood:''}`;
    $('connection').classList.toggle('stale',failed);
  }
  async function load() {
    if(loading){queued=true;return;}loading=true;
    try {
      const res=await fetch('/api/view/data',{cache:'no-store'});if(!res.ok)throw new Error('read failed');
      const data=await res.json(); if(!Array.isArray(data.topics))throw new Error('bad data');
      topics=data.topics;loaded=true;lastGood=new Date().toLocaleTimeString('zh-CN');
      const category=$('category').value || prefs.category || '';
      $('category').innerHTML='<option value="">全部分类</option>'+[...new Set(topics.map(t=>t.category))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
      $('category').value=category;$('version').textContent='v'+data.version;status();render();
    } catch {status(true);if(!loaded)render();}
    finally {loading=false;if(queued){queued=false;load();}}
  }
  document.addEventListener('click',e=>{
    const target=e.target.closest('button');if(!target)return;
    if(target.dataset.timelineJump){jumpTimeline(target.closest('.timeline-panel').querySelector('[data-timeline-key]'),target.dataset.timelineJump);return;}
    if(target.dataset.view){view=target.dataset.view;savePrefs();render();}
    if(target.dataset.topic || target.dataset.day){detail={type:target.dataset.topic?'topic':'day',id:target.dataset.topic||target.dataset.day};if(!$('detail').open)$('detail').showModal();renderDetail();}
  });
  document.addEventListener('change',e=>{if(e.target.matches('[data-timeline-date]'))jumpTimeline(e.target.closest('.timeline-panel').querySelector('[data-timeline-key]'),e.target.value);});
  $('close-detail').onclick=()=>$('detail').close();
  $('detail').addEventListener('close',()=>detail=null);
  ['search','phase','category','completed','calendar-mode','zoom'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{savePrefs();render();}));
  $('reset').onclick=()=>{['search','phase','category'].forEach(id=>$(id).value='');$('completed').checked=false;savePrefs();render();};
  $('refresh').onclick=load;
  $('today').onclick=()=>{anchor=today();if(view==='panorama'){const root=$('content').querySelector('[data-timeline-key]');if(root)jumpTimeline(root,'today');return;}render();const agenda=document.querySelector('[data-agenda-date="'+today()+'"]');if(agenda)agenda.scrollIntoView({block:'start',behavior:'smooth'});else{const day=document.querySelector('.day.today');if(day)day.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});}};
  function shift(dir){if(view==='panorama'){const root=$('content').querySelector('[data-timeline-key]');if(root){const state=timelineState(root);state.date=T.add(state.date,dir*Number($('zoom').value));drawTimeline(root);}return;}if(view==='calendar' && $('calendar-mode').value==='month'){const d=new Date(anchor.slice(0,8)+'01T12:00:00');d.setMonth(d.getMonth()+dir);anchor=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;}else anchor=S.addDays(anchor,dir*(view==='panorama'?Number($('zoom').value):7));render();}
  $('prev').onclick=()=>shift(-1);$('next').onclick=()=>shift(1);
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='当前浏览器不支持全屏';}};
  function connect(){if(source)source.close();source=new EventSource('/api/view/events');source.addEventListener('connected',()=>{live=true;load();});source.addEventListener('changed',load);source.onerror=()=>{live=false;status(true);};}
  let timer=setInterval(()=>{if(!document.hidden)load();},60000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){source?.close();source=null;live=false;}else{load();connect();}});
  window.addEventListener('pagehide',()=>{clearInterval(timer);source?.close();});
  window.addEventListener('pageshow',e=>{if(e.persisted){timer=setInterval(()=>{if(!document.hidden)load();},60000);load();connect();}});
  let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{document.querySelectorAll('[data-timeline-key]').forEach(root=>{if(root.clientWidth)drawTimeline(root);});});});
  load();connect();
})();
