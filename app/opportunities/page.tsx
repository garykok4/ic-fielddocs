import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function OpportunitiesPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    redirect("/");
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Opportunities</h1>
      <p>Hidden admin-only opportunity scanner module.</p>

      <div style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2>Coming Soon</h2>
        <p>This page will track public tenders, private leads, planning applications, permits, and food processing opportunities.</p>
      </div>
    </main>
  );
}
