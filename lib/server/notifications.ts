import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { createHash } from "node:crypto";
export function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw Error("Server notification configuration is incomplete.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function staffFromRequest(request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const db = adminDb();
  const { data, error } = await db.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  const r = await db
    .from("staff_profiles")
    .select("id,role,active")
    .eq("id", data.user.id)
    .eq("active", true)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function siteUrl() {
  const raw = process.env.FIELDDOCS_APP_URL;
  if (!raw) throw Error("FIELDDOCS_APP_URL is required.");
  const url = new URL(raw);
  if (url.protocol !== "https:")
    throw Error("FIELDDOCS_APP_URL must use HTTPS.");
  return url.origin;
}
const configs: Record<string, { title: string; pref: string; name: string }> = {
  site_orientations: {
    title: "Site orientation completed",
    pref: "notify_orientations",
    name: "worker_name",
  },
  trade_sign_ins: {
    title: "Site sign-in",
    pref: "notify_sign_ins",
    name: "worker_name",
  },
  visitor_sign_ins: {
    title: "Visitor sign-in",
    pref: "notify_visitors",
    name: "visitor_name",
  },
};
type Queue = {
  id: string;
  event_key: string;
  kind: string;
  project_id: string | null;
  recipient_id: string | null;
  payload: Record<string, string>;
  attempts: number;
  created_at: string;
};
type Message = { to: string[]; subject: string; html: string };
async function buildMessage(
  db: ReturnType<typeof adminDb>,
  q: Queue,
): Promise<Message | null> {
  const base = siteUrl();
  if (q.kind === "assignment" || q.kind === "digest") {
    const pr = await db
      .from("staff_profiles")
      .select("id,full_name,email,active,role")
      .eq("id", q.recipient_id)
      .maybeSingle();
    if (pr.error) throw pr.error;
    const person = pr.data;
    if (!person?.active || !person.email) return null;
    let query = db
      .from("project_tasks")
      .select("id,project_id,title,due_date,status,priority,assignee_id")
      .eq("assignee_id", person.id)
      .neq("status", "done");
    if (q.kind === "assignment") query = query.eq("id", q.payload.task_id);
    else {
      const d = q.payload.date;
      const current = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
      }).format(new Date());
      if (d !== current) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
      const end = new Date(d + "T12:00:00Z");
      end.setUTCDate(end.getUTCDate() + 7);
      query = query.lte("due_date", end.toISOString().slice(0, 10));
    }
    const tr = await query.order("due_date", {
      ascending: true,
      nullsFirst: false,
    });
    if (tr.error) throw tr.error;
    let tasks = tr.data || [];
    if (person.role !== "admin") {
      const ar = await db
        .from("project_staff")
        .select("project_id")
        .eq("staff_id", person.id);
      if (ar.error) throw ar.error;
      const allowed = new Set((ar.data || []).map((a) => a.project_id));
      tasks = tasks.filter((t) => allowed.has(t.project_id));
    }
    if (!tasks.length) return null;
    const projects = await db
      .from("projects")
      .select("id,project_name")
      .in("id", [...new Set(tasks.map((t) => t.project_id))]);
    if (projects.error) throw projects.error;
    const title =
      q.kind === "assignment"
        ? "A task has been assigned to you"
        : "Your Field Docs task reminder";
    return {
      to: [person.email.trim().toLowerCase()],
      subject: title,
      html: `<h2>${title}</h2><p>Hello ${escape(person.full_name)},</p><ul>${tasks.map((t) => `<li><strong>${escape(t.title)}</strong> — ${escape(projects.data?.find((p) => p.id === t.project_id)?.project_name)}<br>Due: ${escape(t.due_date || "Not set")} · ${escape(t.priority)} · ${escape(t.status.replaceAll("_", " "))}<br><a href="${base}/projects/${encodeURIComponent(t.project_id)}?tab=tasks">Open project tasks</a></li>`).join("")}</ul><p><a href="${base}/tasks">View all my tasks</a></p>`,
    };
  }
  const config = configs[q.kind];
  if (!config || !q.project_id) return null;
  const [record, project, preferences, staff, assignments] = await Promise.all([
    db
      .from(q.kind)
      .select("*")
      .eq("id", q.payload.record_id)
      .eq("project_id", q.project_id)
      .maybeSingle(),
    db
      .from("projects")
      .select("id,project_name,notification_email")
      .eq("id", q.project_id)
      .maybeSingle(),
    db
      .from("project_notification_preferences")
      .select("*")
      .eq("project_id", q.project_id),
    db.from("staff_profiles").select("id,email,active,role"),
    db.from("project_staff").select("staff_id").eq("project_id", q.project_id),
  ]);
  for (const r of [record, project, preferences, staff, assignments])
    if (r.error) throw r.error;
  if (!record.data || !project.data) return null;
  const allowed = new Set((assignments.data || []).map((a) => a.staff_id));
  const prefs = preferences.data || [],
    people = staff.data || [],
    recipients = new Set<string>();
  for (const p of people) {
    const pref = prefs.find((x) => x.staff_id === p.id);
    if (
      p.active &&
      (p.role === "admin" || allowed.has(p.id)) &&
      p.email &&
      pref?.[config.pref] === true
    )
      recipients.add(p.email.trim().toLowerCase());
  }
  // Keep the configured site mailbox, but honor an explicit opt-out if it belongs to staff.
  for (const raw of String(project.data.notification_email || "").split(
    /[;,]/,
  )) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    const owner = people.find(
      (p) => String(p.email || "").toLowerCase() === email,
    );
    if (
      owner &&
      (!owner.active ||
        (owner.role !== "admin" && !allowed.has(owner.id)) ||
        prefs.find((p) => p.staff_id === owner.id)?.[config.pref] === false)
    )
      continue;
    recipients.add(email);
  }
  const r = record.data;
  let assessmentDetails = "";
  if (q.kind === "trade_sign_ins" && r.daily_hazard_assessment_id) {
    const assessment = await db
      .from("daily_hazard_assessments")
      .select("crew_size,work_activity,controls,additional_notes")
      .eq("id", r.daily_hazard_assessment_id)
      .eq("project_id", q.project_id)
      .maybeSingle();
    if (assessment.error) throw assessment.error;
    if (assessment.data) {
      const a = assessment.data;
      assessmentDetails = `<h3>Daily hazard assessment</h3><p>Crew size: ${escape(a.crew_size)}</p><p>Work activity: ${escape(a.work_activity)}</p><p>Controls: ${escape(a.controls)}</p><p>Notes: ${escape(a.additional_notes || "None")}</p>`;
    }
  }
  return {
    to: [...recipients],
    subject: `${config.title} — ${project.data.project_name}`,
    html: `<h2>${config.title}</h2><p>Project: ${escape(project.data.project_name)}</p><p>Name: ${escape(r[config.name])}</p><p>Company: ${escape(r.company_name || "Not listed")}</p><p>Phone: ${escape(r.phone || "Not listed")}</p>${q.kind === "trade_sign_ins" ? `<p>Role: ${escape(r.worker_role)}</p><p>Supervisor: ${escape(r.supervisor_name || "Not listed")}</p>${assessmentDetails}` : ""}${q.kind === "visitor_sign_ins" ? `<p>Reason: ${escape(r.reason_for_visit)}</p><p>Meeting: ${escape(r.person_meeting)}</p>` : ""}<p><a href="${base}/projects/${encodeURIComponent(q.project_id)}">Open project</a></p>`,
  };
}
export async function deliverQueue({
  event,
  actor,
  limit = 10,
}: { event?: string; actor?: string; limit?: number } = {}) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM)
    throw Error(
      "Set RESEND_API_KEY and RESEND_FROM to enable notification delivery.",
    );
  siteUrl();
  const db = adminDb();
  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0,
    skipped = 0,
    failed = 0,
    processed = 0;
  const deadline = Date.now() + 40000;
  while (processed < limit && Date.now() < deadline) {
    const claimed = await db.rpc("fielddocs_claim_email", {
      p_event: event || null,
      p_actor: actor || null,
      p_limit: 1,
    });
    if (claimed.error) throw claimed.error;
    const q = claimed.data?.[0] as Queue | undefined;
    if (!q) break;
    processed++;
    try {
      const msg = await buildMessage(db, q);
      if (!msg?.to.length) {
        const r = await db
          .from("fielddocs_email_queue")
          .update({ status: "skipped", lease_until: null, last_error: null })
          .eq("id", q.id);
        if (r.error) throw r.error;
        skipped++;
        continue;
      }
      for (const to of msg.to) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
          throw Error("A configured recipient email is invalid.");
        const key = createHash("sha256")
          .update(q.id + ":" + to)
          .digest("hex");
        const inserted = await db.from("fielddocs_email_deliveries").upsert(
          {
            id: key,
            event_id: q.id,
            email: to,
            message: {
              from: process.env.RESEND_FROM,
              to,
              subject: msg.subject,
              html: msg.html,
            },
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (inserted.error) throw inserted.error;
        const existing = await db
          .from("fielddocs_email_deliveries")
          .select("*")
          .eq("id", key)
          .single();
        if (existing.error) throw existing.error;
        if (existing.data.sent_at) continue;
        // Do not automatically resend an uncertain provider attempt after its 24h deduplication window.
        if (
          existing.data.attempted_at &&
          Date.now() - Date.parse(existing.data.attempted_at) > 23 * 3600000
        )
          throw Error(
            "Delivery outcome uncertain after 23 hours; review provider logs before retrying.",
          );
        if (!existing.data.attempted_at) {
          const r = await db
            .from("fielddocs_email_deliveries")
            .update({ attempted_at: new Date().toISOString() })
            .eq("id", key);
          if (r.error) throw r.error;
        }
        const result = await resend.emails.send(existing.data.message, {
          idempotencyKey: `fielddocs-${key}`,
        });
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (result.error) throw Error(result.error.message);
        const saved = await db
          .from("fielddocs_email_deliveries")
          .update({
            sent_at: new Date().toISOString(),
            provider_id: result.data?.id,
          })
          .eq("id", key);
        if (saved.error) throw saved.error;
      }
      const done = await db
        .from("fielddocs_email_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          lease_until: null,
          last_error: null,
        })
        .eq("id", q.id);
      if (done.error) throw done.error;
      sent++;
    } catch (e) {
      failed++;
      const message = (e as Error).message;
      const terminal = q.attempts >= 5 || message.includes("outcome uncertain");
      const r = await db
        .from("fielddocs_email_queue")
        .update({
          status: terminal ? "failed" : "pending",
          lease_until: null,
          last_error: message.slice(0, 300),
          available_at: new Date(
            Date.now() + Math.min(q.attempts * 5, 60) * 60000,
          ).toISOString(),
        })
        .eq("id", q.id);
      if (r.error) throw r.error;
    }
  }
  return { sent, skipped, failed, processed };
}
