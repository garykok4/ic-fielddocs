import { supabase } from "./supabase";
export type Project = { id: string; project_name: string; address?: string };
export type Person = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};
export type ProjectTask = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  due_date: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "todo" | "in_progress" | "blocked" | "done";
  activity_id: string | null;
  revision: number;
  updated_at: string;
};
export type Comment = {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
};
export const taskLabels = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};
export async function getProjects(profile: Person) {
  const r =
    profile.role === "admin"
      ? await supabase
          .from("projects")
          .select("id,project_name")
          .order("project_name")
      : await supabase
          .from("project_staff")
          .select("projects(id,project_name)")
          .eq("staff_id", profile.id);
  if (r.error) throw r.error;
  const rows =
    profile.role === "admin"
      ? r.data
      : (r.data || []).map((r: any) => r.projects).filter(Boolean);
  return Array.from(
    new Map((rows as unknown as Project[]).map((p) => [p.id, p])).values(),
  );
}
export async function dispatchNotifications() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return false;
    const r = await fetch("/api/notifications/dispatch", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}
export async function notifySiteEvent(kind: string, recordId: string) {
  try {
    await fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, recordId }),
    });
  } catch {
    /* Saved event remains in the retry queue. */
  }
}
