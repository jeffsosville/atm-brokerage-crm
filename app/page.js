"use client";
import { useAuth } from "../lib/auth";
import LoginPage from "../components/LoginPage";
import CRM from "./crm";

export default function Page() {
  const { user, loading, signOut } = useAuth();

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontFamily: "system-ui" }}>
      Loading...
    </div>
  );

  if (!user) return <LoginPage />;
  return (
    <>
      <button onClick={signOut} style={{ position: "fixed", top: 12, right: 16, zIndex: 10, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
        Sign Out
      </button>
      <CRM />
    </>
  );
}