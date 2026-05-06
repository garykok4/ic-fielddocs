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

  useEffect(() => {
    fetchProjects();
    setReportDate(new Date().toISOString().split("T")[0]);
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

    const { error } = await supabase.from("daily_reports").insert([
      {
        project_id: projectId,
        report_date: reportDate,
        weather,
        work_completed: workCompleted,
        labour,
        issues,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Daily report submitted.");

    setWeather("");
    setWorkCompleted("");
    setLabour("");
    setIssues("");
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
          placeholder="Sunny, cloudy, rain, temperature, etc."
          style={{ display: "block", width: "100%", padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Work Completed Today</label>
        <textarea
          value={workCompleted}
          onChange={(e) => setWorkCompleted(e.target.value)}
          style={{ display: "block", width: "100%", padding: 8, minHeight: 100 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Labour on Site</label>
        <textarea
          value={labour}
          onChange={(e) => setLabour(e.target.value)}
          placeholder="Example: I/C - 2 workers, Stubbe's - 4 workers"
          style={{ display: "block", width: "100%", padding: 8, minHeight: 80 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Issues / Delays / Notes</label>
        <textarea
          value={issues}
          onChange={(e) => setIssues(e.target.value)}
          style={{ display: "block", width: "100%", padding: 8, minHeight: 80 }}
        />
      </div>

      <button onClick={submitReport} style={{ padding: "10px 18px" }}>
        Submit Daily Report
      </button>
    </main>
  );
}