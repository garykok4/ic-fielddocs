"use client";
import {readableDate,readableDateTime} from "../../lib/dates";
import ReportContent from "../../components/reports/ReportContent";

import Link from "next/link";
import { requireActiveStaff } from "../../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      const staffProfile = await requireActiveStaff();

      if (!staffProfile) return;

      setProfile(staffProfile);
      fetchReports(staffProfile);
    }

    loadData();
  }, []);

  async function fetchReports(staffProfile: any) {
    if (staffProfile.role === "admin") {
      const { data, error } = await supabase
        .from("daily_reports")
        .select(
          `
          *,
          projects (
            project_name,
            address
          )
        `,
        )
        .order("created_at", { ascending: false });

      if (error) {
        alert(error.message);
        return;
      }

      setReports(data || []);
      return;
    }

    const { data: assignedData, error: assignedError } = await supabase
      .from("project_staff")
      .select("project_id")
      .eq("staff_id", staffProfile.id);

    if (assignedError) {
      alert(assignedError.message);
      return;
    }

    const projectIds = assignedData?.map((row: any) => row.project_id) || [];

    if (projectIds.length === 0) {
      setReports([]);
      return;
    }

    const { data, error } = await supabase
      .from("daily_reports")
      .select(
        `
        *,
        projects (
          project_name,
          address
        )
      `,
      )
      .in("project_id", projectIds)
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setReports(data || []);
  }

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Daily Site Reports</h1>
      <p>
        <Link href="/reports/new">+ New daily report</Link>
      </p>

      {profile && (
        <p>
          Logged in as: <strong>{profile.full_name || profile.email}</strong> |
          Role: <strong>{profile.role}</strong>
        </p>
      )}

      {reports.length === 0 && <p>No reports submitted yet.</p>}

      {reports.map((r) => (
        <section key={r.id} className="card">
          <h2>{r.projects?.project_name || "Unknown Project"}</h2>
          <p>
            <strong>Date:</strong> {readableDate(r.report_date)}
          </p>
          <p>
            <strong>Address:</strong> {r.projects?.address}
          </p>
          <p>
            <strong>Weather:</strong> {r.weather}
          </p>
          <div>
            <strong>Work Completed:</strong>
            <ReportContent
              value={r.rich_text?.work_completed}
              text={r.work_completed}
            />
          </div>
          <div>
            <strong>Labour:</strong>
            <ReportContent value={r.rich_text?.labour} text={r.labour} />
          </div>
          <div>
            <strong>Issues / Notes:</strong>
            <ReportContent value={r.rich_text?.issues} text={r.issues} />
          </div>

          <Link href={`/reports/${r.id}`}>View Report</Link>
        </section>
      ))}
    </main>
  );
}
