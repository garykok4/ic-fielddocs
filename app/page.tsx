"use client";

import { requireActiveStaff } from "../lib/auth";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [user, setUser] = useState<any>(null);
const [projects, setProjects] = useState<any[]>([]);
  const [projectName, setProjectName] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    requireActiveStaff();
    checkUser();
fetchProjects();
  }, []);

  async function fetchProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setProjects(data || []);
  }

async function checkUser() {
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    window.location.href = "/login";
    return;
  }

}

  async function addProject() {
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
    fetchProjects();
  }

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1>I/C FieldDocs</h1>

      <section style={{ marginBottom: 32, padding: 16, border: "1px solid #ddd" }}>
        <h2>Add Project</h2>

        <input
          placeholder="Project name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          style={{ display: "block", width: "100%", marginBottom: 8, padding: 8 }}
        />

        <input
          placeholder="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{ display: "block", width: "100%", marginBottom: 8, padding: 8 }}
        />

        <button onClick={addProject} style={{ padding: "8px 16px" }}>
          Add Project
        </button>
      </section>

      <section>
        <h2>Projects</h2>

        {projects.length === 0 && <p>No projects yet</p>}

        {projects.map((p) => (
          <div
            key={p.id}
            style={{
              border: "1px solid #ccc",
              padding: 12,
              marginBottom: 12,
              borderRadius: 8,
            }}
          >
            <h3>{p.project_name}</h3>
            <p>{p.address}</p>
            <p>Status: {p.status}</p>
          </div>
        ))}
      </section>
    </main>
  );
}


