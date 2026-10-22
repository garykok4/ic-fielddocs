import { Activity, Link, Snapshot, calculate } from "../app/schedule/engine";
import { validDate, shiftDate, isoDay } from "./work-calendar";
export type LookaheadOptions = {
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
  if (daysBetween(o.start, o.end) > 83)
    throw Error("Choose a look-ahead of at most 12 weeks.");
}
export function lookaheadRows(s: Snapshot, o: LookaheadOptions) {
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
  const rows = lookaheadRows(s, o);
  const tasks = rows.filter(
    (t) => o.selected === null || o.selected.includes(t.id),
  );
  return {
    project,
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
