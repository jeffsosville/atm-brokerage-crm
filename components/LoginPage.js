"use client";
import { useState } from "react";
import { useAuth } from "../lib/auth";

const I = { background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13, width: "100%", boxSizing: "border-box" };
const B = { background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%" };

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setLoading(true);
    setError("");
    const { error: err } = await signIn(email, password);
    if (err) setError(err.message);
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 32, width: 340 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Sosville Group CRM</h2>
        <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>Sign in to continue</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={I} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="Password" style={I} />
          <button onClick={login} disabled={loading} style={B}>{loading ? "Signing in..." : "Sign In"}</button>
          {error && <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}