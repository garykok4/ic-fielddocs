export type Status = "not_started" | "in_progress" | "complete" | "on_hold";
export type Task = {
  id: string;
  project_id: string;
  name: string;
  trade: string | null;
  start_date: string;
  duration_work_days: number;
  progress: number;
  status: Status;
  is_milestone: boolean;
  sort_order: number;
  notes: string | null;
  item_type: "task" | "phase";
  parent_id: string | null;
  stage?: "construction" | "preconstruction";
  responsible_party?: string | null;
  waiting_on?: string | null;
  date_confidence?: "estimated" | "confirmed";
  customer_visible?: boolean;
};
export type Link = {
  id: string;
  project_id: string;
  predecessor_id: string;
  successor_id: string;
  lag_work_days: number;
};
export type Baseline = {
  name: string;
  saved_at: string;
  dates: Record<string, { start: string; finish: string; name: string }>;
} | null;
export type Snapshot = {
  revision: number;
  tasks: Task[];
  links: Link[];
  baseline: Baseline;
};
export type Activity = Task & {
  start: string;
  finish: string;
  float: number;
  critical: boolean;
  controlling: string[];
  overdue: boolean;
};
export const labels: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  on_hold: "On hold",
};
export const day = (s: string) => new Date(s + "T00:00:00Z");
export const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const shift = (s: string, n: number) =>
  fmt(new Date(+day(s) + n * 86400000));
export const distance = (a: string, b: string) =>
  Math.round((+day(b) - +day(a)) / 86400000);
export const work = (s: string) => ![0, 6].includes(day(s).getUTCDay());
export function normalize(s: string) {
  while (!work(s)) s = shift(s, 1);
  return s;
}
export function addWork(s: string, n: number) {
  const dir = n < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(n);) {
    s = shift(s, dir);
    if (work(s)) i++;
  }
  return s;
}
export function workDistance(a: string, b: string): number {
  if (a > b) return -workDistance(b, a);
  let n = 0;
  while (a < b) {
    a = shift(a, 1);
    if (work(a)) n++;
  }
  return n;
}
export const finish = (s: string, n: number) => addWork(s, Math.max(0, n - 1));
export const durationTo = (s: string, f: string) =>
  Math.max(1, workDistance(s, f) + 1);
export function cycle(links: Link[]) {
  const open = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string): boolean => {
    if (open.has(id)) return true;
    if (done.has(id)) return false;
    open.add(id);
    for (const l of links.filter((l) => l.predecessor_id === id))
      if (visit(l.successor_id)) return true;
    open.delete(id);
    done.add(id);
    return false;
  };
  return links.some((l) => visit(l.predecessor_id));
}
export function validate(tasks: Task[], links: Link[]) {
  const ids = new Map(tasks.map((t) => [t.id, t]));
  if (ids.size !== tasks.length) throw Error("Duplicate activity ID.");
  for (const t of tasks) {
    if (!t.name.trim()) throw Error("Enter an activity name.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(t.start_date) ||
      isNaN(+day(t.start_date)) ||
      fmt(day(t.start_date)) !== t.start_date
    )
      throw Error("Enter a valid date.");
    if (
      !Number.isInteger(t.duration_work_days) ||
      t.duration_work_days < 0 ||
      (!t.is_milestone && t.item_type === "task" && t.duration_work_days < 1) ||
      t.duration_work_days > 10000
    )
      throw Error("Duration must be 1–10,000 whole work days.");
    if (!Number.isInteger(t.progress) || t.progress < 0 || t.progress > 100)
      throw Error("Progress must be a whole percentage from 0 to 100.");
    if (
      t.parent_id &&
      (t.item_type === "phase" || ids.get(t.parent_id)?.item_type !== "phase")
    )
      throw Error("Choose a valid phase.");
  }
  const pairs = new Set<string>();
  for (const l of links) {
    if (
      ids.get(l.predecessor_id)?.item_type !== "task" ||
      ids.get(l.successor_id)?.item_type !== "task"
    )
      throw Error("Dependencies must connect activities in this project.");
    if (
      !Number.isInteger(l.lag_work_days) ||
      l.lag_work_days < 0 ||
      l.lag_work_days > 10000
    )
      throw Error("Lag must be 0–10,000 whole work days.");
    const k = l.predecessor_id + ":" + l.successor_id;
    if (pairs.has(k)) throw Error("A predecessor appears more than once.");
    pairs.add(k);
  }
  if (cycle(links))
    throw Error(
      "That dependency creates a circular chain. Remove a link and try again.",
    );
}
export function calculate(
  tasks: Task[],
  links: Link[],
  asOf = today(),
): Activity[] {
  validate(tasks, links);
  const map = new Map(
      tasks.filter((t) => t.item_type === "task").map((t) => [t.id, t]),
    ),
    out = new Map<string, Activity>(),
    order: string[] = [];
  function forward(id: string): Activity {
    if (out.has(id)) return out.get(id)!;
    const t = map.get(id)!;
    let start = normalize(t.start_date);
    const incoming = links.filter((l) => l.successor_id === id);
    for (const l of incoming) {
      const c = addWork(forward(l.predecessor_id).finish, 1 + l.lag_work_days);
      if (c > start) start = c;
    }
    const end = finish(start, t.duration_work_days);
    const a = {
      ...t,
      start,
      finish: end,
      float: 0,
      critical: false,
      controlling: incoming
        .filter(
          (l) =>
            addWork(out.get(l.predecessor_id)!.finish, 1 + l.lag_work_days) ===
            start,
        )
        .map((l) => l.predecessor_id),
      overdue: end < asOf && t.status !== "complete",
    };
    out.set(id, a);
    order.push(id);
    return a;
  }
  for (const id of map.keys()) forward(id);
  const projectFinish = [...out.values()]
    .map((t) => t.finish)
    .sort()
    .slice(-1)[0];
  const late = new Map<string, string>();
  for (const id of [...order].reverse()) {
    const t = out.get(id)!;
    let lf = projectFinish!;
    for (const l of links.filter((l) => l.predecessor_id === id)) {
      const s = out.get(l.successor_id)!;
      const ls = addWork(
        late.get(s.id)!,
        -Math.max(0, s.duration_work_days - 1),
      );
      const candidate = addWork(ls, -1 - l.lag_work_days);
      if (candidate < lf) lf = candidate;
    }
    late.set(id, lf);
    t.float = workDistance(t.finish, lf);
    t.critical = t.float === 0;
  }
  const phases = tasks
    .filter((t) => t.item_type === "phase")
    .map((t) => {
      const children = [...out.values()].filter((c) => c.parent_id === t.id);
      const starts = children.map((c) => c.start).sort(),
        ends = children.map((c) => c.finish).sort();
      const weight = children.reduce(
        (s, c) => s + Math.max(1, c.duration_work_days),
        0,
      );
      const progress = weight
        ? Math.round(
            children.reduce(
              (s, c) => s + c.progress * Math.max(1, c.duration_work_days),
              0,
            ) / weight,
          )
        : 0;
      return {
        ...t,
        start: starts[0] || normalize(t.start_date),
        finish: ends.slice(-1)[0] || normalize(t.start_date),
        progress,
        status: (children.length &&
        children.every((c) => c.status === "complete")
          ? "complete"
          : progress > 0
            ? "in_progress"
            : "not_started") as Status,
        float: children.length ? Math.min(...children.map((c) => c.float)) : 0,
        critical: children.some((c) => c.critical),
        controlling: [],
        overdue: children.some((c) => c.overdue),
      };
    });
  return [...phases, ...out.values()];
}
export function normalizeProgress(t: Task, patch: Partial<Task>): Task {
  const x = { ...t, ...patch };
  if (patch.status === "complete") x.progress = 100;
  else if (patch.status === "not_started") x.progress = 0;
  else if (patch.status && x.progress === 100) x.progress = 99;
  if (patch.progress !== undefined) {
    if (x.progress === 100) x.status = "complete";
    else if (x.progress === 0 && x.status !== "on_hold")
      x.status = "not_started";
    else if (x.status !== "on_hold") x.status = "in_progress";
  }
  return x;
}
export function lanes(rows: Activity[], start: string, end: string) {
  const placed: { task: Activity; from: number; span: number; lane: number }[] =
    [];
  const occupied: number[] = [];
  for (const t of [...rows]
    .filter((t) => t.start <= end && t.finish >= start)
    .sort(
      (a, b) => a.start.localeCompare(b.start) || a.sort_order - b.sort_order,
    )) {
    const from = Math.max(0, distance(start, t.start)),
      last = Math.min(6, distance(start, t.finish));
    let lane = occupied.findIndex((x) => x < from);
    if (lane < 0) lane = occupied.length;
    occupied[lane] = last;
    placed.push({ task: t, from, span: last - from + 1, lane });
  }
  return placed;
}
