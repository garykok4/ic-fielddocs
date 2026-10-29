"use client";
import {readableDate} from "../../lib/dates";
import {projectCalendar,validDate,holidayOn,dueCountdown} from "../../lib/work-calendar";
import WorkDayCountdown from "../../components/WorkDayCountdown";
import OntarioCalendarInfo from "../../components/OntarioCalendarInfo";
import ScheduleDraftBuilder from "../../components/ScheduleDraftBuilder";
import WeekReviewExport from "../../components/WeekReviewExport";
import LookaheadExport from "../../components/LookaheadExport";
import { useEffect, useMemo, useRef, useState } from "react";
import { requireActiveStaff } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import {
  Activity,
  chronological,
  Task,
  Link,
  Snapshot,
  Status,
  labels,
  today,
  day,
  fmt,
  shift,
  distance,
  work,
  normalize,
  addWork,
  workDistance,
  finish,
  durationTo,
  calculate,
  validate,
  normalizeProgress,
  lanes,
} from "./engine";
import "./schedule.css";
import { addPreconstructionTemplate } from "./preconstruction";

type GanttZoom = "week" | "month" | "six" | "year" | "project";
type CalendarMode = "week" | "month" | "three" | "six";
function monthShift(date: string, months: number) {
  const d = day(date.slice(0, 7) + "-01"); d.setUTCMonth(d.getUTCMonth() + months); return fmt(d);
}

type View = "gantt" | "calendar" | "list";
type Project = { id: string; project_name: string };
const ordered = (a: Task, b: Task) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name);
const short = readableDate;
const empty = (
  project: string,
  type: "task" | "phase",
  parent: string | null = null,
  start = today(),
): Task => ({
  id: crypto.randomUUID(),
  project_id: project,
  name: "",
  trade: "",
  start_date: normalize(start),
  duration_work_days: 1,
  progress: 0,
  status: "not_started",
  is_milestone: false,
  sort_order: 0,
  notes: "",
  item_type: type,
  parent_id: parent,
});
const colour = (t: Activity) =>
  t.item_type === "phase"
    ? "phase"
    : t.critical
      ? "critical"
      : t.status === "complete"
        ? "complete"
        : t.status === "on_hold"
          ? "held"
          : "normal";
const clean = (data: Snapshot): Snapshot => ({
  ...data,
  tasks: data.tasks.map((t) =>
    t.item_type === "phase"
      ? t
      : normalizeProgress(
          t,
          t.status === "complete"
            ? { status: "complete" }
            : { progress: t.progress },
        ),
  ),
});

export default function ScheduleWorkspace({
  fixedProject,
  planningMode = false,
}: {
  fixedProject?: string;
  planningMode?: boolean;
}) {
  const [clearOpen,setClearOpen]=useState(false);
  const [draftMode,setDraftMode]=useState<"import"|"ai"|null>(null);
  const [closureText,setClosureText]=useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  const [reviewOpen,setReviewOpen]=useState(false);
  const [stageFilter, setStageFilter] = useState(
    planningMode ? "preconstruction" : "",
  );
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState(""),
    [snap, setSnap] = useState<Snapshot | null>(null);
  const cal=projectCalendar(snap?.closures||[]),normalize=cal.normalize,addWork=cal.add,workDistance=cal.distance;
  const [view, setView] = useState<View>("gantt"),
    [zoom, setZoom] = useState<GanttZoom>("week"),
    [calendarMode, setCalendarMode] = useState<CalendarMode>("month"),
    [anchor, setAnchor] = useState(today());
  const [search, setSearch] = useState(""),
    [phaseFilter, setPhaseFilter] = useState(""),
    [tradeFilter, setTradeFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [criticalOnly, setCriticalOnly] = useState(false),
    [lookahead, setLookahead] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [editing, setEditing] = useState<Task | null>(null),
    [undo, setUndo] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [baselineName, setBaselineName] = useState<string | null>(null);
  const newItem = (
    project: string,
    type: "task" | "phase",
    parent: string | null = null,
    start = today(),
  ): Task => ({
    ...empty(project, type, parent, start),
    stage:
      snap?.tasks.find((t) => t.id === parent)?.stage ||
      (stageFilter as Task["stage"]) ||
      (planningMode ? "preconstruction" : "construction"),
    date_confidence: "estimated",
    customer_visible: planningMode,
  });
  const projectRef = useRef(project);
  projectRef.current = project;
  const activeMutation = useRef(false);
  const loadSeq = useRef(0);
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const p = await requireActiveStaff();
        if (!p) return;
        const r =
          p.role === "admin"
            ? await supabase
                .from("projects")
                .select("id,project_name")
                .order("project_name")
            : await supabase
                .from("project_staff")
                .select("projects(id,project_name)")
                .eq("staff_id", p.id);
        if (r.error) throw r.error;
        const rows = (p.role === "admin"
          ? r.data
          : (r.data || [])
              .map((x: any) => x.projects)
              .filter(Boolean)) as unknown as Project[];
        if (!canceled) {
          setProjects(rows);
          if (rows.length) {
            const requested =
              fixedProject ||
              new URLSearchParams(window.location.search).get("project");
            if (requested && !rows.some((p) => p.id === requested))
              throw Error("Project access required.");
            setProject(requested || rows[0].id);
          } else setMessage("No assigned projects.");
        }
      } catch (e) {
        if (!canceled) setError(String((e as Error).message));
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);
  async function load(id = project) {
    const seq = ++loadSeq.current;
    setError("");
    try {
      const r = await supabase.rpc("schedule_v75_read", { p_project: id });
      if (r.error) throw r.error;
      if (seq === loadSeq.current && projectRef.current === id) {
        setSnap(clean(r.data as Snapshot));
        setClosureText((r.data.closures||[]).join("\n"));
        setStale(false);
        setUndo(null);
        setEditing(null);
      }
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    setSnap(null);
    setClearOpen(false);
    setEditing(null);
    setUndo(null);
    setCollapsed(new Set());
    setPhaseFilter("");
    setTradeFilter("");
    setStale(false);
    if (project) void load(project);
    return () => {
      loadSeq.current++;
    };
  }, [project]);
  useEffect(() => {
    if (!snap) return;
    let canceled = false;
    async function check() {
      if (activeMutation.current) return;
      const r = await supabase.rpc("schedule_v75_read", { p_project: project });
      if (!canceled && !r.error && r.data?.revision !== snap?.revision)
        setStale(true);
    }
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => {
      canceled = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [project, snap?.revision]);
  const calculated = useMemo(() => {
    if (!snap) return { rows: [] as Activity[], problem: "" };
    try {
      return { rows: calculate(snap.tasks, snap.links, undefined, snap.closures), problem: "" };
    } catch (e) {
      return { rows: [] as Activity[], problem: (e as Error).message };
    }
  }, [snap]);
  const activities = calculated.rows,
    phases = activities.filter((t) => t.item_type === "phase").sort(ordered);
  const trades = [
    ...new Set(
      (snap?.tasks || []).map((t) => t.trade).filter(Boolean) as string[],
    ),
  ].sort();
  const matched = activities.filter(
    (t) =>
      t.item_type === "task" &&
      (!stageFilter || (t.stage || "construction") === stageFilter) &&
      (!phaseFilter ||
        (phaseFilter === "none"
          ? !t.parent_id
          : t.parent_id === phaseFilter)) &&
      (!tradeFilter || t.trade === tradeFilter) &&
      (!statusFilter || t.status === statusFilter) &&
      (!criticalOnly || t.critical) &&
      (!search ||
        `${t.name} ${t.trade || ""} ${phases.find((p) => p.id === t.parent_id)?.name || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!lookahead ||
        (t.finish >= anchor && t.start <= shift(anchor, lookahead * 7 - 1))),
  );
  const rows: Activity[] = [];
  for (const p of phases) {
    const children = matched.filter((t) => t.parent_id === p.id).sort(chronological);
    if (
      children.length ||
      ((!stageFilter || (p.stage || "construction") === stageFilter) &&
        !phaseFilter &&
        !tradeFilter &&
        !statusFilter &&
        !criticalOnly &&
        !search &&
        !lookahead)
    ) {
      rows.push(p);
      if (!collapsed.has(p.id)) rows.push(...children);
    }
  }
  rows.push(...matched.filter((t) => !t.parent_id).sort(chronological));
  const projectFinish = activities
    .filter((t) => t.item_type === "task")
    .map((t) => t.finish)
    .sort()
    .slice(-1)[0];
  const drift = (t: Activity) => {
    const base = snap?.baseline?.dates[t.id];
    return base ? workDistance(base.finish, t.finish) : null;
  };
  async function commit(next: Snapshot, label: string, remember = true) {
    if (!snap || activeMutation.current) return false;
    const before = snap,
      id = project;
    setError("");
    setMessage("");
    try {
      validate(next.tasks, next.links);
      activeMutation.current = true;
      setBusy(true);
      const r = await supabase.rpc("schedule_v75_save", {
        p_project: id,
        p_revision: before.revision,
        p_tasks: next.tasks,
        p_links: next.links,
        p_baseline: next.baseline,
        p_closures: next.closures || [],
      });
      if (r.error) throw r.error;
      if (projectRef.current !== id) return false;
      setSnap(clean(r.data as Snapshot));
      setClosureText((r.data.closures||[]).join("\n"));
      setUndo(remember ? before : null);
      setStale(false);
      setMessage(label + " saved.");
      return true;
    } catch (e) {
      if (projectRef.current === id) {
        const text = (e as Error).message;
        setError(text);
        if (text.includes("another session")) setStale(true);
      }
      return false;
    } finally {
      activeMutation.current = false;
      setBusy(false);
    }
  }
  async function clearSchedule() {
    if (!snap || busy || stale || activeMutation.current) return;
    const before = snap, id = project;
    activeMutation.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await supabase.rpc("schedule_v782_clear", {p_project:id,p_revision:before.revision});
      if (r.error) throw r.error;
      if (projectRef.current !== id) return;
      loadSeq.current++;
      setSnap(clean(r.data as Snapshot));
      setUndo(before);
      setEditing(null); setCollapsed(new Set());
      setSearch(""); setPhaseFilter(""); setTradeFilter(""); setStatusFilter("");
      setCriticalOnly(false); setLookahead(0); setStageFilter("");
      setClearOpen(false); setStale(false);
      setMessage("Schedule cleared. Undo last change can restore tasks, links and baseline until your next change or reload. Project shutdown dates were kept.");
    } catch (e) {
      if (projectRef.current === id) {
        const message=(e as Error).message;
        setError(message.includes("schema cache") || message.includes("does not exist")
          ? "Run the V7.8.2 Supabase SQL from the updater, then try again. Nothing was cleared."
          : message);
        if(message.includes("another session"))setStale(true);
      }
    } finally { activeMutation.current=false; setBusy(false); }
  }
  async function patch(id: string, change: Partial<Task>) {
    if (!snap) return false;
    return commit(
      {
        ...snap,
        tasks: snap.tasks.map((t) =>
          t.id === id ? normalizeProgress(t, change) : t,
        ),
      },
      "Activity",
    );
  }
  async function move(id: string, start: string) {
    const t = activities.find((t) => t.id === id);
    if (!t || t.item_type === "phase") return;
    start = normalize(start);
    const minimum = snap!.links
      .filter((l) => l.successor_id === id)
      .map((l) =>
        addWork(
          l.relation === "SS" ? activities.find((t) => t.id === l.predecessor_id)!.start : activities.find((t) => t.id === l.predecessor_id)!.finish,
          (l.relation === "SS" ? 0 : 1) + l.lag_work_days,
        ),
      )
      .sort()
      .slice(-1)[0];
    if (minimum && start < minimum) {
      setError(
        `Dependencies require ${t.name} to start ${minimum} or later. Edit its predecessor links first.`,
      );
      return;
    }
    await patch(id, { start_date: start });
  }
  async function reorder(id: string, delta: number) {
    if (!snap) return;
    const t = snap.tasks.find((t) => t.id === id)!;
    if (t.item_type !== "phase") return;
    const peers = snap.tasks
      .filter((x) => x.item_type === t.item_type && x.parent_id === t.parent_id)
      .sort(ordered);
    const i = peers.findIndex((x) => x.id === id),
      j = i + delta;
    if (j < 0 || j >= peers.length) return;
    [peers[i], peers[j]] = [peers[j], peers[i]];
    const positions = new Map(peers.map((x, k) => [x.id, k]));
    await commit(
      {
        ...snap,
        tasks: snap.tasks.map((x) =>
          positions.has(x.id) ? { ...x, sort_order: positions.get(x.id)! } : x,
        ),
      },
      "Order",
    );
  }
  async function duplicate(t: Task) {
    if (!snap) return;
    const copy = {
      ...t,
      id: crypto.randomUUID(),
      name: t.name + " (copy)",
      sort_order: Math.max(-1, ...snap.tasks.map((x) => x.sort_order)) + 1,
      status: "not_started" as Status,
      progress: 0,
    };
    await commit({ ...snap, tasks: [...snap.tasks, copy] }, "Duplicate");
  }
  async function remove(t: Task) {
    if (
      !snap ||
      !confirm(
        t.item_type === "phase"
          ? "Delete this phase? Its activities become ungrouped."
          : "Delete this activity and its links?",
      )
    )
      return;
    const next = {
      ...snap,
      tasks: snap.tasks
        .filter((x) => x.id !== t.id)
        .map((x) => (x.parent_id === t.id ? { ...x, parent_id: null } : x)),
      links: snap.links.filter(
        (l) => l.predecessor_id !== t.id && l.successor_id !== t.id,
      ),
    };
    if (await commit(next, "Deletion")) setEditing(null);
  }
  function open(t: Task) {
    setError("");
    setEditing({ ...t });
  }
  function toggle(id: string) {
    setCollapsed((old) => {
      const n = new Set(old);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  async function saveBaseline() {
    if (!snap || !baselineName?.trim()) return;
    if (
      snap.baseline &&
      !confirm(
        "Replace the saved baseline? Undo remains available until the next change.",
      )
    )
      return;
    const dates = Object.fromEntries(
      activities.map((t) => [
        t.id,
        { name: t.name, start: t.start, finish: t.finish },
      ]),
    );
    if (
      await commit(
        {
          ...snap,
          baseline: {
            name: baselineName.trim(),
            saved_at: new Date().toISOString(),
            dates,
          },
        },
        "Baseline",
      )
    )
      setBaselineName(null);
  }
  const title =
    projects.find((p) => p.id === project)?.project_name || "Project";
  return (
    <main className="fd">
      {clearOpen&&snap&&<ClearScheduleDialog key={project} title={title} snapshot={snap} busy={busy} stale={stale} error={error} close={()=>setClearOpen(false)} clear={clearSchedule}/>}
      {draftMode&&snap&&<ScheduleDraftBuilder key={project} project={project} snapshot={snap} mode={draftMode} close={()=>setDraftMode(null)} saved={s=>{loadSeq.current++;setSnap(clean(s));setClosureText((s.closures||[]).join("\n"));setUndo(null);setStale(false);setMessage("Schedule draft imported. Review the resulting project dates.");}}/>}
      {reviewOpen&&<WeekReviewExport key={project} project={project} projectName={projects.find(p=>p.id===project)?.project_name||"Project"} close={()=>setReviewOpen(false)}/>}
      {exportOpen&&<LookaheadExport key={project} project={project} projectName={projects.find(p=>p.id===project)?.project_name||"Project schedule"} defaultFormat={view==='calendar'?'calendar':'gantt'} close={()=>setExportOpen(false)}/>}
      <div className="screen">
      {snap&&<><div className="toolbar"><button disabled={busy||stale} onClick={()=>setDraftMode("import")}>Import schedule</button><button disabled={busy||stale} onClick={()=>setDraftMode("ai")}>Build with AI</button><button className="clear-schedule-button" disabled={busy||stale||!!editing||(!snap.tasks.length&&!snap.baseline&&!snap.import_history?.length)} onClick={()=>{setError("");setClearOpen(true);}}>Clear schedule</button></div>
      <details><summary>Project shutdown dates ({snap.closures?.length||0})</summary><p>Additional to Ontario holidays. Changing these dates recalculates every activity in the project.</p><label>Shutdown dates (YYYY-MM-DD, one per line)<textarea aria-label="Project shutdown dates" value={closureText} onChange={e=>setClosureText(e.target.value)}/></label><button disabled={busy||stale} onClick={()=>{const dates=closureText.split(/[\s,;]+/).filter(Boolean);if(dates.some(d=>!validDate(d))){setError("Enter valid YYYY-MM-DD shutdown dates.");return;}void commit({...snap,closures:[...new Set(dates)].sort()},"Project calendar");}}>Save shutdown dates</button></details>
      {!!snap.import_history?.length&&<details><summary>Imported schedule assumptions & sources</summary>{snap.import_history.map((h,i)=><article key={i}><h3>{h.metadata.source}</h3><p>{h.created_at} · Target {h.metadata.target||"not specified"}</p><p style={{whiteSpace:"pre-wrap"}}>{h.metadata.assumptions}</p></article>)}</details>}</>}

        <header className="heading">
          <div>
            <div className="eyebrow">FIELD DOCS / SCHEDULING</div>
            <h1>
              {planningMode
                ? "Preconstruction & approvals"
                : "Project schedule"}
            </h1>
            <p>Plan the work. See what controls the finish.</p>
          </div>
          <select
            aria-label="Project"
            value={project}
            disabled={busy || !!fixedProject}
            onChange={(e) => setProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_name}
              </option>
            ))}
          </select>
        </header>
        <OntarioCalendarInfo/>
        {snap && (
          <div className="toolbar">
            <label>
              Stage{" "}
              <select
                aria-label="Schedule stage"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
              >
                <option value="">All stages</option>
                <option value="preconstruction">Preconstruction</option>
                <option value="construction">Construction</option>
              </select>
            </label>
            <button disabled={busy || !!editing || !!calculated.problem} onClick={()=>setExportOpen(true)}>Export schedule</button>
            <small>Tasks auto-sort by start date within each phase.</small>
            <button disabled={busy || !!editing || !!calculated.problem} onClick={()=>setReviewOpen(true)}>Export week in review</button>
            <a href={`/projects/${project}`}>Project home & tasks</a>
            <a href={`/projects/${project}?tab=customer`}>Customer summary</a>
            {planningMode && (
              <button
                disabled={busy || stale}
                onClick={() => setTemplateOpen(true)}
              >
                Add planning template
              </button>
            )}
          </div>
        )}
        {planningMode && (
          <p className="notice warning">
            Planning dates are estimates until confirmed. Template durations are
            starting allowances, not municipal timelines. Critical path is
            calculated across the entire project, including activities hidden by
            filters.
          </p>
        )}
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="notice success">
            {message}
          </div>
        )}
        {stale && (
          <div className="notice warning">
            Another session changed this schedule. Reload before editing
            further.{" "}
            <button
              disabled={busy}
              onClick={() => {
                if (!editing || confirm("Reload and discard the open draft?"))
                  void load();
              }}
            >
              Reload latest
            </button>
          </div>
        )}
        {!snap && project && (
          <p>
            Loading schedule…{" "}
            {error && <button onClick={() => void load()}>Retry</button>}
          </p>
        )}
        {snap && (
          <>
            {calculated.problem && (
              <div className="notice error">
                {calculated.problem} Calculations are paused.{" "}
                <button onClick={() => setView("list")}>
                  Open repair list
                </button>
              </div>
            )}
            <div className="summary">
              <div>
                <small>PLANNED FINISH</small>
                <strong>{projectFinish ? short(projectFinish) : "—"}</strong>
              </div>
              <div>
                <small>CRITICAL ACTIVITIES</small>
                <strong className="red">
                  {
                    activities.filter(
                      (t) => t.item_type === "task" && t.critical,
                    ).length
                  }
                </strong>
              </div>
              <div>
                <small>OVERDUE / INCOMPLETE</small>
                <strong>
                  {
                    activities.filter(
                      (t) => t.item_type === "task" && t.overdue,
                    ).length
                  }
                </strong>
              </div>
              <div>
                <small>BASELINE</small>
                <strong>{snap.baseline?.name || "Not captured"}</strong>
              </div>
            </div>
            <div className="actions">
              <div className="tabs">
                {(["gantt", "calendar", "list"] as View[]).map((v) => (
                  <button
                    key={v}
                    aria-pressed={view === v}
                    className={view === v ? "selected" : ""}
                    onClick={() => setView(v)}
                  >
                    {v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
              <button
                disabled={busy}
                onClick={() => open(newItem(project, "phase"))}
              >
                + Phase
              </button>
              <button
                disabled={busy}
                className="primary"
                onClick={() =>
                  open(
                    newItem(
                      project,
                      "task",
                      phaseFilter && phaseFilter !== "none"
                        ? phaseFilter
                        : null,
                    ),
                  )
                }
              >
                + Activity
              </button>
              <button
                disabled={!undo || busy || stale}
                onClick={() => undo && void commit(undo, "Undo", false)}
              >
                Undo last change
              </button>
              <button
                disabled={busy || !!calculated.problem}
                onClick={() =>
                  setBaselineName(snap.baseline?.name || "Approved schedule")
                }
              >
                Capture baseline
              </button>
              <button
                disabled={!!calculated.problem}
                onClick={() => window.print()}
              >
                Print / PDF
              </button>
            </div>
            <div className="filters">
              <input
                aria-label="Search schedule"
                placeholder="Search activities, phases, trades"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Phase filter"
                value={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.value)}
              >
                <option value="">All phases</option>
                <option value="none">Ungrouped</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Trade filter"
                value={tradeFilter}
                onChange={(e) => setTradeFilter(e.target.value)}
              >
                <option value="">All trades</option>
                {trades.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select
                aria-label="Status filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                {Object.entries(labels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                aria-pressed={criticalOnly}
                className={
                  criticalOnly ? "critical-filter on" : "critical-filter"
                }
                onClick={() => setCriticalOnly(!criticalOnly)}
              >
                Critical only
              </button>
              <select
                aria-label="Look ahead"
                value={lookahead}
                onChange={(e) => {
                  setLookahead(+e.target.value);
                  setAnchor(today());
                }}
              >
                <option value={0}>Full schedule</option>
                <option value={2}>2-week look-ahead</option>
                <option value={3}>3-week look-ahead</option>
                <option value={6}>6-week look-ahead</option>
              </select>
              {lookahead > 0 && (
                <input
                  aria-label="Look ahead start"
                  type="date"
                  value={anchor}
                  onChange={(e) => e.target.value && setAnchor(e.target.value)}
                />
              )}
            </div>
            <div className="viewtools">
              <span>
                <b className="red">●</b> Critical · zero total float{" "}
                <b className="schedule-normal-key">●</b> Other activities{" "}
                <span className="baseline-key">━ Baseline</span>
              </span>
              {view === "gantt" && (
                <>
                  <button onClick={() => setCollapsed(new Set())}>
                    Expand all
                  </button>
                  <select
                    aria-label="Gantt zoom"
                    value={zoom}
                    onChange={(e) =>
                      { setZoom(e.target.value as GanttZoom); setLookahead(0); setAnchor(activities.map(t => t.start).sort()[0] || today()); }
                    }
                  >
                    <option value="week">Week / day detail</option>
                    <option value="month">Month overview</option>
                    <option value="six">6 months</option>
                    <option value="year">12 months</option>
                    <option value="project">Entire project</option>
                  </select>
                </>
              )}
              <small>Monday–Friday · Ontario holidays excluded</small>
            </div>
            {view === "gantt" && !calculated.problem && (
              <Gantt
                closures={snap.closures}
                rows={rows}
                all={activities}
                links={snap.links}
                baseline={snap.baseline}
                zoom={zoom}
                setAnchor={setAnchor}
                busy={busy || stale}
                collapsed={collapsed}
                toggle={toggle}
                open={open}
                move={move}
                resize={(id, n) => patch(id, { duration_work_days: n })}
                add={(p) => open(newItem(project, "task", p))}
                reorder={reorder}
                lookahead={lookahead}
                anchor={anchor}
              />
            )}
            {view === "calendar" && !calculated.problem && (
              <Calendar
                closures={snap.closures}
                rows={matched}
                anchor={anchor}
                setAnchor={setAnchor}
                mode={calendarMode}
                setMode={setCalendarMode}
                open={open}
                add={(d) =>
                  open(
                    newItem(
                      project,
                      "task",
                      phaseFilter && phaseFilter !== "none"
                        ? phaseFilter
                        : null,
                      d,
                    ),
                  )
                }
                move={move}
                busy={busy || stale}
              />
            )}
            {view === "list" && (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Activity / phase</th>
                      <th>Trade</th>
                      <th>Earliest start</th>
                      <th>Scheduled dates</th>
                      <th>Work days</th>
                      <th>Status</th>
                      <th>Progress</th>
                      <th>Float / slip</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(calculated.problem
                      ? snap.tasks.map(
                          (t) =>
                            ({
                              ...t,
                              start: t.start_date,
                              finish: t.start_date,
                              float: 0,
                              critical: false,
                              overdue: false,
                              controlling: [],
                            }) as Activity,
                        )
                      : rows
                    ).map((t) => (
                      <tr
                        key={t.id}
                        className={t.item_type === "phase" ? "phase-row" : ""}
                      >
                        <td>
                          <button
                            aria-label={`Move ${t.name} up`}
                            disabled={busy || stale || t.item_type !== "phase"}
                            title="Tasks sort automatically by start date; arrows reorder phases"
                            onClick={() => void reorder(t.id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`Move ${t.name} down`}
                            disabled={busy || stale || t.item_type !== "phase"}
                            title="Tasks sort automatically by start date; arrows reorder phases"
                            onClick={() => void reorder(t.id, 1)}
                          >
                            ↓
                          </button>
                        </td>
                        <td>
                          <Inline
                            key={t.name}
                            value={t.name}
                            disabled={busy || stale}
                            save={(v) => patch(t.id, { name: v })}
                          />
                          {t.critical && (
                            <span className="badge">CRITICAL</span>
                          )}
                          {t.overdue && <small className="red"> Overdue</small>}
                        </td>
                        <td>
                          {t.item_type === "task" && (
                            <Inline
                              key={t.trade}
                              value={t.trade || ""}
                              disabled={busy || stale}
                              save={(v) => patch(t.id, { trade: v })}
                            />
                          )}
                        </td>
                        <td>
                          {t.item_type === "task" && (
                            <Inline
                              key={t.start_date}
                              value={t.start_date}
                              type="date"
                              disabled={busy || stale}
                              save={(v) => patch(t.id, { start_date: v })}
                            />
                          )}
                        </td>
                        <td>
                          {short(t.start)}–{short(t.finish)}
                          <WorkDayCountdown due={t.finish} status={t.status}/>
                        </td>
                        <td>
                          {t.item_type === "task" && !t.is_milestone && (
                            <Inline
                              key={t.duration_work_days}
                              value={String(t.duration_work_days)}
                              type="number"
                              disabled={busy || stale}
                              save={(v) =>
                                patch(t.id, { duration_work_days: Number(v) })
                              }
                            />
                          )}
                        </td>
                        <td>
                          {t.item_type === "task" ? (
                            <select
                              aria-label={`Status ${t.name}`}
                              disabled={busy || stale}
                              value={t.status}
                              onChange={(e) =>
                                void patch(t.id, {
                                  status: e.target.value as Status,
                                })
                              }
                            >
                              {Object.entries(labels).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          ) : (
                            "Summary"
                          )}
                        </td>
                        <td>
                          {t.item_type === "task" ? (
                            <Inline
                              key={t.progress}
                              value={String(t.progress)}
                              type="number"
                              disabled={busy || stale}
                              save={(v) => patch(t.id, { progress: Number(v) })}
                            />
                          ) : (
                            t.progress + "%"
                          )}
                        </td>
                        <td>
                          {t.item_type === "task" &&
                            !calculated.problem &&
                            `${t.float}d float`}
                          {drift(t) !== null && (
                            <small className={(drift(t) || 0) > 0 ? "red" : ""}>
                              {drift(t)! > 0 ? "+" : ""}
                              {drift(t)}d vs baseline
                            </small>
                          )}
                        </td>
                        <td>
                          <button onClick={() => open(t)}>Edit</button>
                          {t.item_type === "task" && (
                            <button
                              disabled={busy || stale}
                              onClick={() => void duplicate(t)}
                            >
                              Duplicate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!calculated.problem && !matched.length && (
              <p className="empty">
                No matching activities. Add an activity or adjust your filters.
              </p>
            )}
            <p className="footnote">
              Critical path reflects the complete planned schedule, including
              completed activities. Float is the work-day delay available
              without moving the project finish. Undo covers your most recent
              change in this session.
            </p>
          </>
        )}
      </div>
      <section className="print">
        <h1>
          {title} —{" "}
          {lookahead ? lookahead + "-week look-ahead" : "Project schedule"}
        </h1>
        <p>
          {lookahead
            ? anchor + " to " + shift(anchor, lookahead * 7 - 1)
            : "Full schedule"}{" "}
          · Prepared {readableDate(today())} · Monday–Friday, excluding Ontario holidays
        </p>
        <p>
          Filters:{" "}
          {phaseFilter
            ? phases.find((p) => p.id === phaseFilter)?.name || "Ungrouped"
            : "All phases"}{" "}
          / {tradeFilter || "All trades"} /{" "}
          {statusFilter ? labels[statusFilter as Status] : "All statuses"}
          {criticalOnly ? " / Critical only" : ""}
          {search ? " / Search: " + search : ""}
        </p>
        <table>
          <thead>
            <tr>
              <th>Activity / phase</th>
              <th>Trade</th>
              <th>Start</th>
              <th>Finish</th>
              <th>Status / progress</th>
              <th>Float</th>
              <th>Slip</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {matched.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {t.critical ? " [CRITICAL]" : ""}
                  <small>
                    {phases.find((p) => p.id === t.parent_id)?.name}
                  </small>
                </td>
                <td>{t.trade}</td>
                <td>{readableDate(t.start)}</td>
                <td>{readableDate(t.finish)}</td>
                <td>
                  {labels[t.status]} {t.progress}%
                </td>
                <td>{t.float}d</td>
                <td>{drift(t) === null ? "—" : drift(t) + "d"}</td>
                <td>{t.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {templateOpen && snap && (
        <PlanningTemplateDialog
          busy={busy}
          stale={stale}
          error={error}
          hasPlanning={snap.tasks.some((t) => t.stage === "preconstruction")}
          close={() => setTemplateOpen(false)}
          save={async (start, variance, connect) => {
            const ok = await commit(
              addPreconstructionTemplate(
                snap,
                project,
                start,
                variance,
                connect,
              ),
              "Preconstruction template",
            );
            if (ok) setTemplateOpen(false);
          }}
        />
      )}
      {editing && snap && (
        <Editor
          key={editing.id}
          task={editing}
          snapshot={snap}
          activities={activities}
          busy={busy}
          stale={stale}
          saveError={error}
          close={() => setEditing(null)}
          remove={remove}
          save={async (t, links) => {
            const tasks = snap.tasks.some((x) => x.id === t.id)
              ? snap.tasks.map((x) => (x.id === t.id ? t : x))
              : [
                  ...snap.tasks,
                  {
                    ...t,
                    sort_order:
                      Math.max(-1, ...snap.tasks.map((x) => x.sort_order)) + 1,
                  },
                ];
            const next = {
              ...snap,
              tasks,
              links: [
                ...snap.links.filter((l) => l.successor_id !== t.id),
                ...links,
              ],
            };
            if (await commit(next, "Schedule")) setEditing(null);
          }}
        />
      )}
      {baselineName !== null && (
        <div className="overlay">
          <section
            className="baseline-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Capture baseline"
          >
            <h2>Capture approved dates</h2>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <p>
              This saves the current calculated start and finish dates for
              comparison. Capturing again replaces the previous baseline.
            </p>
            <input
              autoFocus
              aria-label="Baseline name"
              value={baselineName}
              onChange={(e) => setBaselineName(e.target.value)}
            />
            <button disabled={busy} onClick={() => setBaselineName(null)}>
              Cancel
            </button>
            <button
              disabled={busy || !baselineName.trim()}
              onClick={() => void saveBaseline()}
            >
              Capture
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function Inline({
  value,
  type = "text",
  disabled,
  save,
}: {
  value: string;
  type?: string;
  disabled: boolean;
  save: (v: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      aria-label="Edit value"
      type={type}
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value)
          void save(draft).then((ok) => {
            if (!ok) setDraft(value);
          });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

type GanttProps = {
  closures?:string[];
  rows: Activity[];
  all: Activity[];
  links: Link[];
  baseline: Snapshot["baseline"];
  zoom: GanttZoom;
  setAnchor: (s: string) => void;
  busy: boolean;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  open: (t: Task) => void;
  move: (id: string, d: string) => Promise<void>;
  resize: (id: string, n: number) => Promise<boolean>;
  add: (id: string) => void;
  reorder: (id: string, n: number) => Promise<void>;
  lookahead: number;
  anchor: string;
};
function Gantt(p: GanttProps) {
  const cal=projectCalendar(p.closures),work=cal.work,addWork=cal.add,finish=cal.finish,durationTo=(s:string,f:string)=>Math.max(1,cal.distance(s,f)+1);
  const rowHeight = 38;
  const broad = ["six", "year", "project"].includes(p.zoom);
  const months = p.zoom === "six" ? 6 : 12;
  const [available, setAvailable] = useState(1200);
  const [panelWidth, setPanelWidth] = useState(560);
  const [listHidden, setListHidden] = useState(false);
  const left = listHidden ? 0 : panelWidth;
  useEffect(() => {
    const update = () => setPanelWidth(window.innerWidth < 800 ? 280 : 560);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const dates = p.all
    .flatMap((t) => [
      t.start,
      t.finish,
      ...(p.baseline?.dates[t.id]
        ? [p.baseline.dates[t.id].start, p.baseline.dates[t.id].finish]
        : []),
    ])
    .sort();
  const start = p.lookahead ? p.anchor : broad && p.zoom !== "project" ? monthShift(p.anchor, 0) : shift(dates[0] || today(), -3),
    end = p.lookahead
      ? shift(p.anchor, p.lookahead * 7 - 1)
      : broad && p.zoom !== "project" ? shift(monthShift(start, months), -1) : shift(dates.slice(-1)[0] || shift(today(), 28), 4),
    count = distance(start, end) + 1;
  const cell = broad ? Math.max(240, available - left - 2) / count : p.zoom === "week" ? 32 : 12;
  const viewport = useRef<HTMLDivElement>(null),
    gesture = useRef<{
      id: string;
      x: number;
      start: string;
      duration: number;
    } | null>(null),
    suppress = useRef(false);
  const [preview, setPreview] = useState<{
    id: string;
    duration: number;
  } | null>(null);
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth));
    observer.observe(el); setAvailable(el.clientWidth); return () => observer.disconnect();
  }, [count > 5000]);
  if (count > 5000)
    return (
      <p className="notice warning">
        This schedule spans more than 5,000 calendar days. Select a look-ahead
        window to work with a smaller date range.
      </p>
    );
  const timeline = Array.from({ length: count }, (_, i) => shift(start, i));
  const groups: { label: string; days: number }[] = [];
  for (const d of timeline) {
    const label = day(d).toLocaleDateString("en-CA", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    if (groups.slice(-1)[0]?.label === label) groups[groups.length - 1].days++;
    else groups.push({ label, days: 1 });
  }
  const x = (d: string) => distance(start, d) * cell;
  function pointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const n = durationTo(
      g.start,
      shift(finish(g.start, g.duration), Math.round((e.clientX - g.x) / cell)),
    );
    setPreview({ id: g.id, duration: n });
  }
  function pointerEnd(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    e.stopPropagation();
    const n = durationTo(
      g.start,
      shift(finish(g.start, g.duration), Math.round((e.clientX - g.x) / cell)),
    );
    gesture.current = null;
    setPreview(null);
    if (n !== g.duration) void p.resize(g.id, n);
  }
  return (
    <div className="gantt-workspace">
      <div className="gantt-controls">
        <button aria-expanded={!listHidden} onClick={() => setListHidden(v => !v)}>
          {listHidden ? "› Show task list" : "‹ Hide task list"}
        </button>
        <span>{broad ? "Click a task to edit · Use day detail for drag scheduling" : "Drag bars to move · Drag the right edge to resize"}</span>
        {broad && p.zoom !== "project" && <><button aria-label="Previous Gantt period" onClick={() => p.setAnchor(monthShift(start, -months))}>‹</button><input aria-label="Gantt start month" type="month" value={start.slice(0,7)} onChange={e => e.target.value && p.setAnchor(e.target.value+"-01")}/><button aria-label="Next Gantt period" onClick={() => p.setAnchor(monthShift(start, months))}>›</button></>}
        {broad && <small>{readableDate(start)} – {readableDate(end)}</small>}
        <button onClick={() => { if (broad && p.zoom !== "project") p.setAnchor(today()); else if (viewport.current) viewport.current.scrollLeft = Math.max(0, x(today()) - 100); }}>Today</button>
      </div>
    <div className={`gantt ${listHidden ? "list-hidden" : ""}`} ref={viewport} aria-label="Gantt chart">
      <div className="gantt-inner" style={{ width: left + count * cell }}>
        <div className="gantt-head">
          <div className="frozen title" style={{ width: left, display: listHidden ? "none" : undefined }}>
            <span className="name-heading">Name</span><span className="gantt-date-cell">Start date</span><span className="gantt-date-cell">Due date</span>
          </div>
          <div style={{ width: count * cell }}>
            <div className="month-head">
              {groups.map((g, i) => (
                <span key={i} style={{ width: g.days * cell }}>
                  {g.label}
                </span>
              ))}
            </div>
            <div className="date-head">
              {timeline.map((d) => (
                <span
                  key={d}
                  style={{ width: cell }}
                  className={holidayOn(d) ? "holiday" : !work(d) ? "weekend" : ""}
                  title={`${readableDate(d)}${holidayOn(d) ? " · "+holidayOn(d)!.name+" · Non-working day" : ""}`}
                >
                  {p.zoom === "week"
                    ? day(d).getUTCDate()
                    : !broad && day(d).getUTCDay() === 1
                      ? day(d).getUTCDate()
                      : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
        {p.rows.map((t) => {
          const displayedFinish =
            preview?.id === t.id ? finish(t.start, preview.duration) : t.finish;
          const base = p.baseline?.dates[t.id];
          return (
            <div className="gantt-row" key={t.id} style={{ height: rowHeight }}>
              <div
                className={`frozen rowname ${t.item_type === "phase" ? "phase-row" : ""}`}
                style={{ width: left, display: listHidden ? "none" : undefined }}
              >
                <div className="order">
                  <button
                    disabled={p.busy || t.item_type !== "phase"}
                    aria-label={`Move ${t.name} up`}
                    title="Tasks sort automatically by start date; arrows reorder phases"
                    onClick={() => void p.reorder(t.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    disabled={p.busy || t.item_type !== "phase"}
                    aria-label={`Move ${t.name} down`}
                    title="Tasks sort automatically by start date; arrows reorder phases"
                    onClick={() => void p.reorder(t.id, 1)}
                  >
                    ↓
                  </button>
                </div>
                {t.item_type === "phase" && (
                  <button
                    aria-label={`Toggle ${t.name}`}
                    onClick={() => p.toggle(t.id)}
                  >
                    {p.collapsed.has(t.id) ? "▸" : "▾"}
                  </button>
                )}
                <button
                  className={"task-label " + (t.parent_id ? "indent" : "")}
                  onClick={() => p.open(t)}
                >
                  <strong>{t.name}</strong>
                  <small>
                    {t.item_type === "phase"
                      ? `${t.progress}% complete`
                      : t.trade || "Unassigned"}
                  </small>
                </button>
                {t.critical && <span className="critical-dot" title="Critical path" aria-label="Critical path" />}
                <span className="gantt-date-cell">{readableDate(t.start)}</span>
                <span className="gantt-date-cell">{readableDate(t.finish)}</span>
                {t.item_type === "phase" && (
                  <button
                    disabled={p.busy}
                    aria-label={`Add activity to ${t.name}`}
                    onClick={() => p.add(t.id)}
                  >
                    +
                  </button>
                )}
              </div>
              <div
                className="track"
                style={{
                  width: count * cell,
                  backgroundSize: `${cell}px 100%`,
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (p.busy || broad) return;
                  const raw = e.dataTransfer.getData("application/fielddocs");
                  if (!raw) return;
                  try {
                    const d = JSON.parse(raw);
                    const pos = Math.floor(
                      (e.clientX -
                        e.currentTarget.getBoundingClientRect().left) /
                        cell,
                    );
                    void p.move(d.id, shift(start, pos - (d.offset || 0)));
                  } catch {}
                }}
              >
                {timeline.filter(d=>!work(d) && !holidayOn(d)).map(d=><i key={d} aria-hidden="true" className="weekend-band" style={{left:x(d),width:cell}}/>)}
                {timeline.filter(d=>holidayOn(d)).map(d=><i key={d} aria-hidden="true" className="holiday-band" style={{left:x(d),width:cell}}/>)}
                {x(today()) >= 0 && x(today()) <= count * cell && (
                  <i className="todayline" style={{ left: x(today()) }} />
                )}
                {base && (
                  <div
                    className="baseline-bar"
                    title={`Baseline ${readableDate(base.start)}–${readableDate(base.finish)}`}
                    style={{
                      left: x(base.start),
                      width: (distance(base.start, base.finish) + 1) * cell,
                    }}
                  />
                )}
                <div
                  className={`bar ${colour(t)} ${t.is_milestone ? "milestone" : ""}`}
                  title={`${t.name}: ${readableDate(t.start)}–${readableDate(displayedFinish)}; ${t.float} work days float`}
                  style={{
                    display: t.finish < start || t.start > end ? "none" : undefined,
                    left: x(t.start) + (broad ? 0 : 2),
                    width: t.is_milestone
                      ? 14
                      : Math.max(
                          7,
                          (distance(t.start, displayedFinish) + 1) * cell - (broad ? 0 : 4),
                        ),
                  }}
                  draggable={
                    !p.busy && !broad && t.item_type === "task" && !gesture.current
                  }
                  onDragStart={(e) => {
                    if (gesture.current) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData(
                      "application/fielddocs",
                      JSON.stringify({
                        id: t.id,
                        offset: Math.max(
                          0,
                          Math.floor(
                            (e.clientX -
                              e.currentTarget.getBoundingClientRect().left) /
                              cell,
                          ),
                        ),
                      }),
                    );
                  }}
                  onClick={() => {
                    if (suppress.current) {
                      suppress.current = false;
                      return;
                    }
                    p.open(t);
                  }}
                >
                  <span
                    className="bar-progress"
                    style={{ width: t.progress + "%" }}
                  />
                  <span className="bar-text">{!t.is_milestone && t.name}</span>
                  {!broad && t.item_type === "task" && !t.is_milestone && (
                    <span
                      className="resize"
                      role="slider"
                      aria-label={`Duration ${t.name}`}
                      aria-valuenow={
                        preview?.id === t.id
                          ? preview.duration
                          : t.duration_work_days
                      }
                      aria-valuemin={1}
                      aria-valuemax={10000}
                      tabIndex={p.busy ? -1 : 0}
                      draggable={false}
                      onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onPointerDown={(e) => {
                        if (p.busy) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        gesture.current = {
                          id: t.id,
                          x: e.clientX,
                          start: t.start,
                          duration: t.duration_work_days,
                        };
                        suppress.current = true;
                      }}
                      onPointerMove={pointerMove}
                      onPointerUp={pointerEnd}
                      onPointerCancel={() => {
                        gesture.current = null;
                        setPreview(null);
                      }}
                      onKeyDown={(e) => {
                        if (
                          !p.busy &&
                          ["ArrowLeft", "ArrowRight"].includes(e.key)
                        ) {
                          e.preventDefault();
                          void p.resize(
                            t.id,
                            Math.max(
                              1,
                              t.duration_work_days +
                                (e.key === "ArrowRight" ? 1 : -1),
                            ),
                          );
                        }
                      }}
                    />
                  )}
                </div>
                <button className="timeline-task-name" onClick={() => p.open(t)}
                  style={{display: t.finish < start || t.start > end ? "none" : undefined, left: x(displayedFinish) + cell + 7, top: 9}}
                  title={`${t.name} · ${readableDate(t.start)}–${readableDate(displayedFinish)}`}>
                  {t.name}
                </button>
              </div>
            </div>
          );
        })}
        <svg
          className="arrows"
          aria-label="Dependency arrows"
          style={{
            left,
            top: 64,
            width: count * cell,
            height: p.rows.length * rowHeight,
          }}
        >
          <defs>
            {["normal", "critical"].map((k) => (
              <marker
                key={k}
                id={"fd-arrow-" + k}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill={k === "critical" ? "#dc2626" : "#64748b"}
                />
              </marker>
            ))}
          </defs>
          {p.links.map((l) => {
            const i = p.rows.findIndex((t) => t.id === l.predecessor_id),
              j = p.rows.findIndex((t) => t.id === l.successor_id);
            if (i < 0 || j < 0) return null;
            const a = p.rows[i],
              b = p.rows[j],
              critical =
                a.critical &&
                b.critical &&
                addWork(l.relation === "SS" ? a.start : a.finish, (l.relation === "SS" ? 0 : 1) + l.lag_work_days) === b.start;
            const x1 = l.relation === "SS" ? x(a.start) + 2 : x(a.finish) + cell - 2,
              x2 = x(b.start) + 2,
              y1 = i * rowHeight + 19,
              y2 = j * rowHeight + 19;
            return (
              <path
                key={l.id}
                d={`M${x1},${y1} H${x1 + 6} V${y2 - 20} H${x2 - 6} V${y2} H${x2}`}
                stroke={critical ? "#dc2626" : "#64748b"}
                strokeWidth={critical ? 2.5 : 1.5}
                fill="none"
                markerEnd={`url(#fd-arrow-${critical ? "critical" : "normal"})`}
              />
            );
          })}
        </svg>
      </div>
    </div>
    </div>
  );
}

type CalendarProps = {
  closures?:string[];
  rows: Activity[];
  anchor: string;
  setAnchor: (s: string) => void;
  mode: CalendarMode;
  setMode: (s: CalendarMode) => void;
  embedded?: boolean;
  open: (t: Task) => void;
  add: (s: string) => void;
  move: (id: string, s: string) => Promise<void>;
  busy: boolean;
};
function Calendar(p: CalendarProps) {
  const work=projectCalendar(p.closures).work;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const multi = p.mode === "three" || p.mode === "six";
  const monthCount = p.mode === "three" ? 3 : 6;
  const first = p.mode !== "week" ? p.anchor.slice(0, 7) + "-01" : p.anchor;
  const monday = shift(first, -((day(first).getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: p.mode === "month" ? 6 : 1 }, (_, i) =>
    shift(monday, i * 7),
  );
  function navigate(dir: number) {
    if (p.mode === "week") p.setAnchor(shift(p.anchor, dir * 7));
    else {
      const d = day(p.anchor.slice(0, 7) + "-01");
      d.setUTCMonth(d.getUTCMonth() + dir * (multi ? monthCount : 1));
      p.setAnchor(fmt(d));
    }
  }
  return (
    <section className={`calendar ${p.embedded ? "calendar-embedded" : ""}`}>
      {p.embedded ? <h3>{day(p.anchor).toLocaleDateString("en-CA", {month:"long",year:"numeric",timeZone:"UTC"})}</h3> : <div className="calendar-tools">
        <button aria-label="Previous period" onClick={() => navigate(-1)}>
          ‹
        </button>
        <h2>
          {p.mode !== "week"
            ? day(p.anchor).toLocaleDateString("en-CA", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })
            : short(monday) + " – " + short(shift(monday, 6))}
          {multi && " – " + day(monthShift(p.anchor, monthCount - 1)).toLocaleDateString("en-CA", {month:"long",year:"numeric",timeZone:"UTC"})}
        </h2>
        <button aria-label="Next period" onClick={() => navigate(1)}>
          ›
        </button>
        <button onClick={() => p.setAnchor(today())}>Today</button>
        <div className="tabs">
          {(["week", "month", "three", "six"] as const).map((m) => (
            <button
              key={m}
              className={m === p.mode ? "selected" : ""}
              onClick={() => p.setMode(m)}
            >
              {m === "week" ? "Week" : m === "month" ? "Month" : m === "three" ? "3 months" : "6 months"}
            </button>
          ))}
        </div>
      </div>}
      {multi ? <div className="calendar-months">{Array.from({length:monthCount}, (_, i) => <Calendar key={monthShift(p.anchor,i)} {...p} anchor={monthShift(p.anchor,i)} mode="month" embedded />)}</div> : <div className="calendar-scroll">
        <div className="weekday">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <b key={d}>{d}</b>
          ))}
        </div>
        {weeks.map((start) => {
          const placed = lanes(p.rows, start, shift(start, 6)),
            max = placed.length
              ? Math.max(...placed.map((e) => e.lane)) + 1
              : 0,
            limit = expanded.has(start) ? max : Math.min(max, 4);
          return (
            <div
              className="calweek"
              key={start}
              style={{ height: 88 + Math.max(2, limit) * 30 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (p.busy) return;
                const data = e.dataTransfer.getData("application/fielddocs");
                if (!data) return;
                try {
                  const drag = JSON.parse(data),
                    rect = e.currentTarget.getBoundingClientRect(),
                    col = Math.max(
                      0,
                      Math.min(
                        6,
                        Math.floor((e.clientX - rect.left) / (rect.width / 7)),
                      ),
                    );
                  void p.move(drag.id, shift(start, col - (drag.offset || 0)));
                } catch {}
              }}
            >
              <div className="caldays">
                {Array.from({ length: 7 }, (_, i) => shift(start, i)).map(
                  (d) => (
                    <button
                      key={d}
                      disabled={p.busy}
                      aria-label={`Add activity ${readableDate(d)}${holidayOn(d)?" · "+holidayOn(d)!.name:""}`}
                      title={holidayOn(d)?`${holidayOn(d)!.name} · Non-working day. New work starts on the next working day.`:readableDate(d)}
                      className={`${holidayOn(d)?"holiday":!work(d) ? "weekend" : ""} ${d === today() ? "today" : ""} ${d.slice(0, 7) !== p.anchor.slice(0, 7) ? "muted" : ""}`}
                      onClick={() => p.add(d)}
                    >
                      <span>{day(d).getUTCDate()}</span>
                      {holidayOn(d)&&<small className="holiday-name">{holidayOn(d)!.name}</small>}
                    </button>
                  ),
                )}
              </div>
              {placed
                .filter((e) => e.lane < limit)
                .map((e) => (
                  <button
                    key={e.task.id}
                    className={`calendar-event ${colour(e.task)}`}
                    title={`${e.task.name} · ${e.task.trade || "Unassigned"} · ${readableDate(e.task.start)}–${readableDate(e.task.finish)} · ${dueCountdown(e.task.finish,e.task.status)}`}
                    style={{
                      left: `calc(${(e.from / 7) * 100}% + 3px)`,
                      width: `calc(${(e.span / 7) * 100}% - 6px)`,
                      top: 62 + e.lane * 30,
                    }}
                    onClick={() => p.open(e.task)}
                    draggable={!p.busy}
                    onDragStart={(ev) => {
                      const week = ev.currentTarget.parentElement!;
                      const w = week.getBoundingClientRect().width / 7;
                      const position =
                        e.from +
                        Math.max(
                          0,
                          Math.floor(
                            (ev.clientX -
                              ev.currentTarget.getBoundingClientRect().left) /
                              w,
                          ),
                        );
                      ev.dataTransfer.setData(
                        "application/fielddocs",
                        JSON.stringify({
                          id: e.task.id,
                          offset: distance(
                            e.task.start,
                            shift(start, position),
                          ),
                        }),
                      );
                    }}
                  >
                    {e.task.critical ? "! " : ""}
                    {e.task.is_milestone ? "◆ " : ""}
                    {e.task.name}
                    {e.task.trade ? " · " + e.task.trade : ""}
                  </button>
                ))}
              {max > 4 && (
                <button
                  className="more"
                  style={{ top: 65 + limit * 30 }}
                  onClick={() =>
                    setExpanded((old) => {
                      const n = new Set(old);
                      n.has(start) ? n.delete(start) : n.add(start);
                      return n;
                    })
                  }
                >
                  {expanded.has(start)
                    ? "Show fewer"
                    : `+ ${max - 4} more rows`}
                </button>
              )}
            </div>
          );
        })}
      </div>}
    </section>
  );
}

type EditorProps = {
  task: Task;
  snapshot: Snapshot;
  activities: Activity[];
  busy: boolean;
  stale: boolean;
  saveError: string;
  close: () => void;
  remove: (t: Task) => Promise<void>;
  save: (t: Task, l: Link[]) => Promise<void>;
};
function Editor(p: EditorProps) {
  const workDistance=projectCalendar(p.snapshot.closures).distance;
  const [task, setTask] = useState({ ...p.task }),
    [links, setLinks] = useState(
      p.snapshot.links
        .filter((l) => l.successor_id === p.task.id)
        .map((l) => ({ ...l })),
    ),
    [error, setError] = useState("");
  const phase = task.item_type === "phase",
    current = p.activities.find((t) => t.id === task.id),
    existing = p.snapshot.tasks.some((t) => t.id === task.id),
    dirty =
      JSON.stringify(task) !== JSON.stringify(p.task) ||
      JSON.stringify(links) !==
        JSON.stringify(
          p.snapshot.links.filter((l) => l.successor_id === task.id),
        );
  function close() {
    if (!p.busy && (!dirty || confirm("Discard this unsaved draft?")))
      p.close();
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [dirty, p.busy]);
  function update(change: Partial<Task>) {
    setTask((old) => normalizeProgress(old, change));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const next = phase
        ? {
            ...task,
            parent_id: null,
            is_milestone: false,
            progress: 0,
            duration_work_days: 0,
            status: "not_started" as Status,
          }
        : {
            ...task,
            duration_work_days: task.is_milestone ? 0 : task.duration_work_days,
          };
      validate(
        [...p.snapshot.tasks.filter((t) => t.id !== task.id), next],
        [
          ...p.snapshot.links.filter((l) => l.successor_id !== task.id),
          ...links,
        ],
      );
      await p.save(next, links);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={phase ? "Edit phase" : "Edit activity"}
      >
        <div className="drawer-title">
          <h2>
            {existing ? "Edit" : "New"} {phase ? "phase" : "activity"}
          </h2>
          <button aria-label="Close editor" disabled={p.busy} onClick={close}>
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="drawer-body">
            {p.saveError && (
              <p className="notice error" role="alert">
                {p.saveError}
              </p>
            )}
            {p.stale && (
              <p className="notice warning">
                Another session has changes. Close this draft and reload before
                saving.
              </p>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {current && !phase && (
              <section className="control-card">
                <strong className={current.critical ? "red" : ""}>
                  {current.critical
                    ? "CRITICAL · 0 days float"
                    : current.float + " work days total float"}
                </strong>
                <p>
                  Scheduled: {readableDate(current.start)} → {readableDate(current.finish)}
                  <WorkDayCountdown due={current.finish} status={current.status}/>
                </p>
                <p>
                  Controlling predecessor
                  {current.controlling.length === 1 ? "" : "s"}:{" "}
                  {current.controlling.length
                    ? current.controlling
                        .map(
                          (id) => p.activities.find((t) => t.id === id)?.name,
                        )
                        .join(", ")
                    : "Earliest-start date"}
                </p>
                {p.snapshot.baseline?.dates[task.id] && (
                  <p>
                    Finish variance:{" "}
                    {workDistance(
                      p.snapshot.baseline.dates[task.id].finish,
                      current.finish,
                    )}{" "}
                    work days vs baseline
                  </p>
                )}
              </section>
            )}
            <label>
              Name
              <input
                autoFocus
                required
                value={task.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                Stage
                <select
                  value={task.stage || "construction"}
                  onChange={(e) =>
                    update({
                      stage: e.target.value as
                        "construction" | "preconstruction",
                    })
                  }
                >
                  <option value="construction">Construction</option>
                  <option value="preconstruction">Preconstruction</option>
                </select>
              </label>
              <label>
                Responsible party
                <input
                  value={task.responsible_party || ""}
                  onChange={(e) =>
                    update({ responsible_party: e.target.value })
                  }
                  placeholder="Estimator, consultant, municipality…"
                />
              </label>
              <label>
                Waiting on
                <input
                  value={task.waiting_on || ""}
                  onChange={(e) => update({ waiting_on: e.target.value })}
                  placeholder="Comments, drawings, owner decision…"
                />
              </label>
              <label>
                Date confidence
                <select
                  value={task.date_confidence || "estimated"}
                  onChange={(e) =>
                    update({
                      date_confidence: e.target.value as
                        "estimated" | "confirmed",
                    })
                  }
                >
                  <option value="estimated">Estimated</option>
                  <option value="confirmed">Confirmed by project team</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={!!task.customer_visible}
                  onChange={(e) =>
                    update({ customer_visible: e.target.checked })
                  }
                />{" "}
                Include in customer summary
              </label>
            </div>
            {!phase && (
              <>
                <label>
                  Phase
                  <select
                    value={task.parent_id || ""}
                    onChange={(e) =>
                      update({ parent_id: e.target.value || null })
                    }
                  >
                    <option value="">Ungrouped</option>
                    {p.snapshot.tasks
                      .filter((t) => t.item_type === "phase")
                      .sort(ordered)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Trade / responsible
                  <input
                    value={task.trade || ""}
                    onChange={(e) => update({ trade: e.target.value })}
                  />
                </label>
                <div className="two">
                  <label>
                    Earliest start
                    <input
                      type="date"
                      required
                      value={task.start_date}
                      onChange={(e) => update({ start_date: e.target.value })}
                    />
                  </label>
                  <label>
                    Work days
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      disabled={task.is_milestone}
                      value={task.is_milestone ? 0 : task.duration_work_days}
                      onChange={(e) =>
                        update({ duration_work_days: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={task.is_milestone}
                    onChange={(e) =>
                      update({
                        is_milestone: e.target.checked,
                        duration_work_days: e.target.checked
                          ? 0
                          : Math.max(1, task.duration_work_days),
                      })
                    }
                  />
                  Milestone
                </label>
                <div className="two">
                  <label>
                    Status
                    <select
                      value={task.status}
                      onChange={(e) =>
                        update({ status: e.target.value as Status })
                      }
                    >
                      {Object.entries(labels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Progress %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={task.progress}
                      onChange={(e) =>
                        update({ progress: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <fieldset>
                  <legend>Predecessors and overlaps</legend>
                  <p>
                    Offsets use the project working calendar. FS zero starts the next workday; SS zero starts with the predecessor. Negative offsets overlap work. All links save with this activity.
                  </p>
                  {links.map((l, i) => (
                    <div className="dependency" key={l.id}>
                      <label>
                        Activity
                        <select
                          aria-label="Predecessor activity"
                          required
                          value={l.predecessor_id}
                          onChange={(e) =>
                            setLinks(
                              links.map((x, j) =>
                                i === j
                                  ? { ...x, predecessor_id: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="">Choose…</option>
                          {p.snapshot.tasks
                            .filter(
                              (t) => t.id !== task.id && t.item_type === "task",
                            )
                            .sort(ordered)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>Relationship<select aria-label="Dependency relationship" value={l.relation || "FS"} onChange={e=>setLinks(links.map((x,j)=>i===j?{...x,relation:e.target.value as "FS"|"SS"}:x))}><option value="FS">Finish to start</option><option value="SS">Start to start</option></select></label>
                      <label>
                        Lag
                        <input
                          aria-label="Lag work days"
                          type="number"
                          min={-10000}
                          max={10000}
                          step={1}
                          value={l.lag_work_days}
                          onChange={(e) =>
                            setLinks(
                              links.map((x, j) =>
                                i === j
                                  ? {
                                      ...x,
                                      lag_work_days: Number(e.target.value),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        aria-label="Remove predecessor"
                        onClick={() =>
                          setLinks(links.filter((_, j) => i !== j))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setLinks([
                        ...links,
                        {
                          id: crypto.randomUUID(),
                          project_id: task.project_id,
                          predecessor_id: "",
                          successor_id: task.id,
                          lag_work_days: 0,
                        },
                      ])
                    }
                  >
                    + Predecessor
                  </button>
                </fieldset>
              </>
            )}
            {phase && (
              <p>
                Dates and progress automatically summarize the activities
                assigned to this phase.
              </p>
            )}
            <label>
              Notes / update explanation
              <textarea
                rows={4}
                value={task.notes || ""}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </label>
          </div>
          <div className="drawer-footer">
            {existing && (
              <button
                type="button"
                className="danger"
                disabled={p.busy || p.stale}
                onClick={() => void p.remove(task)}
              >
                Delete
              </button>
            )}
            <button type="button" disabled={p.busy} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={p.busy || p.stale}
            >
              {p.busy ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function PlanningTemplateDialog({
  busy,
  stale,
  error,
  hasPlanning,
  close,
  save,
}: {
  busy: boolean;
  stale: boolean;
  error: string;
  hasPlanning: boolean;
  close: () => void;
  save: (start: string, variance: boolean, connect: boolean) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [start, setStart] = useState(today()),
    [variance, setVariance] = useState(false),
    [connect, setConnect] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="planning-dialog"
      aria-labelledby="planning-template-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(start, variance, connect);
        }}
      >
        <h2 id="planning-template-title">Plan the path to construction</h2>
        <p>
          Add a starting plan for site approvals, drawings, permit review,
          tendering, and procurement. Review the allowances and links with your
          project team.
        </p>
        {hasPlanning && (
          <p className="notice warning">
            This adds another planning phase alongside your existing activities.
          </p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {stale && (
          <p className="notice warning">
            Close this dialog and reload the changed schedule before adding a
            template.
          </p>
        )}
        <label>
          Planning start date
          <input
            type="date"
            required
            value={start}
            disabled={busy}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="template-check">
          <input
            type="checkbox"
            checked={variance}
            disabled={busy}
            onChange={(e) => setVariance(e.target.checked)}
          />{" "}
          Include a minor variance stream
        </label>
        <label className="template-check">
          <input
            type="checkbox"
            checked={connect}
            disabled={busy}
            onChange={(e) => setConnect(e.target.checked)}
          />{" "}
          Make first construction activities wait for mobilization
        </label>
        <p className="muted">
          When selected, open construction activities with no predecessors will
          depend on “Ready to mobilize.” Their dates may move. You can edit all
          links afterward.
        </p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy || stale} type="submit">
            {busy ? "Adding…" : "Add template"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function ClearScheduleDialog({title,snapshot,busy,stale,error,close,clear}:{title:string;snapshot:Snapshot;busy:boolean;stale:boolean;error:string;close:()=>void;clear:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null),[confirmation,setConfirmation]=useState("");
  useEffect(()=>{dialog.current?.showModal();},[]);
  const phases=snapshot.tasks.filter(t=>t.item_type==="phase").length;
  return <dialog ref={dialog} className="planning-dialog" aria-labelledby="clear-schedule-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <form onSubmit={e=>{e.preventDefault();if(confirmation==="CLEAR"&&!busy&&!stale)void clear();}}>
      <h2 id="clear-schedule-title">Clear schedule for {title}?</h2>
      <p>This removes <strong>{snapshot.tasks.length-phases} tasks and milestones, {phases} phases, and {snapshot.links.length} dependencies</strong> from this project's Gantt, calendar and customer schedule summary.</p>
      <p>All stages and hidden or filtered tasks are included. The saved baseline and import history will also be cleared, so you can import the same file again.</p>
      <p>Project shutdown dates, Ontario holidays, separate to-dos, reports, files and budgets stay in place. To-dos linked to removed activities become unlinked.</p>
      <p>Undo can restore tasks, links and baseline until your next change or reload. It does not restore import history or to-do activity links. Export the schedule first if you need a lasting record.</p>
      {error&&<p role="alert" className="notice warning">{error}</p>}
      {stale&&<p role="alert">Another session changed this schedule. Cancel and reload before clearing.</p>}
      <label>Type CLEAR to confirm<input autoFocus aria-label="Type CLEAR to confirm" autoComplete="off" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>
      <div className="toolbar"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="clear-schedule-button" type="submit" disabled={busy||stale||confirmation!=="CLEAR"}>{busy?"Clearing…":"Clear entire schedule"}</button></div>
    </form>
  </dialog>;
}
