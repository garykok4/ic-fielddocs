"use client";

import { requireActiveStaff } from "../../../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function ProjectStaffPage() {
  const [profile, setProfile] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);

  const [selectedProject, setSelectedProject] = useState("");
  const [selectedStaff, setSelectedStaff] = useState("");

  useEffect(() => {
    async function loadData() {
      const staffProfile = await requireActiveStaff();

      if (!staffProfile) return;

      if (staffProfile.role !== "admin") {
        alert("Admin access required.");
        window.location.href = "/";
        return;
      }

      setProfile(staffProfile);

      fetchProjects();
      fetchStaff();
      fetchAssignments();
    }

    loadData();
  }, []);

  async function fetchProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("project_name");

    if (error) {
      alert(error.message);
      return;
    }

    setProjects(data || []);
  }

  async function fetchStaff() {
    const { data, error } = await supabase
      .from("staff_profiles")
      .select("*")
      .eq("active", true)
      .order("full_name");

    if (error) {
      alert(error.message);
      return;
    }

    setStaff(data || []);
  }

  async function fetchAssignments() {
    const { data, error } = await supabase
      .from("project_staff")
      .select(`
        *,
        projects (
          project_name
        ),
        staff_profiles (
          full_name,
          email,
          role
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setAssignments(data || []);
  }

  async function assignStaff() {
    if (!selectedProject) return alert("Please select a project.");
    if (!selectedStaff) return alert("Please select a staff member.");

    const { error } = await supabase.from("project_staff").insert([
      {
        project_id: selectedProject,
        staff_id: selectedStaff,
        role: "pm",
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Staff assigned to project.");

    setSelectedProject("");
    setSelectedStaff("");
    fetchAssignments();
  }

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Project Staff Assignments</h1>

      {profile && (
        <p>
          Logged in as: <strong>{profile.full_name || profile.email}</strong>
        </p>
      )}

      <section className="card">
        <h2>Assign Staff to Project</h2>

        <div style={{ marginBottom: 12 }}>
          <label>Project</label>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
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
          <label>Staff Member</label>
          <select
            value={selectedStaff}
            onChange={(e) => setSelectedStaff(e.target.value)}
          >
            <option value="">Select staff member</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name || s.email} — {s.role}
              </option>
            ))}
          </select>
        </div>

        <button onClick={assignStaff}>Assign to Project</button>
      </section>

      <section className="card">
        <h2>Current Assignments</h2>

        {assignments.length === 0 && <p>No assignments yet.</p>}

        {assignments.map((a) => (
          <div
            key={a.id}
            style={{
              borderBottom: "1px solid #ddd",
              paddingBottom: 10,
              marginBottom: 10,
            }}
          >
            <p>
              <strong>{a.staff_profiles?.full_name || a.staff_profiles?.email}</strong>
            </p>
            <p>Project: {a.projects?.project_name}</p>
            <p>Role: {a.role}</p>
          </div>
        ))}
      </section>
    </main>
  );
}