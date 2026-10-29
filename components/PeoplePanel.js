"use client";
// Everyone who has dealt with a brand: NDA signers, deal-room buyers and inbound leads, one row per person.
import { useEffect, useState } from "react";
import { authFetch } from "../lib/authFetch";
import { VerticalBadge, vMeta, VERTICALS } from "../lib/vertical";
import PersonDrawer, { OpenItem } from "./PersonDrawer";

const ss = { background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: "7px 10px", borderRadius: 4, fontSize: 12, fontFamily: "inherit" };
const th = { padding: "10px 12px", textAlign: "left", color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" };
const td = { padding: "10px 12px", borderBottom: "1px solid #1e293b", verticalAlign: "top" };

function dueTxt(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now(), h = Math.abs(ms) / 36e5;
  const t = h < 1 ? Math.round(h * 60) + "m" : h < 48 ? Math.round(h) + "h" : Math.round(h / 24) + "d";
  return ms < 0 ? { t: "overdue " + t, c: "#f87171" } : { t: "due in " + t, c: "#facc15" };
}

function ago(iso) {
  if (!iso) return "—";
  const d = Math.round((Date.now() - new Date(iso)) / 864e5);
  return d < 1 ? "today" : d < 60 ? d + "d ago" : new Date(iso).toLocaleDateString();
}

// One brand's weekly-email switch for one person: green = on the list, amber = signed up but not confirmed, grey = off.
function ListToggle({ slug, status, disabled, onToggle, showLabel }) {
  const on = status === "subscribed", pending = status === "pending", unsub = status === "unsubscribed";
  const color = on ? "#22c55e" : pending ? "#f59e0b" : "#475569";
  const m = vMeta(slug);
  const tip = disabled ? "Lists aren't connected yet" : on ? "On the weekly list. Click to remove." : pending ? "Signed up, hasn't confirmed. Click to add now." : unsub ? "Unsubscribed. Click to add back." : "Not on the list. Click to add.";
  return (
    <button onClick={onToggle} disabled={disabled} title={`${m.label}: ${tip}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid " + (on ? "#22c55e66" : "#334155"), borderRadius: 999, padding: "3px 8px 3px 4px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, marginRight: 4, marginBottom: 4 }}>
      <span style={{ width: 26, height: 14, borderRadius: 999, background: on ? "#22c55e" : "#1e293b", border: "1px solid " + color, position: "relative", display: "inline-block" }}>
        <span style={{ position: "absolute", top: 1, left: on ? 13 : 1, width: 10, height: 10, borderRadius: 999, background: on ? "#fff" : color, transition: "left .15s" }} />
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color: on ? "#4ade80" : pending ? "#fbbf24" : "#94a3b8" }}>
        {showLabel ? m.short : on ? "On" : pending ? "Pending" : unsub ? "Unsubscribed" : "Off"}
      </span>
    </button>
  );
}

// mode="inbox": the work list (Needs reply / Waiting on NDA / Done). mode="contacts": look anyone up.
export default function PeoplePanel({ vertical, mode = "contacts", initialType }) {
  const inbox = mode === "inbox";
  const [type, setType] = useState(initialType || (inbox ? "open" : "all"));
  const [person, setPerson] = useState(null);
  const [tick, setTick] = useState(0);
  const [list, setList] = useState("all");
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => { const t = setTimeout(() => setQuery(q), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    setD(null); setErr("");
    authFetch(`/api/admin/people?vertical=${vertical}&type=${type}&list=${list}&q=${encodeURIComponent(query)}`).then(setD).catch((e) => setErr(e.message));
  }, [vertical, type, list, query, tick]);
  useEffect(() => { authFetch("/api/admin/subscriptions").then((r) => setConfigured(!!r.configured)).catch(() => {}); }, []);

  async function toggle(p, slug) {
    const cur = p.lists?.[slug];
    const on = cur !== "subscribed";
    if (on && cur === "unsubscribed" && !window.confirm(`${p.email} unsubscribed from ${vMeta(slug).label}. Add them back anyway?`)) return;
    setBusy(p.email + slug);
    try {
      const r = await authFetch("/api/admin/subscriptions", { method: "POST", body: JSON.stringify({ email: p.email, vertical: slug, on }) });
      setD((prev) => prev && { ...prev, people: prev.people.map((x) => (x.email === p.email ? { ...x, lists: { ...x.lists, [slug]: r.status } } : x)) });
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  const listSlugs = (p) => (vertical !== "all" ? [vertical] : [...new Set([...p.verticals, ...Object.keys(p.lists || {})])]);

  const c = d?.counts || {};
  const box = (label, value, color, key) => (
    <div onClick={key ? () => setType(key) : undefined} style={{ background: "#111827", border: "1px solid " + (key && type === key ? "#3b82f6" : "#1e293b"), borderRadius: 8, padding: "12px 16px", minWidth: 120, cursor: key ? "pointer" : "default" }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#e2e8f0" }}>{value ?? (d ? "→" : "…")}</div>
    </div>
  );

  return (
    <div style={{ padding: "16px 24px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {inbox ? (<>
          {box("Needs reply" + (c.overdue ? ` · ${c.overdue} overdue` : ""), c.open, "#f87171", "open")}
          {box("Waiting on NDA", c.nda, "#c084fc", "nda")}
          {box("Done (14 days)", null, "#4ade80", "done")}
        </>) : (<>
          {box("Everyone", c.all, null, "all")}
          {box("Buyers", c.buyers, "#60a5fa", "buyers")}
          {box("Sellers", c.sellers, "#fb923c", "sellers")}
          {box("On weekly email", c.subscribed, "#4ade80")}
        </>)}
        {!inbox && <select value={list} onChange={(e) => setList(e.target.value)} style={{ ...ss, alignSelf: "center" }} title="Filter by weekly email list">
          <option value="all">Weekly email: everyone</option>
          <option value="subscribed">On the list</option>
          <option value="not_subscribed">Not on the list</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, company, phone…" style={{ ...ss, marginLeft: "auto", width: 300, alignSelf: "center" }} />
      </div>
      {err && <div style={{ color: "#f87171" }}>{err}</div>}
      {!d && !err && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>Loading…</div>}
      {d && d.unmatched?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, marginBottom: 8 }}>
            Waiting on us, no person attached yet ({d.unmatched.length}): forwards and notifications without a buyer or seller email
          </div>
          {d.unmatched.map((i) => <OpenItem key={i.id} i={i} onChange={() => setTick((t) => t + 1)} />)}
        </div>
      )}
      {d && !d.people.length && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>{inbox && type === "open" ? `Nothing waiting on a reply for ${vMeta(vertical).label}.` : `No one here for ${vMeta(vertical).label} with these filters.`}</div>}
      {d && d.people.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "2px solid #1e293b", background: "#0f1219" }}>
              {(inbox ? ["Person", "Brand", "Role", "How they came in", "Listings", "Last activity", "What's waiting"] : ["Person", "Brand", "Role", "Weekly email", "How they came in", "Listings", "Last activity", ""]).map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {d.people.map((p) => (
                <tr key={p.email} onClick={() => setPerson(p.email)} style={{ cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#111827")} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
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
                  {!inbox && <td style={{ ...td, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                    {listSlugs(p).filter((v) => VERTICALS.some((x) => x.slug === v)).map((v) => (
                      <ListToggle key={v} slug={v} status={p.lists?.[v]} showLabel={vertical === "all"} disabled={!configured || busy === p.email + v} onToggle={() => toggle(p, v)} />
                    ))}
                  </td>}
                  <td style={{ ...td, fontSize: 12, color: "#94a3b8" }}>{p.sources.join(", ")}</td>
                  <td style={{ ...td, fontSize: 12, color: "#94a3b8", maxWidth: 260 }}>{p.listings.slice(0, 3).join(", ")}{p.listings.length > 3 ? ` +${p.listings.length - 3}` : ""}</td>
                  <td style={{ ...td, fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{ago(p.last_at)}</td>
                  <td style={{ ...td, fontSize: 12, maxWidth: 320 }}>
                    {p.needs_reply > 0 && (() => {
                      const dt = dueTxt(p.next_due);
                      return (
                        <>
                          <div style={{ whiteSpace: "nowrap" }}>
                            <span style={{ color: "#f87171", fontWeight: 700 }}>{p.needs_reply} waiting →</span>
                            {p.high && <span style={{ color: "#f87171", fontWeight: 700 }}> HIGH</span>}
                            {dt && <span style={{ color: dt.c }}> · {dt.t}</span>}
                          </div>
                          {inbox && p.next_what && <div style={{ color: "#94a3b8", marginTop: 2 }}>{p.next_what}</div>}
                        </>
                      );
                    })()}
                    {!p.needs_reply && type === "nda" && <div style={{ color: "#c084fc" }}>NDA link sent, not signed{p.nda_what ? <div style={{ color: "#94a3b8", marginTop: 2 }}>{p.nda_what}</div> : null}</div>}
                    {!p.needs_reply && type === "done" && <div style={{ color: "#4ade80" }}>Replied {ago(p.last_done_at)}{p.done_what ? <div style={{ color: "#94a3b8", marginTop: 2 }}>{p.done_what}</div> : null}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.total > d.people.length && <div style={{ padding: 12, fontSize: 12, color: "#64748b" }}>Showing the {d.people.length} most recent of {d.total.toLocaleString()}. Search to narrow it down.</div>}
        </div>
      )}
      {person && <PersonDrawer email={person} onClose={() => setPerson(null)} onChanged={() => setTick((t) => t + 1)} />}
    </div>
  );
}
