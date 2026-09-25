"use client";
import { useState } from "react";
import { PublishedFile, fileSize } from "../lib/project-files";
export default function PublishedFiles({
  files,
  onOpen,
  busy = false,
}: {
  files: PublishedFile[];
  onOpen: (file: PublishedFile, view: boolean) => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [discipline, setDiscipline] = useState("");
  const visible = files.filter(
    (f) =>
      (!discipline || f.discipline === discipline) &&
      `${f.number} ${f.title} ${f.kind}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="files-filters">
        <label>
          Find a document
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            {[...new Set(files.map((f) => f.discipline))].sort().map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="files-muted">
        {visible.length} current published documents · Check issue status before
        using a drawing.
      </p>
      {!visible.length ? (
        <div className="files-empty">
          {files.length
            ? "No matching documents."
            : "No documents have been published yet."}
        </div>
      ) : (
        <div className="published-grid">
          {visible.map((f) => (
            <article className="published-card" key={f.id}>
              <div className="files-row">
                <span className="files-tag">{f.discipline}</span>
                <strong>Rev {f.label}</strong>
              </div>
              <h3>
                {f.number} <span>{f.title}</span>
              </h3>
              <p>
                {f.kind} · {f.issue_date}
              </p>
              <span
                className={
                  "files-status " +
                  (f.issue_status === "Issued for Construction" ? "issued" : "")
                }
              >
                {f.issue_status}
              </span>
              <p className="files-muted">
                {f.filename} · {fileSize(f.bytes)}
              </p>
              <div className="files-actions">
                {[
                  "application/pdf",
                  "image/png",
                  "image/jpeg",
                  "image/webp",
                  "text/plain",
                ].includes(f.mime) && (
                  <button disabled={busy} onClick={() => onOpen(f, true)}>
                    View
                  </button>
                )}
                <button
                  className="files-secondary"
                  disabled={busy}
                  onClick={() => onOpen(f, false)}
                >
                  Download
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
