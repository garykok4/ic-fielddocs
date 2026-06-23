"use client";

import QRCode from "qrcode";
import { requireActiveStaff } from "../../lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ProjectsPage() {
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, any>>({});

  useEffect(() => {
    async function loadData() {
      const staffProfile = await requireActiveStaff();
      if (!staffProfile) return;

      setProfile(staffProfile);
      fetchNotificationPrefs(staffProfile.id);
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

  async function generateQrCode(projectId: string) {
    const url = `${window.location.origin}/sign-in?project=${projectId}`;

    const qr = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
    });

    setQrCodes((prev) => ({
      ...prev,
      [projectId]: qr,
    }));
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
        notification_email: editingProject.notification_email,
      })
      .eq("id", editingProject.id);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Project updated.");
    setEditingProject(null);

    if (profile) fetchProjects(profile);
  }

  async function deleteProject(projectId: string, projectName: string) {
    if (profile?.role !== "admin") return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${projectName}"? This cannot be undone.`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);

    if (error) {
      alert(
        "Could not delete project. This project may already have sign-ins, reports, orientations, visitors, or other records attached to it."
      );
      return;
    }

    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }

  async function fetchNotificationPrefs(staffId: string) {
    const { data, error } = await supabase
      .from("project_notification_preferences")
      .select("*")
      .eq("staff_id", staffId);

    if (error) {
      console.error(error.message);
      return;
    }

    const prefsByProject: Record<string, any> = {};

    data?.forEach((pref: any) => {
      prefsByProject[pref.project_id] = pref;
    });

    setNotificationPrefs(prefsByProject);
  }

  async function updateNotificationPref(
    projectId: string,
    field: "notify_orientations" | "notify_sign_ins" | "notify_visitors",
    value: boolean
  ) {
    if (!profile) return;

    const existing = notificationPrefs[projectId];

    const updatedPref = {
      project_id: projectId,
      staff_id: profile.id,
      notify_orientations:
        field === "notify_orientations"
          ? value
          : existing?.notify_orientations || false,
      notify_sign_ins:
        field === "notify_sign_ins"
          ? value
          : existing?.notify_sign_ins || false,
      notify_visitors:
        field === "notify_visitors"
          ? value
          : existing?.notify_visitors || false,
    };

    const { data, error } = await supabase
      .from("project_notification_preferences")
      .upsert(updatedPref, {
        onConflict: "project_id,staff_id",
      })
      .select()
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setNotificationPrefs((prev) => ({
      ...prev,
      [projectId]: data,
    }));
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

          <div style={{ marginBottom: 12 }}>
            <label>Notification Email</label>
            <input
              value={editingProject.notification_email || ""}
              onChange={(e) =>
                setEditingProject({
                  ...editingProject,
                  notification_email: e.target.value,
                })
              }
              placeholder="pm@company.com"
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
            <strong>Site Contact:</strong> {p.site_contact_name || "Not listed"}
          </p>
          <p>
            <strong>Phone:</strong> {p.site_contact_phone || "Not listed"}
          </p>
          <p>
            <strong>Email:</strong> {p.site_contact_email || "Not listed"}
          </p>

          {profile?.role === "admin" && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <button onClick={() => setEditingProject(p)}>Edit Project</button>

              <button
                onClick={() => deleteProject(p.id, p.project_name)}
                style={{
                  background: "#b91c1c",
                  color: "white",
                  border: "none",
                  padding: "8px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Delete Project
              </button>
            </div>
          )}

          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 6,
              backgroundColor: "#fafafa",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Email Notifications</h3>

            <label
              style={{
                display: "grid",
                gridTemplateColumns: "22px 1fr",
                columnGap: 10,
                alignItems: "start",
                fontWeight: "normal",
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                checked={notificationPrefs[p.id]?.notify_orientations || false}
                onChange={(e) =>
                  updateNotificationPref(
                    p.id,
                    "notify_orientations",
                    e.target.checked
                  )
                }
                style={{ width: 18, height: 18, marginTop: 2 }}
              />
              <span>Email me when an orientation is completed.</span>
            </label>

            <label
              style={{
                display: "grid",
                gridTemplateColumns: "22px 1fr",
                columnGap: 10,
                alignItems: "start",
                fontWeight: "normal",
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                checked={notificationPrefs[p.id]?.notify_sign_ins || false}
                onChange={(e) =>
                  updateNotificationPref(
                    p.id,
                    "notify_sign_ins",
                    e.target.checked
                  )
                }
                style={{ width: 18, height: 18, marginTop: 2 }}
              />
              <span>Email me when a worker signs in.</span>
            </label>

            <label
              style={{
                display: "grid",
                gridTemplateColumns: "22px 1fr",
                columnGap: 10,
                alignItems: "start",
                fontWeight: "normal",
              }}
            >
              <input
                type="checkbox"
                checked={notificationPrefs[p.id]?.notify_visitors || false}
                onChange={(e) =>
                  updateNotificationPref(
                    p.id,
                    "notify_visitors",
                    e.target.checked
                  )
                }
                style={{ width: 18, height: 18, marginTop: 2 }}
              />
              <span>Email me when a visitor signs in.</span>
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <button onClick={() => generateQrCode(p.id)}>Generate QR Code</button>

            {qrCodes[p.id] && (
              <div style={{ marginTop: 16 }}>
                <img src={qrCodes[p.id]} alt={`QR Code for ${p.project_name}`} />
                <p style={{ fontSize: 14 }}>
                  Sign-in URL: /sign-in?project={p.id}
                </p>
              </div>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}