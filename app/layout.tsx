"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { supabase } from "../lib/supabase";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const [reportsOpen, setReportsOpen] = useState(false);
  const [workforceOpen, setWorkforceOpen] = useState(false);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const hideNav = pathname === "/sign-in" || pathname === "/orientation";

  return (
    <html lang="en">
      <body>
        {!hideNav && (
          <nav style={{ position: "relative" }}>
            <Link href="/">Dashboard</Link>

            <Link href="/projects">Projects</Link>

            <div style={{ position: "relative" }}>
              <button
                onClick={() => {
                  setReportsOpen(!reportsOpen);
                  setWorkforceOpen(false);
                }}
              >
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
                    <Link href="/reports" style={{ color: "#111", textDecoration: "none" }}>
                      View Reports
                    </Link>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <Link href="/reports/new" style={{ color: "#111", textDecoration: "none" }}>
                      New Report
                    </Link>
                  </div>

                  <div>
                    <Link href="/reports/print" style={{ color: "#111", textDecoration: "none" }}>
                      Print Reports
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <button
                onClick={() => {
                  setWorkforceOpen(!workforceOpen);
                  setReportsOpen(false);
                }}
              >
                Workforce ▼
              </button>

              {workforceOpen && (
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
                    minWidth: 240,
                    zIndex: 1000,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <Link href="/sign-in/history" style={{ color: "#111", textDecoration: "none" }}>
                      Sign-In History
                    </Link>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <Link href="/sign-in/summary" style={{ color: "#111", textDecoration: "none" }}>
                      Manpower Summary
                    </Link>
                  </div>

                  <div>
                    <Link href="/orientation/history" style={{ color: "#111", textDecoration: "none" }}>
                      Orientation Records
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <button onClick={logout} style={{ marginLeft: "auto" }}>
              Logout
            </button>
          </nav>
        )}

        {children}
      </body>
    </html>
  );
}