"use client";
// Everyone who has dealt with a brand: NDA signers, deal-room buyers and inbound leads, one row per person.
import { useEffect, useState } from "react";
import { authFetch } from "../lib/authFetch";
import { VerticalBadge, vMeta } from "../lib/vertical";

const ss = { background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: "7px 10px", borderRadius: 4, fontSize: 12, fontFamily: "inherit" };
const th = { padding: "10px 12px", textAlign: "left", color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" };
const td = { padding: "10px 12px", borderBottom: "1px solid #1e293b", verticalAlign: "top" };

function ago(iso) {
  if (!iso) return "—";
  const d = Math.round((Date.now() - new Date(iso)) / 864e5);
  return d < 1 ? "today" : d < 60 ? d + "d ago" : new Date(iso).toLocaleDateString();
}

export default function PeoplePanel({ vertical }) {
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => { const t = setTimeout(() => setQuery(q), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    setD(null); setErr("");
    authFetch(`/api/admin/people?vertical=${vertical}&type=${type}&q=${encodeURIComponent(query)}`).then(setD).catch((e) => setErr(e.message));
  }, [vertical, type, query]);

  const c = d?.counts || {};
  const box = (label, value, color, key) => (
    <div onClick={key ? () => setType(key) : undefined} style={{ background: "#111827", border: "1px solid " + (key && type === key ? "#3b82f6" : "#1e293b"), borderRadius: 8, padding: "12px 16px", minWidth: 120, cursor: key ? "pointer" : "default" }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#e2e8f0" }}>{value ?? "…"}</div>
    </div>
  );

  return (
    <div style={{ padding: "16px 24px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {box("Everyone", c.all, null, "all")}
        {box("Buyers", c.buyers, "#60a5fa", "buyers")}
        {box("Sellers", c.sellers, "#fb923c", "sellers")}
        {box("With open items", c.open, "#f87171")}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, company, phone…" style={{ ...ss, marginLeft: "auto", width: 300, alignSelf: "center" }} />
      </div>
      {err && <div style={{ color: "#f87171" }}>{err}</div>}
      {!d && !err && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>Loading…</div>}
      {d && !d.people.length && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>No one yet for {vMeta(vertical).label}.</div>}
      {d && d.people.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "2px solid #1e293b", background: "#0f1219" }}>
              {["Person", "Brand", "Role", "How they came in", "Listings", "Last activity", ""].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {d.people.map((p) => (
                <tr key={p.email}>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{p.name || p.email}</div>
                    <div style={{ color: "#94a3b8", fontSize: 12 }}>{p.name ? p.email : ""}{p.phone ? (p.name ? " · " : "") + p.phone : ""}</div>
                    {p.company && <div style={{ color: "#64748b", fontSize: 12 }}>{p.company}</div>}
                  </td>
                  <td style={td}><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{p.verticals.map((v) => <VerticalBadge key={v} slug={v} />)}</div></td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {p.roles.map((r) => <div key={r} style={{ color: r === "seller" ? "#fb923c" : "#60a5fa", fontWeight: 700 }}>{r === "seller" ? "Seller" : "Buyer"}</div>)}
                    {p.ndas > 0 && <div style={{ color: "#c084fc" }}>NDA ×{p.ndas}</div>}
                    {p.deal_room && <div style={{ color: "#4ade80" }}>Opened deal room</div>}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: "#94a3b8" }}>{p.sources.join(", ")}</td>
                  <td style={{ ...td, fontSize: 12, color: "#94a3b8", maxWidth: 260 }}>{p.listings.slice(0, 3).join(", ")}{p.listings.length > 3 ? ` +${p.listings.length - 3}` : ""}</td>
                  <td style={{ ...td, fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{ago(p.last_at)}</td>
                  <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>
                    {p.open_items > 0 && <a href="/queue" style={{ color: "#f87171", fontWeight: 700, textDecoration: "none" }}>{p.open_items} open →</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.total > d.people.length && <div style={{ padding: 12, fontSize: 12, color: "#64748b" }}>Showing the {d.people.length} most recent of {d.total.toLocaleString()}. Search to narrow it down.</div>}
        </div>
      )}
    </div>
  );
}
