"use client";
import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indncm14aHhvem95dmNtdmJmdXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4MzI5MTUsImV4cCI6MjA3NDQwODkxNX0.zuOIlNRTC3kjBWHxp9_sef2V9pe9erDSljEcJ2EL9to";

const api = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return r.json();
};

const timeAgo = (d) => {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(d).toLocaleDateString();
};

export default function InboxPage() {
  const [emails, setEmails] = useState([]);
  const [companies, setCompanies] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all, inbound, outbound, unmatched
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(7);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    
    // Load emails
    const data = await api(
      `atm_activity_log?select=id,company_id,type,subject,snippet,from_email,to_email,gmail_id,created_at&created_at=gte.${since}&type=in.(email_sent,email_received)&order=created_at.desc&limit=500`
    );
    setEmails(data || []);

    // Load companies for display
    const coIds = [...new Set((data || []).map(e => e.company_id).filter(Boolean))];
    if (coIds.length > 0) {
      const cos = await api(
        `atm_companies?select=id,company_name&id=in.(${coIds.join(",")})`
      );
      const map = {};
      (cos || []).forEach(c => { map[c.id] = c.company_name; });
      setCompanies(map);
    }

    setLoading(false);
    setLastRefresh(new Date());
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(load, 300000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = emails.filter(e => {
    if (filter === "inbound" && e.type !== "email_received") return false;
    if (filter === "outbound" && e.type !== "email_sent") return false;
    if (filter === "unmatched" && e.company_id) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (e.subject || "").toLowerCase().includes(q) ||
        (e.from_email || "").toLowerCase().includes(q) ||
        (e.to_email || "").toLowerCase().includes(q) ||
        (e.snippet || "").toLowerCase().includes(q) ||
        (companies[e.company_id] || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const inboundCount = emails.filter(e => e.type === "email_received").length;
  const outboundCount = emails.filter(e => e.type === "email_sent").length;
  const unmatchedCount = emails.filter(e => !e.company_id).length;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e17", color: "#c8d6e5" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1a1a2e 100%)", borderBottom: "1px solid #1e293b", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a href="/" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 13, opacity: 0.8 }}>&larr; CRM</a>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Inbox</h1>
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: 4 }}>info@ + john@</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "#475569" }}>
            {lastRefresh ? `Updated ${timeAgo(lastRefresh)}` : ""}
          </span>
          <button onClick={load} disabled={loading} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 12px", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>
            {loading ? "..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1e293b", background: "#0d1117" }}>
        {[
          { label: "All", value: emails.length, key: "all" },
          { label: "Inbound", value: inboundCount, key: "inbound" },
          { label: "Outbound", value: outboundCount, key: "outbound" },
          { label: "New Contacts", value: unmatchedCount, key: "unmatched" },
        ].map(s => (
          <button key={s.key} onClick={() => setFilter(s.key)} style={{
            flex: 1, padding: "12px 8px", background: filter === s.key ? "#111827" : "transparent",
            border: "none", borderBottom: filter === s.key ? "2px solid #3b82f6" : "2px solid transparent",
            color: filter === s.key ? "#fff" : "#64748b", cursor: "pointer", textAlign: "center",
          }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{s.label}</div>
          </button>
        ))}
      </div>

      {/* Search + time filter */}
      <div style={{ padding: "12px 24px", display: "flex", gap: 12, borderBottom: "1px solid #1e293b", background: "#0d1117" }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search emails, companies, contacts..."
          style={{ flex: 1, background: "#111827", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 12px", color: "#d1dbed", fontSize: 13, outline: "none" }}
        />
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 12px", color: "#94a3b8", fontSize: 13 }}>
          <option value={1}>Today</option>
          <option value={3}>3 days</option>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>

      {/* Email list */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "8px 16px" }}>
        {loading && emails.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>Loading...</div>
        )}
        
        {filtered.map(e => {
          const isInbound = e.type === "email_received";
          const coName = companies[e.company_id];
          const gmailUrl = e.gmail_id ? `https://mail.google.com/mail/u/0/#inbox/${e.gmail_id}` : null;
          const crmUrl = e.company_id ? `/?company=${e.company_id}` : null;
          const otherParty = isInbound ? e.from_email : e.to_email;

          return (
            <div key={e.id} style={{
              padding: "14px 16px", borderBottom: "1px solid #111827",
              display: "flex", gap: 12, alignItems: "flex-start",
              transition: "background 0.15s",
              cursor: gmailUrl ? "pointer" : "default",
            }}
            onClick={() => gmailUrl && window.open(gmailUrl, "_blank")}
            onMouseOver={ev => ev.currentTarget.style.background = "#111827"}
            onMouseOut={ev => ev.currentTarget.style.background = "transparent"}
            >
              {/* Direction indicator */}
              <div style={{
                width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                background: isInbound ? "#0f2d1a" : "#1a1a2e", border: `1px solid ${isInbound ? "#166534" : "#312e81"}`,
                fontSize: 14, flexShrink: 0, marginTop: 2,
              }}>
                {isInbound ? "IN" : "OUT"}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  {/* Sender/recipient */}
                  <span style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {otherParty || "unknown"}
                  </span>
                  
                  {/* Company badge */}
                  {coName && (
                    <a href={crmUrl} onClick={ev => ev.stopPropagation()} style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#1e293b", color: "#60a5fa",
                      textDecoration: "none", whiteSpace: "nowrap", border: "1px solid #2d3748",
                    }}>
                      {coName}
                    </a>
                  )}
                  {!coName && !e.company_id && (
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#1c1917", color: "#a16207", border: "1px solid #422006" }}>
                      New
                    </span>
                  )}

                  {/* Timestamp */}
                  <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto", whiteSpace: "nowrap" }}>
                    {timeAgo(e.created_at)}
                  </span>
                </div>

                {/* Subject */}
                <div style={{ fontSize: 13, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.subject || "(no subject)"}
                </div>

                {/* Snippet */}
                {e.snippet && (
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.snippet}
                  </div>
                )}
              </div>

              {/* Gmail link icon */}
              {gmailUrl && (
                <div style={{ flexShrink: 0, marginTop: 4, opacity: 0.4 }} title="Open in Gmail">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
                </div>
              )}
            </div>
          );
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
            {search ? "No emails match your search" : "No emails in this time range"}
          </div>
        )}
      </div>
    </div>
  );
}
