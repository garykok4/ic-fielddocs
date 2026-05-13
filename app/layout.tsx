"use client";

import "./globals.css";
import Link from "next/link";
import { supabase } from "../lib/supabase";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <html lang="en">
      <body>
        <nav
          style={{
            padding: 16,
            borderBottom: "1px solid #ddd",
            display: "flex",
            gap: 16,
          }}
        >
          <Link href="/">Dashboard</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/reports">Reports</Link>
          <Link href="/reports/new">New Report</Link>
          <Link href="/login">Login</Link>

          <button onClick={logout} style={{ marginLeft: "auto" }}>
            Logout
          </button>
        </nav>

        {children}
      </body>
    </html>
  );
}