"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function SignInSummaryPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    fetchProjects();

    const today = new Date().toLocaleDateString("en-CA");
    setFromDate(today);
    setToDate(today);
  }, []);

  async function fetchProjects() {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .order("project_name");

    setProjects(data || []);
  }

  async function fetchSummary() {
    let query = supabase
      .from("trade_sign_ins")
      .select(`
        *,
        projects (
          project_name
        )
      `)
      .order("sign_in_date", { ascending: false });

    if (selectedProject) {
      query = query.eq("project_id", selectedProject);
    }

    if (fromDate) {
      query = query.gte("sign_in_date", fromDate);
    }

    if (toDate) {
      query = query.lte("sign_in_date", toDate);
    }

    const { data, error } = await query;

    if (error) {
      alert(error.message);
      return;
    }

    setRecords(data || []);
  }

  const companyTotals: Record<string, number> = {};
  const tradeTotals: Record<string, number> = {};
  const projectTotals: Record<string, number> = {};

  records.forEach((r) => {
    const company = r.company_name || "Unknown Company";
    const trade = r.trade || "No trade listed";
    const project = r.projects?.project_name || "Unknown Project";

    companyTotals[company] = (companyTotals[company] || 0) + 1;
    tradeTotals[trade] = (tradeTotals[trade] || 0) + 1;
    projectTotals[project] = (projectTotals[project] || 0) + 1;
  });

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Manpower Summary</h1>

      <section className="card">
        <h2>Filters</h2>

        <div style={{ marginBottom: 12 }}>
          <label>Project Filter</label>

          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
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

        <button onClick={fetchSummary}>Load Summary</button>
      </section>

      <section className="card">
        <h2>Total Sign-Ins: {records.length}</h2>
        <p>
          Date Range: {fromDate || "Any"} to {toDate || "Any"}
        </p>
      </section>

      <section className="card">
        <h2>Workers by Project</h2>

        {Object.keys(projectTotals).length === 0 && <p>No records loaded.</p>}

        {Object.entries(projectTotals).map(([project, total]) => (
          <p key={project}>
            <strong>{project}</strong>: {total}
          </p>
        ))}
      </section>

      <section className="card">
        <h2>Workers by Company</h2>

        {Object.keys(companyTotals).length === 0 && <p>No records loaded.</p>}

        {Object.entries(companyTotals).map(([company, total]) => (
          <p key={company}>
            <strong>{company}</strong>: {total}
          </p>
        ))}
      </section>

      <section className="card">
        <h2>Workers by Trade</h2>

        {Object.keys(tradeTotals).length === 0 && <p>No records loaded.</p>}

        {Object.entries(tradeTotals).map(([trade, total]) => (
          <p key={trade}>
            <strong>{trade}</strong>: {total}
          </p>
        ))}
      </section>

      <section className="card">
        <h2>Worker List</h2>

        {records.length === 0 && <p>No workers found for this filter.</p>}

        {records.map((r) => (
          <div
            key={r.id}
            style={{
              borderBottom: "1px solid #ddd",
              paddingBottom: 8,
              marginBottom: 8,
            }}
          >
            <p>
              <strong>{r.worker_name}</strong>
            </p>

            <p>
              {r.company_name} — {r.trade || "No trade listed"}
            </p>

            <p>
              {r.projects?.project_name || "Unknown Project"} |{" "}
              {r.sign_in_date}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
