import { FileRevision } from "../../../lib/project-files";
import { randomUUID } from "node:crypto";
import {
  allRows,
  body,
  BUCKET,
  checked,
  download,
  failure,
  FileError,
  hashPin,
  json,
  newToken,
  published,
  revisionInput,
  staffAccess,
  textField,
  uuid,
} from "../../../lib/server/project-files";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const b = await body(request),
      project = uuid(b.project),
      { db, actor, name } = await staffAccess(request, project);
    const action = b.action;
    if (action === "list") {
      checked(
        await db
          .from("fd_portals")
          .upsert(
            { project_id: project, token: newToken() },
            { onConflict: "project_id", ignoreDuplicates: true },
          ),
      );
      const documents = await allRows((from, to) =>
        db
          .from("fd_documents")
          .select("*")
          .eq("project_id", project)
          .order("id")
          .range(from, to),
      );
      documents.sort((a, b) =>
        a.number.localeCompare(b.number, undefined, { numeric: true }),
      );
      const revisions: FileRevision[] = [];
      for (let i = 0; i < documents.length; i += 100)
        revisions.push(
          ...(await allRows((from, to) =>
            db
              .from("fd_revisions")
              .select(
                "id,document_id,label,issue_date,issue_status,filename,bytes,mime,uploaded_by,uploader_name,uploaded_at,ready,ever_published",
              )
              .in(
                "document_id",
                documents.slice(i, i + 100).map((d) => d.id),
              )
              .order("id")
              .range(from, to),
          )),
        );
      revisions.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
      const audit = checked(
        await db
          .from("fd_file_audit")
          .select("id,document_id,revision_id,action,actor_name,created_at")
          .eq("project_id", project)
          .order("created_at", { ascending: false })
          .limit(500),
      );
      const p = checked(
        await db
          .from("fd_portals")
          .select("*")
          .eq("project_id", project)
          .single(),
      );
      return json({
        documents,
        revisions,
        audit,
        portal: {
          token: p.token,
          enabled: p.enabled,
          has_pin: !!p.pin_hash,
          expires_at: p.expires_at,
          version: p.version,
        },
      });
    }
    if (action === "preview")
      return json({ files: await published(db, project) });
    if (action === "download")
      return json(
        await download(db, project, uuid(b.revision), false, b.view === true),
      );
    if (action === "portal") {
      const p = checked(
        await db
          .from("fd_portals")
          .select("*")
          .eq("project_id", project)
          .single(),
      );
      const expires = b.expires_at ? String(b.expires_at) : null;
      if (
        expires &&
        (!Number.isFinite(Date.parse(expires)) ||
          Date.parse(expires) <= Date.now())
      )
        throw new FileError("Expiry must be a future date.");
      if (typeof b.enabled !== "boolean" || !Number.isInteger(b.version))
        throw new FileError("Invalid access settings.");
      const pin =
        b.remove_pin === true
          ? null
          : b.pin
            ? hashPin(String(b.pin))
            : p.pin_hash;
      checked(
        await db.rpc("fd_portal_save", {
          p_project: project,
          p_actor: actor,
          p_version: b.version,
          p_token: b.rotate === true ? newToken() : p.token,
          p_enabled: b.enabled,
          p_pin: pin,
          p_expiry: expires,
        }),
      );
      return json({ ok: true });
    }
    if (action === "upload") {
      const input = revisionInput(b);
      let doc;
      if (b.document) {
        doc = checked(
          await db
            .from("fd_documents")
            .select("*")
            .eq("id", uuid(b.document))
            .eq("project_id", project)
            .single(),
        );
      } else {
        const values = {
          project_id: project,
          number: textField(b.number, 80),
          title: textField(b.title, 200),
          discipline: textField(b.discipline, 80),
          kind: textField(b.kind, 80),
          folder:
            typeof b.folder === "string" ? b.folder.trim().slice(0, 120) : "",
        };
        doc = checked(
          await db.from("fd_documents").insert(values).select("*").single(),
        );
      }
      const id = randomUUID(),
        path = `${project}/${doc.id}/${id}/${input.filename}`;
      checked(
        await db.from("fd_revisions").insert({
          id,
          document_id: doc.id,
          ...input,
          object_path: path,
          uploaded_by: actor,
          uploader_name: name,
        }),
      );
      const signed = checked(
        await db.storage
          .from(BUCKET)
          .createSignedUploadUrl(path, { upsert: false }),
      );
      return json({ id, ...signed, mime: input.mime });
    }
    if (["publish", "unpublish", "metadata"].includes(String(action))) {
      const d = checked(
        await db
          .from("fd_documents")
          .select("*")
          .eq("id", uuid(b.document))
          .eq("project_id", project)
          .single(),
      );
      if (!Number.isInteger(b.version))
        throw new FileError("Refresh the document first.");
      if (action === "metadata") {
        checked(
          await db.rpc("fd_file_metadata", {
            p_document: d.id,
            p_actor: actor,
            p_version: b.version,
            p_number: textField(b.number, 80),
            p_title: textField(b.title, 200),
            p_discipline: textField(b.discipline, 80),
            p_kind: textField(b.kind, 80),
            p_folder:
              typeof b.folder === "string" ? b.folder.trim().slice(0, 120) : "",
          }),
        );
      } else
        checked(
          await db.rpc("fd_file_publish", {
            p_document: d.id,
            p_revision: action === "unpublish" ? null : uuid(b.revision),
            p_version: b.version,
            p_actor: actor,
          }),
        );
      return json({ ok: true });
    }
    if (action === "finish" || action === "retry") {
      const r = checked(
        await db
          .from("fd_revisions")
          .select("*")
          .eq("id", uuid(b.revision))
          .single(),
      );
      const d = checked(
        await db
          .from("fd_documents")
          .select("project_id")
          .eq("id", r.document_id)
          .single(),
      );
      if (d.project_id !== project)
        throw new FileError("Project access required.", 403);
      if (r.ready) return json({ ok: true, ready: true });
      if (action === "retry")
        return json({
          id: r.id,
          ...checked(
            await db.storage
              .from(BUCKET)
              .createSignedUploadUrl(r.object_path, { upsert: false }),
          ),
          mime: r.mime,
        });
      const info = await db.storage.from(BUCKET).info(r.object_path);
      if (info.error)
        throw new FileError("The upload is incomplete. Retry the file upload.");
      if (
        Number(info.data.size ?? info.data.metadata?.size) !==
          Number(r.bytes) ||
        (info.data.contentType || info.data.metadata?.mimetype)?.split(
          ";",
        )[0] !== r.mime
      )
        throw new FileError(
          "The uploaded file does not match its reserved size or type. Contact your administrator.",
        );
      checked(
        await db.rpc("fd_file_finish", { p_revision: r.id, p_actor: actor }),
      );
      return json({ ok: true });
    }
    throw new FileError("Unknown file operation.");
  } catch (e) {
    return failure(e);
  }
}
