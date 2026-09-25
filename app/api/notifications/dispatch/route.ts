import {
  deliverQueue,
  staffFromRequest,
} from "../../../../lib/server/notifications";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const staff = await staffFromRequest(request);
    if (!staff)
      return Response.json(
        { error: "Active staff authentication required" },
        { status: 401 },
      );
    const result = await deliverQueue({ actor: staff.id });
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch {
    return Response.json(
      {
        error: "Notifications remain queued. Check server email configuration.",
      },
      { status: 503 },
    );
  }
}
