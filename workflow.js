// Pure presentation/workflow rules, shared by the editor, viewer and server.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./schedule'));
  else root.PocketWorkflow = factory(root.PocketSchedule);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  const lifecycleLabels = { preparation: '筹备', production: '制作中', feedback: '待反馈', completed: '已完成' };
  function stats(topic) {
    const steps = topic.productionSteps || [];
    const done = steps.filter(s => s.done).length;
    const scheduled = steps.filter(s => S.ranges(s).length).length;
    return { total: steps.length, done, scheduled, unscheduled: steps.filter(s => !s.done && !S.ranges(s).length).length,
      percent: steps.length ? Math.round(done / steps.length * 100) : 0 };
  }
  function progressText(topic) {
    const s = stats(topic);
    return `已完成 ${s.done}/${s.total} 个节点`;
  }
  function lifecycle(topic) {
    return topic.completed ? 'completed' : ['preparation','production','feedback'].includes(topic.lifecycle)
      ? topic.lifecycle : stats(topic).scheduled ? 'production' : 'preparation';
  }
  function scheduleStatus(topic) {
    if (topic.projectStatus === 'pending') return '调整中';
    const s = stats(topic);
    if (!s.scheduled) return '暂无日期';
    return topic.scheduleConfirmed ? '已确认' : '已有安排';
  }
  function events(topics, from, to, includeCompleted = false) {
    const out = [];
    for (const t of topics) {
      if (t.completed && !includeCompleted) continue;
      for (const s of t.productionSteps || []) S.ranges(s).forEach((r, rangeIndex) => {
        if (r.end >= from && r.start <= to) out.push({ topicId: t.id, title: t.title, key: s.key, name: s.name,
          start: r.start, end: r.end, rangeIndex, done: !!s.done, color: s.color });
      });
      for (const [date, note] of Object.entries(t.notes || {})) if (S.validDate(date) && date >= from && date <= to)
        out.push({ topicId: t.id, title: t.title, key: 'note', name: String(note), start: date, end: date, note: true });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start) || String(a.title).localeCompare(String(b.title)));
  }
  function outlook(topic, today) {
    const all = events([topic], '0001-01-01', '9999-12-31').filter(e => !e.note && !e.done);
    const current = all.filter(e => e.start <= today && e.end >= today).sort((a,b) => a.end.localeCompare(b.end));
    const future = all.filter(e => e.start > today);
    // Completion belongs to a node, not an individual shooting segment. An earlier
    // segment is not overdue while that same node still has a current/future segment.
    return { current, next: future.filter(e => e.start === future[0]?.start),
      overdue: all.filter(e => e.end < today && !all.some(other => other.key === e.key && other.end > e.end)) };
  }
  function outlookText(topic, today) {
    if (topic.completed) return '项目已完成';
    const o = outlook(topic, today), parts = [];
    if (o.current.length) parts.push('当前：' + o.current.map(e => `${e.name} · ${e.end} 结束`).join('；'));
    if (o.next.length) parts.push('接下来：' + o.next.map(e => `${e.name} · ${e.start} 开始${e.end !== e.start ? `，${e.end} 结束` : '（当天结束）'}`).join('；'));
    return parts.join('。') || '暂无后续日期安排，不代表排期未完成';
  }
  function attention(topics, today) {
    const active = topics.filter(t => !t.completed);
    const rows = active.map(t => ({ topic:t, ...outlook(t, today) }));
    return { today: rows.flatMap(o => o.current).sort((a,b) => a.end.localeCompare(b.end)),
      upcoming: rows.flatMap(o => o.next).sort((a,b) => a.start.localeCompare(b.start)),
      overdue: rows.flatMap(o => o.overdue).sort((a,b) => a.end.localeCompare(b.end)),
      unresolved: active.filter(t => t.projectStatus === 'pending' || lifecycle(t) === 'feedback'),
      quiet: rows.filter(o => !o.current.length && !o.next.length && !o.overdue.length && o.topic.projectStatus !== 'pending' && lifecycle(o.topic) !== 'feedback').map(o => o.topic) };
  }
  function overviewPanels(topics, today) {
    const a = attention(topics, today);
    const eventRow = (e,text) => ({ id:e.topicId, title:`${e.title} · ${e.name}`, text });
    return [
      { title:'当前节点 · 结束时间', empty:'当前没有日期覆盖今天的未完成节点', rows:a.today.map(e => eventRow(e, `${e.end} 结束 · ${e.start} 开始`)) },
      { title:'下一节点 · 开始时间', empty:'暂无后续日期安排，不代表排期未完成', rows:a.upcoming.map(e => eventRow(e, `${e.start} 开始 · ${e.end === e.start ? '当天' : e.end}结束`)) },
      { title:'已过结束日 · 待核对', empty:'没有已过结束日的未完成节点', rows:a.overdue.map(e => eventRow(e, `${e.end} 已过结束日 · 尚未标记完成`)) },
      { title:'手动标记 · 待反馈 / 调整中', empty:'没有手动标记的待反馈或调整中项目', rows:a.unresolved.map(t => ({id:t.id,title:t.title,text:[lifecycle(t)==='feedback'?'待反馈':'',t.projectStatus==='pending'?'调整中':'',t.pendingReason||''].filter(Boolean).join(' · ')})) }
    ];
  }
  function snapshot(topic) {
    return (topic.productionSteps || []).map(s => ({ key: s.key, name: s.name, color: s.color, ranges: S.ranges(s) }));
  }
  function diff(before, after) {
    const keys = [...new Set([...before, ...after].map(s => s.key))];
    return keys.flatMap(key => {
      const a = before.find(s => s.key === key), b = after.find(s => s.key === key);
      if (a && b && JSON.stringify(a.ranges) === JSON.stringify(b.ranges)) return [];
      return [{ key, name: b?.name || a?.name || key, before: a?.ranges || [], after: b?.ranges || [],
        added: !a, removed: !b }];
    });
  }
  function rangeText(ranges) { return ranges.length ? ranges.map(r => r.start === r.end ? r.start : `${r.start} ~ ${r.end}`).join('，') : '未安排'; }
  function publicTopic(t) {
    // Explicit allowlist: no settings, API keys, source imports, drafts or history.
    const steps = [...(t.productionSteps || [])];
    if (!steps.some(s=>s.key==='publish') && S.validDate(t.publishDate)) steps.push({key:'publish',name:'发布',color:'#B37D56',startDate:t.publishDate,endDate:t.publishDate});
    const publishDate = S.ranges(steps.find(s=>s.key==='publish'))[0]?.start || '';
    return { id: t.id, title: String(t.title || '未命名项目'), category: t.category || '内容',
      platforms: Array.isArray(t.platforms) ? t.platforms.map(String) : [], publishDate,
      completed: !!t.completed, lifecycle: lifecycle(t), projectStatus: t.projectStatus,
      scheduleConfirmed: !!t.scheduleConfirmed, pendingReason: String(t.pendingReason || ''), updatedAt: t.updatedAt,
      productionSteps: steps.map(s => ({ key: s.key, name: String(s.name || s.key),
        color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#B37D56', done: !!s.done, cleared: !S.ranges(s).length,
        startDate: S.ranges(s)[0]?.start || '', endDate: S.ranges(s).at(-1)?.end || '',
        ...(s.key === 'shoot' ? { segments: S.ranges(s) } : {}) })),
      notes: Object.fromEntries(Object.entries(t.notes || {}).filter(([d]) => S.validDate(d)).map(([d,n]) => [d,String(n)])),
      preparationTasks: (t.preparationTasks || []).map(p => ({ text: String(p.text || ''), done: !!p.done })) };
  }
  const templates = [
    { id:'talk', name:'口播视频', steps:[['script','脚本'],['shoot','录制'],['acopy','剪辑'],['publish','发布']], tasks:['确认选题与脚本','检查录音与画面'] },
    { id:'commercial', name:'商业拍摄', steps:[['script','脚本确认'],['shoot','拍摄'],['acopy','粗剪'],['review','客户审片'],['bcopy','精剪'],['publish','发布']], tasks:['确认客户需求','确认场地与人员','检查授权与交付要求'] },
    { id:'short', name:'轻量短视频', steps:[['script','提纲'],['shoot','拍摄'],['acopy','剪辑'],['publish','发布']], tasks:['确认平台与画幅'] }
  ];
  function blueprint(id, defaults, customs = []) {
    const custom = customs.find(t => t.id === id), builtin = templates.find(t => t.id === id);
    const defs = custom?.steps || (builtin ? builtin.steps.map(([key,name]) => ({key,name,color: defaults.find(d=>d.key===key)?.color || '#B8D4E3'})) : defaults);
    return { productionSteps: S.blankSteps(defs), tasks: custom?.tasks || builtin?.tasks || [] };
  }
  function copyStructure(topic) {
    return { title: (topic.title || '项目') + ' · 副本', category: topic.category || '内容', platforms: [...(topic.platforms || [])],
      productionSteps: S.blankSteps(topic.productionSteps || []), tasks: (topic.preparationTasks || []).map(p=>p.text) };
  }
  return { stats, progressText, lifecycle, lifecycleLabels, scheduleStatus, events, outlook, outlookText, attention, overviewPanels, snapshot, diff, rangeText, publicTopic, templates, blueprint, copyStructure };
});
