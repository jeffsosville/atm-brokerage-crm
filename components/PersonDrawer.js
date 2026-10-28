"use client";
// One person, everything in one place: what's waiting on us (with the draft and actions), then every touch, newest first.
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../lib/authFetch";
import { VerticalBadge } from "../lib/vertical";

const KIND = {
  offer: ["Offer", "#f87171"], seller_lead: ["Seller lead", "#fb923c"], data_room: ["Data room", "#c084fc"],
  buyer_question: ["Buyer question", "#60a5fa"], existing_deal: ["Existing deal", "#4ade80"],
  marketplace_lead: ["Marketplace lead", "#22d3ee"], other: ["Other", "#94a3b8"],
};
const TYPE = {
  email_in: ["IN", "#4ade80"], email_out: ["OUT", "#818cf8"], lead: ["LEAD", "#fb923c"], nda: ["NDA", "#c084fc"],
  deal_room: ["ROOM", "#22d3ee"], file_view: ["FILES", "#22d3ee"], instantly: ["INST", "#fbbf24"], newsletter: ["LIST", "#94a3b8"],
};
const DRAFTABLE = ["buyer_question", "data_room", "existing_deal", "offer", "seller_lead"];
const btn = (primary) => ({ background: primary ? "#1e3a5f" : "#1a1f2e", color: primary ? "#93c5fd" : "#cbd5e1", border: "1px solid " + (primary ? "#3b82f6" : "#334155"), borderRadius: 5, padding: "5px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", textDecoration: "none" });

function when(iso) {
  const d = new Date(iso), days = (Date.now() - d) / 864e5;
  if (days < 1) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
}
function due(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now(), h = Math.abs(ms) / 36e5;
  const t = h < 1 ? Math.round(h * 60) + "m" : h < 48 ? Math.round(h) + "h" : Math.round(h / 24) + "d";
  return ms < 0 ? { t: "overdue " + t, c: "#f87171" } : { t: "due in " + t, c: "#94a3b8" };
}
const gmail = (i) => i.thread_id ? `https://mail.google.com/mail/u/?authuser=${i.draft_mailbox === "john" ? "john" : "info"}@atmbrokerage.com#all/${i.thread_id}` : null;

export function OpenItem({ i, onChange }) {
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [kl, kc] = KIND[i.kind] || KIND.other;
  const d = due(i.due_at);
  const act = async (body, tag) => {
    setBusy(tag);
    try { await authFetch("/api/admin/inbound", { method: "PATCH", body: JSON.stringify({ id: i.id, ...body }) }); onChange(); }
    catch (e) { alert(e.message); }
    setBusy("");
  };
  const g = gmail(i);
  return (
    <div style={{ border: "1px solid " + (i.priority === "high" ? "#7f1d1d" : "#334155"), borderRadius: 8, padding: 12, marginBottom: 10, background: "#111827" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        {i.vertical && <VerticalBadge slug={i.vertical} />}
        <span style={{ color: kc, fontWeight: 700 }}>{kl}</span>
        {i.status === "awaiting_nda" && <span style={{ color: "#c084fc" }}>Waiting for NDA</span>}
        {i.priority === "high" && <span style={{ color: "#f87171", fontWeight: 700 }}>HIGH</span>}
        {d && <span style={{ color: d.c, fontWeight: 700 }}>{d.t}</span>}
        {i.route && <a href={"/dd/" + i.route.slug} style={{ color: "#60a5fa", textDecoration: "none" }}>{i.route.title}</a>}
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: "#e2e8f0" }}>{i.summary || i.subject}</div>
      {i.suggested_action && <div style={{ marginTop: 4, fontSize: 12, color: "#93c5fd" }}>→ {i.suggested_action}</div>}
      {i.draft_text ? (
        <div style={{ marginTop: 8, border: "1px solid " + (i.must_go_to_john ? "#7f1d1d" : "#1e293b"), borderRadius: 6, padding: 10, background: "rgba(96,165,250,0.05)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", marginBottom: 4 }}>
            Draft reply {i.must_go_to_john && <span style={{ color: "#f87171" }}>· Needs John</span>}
            <span style={{ color: "#64748b", fontWeight: 400 }}> · {i.draft_pushed_at ? `in ${i.draft_mailbox}@ Gmail Drafts` : "goes to Gmail Drafts at the next sync"}</span>
          </div>
          {i.draft_notes && <div style={{ fontSize: 12, color: "#fbbf24", marginBottom: 4 }}>{i.draft_notes}</div>}
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.45, color: "#e2e8f0" }}>{i.draft_text}</div>
        </div>
      ) : i.draft_error ? <div style={{ marginTop: 6, fontSize: 12, color: "#f87171" }}>Draft failed: {i.draft_error}</div> : null}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {g && <a href={g} target="_blank" rel="noreferrer" style={btn(true)}>Open in Gmail</a>}
        {i.draft_text && <button style={btn(false)} onClick={() => { navigator.clipboard?.writeText(i.draft_text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy draft"}</button>}
        {DRAFTABLE.includes(i.kind) && <button style={btn(false)} disabled={!!busy} onClick={() => act({ action: "redraft" }, "d")}>{busy === "d" ? "Drafting…" : i.draft_text ? "Redraft" : "Draft a reply"}</button>}
        <button style={btn(false)} disabled={!!busy} onClick={() => act({ status: "replied" }, "r")}>Mark replied</button>
        <button style={btn(false)} disabled={!!busy} onClick={() => { const r = prompt("Why is this not a lead?"); if (r !== null) act({ status: "not_a_lead", closed_reason: r || "not a lead" }, "n"); }}>Not a lead</button>
      </div>
    </div>
  );
}

export default function PersonDrawer({ email, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    setErr("");
    authFetch("/api/admin/person?email=" + encodeURIComponent(email)).then(setD).catch((e) => setErr(e.message));
  }, [email]);
  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const p = d?.person;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 40 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(640px, 100vw)", background: "#0f1219", borderLeft: "1px solid #1e293b", zIndex: 41, overflowY: "auto", fontFamily: "inherit", color: "#e2e8f0" }}>
        <div style={{ position: "sticky", top: 0, background: "#0f1219", borderBottom: "1px solid #1e293b", padding: "16px 20px", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{p?.name || email}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                <a href={"mailto:" + email} style={{ color: "#94a3b8" }}>{email}</a>{p?.phone ? " · " + p.phone : ""}{p?.company ? " · " + p.company : ""}
              </div>
              {p && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
                  {p.verticals.map((v) => <VerticalBadge key={v} slug={v} />)}
                  {p.seller && <span style={{ color: "#fb923c", fontWeight: 700 }}>Seller</span>}
                  {p.buyer && <span style={{ color: "#60a5fa", fontWeight: 700 }}>Buyer</span>}
                  {p.listings.slice(0, 4).map((l) => <span key={l} style={{ color: "#64748b" }}>{l}</span>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ ...btn(false), alignSelf: "flex-start" }}>Close</button>
          </div>
        </div>

        <div style={{ padding: "16px 20px" }}>
          {err && <div style={{ color: "#f87171" }}>{err}</div>}
          {!d && !err && <div style={{ color: "#64748b" }}>Loading…</div>}
          {d && d.open.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: "#f87171", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, marginBottom: 8 }}>Waiting on us ({d.open.length})</div>
              {d.open.map((i) => <OpenItem key={i.id} i={i} onChange={() => { load(); onChanged?.(); }} />)}
            </>
          )}
          {d && (
            <>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, margin: "14px 0 8px" }}>History</div>
              {!d.timeline.length && <div style={{ color: "#64748b", fontSize: 13 }}>Nothing on record yet.</div>}
              {d.timeline.map((t, n) => {
                const [tl, tc] = TYPE[t.type] || ["•", "#94a3b8"];
                return (
                  <div key={n} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid #1e293b" }}>
                    <span style={{ width: 44, flexShrink: 0, fontSize: 10, fontWeight: 700, color: tc, paddingTop: 2 }}>{tl}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {t.link ? <a href={t.link} target="_blank" rel="noreferrer" style={{ color: "#e2e8f0", textDecoration: "none" }}>{t.title} ↗</a> : t.title}
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>{when(t.at)}</span>
                      </div>
                      {t.detail && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{t.detail}</div>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}
