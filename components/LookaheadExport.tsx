"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Snapshot } from "../app/schedule/engine";
import {
  buildLookahead,
  lookaheadRows,
  LookaheadOptions,
  weeksFrom,
} from "../lib/lookahead";
import { ontarioToday } from "../lib/work-calendar";
import { readableDate } from "../lib/dates";
import "./lookahead-export.css";
export default function LookaheadExport({
  project,
  projectName,
  defaultFormat = "gantt",
  close,
}: {
  project: string;
  projectName: string;
  defaultFormat?: "gantt" | "calendar";
  close: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [weeks, setWeeks] = useState("4"),
    [pdf, setPdf] = useState("");
  const [options, setOptions] = useState<LookaheadOptions>({
    start: ontarioToday(),
    end: weeksFrom(ontarioToday(), 4),
    format: defaultFormat,
    phase: "",
    trade: "",
    stage: "",
    customerOnly: true,
    milestones: true,
    responsible: true,
    progress: true,
    critical: true,
    dependencies: false,
    excludeComplete: false,
    selected: null,
  });
  const ref = useRef<HTMLDialogElement>(null);
  const previewUrl = useRef("");
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);
  useEffect(() => {
    let live = true;
    setBusy(true);
    supabase
      .rpc("schedule_v75_read", { p_project: project })
      .then(({ data, error }: any) => {
        if (!live) return;
        if (error) setError(error.message);
        else setSnapshot(data as Snapshot);
        setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [project]);
  const rows = useMemo(() => {
    try {
      return {
        items: snapshot ? lookaheadRows(snapshot, options) : [],
        error: "",
      };
    } catch (e) {
      return { items: [], error: (e as Error).message };
    }
  }, [snapshot, options]);
  const selected = rows.items.filter(
    (t) => options.selected === null || options.selected.includes(t.id),
  );
  function update(patch: Partial<LookaheadOptions>) {
    setOptions((o) => ({ ...o, ...patch }));
    setPdf("");
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = "";
    }
    setNotice("");
  }
  async function preview() {
    if (!snapshot) return;
    setBusy(true);
    setError("");
    try {
      const latest = await supabase.rpc("schedule_v75_read", {
        p_project: project,
      });
      if (latest.error) throw latest.error;
      const fresh = latest.data as Snapshot;
      if (fresh.revision !== snapshot.revision) {
        setSnapshot(fresh);
        setPdf("");
        setNotice(
          "The saved schedule changed. Review the refreshed selection and preview again.",
        );
        return;
      }
      const report = buildLookahead(projectName, fresh, options);
      const { createLookaheadPdf } = await import("../lib/lookahead-pdf");
      const doc = await createLookaheadPdf(report);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(doc.output("blob"));
      setPdf(previewUrl.current);
      setNotice(
        `PDF ready — ${report.tasks.length} activities from schedule revision ${fresh.revision}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="la-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <div>
          <div className="la-eyebrow">CLIENT SCHEDULE EXPORT</div>
          <h2>Export look-ahead</h2>
          <p>{projectName}</p>
        </div>
        <button
          disabled={busy}
          onClick={close}
          aria-label="Close look-ahead export"
        >
          ×
        </button>
      </header>
      <div className="la-body">
        {error && (
          <p className="la-error" role="alert">
            {error}
          </p>
        )}
        {rows.error && (
          <p className="la-error" role="alert">
            {rows.error}
          </p>
        )}
        {notice && (
          <p role="status" className="la-notice">
            {notice}
          </p>
        )}
        <fieldset disabled={busy}>
          <div className="la-grid">
            <label>
              Period
              <select
                value={weeks}
                onChange={(e) => {
                  setWeeks(e.target.value);
                  if (e.target.value !== "custom")
                    update({
                      end: weeksFrom(options.start, Number(e.target.value)),
                      selected: null,
                    });
                  else update({});
                }}
              >
                {[1, 2, 4, 6].map((w) => (
                  <option value={w} key={w}>
                    {w} week{w > 1 ? "s" : ""}
                  </option>
                ))}
                <option value="custom">Custom (up to 12 weeks)</option>
              </select>
            </label>
            <label>
              Start date
              <input
                type="date"
                value={options.start}
                onChange={(e) =>
                  update({
                    start: e.target.value,
                    ...(e.target.value && weeks !== "custom"
                      ? { end: weeksFrom(e.target.value, Number(weeks)) }
                      : {}),
                    selected: null,
                  })
                }
              />
            </label>
            <label>
              End date
              <input
                type="date"
                disabled={weeks !== "custom"}
                value={options.end}
                onChange={(e) =>
                  update({ end: e.target.value, selected: null })
                }
              />
            </label>
            <label>
              PDF format
              <select
                aria-label="PDF format"
                value={options.format}
                onChange={(e) =>
                  update({ format: e.target.value as "gantt" | "calendar" })
                }
              >
                <option value="gantt">Gantt chart</option>
                <option value="calendar">Weekly calendar</option>
              </select>
            </label>
            <label>
              Stage
              <select
                value={options.stage}
                onChange={(e) =>
                  update({ stage: e.target.value, selected: null })
                }
              >
                <option value="">All stages</option>
                <option value="preconstruction">Preconstruction</option>
                <option value="construction">Construction</option>
              </select>
            </label>
            <label>
              Phase
              <select
                value={options.phase}
                onChange={(e) =>
                  update({ phase: e.target.value, selected: null })
                }
              >
                <option value="">All phases</option>
                {snapshot?.tasks
                  .filter((t) => t.item_type === "phase")
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Trade
              <select
                value={options.trade}
                onChange={(e) =>
                  update({ trade: e.target.value, selected: null })
                }
              >
                <option value="">All trades</option>
                {[
                  ...new Set(
                    snapshot?.tasks.map((t) => t.trade).filter(Boolean),
                  ),
                ].map((t) => (
                  <option key={t!}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="la-checks">
            {(
              [
                ["customerOnly", "Only customer-visible activities"],
                ["milestones", "Include milestones"],
                ["responsible", "Show trades / responsible parties"],
                ["progress", "Show completion progress"],
                ["critical", "Highlight critical path"],
                ["dependencies", "Show dependency links / references"],
                ["excludeComplete", "Exclude completed activities"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) =>
                    update({ [key]: e.target.checked, selected: null })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <p className="la-info">
            Uses the latest saved project schedule. Internal notes and personal
            to-dos are never exported. Gantt pages show up to two weeks each;
            calendar pages show one week and continue when crowded. Critical
            path is calculated across the full project.
          </p>
          <div className="la-selection-heading">
            <h3>{selected.length} activities selected</h3>
            <button type="button" onClick={() => update({ selected: null })}>
              Select all
            </button>
            <button type="button" onClick={() => update({ selected: [] })}>
              Select none
            </button>
          </div>
          <div className="la-selection">
            {rows.items.map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={
                    options.selected === null || options.selected.includes(t.id)
                  }
                  onChange={(e) => {
                    const ids = options.selected || rows.items.map((r) => r.id);
                    update({
                      selected: e.target.checked
                        ? [...ids, t.id]
                        : ids.filter((id) => id !== t.id),
                    });
                  }}
                />
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {readableDate(t.start)} – {readableDate(t.finish)} ·{" "}
                    {t.trade || "No trade"}
                    {t.is_milestone ? " · Milestone" : ""}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {!rows.items.length && (
            <p>
              No activities match. Check the date range and filters. Existing
              activities may need “Customer visible” enabled, or clear the
              customer-visible-only filter to choose them here.
            </p>
          )}
        </fieldset>
        <footer>
          <button
            className="la-primary"
            disabled={busy || !snapshot || !!rows.error || !selected.length}
            onClick={() => void preview()}
          >
            {busy ? "Preparing…" : "Preview PDF"}
          </button>
          {pdf && (
            <a
              href={pdf}
              download={`${projectName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60)}_${options.start}_${options.format}_lookahead.pdf`}
            >
              Download PDF
            </a>
          )}
          <button disabled={busy} onClick={close}>
            Close
          </button>
        </footer>
        {pdf && (
          <>
            <p>
              The PDF is a snapshot of the selected saved revision. Review it
              before sending.
            </p>
            <iframe title="Look-ahead PDF preview" src={pdf} />
            <a href={pdf} target="_blank" rel="noreferrer">
              Open PDF preview in a new tab
            </a>
          </>
        )}
      </div>
    </dialog>
  );
}
