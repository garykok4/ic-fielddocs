import {
  adminDb,
  staffFromRequest,
} from "../../../../lib/server/notifications";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const p = await staffFromRequest(request);
    if (!p || p.role !== "admin")
      return Response.json(
        { error: "Administrator access required" },
        { status: 403 },
      );
    const db = adminDb(),
      statuses = ["pending", "sending", "sent", "skipped", "failed"];
    const counts = await Promise.all(
      statuses.map(async (status) => {
        const r = await db
          .from("fielddocs_email_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        if (r.error) throw r.error;
        return [status, r.count || 0];
      }),
    );
    const recent = await db
      .from("fielddocs_email_queue")
      .select("id,kind,status,attempts,last_error,created_at,sent_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (recent.error) throw recent.error;
    return Response.json(
      {
        configuration: {
          emailKey: !!process.env.RESEND_API_KEY,
          sender: !!process.env.RESEND_FROM,
          appUrl: !!process.env.FIELDDOCS_APP_URL,
          cronSecret: !!process.env.CRON_SECRET,
        },
        counts: Object.fromEntries(counts),
        recent: recent.data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Notification status unavailable. Check the V5 migration and server configuration.",
      },
      { status: 503 },
    );
  }
}
