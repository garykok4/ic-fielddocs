"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function TradeSignInPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectData, setSelectedProjectData] = useState<any>(null);

  const [projectId, setProjectId] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [trade, setTrade] = useState("");
  const [phone, setPhone] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("status", "active")
      .order("project_name", { ascending: true });

    if (!error) setProjects(data || []);
  }

  async function submitSignIn() {
    if (!projectId) return alert("Please select a project.");
    if (!workerName) return alert("Please enter your name.");
    if (!companyName) return alert("Please enter your company.");

    if (!acknowledged) {
      return alert("Please acknowledge the safety confirmation.");
    }

    const { error } = await supabase.from("trade_sign_ins").insert([
      {
        project_id: projectId,
        worker_name: workerName,
        company_name: companyName,
        trade,
        phone,
        acknowledged: true,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("You are signed in.");

    setWorkerName("");
    setCompanyName("");
    setTrade("");
    setPhone("");
    setAcknowledged(false);
  }

  function handleProjectChange(value: string) {
    setProjectId(value);

    const selected = projects.find((p) => p.id === value);

    setSelectedProjectData(selected || null);
  }

  return (
    <main style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <section className="card">
        <h1>I/C Construction Inc.</h1>

        <h2>Site Sign-In</h2>

        <p>
          Please sign in before entering the work area.
        </p>
      </section>

      <section className="card">
        <label>Project</label>

        <select
          value={projectId}
          onChange={(e) => handleProjectChange(e.target.value)}
        >
          <option value="">Select project</option>

          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_name}
            </option>
          ))}
        </select>
      </section>

      {selectedProjectData && (
        <section className="card">
          <h3>Site Contact Information</h3>

          <p>
            <strong>Contact:</strong>{" "}
            {selectedProjectData.site_contact_name || "Not listed"}
          </p>

          <p>
            <strong>Phone:</strong>{" "}
            {selectedProjectData.site_contact_phone || "Not listed"}
          </p>

          <p>
            <strong>Email:</strong>{" "}
            {selectedProjectData.site_contact_email || "Not listed"}
          </p>

          <p style={{ marginTop: 20 }}>
            In case of emergency, call 911 first and notify
            site supervision immediately.
          </p>
        </section>
      )}

      <section className="card">
        <div style={{ marginBottom: 12 }}>
          <label>Name</label>

          <input
            value={workerName}
            onChange={(e) => setWorkerName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Company</label>

          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Trade</label>

          <input
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="Electrical, mechanical, concrete, etc."
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label>Phone</label>

          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontWeight: "normal",
            }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />

            I confirm I am signing in for today and will
            follow site safety requirements.
          </label>
        </div>

        <button onClick={submitSignIn}>
          Sign In
        </button>
      </section>
    </main>
  );
}
