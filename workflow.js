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
    return `已完成 ${s.done}/${s.total} 个节点${s.unscheduled ? ` · ${s.unscheduled} 个未排期` : ''}`;
  }
  function lifecycle(topic) {
    return topic.completed ? 'completed' : ['preparation','production','feedback'].includes(topic.lifecycle)
      ? topic.lifecycle : stats(topic).scheduled ? 'production' : 'preparation';
  }
  function scheduleStatus(topic) {
    if (topic.projectStatus === 'pending') return '调整中';
    const s = stats(topic);
    if (!s.scheduled) return '未排期';
    if (topic.scheduleConfirmed) return s.unscheduled ? '部分已确认' : '已确认';
    return s.unscheduled ? '部分已排' : '待确认';
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
  function attention(topics, today) {
    const active = topics.filter(t => !t.completed);
    const all = events(active, '0001-01-01', '9999-12-31').filter(e => !e.note && !e.done);
    return { today: all.filter(e => e.start <= today && e.end >= today),
      upcoming: all.filter(e => ['shoot','publish'].includes(e.key) && e.end >= today && e.start <= S.addDays(today, 6)),
      overdue: all.filter(e => e.end < today),
      unresolved: active.filter(t => stats(t).unscheduled || t.projectStatus === 'pending' || lifecycle(t) === 'feedback') };
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
  return { stats, progressText, lifecycle, lifecycleLabels, scheduleStatus, events, attention, snapshot, diff, rangeText, publicTopic, templates, blueprint, copyStructure };
});
