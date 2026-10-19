import { BudgetDraft, FIELDS, FieldKey, estimateBudget } from "./preliminary";
export async function buildBudgetWorkbook(
  name: string,
  project: string,
  draft: BudgetDraft,
) {
  const Excel = await import("exceljs");
  const Workbook = Excel.Workbook || Excel.default.Workbook;
  const wb = new Workbook();
  wb.creator = "I/C Construction - Field Docs";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const summary = wb.addWorksheet("Budget summary"),
    detail = wb.addWorksheet("Trade detail"),
    assumptions = wb.addWorksheet("Assumptions");
  const result = estimateBudget(draft);
  const inputRows = {} as Record<FieldKey, number>;
  const navy = "FF183C40",
    blue = "FF1664C0",
    orange = "FFF97316";
  for (const sheet of [summary, detail, assumptions]) {
    sheet.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
    sheet.properties.defaultRowHeight = 21;
    sheet.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    sheet.headerFooter.oddFooter =
      "&L I/C Construction&C Preliminary budget&R Page &P of &N";
  }
  function heading(s: typeof summary, title: string, last = "D") {
    s.mergeCells(`A1:${last}1`);
    s.getCell("A1").value = title;
    s.getCell("A1").font = {
      size: 20,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    s.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: navy },
    };
    s.getRow(1).height = 36;
    s.mergeCells(`A2:${last}2`);
    s.getCell("A2").value =
      `${name} | ${project || "Standalone estimate"} | CAD before HST`;
    s.getRow(2).height = 30;
    s.getCell("A2").alignment = { wrapText: true };
  }
  const formula = (
    s: typeof summary,
    cell: string,
    expression: string,
    value: number | string,
  ) => {
    s.getCell(cell).value = { formula: expression, result: value };
  };
  heading(assumptions, "BUDGET ASSUMPTIONS");
  assumptions.columns = [
    { width: 55 },
    { width: 24 },
    { width: 28 },
    { width: 70 },
  ];
  assumptions.getRow(4).values = ["INPUT", "VALUE", "UNIT", "GUIDANCE"];
  FIELDS.forEach(([key, label, unit, , maximum], index) => {
    const row = index + 6;
    inputRows[key] = row;
    assumptions.getRow(row).values = [
      label,
      draft.inputs[key],
      unit,
      "Editable driver",
    ];
    assumptions.getCell(row, 2).numFmt = "#,##0.00";
    assumptions.getCell(row, 2).font = { color: { argb: blue } };
    assumptions.getCell(row, 2).dataValidation = {
      type: [
        "floors",
        "doors",
        "windows",
        "overheadDoors",
        "interiorDoors",
        "washrooms",
        "stairs",
        "elevators",
      ].includes(key)
        ? "whole"
        : "decimal",
      operator: "between",
      formulae: [
        key === "footprint" ? 0.01 : key === "floors" ? 1 : 0,
        maximum,
      ],
      allowBlank: false,
      showErrorMessage: true,
      error: "Enter a valid non-negative value within the supported range.",
    };
  });
  let ar = FIELDS.length + 7;
  for (const [label, value] of [
    ["Structure", draft.inputs.structure],
    ["Cladding", draft.inputs.cladding],
    ["Roof structure", draft.inputs.roofStructure],
    ["Roof finish", draft.inputs.roofFinish],
    ["Upper floor system", draft.inputs.upperFloor],
    ["Basement", draft.inputs.basement ? "Included" : "Not included"],
    ["Site servicing", draft.inputs.servicing ? "Included" : "Not included"],
    ["Sprinklers", draft.inputs.sprinklers ? "Included" : "Not included"],
    ["Trailer", draft.inputs.trailer ? "Included" : "Not included"],
  ]) {
    assumptions.getRow(ar++).values = [
      label,
      value,
      "Scope snapshot",
      "Change scope/assembly selections in Field Docs and re-export.",
    ];
  }
  for (const note of [
    "Quantity assumptions: square footprint perimeter if no perimeter is entered; rectangular/irregular buildings need actual perimeter.",
    "Foundation wall allowance is 4 ft without basement. Partial basements need manual wall/footing quantity review.",
    "Concrete volumes use 35.3146667 cubic feet per cubic metre. Installed rates must include the scope described on Trade detail.",
    "Rates have no market-price defaults. Blank rates are unpriced; explicit zero means included at no additional cost. Exclude non-applicable allowances explicitly.",
    "Engineering 4%, architectural 3%, contingency 20% and planning range +/-20% are editable starting assumptions, not quotes or certified accuracy.",
    "PJM uses current graduated bands on direct construction plus contingency; consultant allowances are excluded from its base. Site costs are added separately.",
    "Planning range is the selected +/- percentage, not a statistical confidence interval. No HST, land purchase, financing or tax advice included.",
    "Trade detail prints the quantity/rate summary on legal landscape. Rate sources and scope notes remain in columns J-L in Excel.",
    "Blue cells are editable. Geometry/rates recalculate in Excel. Scope selections remain a snapshot. Changes in Excel do not sync back to Field Docs.",
    ...draft.notes.split("\n").flatMap(note=>note.match(/.{1,500}/g)||[""]),
  ]) {
    assumptions.mergeCells(`A${ar}:D${ar}`);
    assumptions.getCell(ar, 1).value = note;
    assumptions.getCell(ar, 1).alignment = { wrapText: true, vertical: "top" };
    assumptions.getRow(ar++).height = Math.max(38,Math.ceil(note.length/120)*15+8);
  }
  const ref = (key: FieldKey) => `'Assumptions'!$B$${inputRows[key]}`;
  heading(detail, "TRADE DETAIL", "I");
  detail.columns = [
    { width: 20 },
    { width: 31 },
    { width: 9 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 15 },
    { width: 17 },
    { width: 14 },
    { width: 34 },
    { width: 80 },
    { width: 12 },
  ];
  detail.getRow(4).values = [
    "COST GROUP",
    "SCOPE ITEM",
    "UNIT",
    "AUTO QTY",
    "QTY OVERRIDE",
    "QUANTITY USED",
    "UNIT RATE",
    "AMOUNT",
    "STATUS",
    "RATE SOURCE / DATE",
    "SCOPE / NOTES",
    "EXCLUDE (1/0)",
  ];
  detail.getRow(4).height = 32;
  result.rows.forEach((line, index) => {
    const r = index + 6;
    detail.getRow(r).values = [
      line.group,
      line.name,
      line.unit,
      null,
      draft.lines[line.id]?.quantity ?? null,
      null,
      line.rate,
      null,
      null,
      line.source,
      `${line.scope}${line.notes ? " | " + line.notes : ""}`,
      line.excluded ? 1 : 0,
    ];
    formula(detail, `D${r}`, line.formula(ref, draft.inputs), line.auto);
    formula(detail, `F${r}`, `IF(ISNUMBER(E${r}),E${r},D${r})`, line.quantity);
    formula(
      detail,
      `H${r}`,
      `IF(L${r}=1,0,IF(ISNUMBER(G${r}),F${r}*G${r},0))`,
      line.amount,
    );
    formula(
      detail,
      `I${r}`,
      `IF(L${r}=1,"Excluded",IF(F${r}=0,"No quantity",IF(ISNUMBER(G${r}),"Priced","UNPRICED")))`,
      line.excluded
        ? "Excluded"
        : line.quantity === 0
          ? "No quantity"
          : line.missing
            ? "UNPRICED"
            : "Priced",
    );
    for (const c of [4, 5, 6, 7, 8])
      detail.getCell(r, c).numFmt = '#,##0.00;[Red](#,##0.00);"—"';
    for (const c of [5, 7, 10, 12])
      detail.getCell(r, c).font = { color: { argb: blue } };
    detail.getRow(r).height = Math.min(409,Math.max(62,Math.ceil((line.scope.length+line.notes.length+3)/70)*15+12));
    detail.getRow(r).alignment = { wrapText: true, vertical: "top" };
    detail.getCell(r, 5).dataValidation = {
      type: "decimal",
      operator: "between",
      formulae: [0, 1e12],
      allowBlank: true,
      showErrorMessage: true,
      error: "Enter a non-negative quantity.",
    };
    detail.getCell(r, 7).dataValidation = {
      type: "decimal",
      operator: "between",
      formulae: [0, 1e12],
      allowBlank: true,
      showErrorMessage: true,
      error: "Enter a non-negative rate.",
    };
    detail.getCell(r, 12).dataValidation = {
      type: "whole",
      operator: "between",
      formulae: [0, 1],
      showErrorMessage: true,
      error: "Use 1 to exclude, 0 to include.",
    };
  });
  const end = 5 + result.rows.length;
  detail.autoFilter = `A4:L${end}`;
  detail.pageSetup.printArea = `A1:I${end}`;
  detail.pageSetup.paperSize = 5;
  detail.pageSetup.printTitlesRow = "1:5";
  detail.addConditionalFormatting({
    ref: `I6:I${end}`,
    rules: [
      {
        type: "containsText",
        operator: "containsText",
        text: "UNPRICED",
        priority: 1,
        style: {
          font: { color: { argb: "FFB91C1C" } },
          fill: {
            type: "pattern",
            pattern: "solid",
            bgColor: { argb: "FFFFE5E5" },
          },
        },
      },
    ],
  });
  heading(summary, "PRELIMINARY CONSTRUCTION BUDGET");
  summary.columns = [
    { width: 52 },
    { width: 25 },
    { width: 3 },
    { width: 60 },
  ];
  summary.mergeCells("A3:D3");
  formula(
    summary,
    "A3",
    `IF(COUNTIF('Trade detail'!I6:I${end},"UNPRICED")>0,"INCOMPLETE - UNPRICED SCOPE; TOTAL IS PRICED ITEMS ONLY","PRELIMINARY - REVIEW SCOPE, QUANTITIES AND RATES")`,
    result.missing
      ? "INCOMPLETE - UNPRICED SCOPE; TOTAL IS PRICED ITEMS ONLY"
      : "PRELIMINARY - REVIEW SCOPE, QUANTITIES AND RATES",
  );
  summary.getCell("A3").font = { bold: true, color: { argb: "FFB45309" } };
  summary.getRow(3).height = 32;
  summary.getCell("A3").alignment = { wrapText: true };
  summary.getRow(4).values = ["COST SUMMARY", "CAD BEFORE HST", null, "BASIS"];
  const totals: [number, string, string, number, string][] = [
    [
      6,
      "Direct construction",
      `SUM('Trade detail'!H6:H${end})`,
      result.direct,
      "Priced items only; see completeness status above",
    ],
    [
      7,
      "Design / construction contingency",
      `B6*${ref("contingencyPct")}/100`,
      result.contingency,
      "Applied to direct construction",
    ],
    [
      8,
      "Eligible construction cost",
      "B6+B7",
      result.eligible,
      "PJM base: direct construction + contingency",
    ],
    [
      9,
      "Engineering",
      `B6*${ref("engineeringPct")}/100`,
      result.engineering,
      "Allowance on direct construction",
    ],
    [
      10,
      "Architectural",
      `B6*${ref("architectPct")}/100`,
      result.architect,
      "Allowance on direct construction",
    ],
    [
      11,
      "PJM fee",
      "MIN(B8,500000)*0.08+MAX(0,MIN(B8,1000000)-500000)*0.06+MAX(0,MIN(B8,10000000)-1000000)*0.04+MAX(0,B8-10000000)*0.02",
      result.fee.pjm,
      "Marginal rates: 8% / 6% / 4% / 2%",
    ],
    [
      12,
      "Site supervision",
      `${ref("supervisorAnnual")}*${ref("months")}/12*${ref("allocation")}/100`,
      result.fee.supervision,
      "Separate from PJM",
    ],
    [
      13,
      "Site trailer",
      draft.inputs.trailer
        ? `${ref("trailerMonthly")}*${ref("months")}+${ref("trailerSetup")}`
        : "0",
      result.fee.trailer,
      "Separate from PJM",
    ],
    [
      15,
      "PRELIMINARY TOTAL",
      "SUM(B8:B13)",
      result.budget,
      "Excludes HST, land and financing",
    ],
    [
      16,
      "Planning range - low",
      `B15*(1-${ref("rangePct")}/100)`,
      result.low,
      "Selected planning range; not certified accuracy",
    ],
    [
      17,
      "Planning range - high",
      `B15*(1+${ref("rangePct")}/100)`,
      result.high,
      "Selected planning range; not certified accuracy",
    ],
    [
      19,
      "Gross floor area",
      `${ref("footprint")}*${ref("floors")}+${draft.inputs.basement ? ref("basementArea") : "0"}`,
      result.area,
      "sf including basement",
    ],
    [
      20,
      "Budget per gross sf",
      "IF(B19>0,B15/B19,0)",
      result.budget / result.area,
      "CAD/sf",
    ],
    [
      21,
      "Unpriced active lines",
      `COUNTIF('Trade detail'!I6:I${end},"UNPRICED")`,
      result.missing,
      "Complete or exclude each line before issuing",
    ],
  ];
  for (const [r, label, f, value, basis] of totals) {
    summary.getRow(r).values = [label, null, null, basis];
    formula(summary, `B${r}`, f, value);
    summary.getCell(r, 2).numFmt = r === 21 ? "0" : "#,##0.00";
    summary.getCell(r, 4).alignment = { wrapText: true };
    summary.getRow(r).height = 24;
  }
  let sr = 24;
  for (const group of [...new Set(result.rows.map((r) => r.group))]) {
    summary.getCell(sr, 1).value = group;
    formula(
      summary,
      `B${sr}`,
      `SUMIF('Trade detail'!A6:A${end},A${sr},'Trade detail'!H6:H${end})`,
      result.rows
        .filter((r) => r.group === group)
        .reduce((s, r) => s + r.amount, 0),
    );
    summary.getCell(sr++, 2).numFmt = "#,##0.00";
  }
  summary.mergeCells(`A${sr + 2}:D${sr + 2}`);
  summary.getCell(sr + 2, 1).value =
    "Class D planning worksheet. Scope and rates require estimator review. See Assumptions and Trade detail for inclusions, exclusions and rate sources.";
  summary.getCell(sr + 2, 1).alignment = { wrapText: true };
  summary.getRow(sr + 2).height = 40;
  for (const s of [summary, detail, assumptions]) {
    s.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(4).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: navy },
    };
    s.getRow(4).alignment = { wrapText: true };
    s.eachRow((row) =>
      row.eachCell((cell) => {
        cell.font = { name: "Arial", size: 11, ...cell.font };
      }),
    );
  }
  summary.getRow(15).font = {
    name: "Arial",
    bold: true,
    size: 14,
    color: { argb: "FFFFFFFF" },
  };
  summary.getRow(15).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: navy },
  };
  summary.getRow(15).height = 34;
  summary.pageSetup.printTitlesRow = "1:5";
  assumptions.pageSetup.printTitlesRow = "1:5";
  summary.pageSetup.printArea = "A1:D21";
  summary.pageSetup.fitToHeight = 1;
  return wb;
}
export async function exportBudgetExcel(
  name: string,
  project: string,
  draft: BudgetDraft,
) {
  const wb = await buildBudgetWorkbook(name, project, draft);
  const bytes = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "Preliminary-budget"}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
