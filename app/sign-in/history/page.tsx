"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function SignInHistoryPage() {
  const [records, setRecords] = useState<any[]>([]);

  useEffect(() => {
    fetchRecords();
  }, []);

  async function fetchRecords() {
    const { data, error } = await supabase
      .from("trade_sign_ins")
      .select(`
        *,
        projects (
          project_name
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setRecords(data || []);
  }

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Trade Sign-In History</h1>

      {records.length === 0 && <p>No sign-ins yet.</p>}

      {records.map((r) => (
        <div
          key={r.id}
          style={{
            border: "1px solid #ccc",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
          }}
        >
          <h2>{r.worker_name}</h2>

          <p>
            <strong>Project:</strong>{" "}
            {r.projects?.project_name || "Unknown"}
          </p>

          <p>
            <strong>Company:</strong> {r.company_name}
          </p>

          <p>
            <strong>Trade:</strong> {r.trade || "—"}
          </p>

          <p>
            <strong>Phone:</strong> {r.phone || "—"}
          </p>

          <p>
            <strong>Date:</strong> {r.sign_in_date}
          </p>
        </div>
      ))}
    </main>
  );
}
