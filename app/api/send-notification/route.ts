import { deliverQueue } from "../../../lib/server/notifications";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  // No recipients, subject, or HTML accepted. Only an existing queued form event can be delivered.
  const raw = await request.text();
  if (raw.length > 1000)
    return Response.json({ error: "Request too large" }, { status: 413 });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    !body ||
    !["site_orientations", "trade_sign_ins", "visitor_sign_ins"].includes(
      body.kind,
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.recordId || "",
    )
  )
    return Response.json(
      { error: "A saved site event is required" },
      { status: 400 },
    );
  try {
    const result = await deliverQueue({
      event: `${body.kind}:${body.recordId}`,
      limit: 1,
    });
    return Response.json(
      { queued: true, ...result },
      { status: result.failed ? 202 : 200 },
    );
  } catch {
    return Response.json(
      {
        queued: true,
        message: "Saved events will be retried by the scheduled delivery run.",
      },
      { status: 503 },
    );
  }
}
