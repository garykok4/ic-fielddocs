import {cleanupAIUploads} from '../../../../lib/server/ai-cleanup';
import { timingSafeEqual } from "node:crypto";
import { adminDb, deliverQueue } from "../../../../lib/server/notifications";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET,
    actual = request.headers.get("authorization") || "",
    expected = `Bearer ${secret}`;
  if (
    !secret ||
    Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = adminDb();
    const r = await db.rpc("fielddocs_enqueue_digest");
    if (r.error) throw r.error;
    const result = await deliverQueue({ limit: 25 });
    let aiCleanup: number|string;try{aiCleanup=await cleanupAIUploads();}catch{aiCleanup="Cleanup failed; retry after checking V7.8 migration and Storage.";}
    return Response.json(
      { enqueued: r.data, ...result, aiCleanup },
      { status: result.failed ? 503 : 200 },
    );
  } catch {
    return Response.json(
      {
        error:
          "Reminder run failed. Inspect notification status and server configuration.",
      },
      { status: 503 },
    );
  }
}
