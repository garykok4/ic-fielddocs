"use client";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "../lib/supabase";
import {
  DISCIPLINES,
  FILE_KINDS,
  ISSUE_STATUSES,
  FileWorkspace,
  ProjectDocument,
  FileRevision,
  PublishedFile,
  MAX_FILE_BYTES,
  fileMime,
  fileSize,
} from "../lib/project-files";
import PublishedFiles from "./PublishedFiles";
import "./project-files.css";
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const box = ref.current;
    box?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && box) {
        const els = Array.from(
          box.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ),
        );
        const first = els[0],
          last = els.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === box)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="files-modal-backdrop">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"files-modal " + (wide ? "files-modal-wide" : "")}
      >
        <div className="files-row">
          <h2>{title}</h2>
          <button className="files-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
const emptyForm = {
  number: "",
  title: "",
  discipline: "Architectural",
  kind: "Drawing",
  folder: "",
  label: "0",
  issue_date: new Date().toISOString().slice(0, 10),
  issue_status: "For Review",
};
export default function ProjectFiles({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [data, setData] = useState<FileWorkspace | null>(null),
    [tab, setTab] = useState("published"),
    [query, setQuery] = useState(""),
    [discipline, setDiscipline] = useState(""),
    [folder, setFolder] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [modal, setModal] = useState<
      "upload" | "edit" | "history" | "preview" | null
    >(null),
    [selected, setSelected] = useState<ProjectDocument | null>(null),
    [form, setForm] = useState({ ...emptyForm }),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<PublishedFile[]>([]),
    [modalError, setModalError] = useState("");
  const [enabled, setEnabled] = useState(false),
    [pin, setPin] = useState(""),
    [removePin, setRemovePin] = useState(false),
    [expiry, setExpiry] = useState(""),
    [qr, setQr] = useState(""),
    [printSign, setPrintSign] = useState(false);
  const lock = useRef(false),
    alive = useRef(true);
  async function api(action: string, fields: Record<string, unknown> = {}) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw Error("Your session expired. Sign in again.");
    const r = await fetch("/api/project-files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ project: projectId, action, ...fields }),
      cache: "no-store",
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Unable to complete file operation.");
    return d;
  }
  async function load() {
    const d = (await api("list")) as FileWorkspace;
    if (!alive.current) return;
    setData(d);
    setEnabled(d.portal.enabled);
    setExpiry(d.portal.expires_at ? d.portal.expires_at.slice(0, 10) : "");
    setPin("");
    setRemovePin(false);
    if (selected)
      setSelected(d.documents.find((x) => x.id === selected.id) || null);
  }
  async function run(task: () => Promise<void>, success = "") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setModalError("");
    setMessage("");
    try {
      await task();
      if (success) setMessage(success);
    } catch (e) {
      setError((e as Error).message);
      setModalError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void run(load);
    return () => {
      alive.current = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!data) return;
    const url = `${window.location.origin}/contractor-files#${data.portal.token}`;
    let current = true;
    QRCode.toDataURL(url, { width: 400, margin: 3, errorCorrectionLevel: "M" })
      .then((value) => {
        if (current) setQr(value);
      })
      .catch(() =>
        setError("Unable to generate QR code. Copy the link instead."),
      );
    return () => {
      current = false;
    };
  }, [data?.portal.token]);
  useEffect(() => {
    const done = () => setPrintSign(false);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);
  const docs = data?.documents || [],
    revs = data?.revisions || [],
    audit = data?.audit || [];
  const current = (d: ProjectDocument) =>
    revs.find((r) => r.id === d.current_revision);
  const latest = (d: ProjectDocument) =>
    revs.find((r) => r.document_id === d.id);
  const visible = docs.filter(
    (d) =>
      (tab !== "published" || d.current_revision) &&
      (!discipline || d.discipline === discipline) &&
      (tab === "published" || !folder || d.folder === folder) &&
      `${d.number} ${d.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  const published = docs.filter((d) => d.current_revision).length,
    drafts = revs.filter(
      (r) =>
        !docs.some((d) => d.current_revision === r.id) && !r.ever_published,
    ).length;
  function close() {
    if (lock.current) return;
    setModal(null);
    setModalError("");
    setFile(null);
  }
  function upload(d: ProjectDocument | null) {
    setSelected(d);
    setForm({
      ...emptyForm,
      issue_date: new Date().toISOString().slice(0, 10),
      ...(d
        ? {
            number: d.number,
            title: d.title,
            discipline: d.discipline,
            kind: d.kind,
            folder: d.folder,
            label: "",
          }
        : {}),
    });
    setFile(null);
    setModalError("");
    setModal("upload");
  }
  async function sendFile(
    res: { id: string; path: string; token: string; mime: string },
    f: File,
  ) {
    const result = await supabase.storage
      .from("fielddocs-project-files")
      .uploadToSignedUrl(
        res.path,
        res.token,
        new File([f], f.name, { type: res.mime }),
        { contentType: res.mime, cacheControl: "0" },
      );
    if (result.error) throw result.error;
    await api("finish", { revision: res.id });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(
      async () => {
        if (modal === "edit") {
          await api("metadata", {
            ...form,
            document: selected!.id,
            version: selected!.version,
          });
        } else {
          if (!file) throw Error("Choose a file to upload.");
          if (file.size > MAX_FILE_BYTES || !file.size)
            throw Error("Choose a file between 1 byte and 50 MB.");
          if (!fileMime(file.name)) throw Error("Unsupported file format.");
          const reserved = await api("upload", {
            ...form,
            document: selected?.id,
            filename: file.name,
            bytes: file.size,
          });
          try {
            await sendFile(reserved, file);
          } catch (e) {
            await load();
            throw Error(
              "The revision was reserved, but upload did not finish. Open its revision history to finish or retry. " +
                (e as Error).message,
            );
          }
        }
        await load();
        setModal(null);
        setFile(null);
      },
      modal === "edit"
        ? "Document details saved."
        : "Revision uploaded privately. Open revision history to publish it.",
    );
  }
  async function publication(d: ProjectDocument, r?: FileRevision) {
    if (
      !window.confirm(
        r
          ? `Publish ${d.number}, revision ${r.label} (${r.issue_status})? This will replace the revision contractors currently see.`
          : `Remove ${d.number} from contractor access? Its revision history will be retained.`,
      )
    )
      return;
    await run(
      async () => {
        await api(r ? "publish" : "unpublish", {
          document: d.id,
          revision: r?.id,
          version: d.version,
        });
        await load();
      },
      r ? "Published register updated." : "Document unpublished.",
    );
  }
  async function openRevision(r: FileRevision, view: boolean) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    await run(async () => {
      try {
        const d = await api("download", { revision: r.id, view });
        if (popup) popup.location.href = d.signedUrl;
        else window.location.href = d.signedUrl;
      } catch (e) {
        popup?.close();
        throw e;
      }
    });
  }
  async function openPublished(f: PublishedFile, view: boolean) {
    const r = revs.find((r) => r.id === f.revision_id);
    if (r) await openRevision(r, view);
  }
  function exportRegister() {
    const rows = [
      [
        "Document",
        "Title",
        "Discipline",
        "Type",
        "Revision",
        "Issue date",
        "Issue status",
        "Published by",
        "Published at",
      ],
      ...docs
        .filter((d) => d.current_revision)
        .map((d) => {
          const r = current(d),
            a = audit.find(
              (a) =>
                a.document_id === d.id &&
                a.action === "Published" &&
                a.revision_id === r?.id,
            );
          return [
            d.number,
            d.title,
            d.discipline,
            d.kind,
            r?.label || "",
            r?.issue_date || "",
            r?.issue_status || "",
            d.publisher_name || "",
            d.published_at || "",
          ];
        }),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@-]/, "'$&")
                .replace(/"/g, '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "published-register.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveAccess(rotate = false) {
    if (
      rotate &&
      !window.confirm(
        "Replace the contractor link? Existing QR codes will stop working. Print a new sign after saving.",
      )
    )
      return;
    await run(
      async () => {
        await api("portal", {
          enabled,
          pin,
          remove_pin: removePin,
          expires_at: expiry ? `${expiry}T23:59:59.999Z` : null,
          version: data!.portal.version,
          rotate,
        });
        await load();
      },
      rotate
        ? "Contractor link rotated. Replace the posted QR signs."
        : "Contractor access settings saved.",
    );
  }
  const link =
    typeof window !== "undefined" && data
      ? `${window.location.origin}/contractor-files#${data.portal.token}`
      : "";
  return (
    <section className="project-files">
      <div className="files-row">
        <div>
          <span className="files-eyebrow">DOCUMENT CONTROL</span>
          <h2>Project files</h2>
          <p className="files-muted">
            Working files stay private. Publish the exact revisions your
            contractors should use.
          </p>
        </div>
        <div className="files-actions">
          <button
            className="files-secondary"
            disabled={busy}
            onClick={() => void run(load)}
          >
            Refresh
          </button>
          <button disabled={busy} onClick={() => upload(null)}>
            + Upload document
          </button>
        </div>
      </div>
      {error && (
        <p className="files-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="files-success" role="status">
          {message}
        </p>
      )}
      <div className="files-metrics">
        <div>
          <strong>{docs.length}</strong>
          <span>Documents</span>
        </div>
        <div>
          <strong>{published}</strong>
          <span>Published to contractors</span>
        </div>
        <div>
          <strong>{drafts}</strong>
          <span>Private revisions / uploads</span>
        </div>
      </div>
      <nav className="files-tabs" aria-label="File views">
        {[
          ["published", "Published Register"],
          ["working", "Working Files"],
          ["activity", "Revision History"],
          ["access", "Contractor Access"],
        ].map(([key, label]) => (
          <button
            className={tab === key ? "active" : ""}
            aria-pressed={tab === key}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {loading ? (
        <p>Loading project files…</p>
      ) : (
        data && (
          <>
            {(tab === "published" || tab === "working") && (
              <div className="files-panel">
                <div className="files-row">
                  <h3>
                    {tab === "published"
                      ? "Published Register"
                      : "Working Files"}
                  </h3>
                  {tab === "published" && (
                    <div className="files-actions">
                      <button
                        className="files-secondary"
                        onClick={exportRegister}
                      >
                        Export register
                      </button>
                      <button
                        className="files-secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const d = await api("preview");
                            setPreview(d.files);
                            setModal("preview");
                          })
                        }
                      >
                        Preview contractor view
                      </button>
                    </div>
                  )}
                </div>
                <p className="files-muted">
                  {tab === "published"
                    ? "Every currently published document, across all folders. Private drafts and superseded revisions are excluded."
                    : "Organize files using a folder label. Disciplines and document types remain searchable across folders."}
                </p>
                <div className="files-filters">
                  <label>
                    Search
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Document number or title"
                    />
                  </label>
                  <label>
                    Discipline
                    <select
                      value={discipline}
                      onChange={(e) => setDiscipline(e.target.value)}
                    >
                      <option value="">All disciplines</option>
                      {[...new Set(docs.map((d) => d.discipline))]
                        .sort()
                        .map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                    </select>
                  </label>
                  {tab === "working" && (
                    <label>
                      Folder
                      <select
                        value={folder}
                        onChange={(e) => setFolder(e.target.value)}
                      >
                        <option value="">All folders</option>
                        {[...new Set(docs.map((d) => d.folder).filter(Boolean))]
                          .sort()
                          .map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                      </select>
                    </label>
                  )}
                </div>
                {!visible.length ? (
                  <div className="files-empty">
                    {docs.length
                      ? "No documents match this view."
                      : "Upload your first drawing or project file to get started."}
                  </div>
                ) : (
                  <div className="files-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Discipline / type</th>
                          <th>
                            {tab === "published"
                              ? "Published revision"
                              : "Latest upload"}
                          </th>
                          <th>
                            {tab === "published"
                              ? "Published by"
                              : "Contractor version"}
                          </th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((d) => {
                          const r =
                              tab === "published" ? current(d) : latest(d),
                            pub = current(d),
                            event = audit.find(
                              (a) =>
                                a.document_id === d.id &&
                                a.action === "Published" &&
                                a.revision_id === pub?.id,
                            );
                          return (
                            <tr key={d.id}>
                              <td>
                                <strong>{d.number}</strong>
                                {d.title}
                                <small className="files-muted">
                                  {d.folder || "Unfiled"}
                                </small>
                              </td>
                              <td>
                                {d.discipline}
                                <small>{d.kind}</small>
                              </td>
                              <td>
                                {r ? (
                                  <>
                                    <strong>
                                      Rev {r.label} {!r.ready && "· Incomplete"}
                                    </strong>
                                    <span
                                      className={
                                        "files-status " +
                                        (r.issue_status ===
                                        "Issued for Construction"
                                          ? "issued"
                                          : "")
                                      }
                                    >
                                      {r.issue_status}
                                    </span>
                                    <small>{r.issue_date}</small>
                                  </>
                                ) : (
                                  "No revision uploaded"
                                )}
                              </td>
                              <td>
                                {tab === "published" ? (
                                  <>
                                    {d.publisher_name || "Published"}
                                    <small>
                                      {d.published_at
                                        ? new Date(
                                            d.published_at,
                                          ).toLocaleString()
                                        : ""}
                                    </small>
                                  </>
                                ) : pub ? (
                                  <>
                                    <strong>Rev {pub.label}</strong>
                                    <small>
                                      {pub.id !== r?.id
                                        ? "Latest upload is not published"
                                        : "Current revision published"}
                                    </small>
                                  </>
                                ) : (
                                  "Private only"
                                )}
                              </td>
                              <td>
                                <div className="files-actions">
                                  <button
                                    className="files-secondary"
                                    disabled={busy}
                                    onClick={() => {
                                      setSelected(d);
                                      setModalError("");
                                      setModal("history");
                                    }}
                                  >
                                    Revisions
                                  </button>
                                  <button
                                    className="files-secondary"
                                    disabled={busy}
                                    onClick={() => upload(d)}
                                  >
                                    New revision
                                  </button>
                                  {tab === "working" && (
                                    <button
                                      className="files-secondary"
                                      onClick={() => {
                                        setSelected(d);
                                        setForm({ ...emptyForm, ...d });
                                        setModalError("");
                                        setModal("edit");
                                      }}
                                    >
                                      Edit details
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {tab === "activity" && (
              <div className="files-panel">
                <h3>Revision history & publication activity</h3>
                <p className="files-muted">
                  The latest 500 publication and access events. Open a
                  document’s revisions to see all its uploads.
                </p>
                {!audit.length ? (
                  <p>No publication activity yet.</p>
                ) : (
                  <div className="files-history">
                    {audit.map((a) => {
                      const d = docs.find((d) => d.id === a.document_id),
                        r = revs.find((r) => r.id === a.revision_id);
                      return (
                        <article key={a.id}>
                          <strong>
                            {a.action}
                            {d ? ` · ${d.number}` : ""}
                            {r ? ` · Rev ${r.label}` : ""}
                          </strong>
                          <div>{a.actor_name}</div>
                          <time>{new Date(a.created_at).toLocaleString()}</time>
                          {d && (
                            <button
                              className="files-secondary"
                              onClick={() => {
                                setSelected(d);
                                setModal("history");
                              }}
                            >
                              Open revisions
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {tab === "access" && (
              <div className="files-panel">
                <h3>Contractor access</h3>
                <p className="files-notice">
                  Anyone with this link and its PIN, if set, can view published
                  files. Use the Working Files area for private documents.
                  Revoking access stops new downloads; already downloaded copies
                  cannot be recalled.
                </p>
                <div className="files-access-grid">
                  <div>
                    <label className="files-check">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                      />
                      Enable contractor portal
                    </label>
                    <label>
                      New PIN (6–12 digits)
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        value={pin}
                        maxLength={12}
                        onChange={(e) => {
                          setPin(e.target.value);
                          setRemovePin(false);
                        }}
                        placeholder={
                          data.portal.has_pin
                            ? "PIN is set; leave blank to keep it"
                            : "Optional"
                        }
                      />
                    </label>
                    {data.portal.has_pin && (
                      <label className="files-check">
                        <input
                          type="checkbox"
                          checked={removePin}
                          onChange={(e) => {
                            setRemovePin(e.target.checked);
                            setPin("");
                          }}
                        />
                        Remove existing PIN
                      </label>
                    )}
                    <label>
                      Access expiry (end of day, UTC)
                      <input
                        type="date"
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                      />
                    </label>
                    <p className="files-muted">
                      Leave expiry blank for no expiry. Share the PIN separately
                      from the QR sign.
                    </p>
                    <div className="files-actions">
                      <button disabled={busy} onClick={() => void saveAccess()}>
                        Save access settings
                      </button>
                      <button
                        disabled={busy}
                        className="files-danger"
                        onClick={() => void saveAccess(true)}
                      >
                        Rotate link & save
                      </button>
                    </div>
                    <p>
                      <strong>
                        Saved status:{" "}
                        {data.portal.enabled
                          ? data.portal.expires_at &&
                            Date.parse(data.portal.expires_at) <= Date.now()
                            ? "Expired"
                            : "Enabled"
                          : "Disabled"}
                      </strong>
                      {data.portal.has_pin ? " · PIN protected" : " · No PIN"}
                    </p>
                    <div className="files-actions">
                      <button
                        className="files-secondary"
                        onClick={() =>
                          void run(async () => {
                            await navigator.clipboard.writeText(link);
                          }, "Contractor link copied.")
                        }
                      >
                        Copy saved link
                      </button>
                      <a
                        className="files-button files-secondary"
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open saved portal
                      </a>
                    </div>
                    <details>
                      <summary>Saved contractor link</summary>
                      <p className="files-long-link">{link}</p>
                    </details>
                  </div>
                  <div
                    className={
                      "files-qr-sign " + (printSign ? "files-print-sign" : "")
                    }
                  >
                    <span className="files-eyebrow">I/C FIELD DOCS</span>
                    <h3>{projectName}</h3>
                    {qr && (
                      <img
                        src={qr}
                        alt="Scan to open this project's published documents"
                        className="files-qr"
                      />
                    )}
                    <h3>Project documents</h3>
                    <p>
                      Scan for the current published drawings and files.
                      <br />
                      Ask your project manager for the PIN if prompted.
                    </p>
                    <p>Always check revision and issue status.</p>
                    <button
                      className="files-secondary"
                      disabled={!qr}
                      onClick={() => {
                        setPrintSign(true);
                        setTimeout(() => window.print(), 100);
                      }}
                    >
                      Print QR sign
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )
      )}
      {(modal === "upload" || modal === "edit") && (
        <Modal
          title={
            modal === "edit"
              ? "Edit document details"
              : selected
                ? `New revision · ${selected.number}`
                : "Upload a project document"
          }
          onClose={close}
        >
          {modalError && (
            <p className="files-error" role="alert">
              {modalError}
            </p>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
              <p className="files-notice">
                {modal === "edit"
                  ? "Document details apply to the published register too. Revision labels, files and issue status remain unchanged."
                  : "New uploads are private until explicitly published. Use New revision on an existing document to preserve its history."}
              </p>
              <div className="files-form-grid">
                {(!selected || modal === "edit") && (
                  <>
                    <label>
                      Document number
                      <input
                        required
                        maxLength={80}
                        value={form.number}
                        onChange={(e) =>
                          setForm({ ...form, number: e.target.value })
                        }
                        placeholder="A-101"
                      />
                    </label>
                    <label>
                      Title
                      <input
                        required
                        maxLength={200}
                        value={form.title}
                        onChange={(e) =>
                          setForm({ ...form, title: e.target.value })
                        }
                        placeholder="Ground floor plan"
                      />
                    </label>
                    <label>
                      Discipline
                      <input
                        list="file-disciplines"
                        required
                        maxLength={80}
                        value={form.discipline}
                        onChange={(e) =>
                          setForm({ ...form, discipline: e.target.value })
                        }
                      />
                      <datalist id="file-disciplines">
                        {DISCIPLINES.map((x) => (
                          <option key={x} value={x} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Document type
                      <input
                        list="file-kinds"
                        required
                        maxLength={80}
                        value={form.kind}
                        onChange={(e) =>
                          setForm({ ...form, kind: e.target.value })
                        }
                      />
                      <datalist id="file-kinds">
                        {FILE_KINDS.map((x) => (
                          <option key={x} value={x} />
                        ))}
                      </datalist>
                    </label>
                    <label className="files-full">
                      Folder label
                      <input
                        maxLength={120}
                        list="file-folders"
                        value={form.folder}
                        onChange={(e) =>
                          setForm({ ...form, folder: e.target.value })
                        }
                        placeholder="Design / Permit drawings"
                      />
                      <datalist id="file-folders">
                        {[
                          ...new Set(docs.map((d) => d.folder).filter(Boolean)),
                        ].map((f) => (
                          <option key={f} value={f} />
                        ))}
                      </datalist>
                    </label>
                  </>
                )}
                {modal === "upload" && (
                  <>
                    <label>
                      Revision label
                      <input
                        required
                        maxLength={40}
                        value={form.label}
                        onChange={(e) =>
                          setForm({ ...form, label: e.target.value })
                        }
                        placeholder="0, 1, A, B…"
                      />
                    </label>
                    <label>
                      Issue date
                      <input
                        type="date"
                        required
                        value={form.issue_date}
                        onChange={(e) =>
                          setForm({ ...form, issue_date: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Issue status
                      <select
                        value={form.issue_status}
                        onChange={(e) =>
                          setForm({ ...form, issue_status: e.target.value })
                        }
                      >
                        {ISSUE_STATUSES.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label className="files-full">
                      File (maximum 50 MB)
                      <input
                        type="file"
                        required
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.dwg,.dxf,.zip,.txt,.csv"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                      <small className="files-muted">
                        PDF is best for drawings viewed on site. CAD, Office and
                        ZIP files are downloads.
                      </small>
                    </label>
                  </>
                )}
              </div>
              <button type="submit">
                {busy
                  ? "Saving…"
                  : modal === "edit"
                    ? "Save details"
                    : "Upload private revision"}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
      {modal === "history" && selected && (
        <Modal
          title={`${selected.number} · ${selected.title}`}
          onClose={close}
          wide
        >
          {modalError && (
            <p className="files-error" role="alert">
              {modalError}
            </p>
          )}
          <p className="files-muted">
            Publishing replaces the contractor revision; earlier files remain
            here. Re-publishing an older revision is an explicit rollback.
          </p>
          <div className="files-actions">
            <button disabled={busy} onClick={() => upload(selected)}>
              New revision
            </button>
            {selected.current_revision && (
              <button
                className="files-danger"
                disabled={busy}
                onClick={() => void publication(selected)}
              >
                Unpublish document
              </button>
            )}
          </div>
          <div className="files-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Issue</th>
                  <th>Uploaded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {revs
                  .filter((r) => r.document_id === selected.id)
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>Rev {r.label}</strong>
                        <span className="files-status">
                          {r.id === selected.current_revision
                            ? "Published"
                            : r.ever_published
                              ? "Superseded / withdrawn"
                              : r.ready
                                ? "Private draft"
                                : "Upload incomplete"}
                        </span>
                        <small>
                          {r.filename} · {fileSize(r.bytes)}
                        </small>
                      </td>
                      <td>
                        {r.issue_status}
                        <small>{r.issue_date}</small>
                      </td>
                      <td>
                        {r.uploader_name}
                        <small>
                          {new Date(r.uploaded_at).toLocaleString()}
                        </small>
                      </td>
                      <td>
                        <div className="files-actions">
                          {r.ready ? (
                            <>
                              <button
                                className="files-secondary"
                                disabled={busy}
                                onClick={() => void openRevision(r, true)}
                              >
                                Open
                              </button>
                              <button
                                className="files-secondary"
                                disabled={busy}
                                onClick={() => void openRevision(r, false)}
                              >
                                Download
                              </button>
                              {r.id !== selected.current_revision && (
                                <button
                                  disabled={busy}
                                  onClick={() => void publication(selected, r)}
                                >
                                  Publish
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <button
                                disabled={busy}
                                className="files-secondary"
                                onClick={() =>
                                  void run(async () => {
                                    await api("finish", { revision: r.id });
                                    await load();
                                  }, "Upload completed. The revision remains private.")
                                }
                              >
                                Finish upload
                              </button>
                              <label>
                                Retry same file
                                <input
                                  type="file"
                                  disabled={busy}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f)
                                      void run(async () => {
                                        if (
                                          f.size !== r.bytes ||
                                          f.name !== r.filename
                                        )
                                          throw Error(
                                            "Choose the same filename and size as the reserved revision.",
                                          );
                                        await sendFile(
                                          await api("retry", {
                                            revision: r.id,
                                          }),
                                          f,
                                        );
                                        await load();
                                      }, "Upload completed. The revision remains private.");
                                  }}
                                />
                              </label>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
      {modal === "preview" && (
        <Modal title="Contractor view preview" onClose={close} wide>
          <p className="files-notice">
            Staff preview — these are the current published documents. Actual
            contractor access also requires an enabled link and PIN, when
            configured.
          </p>
          <h3>{projectName}</h3>
          {modalError && <p className="files-error">{modalError}</p>}
          <PublishedFiles
            files={preview}
            busy={busy}
            onOpen={(f, v) => void openPublished(f, v)}
          />
        </Modal>
      )}
    </section>
  );
}
