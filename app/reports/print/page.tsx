"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function PrintReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [photosByReport, setPhotosByReport] = useState<Record<string, any[]>>({});

  const [selectedProject, setSelectedProject] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    fetchProjects();
    fetchReports();
  }, []);

  async function fetchProjects() {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .order("project_name");

    setProjects(data || []);
  }

  async function fetchReports() {
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
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Daily Site Reports Package</h1>

      <section
        style={{
          border: "1px solid #ccc",
          padding: 16,
          borderRadius: 8,
          marginBottom: 24,
        }}
      >
        <h2>Filters</h2>

        <div style={{ marginBottom: 12 }}>
          <label>Project</label>

          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8 }}
          >
            <option value="">All Projects</option>

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
            style={{ display: "block", width: "100%", padding: 8 }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>To Date</label>

          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8 }}
          />
        </div>

        <button
          onClick={fetchReports}
          style={{ padding: "10px 18px" }}
        >
          Apply Filters
        </button>
      </section>

      <button
        onClick={() => window.print()}
        style={{
          padding: "10px 18px",
          marginBottom: 20,
        }}
      >
        Print / Save All Reports as PDF
      </button>

      {reports.length === 0 && <p>No reports found.</p>}

      {reports.map((report) => (
        <section
          key={report.id}
          style={{
            border: "1px solid #ccc",
            padding: 20,
            borderRadius: 8,
            marginBottom: 24,
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