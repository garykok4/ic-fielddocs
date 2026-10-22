"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Activity, calculate, Snapshot } from "../app/schedule/engine";
import { readableDate } from "../lib/dates";
import "./customer-task-picker.css";

export default function CustomerTaskPicker({ project, close, saved }: {
  project: string; close: () => void; saved: (snapshot: Snapshot) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [rows, setRows] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const r = await supabase.rpc("schedule_v75_read", { p_project: project });
      if (r.error) throw r.error;
      const next = r.data as Snapshot;
      setRows(calculate(next.tasks, next.links, undefined, next.closures).filter(t => t.item_type === "task").sort((a,b) => a.start.localeCompare(b.start) || a.sort_order - b.sort_order));
      setSnapshot(next);
      setSelected(new Set(next.tasks.filter(t => t.item_type === "task" && t.customer_visible).map(t => t.id)));
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { dialog.current?.showModal(); void load(); }, [project]);
  async function save() {
    if (!snapshot || saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const r = await supabase.rpc("schedule_v75_save", {
        p_project: project, p_revision: snapshot.revision,
        p_tasks: snapshot.tasks.map(t => t.item_type === "task" ? { ...t, customer_visible: selected.has(t.id) } : t),
        p_closures: snapshot.closures || [], p_links: snapshot.links, p_baseline: snapshot.baseline,
      });
      if (r.error) throw r.error;
      saved(r.data as Snapshot); close();
    } catch(e) { setError((e as Error).message + " Your selection is still here. If the schedule changed, reload the latest tasks and review your selection before saving again."); }
    finally { saving.current = false; setBusy(false); }
  }
  const shown = rows.filter(t => `${t.name} ${t.trade || ""} ${t.responsible_party || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <dialog ref={dialog} className="customer-task-picker no-print" aria-labelledby="customer-picker-title" onCancel={e => {e.preventDefault(); if (!busy) close();}}>
    <h2 id="customer-picker-title">Add tasks to customer summary</h2>
    <p>Select schedule activities and milestones from construction and preconstruction. Uncheck a task to remove it from the summary.</p>
    {error && <p role="alert">{error}</p>}
    <label>Find a task<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <div className="picker-actions">
      <button disabled={busy || !snapshot} onClick={() => setSelected(new Set(rows.map(t => t.id)))}>Select all ({rows.length})</button>
      <button disabled={busy || !snapshot} onClick={() => setSelected(new Set())}>Clear all</button>
      <span role="status">{selected.size} selected · {shown.length} shown</span>
    </div>
    <p className="picker-hint">Select all includes every task, including those hidden by search. Internal notes are excluded from the customer summary.</p>
    <fieldset disabled={busy} className="picker-list"><legend>Schedule tasks</legend>
      {shown.map(t => <label key={t.id} className="picker-row"><input type="checkbox" checked={selected.has(t.id)} onChange={e => setSelected(old => {const next = new Set(old); e.target.checked ? next.add(t.id) : next.delete(t.id); return next;})}/><span><strong>{t.is_milestone ? "◆ " : ""}{t.name}</strong><small>{t.stage === "preconstruction" ? "Preconstruction" : "Construction"} · {readableDate(t.start)} – {readableDate(t.finish)} · {t.responsible_party || t.trade || "Unassigned"}</small></span></label>)}
      {!shown.length && <p>{busy ? "Loading tasks…" : "No matching schedule tasks."}</p>}
    </fieldset>
    <div className="picker-actions">
      <button disabled={busy || !snapshot} onClick={() => void save()}>{busy ? "Please wait…" : "Save selection"}</button>
      <button disabled={busy} onClick={close}>Cancel</button>
      {error && <button disabled={busy} onClick={() => {if (confirm("Reload latest tasks? This replaces your unsaved selection.")) void load();}}>Reload latest tasks</button>}
    </div>
  </dialog>;
}
