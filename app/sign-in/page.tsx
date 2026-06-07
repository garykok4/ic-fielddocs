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
  const [trade, setTrade] = useState("");
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

  async function fetchTodayAssessments(currentProjectId: string) {
    if (!currentProjectId) {
      setTodayAssessments([]);
      return;
    }

    const today = new Date().toLocaleDateString("en-CA");

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

  async function submitSignIn() {
    if (!projectId) return alert("Please select a project.");
    if (!workerName) return alert("Please enter your name.");
    if (!companyName) return alert("Please enter your company.");
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
            trade,
            crew_size: Number(crewSize),
            work_activity: workActivity,
            hazards: hazardsToSave,
            controls,
            ppe_required: ppeToSave,
            additional_notes: additionalNotes,
            assessment_date: new Date().toLocaleDateString("en-CA"),
          },
        ])
        .select()
        .single();

      if (dhaError) {
        alert(dhaError.message);
        return;
      }

      dailyHazardAssessmentId = dhaData.id;
      supervisorNameToSave = workerName;
    }

    if (workerRole === "worker") {
      if (todayAssessments.length === 0) {
        return alert(
          "No Daily Hazard Assessment has been completed for this project today. Please speak with your supervisor/foreman."
        );
      }

      if (!selectedAssessmentId) {
        return alert("Please select your supervisor's Daily Hazard Assessment.");
      }

      const selectedAssessment = todayAssessments.find(
        (item) => item.id === selectedAssessmentId
      );

      if (!selectedAssessment) {
        return alert("Selected Daily Hazard Assessment was not found.");
      }

      if (!acknowledged) {
        return alert(
          "Please confirm you participated in today's Daily Hazard Assessment / Safety Discussion."
        );
      }

      dailyHazardAssessmentId = selectedAssessment.id;
      supervisorNameToSave = selectedAssessment.supervisor_name;
    }

    const { error } = await supabase.from("trade_sign_ins").insert([
      {
        project_id: projectId,
        worker_role: workerRole,
        worker_name: workerName,
        company_name: companyName,
        trade,
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

    alert("You are signed in.");

    setWorkerRole("worker");
    setWorkerName("");
    setCompanyName("");
    setTrade("");
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

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <section className="card">
        <h1>I/C Construction Inc.</h1>
        <h2>Site Sign-In</h2>
        <p>Please sign in before entering the work area.</p>
      </section>

      <section className="card">
        <label>Project</label>
        <select value={projectId} onChange={(e) => handleProjectChange(e.target.value)}>
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
          <p><strong>Contact:</strong> {selectedProjectData.site_contact_name || "Not listed"}</p>
          <p><strong>Phone:</strong> {selectedProjectData.site_contact_phone || "Not listed"}</p>
          <p><strong>Email:</strong> {selectedProjectData.site_contact_email || "Not listed"}</p>
          <p style={{ marginTop: 20 }}>
            In case of emergency, call 911 first and notify site supervision immediately.
          </p>
        </section>
      )}

      <section className="card">
        <div style={{ marginBottom: 12 }}>
          <label>Your Role</label>
          <select value={workerRole} onChange={(e) => setWorkerRole(e.target.value)}>
            <option value="worker">Worker / Labourer</option>
            <option value="supervisor">Supervisor / Foreman</option>
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Name</label>
          <input value={workerName} onChange={(e) => setWorkerName(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Company</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
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
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
{workerRole === "worker" && (
  <>
    <div style={{ marginBottom: 16 }}>
      <label>Supervisor Daily Hazard Assessment</label>

      {todayAssessments.length === 0 && (
        <p>
          No supervisor Daily Hazard Assessment has been completed for
          this project today.
        </p>
      )}

      {todayAssessments.length > 0 && (
        <select
          value={selectedAssessmentId}
          onChange={(e) => setSelectedAssessmentId(e.target.value)}
        >
          <option value="">Select supervisor assessment</option>

          {todayAssessments.map((assessment) => (
            <option key={assessment.id} value={assessment.id}>
              {assessment.supervisor_name} — {assessment.company_name} —{" "}
              {assessment.work_activity}
            </option>
          ))}
        </select>
      )}
    </div>

    <div style={{ marginBottom: 20 }}>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          fontWeight: "normal",
        }}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          style={{ width: 18, height: 18, minWidth: 18 }}
        />
        I confirm I participated in today's Daily Hazard Assessment /
        Safety Discussion with my supervisor.
      </label>
    </div>
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
        <label
          key={hazard}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            fontWeight: "normal",
            marginBottom: 8,
          }}
        >
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
          />
          {hazard}
        </label>
      ))}
    </div>

    <div style={{ marginBottom: 12 }}>
      <label>Controls in Place</label>
      <textarea
        value={controls}
        onChange={(e) => setControls(e.target.value)}
      />
    </div>

    <div style={{ marginBottom: 12 }}>
      <label>Additional Notes</label>
      <textarea
        value={additionalNotes}
        onChange={(e) => setAdditionalNotes(e.target.value)}
      />
    </div>

    <label
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <input
        type="checkbox"
        checked={supervisorDhaAck}
        onChange={(e) => setSupervisorDhaAck(e.target.checked)}
      />
      I reviewed today's hazards and controls with my crew.
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