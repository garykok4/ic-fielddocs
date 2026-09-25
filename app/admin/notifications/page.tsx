"use client";
import { useEffect, useState } from "react";
import { requireActiveStaff } from "../../../lib/auth";
import { supabase } from "../../../lib/supabase";
import { dispatchNotifications } from "../../../lib/project-work";
import "../../../components/project-work.css";
export default function NotificationStatus() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [allowed, setAllowed] = useState(false);
  async function load() {
    setError("");
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch("/api/notifications/status", {
        headers: { Authorization: `Bearer ${s.session?.access_token || ""}` },
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    (async () => {
      const p = await requireActiveStaff();
      if (!p) return;
      if (p.role !== "admin") {
        setError("Administrator access required.");
        return;
      }
      setAllowed(true);
      await load();
    })();
  }, []);
  return (
    <main className="pw">
      <div className="eyebrow">FIELD DOCS / ADMINISTRATION</div>
      <h1>Notification delivery</h1>
      <p>Assignment emails, site events, and weekday task digests.</p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {allowed && (
        <div className="actions">
          <button disabled={busy} onClick={() => void load()}>
            Refresh status
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await dispatchNotifications();
              await load();
              if (!ok)
                setError(
                  "Some emails remain queued. Check configuration and delivery errors below.",
                );
              setBusy(false);
            }}
          >
            Deliver pending notifications
          </button>
          <a href="/admin/project-staff">Assign project staff</a>
        </div>
      )}
      {data && (
        <>
          <div className="panel">
            <h2>Configuration</h2>
            {Object.entries(data.configuration).map(([key, value]) => (
              <p key={key}>
                {key}:{" "}
                <strong className={value ? "" : "red"}>
                  {value ? "Configured" : "Missing"}
                </strong>
              </p>
            ))}
            <p className="muted">
              Configured means a value is present, not that the provider has
              verified it. Scheduled reminders require an active production cron
              job.
            </p>
          </div>
          <div className="cards">
            {Object.entries(data.counts).map(([key, n]) => (
              <div className="metric" key={key}>
                <strong>{String(n)}</strong>
                <span>{key}</span>
              </div>
            ))}
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.kind}</td>
                    <td>{r.status}</td>
                    <td>{r.attempts}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.last_error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            “Sent” means accepted by the email provider. Failed or uncertain
            deliveries require review; do not reset them without checking
            provider logs.
          </p>
        </>
      )}
    </main>
  );
}
