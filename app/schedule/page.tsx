"use client";

import { useEffect, useMemo, useState } from "react";
import { requireActiveStaff } from "../../lib/auth";
import { supabase } from "../../lib/supabase";

type Task = {
  id: string; project_id: string; name: string; trade: string | null;
  start_date: string; duration_work_days: number; progress: number;
  status: "not_started" | "in_progress" | "complete" | "on_hold";
  is_milestone: boolean; sort_order: number; notes: string | null;
};
type Dependency = { id: string; predecessor_id: string; successor_id: string; lag_work_days: number };
type Calculated = Task & { calculatedStart: Date; calculatedFinish: Date; critical: boolean };

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseDate = (s: string) => new Date(`${s}T12:00:00`);
const isWorkday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;
function nextWorkday(date: Date, amount = 1) {
  const d = new Date(date); let moved = 0;
  while (moved < amount) { d.setDate(d.getDate() + 1); if (isWorkday(d)) moved++; }
  while (!isWorkday(d)) d.setDate(d.getDate() + 1);
  return d;
}
function finishDate(start: Date, duration: number) {
  if (duration <= 1) return new Date(start);
  return nextWorkday(start, duration - 1);
}
function workdayDistance(a: Date, b: Date) {
  let count = 0; const d = new Date(a);
  while (d < b) { d.setDate(d.getDate() + 1); if (isWorkday(d)) count++; }
  return count;
}

function calculate(tasks: Task[], deps: Dependency[]): Calculated[] {
  const result = new Map<string, Calculated>();
  const visiting = new Set<string>();
  const byId = new Map(tasks.map(t => [t.id, t]));
  function visit(task: Task): Calculated {
    if (result.has(task.id)) return result.get(task.id)!;
    if (visiting.has(task.id)) {
      const start = parseDate(task.start_date);
      return { ...task, calculatedStart: start, calculatedFinish: finishDate(start, task.duration_work_days), critical: false };
    }
    visiting.add(task.id);
    let start = parseDate(task.start_date);
    deps.filter(d => d.successor_id === task.id).forEach(dep => {
      const pred = byId.get(dep.predecessor_id); if (!pred) return;
      const p = visit(pred);
      const candidate = nextWorkday(p.calculatedFinish, 1 + Math.max(0, dep.lag_work_days));
      if (candidate > start) start = candidate;
    });
    visiting.delete(task.id);
    const value = { ...task, calculatedStart: start, calculatedFinish: finishDate(start, task.duration_work_days), critical: false };
    result.set(task.id, value); return value;
  }
  tasks.forEach(visit);
  const values = [...result.values()];
  if (!values.length) return values;
  const projectFinish = new Date(Math.max(...values.map(t => +t.calculatedFinish)));
  const critical = new Set(values.filter(t => +t.calculatedFinish === +projectFinish).map(t => t.id));
  let changed = true;
  while (changed) {
    changed = false;
    deps.forEach(d => {
      if (!critical.has(d.successor_id)) return;
      const p = result.get(d.predecessor_id), s = result.get(d.successor_id); if (!p || !s) return;
      const expected = nextWorkday(p.calculatedFinish, 1 + Math.max(0, d.lag_work_days));
      if (+expected === +s.calculatedStart && !critical.has(p.id)) { critical.add(p.id); changed = true; }
    });
  }
  return values.map(t => ({ ...t, critical: critical.has(t.id) })).sort((a,b) => a.sort_order - b.sort_order || +a.calculatedStart - +b.calculatedStart);
}

const emptyTask = (projectId: string): Partial<Task> => ({ project_id: projectId, name: "", trade: "", start_date: iso(new Date()), duration_work_days: 1, progress: 0, status: "not_started", is_milestone: false, notes: "" });

export default function SchedulePage() {
  const [profile, setProfile] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const [predId, setPredId] = useState(""); const [succId, setSuccId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    const p = await requireActiveStaff(); if (!p) return; setProfile(p);
    let data: any[] = [];
    if (p.role === "admin") {
      const r = await supabase.from("projects").select("*").order("project_name"); if (r.error) return alert(r.error.message); data = r.data || [];
    } else {
      const r = await supabase.from("project_staff").select("projects(*)").eq("staff_id", p.id); if (r.error) return alert(r.error.message);
      data = r.data?.map((x:any) => x.projects).filter(Boolean) || [];
    }
    setProjects(data); if (data[0]) setProjectId(data[0].id); setLoading(false);
  })(); }, []);

  async function loadSchedule(id: string) {
    if (!id) return;
    const [t, d] = await Promise.all([
      supabase.from("schedule_tasks").select("*").eq("project_id", id).order("sort_order"),
      supabase.from("schedule_dependencies").select("*").eq("project_id", id)
    ]);
    if (t.error || d.error) return alert(t.error?.message || d.error?.message);
    setTasks(t.data || []); setDeps(d.data || []);
  }
  useEffect(() => { loadSchedule(projectId); setEditing(null); }, [projectId]);

  const calculated = useMemo(() => calculate(tasks, deps), [tasks, deps]);
  const range = useMemo(() => {
    if (!calculated.length) return null;
    const start = new Date(Math.min(...calculated.map(t => +t.calculatedStart)));
    const finish = new Date(Math.max(...calculated.map(t => +t.calculatedFinish)));
    return { start, finish, days: Math.max(1, Math.round((+finish - +start) / DAY) + 1) };
  }, [calculated]);

  async function saveTask() {
    if (!editing?.name?.trim() || !projectId) return alert("Enter a task name.");
    const payload = { project_id: projectId, name: editing.name.trim(), trade: editing.trade || null, start_date: editing.start_date, duration_work_days: editing.is_milestone ? 0 : Number(editing.duration_work_days || 1), progress: Number(editing.progress || 0), status: editing.status, is_milestone: !!editing.is_milestone, notes: editing.notes || null, sort_order: editing.sort_order ?? tasks.length, created_by: profile?.id };
    const r = editing.id ? await supabase.from("schedule_tasks").update(payload).eq("id", editing.id) : await supabase.from("schedule_tasks").insert(payload);
    if (r.error) return alert(r.error.message); setEditing(null); loadSchedule(projectId);
  }
  async function removeTask(id: string) {
    if (!confirm("Delete this schedule activity?")) return;
    const r = await supabase.from("schedule_tasks").delete().eq("id", id); if (r.error) return alert(r.error.message); loadSchedule(projectId);
  }
  async function addDependency() {
    if (!predId || !succId || predId === succId) return alert("Choose two different tasks.");
    const r = await supabase.from("schedule_dependencies").insert({ project_id: projectId, predecessor_id: predId, successor_id: succId, lag_work_days: 0 });
    if (r.error) return alert(r.error.message); setPredId(""); setSuccId(""); loadSchedule(projectId);
  }
  async function removeDependency(id: string) {
    const r = await supabase.from("schedule_dependencies").delete().eq("id", id); if (r.error) return alert(r.error.message); loadSchedule(projectId);
  }

  if (loading) return <main style={{padding:24}}>Loading schedule…</main>;
  return <main style={{padding:24, maxWidth:1500, margin:"0 auto"}}>
    <div style={{display:"flex", justifyContent:"space-between", gap:16, alignItems:"end", flexWrap:"wrap"}}>
      <div><h1 style={{marginBottom:4}}>Project Schedule</h1><div style={{color:"#64748b"}}>Monday–Friday working calendar</div></div>
      <div style={{display:"flex", gap:10, alignItems:"end"}}><label>Project<br/><select value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.project_name}</option>)}</select></label><button onClick={()=>setEditing(emptyTask(projectId))}>+ Add activity</button></div>
    </div>

    {editing && <section className="card" style={{marginTop:20}}><h2>{editing.id ? "Edit" : "Add"} activity</h2><div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:12}}>
      <label>Activity<input value={editing.name||""} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
      <label>Trade / Responsible<input value={editing.trade||""} onChange={e=>setEditing({...editing,trade:e.target.value})}/></label>
      <label>Earliest start<input type="date" value={editing.start_date||""} onChange={e=>setEditing({...editing,start_date:e.target.value})}/></label>
      <label>Work days<input type="number" min="1" disabled={editing.is_milestone} value={editing.is_milestone?0:editing.duration_work_days||1} onChange={e=>setEditing({...editing,duration_work_days:Number(e.target.value)})}/></label>
      <label>Status<select value={editing.status} onChange={e=>setEditing({...editing,status:e.target.value as Task["status"]})}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="on_hold">On hold</option></select></label>
      <label>Progress %<input type="number" min="0" max="100" value={editing.progress||0} onChange={e=>setEditing({...editing,progress:Number(e.target.value)})}/></label>
    </div><label style={{display:"block",marginTop:12}}><input type="checkbox" checked={!!editing.is_milestone} onChange={e=>setEditing({...editing,is_milestone:e.target.checked})}/> Milestone</label><label style={{display:"block",marginTop:12}}>Notes<textarea value={editing.notes||""} onChange={e=>setEditing({...editing,notes:e.target.value})}/></label><div style={{display:"flex",gap:10,marginTop:12}}><button onClick={saveTask}>Save</button><button className="secondary" onClick={()=>setEditing(null)}>Cancel</button></div></section>}

    <section className="card" style={{marginTop:20}}><h2>Dependencies</h2><div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}><label>Predecessor<br/><select value={predId} onChange={e=>setPredId(e.target.value)}><option value="">Choose…</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><span>→</span><label>Successor<br/><select value={succId} onChange={e=>setSuccId(e.target.value)}><option value="">Choose…</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button onClick={addDependency}>Add link</button></div><div style={{marginTop:10}}>{deps.map(d=><button key={d.id} className="secondary" onClick={()=>removeDependency(d.id)} style={{margin:"4px 8px 4px 0"}}>{tasks.find(t=>t.id===d.predecessor_id)?.name} → {tasks.find(t=>t.id===d.successor_id)?.name} ×</button>)}</div></section>

    <section className="card" style={{marginTop:20,overflowX:"auto"}}><div style={{display:"flex",gap:16,fontSize:13,marginBottom:12}}><span>■ Normal</span><span style={{color:"#dc2626"}}>■ Critical</span><span>◆ Milestone</span></div>
      {!calculated.length ? <p>No schedule activities yet.</p> : <div style={{minWidth:900}}>{calculated.map(t=>{
        const left = range ? workdayDistance(range.start,t.calculatedStart)/Math.max(1,workdayDistance(range.start,nextWorkday(range.finish)))*100 : 0;
        const width = range ? Math.max(1.2,(Math.max(1,t.duration_work_days)/Math.max(1,workdayDistance(range.start,nextWorkday(range.finish))))*100) : 1;
        return <div key={t.id} style={{display:"grid",gridTemplateColumns:"310px 1fr",borderTop:"1px solid #e2e8f0",minHeight:54,alignItems:"center"}}><div style={{padding:"7px 8px"}}><div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{t.name}</strong><span><button className="secondary" onClick={()=>setEditing(t)}>Edit</button> <button className="secondary" onClick={()=>removeTask(t.id)}>×</button></span></div><small>{t.trade||"Unassigned"} · {iso(t.calculatedStart)} → {iso(t.calculatedFinish)} · {t.progress}%</small></div><div style={{position:"relative",height:34,background:"repeating-linear-gradient(90deg,#f8fafc 0,#f8fafc 24px,#eef2f7 25px)"}}>{t.is_milestone?<div title={t.name} style={{position:"absolute",left:`${left}%`,top:9,width:16,height:16,background:t.critical?"#dc2626":"#2563eb",transform:"rotate(45deg)"}}/>:<div title={t.name} style={{position:"absolute",left:`${left}%`,width:`${width}%`,minWidth:8,top:7,height:20,borderRadius:4,background:t.critical?"#dc2626":"#2563eb",overflow:"hidden"}}><div style={{height:"100%",width:`${t.progress}%`,background:"rgba(255,255,255,.35)"}}/></div>}</div></div>
      })}</div>}
    </section>
  </main>;
}
