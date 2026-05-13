"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "../lib/supabase";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [reportsOpen, setReportsOpen] = useState(false);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <html lang="en">
      <body>
        <nav style={{ position: "relative" }}>
          <Link href="/">Dashboard</Link>

          <Link href="/projects">Projects</Link>

          <div style={{ position: "relative" }}>
            <button onClick={() => setReportsOpen(!reportsOpen)}>
              Reports ▼
            </button>

            {reportsOpen && (
              <div
                style={{
                  position: "absolute",
                  top: 40,
                  left: 0,
                  background: "white",
                  color: "#111",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: 10,
                  minWidth: 220,
                  zIndex: 1000,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  <Link
                    href="/reports"
                    style={{ color: "#111", textDecoration: "none" }}
                  >
                    View Reports
                  </Link>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <Link
                    href="/reports/new"
                    style={{ color: "#111", textDecoration: "none" }}
                  >
                    New Report
                  </Link>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <Link
                    href="/reports/print"
                    style={{ color: "#111", textDecoration: "none" }}
                  >
                    Print Reports
                  </Link>
                </div>

                <div>
                  <Link
                    href="/sign-in/summary"
                    style={{ color: "#111", textDecoration: "none" }}
                  >
                    Manpower Summary
                  </Link>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={logout}
            style={{
              marginLeft: "auto",
            }}
          >
            Logout
          </button>
        </nav>

        {children}
      </body>
    </html>
  );
}