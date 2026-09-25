import { Task, Link, Snapshot, normalize } from "./engine";
export function addPreconstructionTemplate(
  snapshot: Snapshot,
  project: string,
  start: string,
  variance: boolean,
  connectConstruction = false,
): Snapshot {
  const phase = crypto.randomUUID();
  const base: Task = {
    id: phase,
    project_id: project,
    name: "Preconstruction & approvals",
    trade: null,
    start_date: normalize(start),
    duration_work_days: 0,
    progress: 0,
    status: "not_started",
    is_milestone: false,
    sort_order: snapshot.tasks.length,
    notes:
      "Planning allowances only. Confirm scope, sequence, and review times with the project team.",
    item_type: "phase",
    parent_id: null,
    stage: "preconstruction",
    responsible_party: "Project manager",
    waiting_on: "",
    date_confidence: "estimated",
    customer_visible: true,
  };
  const specs: [string, number, string, boolean][] = [
    [
      "Confirm scope & approval requirements",
      5,
      "Owner / project manager",
      false,
    ],
    ["Survey, investigations & concept design", 15, "Consultants", false],
    [
      "Prepare & submit site plan application",
      20,
      "Planner / civil consultant",
      false,
    ],
    [
      "Site plan review & resubmissions",
      40,
      "Municipality / consultants",
      false,
    ],
    ["Site plan approval", 0, "Municipality", true],
    ["Detailed architectural & engineering drawings", 25, "Design team", false],
    ["Prepare & submit building permit", 5, "Design team", false],
    [
      "Permit review & responses",
      20,
      "Building department / design team",
      false,
    ],
    ["Building permit issued", 0, "Building department", true],
    ["Tender & trade pricing", 15, "Estimator", false],
    [
      "Award trades & confirm procurement",
      10,
      "Owner / project manager",
      false,
    ],
    ["Ready to mobilize", 0, "Project manager", true],
  ];
  if (variance)
    specs.push(
      ["Prepare & submit minor variance", 10, "Planner", false],
      [
        "Minor variance review / decision / conditions",
        30,
        "Approval authority",
        false,
      ],
    );
  const tasks = specs.map(
    ([name, duration, responsible, milestone], i): Task => ({
      ...base,
      id: crypto.randomUUID(),
      name,
      duration_work_days: duration,
      responsible_party: responsible,
      is_milestone: milestone,
      item_type: "task",
      parent_id: phase,
      sort_order: base.sort_order + i + 1,
      notes: "",
    }),
  );
  // Parallel design and approval streams; the final gate waits for approvals AND procurement.
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [1, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [5, 9],
    [9, 10],
    [4, 11],
    [8, 11],
    [10, 11],
  ];
  if (variance) edges.push([1, 12], [12, 13], [13, 4]);
  const links: Link[] = edges.map(([a, b]) => ({
    id: crypto.randomUUID(),
    project_id: project,
    predecessor_id: tasks[a].id,
    successor_id: tasks[b].id,
    lag_work_days: 0,
  }));
  if (connectConstruction) {
    for (const task of snapshot.tasks.filter(
      (t) =>
        t.item_type === "task" &&
        (t.stage || "construction") === "construction" &&
        t.status !== "complete" &&
        !snapshot.links.some((link) => link.successor_id === t.id),
    )) {
      links.push({
        id: crypto.randomUUID(),
        project_id: project,
        predecessor_id: tasks[11].id,
        successor_id: task.id,
        lag_work_days: 0,
      });
    }
  }
  return {
    ...snapshot,
    tasks: [...snapshot.tasks, base, ...tasks],
    links: [...snapshot.links, ...links],
  };
}
