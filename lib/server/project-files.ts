import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { adminDb, staffFromRequest } from "./notifications";
import {
  ISSUE_STATUSES,
  MAX_FILE_BYTES,
  fileMime,
  PublishedFile,
  FileRevision,
} from "../project-files";
export async function allRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const batch = checked(await page(from, from + 499));
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
export const BUCKET = "fielddocs-project-files";
export class FileError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function checked<T>(result: {
  data: T;
  error: unknown;
}): NonNullable<T> {
  if (result.error) throw result.error;
  return result.data as NonNullable<T>;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new FileError("Invalid identifier.");
  return value;
}
export function textField(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new FileError(
      `Required text must be between 1 and ${max} characters.`,
    );
  return value.trim();
}
export function revisionInput(b: Record<string, unknown>) {
  const filename = textField(b.filename, 200).replace(
    /[\\/\x00-\x1f\x7f]/g,
    "_",
  );
  const mime = fileMime(filename);
  if (!mime)
    throw new FileError(
      "Unsupported file type. Use PDF, images, DOCX, XLSX, DWG, DXF, ZIP, TXT or CSV.",
    );
  if (
    typeof b.bytes !== "number" ||
    !Number.isInteger(b.bytes) ||
    b.bytes < 1 ||
    b.bytes > MAX_FILE_BYTES
  )
    throw new FileError("Files must be between 1 byte and 50 MB.");
  if (
    typeof b.issue_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.issue_date) ||
    !Number.isFinite(Date.parse(b.issue_date)) ||
    new Date(b.issue_date).toISOString().slice(0, 10) !== b.issue_date
  )
    throw new FileError("Choose a valid issue date.");
  if (!ISSUE_STATUSES.includes(String(b.issue_status)))
    throw new FileError("Choose an issue status.");
  return {
    label: textField(b.label, 40),
    issue_date: b.issue_date,
    issue_status: String(b.issue_status),
    filename,
    mime,
    bytes: b.bytes,
  };
}
export const newToken = () => randomBytes(32).toString("hex");
export function hashPin(pin: string) {
  if (!/^\d{6,12}$/.test(pin))
    throw new FileError("Use a PIN with 6–12 digits.");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pin, salt, 32).toString("hex");
}
export function verifyPin(pin: string, encoded: string) {
  if (!/^\d{6,12}$/.test(pin)) return false;
  const [salt, key] = encoded.split(":");
  const expected = Buffer.from(key || "", "hex");
  const actual = scryptSync(pin, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
export function failure(e: unknown) {
  if (e instanceof FileError) return json({ error: e.message }, e.status);
  const err = e as { code?: string; message?: string };
  if (err.code === "23505")
    return json(
      {
        error:
          "That document number or revision already exists. Refresh the register before trying again.",
      },
      409,
    );
  if (err.code === "P0001")
    return json(
      { error: err.message || "The record changed. Refresh and try again." },
      409,
    );
  if (
    err.code === "42P01" ||
    err.code === "PGRST202" ||
    err.code === "PGRST205"
  )
    return json(
      {
        error:
          "Project Files needs the V6 database migration. Run database/upgrade-v5-to-v6.sql.",
      },
      503,
    );
  if (err.message?.includes("configuration is incomplete"))
    return json(
      {
        error:
          "Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL on the server to enable Project Files.",
      },
      503,
    );
  return json(
    {
      error:
        "Unable to complete the file operation. Refresh and try again; check the database migration and server configuration if this continues.",
    },
    500,
  );
}
export async function body(request: Request) {
  if (Number(request.headers.get("content-length")) > 20000)
    throw new FileError("Request too large.", 413);
  const raw = await request.text();
  if (raw.length > 20000) throw new FileError("Request too large.", 413);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value as Record<string, unknown>;
  } catch {
    throw new FileError("Invalid request.");
  }
}
export async function staffAccess(request: Request, project: string) {
  const actor = await staffFromRequest(request);
  if (!actor) throw new FileError("Sign in with an active staff account.", 401);
  const db = adminDb();
  if (
    !checked(
      await db.rpc("fd_file_allowed", {
        p_project: project,
        p_actor: actor.id,
      }),
    )
  )
    throw new FileError("This project is not assigned to your account.", 403);
  const person = checked(
    await db
      .from("staff_profiles")
      .select("full_name")
      .eq("id", actor.id)
      .single(),
  );
  return { db, actor: actor.id, name: person.full_name || "Team member" };
}
export async function portalAccess(request: Request) {
  const token = request.headers.get("x-project-access") || "";
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new FileError(
      "This project link is unavailable. Ask the project manager for the current QR code.",
      403,
    );
  const db = adminDb();
  const portal = checked(
    await db
      .from("fd_portals")
      .select("*")
      .eq("token", token)
      .eq("enabled", true)
      .maybeSingle(),
  );
  if (
    !portal ||
    (portal.expires_at && Date.parse(portal.expires_at) <= Date.now())
  )
    throw new FileError(
      "This project link is unavailable. Ask the project manager for the current QR code.",
      403,
    );
  const key = createHash("sha256").update(token).digest("hex");
  if (portal.pin_hash) {
    const pin = request.headers.get("x-project-pin") || "";
    if (!pin) throw new FileError("Enter the project PIN.", 401);
    // Check the counter before expensive hashing; successes do not clear failed attempts.
    if (
      !checked(
        await db.rpc("fd_file_limit", {
          p_key: "check:" + key,
          p_max: 300,
          p_seconds: 60,
        }),
      )
    )
      throw new FileError("Too many requests. Please wait one minute.", 429);
    const counter = checked(
      await db
        .from("fd_file_limits")
        .select("count,window_start")
        .eq("key", "pin:" + key)
        .maybeSingle(),
    );
    if (
      counter &&
      counter.count > 20 &&
      Date.parse(counter.window_start) > Date.now() - 600000
    )
      throw new FileError(
        "PIN access is temporarily locked. Wait ten minutes or ask the manager to rotate the link.",
        429,
      );
    if (!verifyPin(pin, portal.pin_hash)) {
      const allowed = checked(
        await db.rpc("fd_file_limit", {
          p_key: "pin:" + key,
          p_max: 20,
          p_seconds: 600,
        }),
      );
      throw new FileError(
        allowed
          ? "Incorrect project PIN."
          : "Too many incorrect PIN attempts. Contact the project manager.",
        allowed ? 401 : 429,
      );
    }
  }
  return { db, project: portal.project_id as string };
}
export async function published(
  db: ReturnType<typeof adminDb>,
  project: string,
): Promise<PublishedFile[]> {
  const docs = await allRows((from, to) =>
    db
      .from("fd_documents")
      .select("id,number,title,discipline,kind,current_revision")
      .eq("project_id", project)
      .not("current_revision", "is", null)
      .order("id")
      .range(from, to),
  );
  if (!docs.length) return [];
  const revs: Pick<
    FileRevision,
    | "id"
    | "document_id"
    | "label"
    | "issue_date"
    | "issue_status"
    | "filename"
    | "bytes"
    | "mime"
  >[] = [];
  for (let i = 0; i < docs.length; i += 100)
    revs.push(
      ...checked(
        await db
          .from("fd_revisions")
          .select(
            "id,document_id,label,issue_date,issue_status,filename,bytes,mime",
          )
          .in(
            "id",
            docs.slice(i, i + 100).map((d) => d.current_revision),
          )
          .eq("ready", true),
      ),
    );
  return docs
    .sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true }),
    )
    .flatMap((d) => {
      const r = revs.find(
        (r) => r.id === d.current_revision && r.document_id === d.id,
      );
      return r
        ? [
            {
              id: d.id,
              revision_id: r.id,
              number: d.number,
              title: d.title,
              discipline: d.discipline,
              kind: d.kind,
              label: r.label,
              issue_date: r.issue_date,
              issue_status: r.issue_status,
              filename: r.filename,
              bytes: r.bytes,
              mime: r.mime,
            },
          ]
        : [];
    });
}
export async function download(
  db: ReturnType<typeof adminDb>,
  project: string,
  revision: string,
  contractor: boolean,
  view: boolean,
) {
  const r = checked(
    await db
      .from("fd_revisions")
      .select("*")
      .eq("id", revision)
      .eq("ready", true)
      .maybeSingle(),
  );
  if (!r) throw new FileError("File is unavailable.", 404);
  const d = checked(
    await db
      .from("fd_documents")
      .select("project_id,current_revision")
      .eq("id", r.document_id)
      .single(),
  );
  if (d.project_id !== project || (contractor && d.current_revision !== r.id))
    throw new FileError(
      "This revision is no longer published. Refresh the document list.",
      404,
    );
  const inline =
    view &&
    [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "text/plain",
    ].includes(r.mime);
  return checked(
    await db.storage
      .from(BUCKET)
      .createSignedUrl(
        r.object_path,
        60,
        inline ? {} : { download: r.filename },
      ),
  );
}
