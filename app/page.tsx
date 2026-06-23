"use client";

import { requireActiveStaff } from "../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [profile, setProfile] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [projectName, setProjectName] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    async function loadData() {
      const staffProfile = await requireActiveStaff();

      if (!staffProfile) {
        window.location.href = "/login";
        return;
      }

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
        .order("created_at", { ascending: false });

      if (!error) setProjects(data || []);
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

  async function addProject() {
    if (profile?.role !== "admin") {
      alert("Only admins can add projects.");
      return;
    }

    if (!projectName) return alert("Project name is required");

    const { error } = await supabase.from("projects").insert([
      {
        project_name: projectName,
        address: address,
        city: "",
        province: "ON",
        status: "active",
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    setProjectName("");
    setAddress("");

    if (profile) fetchProjects(profile);
  }

  function openProject(projectId: string) {
    window.location.href = `/projects?project=${projectId}`;
  }

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1>I/C FieldDocs</h1>

      {profile && (
        <p>
          Logged in as: <strong>{profile.full_name || profile.email}</strong> | Role:{" "}
          <strong>{profile.role}</strong>
        </p>
      )}

      {profile?.role === "admin" && (
        <section
          style={{
            marginBottom: 32,
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
        >
          <h2>Add Project</h2>

          <input
            placeholder="Project name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              marginBottom: 8,
              padding: 8,
            }}
          />

          <input
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              marginBottom: 8,
              padding: 8,
            }}
          />

          <button onClick={addProject} style={{ padding: "8px 16px" }}>
            Add Project
          </button>
        </section>
      )}

      <section>
        <h2>Projects</h2>

        {projects.length === 0 && <p>No projects yet</p>}

        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => openProject(p.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "1px solid #ccc",
              padding: 12,
              marginBottom: 12,
              borderRadius: 8,
              background: "white",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            <h3 style={{ marginTop: 0 }}>{p.project_name}</h3>
            <p>{p.address}</p>
            <p>Status: {p.status}</p>
          </button>
        ))}
      </section>
    </main>
  );
}