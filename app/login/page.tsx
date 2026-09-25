"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import "../../components/project-work.css";
export default function LoginPage() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (r.error) throw r.error;
      const p = await supabase
        .from("staff_profiles")
        .select("id")
        .eq("id", r.data.user.id)
        .eq("active", true)
        .maybeSingle();
      if (p.error) throw p.error;
      if (!p.data) {
        await supabase.auth.signOut();
        throw Error(
          "Your account needs to be activated by your administrator before you can open the workspace.",
        );
      }
      window.location.href = "/";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signUp() {
    if (busy || !email.trim() || !password) {
      setError("Enter your email and password first.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await supabase.auth.signUp({ email: email.trim(), password });
      if (r.error) throw r.error;
      setMessage(
        "Check your email if confirmation is required, then ask your administrator to activate your staff profile and assign your projects.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="pw" style={{ maxWidth: 480, paddingTop: 75 }}>
      <div className="eyebrow">I/C CONSTRUCTION INC.</div>
      <h1>Welcome to Field Docs</h1>
      <p className="muted">
        Sign in to see your tasks, reminders, and project overview.
      </p>
      <div className="panel">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
        <form onSubmit={signIn}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <button disabled={busy} style={{ width: "100%", marginTop: 10 }}>
            {busy ? "Please wait…" : "Sign in to my dashboard"}
          </button>
        </form>
        <p className="muted" style={{ fontSize: 13, marginTop: 22 }}>
          New team member? Your administrator will need to activate your
          account.
        </p>
        <button
          className="secondary"
          onClick={() => void signUp()}
          disabled={busy}
        >
          Create account
        </button>
      </div>
    </main>
  );
}
