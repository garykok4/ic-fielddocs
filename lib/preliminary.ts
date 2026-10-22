import { calculateFee, DEFAULT_INPUTS, FeeBand } from "./fee-calculator";
export const PRELIM_VERSION = "class-d-v1";
export const FIELDS = [
  ["footprint", "Building footprint", "sf", 10000, 1e8],
  ["floors", "Above-grade storeys", "count", 1, 100],
  ["height", "Height per storey", "ft", 16, 200],
  ["perimeter", "Building perimeter (0 = square footprint)", "ft", 0, 1e6],
  ["basementArea", "Basement area (0 = none)", "sf", 0, 1e8],
  ["basementHeight", "Basement wall height", "ft", 9, 100],
  ["wallThickness", "Foundation wall thickness", "in", 10, 120],
  ["footingWidth", "Strip footing width", "in", 24, 240],
  ["footingDepth", "Strip footing thickness", "in", 12, 120],
  ["slabThickness", "Ground slab thickness", "in", 6, 120],
  ["basementSlab", "Basement slab thickness", "in", 4, 120],
  ["upperSlab", "Upper concrete floor thickness", "in", 6, 120],
  ["doors", "Exterior personnel doors", "count", 4, 10000],
  ["doorArea", "Average exterior door area", "sf", 21, 10000],
  ["overheadDoors", "Overhead doors", "count", 1, 10000],
  ["overheadArea", "Average overhead door area", "sf", 144, 10000],
  ["windows", "Windows", "count", 10, 10000],
  ["windowArea", "Average window area", "sf", 20, 10000],
  ["roofFactor", "Roof area / footprint multiplier", "factor", 1.05, 10],
  ["partitionLength", "Interior partitions", "lf", 200, 1e7],
  ["interiorDoors", "Interior doors", "count", 8, 10000],
  ["washrooms", "Washroom groups", "count", 2, 1000],
  ["stairs", "Stair flights", "count", 0, 1000],
  ["elevators", "Elevators", "count", 0, 100],
  ["paving", "Paving", "sf", 5000, 1e9],
  ["landscape", "Landscaping", "sf", 1000, 1e9],
  ["waterLength", "Water service", "lf", 100, 1e7],
  ["sanitaryLength", "Sanitary service", "lf", 100, 1e7],
  ["stormLength", "Storm service", "lf", 100, 1e7],
  [
    "engineeringPct",
    "Engineering allowance",
    "% of direct construction",
    4,
    100,
  ],
  [
    "architectPct",
    "Architectural allowance",
    "% of direct construction",
    3,
    100,
  ],
  [
    "contingencyPct",
    "Design / construction contingency",
    "% of direct construction",
    20,
    100,
  ],
  ["rangePct", "Planning range +/-", "% of total budget", 20, 100],
  ["months", "Project duration", "months", 12, 1200],
  ["supervisorAnnual", "Annual supervision cost", "CAD", 100000, 1e8],
  ["allocation", "Supervisor allocation", "%", 100, 100],
  ["trailerMonthly", "Trailer monthly cost", "CAD", 1500, 1e7],
  ["trailerSetup", "Trailer setup", "CAD", 0, 1e9],
] as const;
export type FieldKey = (typeof FIELDS)[number][0];
export type BudgetInputs = Record<FieldKey, number> & {
  structure: string;
  cladding: string;
  roofStructure: string;
  roofFinish: string;
  upperFloor: string;
  servicing: boolean;
  sprinklers: boolean;
  trailer: boolean;
  basement: boolean;
};
export const OPTIONS = {
  structure: [
    "Steel frame",
    "Wood frame",
    "Concrete frame",
    "Loadbearing masonry",
  ],
  cladding: [
    "Insulated metal panels",
    "Metal siding",
    "Brick veneer",
    "Regular clay brick veneer",
    "Precast panels",
    "Mixed / custom",
  ],
  roofStructure: [
    "Steel deck and joists",
    "Steel beams and purlins",
    "Wood trusses",
    "Concrete roof",
    "Custom",
  ],
  roofFinish: [
    "Single-ply membrane",
    "Insulated metal panel (IMP) roof",
    "Metal roofing",
    "Modified bitumen",
    "Shingles",
  ],
  upperFloor: ["Concrete slab", "Composite / timber assembly"],
} as const;
export const defaultBudgetInputs = (): BudgetInputs =>
  ({
    ...Object.fromEntries(FIELDS.map(([k, , , v]) => [k, v])),
    structure: "Steel frame",
    cladding: "Insulated metal panels",
    roofStructure: "Steel deck and joists",
    roofFinish: "Single-ply membrane",
    upperFloor: "Concrete slab",
    servicing: true,
    sprinklers: true,
    trailer: true,
    basement: false,
  }) as BudgetInputs;
export type LineEdit = {
  rate: number | null;
  quantity: number | null;
  excluded: boolean;
  source: string;
  notes: string;
};
export type BudgetDraft = {
  feeBands?: FeeBand[];
  version: string;
  inputs: BudgetInputs;
  lines: Record<string, LineEdit>;
  notes: string;
};
export type SavedBudget = {
  id: string;
  name: string;
  project_id: string | null;
  revision: number;
  draft: BudgetDraft;
  updated_at: string;
};
export const newBudget = (): BudgetDraft => ({
  version: PRELIM_VERSION,
  inputs: defaultBudgetInputs(),
  lines: {},
  notes: "",
});
export type LineDefinition = {
  id: string;
  group: string;
  name: string;
  unit: string;
  qty: (i: BudgetInputs) => number;
  formula: (ref: (k: FieldKey) => string, i: BudgetInputs) => string;
  scope: string;
};
const volume = 35.3146667;
const per = (i: BudgetInputs) => i.perimeter || Math.sqrt(i.footprint) * 4;
const p = (r: (k: FieldKey) => string) =>
  `IF(${r("perimeter")}>0,${r("perimeter")},SQRT(${r("footprint")})*4)`;
const total = (i: BudgetInputs) =>
  i.footprint * i.floors + (i.basement ? i.basementArea : 0);
const area = (r: (k: FieldKey) => string, i: BudgetInputs) =>
  `${r("footprint")}*${r("floors")}+${i.basement ? r("basementArea") : "0"}`;
const unit = (
  id: string,
  group: string,
  name: string,
  scope: string,
): LineDefinition => ({
  id,
  group,
  name,
  scope,
  unit: "allowance",
  qty: () => 1,
  formula: () => "1",
});
const field = (
  id: string,
  group: string,
  name: string,
  key: FieldKey,
  units: string,
  scope: string,
): LineDefinition => ({
  id,
  group,
  name,
  scope,
  unit: units,
  qty: (i) => i[key],
  formula: (r) => r(key),
});
const floor = (
  id: string,
  group: string,
  name: string,
  scope: string,
): LineDefinition => ({
  id,
  group,
  name,
  scope,
  unit: "sf",
  qty: total,
  formula: area,
});
export const LINES: LineDefinition[] = [
  unit(
    "mobilization",
    "01 General",
    "Mobilization / temporary works",
    "Exclude supervision and trailer, which are added separately.",
  ),
  unit(
    "demolition",
    "02 Site preparation",
    "Demolition / removals",
    "Include only known demolition scope; review hazardous materials separately.",
  ),
  unit(
    "earthwork",
    "02 Site preparation",
    "Bulk excavation, fill and disposal",
    "Allowance: geotechnical conditions, cut/fill and disposal require review.",
  ),
  {
    id: "footings",
    group: "03 Concrete",
    name: "Strip footing concrete",
    unit: "m3",
    qty: (i) =>
      (((per(i) * i.footingWidth) / 12) * i.footingDepth) / 12 / volume,
    formula: (r) =>
      `${p(r)}*${r("footingWidth")}/12*${r("footingDepth")}/12/${volume}`,
    scope:
      "Perimeter strip footings only; installed rate includes reinforcing and forms. Add column pads separately.",
  },
  unit(
    "pads",
    "03 Concrete",
    "Column pads, piles / special foundations",
    "Allowance for foundations not captured by perimeter strip footings.",
  ),
  {
    id: "foundationwalls",
    group: "03 Concrete",
    name: "Foundation wall concrete",
    unit: "m3",
    qty: (i) =>
      (per(i) * (i.basement ? i.basementHeight : 4) * i.wallThickness) /
      12 /
      volume,
    formula: (r, i) =>
      `${p(r)}*${i.basement ? r("basementHeight") : "4"}*${r("wallThickness")}/12/${volume}`,
    scope:
      "4 ft high allowance without basement; basement assumes full perimeter. Override quantity for partial basement. Installed rate includes steel/forms.",
  },
  {
    id: "groundslab",
    group: "03 Concrete",
    name: "Ground-bearing slab concrete",
    unit: "m3",
    qty: (i) =>
      (Math.max(0, i.footprint - (i.basement ? i.basementArea : 0)) *
        i.slabThickness) /
      12 /
      volume,
    formula: (r, i) =>
      `MAX(0,${r("footprint")}-${i.basement ? r("basementArea") : "0"})*${r("slabThickness")}/12/${volume}`,
    scope:
      "Excludes basement footprint, where suspended floor is counted below. Installed concrete/steel/finish; granular base separate.",
  },
  {
    id: "basementslab",
    group: "03 Concrete",
    name: "Basement slab concrete",
    unit: "m3",
    qty: (i) =>
      i.basement ? (i.basementArea * i.basementSlab) / 12 / volume : 0,
    formula: (r, i) =>
      i.basement
        ? `${r("basementArea")}*${r("basementSlab")}/12/${volume}`
        : "0",
    scope: "Installed concrete, reinforcing and finishing.",
  },
  {
    id: "slabbase",
    group: "03 Concrete",
    name: "Slab base / vapour barrier / insulation",
    unit: "sf",
    qty: (i) => i.footprint,
    formula: (r) => r("footprint"),
    scope:
      "Ground and basement slab footprint. Installed subbase, vapour barrier and applicable underslab insulation; exclude from concrete rates.",
  },
  {
    id: "waterproofing",
    group: "03 Concrete",
    name: "Basement waterproofing / drainage",
    unit: "sf",
    qty: (i) => (i.basement ? per(i) * i.basementHeight : 0),
    formula: (r, i) => (i.basement ? `${p(r)}*${r("basementHeight")}` : "0"),
    scope:
      "Basement wall waterproofing, protection and perimeter drainage allowance. Override for partial basements.",
  },
  {
    id: "upperfloor",
    group: "04 Structure",
    name: "Suspended floors",
    unit: "sf",
    qty: (i) =>
      i.footprint * (i.floors - 1) + (i.basement ? i.basementArea : 0),
    formula: (r, i) =>
      `${r("footprint")}*(${r("floors")}-1)+${i.basement ? r("basementArea") : "0"}`,
    scope:
      "Floor assembly excludes concrete topping, which is separately counted only for concrete floor selection.",
  },
  {
    id: "upperconcrete",
    group: "03 Concrete",
    name: "Suspended floor concrete",
    unit: "m3",
    qty: (i) =>
      i.upperFloor === "Concrete slab"
        ? ((i.footprint * (i.floors - 1) + (i.basement ? i.basementArea : 0)) *
            i.upperSlab) /
          12 /
          volume
        : 0,
    formula: (r, i) =>
      i.upperFloor === "Concrete slab"
        ? `(${r("footprint")}*(${r("floors")}-1)+${i.basement ? r("basementArea") : "0"})*${r("upperSlab")}/12/${volume}`
        : "0",
    scope:
      "Installed concrete topping/slab; structural support priced under suspended floors.",
  },
  {
    id: "structure",
    group: "04 Structure",
    name: "Above-grade structural frame",
    unit: "sf",
    qty: (i) => i.footprint * i.floors,
    formula: (r) => `${r("footprint")}*${r("floors")}`,
    scope:
      "Above-grade floor area only. Frame excludes foundations, floors, roof structure and cladding.",
  },
  field(
    "stairs",
    "04 Structure",
    "Stairs",
    "stairs",
    "flight",
    "Installed flights, guards and handrails.",
  ),
  field(
    "elevators",
    "04 Structure",
    "Elevators",
    "elevators",
    "each",
    "Installed allowance including controls; shaft structure separate.",
  ),
  {
    id: "cladding",
    group: "05 Envelope",
    name: "Exterior wall / cladding assembly",
    unit: "sf",
    qty: (i) =>
      Math.max(
        0,
        per(i) * i.height * i.floors -
          i.doors * i.doorArea -
          i.overheadDoors * i.overheadArea -
          i.windows * i.windowArea,
      ),
    formula: (r) =>
      `MAX(0,${p(r)}*${r("height")}*${r("floors")}-${r("doors")}*${r("doorArea")}-${r("overheadDoors")}*${r("overheadArea")}-${r("windows")}*${r("windowArea")})`,
    scope:
      "Complete installed wall assembly including insulation, air barrier and backing; no separate insulation line.",
  },
  {
    id: "roofstructure",
    group: "05 Envelope",
    name: "Roof structure",
    unit: "sf",
    qty: (i) => i.footprint * i.roofFactor,
    formula: (r) => `${r("footprint")}*${r("roofFactor")}`,
    scope: "Installed structural roof only; excludes roof finish/insulation.",
  },
  {
    id: "roofing",
    group: "05 Envelope",
    name: "Roof finish and insulation",
    unit: "sf",
    qty: (i) => i.footprint * i.roofFactor,
    formula: (r) => `${r("footprint")}*${r("roofFactor")}`,
    scope:
      "Complete installed roof weatherproofing/insulation, flashings and drainage allowance.",
  },
  field(
    "doors",
    "06 Openings",
    "Exterior personnel doors",
    "doors",
    "each",
    "Complete installed assemblies and hardware.",
  ),
  field(
    "overhead",
    "06 Openings",
    "Overhead doors",
    "overheadDoors",
    "each",
    "Complete installed assemblies/operators.",
  ),
  {
    id: "windows",
    group: "06 Openings",
    name: "Windows / glazing",
    unit: "sf",
    qty: (i) => i.windows * i.windowArea,
    formula: (r) => `${r("windows")}*${r("windowArea")}`,
    scope:
      "Installed glazing and frames. Average opening dimensions need review.",
  },
  {
    id: "partitions",
    group: "07 Interiors",
    name: "Interior partition assemblies",
    unit: "sf",
    qty: (i) => i.partitionLength * i.height,
    formula: (r) => `${r("partitionLength")}*${r("height")}`,
    scope:
      "One elevation area; complete partition both faces including framing, board and paint.",
  },
  field(
    "interiordoors",
    "07 Interiors",
    "Interior doors",
    "interiorDoors",
    "each",
    "Complete installed assemblies/hardware.",
  ),
  floor(
    "finishes",
    "07 Interiors",
    "Floor and ceiling finishes",
    "Average complete floor/ceiling allowance. Excludes partition finishes.",
  ),
  unit(
    "millwork",
    "07 Interiors",
    "Millwork / specialties",
    "Allowance for cabinets, signage, accessories and specialty fit-out.",
  ),
  floor(
    "hvac",
    "08 Services",
    "HVAC",
    "Complete system allowance. Process cooling/heating separate.",
  ),
  floor(
    "electrical",
    "08 Services",
    "Electrical / lighting / low voltage",
    "Complete building systems; incoming utility fees and specialty equipment separate.",
  ),
  field(
    "plumbing",
    "08 Services",
    "Plumbing / washroom groups",
    "washrooms",
    "group",
    "Building plumbing and fixtures allowance; external service separate.",
  ),
  {
    id: "sprinklers",
    group: "08 Services",
    name: "Fire sprinklers / life safety",
    unit: "sf",
    qty: (i) => (i.sprinklers ? total(i) : 0),
    formula: (r, i) => (i.sprinklers ? area(r, i) : "0"),
    scope:
      "Typical installed building protection allowance; pump/tank/fire-water supply separate.",
  },
  unit(
    "firewater",
    "08 Services",
    "Fire pump / tank / special systems",
    "Allowance based on actual water and protection requirements.",
  ),
  unit(
    "equipment",
    "08 Services",
    "Process / owner equipment",
    "Specify included contractor-supplied equipment; explicitly exclude owner scope if appropriate.",
  ),
  ...(["waterLength", "sanitaryLength", "stormLength"] as FieldKey[]).map(
    (key, index) => ({
      id: ["water", "sanitary", "storm"][index],
      group: "09 Site works",
      name: ["Water servicing", "Sanitary servicing", "Storm servicing"][index],
      unit: "lf",
      qty: (i: BudgetInputs) => (i.servicing ? i[key] : 0),
      formula: (r: (k: FieldKey) => string, i: BudgetInputs) =>
        i.servicing ? r(key) : "0",
      scope:
        "Installed pipe and trench allowance; structures/connections priced separately.",
    }),
  ),
  unit(
    "connections",
    "09 Site works",
    "Connections, structures and utility charges",
    "Include manholes, stormwater facilities, taps, transformers and provider charges as applicable.",
  ),
  field(
    "paving",
    "09 Site works",
    "Paving / base",
    "paving",
    "sf",
    "Complete pavement and granular base.",
  ),
  field(
    "landscape",
    "09 Site works",
    "Landscaping",
    "landscape",
    "sf",
    "Topsoil/seed/planting allowance.",
  ),
  unit(
    "exterior",
    "09 Site works",
    "Curbs / fencing / exterior works",
    "Include exterior items not captured by paving or landscaping.",
  ),
  unit(
    "testing",
    "10 Other construction",
    "Testing / commissioning",
    "Third-party testing and commissioning allowance.",
  ),
  unit(
    "permits",
    "10 Other construction",
    "Permits / development charges",
    "Project-specific allowance; confirm municipality and exclusions.",
  ),
  unit(
    "other",
    "10 Other construction",
    "Other project-specific work",
    "Record any scope not covered above.",
  ),
];
export function validateBudget(d: BudgetDraft) {
  if (!d || !d.inputs || !d.lines || Array.isArray(d.lines))
    throw Error("Invalid budget draft.");
  if (d.version !== PRELIM_VERSION)
    throw Error("Unsupported estimate version.");
  for (const [key, label, , , max] of FIELDS) {
    const n = d.inputs[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max)
      throw Error(
        `${label}: enter a number between 0 and ${max.toLocaleString()}.`,
      );
  }
  if (
    d.inputs.footprint <= 0 ||
    d.inputs.floors < 1 ||
    !Number.isInteger(d.inputs.floors)
  )
    throw Error("Enter a positive footprint and whole number of storeys.");
  if (
    d.inputs.basement &&
    (d.inputs.basementArea <= 0 || d.inputs.basementArea > d.inputs.footprint)
  )
    throw Error(
      "Basement area must be positive and no larger than the footprint.",
    );
  for (const key of [
    "doors",
    "overheadDoors",
    "windows",
    "interiorDoors",
    "washrooms",
    "stairs",
    "elevators",
  ] as FieldKey[])
    if (!Number.isInteger(d.inputs[key]))
      throw Error("Door, window and equipment counts must be whole numbers.");
  for (const key of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[])
    if (!(OPTIONS[key] as readonly string[]).includes(d.inputs[key]))
      throw Error("Choose a valid construction assembly.");
  for (const key of ["basement", "servicing", "sprinklers", "trailer"] as const)
    if (typeof d.inputs[key] !== "boolean")
      throw Error("Choose the applicable scope options.");
  for (const [id, edit] of Object.entries(d.lines)) {
    if (!LINES.some((line) => line.id === id) || !edit)
      throw Error("Unknown budget line.");
    for (const key of ["quantity", "rate"] as const)
      if (
        edit[key] !== null &&
        (!Number.isFinite(edit[key]) || edit[key]! < 0 || edit[key]! > 1e12)
      )
        throw Error(
          "Quantities and rates must be non-negative finite numbers.",
        );
    if (
      typeof edit.excluded !== "boolean" ||
      typeof edit.source !== "string" ||
      typeof edit.notes !== "string" ||
      edit.source.length > 500 ||
      edit.notes.length > 2000
    )
      throw Error("Invalid line details.");
  }
  if (typeof d.notes !== "string" || d.notes.length > 20000)
    throw Error("Notes must be at most 20,000 characters.");
}
export function estimateBudget(d: BudgetDraft) {
  validateBudget(d);
  const rows = LINES.map((def) => {
    const e = d.lines[def.id] || {
      rate: null,
      quantity: null,
      excluded: false,
      source: "",
      notes: "",
    };
    const auto = def.qty(d.inputs);
    const quantity = e.quantity ?? auto;
    const missing = !e.excluded && quantity > 0 && e.rate === null;
    return {
      ...def,
      ...e,
      auto,
      quantity,
      missing,
      amount: e.excluded ? 0 : quantity * (e.rate ?? 0),
    };
  });
  const direct = rows.reduce((sum, r) => sum + r.amount, 0);
  const i = d.inputs,
    engineering = (direct * i.engineeringPct) / 100,
    architect = (direct * i.architectPct) / 100,
    contingency = (direct * i.contingencyPct) / 100,
    eligible = direct + contingency;
  const fee = calculateFee(
    {
      ...DEFAULT_INPUTS,
      bands: d.feeBands,
      constructionCost: eligible,
      projectMonths: i.months,
      supervisorAnnualCost: i.supervisorAnnual,
      supervisorAllocation: i.allocation,
      trailerRequired: i.trailer,
      trailerMonthlyCost: i.trailerMonthly,
      trailerSetup: i.trailerSetup,
    },
    d.feeBands ? "scheps-v3" : "scheps-v2",
  );
  const budget = eligible + engineering + architect + fee.combinedCharge;
  return {
    rows,
    direct,
    engineering,
    architect,
    contingency,
    eligible,
    fee,
    budget,
    low: budget * (1 - i.rangePct / 100),
    high: budget * (1 + i.rangePct / 100),
    area: total(i),
    missing: rows.filter((r) => r.missing).length,
  };
}
