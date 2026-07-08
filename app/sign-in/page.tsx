"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabase";

const hazardOptions = [
  "Fall hazards",
  "Mobile equipment",
  "Overhead work",
  "Electrical hazards",
  "Excavation",
  "Slips/trips",
  "Weather",
  "Silica/dust",
  "Hot work",
  "Confined space",
  "Public exposure",
  "Material handling",
  "Housekeeping",
  "Other",
];

const ppeOptions = [
  "Gloves",
  "Eye protection",
  "Face shield",
  "Hearing protection",
  "Respirator",
  "Harness / fall arrest",
  "Cut-resistant gloves",
  "Chemical-resistant gloves",
  "Welding helmet",
  "Other",
];

function TradeSignInPageContent() {
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectData, setSelectedProjectData] = useState<any>(null);
  const [todayAssessments, setTodayAssessments] = useState<any[]>([]);

  const [projectId, setProjectId] = useState("");
  const [workerRole, setWorkerRole] = useState("worker");
  const [workerName, setWorkerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");

  const [selectedAssessmentId, setSelectedAssessmentId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const [crewSize, setCrewSize] = useState("");
  const [workActivity, setWorkActivity] = useState("");
  const [selectedHazards, setSelectedHazards] = useState<string[]>([]);
  const [otherHazardDetails, setOtherHazardDetails] = useState("");
  const [controls, setControls] = useState("");
  const [selectedPpe, setSelectedPpe] = useState<string[]>([]);
  const [otherPpeDetails, setOtherPpeDetails] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [supervisorDhaAck, setSupervisorDhaAck] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    const projectFromUrl = searchParams.get("project");

    if (projectFromUrl && projects.length > 0) {
      handleProjectChange(projectFromUrl);
    }
  }, [projects, searchParams]);

  async function fetchProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("status", "active")
      .order("project_name", { ascending: true });

    if (!error) setProjects(data || []);
  }

  function getTodayDate() {
    return new Date().toISOString().split("T")[0];
  }

  async function fetchTodayAssessments(currentProjectId: string) {
    if (!currentProjectId) {
      setTodayAssessments([]);
      return;
    }

    const today = getTodayDate();

    const { data, error } = await supabase
      .from("daily_hazard_assessments")
      .select("*")
      .eq("project_id", currentProjectId)
      .eq("assessment_date", today)
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setTodayAssessments(data || []);
  }

  function normalizePhone(value: string) {
    return value.replace(/\D/g, "");
  }

  async function lookupWorkerByPhone(value: string) {
  const cleanPhone = normalizePhone(value);

  if (cleanPhone.length < 10) return;

  const { data, error } = await supabase
    .from("trade_sign_ins")
    .select("worker_name, company_name, worker_role")
    .eq("phone", cleanPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(error.message);
    return;
  }

  if (!data) return;

  if (!workerName) setWorkerName(data.worker_name || "");
  if (!companyName) setCompanyName(data.company_name || "");
  if (data.worker_role) setWorkerRole(data.worker_role);
}

  function toggleArrayValue(
    value: string,
    list: string[],
    setter: (items: string[]) => void
  ) {
    if (list.includes(value)) {
      setter(list.filter((item) => item !== value));
    } else {
      setter([...list, value]);
    }
  }

  function handleProjectChange(value: string) {
    setProjectId(value);

    const selected = projects.find((p) => p.id === value);
    setSelectedProjectData(selected || null);

    setSelectedAssessmentId("");
    fetchTodayAssessments(value);
  }

  function goToOrientation() {
    if (projectId) {
      window.location.href = `/orientation?project=${projectId}`;
    } else {
      window.location.href = "/orientation";
    }
  }

  async function submitSignIn() {
    if (!projectId) return alert("Please select a project.");
    if (!workerName) return alert("Please enter your name.");
    if (!companyName) return alert("Please enter your company or employer.");
    if (!phone) return alert("Please enter your phone number.");

    const cleanPhone = normalizePhone(phone);

    const { data: orientationData, error: orientationError } = await supabase
      .from("site_orientations")
      .select("*")
      .eq("project_id", projectId)
      .eq("phone", cleanPhone)
      .maybeSingle();

    if (orientationError) {
      alert(orientationError.message);
      return;
    }

    if (!orientationData) {
      alert("Site orientation must be completed before signing in.");
      window.location.href = `/orientation?project=${projectId}`;
      return;
    }

    let dailyHazardAssessmentId = null;
    let supervisorNameToSave = "";

    if (workerRole === "supervisor") {
      if (!crewSize) return alert("Please enter crew size.");
      if (!workActivity) return alert("Please enter today's work activity.");
      if (selectedHazards.length === 0) return alert("Please select at least one hazard.");
      if (selectedHazards.includes("Other") && !otherHazardDetails) return alert("Please describe the other hazard.");
      if (!controls) return alert("Please enter controls in place.");
      if (selectedPpe.includes("Other") && !otherPpeDetails) return alert("Please describe the other PPE required.");
      if (!supervisorDhaAck) return alert("Please acknowledge the Daily Hazard Assessment.");

      const hazardsToSave = selectedHazards.includes("Other")
        ? [...selectedHazards, `Other: ${otherHazardDetails}`]
        : selectedHazards;

      const ppeToSave = selectedPpe.includes("Other")
        ? [...selectedPpe, `Other: ${otherPpeDetails}`]
        : selectedPpe;

      const { data: dhaData, error: dhaError } = await supabase
        .from("daily_hazard_assessments")
        .insert([
          {
            project_id: projectId,
            supervisor_name: workerName,
            supervisor_phone: cleanPhone,
            company_name: companyName,
            crew_size: Number(crewSize),
            work_activity: workActivity,
            hazards: hazardsToSave,
            controls,
            ppe_required: ppeToSave,
            additional_notes: additionalNotes,
            assessment_date: getTodayDate(),
          },
        ])
        .select("id")
        .maybeSingle();

      if (dhaError) {
        alert(dhaError.message);
        return;
      }

      if (!dhaData) {
        alert("Daily Hazard Assessment was saved, but the record ID could not be returned.");
        return;
      }

      dailyHazardAssessmentId = dhaData.id;
      supervisorNameToSave = workerName;
    }

    if (workerRole === "worker") {
  if (!acknowledged) {
    return alert(
      "Please acknowledge that you understand the hazards associated with your work today."
    );
  }

  dailyHazardAssessmentId = null;
  supervisorNameToSave = "";
}

    const { error } = await supabase.from("trade_sign_ins").insert([
      {
        project_id: projectId,
        worker_role: workerRole,
        worker_name: workerName,
        company_name: companyName,
        phone: cleanPhone,
        supervisor_name: supervisorNameToSave,
        daily_hazard_assessment_id: dailyHazardAssessmentId,
        acknowledged: true,
      },
    ]);

   if (error) {
  alert(error.message);
  return;
}

if (selectedProjectData?.notification_email) {
  try {
    await fetch("/api/send-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: selectedProjectData.notification_email,
        subject:
          workerRole === "supervisor"
            ? `New Supervisor Sign-In / DHA - ${selectedProjectData.project_name}`
            : `New Site Sign-In - ${selectedProjectData.project_name}`,
        html: `
          <h2>${
            workerRole === "supervisor"
              ? "New Supervisor Sign-In / Daily Hazard Assessment"
              : "New Site Sign-In"
          }</h2>

          <p><strong>Project:</strong> ${selectedProjectData.project_name}</p>
          <p><strong>Name:</strong> ${workerName}</p>
          <p><strong>Company / Employer:</strong> ${companyName}</p>
          <p><strong>Role:</strong> ${workerRole}</p>
          <p><strong>Phone:</strong> ${cleanPhone}</p>
          <p><strong>Supervisor:</strong> ${
            supervisorNameToSave || "Not listed"
          }</p>

          ${
            workerRole === "supervisor"
              ? `
                <hr />
                <p><strong>Crew Size:</strong> ${crewSize}</p>
                <p><strong>Work Activity:</strong> ${workActivity}</p>
                <p><strong>Controls:</strong> ${controls}</p>
                <p><strong>Additional Notes:</strong> ${
                  additionalNotes || "None"
                }</p>
              `
              : ""
          }
        `,
      }),
    });
  } catch (err) {
    console.error("Sign-in notification email failed:", err);
  }
}

alert("You are signed in.");

    setWorkerRole("worker");
    setWorkerName("");
    setCompanyName("");
    setPhone("");
    setSelectedAssessmentId("");
    setAcknowledged(false);
    setCrewSize("");
    setWorkActivity("");
    setSelectedHazards([]);
    setOtherHazardDetails("");
    setControls("");
    setSelectedPpe([]);
    setOtherPpeDetails("");
    setAdditionalNotes("");
    setSupervisorDhaAck(false);

    if (projectId) {
      fetchTodayAssessments(projectId);
    }
  }

  const checkboxStyle = {
    display: "grid",
    gridTemplateColumns: "22px 1fr",
    columnGap: 10,
    alignItems: "start",
    fontWeight: "normal",
    lineHeight: 1.4,
    marginBottom: 8,
  };

  const checkboxInputStyle = {
    width: 18,
    height: 18,
    marginTop: 2,
  };

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <section className="card">
        <h1>I/C Construction Inc.</h1>
        <h2>Site Sign-In</h2>
        <p>Please sign in before entering the work area.</p>
<div
  style={{
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    backgroundColor: "#f8fafc",
  }}
>
  <h3 style={{ marginTop: 0 }}>Visitors / Guests</h3>

  <p>
    Visitors, delivery drivers, inspectors, owner representatives, architects,
    engineers, and other guests must check in with site supervision before
    entering the work area.
  </p>

  <p>
    This visitor sign-in is not for workers, subcontractors, or anyone
    performing construction work on site.
  </p>

  <button
    type="button"
    onClick={() => {
      window.location.href = projectId
        ? `/visitor?project=${projectId}`
        : "/visitor";
    }}
  >
    Visitor Sign-In
  </button>

  {!projectId && (
    <p style={{ fontSize: 14, marginBottom: 0 }}>
      Tip: select your project below first so the visitor form opens for the
      correct site.
    </p>
  )}
</div>
        <div
          style={{
            backgroundColor: "#fff3cd",
            border: "1px solid #ffe69c",
            borderRadius: 8,
            padding: 16,
            marginTop: 16,
          }}
        >
          <h3 style={{ marginTop: 0 }}>First Time on This Project?</h3>

          <p>
            All workers and supervisors must complete the Site Orientation
            before signing in for the first time on this project.
          </p>

          <p>
            If you have not completed orientation yet, complete it before
            filling out this sign-in form or Daily Hazard Assessment.
          </p>

          <button type="button" onClick={goToOrientation}>
            Complete Site Orientation
          </button>

          {!projectId && (
            <p style={{ fontSize: 14, marginBottom: 0 }}>
              Tip: select your project below first so the orientation opens for
              the correct site.
            </p>
          )}
        </div>
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
            In case of emergency, call 911 first and notify site supervision
            immediately.
          </p>
        </section>
      )}

      <section className="card">
        <div style={{ marginBottom: 12 }}>
          <label>Your Role</label>
          <select
            value={workerRole}
            onChange={(e) => setWorkerRole(e.target.value)}
          >
            <option value="worker">Worker / Labourer</option>
            <option value="supervisor">Supervisor / Foreman</option>
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
          <label>Company / Employer</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label>Phone</label>
          <input
  value={phone}
  onChange={(e) => setPhone(e.target.value)}
  onBlur={(e) => lookupWorkerByPhone(e.target.value)}
  placeholder="Enter phone number"
/>
        </div>

        {workerRole === "worker" && (
          <>
            

            <label style={{ ...checkboxStyle, marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={checkboxInputStyle}
              />
              <span>
                I understand the hazards associated with my work today and will
  follow all site safety requirements.
              </span>
            </label>
          </>
        )}

        {workerRole === "supervisor" && (
          <section className="card">
            <h2>Daily Hazard Assessment</h2>

            <div style={{ marginBottom: 12 }}>
              <label>Crew Size</label>
              <input
                type="number"
                value={crewSize}
                onChange={(e) => setCrewSize(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Today's Work Activity</label>
              <textarea
                value={workActivity}
                onChange={(e) => setWorkActivity(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Hazards Identified</label>

              {hazardOptions.map((hazard) => (
                <label key={hazard} style={checkboxStyle}>
                  <input
                    type="checkbox"
                    checked={selectedHazards.includes(hazard)}
                    onChange={() =>
                      toggleArrayValue(
                        hazard,
                        selectedHazards,
                        setSelectedHazards
                      )
                    }
                    style={checkboxInputStyle}
                  />
                  <span>{hazard}</span>
                </label>
              ))}

              {selectedHazards.includes("Other") && (
                <div style={{ marginTop: 12 }}>
                  <label>Other Hazard Details</label>
                  <textarea
                    value={otherHazardDetails}
                    onChange={(e) => setOtherHazardDetails(e.target.value)}
                    placeholder="Describe the other hazard."
                  />
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Controls in Place</label>
              <textarea
                value={controls}
                onChange={(e) => setControls(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Additional PPE Required</label>
              <p>Baseline site PPE includes hard hat, safety boots, and hi-vis.</p>

              {ppeOptions.map((ppe) => (
                <label key={ppe} style={checkboxStyle}>
                  <input
                    type="checkbox"
                    checked={selectedPpe.includes(ppe)}
                    onChange={() =>
                      toggleArrayValue(ppe, selectedPpe, setSelectedPpe)
                    }
                    style={checkboxInputStyle}
                  />
                  <span>{ppe}</span>
                </label>
              ))}

              {selectedPpe.includes("Other") && (
                <div style={{ marginTop: 12 }}>
                  <label>Other PPE Details</label>
                  <textarea
                    value={otherPpeDetails}
                    onChange={(e) => setOtherPpeDetails(e.target.value)}
                    placeholder="Describe the other PPE required."
                  />
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Additional Notes</label>
              <textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
              />
            </div>

            <label style={{ ...checkboxStyle, marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={supervisorDhaAck}
                onChange={(e) => setSupervisorDhaAck(e.target.checked)}
                style={checkboxInputStyle}
              />
              <span>I have conducted today's toolbox talk and reviewed the applicable
  hazards, controls, and safe work procedures with my crew.</span>
            </label>
          </section>
        )}

        <button onClick={submitSignIn}>Sign In</button>
      </section>
    </main>
  );
}

export default function TradeSignInPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Loading sign-in...</main>}>
      <TradeSignInPageContent />
    </Suspense>
  );
}