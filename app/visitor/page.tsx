"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabase";

function VisitorPageContent() {
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [reasonForVisit, setReasonForVisit] = useState("");
  const [personMeeting, setPersonMeeting] = useState("");

  const [ackNotWorker, setAckNotWorker] = useState(false);
  const [ackCheckIn, setAckCheckIn] = useState(false);
  const [ackPpe, setAckPpe] = useState(false);

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
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("status", "active")
      .order("project_name", { ascending: true });

    if (error) {
      alert(error.message);
      return;
    }

    setProjects(data || []);
  }

  function normalizePhone(value: string) {
    return value.replace(/\D/g, "");
  }

  async function submitVisitorSignIn() {
    if (!projectId) return alert("Please select a project.");
    if (!visitorName) return alert("Please enter your name.");
    if (!reasonForVisit) return alert("Please enter reason for visit.");
    if (!ackNotWorker || !ackCheckIn || !ackPpe) {
      return alert("Please acknowledge all visitor requirements.");
    }

    const selectedProject = projects.find((p) => p.id === projectId);
    const cleanPhone = normalizePhone(phone);

    const { error } = await supabase.from("visitor_sign_ins").insert([
      {
        project_id: projectId,
        visitor_name: visitorName,
        company_name: companyName,
        phone: cleanPhone,
        reason_for_visit: reasonForVisit,
        person_meeting: personMeeting,
        acknowledged_not_worker: true,
        acknowledged_check_in: true,
        acknowledged_ppe: true,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

   try {
  if (selectedProject?.notification_email) {
    const emailResponse = await fetch("/api/send-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: selectedProject.notification_email,
        subject: `New Visitor Sign-In - ${selectedProject.project_name}`,
        html: `
          <h2>New Visitor Sign-In</h2>
          <p><strong>Project:</strong> ${selectedProject.project_name}</p>
          <p><strong>Visitor:</strong> ${visitorName}</p>
          <p><strong>Company:</strong> ${companyName || "Not listed"}</p>
          <p><strong>Phone:</strong> ${cleanPhone || "Not listed"}</p>
          <p><strong>Reason for Visit:</strong> ${reasonForVisit}</p>
          <p><strong>Person Meeting:</strong> ${
            personMeeting || "Not listed"
          }</p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const emailError = await emailResponse.text();
      console.error("Visitor notification failed:", emailError);
    }
  } else {
    console.warn("No notification email is configured for this project.");
  }
} catch (err) {
  console.error("Visitor notification email failed:", err);
}

    alert("Visitor sign-in complete. Please report to site supervision.");

    setVisitorName("");
    setCompanyName("");
    setPhone("");
    setReasonForVisit("");
    setPersonMeeting("");
    setAckNotWorker(false);
    setAckCheckIn(false);
    setAckPpe(false);
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

  return (
    <main style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <section className="card">
        <h1>I/C Construction Inc.</h1>
        <h2>Visitor Sign-In</h2>

        <p>
          Visitors and guests must check in with site supervision before
          entering the work area.
        </p>

        <p>
          This form is not for workers, subcontractors, or anyone performing
          construction work on site.
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
          <label>Visitor Name</label>
          <input
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Company / Organization</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Reason for Visit</label>
          <textarea
            value={reasonForVisit}
            onChange={(e) => setReasonForVisit(e.target.value)}
            placeholder="Delivery, inspection, owner visit, meeting, service call, etc."
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Person Meeting / Site Contact</label>
          <input
            value={personMeeting}
            onChange={(e) => setPersonMeeting(e.target.value)}
          />
        </div>
      </section>

      <section className="card">
        <h2>Visitor Acknowledgements</h2>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={ackNotWorker}
            onChange={(e) => setAckNotWorker(e.target.checked)}
            style={checkboxInputStyle}
          />
          <span>
            I confirm I am a visitor/guest and am not performing construction
            work on site.
          </span>
        </label>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={ackCheckIn}
            onChange={(e) => setAckCheckIn(e.target.checked)}
            style={checkboxInputStyle}
          />
          <span>
            I will check in with site supervision before entering the work area.
          </span>
        </label>

        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={ackPpe}
            onChange={(e) => setAckPpe(e.target.checked)}
            style={checkboxInputStyle}
          />
          <span>
            I will follow all site safety requirements and wear required PPE as
            directed by site supervision.
          </span>
        </label>

        <button onClick={submitVisitorSignIn}>Complete Visitor Sign-In</button>
      </section>
    </main>
  );
}

export default function VisitorPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Loading visitor sign-in...</main>}>
      <VisitorPageContent />
    </Suspense>
  );
}