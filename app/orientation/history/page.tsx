"use client";

import { requireActiveStaff } from "../../../lib/auth";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OrientationHistoryPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState("");

  useEffect(() => {
    requireActiveStaff();
    fetchProjects();
    fetchOrientations();
  }, []);

  async function fetchProjects() {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .order("project_name");

    setProjects(data || []);
  }

  async function fetchOrientations() {
    let query = supabase
      .from("site_orientations")
      .select(`
        *,
        projects (
          project_name
        )
      `)
      .order("completed_at", { ascending: false });

    if (selectedProject) {
      query = query.eq("project_id", selectedProject);
    }

    const { data, error } = await query;

    if (error) {
      alert(error.message);
      return;
    }

    setRecords(data || []);
  }

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Orientation Records</h1>

      <section className="card">
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

        <div style={{ marginTop: 16 }}>
          <button onClick={fetchOrientations}>
            Load Records
          </button>

          <button
            onClick={() => window.print()}
            style={{ marginLeft: 12 }}
          >
            Print / Save PDF
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Total Records: {records.length}</h2>
      </section>

      {records.map((r) => (
        <section
          key={r.id}
          className="card"
          style={{
            pageBreakInside: "avoid",
          }}
        >
          <h2>{r.worker_name}</h2>

          <p>
            <strong>Company:</strong> {r.company_name}
          </p>

          <p>
            <strong>Phone:</strong> {r.phone}
          </p>

          <p>
            <strong>Project:</strong>{" "}
            {r.projects?.project_name || "Unknown"}
          </p>

          <p>
            <strong>Completed:</strong>{" "}
            {new Date(r.completed_at).toLocaleString()}
          </p>

          <hr />

          <p>✓ Site rules acknowledged</p>
          <p>✓ PPE requirements acknowledged</p>
          <p>✓ Emergency procedures acknowledged</p>
          <p>✓ Hazard reporting acknowledged</p>
          <p>✓ Daily sign-in requirements acknowledged</p>
        </section>
      ))}
    </main>
  );
}

