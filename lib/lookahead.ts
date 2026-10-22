import { Activity, Link, Snapshot, calculate } from "../app/schedule/engine";
import { validDate, shiftDate, isoDay } from "./work-calendar";
export type LookaheadOptions = {
  fullProject?: boolean;
  paper?: "letter" | "tabloid";
  layout?: "pages" | "sheet";
  details?: boolean;
  register?: boolean;
  colourBy?: "trade" | "phase";
  start: string;
  end: string;
  format: "gantt" | "calendar";
  phase: string;
  trade: string;
  stage: string;
  customerOnly: boolean;
  milestones: boolean;
  responsible: boolean;
  progress: boolean;
  critical: boolean;
  dependencies: boolean;
  excludeComplete: boolean;
  selected: string[] | null;
};
export type LookaheadReport = {
  phases?: Record<string, string>;
  closures?:string[];
  project: string;
  revision: number;
  issued: string;
  options: LookaheadOptions;
  tasks: Activity[];
  links: Link[];
  hidden: number;
};
export const daysBetween = (a: string, b: string) =>
  Math.round((+isoDay(b) - +isoDay(a)) / 86400000);
export function validateLookahead(o: LookaheadOptions) {
  if (!validDate(o.start) || !validDate(o.end) || o.end < o.start)
    throw Error("Choose valid start and end dates.");
  if (daysBetween(o.start, o.end) > 3652)
    throw Error("Choose a schedule range of at most 10 years.");
}
export function lookaheadRows(s: Snapshot, o: LookaheadOptions) {
  o = resolveLookaheadOptions(s, o);
  validateLookahead(o);
  return calculate(s.tasks, s.links, undefined, s.closures)
    .filter(
      (t) =>
        t.item_type === "task" &&
        t.start <= o.end &&
        t.finish >= o.start &&
        (!o.phase || t.parent_id === o.phase) &&
        (!o.trade || t.trade === o.trade) &&
        (!o.stage || (t.stage || "construction") === o.stage) &&
        (!o.customerOnly || t.customer_visible === true) &&
        (o.milestones || !t.is_milestone) &&
        (!o.excludeComplete || t.status !== "complete"),
    )
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.start.localeCompare(b.start) ||
        a.name.localeCompare(b.name),
    );
}
export function buildLookahead(
  project: string,
  s: Snapshot,
  o: LookaheadOptions,
): LookaheadReport {
  o = resolveLookaheadOptions(s, o);
  const rows = lookaheadRows(s, o);
  const tasks = rows.filter(
    (t) => o.selected === null || o.selected.includes(t.id),
  );
  return {
    project,
    phases: Object.fromEntries(s.tasks.filter(t => t.item_type === "phase").map(t => [t.id, t.name])),
    revision: s.revision,
    closures: s.closures || [],
    issued: new Date().toISOString(),
    options: { ...o },
    tasks,
    links: s.links.filter(
      (l) =>
        tasks.some((t) => t.id === l.successor_id) &&
        tasks.some((t) => t.id === l.predecessor_id),
    ),
    hidden: s.tasks.filter((t) => t.item_type === "task").length - tasks.length,
  };
}
export const weeksFrom = (start: string, weeks: number) =>
  validDate(start) && Number.isInteger(weeks) && weeks > 0 && weeks <= 12
    ? shiftDate(start, weeks * 7 - 1)
    : "";

// Resolve against the complete calculated schedule, before visibility/selection filters.
export function resolveLookaheadOptions(s: Snapshot, o: LookaheadOptions): LookaheadOptions {
  if (!o.fullProject) return o;
  const tasks = calculate(s.tasks, s.links, undefined, s.closures).filter(t => t.item_type === "task");
  if (!tasks.length) return o;
  return {...o, start: tasks.reduce((a,t) => t.start < a ? t.start : a, tasks[0].start),
    end: tasks.reduce((a,t) => t.finish > a ? t.finish : a, tasks[0].finish)};
}
