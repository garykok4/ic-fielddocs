import {
  body,
  checked,
  download,
  failure,
  FileError,
  json,
  portalAccess,
  published,
  uuid,
} from "../../../lib/server/project-files";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const b = await body(request),
      { db, project } = await portalAccess(request);
    if (b.action === "list") {
      const p = checked(
        await db
          .from("projects")
          .select("project_name")
          .eq("id", project)
          .single(),
      );
      return json({
        project_name: p.project_name,
        files: await published(db, project),
        refreshed_at: new Date().toISOString(),
      });
    }
    if (b.action === "download")
      return json(
        await download(db, project, uuid(b.revision), true, b.view === true),
      );
    throw new FileError("Unknown file operation.");
  } catch (e) {
    return failure(e);
  }
}
