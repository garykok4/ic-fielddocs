"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
    if (!email || !password) {
      alert("Please enter both email and password.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Account created. You can now sign in.");
  }

  async function signIn() {
    if (!email || !password) {
      alert("Please enter both email and password.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    window.location.href = "/";
  }

  return (
    <main style={{ padding: 24, maxWidth: 500, margin: "0 auto" }}>
      <h1>Staff Login</h1>

      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          display: "block",
          width: "100%",
          padding: 10,
          marginBottom: 12,
        }}
      />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{
          display: "block",
          width: "100%",
          padding: 10,
          marginBottom: 12,
        }}
      />

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={signIn}>Sign In</button>
        <button onClick={signUp}>Create Account</button>
      </div>
    </main>
  );
}
