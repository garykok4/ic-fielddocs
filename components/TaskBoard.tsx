"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Comment,
  dispatchNotifications,
  Person,
  Project,
  ProjectTask,
  taskLabels,
} from "../lib/project-work";
import { Task, today } from "../app/schedule/engine";
import "./project-work.css";
type Props = {
  projects: Project[];
  profile: Person;
  projectId?: string;
  onChange?: () => void;
};
export default function TaskBoard({
  projects,
  profile,
  projectId,
  onChange,
}: Props) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("open"),
    [scope, setScope] = useState(projectId ? "all" : "mine"),
    [due, setDue] = useState(""),
    [projectFilter, setProjectFilter] = useState(projectId || ""),
    [view, setView] = useState("list");
  const [editing, setEditing] = useState<ProjectTask | null>(null),
    [isNew, setIsNew] = useState(false),
    [busy, setBusy] = useState(false),
    [editorError, setEditorError] = useState(""),
    [team, setTeam] = useState<Person[]>([]),
    [activities, setActivities] = useState<Task[]>([]),
    [comments, setComments] = useState<Comment[]>([]),
    [comment, setComment] = useState(""),
    [editorLoading, setEditorLoading] = useState(false);
  const openedRequest = useRef(false);
  const loadId = useRef(0),
    editorId = useRef(0),
    lock = useRef(false),
    dialog = useRef<HTMLDivElement>(null);
  async function load() {
    const seq = ++loadId.current;
    setError("");
    try {
      let q = supabase
        .from("project_tasks")
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const r = await q;
      if (r.error) throw r.error;
      const teams = await Promise.all(
        projects.map(async (p) => {
          const r = await supabase.rpc("fielddocs_project_team", {
            p_project: p.id,
          });
          if (r.error) throw r.error;
          return r.data as Person[];
        }),
      );
      if (seq !== loadId.current) return;
      setTasks(r.data || []);
      if (!openedRequest.current) {
        openedRequest.current = true;
        const params = new URLSearchParams(window.location.search),
          requested = params.get("task"),
          requestedDue = params.get("due");
        if (requested) {
          const found = (r.data || []).find((t) => t.id === requested);
          if (found) open(found);
        }
        if (["overdue", "soon", "none"].includes(requestedDue || ""))
          setDue(requestedDue!);
      }
      setPeople(
        Array.from(new Map(teams.flat().map((p) => [p.id, p])).values()),
      );
    } catch (e) {
      if (seq === loadId.current) setError((e as Error).message);
    } finally {
      if (seq === loadId.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const t = setInterval(onFocus, 60000);
    return () => {
      loadId.current++;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [projectId, projects]);
  useEffect(() => {
    if (!editing) return;
    const seq = ++editorId.current;
    setEditorLoading(true);
    setTeam([]);
    setActivities([]);
    setComments([]);
    (async () => {
      try {
        const [t, s, c] = await Promise.all([
          supabase.rpc("fielddocs_project_team", {
            p_project: editing.project_id,
          }),
          supabase.rpc("schedule_v4_read", { p_project: editing.project_id }),
          isNew
            ? Promise.resolve({ data: [], error: null })
            : supabase
                .from("task_comments")
                .select("*")
                .eq("task_id", editing.id)
                .order("created_at"),
        ]);
        if (t.error || s.error || c.error) throw t.error || s.error || c.error;
        if (seq !== editorId.current) return;
        setTeam(t.data || []);
        setActivities(
          (s.data?.tasks || []).filter((a: Task) => a.item_type === "task"),
        );
        setComments(c.data || []);
      } catch (e) {
        if (seq === editorId.current) setEditorError((e as Error).message);
      } finally {
        if (seq === editorId.current) setEditorLoading(false);
      }
    })();
    return () => {
      editorId.current++;
    };
  }, [editing?.id, editing?.project_id, isNew]);
  useEffect(() => {
    if (!editing) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lock.current) closeEditor();
      if (e.key === "Tab") {
        const list = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ) || [],
        );
        if (!list.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [!!editing]);
  function closeEditor() {
    if (
      !lock.current &&
      confirm("Close this task editor? Any unsaved changes will be discarded.")
    )
      setEditing(null);
  }
  function open(t: ProjectTask, newTask = false) {
    setEditorError("");
    setNotice("");
    setComment("");
    setIsNew(newTask);
    setEditing({ ...t });
  }
  function create() {
    const p = projectId || projectFilter || projects[0]?.id;
    if (!p) return;
    open(
      {
        id: crypto.randomUUID(),
        project_id: p,
        title: "",
        description: "",
        assignee_id: null,
        due_date: null,
        priority: "normal",
        status: "todo",
        activity_id: null,
        revision: 0,
        updated_at: "",
      },
      true,
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || lock.current) return;
    lock.current = true;
    setBusy(true);
    setEditorError("");
    try {
      const r = await supabase.rpc("fielddocs_task_save", {
        p_task: editing,
        p_revision: isNew ? null : editing.revision,
      });
      if (r.error) throw r.error;
      const wasDone = editing.status === "done",
        linked = !!editing.activity_id;
      setEditing(null);
      await load();
      onChange?.();
      setNotice(
        wasDone && linked
          ? "Task completed. Review the linked schedule activity; its dates and approval status have not changed."
          : "Task saved.",
      );
      if (!(await dispatchNotifications()))
        setNotice(
          "Task saved. Email is queued for the next successful delivery run.",
        );
    } catch (e) {
      setEditorError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !editing ||
      lock.current ||
      !confirm("Delete this task and its comments?")
    )
      return;
    lock.current = true;
    setBusy(true);
    setEditorError("");
    try {
      const r = await supabase.rpc("fielddocs_task_delete", {
        p_id: editing.id,
        p_revision: editing.revision,
      });
      if (r.error) throw r.error;
      setEditing(null);
      await load();
      onChange?.();
      setNotice("Task deleted.");
    } catch (e) {
      setEditorError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function addComment() {
    if (!editing || !comment.trim() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setEditorError("");
    try {
      const r = await supabase.rpc("fielddocs_task_comment", {
        p_task: editing.id,
        p_body: comment,
      });
      if (r.error) throw r.error;
      setComments((c) => [...c, r.data]);
      setComment("");
    } catch (e) {
      setEditorError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const now = today(),
    nextWeek = new Date(now + "T12:00:00Z");
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const week = nextWeek.toISOString().slice(0, 10);
  const person = (id: string | null) =>
    people.find((p) => p.id === id)?.full_name ||
    (id ? "Former / unavailable staff" : "Unassigned");
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.project_name || "Project";
  const filtered = tasks.filter(
    (t) =>
      (!projectFilter || t.project_id === projectFilter) &&
      (scope === "all" ||
        (scope === "mine" ? t.assignee_id === profile.id : !t.assignee_id)) &&
      (status === "all" ||
        (status === "open" ? t.status !== "done" : t.status === status)) &&
      (!search ||
        `${t.title} ${t.description} ${person(t.assignee_id)}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!due ||
        (due === "overdue"
          ? t.status !== "done" && !!t.due_date && t.due_date < now
          : due === "soon"
            ? t.status !== "done" &&
              !!t.due_date &&
              t.due_date >= now &&
              t.due_date <= week
            : !t.due_date)),
  );
  const overdue = (t: ProjectTask) =>
    t.status !== "done" && !!t.due_date && t.due_date < now;
  return (
    <div className="taskboard">
      <div className="bar">
        <div>
          <h2>{projectId ? "Project tasks" : "My tasks"}</h2>
          <span className="muted">
            Assignments, follow-ups, and decisions in one place.
          </span>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => void load()}>
            Refresh
          </button>
          <button disabled={!projects.length} onClick={create}>
            + Add task
          </button>
        </div>
      </div>
      <div className="cards">
        <div className="metric">
          <strong>
            {
              tasks.filter(
                (t) => t.assignee_id === profile.id && t.status !== "done",
              ).length
            }
          </strong>
          <span>Assigned to me · open</span>
        </div>
        <div className="metric">
          <strong className="red">{tasks.filter(overdue).length}</strong>
          <span>Overdue · accessible projects</span>
        </div>
        <div className="metric">
          <strong>{tasks.filter((t) => t.status === "blocked").length}</strong>
          <span>Blocked</span>
        </div>
        <div className="metric">
          <strong>
            {tasks.filter((t) => !t.assignee_id && t.status !== "done").length}
          </strong>
          <span>Needs an owner</span>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      <div className="panel filters">
        <label>
          Search
          <input
            placeholder="Task or person…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {!projectId && (
          <label>
            Project
            <select
              aria-label="Project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Assigned to
          <select
            aria-label="Assigned to"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="mine">Me</option>
            <option value="all">Everyone</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">Open tasks</option>
            <option value="all">All statuses</option>
            {Object.entries(taskLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due
          <select
            aria-label="Due"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          >
            <option value="">Any date</option>
            <option value="overdue">Overdue</option>
            <option value="soon">Next 7 days</option>
            <option value="none">No date</option>
          </select>
        </label>
      </div>
      <div className="bar">
        <span className="muted">{filtered.length} matching tasks</span>
        <div className="actions">
          <button
            className={view === "list" ? "" : "secondary"}
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            className={view === "board" ? "" : "secondary"}
            onClick={() => setView("board")}
          >
            Board
          </button>
        </div>
      </div>
      {loading ? (
        <p>Loading tasks…</p>
      ) : !filtered.length ? (
        <div className="panel empty">
          No tasks match these filters. Add a task or adjust the filters.
        </div>
      ) : view === "list" ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                {!projectId && <th>Project</th>}
                <th>Assigned to</th>
                <th>Due</th>
                <th>Status</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <button className="text" onClick={() => open(t)}>
                      {t.title}
                    </button>
                    {t.activity_id && (
                      <div className="muted">Linked to schedule</div>
                    )}
                  </td>
                  {!projectId && (
                    <td>
                      <a href={`/projects/${t.project_id}?tab=tasks`}>
                        {projectName(t.project_id)}
                      </a>
                    </td>
                  )}
                  <td>{person(t.assignee_id)}</td>
                  <td className={overdue(t) ? "red" : ""}>
                    {t.due_date || "No date"}
                    {overdue(t) && <div>Overdue</div>}
                  </td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (t.status === "blocked"
                          ? "red"
                          : t.status === "done"
                            ? "green"
                            : "")
                      }
                    >
                      {taskLabels[t.status]}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (["urgent", "high"].includes(t.priority) ? "red" : "")
                      }
                    >
                      {t.priority}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="board">
          {Object.entries(taskLabels).map(([key, label]) => (
            <div className="column" key={key}>
              <strong>
                {label} · {filtered.filter((t) => t.status === key).length}
              </strong>
              {filtered
                .filter((t) => t.status === key)
                .map((t) => (
                  <div className="taskcard" key={t.id}>
                    <button className="text" onClick={() => open(t)}>
                      {t.title}
                    </button>
                    <p>{person(t.assignee_id)}</p>
                    <p className={overdue(t) ? "red" : ""}>
                      {t.due_date || "No due date"}
                      {overdue(t) ? " · Overdue" : ""}
                    </p>
                    <span className="badge">{t.priority}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <div className="modalback">
          <div
            className="drawer"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-editor-title"
          >
            <div className="bar">
              <h2 id="task-editor-title">{isNew ? "New task" : "Edit task"}</h2>
              <button
                className="secondary"
                disabled={busy}
                onClick={closeEditor}
                aria-label="Close task"
              >
                ×
              </button>
            </div>
            {editorError && (
              <p className="notice error" role="alert">
                {editorError}
              </p>
            )}
            <form onSubmit={save}>
              <fieldset
                disabled={busy || editorLoading}
                style={{ border: 0, padding: 0 }}
              >
                <label>
                  Title
                  <input
                    required
                    maxLength={250}
                    value={editing.title}
                    onChange={(e) =>
                      setEditing({ ...editing, title: e.target.value })
                    }
                  />
                </label>
                {isNew && !projectId && (
                  <label>
                    Project
                    <select
                      aria-label="Project"
                      value={editing.project_id}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          project_id: e.target.value,
                          assignee_id: null,
                          activity_id: null,
                        })
                      }
                    >
                      {projects.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.project_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="grid">
                  <label>
                    Assign to
                    <select
                      aria-label="Assign to"
                      value={editing.assignee_id || ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          assignee_id: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {editing.assignee_id &&
                        !team.some((p) => p.id === editing.assignee_id) && (
                          <option value={editing.assignee_id}>
                            Unavailable staff — reassign
                          </option>
                        )}
                      {team.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Due date
                    <input
                      type="date"
                      value={editing.due_date || ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          due_date: e.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Status
                    <select
                      aria-label="Status"
                      value={editing.status}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          status: e.target.value as ProjectTask["status"],
                        })
                      }
                    >
                      {Object.entries(taskLabels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      aria-label="Priority"
                      value={editing.priority}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          priority: e.target.value as ProjectTask["priority"],
                        })
                      }
                    >
                      {["low", "normal", "high", "urgent"].map((p) => (
                        <option value={p} key={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Linked schedule activity
                  <select
                    aria-label="Linked schedule activity"
                    value={editing.activity_id || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        activity_id: e.target.value || null,
                      })
                    }
                  >
                    <option value="">Standalone task</option>
                    {activities.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Details / next action
                  <textarea
                    maxLength={10000}
                    value={editing.description}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                  />
                </label>
                {editing.activity_id && (
                  <p className="notice">
                    Completing this task does not complete an approval or change
                    the linked schedule activity.
                  </p>
                )}
                <div className="bar">
                  <button type="submit">
                    {busy ? "Saving…" : "Save task"}
                  </button>
                  {!isNew && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void remove()}
                    >
                      Delete task
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
            {editorLoading && <p>Loading project team…</p>}
            {!isNew && (
              <div className="panel">
                <h2>Updates & discussion</h2>
                {!comments.length && <p className="muted">No updates yet.</p>}
                {comments.map((c) => (
                  <div className="comment" key={c.id}>
                    <small>
                      {c.author_name} ·{" "}
                      {new Date(c.created_at).toLocaleString()}
                    </small>
                    {c.body}
                  </div>
                ))}
                <label>
                  Add an update
                  <textarea
                    disabled={busy}
                    maxLength={5000}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !comment.trim()}
                  onClick={() => void addComment()}
                >
                  Post update
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
