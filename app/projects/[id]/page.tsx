"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { requireActiveStaff } from "../../../lib/auth";
import { supabase } from "../../../lib/supabase";
import {
  getProjects,
  Person,
  Project,
  ProjectTask,
} from "../../../lib/project-work";
import { Activity, calculate, Snapshot, today } from "../../schedule/engine";
import ScheduleWorkspace from "../../schedule/ScheduleWorkspace";
import TaskBoard from "../../../components/TaskBoard";
import "../../../components/project-work.css";
const tabs = [
  ["overview", "Overview"],
  ["preconstruction", "Preconstruction"],
  ["schedule", "Schedule"],
  ["tasks", "Tasks"],
  ["customer", "Customer summary"],
];
export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<Person | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [tab, setTab] = useState("overview"),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [activities, setActivities] = useState<Activity[]>([]),
    [tasks, setTasks] = useState<ProjectTask[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const refreshSeq = useRef(0);
  async function refresh() {
    const seq = ++refreshSeq.current;
    setError("");
    try {
      const [s, t] = await Promise.all([
        supabase.rpc("schedule_v4_read", { p_project: id }),
        supabase.from("project_tasks").select("*").eq("project_id", id),
      ]);
      if (s.error || t.error) throw s.error || t.error;
      if (seq !== refreshSeq.current) return;
      setActivities(calculate(s.data.tasks, s.data.links));
      setSnapshot(s.data);
      setTasks(t.data || []);
    } catch (e) {
      if (seq === refreshSeq.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setProfile(null);
    setSnapshot(null);
    setActivities([]);
    setTasks([]);
    (async () => {
      try {
        const p = await requireActiveStaff();
        if (!p) return;
        const rows = await getProjects(p);
        if (!rows.some((x) => x.id === id))
          throw Error("This project is not assigned to your account.");
        if (!alive) return;
        setProjects(rows);
        setProfile(p);
        const requested = new URLSearchParams(window.location.search).get(
          "tab",
        );
        setTab(tabs.some((t) => t[0] === requested) ? requested! : "overview");
        await refresh();
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
      refreshSeq.current++;
    };
  }, [id]);
  useEffect(() => {
    if (!profile) return;
    const focus = () => {
      if (["overview", "customer"].includes(tab)) void refresh();
    };
    window.addEventListener("focus", focus);
    const timer = setInterval(focus, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [profile, tab, id]);
  function choose(next: string) {
    setTab(next);
    window.history.replaceState(null, "", `/projects/${id}?tab=${next}`);
    if (["overview", "customer"].includes(next)) void refresh();
  }
  const project = projects.find((p) => p.id === id),
    actual = activities.filter((t) => t.item_type === "task"),
    planning = actual.filter((t) => t.stage === "preconstruction"),
    critical = actual.filter((t) => t.critical && t.status !== "complete"),
    open = tasks.filter((t) => t.status !== "done"),
    overdue = open.filter((t) => t.due_date && t.due_date < today()),
    waiting = planning.filter((t) => t.waiting_on && t.status !== "complete");
  const visible = actual
      .filter((t) => t.customer_visible)
      .sort(
        (a, b) => a.start.localeCompare(b.start) || a.sort_order - b.sort_order,
      ),
    finish = actual
      .map((t) => t.finish)
      .sort()
      .at(-1),
    gate = planning.find((t) => t.name === "Ready to mobilize");
  return (
    <main className={"pw " + (tab === "customer" ? "customer-report" : "")}>
      <header className="no-print">
        <div className="eyebrow">FIELD DOCS / PROJECT WORKSPACE</div>
        <div className="bar">
          <div>
            <h1>{project?.project_name || "Project workspace"}</h1>
            <p className="muted">
              Approvals, construction, and the people moving the project
              forward.
            </p>
          </div>
          <div className="actions">
            <a href="/projects">All projects & settings</a>
            <a href="/tasks">My tasks</a>
          </div>
        </div>
      </header>
      {busy ? (
        <p>Loading project…</p>
      ) : !profile ? (
        <p className="notice error" role="alert">
          {error || "Project access required."}
        </p>
      ) : (
        <>
          <div
            className="tabs no-print"
            role="tablist"
            aria-label="Project sections"
          >
            {tabs.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "active" : ""}
                onClick={() => choose(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {error && (
            <p className="notice error no-print" role="alert">
              {error} <button onClick={() => void refresh()}>Retry</button>
            </p>
          )}
          {tab === "overview" && (
            <>
              <div className="cards">
                <div className="metric">
                  <strong>
                    {planning.filter((t) => t.status === "complete").length}/
                    {planning.length}
                  </strong>
                  <span>Preconstruction activities complete</span>
                </div>
                <div className="metric">
                  <strong className="red">{critical.length}</strong>
                  <span>Open critical path activities</span>
                </div>
                <div className="metric">
                  <strong>{open.length}</strong>
                  <span>Open team tasks</span>
                </div>
                <div className="metric">
                  <strong className="red">{overdue.length}</strong>
                  <span>Overdue team tasks</span>
                </div>
              </div>
              <div className="grid">
                <div className="panel">
                  <h2>Path to construction</h2>
                  {!planning.length ? (
                    <>
                      <p>
                        Add the editable planning template to map design,
                        approvals, permits, and tendering.
                      </p>
                      <button onClick={() => choose("preconstruction")}>
                        Plan preconstruction
                      </button>
                    </>
                  ) : (
                    <>
                      <p>
                        Target mobilization:{" "}
                        <strong>
                          {gate?.finish || "Add a mobilization milestone"}
                        </strong>
                      </p>
                      <p className="muted">
                        A calculated planning date; confirm approval conditions
                        and procurement before committing.
                      </p>
                      <p>
                        {waiting.length} activities have a recorded “waiting on”
                        item.
                      </p>
                      <button onClick={() => choose("customer")}>
                        Customer summary
                      </button>
                    </>
                  )}
                </div>
                <div className="panel">
                  <h2>Project controls</h2>
                  <p>
                    Scheduled finish:{" "}
                    <strong>{finish || "No activities yet"}</strong>
                  </p>
                  <p>
                    Saved baseline:{" "}
                    <strong>
                      {snapshot?.baseline?.name || "Not captured"}
                    </strong>
                  </p>
                  <p>
                    Critical path includes both preconstruction and construction
                    dependencies.
                  </p>
                  <button onClick={() => choose("schedule")}>
                    Open full schedule
                  </button>
                </div>
              </div>
              <div className="panel">
                <div className="bar">
                  <h2>Critical path · needs attention</h2>
                  <button
                    className="secondary"
                    onClick={() => choose("schedule")}
                  >
                    Edit schedule
                  </button>
                </div>
                {!critical.length ? (
                  <p className="muted">No open critical activities.</p>
                ) : (
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Activity</th>
                          <th>Responsible</th>
                          <th>Finish</th>
                          <th>Waiting on</th>
                        </tr>
                      </thead>
                      <tbody>
                        {critical.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <span className="badge red">CRITICAL</span>{" "}
                              {a.name}
                            </td>
                            <td>
                              {a.responsible_party || a.trade || "Unassigned"}
                            </td>
                            <td>{a.finish}</td>
                            <td>{a.waiting_on || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="panel">
                <div className="bar">
                  <h2>Team follow-ups</h2>
                  <button onClick={() => choose("tasks")}>Manage tasks</button>
                </div>
                {open.length ? (
                  <ul>
                    {[...open]
                      .sort((a, b) =>
                        (a.due_date || "9999").localeCompare(
                          b.due_date || "9999",
                        ),
                      )
                      .slice(0, 6)
                      .map((t) => (
                        <li key={t.id}>
                          {t.title} — {t.due_date || "No due date"}
                          {t.status === "blocked" ? " · Blocked" : ""}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="muted">
                    No open tasks. Add follow-ups for your estimator, site
                    manager, or yourself.
                  </p>
                )}
              </div>
            </>
          )}
          {tab === "preconstruction" && (
            <ScheduleWorkspace
              key={"pre-" + id}
              fixedProject={id}
              planningMode
            />
          )}
          {tab === "schedule" && (
            <ScheduleWorkspace key={"schedule-" + id} fixedProject={id} />
          )}
          {tab === "tasks" && (
            <TaskBoard
              projects={projects}
              profile={profile}
              projectId={id}
              onChange={() => void refresh()}
            />
          )}
          {tab === "customer" && (
            <>
              <div className="customer-title">
                <div className="eyebrow">
                  I/C CONSTRUCTION INC. / PROJECT ROADMAP
                </div>
                <h1>{project?.project_name}</h1>
              </div>
              <div className="bar">
                <div>
                  <h2>Path to construction</h2>
                  <p className="muted">
                    Prepared {today()} · Dates reflect the current dependency
                    schedule.
                  </p>
                </div>
                <button className="no-print" onClick={() => window.print()}>
                  Print / save PDF
                </button>
              </div>
              <p className="notice">
                Estimated dates are planning allowances, subject to scope,
                review cycles, approvals, and procurement. “Confirmed” records
                the team’s confidence; it does not prevent dependencies from
                moving a date.
              </p>
              {!visible.length ? (
                <div className="panel empty">
                  No activities selected for this summary. Edit an activity and
                  check “Include in customer summary.”
                </div>
              ) : (
                <div className="tablewrap">
                  <table className="pre-list">
                    <thead>
                      <tr>
                        <th>Activity / milestone</th>
                        <th>Responsible</th>
                        <th>Start → finish</th>
                        <th>Depends on</th>
                        <th>Waiting on</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((a) => {
                        const links =
                          snapshot?.links.filter(
                            (l) => l.successor_id === a.id,
                          ) || [];
                        const shown = links.map(
                          (l) =>
                            visible.find((t) => t.id === l.predecessor_id)
                              ?.name || "Internal prerequisite",
                        );
                        return (
                          <tr key={a.id}>
                            <td>
                              {a.is_milestone ? "◆ " : ""}
                              {a.name}
                              {a.critical && a.status !== "complete" && (
                                <div className="badge red">Critical path</div>
                              )}
                            </td>
                            <td>
                              {a.responsible_party || a.trade || "To confirm"}
                            </td>
                            <td>
                              {a.start} → {a.finish}
                              <div className="muted">
                                {a.date_confidence === "confirmed"
                                  ? "Confirmed"
                                  : "Estimated"}
                              </div>
                            </td>
                            <td>{shown.join("; ") || "—"}</td>
                            <td>{a.waiting_on || "—"}</td>
                            <td>{a.status.replaceAll("_", " ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted no-print">
                Only activities marked for customers appear. Internal notes,
                task comments, and staff contact details are excluded. Print or
                save a PDF to share; this page requires staff access.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
