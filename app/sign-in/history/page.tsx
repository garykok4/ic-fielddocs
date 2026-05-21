"use client";

import { requireActiveStaff } from "../../../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function SignInHistoryPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [selectedProject, setSelectedProject] = useState("");

  useEffect(() => {
    async function loadData() {
      const staffProfile = await requireActiveStaff();

      if (!staffProfile) return;

      setProfile(staffProfile);

      await fetchProjects(staffProfile);
      await fetchRecords(staffProfile);
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

  async function fetchRecords(staffProfile = profile) {
    if (!staffProfile) return;

    let query = supabase
      .from("trade_sign_ins")
      .select(`
        *,
        projects (
          project_name
        )
      `)
      .order("created_at", { ascending: false });

    if (staffProfile.role !== "admin") {
      const assignedProjectIds = await getAssignedProjectIds(staffProfile);

      if (!assignedProjectIds || assignedProjectIds.length === 0) {
        setRecords([]);
        return;
      }

      query = query.in("project_id", assignedProjectIds);
    }

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
      <h1>Trade Sign-In History</h1>

      {profile && (
        <p>
          Logged in as: <strong>{profile.full_name || profile.email}</strong> | Role:{" "}
          <strong>{profile.role}</strong>
        </p>
      )}

      <section className="card">
        <label>Project Filter</label>

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

        <div style={{ marginTop: 16 }}>
          <button onClick={() => fetchRecords()}>
            Load Records
          </button>
        </div>
      </section>

      {records.length === 0 && <p>No sign-ins found.</p>}

      {records.map((r) => (
        <section key={r.id} className="card">
          <h2>{r.worker_name}</h2>

          <p>
            <strong>Project:</strong>{" "}
            {r.projects?.project_name || "Unknown"}
          </p>

          <p>
            <strong>Company:</strong> {r.company_name}
          </p>

          <p>
            <strong>Trade:</strong> {r.trade || "—"}
          </p>

          <p>
            <strong>Phone:</strong> {r.phone || "—"}
          </p>

          <p>
            <strong>Date:</strong> {r.sign_in_date}
          </p>
        </section>
      ))}
    </main>
  );
}