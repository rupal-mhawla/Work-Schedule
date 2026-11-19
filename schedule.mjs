export const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const empty = () => ({hours:Array(7).fill(''), buffer:10, tasks:[], done:{}, contacts:{}});
export const minute = value => {
  const [h,m] = value.split(':').map(Number);
  return h*60+m;
};
export function ranges(value) {
  if (!value.trim()) return [];
  const result = value.split(',').map(part => {
    const match = part.trim().match(/^([01]\d|2[0-3]):([0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d|24:00)$/);
    if (!match) throw Error('Use ranges such as 10:30-14:20.');
    const start = minute(match[1]+':'+match[2]), end = minute(match[3]);
    if (start >= end) throw Error('End times must be after start times.');
    return [start,end];
  }).sort((a,b)=>a[0]-b[0]);
  if (result.some(([start],i)=>i && start < result[i-1][1])) throw Error('Availability ranges overlap.');
  return result;
}
export function today() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
export function estimate(task) {
  return task.minutes || task.estimate || 30;
}
function subtract(slots, start, end) {
  return slots.flatMap(([a,b])=> end<=a || start>=b ? [[a,b]] : [
    ...(a<start?[[a,start]]:[]), ...(end<b?[[end,b]]:[])
  ]);
}
export function schedule(state,date) {
  const day = new Date(date+'T00:00:00Z').getUTCDay();
  const windows = ranges(state.hours[day]);
  let slots = windows.slice();
  const rows = [], overflow = [], completed = [];
  const fixed = state.tasks.filter(t=>t.fixedStart && t.fixedStart.slice(0,10) <= date && t.fixedEnd.slice(0,10) >= date);
  for (const task of fixed) {
    const start = task.fixedStart.startsWith(date) ? minute(task.fixedStart.slice(11)) : 0;
    const end = task.fixedEnd.startsWith(date) ? minute(task.fixedEnd.slice(11)) : 1440;
    if (start >= end) continue;
    const clash = rows.some(row=>row.start < end && start < row.end);
    rows.push({task,start,end,detail:clash?'Overlaps another appointment':'Fixed appointment'});
    slots = subtract(slots,start,end);
  }
  for (const [start,end] of windows) {
    let remaining = state.buffer;
    for (const [a,b] of slots.slice().reverse()) {
      if (!remaining || a<start || b>end) continue;
      const reserved = Math.min(remaining,b-a);
      rows.push({start:b-reserved,end:b,detail:'Buffer'});
      slots = subtract(slots,b-reserved,b);
      remaining -= reserved;
    }
  }
  const tasks = state.tasks.filter(task=>!task.fixedStart && (!task.startDate || task.startDate<=date));
  const pending = tasks.filter(task=>{
    const done = state.done[task.id];
    if (task.repeat==='daily' ? done?.includes(date) : done?.length) {
      if (done.includes(date)) completed.push(task);
      return false;
    }
    return true;
  });
  const buckets = task => task.priority==='urgent' ? 0 : task.due && task.due.slice(0,10)<=date ? 1 : task.window !== 'any' ? 2 : task.due ? 3 : 4;
  pending.sort((a,b)=>buckets(a)-buckets(b) || (a.due||'9999').localeCompare(b.due||'9999') || (a.order||0)-(b.order||0));
  for (const task of pending) {
    const duration = estimate(task);
    const limit = task.window==='morning' ? 720 : task.window==='first' ? windows[0]?.[1] ?? 0 : 1440;
    const earliest = task.notBefore ? minute(task.notBefore) : 0;
    const fits = ([start,end])=>Math.max(earliest,start)+duration<=Math.min(end,limit);
    const deadline = !task.due || task.due.slice(0,10)>date ? 1440 : task.due.slice(0,10)<date ? 0 : minute(task.due.slice(11));
    const slot = slots.find(s=>fits(s) && Math.max(earliest,s[0])+duration<=deadline) || slots.find(fits);
    if (!slot) {
      overflow.push({task,detail:task.window==='any'?'No available block long enough':'No room in the required work window'});
      continue;
    }
    const start = Math.max(earliest,slot[0]), end = start+duration;
    rows.push({task,start,end,detail:end>deadline?'Scheduled after deadline':''});
    slots = subtract(slots,start,end);
  }
  return {rows:rows.sort((a,b)=>a.start-b.start),overflow,completed};
}


