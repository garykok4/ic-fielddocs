"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);

  useEffect(() => {
    checkUser();
fetchReports();
  }, []);

  async function fetchReports() {
    const { data, error } = await supabase
      .from("daily_reports")
      .select(`
        *,
        projects (
          project_name,
          address
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setReports(data || []);
  }

async function checkUser() {
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    window.location.href = "/login";
    return;
  }

}

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Daily Site Reports</h1>

      {reports.length === 0 && <p>No reports submitted yet.</p>}

      {reports.map((r) => (
        <div
          key={r.id}
          style={{
            border: "1px solid #ccc",
            padding: 16,
            marginBottom: 12,
            borderRadius: 8,
          }}
        >
          <h2>{r.projects?.project_name || "Unknown Project"}</h2>
          <p><strong>Date:</strong> {r.report_date}</p>
          <p><strong>Address:</strong> {r.projects?.address}</p>
          <p><strong>Weather:</strong> {r.weather}</p>
          <p><strong>Work Completed:</strong> {r.work_completed}</p>
          <p><strong>Labour:</strong> {r.labour}</p>
          <p><strong>Issues / Notes:</strong> {r.issues}</p>

<Link href={`/reports/${r.id}`}>View Report</Link>
        </div>
      ))}
    </main>
  );
}
