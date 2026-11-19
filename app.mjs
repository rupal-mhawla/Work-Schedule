import {weekdays,empty,ranges,today,estimate,schedule} from './schedule.mjs';

const get = id => document.getElementById(id);
const storage = 'work-planner-v1';
const read = (key,fallback) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
let state = read(storage,empty());
let backend, session, revision;
let busy = false;
let editing;
const date = get('date');
date.value = today();
const form = get('taskForm');
const hours = get('hours');
const setting = get('sync');
const status = message => { get('status').textContent = message; };
const button = (title, handler) => {
  const element = document.createElement('button');
  element.className = 'secondary';
  element.textContent = title;
  element.onclick = handler;
  return element;
};
function options(id,values) {
  get(id).replaceChildren(...values.map(value=>new Option(value,value)));
}
function time(m) {
  const h = Math.floor(m/60);
  return (h%12||12)+':'+String(m%60).padStart(2,'0')+' '+(h%24<12?'AM':'PM');
}
function row({task,start,end,detail}, done = false){
  const container = document.createElement('article');
  container.className = 'row'+(start===undefined?' no-time':'')+(!task?' buffer':'')+(done?' done':'')+(task?.priority==='urgent'?' urgent':'');
  if (start!==undefined) {
    const span = document.createElement('span');
    span.className = 'time';
    span.textContent = time(start)+' – '+(end===1440?'midnight':time(end));
    container.append(span);
  }
  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = task?.title || detail;
  body.append(title);
  if (task) {
    const meta = document.createElement('p');
    meta.textContent = [
      task.contact,task.project,task.priority==='urgent'?'Urgent':'',
      !task.fixedStart && (estimate(task)+' min'+(task.minutes?'':' estimated')),
      task.fixedStart && task.fixedStart.replace('T',' '),
      task.repeat==='daily'?'Daily':'',task.due && 'Due '+task.due.replace('T',' '),detail, task.notes
    ].filter(Boolean).join(' · ');
    body.append(meta);
  }
  container.append(body);
  if (task) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(button('Edit',()=>edit(task)));
    if (!task.fixedStart) {
      const markDate = date.value;
      const canComplete = !task.startDate || task.startDate<=markDate;
      const completed = task.repeat==='daily' ? state.done[task.id]?.includes(markDate) : !!state.done[task.id]?.length;
      if (canComplete || completed) actions.append(button(completed?'Undo done':'Done',()=>change(next=>{
        const dates = next.done[task.id] || [];
        next.done[task.id] = completed ? (task.repeat==='daily'?dates.filter(d=>d!==markDate):[]) : [...dates,markDate];
      })));
    }
    container.append(actions);
  }
  return container;
}
function populate(id,items,fallback) {
  const container = get(id);
  container.replaceChildren(...items);
  if (!items.length) container.textContent = fallback;
}
function render() {
  const {rows,overflow,completed} = schedule(state,date.value);
  const count = rows.filter(entry=>entry.task && !entry.task.fixedStart).length;
  get('dayInfo').textContent = count+' scheduled · '+completed.length+' completed · Eastern time';
  populate('timeline',[...rows.map(entry=>row(entry)),...completed.map(task=>row({task,detail:'Completed'},true))],'No schedule for this date. Add tasks or set your availability.');
  populate('overflow',overflow.map(entry=>row(entry)),'All pending tasks fit.');
  populate('list',state.tasks.map(task=>{
    const done = state.done[task.id];
    const complete = task.repeat==='daily'?done?.includes(date.value):!!done?.length;
    return row({task,detail:complete?'Completed':task.startDate?'Available from '+task.startDate:''},complete);
  }),'No tasks yet.');
  options('contacts',Object.keys(state.contacts||{}));
  options('projects',[...new Set(Object.values(state.contacts||{}).flat())]);
  get('connected').hidden = !session;
  setting.hidden = !!session;
  get('syncInfo').textContent = 'Changes are saved in this browser. Sign in to the same cloud planner on each device to sync.';
}
function renderHours() {
  weekdays.forEach((_,i)=>{ hours.elements['day'+i].value=state.hours[i]; });
  hours.elements.buffer.value=state.buffer;
}
async function change(mutate) {
  if (busy) return false;
  busy = true;
  try {
    const next = structuredClone(state);
    mutate(next);
    if (session) await push(next);
    if (!session) localStorage.setItem(storage,JSON.stringify(next));
    state = next;
    render();
    status(session?'Saved to your cloud planner.':'Saved on this device.');
    return true;
  } catch(error) {
    status(error.message);
    return false;
  } finally { busy=false; }
}
function edit(task) {
  form.reset();
  editing = task?.id;
  get('formError').textContent = '';
  get('editorTitle').textContent = editing?'Edit task':'Add task';
  get('deleteTask').hidden = !editing;
  if (task) for (const [name,value] of Object.entries(task)) {
    const field = form.elements.namedItem(name);
    if (field) field.value=value ?? '';
  }
  else form.elements.startDate.value=date.value;
  options('projects',state.contacts[form.elements.contact.value] || Object.values(state.contacts).flat());
  get('editor').showModal();
}
form.elements.contact.addEventListener('input',()=>options('projects',state.contacts[form.elements.contact.value] || Object.values(state.contacts).flat()));
form.onsubmit = async event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  fields.title = fields.title.trim();
  if (!fields.title || Boolean(fields.fixedStart)!==Boolean(fields.fixedEnd) || (fields.fixedStart && fields.fixedStart>=fields.fixedEnd)) {
    get('formError').textContent='Enter a task title and, for an appointment, an end after its start.';
    return;
  }
  const original = state.tasks.find(task=>task.id===editing);
  const task = {...original,...fields,id:editing||crypto.randomUUID(),minutes:Number(fields.minutes)||null};
  if (task.fixedStart) task.repeat='once';
  if (await change(next=>{
    if (editing) next.tasks=next.tasks.map(item=>item.id===editing?task:item);
    else next.tasks.push(task);
  })) get('editor').close();
  else get('formError').textContent=get('status').textContent;
};
get('deleteTask').onclick = async () => {
  if (!confirm('Delete this task and its completion history?')) return;
  if (await change(next=>{
    next.tasks=next.tasks.filter(task=>task.id!==editing);
    delete next.done[editing];
  })) get('editor').close();
  else get('formError').textContent=get('status').textContent;
};
get('newTask').onclick=()=>edit();
get('close').onclick=()=>get('editor').close();
date.onchange=()=>{ if (!date.value) date.value=today(); render(); };
for (const tab of document.querySelectorAll('[data-view]')) tab.onclick=()=>{
  for (const item of document.querySelectorAll('[data-view]')) {
    const selected=item===tab;
    item.setAttribute('aria-pressed',selected);
    get(item.dataset.view).hidden=!selected;
  }
};
for (const [i,name] of weekdays.entries()) {
  const label=document.createElement('label');
  label.textContent=name;
  const input=document.createElement('input');
  input.name='day'+i;
  label.append(input);
  get('week').append(label);
}
hours.onsubmit=async event=>{
  event.preventDefault();
  await change(next=>{
    next.hours=weekdays.map((_,i)=>{
      const value=hours.elements['day'+i].value.trim();
      ranges(value);
      return value;
    });
    next.buffer=Number(hours.elements.buffer.value);
  });
};
function validate(data) {
  if (!data || !Array.isArray(data.hours) || data.hours.length!==7 ||
    !Number.isInteger(data.buffer) || data.buffer<0 || data.buffer>120 ||
    !Array.isArray(data.tasks) || !data.done || !data.contacts ||
    data.tasks.some(t=>typeof t.id!=='string'||typeof t.title!=='string'||
      (t.minutes!=null && (!Number.isInteger(t.minutes)||t.minutes<1||t.minutes>1440)) ||
      (t.estimate!=null && (!Number.isInteger(t.estimate)||t.estimate<1||t.estimate>1440)) ||
      (Boolean(t.fixedStart)!==Boolean(t.fixedEnd)) ||
      (t.fixedStart && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(t.fixedStart) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(t.fixedEnd) || t.fixedStart>=t.fixedEnd))) ||
    Object.values(data.done).some(dates=>!Array.isArray(dates)) ||
    Object.values(data.contacts).some(projects=>!Array.isArray(projects))) {
    throw Error('Choose a valid Work Planner backup.');
  }
  data.hours.forEach(ranges);
  return data;
}
get('import').onchange=async event=>{
  const file=event.target.files[0];
  if (!file) return;
  try {
    const data=validate(JSON.parse(await file.text()));
    if (state.tasks.length && !confirm('Replace your current planner with this file?')) return;
    if (await change(next=>Object.assign(next,data))) renderHours();
  } catch(error) { status(error.message); }
  finally { event.target.value=''; }
};
get('export').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='work-planner-backup.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

async function request(path,{method='GET',body,token,prefer}={}) {
  const headers={apikey:backend.key,'Content-Type':'application/json'};
  if (token) headers.Authorization='Bearer '+token;
  if (prefer) headers.Prefer=prefer;
  const response=await fetch(backend.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json().catch(()=>null);
  if (!response.ok) throw Error(result?.message || result?.msg || 'Cloud request failed ('+response.status+').');
  return result;
}
function remember(result) {
  session={access:result.access_token,refresh:result.refresh_token,expires:Date.now()+result.expires_in*1000};
  localStorage.setItem(storage+'-sync',JSON.stringify({backend,session}));
}
async function token() {
  if (session.expires-Date.now()<60000) {
    remember(await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh}}));
  }
  return session.access;
}
const table='/rest/v1/work_planners';
async function pull() {
  const access=await token();
  const [existing]=await request(table+'?select=revision,snapshot',{token:access});
  if (existing) {
    state=validate(existing.snapshot);
    revision=existing.revision;
  } else {
    const [created]=await request(table,{method:'POST',token:access,prefer:'return=representation',body:{snapshot:state}});
    revision=created.revision;
  }

  renderHours();
  render();
}
async function push(snapshot) {
  const result=await request(table+'?revision=eq.'+revision,{
    method:'PATCH',token:await token(),prefer:'return=representation',body:{snapshot,revision:revision+1}
  });
  if (!result.length) throw Error('This planner changed on another device. Refresh from cloud in Settings, then retry your edit.');
  revision=result[0].revision;
}
setting.onsubmit=async event=>{
  event.preventDefault();
  if (busy) return;
  busy=true;
  const fields=Object.fromEntries(new FormData(setting));
  try {
    const url=new URL(fields.url);
    if (url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw Error('Enter the HTTPS Supabase project URL.');
    backend={url:url.origin,key:fields.key.trim()};
    const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:fields.email,password:fields.password}});
    if (state.tasks.length && !confirm('Connect this device? If a cloud planner exists, it will replace your local copy.')) return;
    remember(result);
    await pull();
    setting.elements.password.value='';
    status('Cloud sync connected.');
  } catch(error) {
    session=null;
    localStorage.removeItem(storage+'-sync');
    render();
    status(error.message);
  } finally { busy=false; }
};
get('refresh').onclick=async ()=>{
  if (busy) return;
  busy=true;
  try { await pull(); status('Cloud planner refreshed.'); }
  catch(error) { status(error.message); }
  finally { busy=false; }
};
get('disconnect').onclick=async ()=>{
  if (busy) return;
  busy=true;
  try {
    await request('/auth/v1/logout?scope=local',{method:'POST',token:await token()});
  } catch {
    status('Signed out on this device. The remote session could not be revoked.');
  } finally {
    session=null;
    localStorage.removeItem(storage+'-sync');
    state=read(storage,empty());
    renderHours();
    busy=false;
    render();
  }
};
renderHours();
render();
const saved=read(storage+'-sync',null);
if (saved) {
  ({backend,session}=saved);
  render();
  get('refresh').click();
}


