"use client";
import {readableDate,readableDateTime} from "../../lib/dates";
import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { requireActiveStaff } from "../../lib/auth";
import { getProjects, Project } from "../../lib/project-work";
import {
  fromPlain,
  normalizeRich,
  REPORT_FIELDS,
  RichDoc,
  richToPlain,
} from "../../lib/report-rich-text";
import RichReportEditor from "./RichReportEditor";
import ReportContent from "./ReportContent";
import "./report-text.css";
const labels = {
  work_completed: "Work Completed",
  labour: "Labour on Site",
  issues: "Issues / Delays / Notes",
};
export default function ReportForm({ reportId }: { reportId?: string }) {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState(""),
    [date, setDate] = useState(""),
    [weather, setWeather] = useState("");
  const [sections, setSections] = useState<Record<string, RichDoc>>({
      work_completed: fromPlain(""),
      labour: fromPlain(""),
      issues: fromPlain(""),
    }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [photo, setPhoto] = useState<File | null>(null),
    [photoUrl, setPhotoUrl] = useState("");
  const id = useRef(reportId || null),
    revision = useRef(0),
    saving = useRef(false),
    dirty = useRef(false),
    uploadPath = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await requireActiveStaff();
        if (!p) return;
        const list = await getProjects(p);
        if (!alive) return;
        setProjects(list);
        setDate(new Date().toLocaleDateString("en-CA"));
        if (reportId) {
          const r = await supabase
            .from("daily_reports")
            .select("*")
            .eq("id", reportId)
            .single();
          if (r.error) throw r.error;
          if (!list.some((p) => p.id === r.data.project_id))
            throw Error("This report is not assigned to your account.");
          if (!alive) return;
          setProject(r.data.project_id);
          setDate(r.data.report_date);
          setWeather(r.data.weather || "");
          revision.current = r.data.report_revision || 0;
          setSections(
            Object.fromEntries(
              REPORT_FIELDS.map((k) => [
                k,
                normalizeRich(r.data.rich_text?.[k]) ||
                  fromPlain(r.data[k] || ""),
              ]),
            ),
          );
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reportId]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!project || !date) throw Error("Choose a project and report date.");
      if (
        photo &&
        (!photo.type.startsWith("image/") || photo.size > 20 * 1024 * 1024)
      )
        throw Error("Choose an image up to 20 MB.");
      const rich = Object.fromEntries(
        REPORT_FIELDS.map((k) => {
          const value = normalizeRich(sections[k]);
          if (!value)
            throw Error(
              "A formatted section is too complex to save. Simplify the pasted content before trying again.",
            );
          return [k, value];
        }),
      );
      const saved = await supabase.rpc("fielddocs_report_save", {
        p_id: id.current,
        p_revision: revision.current,
        p_project: project,
        p_date: date,
        p_weather: weather,
        p_work: richToPlain(rich.work_completed),
        p_labour: richToPlain(rich.labour),
        p_issues: richToPlain(rich.issues),
        p_rich: rich,
      });
      if (saved.error) {
        if (saved.error.code === "PGRST202")
          throw Error(
            "Run database/upgrade-v6-to-v6-1.sql in Supabase before saving formatted reports.",
          );
        throw saved.error;
      }
      id.current = saved.data.id;
      revision.current = saved.data.report_revision;
      if (photo) {
        if (!uploadPath.current)
          uploadPath.current = `${id.current}/${crypto.randomUUID()}-${photo.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        if (!photoUrl) {
          const uploaded = await supabase.storage
            .from("report-photos")
            .upload(uploadPath.current, photo);
          if (uploaded.error)
            throw Error(
              "Report saved, but photo upload failed: " +
                uploaded.error.message +
                " Retry Save to continue with this same report.",
            );
        }
        const url =
          photoUrl ||
          supabase.storage
            .from("report-photos")
            .getPublicUrl(uploadPath.current).data.publicUrl;
        setPhotoUrl(url);
        const existing = await supabase
          .from("attachments")
          .select("id")
          .eq("report_id", id.current)
          .eq("file_url", url)
          .limit(1);
        if (existing.error) throw existing.error;
        if (!existing.data?.length) {
          const attached = await supabase
            .from("attachments")
            .insert({ report_id: id.current, file_url: url });
          if (attached.error)
            throw Error(
              "Report saved, but the photo could not be attached. Retry Save: " +
                attached.error.message,
            );
        }
      }
      dirty.current = false;
      window.location.href = `/reports/${id.current}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (loading)
    return <main className="report-form">Opening report editor…</main>;
  if (!projects.length || (reportId && !project))
    return (
      <main className="report-form">
        <p className="report-error">
          {error || "No projects are assigned to your account."}
        </p>
        <a href="/reports">Back to reports</a>
      </main>
    );
  return (
    <main className="report-form">
      <h1>{reportId ? "Edit Daily Site Report" : "New Daily Site Report"}</h1>
      <p className="report-info">
        Format your report as you write. Paragraphs, lists, fonts and tables are
        retained when saved and printed.
      </p>
      {error && (
        <p role="alert" className="report-error">
          {error}
        </p>
      )}
      <form
        onSubmit={submit}
        onChange={() => {
          dirty.current = true;
        }}
      >
        <fieldset disabled={busy}>
          <div className="report-meta">
            <label>
              Project
              <select
                required
                disabled={!!id.current}
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Report date
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="report-wide">
              Weather
              <input
                maxLength={2000}
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
              />
            </label>
          </div>
          <div className="report-actions">
            <button type="button" onClick={() => setPreview(!preview)}>
              {preview ? "Back to editing" : "Preview formatting"}
            </button>
          </div>
          <div style={{ display: preview ? "none" : undefined }}>
            {REPORT_FIELDS.map((k) => (
              <section key={k}>
                <h2 className="report-label">{labels[k]}</h2>
                <RichReportEditor
                  label={labels[k]}
                  value={sections[k]}
                  disabled={busy}
                  onChange={(v) => {
                    dirty.current = true;
                    setSections((s) => ({ ...s, [k]: v }));
                  }}
                />
              </section>
            ))}
          </div>
          {preview && (
            <div className="report-preview">
              <h1>Daily Site Report</h1>
              <h2>{projects.find((p) => p.id === project)?.project_name}</h2>
              <p>{readableDate(date)}</p>
              <p>Weather: {weather || "—"}</p>
              {REPORT_FIELDS.map((k) => (
                <section key={k}>
                  <h2>{labels[k]}</h2>
                  <ReportContent value={sections[k]} />
                </section>
              ))}
            </div>
          )}
          <label className="report-label">
            {reportId
              ? "Add a photo (existing photos are retained)"
              : "Photo (optional)"}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                setPhoto(e.target.files?.[0] || null);
                setPhotoUrl("");
                uploadPath.current = null;
              }}
            />
          </label>
          <div className="report-actions">
            <button type="submit">
              {busy
                ? "Saving…"
                : reportId
                  ? "Save report changes"
                  : "Save daily report"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  !dirty.current ||
                  window.confirm("Leave without saving your latest changes?")
                ) {
                  dirty.current = false;
                  window.location.href = id.current
                    ? `/reports/${id.current}`
                    : "/reports";
                }
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </main>
  );
}
