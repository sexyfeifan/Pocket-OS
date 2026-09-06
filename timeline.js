// Read-only timeline geometry. Labels get their own space; bars always keep real dates.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PocketTimeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DAY = 86400000, MIN = Date.parse('0001-01-01') / DAY, MAX = Date.parse('9999-12-31') / DAY;
  const number = date => Math.round(Date.parse(date) / DAY);
  const date = n => new Date(Math.max(MIN, Math.min(MAX, n)) * DAY).toISOString().slice(0,10);
  const add = (d,n) => date(number(d) + n);
  function windowStart(left, count = 180) { return date(Math.min(MAX-count+1, Math.max(MIN,number(left)-45))); }
  function cellWidth(width, titleWidth, zoom) { return Math.max(zoom === 42 ? 28 : 72, (width-titleWidth) / zoom); }
  function bounds(events) {
    return events.length ? { first:events.reduce((d,e)=>e.start<d?e.start:d,events[0].start), last:events.reduce((d,e)=>e.end>d?e.end:d,events[0].end) } : null;
  }
  function layout(events, start, count, cell, labelWidth = 220) {
    const lanes = [], end = add(start,count-1);
    const blocks = events.filter(e=>e.start<=end&&e.end>=start).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)).map(e=>{
      const left = Math.max(0, number(e.start)-number(start))*cell + 2;
      const width = (Math.min(count-1,number(e.end)-number(start))-Math.max(0,number(e.start)-number(start))+1)*cell-4;
      let lane=lanes.findIndex(right=>right+10<=left);if(lane<0)lane=lanes.length;
      lanes[lane]=left+Math.max(width,labelWidth);
      return {...e,left,width,labelWidth,lane,clippedStart:e.start<start,clippedEnd:e.end>end};
    });
    return {blocks,lanes:lanes.length};
  }
  // Ignore clicks following mouse panning, including a pan that returns to its origin.
  function gesture() {
    let lastX=0,lastY=0,active=false,moved=false;
    return { start(x,y){lastX=x;lastY=y;active=true;moved=false;},
      move(x,y){if(!active)return null;const dx=lastX-x,dy=lastY-y;if(moved||Math.abs(dx)>4||Math.abs(dy)>4){moved=true;lastX=x;lastY=y;return {dx,dy};}return null;},
      end(){active=false;return moved;} };
  }
  return {number,date,add,windowStart,cellWidth,bounds,layout,gesture};
});
