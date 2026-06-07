"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabase";

function OrientationPageContent() {
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");

  const [siteRules, setSiteRules] = useState(false);
  const [ppe, setPpe] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [dailySignIn, setDailySignIn] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    const projectFromUrl = searchParams.get("project");

    if (projectFromUrl) {
      setProjectId(projectFromUrl);
    }
  }, [searchParams]);

  async function fetchProjects() {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("status", "active")
      .order("project_name", { ascending: true });

    setProjects(data || []);
  }

  function normalizePhone(value: string) {
    return value.replace(/\D/g, "");
  }

  async function submitOrientation() {
    if (!projectId) return alert("Please select a project.");
    if (!workerName) return alert("Please enter your name.");
    if (!companyName) return alert("Please enter your company.");
    if (!phone) return alert("Please enter your phone number.");

    if (!siteRules || !ppe || !emergency || !reporting || !dailySignIn) {
      return alert("Please acknowledge all orientation items.");
    }

    const cleanPhone = normalizePhone(phone);

    const { error } = await supabase.from("site_orientations").insert([
      {
        project_id: projectId,
        worker_name: workerName,
        company_name: companyName,
        phone: cleanPhone,
        acknowledged_site_rules: true,
        acknowledged_ppe: true,
        acknowledged_emergency: true,
        acknowledged_reporting: true,
        acknowledged_daily_sign_in: true,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Orientation complete. You may now use the site sign-in page.");

    window.location.href = `/sign-in?project=${projectId}`;
  }

  return (
    <main style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <section className="card">
        <h1>I/C Construction Inc.</h1>

        <h2>Site Orientation</h2>

        <p>Complete this orientation before signing in to the project site.</p>
      </section>

      <section className="card">
        <div style={{ marginBottom: 12 }}>
          <label>Project</label>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
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
          <label>Phone</label>

          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </section>

      <section className="card">
        <h2>Orientation Acknowledgements</h2>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontWeight: "normal",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={siteRules}
            onChange={(e) => setSiteRules(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />

          I have reviewed the site rules and understand site expectations.
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontWeight: "normal",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={ppe}
            onChange={(e) => setPpe(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />

          I understand the required PPE for this project.
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontWeight: "normal",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={emergency}
            onChange={(e) => setEmergency(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />

          I understand emergency procedures and site contact information.
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontWeight: "normal",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={reporting}
            onChange={(e) => setReporting(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />

          I will report hazards, incidents, injuries, and near misses
          immediately.
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontWeight: "normal",
            marginBottom: 20,
          }}
        >
          <input
            type="checkbox"
            checked={dailySignIn}
            onChange={(e) => setDailySignIn(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />

          I understand I must sign in each day before entering the work area.
        </label>

        <button onClick={submitOrientation}>Complete Orientation</button>
      </section>
    </main>
  );
}

export default function OrientationPage() {
  return (
    <Suspense
      fallback={<main style={{ padding: 24 }}>Loading orientation...</main>}
    >
      <OrientationPageContent />
    </Suspense>
  );
}