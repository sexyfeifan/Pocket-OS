'use strict';
(() => {
  const W = PocketWorkflow, S = PocketSchedule, $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('pocket-view-prefs') || '{}'); } catch {}
  let view = ['overview','cards','calendar','panorama'].includes(prefs.view) ? prefs.view : 'overview';
  let anchor = today(), topics = [], loaded = false, loading = false, queued = false, lastGood = '', live = false, source, detail = null;
  const dateText = ranges => W.rangeText(ranges).replaceAll(`${today().slice(0,4)}-`, '');
  ['search','phase','category','calendar-mode','zoom'].forEach(id => { if (prefs[id] != null) $(id).value = prefs[id]; });
  $('completed').checked = !!prefs.completed;
  function savePrefs() {
    prefs = { view, completed: $('completed').checked };
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
    const a = W.attention(items, today());
    const panels = [ ['今天进行中',a.today,'今天没有安排中的节点'], ['未来七天 · 拍摄与发布',a.upcoming,'未来七天暂无拍摄或发布'],
      ['逾期未完成',a.overdue,'没有逾期节点'], ['待安排 / 待反馈 / 调整中',a.unresolved,'没有待处理项目'] ];
    return `<div class="overview-grid">${panels.map(([label,rows,empty]) => `<section class="panel"><h2>${label}<span>${rows.length}</span></h2>${rows.length ? rows.map(r => r.topicId
      ? `<button class="attention-row" data-topic="${esc(r.topicId)}">${esc(r.title)} · ${esc(r.name)}<small>${esc(dateText([{start:r.start,end:r.end}]))}</small></button>`
      : `<button class="attention-row" data-topic="${esc(r.id)}">${esc(r.title)}<small>${esc(W.lifecycleLabels[W.lifecycle(r)])} · ${esc(W.scheduleStatus(r))} · ${esc(W.progressText(r))}</small></button>`).join('') : `<p class="empty">${empty}</p>`}</section>`).join('')}</div>`;
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
  function panorama(items) {
    const count = Number($('zoom').value) || 42, cell = count === 42 ? 34 : 76;
    const start = S.addDays(anchor,-3), end = S.addDays(start,count-1);
    $('date-label').textContent = `${start} ~ ${end}`;
    const dates = Array.from({length:count},(_,i)=>S.addDays(start,i));
    const mobile = innerWidth<=640, titleW = mobile ? 120 : 180;
    return `<p class="help">每行一个项目；色块仅供查看，不可拖动。自定义节点、重叠节点和独立拍摄段全部显示。</p><div class="timeline-scroll"><div class="timeline" style="width:${titleW+cell*count}px"><div class="timeline-head"><div class="timeline-name">项目 / 制作节点</div>${dates.map(d=>`<div class="timeline-date ${d===today()?'today':''}" style="width:${cell}px">${Number(d.slice(5,7))}/${d.slice(-2)}</div>`).join('')}</div>${items.map(t=>{
      const events = W.events([t],start,end,true), lanes = [];
      const blocks = events.map(e=>{
        const left = Math.max(0,Math.round((Date.parse(e.start)-Date.parse(start))/86400000));
        const right = Math.min(count-1,Math.round((Date.parse(e.end)-Date.parse(start))/86400000));
        let lane = lanes.findIndex(last=>last<left); if(lane<0)lane=lanes.length; lanes[lane]=right;
        return `<button class="block" data-topic="${esc(t.id)}" title="${esc(e.name+' · '+e.start+' ~ '+e.end)}" style="left:${left*cell+2}px;top:${lane*29+8}px;width:${(right-left+1)*cell-4}px;background:${e.color||'#F2D98B'}${e.done?'88':''}">${e.done?'✓ ':''}${esc(e.name)}</button>`;
      });
      const todayIndex=dates.indexOf(today());
      return `<div class="timeline-row"><button class="timeline-name" data-topic="${esc(t.id)}"><strong>${esc(t.title)}</strong><small>${esc(W.scheduleStatus(t))} · ${W.stats(t).done}/${W.stats(t).total} 已完成</small></button><div class="tracks" style="width:${count*cell}px;height:${Math.max(80,lanes.length*29+16)}px;background-size:${cell}px 100%">${todayIndex<0?'':`<div class="today-line" style="left:${todayIndex*cell}px"></div>`}${blocks.join('')}${events.length?'':'<p class="help" style="padding:10px">此时间段暂无安排</p>'}</div></div>`;
    }).join('')}</div></div>`;
  }
  function render() {
    const scroll = document.querySelector('.timeline-scroll,.calendar-scroll');
    const position = scroll ? [scroll.scrollLeft,scroll.scrollTop] : [0,0];
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
    $('date-controls').hidden=!['calendar','panorama'].includes(view);
    $('calendar-mode').hidden=view!=='calendar'; $('zoom').hidden=view!=='panorama';
    const items=filtered(); $('count').textContent=`${items.length} 个项目`;
    $('content').innerHTML=items.length ? ({overview,cards,calendar,panorama}[view])(items) : `<p class="empty">${loaded?'没有符合条件的项目。可清除筛选，或在工作台创建项目。':'尚未获取数据，请检查连接后刷新。'}</p>`;
    const next=document.querySelector('.timeline-scroll,.calendar-scroll');if(next){next.scrollLeft=position[0];next.scrollTop=position[1];}
    if(detail && $('detail').open)renderDetail();
  }
  function renderDetail() {
    const y=$('detail').scrollTop;
    if(detail.type==='topic') {
      const t=topics.find(t=>t.id===detail.id);
      $('detail-content').innerHTML=t ? `<h2>${esc(t.title)}</h2><p>${badges(t)}</p><p class="muted">${esc(t.category)} · ${esc(t.platforms.join(' · '))}</p><p class="date">${t.publishDate?'发布 '+esc(t.publishDate):'发布日期未定'}</p><p>${esc(W.progressText(t))}</p>${t.pendingReason?`<p>调整原因：${esc(t.pendingReason)}</p>`:''}
      <section><h3>全部制作节点</h3>${nodes(t)}</section><section><h3>准备事项</h3>${t.preparationTasks.length?t.preparationTasks.map(p=>`<p>${p.done?'✓':'○'} ${esc(p.text)}</p>`).join(''):'<p class="muted">暂无事项</p>'}</section>
      <section><h3>日期备注</h3>${Object.keys(t.notes).length?Object.entries(t.notes).sort().map(([d,n])=>`<p><strong>${esc(d)}</strong><br>${esc(n)}</p>`).join(''):'<p class="muted">暂无备注</p>'}</section><p class="help">最近修改：${t.updatedAt?esc(new Date(t.updatedAt).toLocaleString('zh-CN')):'—'}</p>` : '<p class="empty">该项目已从工作台移除。</p>';
    } else {
      const rows=W.events(filtered(),detail.id,detail.id,true);
      $('detail-content').innerHTML=`<h2>${detail.id} · 当天安排</h2>${rows.length?rows.map(e=>`<button class="attention-row" data-topic="${esc(e.topicId)}">${esc(e.title)} · ${esc(e.name)}<small>${esc(W.rangeText([{start:e.start,end:e.end}]))}${e.done?' · 已完成':''}</small></button>`).join(''):'<p class="empty">当天暂无安排</p>'}`;
    }
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
    if(target.dataset.view){view=target.dataset.view;savePrefs();render();}
    if(target.dataset.topic || target.dataset.day){detail={type:target.dataset.topic?'topic':'day',id:target.dataset.topic||target.dataset.day};renderDetail();if(!$('detail').open)$('detail').showModal();}
  });
  $('close-detail').onclick=()=>$('detail').close();
  $('detail').addEventListener('close',()=>detail=null);
  ['search','phase','category','completed','calendar-mode','zoom'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{savePrefs();render();}));
  $('reset').onclick=()=>{['search','phase','category'].forEach(id=>$(id).value='');$('completed').checked=false;savePrefs();render();};
  $('refresh').onclick=load;
  $('today').onclick=()=>{anchor=today();render();const agenda=document.querySelector('[data-agenda-date="'+today()+'"]');if(agenda)agenda.scrollIntoView({block:'start',behavior:'smooth'});else{const day=document.querySelector('.day.today');if(day)day.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});}};
  function shift(dir){if(view==='calendar' && $('calendar-mode').value==='month'){const d=new Date(anchor.slice(0,8)+'01T12:00:00');d.setMonth(d.getMonth()+dir);anchor=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;}else anchor=S.addDays(anchor,dir*(view==='panorama'?Number($('zoom').value):7));render();}
  $('prev').onclick=()=>shift(-1);$('next').onclick=()=>shift(1);
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='当前浏览器不支持全屏';}};
  function connect(){if(source)source.close();source=new EventSource('/api/view/events');source.addEventListener('connected',()=>{live=true;load();});source.addEventListener('changed',load);source.onerror=()=>{live=false;status(true);};}
  let timer=setInterval(()=>{if(!document.hidden)load();},60000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){source?.close();source=null;live=false;}else{load();connect();}});
  window.addEventListener('pagehide',()=>{clearInterval(timer);source?.close();});
  window.addEventListener('pageshow',e=>{if(e.persisted){timer=setInterval(()=>{if(!document.hidden)load();},60000);load();connect();}});
  load();connect();
})();
