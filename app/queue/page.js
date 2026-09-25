"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import LoginPage from "../../components/LoginPage";
import { authFetch } from "../../lib/authFetch";
import { C, btn, page } from "../../components/ddUi";

const KIND = {
  offer: ["Offer", "#f87171"], seller_lead: ["Seller lead", "#fb923c"], data_room: ["Data room", "#c084fc"],
  buyer_question: ["Buyer question", "#60a5fa"], existing_deal: ["Existing deal", "#4ade80"],
  marketplace_lead: ["Marketplace lead", "#22d3ee"], vendor: ["Vendor", "#64748b"], internal: ["Internal", "#64748b"],
  automated: ["Automated", "#64748b"], spam: ["Spam", "#64748b"], other: ["Other", "#94a3b8"],
};
const SRC = { email: "Email", marketplace: "BizBuySell", deal_room: "Deal room", listing: "Listing page", nda: "NDA" };

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return m + "m";
  const h = Math.round(m / 60);
  return h < 48 ? h + "h" : Math.round(h / 24) + "d";
}
function dueLabel(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  const h = Math.abs(ms) / 36e5;
  const txt = h < 1 ? Math.round(h * 60) + "m" : h < 48 ? Math.round(h) + "h" : Math.round(h / 24) + "d";
  return ms < 0 ? { t: "overdue " + txt, c: "#f87171" } : { t: "due in " + txt, c: h < 2 ? "#facc15" : C.faint };
}
const gmailLink = (i) => i.thread_id ? `https://mail.google.com/mail/u/?authuser=info@atmbrokerage.com#all/${i.thread_id}` : null;

export default function Queue() {
  const { user, loading } = useAuth();
  const [view, setView] = useState("open");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => authFetch("/api/admin/inbound?view=" + view).then(setD).catch((e) => setErr(e.message)), [view]);
  useEffect(() => { if (user) { setD(null); load(); } }, [user, load]);

  const act = async (id, body) => {
    try { await authFetch("/api/admin/inbound", { method: "PATCH", body: JSON.stringify({ id, ...body }) }); load(); }
    catch (e) { alert(e.message); }
  };

  if (loading) return <div style={{ ...page, padding: 40, color: C.faint }}>Loading...</div>;
  if (!user) return <LoginPage />;

  const counts = d?.counts || {};
  const tabs = [["open", `Needs reply (${counts.open ?? "…"})`], ["overdue", `Overdue (${counts.overdue ?? "…"})`], ["done", "Replied / not a lead"], ["filtered", "Auto-filtered"]];

  return (
    <div style={page}>
      <div style={{ background: C.panel, borderBottom: "1px solid " + C.line, padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <a href="/" style={{ color: C.faint, textDecoration: "none", fontSize: 13 }}>← CRM</a>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Inbound <span style={{ color: C.blue, fontWeight: 400 }}>Queue</span></h1>
        {counts.high > 0 && <span style={{ color: "#f87171", fontSize: 13, fontWeight: 700 }}>{counts.high} high priority</span>}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
          {tabs.map(([k, l]) => <button key={k} onClick={() => setView(k)} style={btn(view === k)}>{l}</button>)}
        </div>
      </div>

      <div style={{ padding: 24 }}>
        {err && <div style={{ color: "#f87171" }}>{err}</div>}
        {!d && !err && <div style={{ color: C.faint }}>Loading...</div>}
        {d && !d.items.length && <div style={{ color: C.faint }}>Nothing here.</div>}
        {d && d.items.map((i) => {
          const [kl, kc] = KIND[i.kind] || KIND.other;
          const due = ["new", "drafted", "awaiting_john"].includes(i.status) ? dueLabel(i.due_at) : null;
          const g = gmailLink(i);
          return (
            <div key={i.id} style={{ background: C.card, border: "1px solid " + (i.priority === "high" ? "#7f1d1d" : C.line), borderRadius: 8, padding: "12px 16px", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ color: kc, fontWeight: 700 }}>{kl}</span>
                <span style={{ color: C.faint }}>{SRC[i.source] || i.source}</span>
                {i.is_nda_signer && <span style={{ color: "#c084fc" }}>NDA signed</span>}
                {i.priority === "high" && <span style={{ color: "#f87171", fontWeight: 700 }}>HIGH</span>}
                <span style={{ color: C.faint }}>{ago(i.last_message_at)} ago</span>
                {due && <span style={{ color: due.c, fontWeight: 700 }}>{due.t}</span>}
                {i.route && <a href={"/dd/" + i.route.slug} style={{ color: C.blue, textDecoration: "none" }}>{i.route.title}</a>}
              </div>
              <div style={{ marginTop: 6, fontWeight: 700 }}>{i.from_name ? i.from_name + " · " : ""}<span style={{ color: C.dim, fontWeight: 400 }}>{i.from_email}</span></div>
              <div style={{ marginTop: 4, fontSize: 13 }}>{i.summary || i.subject}</div>
              {i.snippet && <div style={{ marginTop: 4, fontSize: 12, color: C.faint, maxHeight: 36, overflow: "hidden" }}>{i.snippet}</div>}
              {i.suggested_action && <div style={{ marginTop: 4, fontSize: 12, color: "#93c5fd" }}>→ {i.suggested_action}</div>}
              {i.closed_reason && <div style={{ marginTop: 4, fontSize: 11, color: C.faint }}>{i.closed_reason}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {g && <a href={g} target="_blank" rel="noreferrer" style={{ ...btn(true), textDecoration: "none" }}>Open in Gmail</a>}
                {i.source === "deal_room" && i.route && <a href={"/dd/" + i.route.slug} style={{ ...btn(false), textDecoration: "none" }}>Route DD</a>}
                {["new", "drafted", "awaiting_john"].includes(i.status) ? (
                  <>
                    <button style={btn(false)} onClick={() => act(i.id, { status: "replied" })}>Mark replied</button>
                    <button style={btn(false)} onClick={() => { const r = prompt("Why is this not a lead?"); if (r !== null) act(i.id, { status: "not_a_lead", closed_reason: r || "not a lead" }); }}>Not a lead</button>
                  </>
                ) : (
                  <button style={btn(false)} onClick={() => act(i.id, { status: "new", closed_reason: "" })}>Reopen</button>
                )}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: C.faint, marginTop: 12 }}>
          Checks for new mail every 15 minutes. An item is marked replied automatically when a reply shows up in the same Gmail thread. Reply targets: offers and seller leads 2 business hours, data-room issues 4, buyer questions same business day.
        </div>
      </div>
    </div>
  );
}
