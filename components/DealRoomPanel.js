"use client";
import { useState, useEffect, useCallback } from "react";

const SB = "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const SK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indncm14aHhvem95dmNtdmJmdXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4MzI5MTUsImV4cCI6MjA3NDQwODkxNX0.zuOIlNRTC3kjBWHxp9_sef2V9pe9erDSljEcJ2EL9to";
const H = { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" };

const URGENCY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#3b82f6" };
const STATUS_COLOR  = { pending_review: "#f59e0b", pushed_to_gmail: "#10b981", sent: "#22c55e" };

function UrgencyBadge({ urgency }) {
  const c = URGENCY_COLOR[urgency] || "#6b7280";
  return <span style={{ background: c + "20", color: c, border: "1px solid " + c + "40", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{urgency || "—"}</span>;
}
function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || "#6b7280";
  const label = { pending_review: "Pending Review", pushed_to_gmail: "In Gmail Drafts", sent: "Sent" }[status] || status;
  return <span style={{ background: c + "20", color: c, border: "1px solid " + c + "40", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{label}</span>;
}

function DraftCard({ email, onPushed }) {
  const [draft, setDraft]     = useState(email.draft_reply || "");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState(null);

  async function saveDraft() {
    await fetch(SB + "/rest/v1/atm_activity_log?id=eq." + email.id, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ draft_reply: draft }),
    });
    setEditing(false);
    setMsg("Draft saved.");
    setTimeout(() => setMsg(null), 2000);
  }

  async function generateDraft() {
    setLoading(true); setMsg("Generating draft...");
    try {
      const res = await fetch("/api/gmail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: email.id }),
      });
      const data = await res.json();
      if (data.results?.[0]?.draft) {
        setDraft(data.results[0].draft);
        setMsg("Draft generated.");
      } else {
        setMsg("Generation failed: " + (data.error || "unknown error"));
      }
    } catch (e) { setMsg("Error: " + e.message); }
    setLoading(false);
    setTimeout(() => setMsg(null), 3000);
  }

  async function pushToGmail() {
    setLoading(true); setMsg("Pushing to Gmail Drafts...");
    try {
      // Save any edits first
      await fetch(SB + "/rest/v1/atm_activity_log?id=eq." + email.id, {
        method: "PATCH", headers: H,
        body: JSON.stringify({ draft_reply: draft, draft_status: "pending_review" }),
      });
      // Trigger the Python push via API route
      const res = await fetch("/api/gmail/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: email.id }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg("✓ Pushed to Gmail Drafts");
        onPushed(email.id, data.gmail_link);
      } else {
        setMsg("Push failed: " + (data.error || "unknown"));
      }
    } catch (e) { setMsg("Error: " + e.message); }
    setLoading(false);
    setTimeout(() => setMsg(null), 4000);
  }

  const pushed = email.draft_status === "pushed_to_gmail";
  const gmailLink = email.draft_gmail_id
    ? `https://mail.google.com/mail/u/0/#drafts`
    : null;

  return (
    <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {email.subject || "(no subject)"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b" }}>From: {email.from_email}</div>
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: 12, flexShrink: 0 }}>
          <UrgencyBadge urgency={email.urgency} />
          <StatusBadge status={email.draft_status} />
        </div>
      </div>

      {/* Original snippet */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 11, color: "#94a3b8", fontStyle: "italic", lineHeight: 1.5 }}>
        {email.snippet || email.body?.substring(0, 200) || "—"}
      </div>

      {/* Classification reason */}
      {email.classification_reason && (
        <div style={{ fontSize: 10, color: "#475569", marginBottom: 10 }}>
          🤖 {email.classification_reason}
        </div>
      )}

      {/* Draft reply */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Draft Reply</span>
          <div style={{ display: "flex", gap: 6 }}>
            {!editing && (
              <button onClick={() => setEditing(true)}
                style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 4, padding: "2px 10px", fontSize: 11, cursor: "pointer" }}>
                Edit
              </button>
            )}
            {editing && (
              <button onClick={saveDraft}
                style={{ background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640", borderRadius: 4, padding: "2px 10px", fontSize: 11, cursor: "pointer" }}>
                Save
              </button>
            )}
            <button onClick={generateDraft} disabled={loading}
              style={{ background: "#2d2550", color: "#8b5cf6", border: "1px solid #8b5cf640", borderRadius: 4, padding: "2px 10px", fontSize: 11, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
              Regenerate
            </button>
          </div>
        </div>

        {editing ? (
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            style={{ width: "100%", minHeight: 120, background: "#0f172a", border: "1px solid #3b82f6", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#e2e8f0", lineHeight: 1.6, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
        ) : (
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#e2e8f0", lineHeight: 1.6, whiteSpace: "pre-wrap", minHeight: 60 }}>
            {draft || <span style={{ color: "#475569", fontStyle: "italic" }}>No draft yet — click Regenerate</span>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={pushToGmail} disabled={loading || !draft || pushed}
          style={{ background: pushed ? "#1a3a2a" : "#1a3a2a", color: pushed ? "#10b981" : "#10b981", border: "1px solid #10b98140", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: pushed ? "default" : "pointer", opacity: (!draft || loading) ? 0.4 : 1 }}>
          {pushed ? "✓ In Gmail Drafts" : "→ Push to Gmail Drafts"}
        </button>

        {gmailLink && (
          <a href={gmailLink} target="_blank" rel="noreferrer"
            style={{ color: "#3b82f6", fontSize: 11, textDecoration: "none" }}>
            Open in Gmail ↗
          </a>
        )}

        <a href={`https://mail.google.com/mail/u/0/#search/from:${encodeURIComponent(email.from_email)}`}
          target="_blank" rel="noreferrer"
          style={{ color: "#475569", fontSize: 11, textDecoration: "none", marginLeft: "auto" }}>
          View thread ↗
        </a>
      </div>

      {msg && <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>{msg}</div>}
    </div>
  );
}

export default function DealRoomPanel() {
  const [emails, setEmails]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter]   = useState("pending_review");
  const [msg, setMsg]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url = SB + "/rest/v1/atm_activity_log?classification=eq.BUYER_INQUIRY&draft_reply=not.is.null&order=created_at.desc&limit=30";
      if (filter !== "all") url += "&draft_status=eq." + filter;
      const res = await fetch(url, { headers: H });
      const data = await res.json();
      setEmails(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function runClassifier() {
    setRunning(true); setMsg("Running classifier...");
    try {
      const res = await fetch("/api/gmail/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: 48 }),
      });
      const data = await res.json();
      setMsg(`✓ Classified ${data.processed} emails, ${data.buyer_inquiries} buyer inquiries found`);
      if (data.buyer_inquiries > 0) {
        await runDraftGenerator();
      }
    } catch (e) { setMsg("Error: " + e.message); }
    setRunning(false);
    setTimeout(() => { setMsg(null); load(); }, 3000);
  }

  async function runDraftGenerator() {
    setMsg("Generating drafts...");
    await fetch("/api/gmail/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 48 }),
    });
  }

  function onPushed(id, gmailLink) {
    setEmails(prev => prev.map(e => e.id === id ? { ...e, draft_status: "pushed_to_gmail" } : e));
  }

  const pending = emails.filter(e => e.draft_status === "pending_review").length;

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>
            Deal Room
            {pending > 0 && (
              <span style={{ marginLeft: 10, background: "#4a3520", color: "#f59e0b", border: "1px solid #f59e0b40", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                {pending} pending
              </span>
            )}
          </h2>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>AI-drafted replies to buyer inquiries</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
            Refresh
          </button>
          <button onClick={runClassifier} disabled={running}
            style={{ background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: running ? 0.5 : 1 }}>
            {running ? "Running..." : "⚡ Scan + Draft"}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["pending_review", "Pending"], ["pushed_to_gmail", "In Gmail"], ["all", "All"]].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ background: filter === v ? "#1e3a5f" : "#1e293b", color: filter === v ? "#3b82f6" : "#64748b", border: "1px solid " + (filter === v ? "#3b82f640" : "#334155"), borderRadius: 6, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: filter === v ? 600 : 400 }}>
            {l}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ color: "#475569", fontSize: 13, padding: 20, textAlign: "center" }}>Loading...</div>
      ) : emails.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 13, padding: 40, textAlign: "center", background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
          No {filter === "all" ? "" : filter.replace("_", " ")} drafts found.<br />
          <span style={{ fontSize: 11, marginTop: 8, display: "block" }}>Click "⚡ Scan + Draft" to classify recent emails and generate drafts.</span>
        </div>
      ) : (
        emails.map(email => <DraftCard key={email.id} email={email} onPushed={onPushed} />)
      )}

      {msg && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, padding: "10px 16px", fontSize: 12, zIndex: 1000 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
