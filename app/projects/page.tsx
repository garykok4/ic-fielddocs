"use client";

import { requireActiveStaff } from "../../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      const staffProfile = await requireActiveStaff();

      if (!staffProfile) return;

      setProfile(staffProfile);

      fetchProjects(staffProfile);
    }

    loadData();
  }, []);

  async function fetchProjects(staffProfile: any) {
    if (staffProfile.role === "admin") {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("project_name", { ascending: true });

      if (error) {
        alert(error.message);
        return;
      }

      setProjects(data || []);
      return;
    }

    const { data, error } = await supabase
      .from("project_staff")
      .select(`
        projects (
          *
        )
      `)
      .eq("staff_id", staffProfile.id);

    if (error) {
      alert(error.message);
      return;
    }

    const assignedProjects =
      data?.map((row: any) => row.projects).filter(Boolean) || [];

    setProjects(assignedProjects);
  }

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Projects</h1>

      {profile && (
        <p>
          Logged in as: <strong>{profile.full_name || profile.email}</strong> | Role:{" "}
          <strong>{profile.role}</strong>
        </p>
      )}

      {projects.length === 0 && <p>No projects available.</p>}

      {projects.map((p) => (
        <section key={p.id} className="card">
          <h2>{p.project_name}</h2>
          <p>{p.address}</p>
          <p>
            {p.city}, {p.province}
          </p>
          <p>Status: {p.status}</p>
        </section>
      ))}
    </main>
  );
}