"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<any[]>([]);

  useEffect(() => {
    async function loadOpportunities() {
      const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .order("opportunity_score", { ascending: false });

      if (error) {
        console.error("Error loading opportunities:", error);
        return;
      }

      setOpportunities(data || []);
    }

    loadOpportunities();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Opportunities</h1>
      <p>Hidden opportunity scanner module.</p>

      <button
        style={{
          marginTop: 20,
          marginBottom: 20,
          padding: "10px 16px",
          borderRadius: 6,
          border: "none",
          background: "#111827",
          color: "white",
          cursor: "pointer",
        }}
      >
        + Add Opportunity
      </button>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 10 }}>Score</th>
            <th style={{ padding: 10 }}>Project</th>
            <th style={{ padding: 10 }}>Type</th>
            <th style={{ padding: 10 }}>Municipality</th>
            <th style={{ padding: 10 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 10 }}>
                No opportunities yet.
              </td>
            </tr>
          ) : (
            opportunities.map((opp) => (
              <tr key={opp.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>{opp.opportunity_score ?? 0}</td>
                <td style={{ padding: 10 }}>{opp.title || "Untitled"}</td>
                <td style={{ padding: 10 }}>{opp.project_type || "-"}</td>
                <td style={{ padding: 10 }}>{opp.municipality || "-"}</td>
                <td style={{ padding: 10 }}>{opp.status || "Lead"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </main>
  );
}
