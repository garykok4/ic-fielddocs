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
  const [truthfulInfo, setTruthfulInfo] = useState(false);

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

    if (
      !siteRules ||
      !ppe ||
      !emergency ||
      !reporting ||
      !dailySignIn ||
      !truthfulInfo
    ) {
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

const selectedProject = projects.find((p) => p.id === projectId);

if (selectedProject?.notification_email) {
  await fetch("/api/send-notification", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: selectedProject.notification_email,
      subject: `New Site Orientation - ${selectedProject.project_name}`,
      html: `
        <h2>New Site Orientation Completed</h2>
        <p><strong>Project:</strong> ${selectedProject.project_name}</p>
        <p><strong>Worker:</strong> ${workerName}</p>
        <p><strong>Company:</strong> ${companyName}</p>
        <p><strong>Phone:</strong> ${cleanPhone}</p>
      `,
    }),
  });
}

alert("Orientation complete. You may now use the site sign-in page.");

window.location.href = `/sign-in?project=${projectId}`;
  }

  const checkboxStyle = {
    display: "grid",
    gridTemplateColumns: "22px 1fr",
    columnGap: 10,
    alignItems: "start",
    fontWeight: "normal",
    lineHeight: 1.4,
    marginBottom: 12,
  };

  const checkboxInputStyle = {
    width: 18,
    height: 18,
    marginTop: 2,
  };

  const scrollBoxStyle = {
    border: "1px solid #ccc",
    borderRadius: 6,
    padding: 12,
    height: 180,
    overflowY: "auto" as const,
    backgroundColor: "#fafafa",
    marginBottom: 12,
  };

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <section className="card">
        <h1>I/C Construction Inc.</h1>

        <h2>Site Orientation</h2>

        <p>
          Complete this orientation before signing in to the project site. This
          orientation is project-specific and must be completed before entering
          the work area.
        </p>
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
        <h2>Site Rules & Safety Expectations</h2>

        <div style={scrollBoxStyle}>
          <p>
            All workers, supervisors, subcontractors, suppliers, and visitors
            must follow I/C Construction Inc. site rules and all applicable
            health and safety requirements.
          </p>

          <ul style={{ paddingLeft: 20 }}>
            <li>Complete site orientation before entering the work area.</li>
            <li>Sign in daily before starting work.</li>
            <li>
              Wear CSA-approved hard hat, safety footwear, and high-visibility
              clothing at all times unless otherwise directed by site
              supervision.
            </li>
            <li>
              Use additional PPE where required, including eye protection,
              gloves, hearing protection, respiratory protection, fall
              protection, or task-specific PPE.
            </li>
            <li>
              Follow the Occupational Health and Safety Act, applicable
              regulations, company policies, project rules, and supervisor
              instructions.
            </li>
            <li>
              Report hazards, unsafe conditions, incidents, injuries, property
              damage, spills, and near misses immediately.
            </li>
            <li>
              Maintain good housekeeping. Keep access routes, stairs, exits,
              fire protection equipment, and electrical panels clear.
            </li>
            <li>
              Only trained, competent, and authorized workers may operate tools,
              vehicles, lifts, equipment, or machinery.
            </li>
            <li>
              Do not remove or bypass guards, barricades, signage, locks,
              tags, or other safety controls.
            </li>
            <li>
              Drug or alcohol impairment is strictly prohibited on site.
            </li>
            <li>
              Horseplay, fighting, harassment, violence, and unsafe behaviour
              are not permitted.
            </li>
            <li>
              Failure to follow site rules may result in removal from site.
            </li>
          </ul>
        </div>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={siteRules}
            onChange={(e) => setSiteRules(e.target.checked)}
            style={checkboxInputStyle}
          />

          <span>
            I have read, understood, and agree to comply with the Site Rules &
            Safety Expectations listed above.
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Required PPE</h2>

        <div style={scrollBoxStyle}>
          <p>
            Minimum site PPE must be worn as required by the project and the
            work being performed.
          </p>

          <ul style={{ paddingLeft: 20 }}>
            <li>CSA-approved hard hat.</li>
            <li>CSA-approved safety footwear.</li>
            <li>High-visibility clothing.</li>
            <li>Safety glasses or eye protection where required.</li>
            <li>Gloves suitable for the task being performed.</li>
            <li>Hearing protection where noise hazards are present.</li>
            <li>Respiratory protection where dust, fumes, or vapours require it.</li>
            <li>Fall protection where required by law, site rules, or task hazard.</li>
            <li>Task-specific PPE required by the supervisor, employer, or site condition.</li>
          </ul>
        </div>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={ppe}
            onChange={(e) => setPpe(e.target.checked)}
            style={checkboxInputStyle}
          />

          <span>
            I understand the required PPE for this project and agree to wear
            the PPE required for my work.
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Emergency Procedures</h2>

        <div style={{ ...scrollBoxStyle, height: 150 }}>
          <p>In the event of an emergency:</p>

          <ol style={{ paddingLeft: 20 }}>
            <li>Stop work immediately if safe to do so.</li>
            <li>Call 911 where emergency response is required.</li>
            <li>Notify site supervision as soon as possible.</li>
            <li>Follow directions from site supervision and emergency responders.</li>
            <li>Proceed to the designated muster point if evacuation is required.</li>
            <li>Remain at the muster point until accounted for and released.</li>
            <li>Do not re-enter the work area until authorized.</li>
          </ol>
        </div>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={emergency}
            onChange={(e) => setEmergency(e.target.checked)}
            style={checkboxInputStyle}
          />

          <span>
            I understand the emergency procedures and agree to follow site
            emergency instructions.
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Reporting & Daily Sign-In</h2>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={reporting}
            onChange={(e) => setReporting(e.target.checked)}
            style={checkboxInputStyle}
          />

          <span>
            I will report hazards, incidents, injuries, property damage, spills,
            and near misses immediately to site supervision.
          </span>
        </label>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={dailySignIn}
            onChange={(e) => setDailySignIn(e.target.checked)}
            style={checkboxInputStyle}
          />

          <span>
            I understand I must sign in each day before entering the work area
            and participate in the applicable Daily Hazard Assessment / Safety
            Discussion before starting work.
          </span>
        </label>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={truthfulInfo}
            onChange={(e) => setTruthfulInfo(e.target.checked)}
            style={checkboxInputStyle}
          />

          <span>
            I certify that the information I provided is accurate and that I am
            fit and able to perform my work safely today.
          </span>
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