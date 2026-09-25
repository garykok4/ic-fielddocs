"use client";
import { useEffect, useRef, useState } from "react";
import PublishedFiles from "../../components/PublishedFiles";
import { PublishedFile } from "../../lib/project-files";
import "../../components/project-files.css";
export default function ContractorFiles() {
  const token = useRef(""),
    pin = useRef("");
  const [entry, setEntry] = useState(""),
    [files, setFiles] = useState<PublishedFile[]>([]),
    [project, setProject] = useState("Project documents"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [unlocked, setUnlocked] = useState(false),
    [needsPin, setNeedsPin] = useState(false),
    [refreshed, setRefreshed] = useState("");
  async function request(b: unknown) {
    const r = await fetch("/api/contractor-files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Project-Access": token.current,
        "X-Project-Pin": pin.current,
      },
      body: JSON.stringify(b),
      cache: "no-store",
    });
    const data = await r.json();
    if (!r.ok) {
      if (r.status === 401) setNeedsPin(true);
      if ([401, 403, 429].includes(r.status)) {
        setUnlocked(false);
        setFiles([]);
      }
      throw Error(data.error || "Unable to load project documents.");
    }
    return data;
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const d = await request({ action: "list" });
      setFiles(d.files);
      setProject(d.project_name);
      setRefreshed(d.refreshed_at);
      setUnlocked(true);
      setEntry("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    token.current = window.location.hash.slice(1);
    void refresh();
  }, []);
  useEffect(() => {
    if (!unlocked) return;
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const timer = setInterval(focus, 60000);
    return () => {
      window.removeEventListener("focus", focus);
      clearInterval(timer);
    };
  }, [unlocked]);
  async function open(f: PublishedFile, view: boolean) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setBusy(true);
    setError("");
    try {
      const d = await request({
        action: "download",
        revision: f.revision_id,
        view,
      });
      if (popup) popup.location.href = d.signedUrl;
      else window.location.href = d.signedUrl;
    } catch (e) {
      popup?.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="project-files contractor-page">
      <header className="contractor-header">
        <span className="files-eyebrow">I/C CONSTRUCTION / FIELD DOCS</span>
        <h1>{project}</h1>
        <p>Current published files for the project team and trades.</p>
      </header>
      <section className="files-panel">
        <div className="files-row">
          <h2>Published documents</h2>
          {unlocked && (
            <button
              className="files-secondary"
              onClick={() => void refresh()}
              disabled={busy}
            >
              Refresh
            </button>
          )}
        </div>
        {error && (
          <p className="files-error" role="alert">
            {error}
          </p>
        )}
        {!unlocked ? (
          <>
            <p>
              {busy
                ? "Opening project…"
                : "Use the project QR code provided by your project manager."}
            </p>
            {needsPin && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  pin.current = entry;
                  void refresh();
                }}
              >
                <label>
                  Project PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    minLength={6}
                    maxLength={12}
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    required
                  />
                </label>
                <button disabled={busy}>Open documents</button>
              </form>
            )}
            {!needsPin && !busy && (
              <button onClick={() => void refresh()}>Retry</button>
            )}
          </>
        ) : (
          <>
            <PublishedFiles
              files={files}
              onOpen={(f, v) => void open(f, v)}
              busy={busy}
            />
            <p className="files-muted">
              Updated {refreshed ? new Date(refreshed).toLocaleString() : ""}.
              Only the current published revision is shown. Downloaded copies do
              not update automatically.
            </p>
            {needsPin && (
              <button
                className="files-secondary"
                onClick={() => {
                  pin.current = "";
                  setFiles([]);
                  setUnlocked(false);
                  setEntry("");
                }}
              >
                Lock documents
              </button>
            )}
          </>
        )}
      </section>
      <footer className="files-muted">
        Questions about a revision? Contact your project manager. Published does
        not necessarily mean issued for construction.
      </footer>
    </main>
  );
}
