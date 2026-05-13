"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function ReportDetailPage() {
  const params = useParams();
  const [report, setReport] = useState<any>(null);
  const [photos, setPhotos] = useState<any[]>([]);

  useEffect(() => {
    if (params.id) fetchReport();
  }, [params.id]);

  async function fetchReport() {
    const { data, error } = await supabase
      .from("daily_reports")
      .select(`
        *,
        projects (
          project_name,
          address,
          city,
          province
        )
      `)
      .eq("id", params.id)
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setReport(data);

    const { data: photoData } = await supabase
      .from("attachments")
      .select("*")
      .eq("report_id", params.id);

    setPhotos(photoData || []);
  }

  if (!report) {
    return <main style={{ padding: 24 }}>Loading report...</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
  <button
    onClick={() => window.print()}
    style={{
      padding: "10px 18px",
      marginBottom: 20,
    }}
  >
    Print / Save PDF
  </button>
      <h1>Daily Site Report</h1>

      <section style={{ border: "1px solid #ccc", padding: 20, borderRadius: 8 }}>
        <h2>{report.projects?.project_name}</h2>
        <p><strong>Address:</strong> {report.projects?.address}</p>
        <p><strong>Location:</strong> {report.projects?.city}, {report.projects?.province}</p>
        <p><strong>Report Date:</strong> {report.report_date}</p>

        <hr />

        <p><strong>Weather:</strong></p>
        <p>{report.weather || "—"}</p>

        <p><strong>Work Completed:</strong></p>
        <p>{report.work_completed || "—"}</p>

        <p><strong>Labour on Site:</strong></p>
        <p>{report.labour || "—"}</p>

        <p><strong>Issues / Delays / Notes:</strong></p>
        <p>{report.issues || "—"}</p>

        <hr />

        <h3>Photos</h3>

        {photos.length === 0 && <p>No photos uploaded.</p>}

        {photos.map((photo) => (
          <img
            key={photo.id}
            src={photo.file_url}
            alt="Report photo"
            style={{
              width: "100%",
              maxWidth: 500,
              display: "block",
              marginBottom: 16,
              borderRadius: 8,
            }}
          />
        ))}
      </section>
    </main>
  );
}