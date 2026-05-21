"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
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

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Projects</h1>

      {projects.length === 0 && <p>No projects yet</p>}

      {projects.map((p) => (
        <div
          key={p.id}
          style={{
            border: "1px solid #ccc",
            padding: 16,
            marginBottom: 12,
            borderRadius: 8,
          }}
        >
          <h2>{p.project_name}</h2>
          <p>{p.address}</p>
          <p>
            {p.city}, {p.province}
          </p>
          <p>Status: {p.status}</p>
        </div>
      ))}
    </main>
  );
}
