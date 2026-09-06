// Shared date operations. Every operation changes only the supplied step.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PocketSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function addDays(value, days) {
    if (!validDate(value) || !Number.isInteger(days)) throw new Error('请选择有效日期');
    const date = new Date(value + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function ranges(step) {
    if (!step || step.cleared || step.skipped) return [];
    const items = step.key === 'shoot' && step.segments?.length
      ? step.segments : step.startDate ? [{ start: step.startDate, end: step.endDate || step.startDate }] : [];
    return items.filter(r => validDate(r.start) && validDate(r.end) && r.start <= r.end)
      .map(r => ({ ...r })).sort((a, b) => a.start.localeCompare(b.start));
  }
  function duration(step) {
    return ranges(step).reduce((n, r) => n + Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000) + 1, 0);
  }
  function setRanges(step, items) {
    const next = items.map(r => ({ ...r })).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < next.length; i++) {
      const r = next[i];
      if (!validDate(r.start) || !validDate(r.end)) throw new Error('请选择有效日期');
      if (r.start > r.end) throw new Error('结束日期不能早于开始日期，请先调整另一端日期');
      if (i && r.start <= next[i - 1].end) throw new Error('同一工序的拍摄段不能重叠，请调整日期');
    }
    if (!next.length) { clear(step); return; }
    if (step.key === 'publish' && (next.length !== 1 || next[0].start !== next[0].end)) throw new Error('发布节点只能选择一天');
    step.startDate = next[0].start;
    step.endDate = next[next.length - 1].end;
    step.cleared = false;
    step.skipped = false;
    if (step.key === 'shoot') step.segments = next;
    else delete step.segments;
    step.duration = duration(step);
  }
  function clear(step) {
    step.startDate = ''; step.endDate = ''; step.cleared = true;
    delete step.segments; delete step._prevStart; delete step._prevEnd;
    delete step.delayed;
  }
  function updateDate(step, field, value) {
    if (!['startDate', 'endDate'].includes(field)) throw new Error('未知日期字段');
    if (!value) { clear(step); return; }
    if (step.key === 'publish') { setRanges(step, [{ start: value, end: value }]); return; }
    if (ranges(step).length > 1) throw new Error('请分别编辑各段拍摄日期');
    const current = ranges(step)[0];
    if (current && current.start === current.end) {
      setRanges(step, [{ start: field === 'startDate' ? value : current.start,
        end: value }]);
      return;
    }
    setRanges(step, [{ start: field === 'startDate' ? value : current?.start || value,
      end: field === 'endDate' ? value : current?.end || value }]);
  }
  function updateSegment(step, index, field, value) {
    const next = ranges(step);
    if (!next[index] || !['start', 'end'].includes(field)) throw new Error('拍摄段不存在');
    next[index][field] = value;
    setRanges(step, next);
  }
  function move(step, targetDate, rangeIndex = null) {
    if (!validDate(targetDate)) throw new Error('请选择有效日期');
    const next = ranges(step);
    if (!next.length) { setRanges(step, [{ start: targetDate, end: targetDate }]); return; }
    const anchor = next[rangeIndex === null ? 0 : rangeIndex];
    if (!anchor) throw new Error('拍摄段不存在');
    const delta = Math.round((Date.parse(targetDate) - Date.parse(anchor.start)) / 86400000);
    setRanges(step, next.map((r, i) => rangeIndex === null || i === rangeIndex
      ? { ...r, start: addDays(r.start, delta), end: addDays(r.end, delta) } : r));
  }
  function blankSteps(defs) {
    return defs.map(d => ({ key: d.key, name: d.name, color: d.color, duration: d.duration || 1,
      startDate: '', endDate: '', done: false, cleared: true }));
  }
  function syncPublish(topic) {
    const publish = (topic.productionSteps || []).find(s => s.key === 'publish');
    topic.publishDate = ranges(publish)[0]?.start || '';
  }
  return { validDate, addDays, ranges, duration, setRanges, clear, updateDate, updateSegment, move, blankSteps, syncPublish };
});
