"use client";

import { requireActiveStaff } from "../../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [editingProject, setEditingProject] = useState<any>(null);

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

  async function saveProject() {
    if (!editingProject) return;

    const { error } = await supabase
      .from("projects")
      .update({
        project_name: editingProject.project_name,
        address: editingProject.address,
        city: editingProject.city,
        province: editingProject.province,
        status: editingProject.status,
        site_contact_name: editingProject.site_contact_name,
        site_contact_phone: editingProject.site_contact_phone,
        site_contact_email: editingProject.site_contact_email,
      })
      .eq("id", editingProject.id);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Project updated.");
    setEditingProject(null);

    if (profile) {
      fetchProjects(profile);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Projects</h1>

      {profile && (
        <p>
          Logged in as: <strong>{profile.full_name || profile.email}</strong> | Role:{" "}
          <strong>{profile.role}</strong>
        </p>
      )}

      {editingProject && profile?.role === "admin" && (
        <section className="card">
          <h2>Edit Project</h2>

          <div style={{ marginBottom: 12 }}>
            <label>Project Name</label>
            <input
              value={editingProject.project_name || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  project_name: e.target.value,
                })
              }
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Address</label>
            <input
              value={editingProject.address || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  address: e.target.value,
                })
              }
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>City</label>
            <input
              value={editingProject.city || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  city: e.target.value,
                })
              }
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Province</label>
            <input
              value={editingProject.province || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  province: e.target.value,
                })
              }
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Status</label>
            <select
              value={editingProject.status || "active"}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  status: e.target.value,
                })
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="complete">Complete</option>
            </select>
          </div>

          <hr />

          <h3>Site Contact Info</h3>

          <div style={{ marginBottom: 12 }}>
            <label>Site Contact Name</label>
            <input
              value={editingProject.site_contact_name || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  site_contact_name: e.target.value,
                })
              }
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Site Contact Phone</label>
            <input
              value={editingProject.site_contact_phone || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  site_contact_phone: e.target.value,
                })
              }
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Site Contact Email</label>
            <input
              value={editingProject.site_contact_email || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  site_contact_email: e.target.value,
                })
              }
            />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={saveProject}>Save Project</button>
            <button onClick={() => setEditingProject(null)}>Cancel</button>
          </div>
        </section>
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

          <hr />

          <p>
            <strong>Site Contact:</strong>{" "}
            {p.site_contact_name || "Not listed"}
          </p>
          <p>
            <strong>Phone:</strong>{" "}
            {p.site_contact_phone || "Not listed"}
          </p>
          <p>
            <strong>Email:</strong>{" "}
            {p.site_contact_email || "Not listed"}
          </p>

          {profile?.role === "admin" && (
            <button onClick={() => setEditingProject(p)}>
              Edit Project
            </button>
          )}
        </section>
      ))}
    </main>
  );
}