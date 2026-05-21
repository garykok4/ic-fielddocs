"use client";

import { requireActiveStaff } from "../../../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function PrintReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [photosByReport, setPhotosByReport] = useState<Record<string, any[]>>({});
  const [profile, setProfile] = useState<any>(null);

  const [selectedProject, setSelectedProject] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    async function loadData() {
      const staffProfile = await requireActiveStaff();

      if (!staffProfile) return;

      setProfile(staffProfile);

      const today = new Date().toLocaleDateString("en-CA");
      setFromDate(today);
      setToDate(today);

      await fetchProjects(staffProfile);
      await fetchReports(staffProfile);
    }

    loadData();
  }, []);

  async function getAssignedProjectIds(staffProfile: any) {
    if (staffProfile.role === "admin") return null;

    const { data, error } = await supabase
      .from("project_staff")
      .select("project_id")
      .eq("staff_id", staffProfile.id);

    if (error) {
      alert(error.message);
      return [];
    }

    return data?.map((row: any) => row.project_id) || [];
  }

  async function fetchProjects(staffProfile: any) {
    if (staffProfile.role === "admin") {
      const { data } = await supabase
        .from("projects")
        .select("*")
        .order("project_name");

      setProjects(data || []);
      return;
    }

    const assignedProjectIds = await getAssignedProjectIds(staffProfile);

    if (!assignedProjectIds || assignedProjectIds.length === 0) {
      setProjects([]);
      return;
    }

    const { data } = await supabase
      .from("projects")
      .select("*")
      .in("id", assignedProjectIds)
      .order("project_name");

    setProjects(data || []);
  }

  async function fetchReports(staffProfile = profile) {
    if (!staffProfile) return;

    let query = supabase
      .from("daily_reports")
      .select(`
        *,
        projects (
          project_name,
          address,
          city,
          province
        )
      `)
      .order("report_date", { ascending: false });

    if (staffProfile.role !== "admin") {
      const assignedProjectIds = await getAssignedProjectIds(staffProfile);

      if (!assignedProjectIds || assignedProjectIds.length === 0) {
        setReports([]);
        return;
      }

      query = query.in("project_id", assignedProjectIds);
    }

    if (selectedProject) {
      query = query.eq("project_id", selectedProject);
    }

    if (fromDate) {
      query = query.gte("report_date", fromDate);
    }

    if (toDate) {
      query = query.lte("report_date", toDate);
    }

    const { data, error } = await query;

    if (error) {
      alert(error.message);
      return;
    }

    setReports(data || []);

    const reportIds = (data || []).map((r) => r.id);

    if (reportIds.length > 0) {
      const { data: photoData } = await supabase
        .from("attachments")
        .select("*")
        .in("report_id", reportIds);

      const grouped: Record<string, any[]> = {};

      (photoData || []).forEach((photo) => {
        if (!grouped[photo.report_id]) grouped[photo.report_id] = [];
        grouped[photo.report_id].push(photo);
      });

      setPhotosByReport(grouped);
    } else {
      setPhotosByReport({});
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Daily Site Reports Package</h1>

      {profile && (
        <p>
          Logged in as: <strong>{profile.full_name || profile.email}</strong> | Role:{" "}
          <strong>{profile.role}</strong>
        </p>
      )}

      <section className="card">
        <h2>Filters</h2>

        <div style={{ marginBottom: 12 }}>
          <label>Project</label>

          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          >
            <option value="">All Available Projects</option>

            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>From Date</label>

          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>To Date</label>

          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        <button onClick={() => fetchReports()}>
          Apply Filters
        </button>
      </section>

      <button onClick={() => window.print()}>
        Print / Save All Reports as PDF
      </button>

      {reports.length === 0 && <p>No reports found.</p>}

      {reports.map((report) => (
        <section
          key={report.id}
          className="card"
          style={{
            pageBreakAfter: "always",
          }}
        >
          <h2>{report.projects?.project_name}</h2>

          <p><strong>Address:</strong> {report.projects?.address}</p>
          <p><strong>Location:</strong> {report.projects?.city}, {report.projects?.province}</p>
          <p><strong>Report Date:</strong> {report.report_date}</p>

          <hr />

          <p><strong>Weather:</strong></p>
          <p>{report.weather || "—"}</p>

          <p><strong>Work Completed:</strong></p>
          <p>{report.work_completed || "—"}</p>

          <p><strong>Labour on Site:</strong></p>
          <p>{report.labour || "—"}</p>

          <p><strong>Issues / Delays / Notes:</strong></p>
          <p>{report.issues || "—"}</p>

          <hr />

          <h3>Photos</h3>

          {(photosByReport[report.id] || []).length === 0 && (
            <p>No photos uploaded.</p>
          )}

          {(photosByReport[report.id] || []).map((photo) => (
            <img
              key={photo.id}
              src={photo.file_url}
              alt="Report photo"
              style={{
                width: "100%",
                maxWidth: 500,
                display: "block",
                marginBottom: 16,
                borderRadius: 8,
              }}
            />
          ))}
        </section>
      ))}
    </main>
  );
}