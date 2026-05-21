"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewDailyReportPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [weather, setWeather] = useState("");
  const [workCompleted, setWorkCompleted] = useState("");
  const [labour, setLabour] = useState("");
  const [issues, setIssues] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => {
    fetchProjects();
    const today = new Date();
const localDate = today.toLocaleDateString("en-CA");
setReportDate(localDate);
  }, []);

  async function fetchProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setProjects(data || []);
  }

  async function submitReport() {
    if (!projectId) return alert("Please select a project.");
    if (!reportDate) return alert("Please enter a report date.");

    const { data: reportData, error: reportError } = await supabase
      .from("daily_reports")
      .insert([
        {
          project_id: projectId,
          report_date: reportDate,
          weather,
          work_completed: workCompleted,
          labour,
          issues,
        },
      ])
      .select()
      .single();

    if (reportError) {
      alert(reportError.message);
      return;
    }

    if (photo) {
      const filePath = `${reportData.id}/${Date.now()}-${photo.name}`;

      const { error: uploadError } = await supabase.storage
        .from("report-photos")
        .upload(filePath, photo);

      if (uploadError) {
        alert(uploadError.message);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("report-photos")
        .getPublicUrl(filePath);

      await supabase.from("attachments").insert([
        {
          report_id: reportData.id,
          file_url: publicUrlData.publicUrl,
        },
      ]);
    }

    alert("Daily report submitted.");

    setWeather("");
    setWorkCompleted("");
    setLabour("");
    setIssues("");
    setPhoto(null);
  }

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1>New Daily Site Report</h1>

      <div style={{ marginBottom: 12 }}>
        <label>Project</label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          style={{ display: "block", width: "100%", padding: 8 }}
        >
          <option value="">Select project</option>

          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Date</label>

        <input
  type="date"
  value={reportDate}
  onChange={(e) => setReportDate(e.target.value)}
  style={{ display: "block", width: "100%", padding: 8 }}
/>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Weather</label>

        <input
          value={weather}
          onChange={(e) => setWeather(e.target.value)}
          style={{ display: "block", width: "100%", padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Work Completed</label>

        <textarea
          value={workCompleted}
          onChange={(e) => setWorkCompleted(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            padding: 8,
            minHeight: 100,
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Labour</label>

        <textarea
          value={labour}
          onChange={(e) => setLabour(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            padding: 8,
            minHeight: 80,
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Issues / Notes</label>

        <textarea
          value={issues}
          onChange={(e) => setIssues(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            padding: 8,
            minHeight: 80,
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Photo</label>

        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] || null)}
          style={{ display: "block", width: "100%", padding: 8 }}
        />
      </div>

      <button onClick={submitReport} style={{ padding: "10px 18px" }}>
        Submit Daily Report
      </button>
    </main>
  );
}
