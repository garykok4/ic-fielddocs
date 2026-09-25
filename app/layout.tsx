"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { requireActiveStaff } from "../lib/auth";
import { Person } from "../lib/project-work";
import "./globals.css";
import "./workspace-shell.css";
const primary = [
  ["/", "Home", "⌂"],
  ["/projects", "Projects", "▦"],
  ["/tasks", "My Tasks", "✓"],
  ["/schedule", "Schedule", "▤"],
];
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname(),
    [profile, setProfile] = useState<Person | null>(null),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState("");
  const publicPage = [
    "/login",
    "/sign-in",
    "/orientation",
    "/visitor",
  ].includes(pathname);
  useEffect(() => {
    setMobile(false);
  }, [pathname]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (publicPage) return;
    let alive = true;
    (async () => {
      try {
        const p = await requireActiveStaff();
        if (alive) setProfile(p);
      } catch {
        if (alive)
          setError("Unable to verify your account. Refresh to try again.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [publicPage, pathname]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setProfile(null);
        if (!publicPage) window.location.href = "/login";
      }
    });
    return () => data.subscription.unsubscribe();
  }, [publicPage]);
  async function logout() {
    const r = await supabase.auth.signOut();
    if (r.error) {
      setError("Unable to sign out. Please try again.");
      return;
    }
    window.location.href = "/login";
  }
  const active = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");
  const item = (href: string, label: string, icon?: string) => (
    <Link
      href={href}
      key={href}
      className={active(href) ? "active" : ""}
      aria-current={active(href) ? "page" : undefined}
      onClick={() => setMobile(false)}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </Link>
  );
  return (
    <html lang="en">
      <body>
        {publicPage ? (
          children
        ) : (
          <>
            <header className="app-topbar no-print">
              <div className="app-brand">
                <button
                  className="mobile-menu"
                  aria-label="Toggle navigation"
                  aria-controls="workspace-navigation"
                  aria-expanded={mobile}
                  onClick={() => setMobile(!mobile)}
                >
                  ☰
                </button>
                <Link href="/">
                  I/C <span>FIELD DOCS</span>
                </Link>
                <small>PROJECT WORKSPACE</small>
              </div>
              <div className="app-account">
                <span className="avatar" aria-hidden="true">
                  {profile?.full_name
                    ?.split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("") || "IC"}
                </span>
                <span>
                  {profile?.full_name || "Your account"}
                  <small>
                    {profile?.role === "admin"
                      ? "Administrator"
                      : "Project team"}
                  </small>
                </span>
                <button onClick={logout}>Sign out</button>
              </div>
            </header>
            {mobile && (
              <button
                className="sidebar-backdrop"
                onClick={() => setMobile(false)}
                aria-label="Close navigation"
              />
            )}
            <aside
              id="workspace-navigation"
              className={"app-sidebar no-print " + (mobile ? "open" : "")}
              aria-label="Main navigation"
            >
              <div className="nav-section">WORKSPACE</div>
              {primary.map(([href, label, icon]) => item(href, label, icon))}
              <div className="nav-section">FIELD RECORDS</div>
              <details open={pathname.startsWith("/reports")}>
                <summary>Reports</summary>
                {item("/reports", "Daily reports")}
                {item("/reports/new", "New report")}
                {item("/reports/print", "Print reports")}
              </details>
              <details
                open={
                  pathname.startsWith("/sign-in/") ||
                  pathname.startsWith("/orientation/")
                }
              >
                <summary>Workforce & safety</summary>
                {item("/sign-in/history", "Sign-in history")}
                {item("/sign-in/summary", "Manpower summary")}
                {item("/orientation/history", "Orientation records")}
              </details>
              {profile?.role === "admin" && (
                <>
                  <div className="nav-section">ADMINISTRATION</div>
                  {item("/admin/project-staff", "Project team")}
                  {item("/admin/notifications", "Notification delivery")}
                  {item("/opportunities", "Opportunities")}
                </>
              )}
              <div className="sidebar-footer">
                I/C Construction Inc.
                <br />
                <span>Plan. Assign. Follow through.</span>
              </div>
            </aside>
            <div className="app-content">
              {error ? (
                <main>
                  <p role="alert">{error}</p>
                  <button onClick={() => window.location.reload()}>
                    Retry
                  </button>
                </main>
              ) : profile ? (
                children
              ) : (
                <main>
                  <p>Opening your workspace…</p>
                </main>
              )}
            </div>
          </>
        )}
      </body>
    </html>
  );
}
