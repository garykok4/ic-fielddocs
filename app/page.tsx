"use client";
import { useEffect, useRef, useState } from "react";
import { requireActiveStaff } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  getProjects,
  Person,
  Project,
  ProjectTask,
  taskLabels,
} from "../lib/project-work";
import { Activity, calculate, today, shift } from "./schedule/engine";
import "../components/project-work.css";
import "./dashboard.css";
type Card = { project: Project; activities: Activity[]; problem: string };
export default function Dashboard() {
  const [profile, setProfile] = useState<Person | null>(null),
    [cards, setCards] = useState<Card[]>([]),
    [tasks, setTasks] = useState<ProjectTask[]>([]),
    [assigned, setAssigned] = useState<string[]>([]),
    [all, setAll] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [taskError, setTaskError] = useState(""),
    [updated, setUpdated] = useState("");
  const sequence = useRef(0);
  async function load() {
    const seq = ++sequence.current;
    setError("");
    setTaskError("");
    try {
      const p = await requireActiveStaff();
      if (!p) return;
      const [projects, tr, ar] = await Promise.all([
        getProjects(p),
        supabase
          .from("project_tasks")
          .select("*")
          .order("due_date", { ascending: true, nullsFirst: false }),
        supabase
          .from("project_staff")
          .select("project_id")
          .eq("staff_id", p.id),
      ]);
      if (ar.error) throw ar.error;
      const result = await Promise.all(
        projects.map(async (project) => {
          try {
            const r = await supabase.rpc("schedule_v4_read", {
              p_project: project.id,
            });
            if (r.error) throw r.error;
            return {
              project,
              activities: calculate(r.data.tasks, r.data.links),
              problem: "",
            };
          } catch (e) {
            return { project, activities: [], problem: (e as Error).message };
          }
        }),
      );
      if (seq !== sequence.current) return;
      setProfile(p);
      setCards(result);
      setAssigned((ar.data || []).map((x) => x.project_id));
      if (tr.error) setTaskError(tr.error.message);
      else setTasks(tr.data || []);
      setUpdated(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    const timer = setInterval(focus, 60000);
    return () => {
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  const now = today(),
    mine = tasks.filter(
      (t) => t.assignee_id === profile?.id && t.status !== "done",
    ),
    late = mine.filter((t) => t.due_date && t.due_date < now),
    dueToday = mine.filter((t) => t.due_date === now),
    soon = mine.filter(
      (t) => t.due_date && t.due_date >= now && t.due_date <= shift(now, 7),
    ),
    blocked = mine.filter((t) => t.status === "blocked");
  const shown = cards.filter((c) => all || assigned.includes(c.project.id));
  const reminders = [
    ...late.map((t) => ({ task: t, label: "Overdue", type: "red" })),
    ...dueToday.map((t) => ({ task: t, label: "Due today", type: "amber" })),
    ...blocked
      .filter((t) => !late.includes(t) && !dueToday.includes(t))
      .map((t) => ({ task: t, label: "Blocked", type: "red" })),
    ...soon
      .filter((t) => !dueToday.includes(t) && !blocked.includes(t))
      .map((t) => ({ task: t, label: "Upcoming", type: "" })),
  ];
  const projectName = (id: string) =>
    cards.find((c) => c.project.id === id)?.project.project_name || "Project";
  const taskHref = (t: ProjectTask) =>
    `/projects/${t.project_id}?tab=tasks&task=${t.id}`;
  return (
    <main className="pw dashboard">
      <header className="dash-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>
            {profile
              ? `Welcome back, ${profile.full_name?.split(" ")[0] || "there"}.`
              : "Your dashboard"}
          </h1>
          <p className="muted">
            Your priorities, your projects, and what needs to happen next.
          </p>
        </div>
        <div className="dash-date">
          <strong>
            {new Date().toLocaleDateString("en-CA", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </strong>
          <small>
            {updated ? `Updated ${updated}` : "Opening your workspace…"}
          </small>
          <button className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {taskError && (
        <p role="alert" className="notice error">
          Tasks are unavailable: {taskError}
        </p>
      )}
      {loading ? (
        <p>Loading your assigned work…</p>
      ) : (
        profile && (
          <>
            <div className="cards dashboard-metrics">
              <a href="/tasks" className="metric">
                <span>MY OPEN TASKS</span>
                <strong>{taskError ? "—" : mine.length}</strong>
                <small>View assigned work →</small>
              </a>
              <a href="/tasks?due=overdue" className="metric">
                <span>OVERDUE</span>
                <strong className={late.length ? "red" : ""}>
                  {taskError ? "—" : late.length}
                </strong>
                <small>
                  {late.length ? "Needs your attention" : "Nothing overdue"}
                </small>
              </a>
              <a href="/tasks?due=soon" className="metric">
                <span>DUE IN 7 DAYS</span>
                <strong>{taskError ? "—" : soon.length}</strong>
                <small>{dueToday.length} due today</small>
              </a>
              <a href="#project-widgets" className="metric">
                <span>ASSIGNED PROJECTS</span>
                <strong>
                  {cards.filter((c) => assigned.includes(c.project.id)).length}
                </strong>
                <small>Your project overview ↓</small>
              </a>
            </div>
            <div className="dash-work-grid">
              <div className="panel dash-task-panel">
                <div className="bar">
                  <div>
                    <div className="eyebrow">FOCUS</div>
                    <h2>My to-dos</h2>
                  </div>
                  <a href="/tasks">View all →</a>
                </div>
                {!mine.length ? (
                  <div className="empty">
                    {taskError
                      ? "Your task list could not be loaded."
                      : "You’re caught up. New assignments will appear here."}
                  </div>
                ) : (
                  mine.slice(0, 6).map((t) => (
                    <a className="dash-task" href={taskHref(t)} key={t.id}>
                      <span
                        className={
                          "task-dot " +
                          (t.status === "blocked" ? "blocked" : "")
                        }
                        aria-hidden="true"
                      >
                        {t.status === "blocked" ? "!" : "○"}
                      </span>
                      <span className="dash-task-name">
                        <strong>{t.title}</strong>
                        <small>
                          {projectName(t.project_id)} · {taskLabels[t.status]}
                        </small>
                      </span>
                      <span
                        className={t.due_date && t.due_date < now ? "red" : ""}
                      >
                        {t.due_date === now
                          ? "Today"
                          : t.due_date || "No due date"}
                      </span>
                    </a>
                  ))
                )}
                <a className="dash-add" href="/tasks">
                  + Add or assign a task
                </a>
              </div>
              <div className="panel dash-reminders">
                <div className="eyebrow">KEEP MOVING</div>
                <h2>Reminders</h2>
                {!reminders.length ? (
                  <div className="empty">
                    No upcoming deadlines or blocked tasks assigned to you.
                  </div>
                ) : (
                  reminders.slice(0, 5).map(({ task, label, type }) => (
                    <a className="reminder" href={taskHref(task)} key={task.id}>
                      <span className={"badge " + type}>{label}</span>
                      <strong>{task.title}</strong>
                      <small>
                        {projectName(task.project_id)} ·{" "}
                        {task.due_date || "No date set"}
                      </small>
                    </a>
                  ))
                )}
                <p className="muted reminder-note">
                  Updates here refresh automatically. Email reminders also
                  require notification delivery to be configured.
                </p>
              </div>
            </div>
            <div className="bar" id="project-widgets">
              <div>
                <div className="eyebrow">PROJECT OVERVIEW</div>
                <h2>
                  {all ? "All accessible projects" : "My assigned projects"}
                </h2>
              </div>
              <div className="actions">
                {profile.role === "admin" && (
                  <>
                    <button
                      className={!all ? "" : "secondary"}
                      onClick={() => setAll(false)}
                    >
                      Assigned to me
                    </button>
                    <button
                      className={all ? "" : "secondary"}
                      onClick={() => setAll(true)}
                    >
                      All projects
                    </button>
                  </>
                )}
                <a href="/projects">Manage projects →</a>
              </div>
            </div>
            {!shown.length ? (
              <div className="panel empty">
                {profile.role === "admin" ? (
                  <>
                    No projects are assigned to you yet. Choose{" "}
                    <button className="text" onClick={() => setAll(true)}>
                      All projects
                    </button>{" "}
                    or assign yourself under Project team.
                  </>
                ) : (
                  "Your assigned projects will appear here. Ask your administrator to add you to a project."
                )}
              </div>
            ) : (
              <div className="project-widgets">
                {shown.map(({ project, activities, problem }) => {
                  const rows = activities.filter((a) => a.item_type === "task"),
                    crit = rows.filter(
                      (a) => a.critical && a.status !== "complete",
                    ),
                    waiting = rows.filter(
                      (a) => a.waiting_on && a.status !== "complete",
                    ),
                    pt = tasks.filter(
                      (t) => t.project_id === project.id && t.status !== "done",
                    ),
                    milestone = rows
                      .filter((a) => a.is_milestone && a.status !== "complete")
                      .sort((a, b) => a.finish.localeCompare(b.finish))[0],
                    complete = rows.filter(
                      (a) => a.status === "complete",
                    ).length,
                    progress = rows.length
                      ? Math.round(
                          rows.reduce((s, a) => s + a.progress, 0) /
                            rows.length,
                        )
                      : 0;
                  return (
                    <article className="project-widget" key={project.id}>
                      <div className="bar">
                        <span className="project-monogram">
                          {project.project_name.slice(0, 2).toUpperCase()}
                        </span>
                        <span
                          className={
                            "badge " +
                            (problem
                              ? "red"
                              : waiting.length
                                ? "amber"
                                : crit.length
                                  ? "red"
                                  : "green")
                          }
                        >
                          {problem
                            ? "Schedule unavailable"
                            : waiting.length
                              ? "Waiting on input"
                              : crit.length
                                ? "Critical work ahead"
                                : "No flagged items"}
                        </span>
                      </div>
                      <h3>
                        <a href={`/projects/${project.id}`}>
                          {project.project_name}
                        </a>
                      </h3>
                      {problem ? (
                        <p className="notice error">{problem}</p>
                      ) : (
                        <>
                          <div className="progress-label">
                            <span>Activity progress · average</span>
                            <strong>{progress}%</strong>
                          </div>
                          <div
                            className="progress-track"
                            role="progressbar"
                            aria-label={`${project.project_name} average activity progress`}
                            aria-valuenow={progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <p className="muted">
                            {complete} of {rows.length} activities complete
                          </p>
                        </>
                      )}
                      <div className="widget-stats">
                        <a href={`/projects/${project.id}?tab=tasks`}>
                          <strong>{taskError ? "—" : pt.length}</strong>
                          <span>Open tasks</span>
                        </a>
                        <a href={`/projects/${project.id}?tab=schedule`}>
                          <strong className={crit.length ? "red" : ""}>
                            {problem ? "—" : crit.length}
                          </strong>
                          <span>Critical</span>
                        </a>
                        <a href={`/projects/${project.id}?tab=preconstruction`}>
                          <strong>{problem ? "—" : waiting.length}</strong>
                          <span>Waiting on</span>
                        </a>
                      </div>
                      <div className="widget-next">
                        <small>NEXT MILESTONE</small>
                        <strong>
                          {milestone?.name ||
                            (rows.length
                              ? "No open milestone"
                              : "Schedule not started")}
                        </strong>
                        {milestone && (
                          <span>
                            {milestone.finish} ·{" "}
                            {milestone.date_confidence || "estimated"}
                          </span>
                        )}
                      </div>
                      {waiting[0] && (
                        <p className="waiting-note">
                          <strong>Waiting:</strong> {waiting[0].waiting_on}
                        </p>
                      )}
                      <div className="widget-footer">
                        <a href={`/projects/${project.id}`}>Open project →</a>
                        <a href={`/projects/${project.id}?tab=tasks`}>Tasks</a>
                        <a href={`/projects/${project.id}?tab=schedule`}>
                          Schedule
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )
      )}
    </main>
  );
}
