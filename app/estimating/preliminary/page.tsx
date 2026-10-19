"use client";
import { useEffect, useMemo, useState } from "react";
import { requireActiveStaff } from "../../../lib/auth";
import { supabase } from "../../../lib/supabase";
import { getProjects, Project } from "../../../lib/project-work";
import {
  BudgetDraft,
  FieldKey,
  FIELDS,
  LINES,
  OPTIONS,
  LineEdit,
  SavedBudget,
  newBudget,
  estimateBudget,
} from "../../../lib/preliminary";
import { money } from "../../../lib/fee-calculator";
import { readableDateTime } from "../../../lib/dates";
import FeeNumberInput from "../../../components/FeeNumberInput";
import "./preliminary.css";
const GROUPS = [
  {
    name: "Building",
    keys: [
      "footprint",
      "floors",
      "height",
      "perimeter",
      "basementArea",
      "basementHeight",
    ],
  },
  {
    name: "Structure & envelope",
    keys: [
      "wallThickness",
      "footingWidth",
      "footingDepth",
      "slabThickness",
      "basementSlab",
      "upperSlab",
      "roofFactor",
      "doors",
      "doorArea",
      "overheadDoors",
      "overheadArea",
      "windows",
      "windowArea",
    ],
  },
  {
    name: "Interiors & site",
    keys: [
      "partitionLength",
      "interiorDoors",
      "washrooms",
      "stairs",
      "elevators",
      "paving",
      "landscape",
      "waterLength",
      "sanitaryLength",
      "stormLength",
    ],
  },
  {
    name: "Allowances & fees",
    keys: [
      "engineeringPct",
      "architectPct",
      "contingencyPct",
      "rangePct",
      "months",
      "supervisorAnnual",
      "allocation",
      "trailerMonthly",
      "trailerSetup",
    ],
  },
];
export default function PreliminaryPage() {
  const [draft, setDraft] = useState<BudgetDraft>(newBudget),
    [name, setName] = useState("New preliminary budget"),
    [project, setProject] = useState(""),
    [projects, setProjects] = useState<Project[]>([]),
    [saved, setSaved] = useState<SavedBudget[]>([]),
    [current, setCurrent] = useState<SavedBudget | null>(null),
    [allowed, setAllowed] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState(0),
    [costGroup, setCostGroup] = useState(""),
    [ratesFrom, setRatesFrom] = useState("");
  const calculated = useMemo(() => {
    try {
      return { result: estimateBudget(draft), error: "" };
    } catch (e) {
      return { result: null, error: (e as Error).message };
    }
  }, [draft]);
  const result = calculated.result;
  async function refresh() {
    const r = await supabase
      .from("fielddocs_preliminary_estimates")
      .select("*")
      .order("updated_at", { ascending: false });
    if (r.error) throw r.error;
    setSaved(r.data || []);
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const p = await requireActiveStaff();
        if (!p) return;
        const r = await supabase.rpc("fielddocs_can_estimate");
        if (r.error) throw r.error;
        if (!live) return;
        setAllowed(r.data === true);
        if (r.data) {
          await refresh();
          const ps = await getProjects(p);
          if (live) setProjects(ps);
        }
      } catch (e) {
        if (live)
          setError(
            (e as Error).message +
              " — confirm the V7 SQL migration is installed.",
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(next: BudgetDraft) {
    setDraft(next);
    setDirty(true);
    setNotice("");
  }
  function change(key: FieldKey, value: number) {
    edit({ ...draft, inputs: { ...draft.inputs, [key]: value } });
  }
  function lineEdit(id: string, change: Partial<LineEdit>) {
    edit({
      ...draft,
      lines: {
        ...draft.lines,
        [id]: {
          ...(draft.lines[id] || {
            rate: null,
            quantity: null,
            excluded: false,
            source: "",
            notes: "",
          }),
          ...change,
        },
      },
    });
  }
  function open(s?: SavedBudget) {
    if (dirty && !confirm("Discard unsaved budget changes?")) return;
    setDraft(s ? structuredClone(s.draft) : newBudget());
    setName(s?.name || "New preliminary budget");
    setProject(s?.project_id || "");
    setCurrent(s || null);
    setDirty(false);
    setError("");
    setNotice("");
  }
  async function save(copy = false) {
    if (!result || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await supabase.rpc("fielddocs_preliminary_save", {
        p_id: copy ? null : current?.id || null,
        p_revision: copy ? null : (current?.revision ?? null),
        p_name: copy ? name.slice(0, 143) + " (copy)" : name,
        p_project: project || null,
        p_draft: draft,
      });
      if (r.error) throw r.error;
      setCurrent(r.data);
      setName(r.data.name);
      setDirty(false);
      await refresh();
      setNotice("Budget saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(s: SavedBudget) {
    if (!confirm(`Delete “${s.name}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await supabase.rpc("fielddocs_preliminary_delete", {
        p_id: s.id,
        p_revision: s.revision,
      });
      if (r.error) throw r.error;
      if (current?.id === s.id) {
        setCurrent(null);
        setDirty(true);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function excel() {
    if (!result) return;
    if (
      result.missing &&
      !confirm(
        `${result.missing} active lines have no rate. Export an INCOMPLETE worksheet showing priced items only?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { exportBudgetExcel } =
        await import("../../../lib/preliminary-excel");
      await exportBudgetExcel(
        name,
        projects.find((p) => p.id === project)?.project_name || "",
        draft,
      );
      setNotice(
        "Excel workbook downloaded. Excel edits do not sync back to Field Docs.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function useRates() {
    const source = saved.find((s) => s.id === ratesFrom);
    if (!source) return;
    const lines = { ...draft.lines };
    for (const def of LINES) {
      const from = source.draft.lines[def.id];
      if (from?.rate !== null && from?.rate !== undefined)
        lines[def.id] = {
          ...(lines[def.id] || {
            rate: null,
            quantity: null,
            excluded: false,
            source: "",
            notes: "",
          }),
          rate: from.rate,
          source: (
            from.source ||
            `From ${source.name} (${source.updated_at.slice(0, 10)})`
          ).slice(0, 500),
        };
    }
    edit({ ...draft, lines });
    setNotice(
      "Rates copied. Review assembly, location, date and scope before using them; quantities and exclusions were retained.",
    );
  }
  if (loading)
    return <main className="pre-page">Opening preliminary estimating…</main>;
  if (!allowed)
    return (
      <main className="pre-page">
        <h1>Preliminary estimating</h1>
        <p role="alert">
          {error ||
            "Ask an administrator to grant estimating access in the fee calculator."}
        </p>
      </main>
    );
  return (
    <main className="pre-page">
      <header className="pre-heading">
        <div>
          <div className="pre-eyebrow">FIELD DOCS / ESTIMATING</div>
          <h1>Preliminary budget</h1>
          <p>
            Define the building. Price the scope. Export a working Excel budget.
          </p>
        </div>
        <div className="pre-actions">
          <a href="/estimating">PJM calculator</a>
          <button disabled={busy} onClick={() => open()}>
            New budget
          </button>
          <button
            className="pre-primary"
            disabled={busy || !result}
            onClick={() => void excel()}
          >
            Export Excel
          </button>
        </div>
      </header>
      <p className="pre-note">
        Class D planning worksheet · CAD before HST · Quantities are conceptual
        allowances, not an engineered takeoff. Supply your own current rates or
        reuse rates from a reviewed estimate.
      </p>
      {error && (
        <p className="pre-error" role="alert">
          {error}
        </p>
      )}
      {calculated.error && (
        <p className="pre-error" role="alert">
          {calculated.error}
        </p>
      )}
      {notice && (
        <p className="pre-notice" role="status">
          {notice}
        </p>
      )}
      {result && (
        <div className="pre-totals">
          <article>
            <span>
              {result.missing
                ? "Priced scope + allowances"
                : "Preliminary total"}
            </span>
            <strong>{money(result.budget)}</strong>
            <small>
              {result.missing
                ? "Incomplete — not a complete project price"
                : "Before HST, land and financing"}
            </small>
          </article>
          <article>
            <span>Gross floor area</span>
            <strong>{result.area.toLocaleString()} sf</strong>
            <small>
              {money(result.budget / result.area)} / sf of priced scope
            </small>
          </article>
          <article>
            <span>Review status</span>
            <strong>{result.missing} unpriced</strong>
            <small>
              {result.missing
                ? "Price or explicitly exclude each active line"
                : "All active lines priced — estimator review still required"}
            </small>
          </article>
        </div>
      )}
      <section className="pre-panel">
        <div className="pre-grid">
          <label>
            Estimate name
            <input
              maxLength={150}
              value={name}
              disabled={busy}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label>
            Project (optional)
            <select
              disabled={busy}
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">Standalone estimate</option>
              {project && !projects.some((p) => p.id === project) && (
                <option value={project}>Previously linked project</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav className="pre-tabs" aria-label="Estimate sections">
          {[
            ...GROUPS.map((g) => g.name),
            "Price the scope",
            "Summary & notes",
          ].map((title, index) => (
            <button
              key={title}
              aria-pressed={tab === index}
              onClick={() => setTab(index)}
            >
              {index + 1}. {title}
            </button>
          ))}
        </nav>
        <fieldset disabled={busy}>
          {tab < 4 && (
            <>
              <h2>{GROUPS[tab].name}</h2>
              {tab === 0 && (
                <label className="pre-check">
                  <input
                    type="checkbox"
                    checked={draft.inputs.basement}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        inputs: {
                          ...draft.inputs,
                          basement: e.target.checked,
                          basementArea: e.target.checked
                            ? draft.inputs.basementArea ||
                              draft.inputs.footprint
                            : draft.inputs.basementArea,
                        },
                      })
                    }
                  />
                  Include a basement
                </label>
              )}
              {tab === 1 && (
                <div className="pre-grid">
                  {Object.entries(OPTIONS).map(([key, values]) => (
                    <label key={key}>
                      {
                        (
                          {
                            structure: "Structural system",
                            cladding: "Cladding assembly",
                            roofStructure: "Roof construction",
                            roofFinish: "Roof finish",
                            upperFloor: "Suspended floor construction",
                          } as Record<string, string>
                        )[key]
                      }
                      <select
                        value={draft.inputs[key as keyof typeof OPTIONS]}
                        onChange={(e) => {
                          const affected = (
                            {
                              structure: "structure",
                              cladding: "cladding",
                              roofStructure: "roofstructure",
                              roofFinish: "roofing",
                              upperFloor: "upperfloor",
                            } as Record<string, string>
                          )[key];
                          const lines = { ...draft.lines };
                          if (lines[affected])
                            lines[affected] = {
                              ...lines[affected],
                              rate: null,
                              source: "",
                            };
                          edit({
                            ...draft,
                            inputs: { ...draft.inputs, [key]: e.target.value },
                            lines,
                          });
                        }}
                      >
                        {values.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {tab === 2 && (
                <div className="pre-actions">
                  {(["servicing", "sprinklers"] as const).map((key) => (
                    <label className="pre-check" key={key}>
                      <input
                        type="checkbox"
                        checked={draft.inputs[key]}
                        onChange={(e) =>
                          edit({
                            ...draft,
                            inputs: {
                              ...draft.inputs,
                              [key]: e.target.checked,
                            },
                          })
                        }
                      />
                      {key === "servicing"
                        ? "Include site servicing"
                        : "Include sprinklers"}
                    </label>
                  ))}
                </div>
              )}
              {tab === 3 && (
                <>
                  <p>
                    Consultant percentages, contingency and the planning range
                    are editable starting assumptions. PJM uses 8% / 6% / 4% /
                    2% marginal bands on direct construction plus contingency.
                    Consultant fees are outside the PJM base.
                  </p>
                  <label className="pre-check">
                    <input
                      type="checkbox"
                      checked={draft.inputs.trailer}
                      onChange={(e) =>
                        edit({
                          ...draft,
                          inputs: {
                            ...draft.inputs,
                            trailer: e.target.checked,
                          },
                        })
                      }
                    />
                    Include site trailer
                  </label>
                </>
              )}
              <div className="pre-grid">
                {FIELDS.filter(([key]) => GROUPS[tab].keys.includes(key)).map(
                  ([key, label, unit, , ,]) => (
                    <label key={key}>
                      {label}
                      <FeeNumberInput
                        value={draft.inputs[key]}
                        max={FIELDS.find((f) => f[0] === key)![4]}
                        onChange={(value) => change(key, value)}
                      />
                      <small>{unit}</small>
                    </label>
                  ),
                )}
              </div>
              {tab === 0 && (
                <p>
                  Perimeter defaults to a square footprint. Set the actual
                  perimeter for rectangular or irregular buildings. All storeys
                  use the footprint area; override affected line quantities for
                  setbacks or mezzanines.
                </p>
              )}
            </>
          )}
          {tab === 4 && (
            <>
              <div className="pre-section-heading">
                <div>
                  <h2>Price the scope</h2>
                  <p>
                    Blank rate = unpriced. Zero = explicitly no additional cost.
                    Exclude non-applicable allowances.
                  </p>
                </div>
                <label>
                  Cost group
                  <select
                    value={costGroup}
                    onChange={(e) => setCostGroup(e.target.value)}
                  >
                    <option value="">All groups</option>
                    {[...new Set(LINES.map((l) => l.group))].map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="pre-actions">
                <select
                  aria-label="Reuse rates from saved budget"
                  value={ratesFrom}
                  onChange={(e) => setRatesFrom(e.target.value)}
                >
                  <option value="">Reuse rates from a saved budget…</option>
                  {saved.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={!ratesFrom} onClick={useRates}>
                  Copy rates only
                </button>
              </div>
              <p className="pre-note">
                Selected assemblies: {draft.inputs.structure};{" "}
                {draft.inputs.cladding}; {draft.inputs.roofStructure};{" "}
                {draft.inputs.roofFinish}. Rates must match these assemblies.
                Changing an assembly clears its main rate for review.
              </p>
              <div className="pre-lines">
                {LINES.filter((l) => !costGroup || l.group === costGroup).map(
                  (def) => {
                    const e = draft.lines[def.id] || {
                      rate: null,
                      quantity: null,
                      excluded: false,
                      source: "",
                      notes: "",
                    };
                    const row = result?.rows.find((r) => r.id === def.id);
                    return (
                      <article
                        className={
                          row?.missing ? "pre-line unpriced" : "pre-line"
                        }
                        key={def.id}
                      >
                        <div>
                          <small>{def.group}</small>
                          <h3>{def.name}</h3>
                          <p>{def.scope}</p>
                          <label className="pre-check">
                            <input
                              type="checkbox"
                              checked={e.excluded}
                              onChange={(ev) =>
                                lineEdit(def.id, {
                                  excluded: ev.target.checked,
                                })
                              }
                            />
                            Exclude this scope
                          </label>
                        </div>
                        <div className="pre-line-inputs">
                          <label>
                            Quantity override ({def.unit})
                            <FeeNumberInput
                              value={e.quantity ?? NaN}
                              max={1e12}
                              onChange={(v) =>
                                lineEdit(def.id, {
                                  quantity: Number.isFinite(v) ? v : null,
                                })
                              }
                            />
                            <small>
                              Auto:{" "}
                              {Number.isFinite(def.qty(draft.inputs))
                                ? def
                                    .qty(draft.inputs)
                                    .toLocaleString("en-CA", {
                                      maximumFractionDigits: 2,
                                    })
                                : "—"}{" "}
                              {def.unit} · leave blank for auto
                            </small>
                          </label>
                          <label>
                            Unit rate (CAD)
                            <FeeNumberInput
                              value={e.rate ?? NaN}
                              max={1e12}
                              onChange={(v) =>
                                lineEdit(def.id, {
                                  rate: Number.isFinite(v) ? v : null,
                                })
                              }
                            />
                          </label>
                          <label>
                            Rate source / date
                            <input
                              maxLength={500}
                              value={e.source}
                              onChange={(ev) =>
                                lineEdit(def.id, { source: ev.target.value })
                              }
                            />
                          </label>
                          <label>
                            Scope notes
                            <input
                              maxLength={2000}
                              value={e.notes}
                              onChange={(ev) =>
                                lineEdit(def.id, { notes: ev.target.value })
                              }
                            />
                          </label>
                          <strong>
                            {e.excluded
                              ? "Excluded"
                              : row?.missing
                                ? "Unpriced"
                                : money(row?.amount || 0)}
                          </strong>
                        </div>
                      </article>
                    );
                  },
                )}
              </div>
            </>
          )}
          {tab === 5 && (
            <>
              <h2>Budget summary</h2>
              {result && (
                <>
                  <dl className="pre-breakdown">
                    {[
                      ["Direct construction", result.direct],
                      ["Contingency", result.contingency],
                      ["Engineering", result.engineering],
                      ["Architectural", result.architect],
                      ["PJM fee", result.fee.pjm],
                      ["Site supervision", result.fee.supervision],
                      ["Site trailer", result.fee.trailer],
                      ["Total before HST", result.budget],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{money(Number(value))}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    Selected planning range:{" "}
                    <strong>
                      {money(result.low)}–{money(result.high)}
                    </strong>{" "}
                    (±{draft.inputs.rangePct}%).{" "}
                    {result.missing
                      ? "This range covers priced scope only; the project budget is incomplete."
                      : "This is a planning allowance, not a guaranteed accuracy range."}
                  </p>
                </>
              )}
              <label>
                Project assumptions / exclusions
                <textarea
                  rows={7}
                  maxLength={20000}
                  value={draft.notes}
                  onChange={(e) => edit({ ...draft, notes: e.target.value })}
                />
              </label>
              <p>
                No HST, land purchase or financing included. Review soil
                conditions, code requirements, utility capacity, fire-water
                supply, permit/development charges and owner equipment before
                issuing.
              </p>
            </>
          )}
        </fieldset>
        <footer className="pre-actions">
          <button
            disabled={busy || !result || !name.trim()}
            className="pre-primary"
            onClick={() => void save()}
          >
            {busy ? "Working…" : current ? "Save changes" : "Save budget"}
          </button>
          <button
            disabled={busy || !result || !name.trim()}
            onClick={() => void save(true)}
          >
            Save a copy
          </button>
          <span>{dirty ? "Unsaved changes" : current ? "Saved" : "Draft"}</span>
          {tab < 5 && (
            <button onClick={() => setTab(tab + 1)}>Next section →</button>
          )}
        </footer>
      </section>
      <section className="pre-panel">
        <div className="pre-section-heading">
          <h2>Saved budgets & rate references</h2>
          <button
            disabled={busy}
            onClick={() => void refresh().catch((e) => setError(e.message))}
          >
            Refresh
          </button>
        </div>
        <p>
          Shared with staff granted estimating access. Saved rates are
          snapshots; changes do not reprice other estimates.
        </p>
        <div className="pre-saved">
          {saved.map((s) => (
            <article key={s.id}>
              <button disabled={busy} onClick={() => open(s)}>
                {s.name}
              </button>
              <small>{readableDateTime(s.updated_at)}</small>
              <button disabled={busy} onClick={() => void remove(s)}>
                Delete
              </button>
            </article>
          ))}
        </div>
        {!saved.length && <p>No preliminary budgets saved yet.</p>}
      </section>
    </main>
  );
}
