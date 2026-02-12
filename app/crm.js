"use client";
import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indncm14aHhvem95dmNtdmJmdXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4MzI5MTUsImV4cCI6MjA3NDQwODkxNX0.zuOIlNRTC3kjBWHxp9_sef2V9pe9erDSljEcJ2EL9to";

const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

const STATUSES = [
  { v: "new", l: "New", c: "#3b82f6", b: "#1e3a5f" },
  { v: "emailed", l: "Emailed", c: "#f59e0b", b: "#4a3520" },
  { v: "responded", l: "Responded", c: "#10b981", b: "#1a3a2a" },
  { v: "called", l: "Called", c: "#8b5cf6", b: "#2d2550" },
  { v: "in_pipeline", l: "In Pipeline", c: "#ef4444", b: "#4a2020" },
  { v: "not_interested", l: "Not Interested", c: "#6b7280", b: "#2a2a2a" },
  { v: "dead", l: "Dead", c: "#374151", b: "#1a1a1a" },
];

const CATS = ["all","confirmed_atm","operator","likely_related","services","maybe_related","manufacturer","processor"];
const SEGS = ["all","seller","buyer","unknown"];

async function api(path) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: H });
  if (!r.ok) throw new Error("Supabase error: " + r.status);
  return r.json();
}

function today() { return new Date().toISOString().split("T")[0]; }

function followUpStatus(dateStr) {
  if (!dateStr) return null;
  const d = dateStr.split("T")[0];
  const t = today();
  if (d < t) return "overdue";
  if (d === t) return "due";
  return "upcoming";
}

function FollowUpBadge({ dateStr }) {
  const s = followUpStatus(dateStr);
  if (!s) return null;
  const d = dateStr.split("T")[0];
  const cfg = {
    overdue: { c: "#ef4444", b: "#4a2020", l: "Overdue" },
    due: { c: "#f59e0b", b: "#4a3520", l: "Due Today" },
    upcoming: { c: "#3b82f6", b: "#1e3a5f", l: d },
  };
  const x = cfg[s];
  return <span style={{ background: x.b, color: x.c, border: "1px solid " + x.c + "40", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{x.l}</span>;
}

function Badge({ status }) {
  const s = STATUSES.find(x => x.v === status) || STATUSES[0];
  return <span style={{ background: s.b, color: s.c, border: "1px solid " + s.c + "40", padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{s.l}</span>;
}

function SegBadge({ segment }) {
  const m = { seller: { c: "#ef4444", b: "#4a2020" }, buyer: { c: "#10b981", b: "#1a3a2a" }, unknown: { c: "#64748b", b: "#1a1f2e" } };
  const s = m[segment] || m.unknown;
  return <span style={{ background: s.b, color: s.c, border: "1px solid " + s.c + "40", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{segment || "unknown"}</span>;
}

function Row({ co, onClick, sel }) {
  const atm = co.estimated_atm_count;
  return (
    <tr onClick={() => onClick(co)} style={{ cursor: "pointer", background: sel ? "#1a2a3a" : "transparent", borderBottom: "1px solid #1a1f2e" }}
      onMouseEnter={e => { if (!sel) e.currentTarget.style.background = "#111827"; }}
      onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}>
      <td style={{ padding: "10px 12px", maxWidth: 220 }}>
        <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 13 }}>{co.company_name}</div>
        {co.dba_name && <div style={{ fontSize: 11, color: "#64748b" }}>DBA: {co.dba_name}</div>}
        {co.next_followup_at && <div style={{ marginTop: 3 }}><FollowUpBadge dateStr={co.next_followup_at} /></div>}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>{co.city && co.state ? co.city + ", " + co.state : co.state || "\u2014"}</td>
      <td style={{ padding: "10px 12px" }}><Badge status={co.status || "new"} /></td>
      <td style={{ padding: "10px 12px" }}><SegBadge segment={co.segment} /></td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>{co.category || "\u2014"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13, textAlign: "center", fontWeight: atm ? 700 : 400, color: atm ? "#10b981" : "#475569" }}>{atm ? atm.toLocaleString() : "\u2014"}</td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {co.email && <span title="Has email" style={{ color: "#3b82f6", fontSize: 14 }}>&#9993;</span>}
          {co.phone && <span title="Has phone" style={{ color: "#10b981", fontSize: 14 }}>&#9742;</span>}
          {co.website && <span title="Has website" style={{ color: "#f59e0b", fontSize: 14 }}>&#9679;</span>}
        </div>
      </td>
    </tr>
  );
}

function ContactCard({ contact }) {
  return (
    <div style={{ background: "#1a1f2e", borderRadius: 6, padding: 10, marginBottom: 6, border: "1px solid #334155" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{contact.first_name || ""} {contact.last_name || ""}</span>
          {!contact.first_name && !contact.last_name && contact.name && <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{contact.name}</span>}
        </div>
        <SegBadge segment={contact.segment} />
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{contact.email}</div>
      {contact.phone && <div style={{ fontSize: 12, color: "#94a3b8" }}>{contact.phone}</div>}
      {contact.tags && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{contact.tags}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {contact.email && <a href={"mailto:" + contact.email} style={{ background: "#1e3a5f", color: "#3b82f6", padding: "3px 10px", borderRadius: 4, fontSize: 11, textDecoration: "none", fontWeight: 600 }}>&#9993; Email</a>}
        {contact.phone && <a href={"tel:" + contact.phone} style={{ background: "#1a3a2a", color: "#10b981", padding: "3px 10px", borderRadius: 4, fontSize: 11, textDecoration: "none", fontWeight: 600 }}>&#9742; Call</a>}
      </div>
    </div>
  );
}

function QuickDateBtn({ label, days, onClick }) {
  return <button onClick={() => onClick(days)} style={{ background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>{label}</button>;
}

function Detail({ co, onClose, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(co.status || "new");
  const [segment, setSegment] = useState(co.segment || "unknown");
  const [priority, setPriority] = useState(co.priority || "");
  const [notes, setNotes] = useState(co.notes || "");
  const [followup, setFollowup] = useState(co.next_followup_at ? co.next_followup_at.split("T")[0] : "");
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  useEffect(() => {
    setStatus(co.status || "new"); setSegment(co.segment || "unknown");
    setPriority(co.priority || ""); setNotes(co.notes || ""); setEditing(false);
    setFollowup(co.next_followup_at ? co.next_followup_at.split("T")[0] : "");
    setLoadingContacts(true);
    api("atm_contacts?company_id=eq." + co.id + "&order=segment.asc,email.asc&limit=50")
      .then(data => setContacts(data))
      .catch(e => console.error(e))
      .finally(() => setLoadingContacts(false));
  }, [co.id]);

  const setFollowupDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setFollowup(d.toISOString().split("T")[0]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { status, segment, priority, notes, next_followup_at: followup || null, last_contacted_at: new Date().toISOString() };
      await fetch(SUPABASE_URL + "/rest/v1/atm_companies?id=eq." + co.id, { method: "PATCH", headers: H, body: JSON.stringify(body) });
      onUpdate({ ...co, ...body });
    } catch (e) { console.error(e); }
    setSaving(false); setEditing(false);
  };

  const clearFollowup = async () => {
    try {
      await fetch(SUPABASE_URL + "/rest/v1/atm_companies?id=eq." + co.id, { method: "PATCH", headers: H, body: JSON.stringify({ next_followup_at: null }) });
      setFollowup("");
      onUpdate({ ...co, next_followup_at: null });
    } catch (e) { console.error(e); }
  };

  const ls = { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4, display: "block" };
  const vs = { fontSize: 14, color: "#e2e8f0", lineHeight: 1.5 };
  const fs = { marginBottom: 16 };

  return (
    <div style={{ position: "fixed", top: 0, right: 0, width: 460, height: "100vh", background: "#0f1219", borderLeft: "1px solid #1e293b", overflowY: "auto", padding: 24, zIndex: 100, boxShadow: "-4px 0 24px rgba(0,0,0,0.4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>{co.company_name}</h2>
          {co.dba_name && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>DBA: {co.dba_name}</div>}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", cursor: "pointer", padding: "4px 10px", borderRadius: 4, fontSize: 14 }}>&#10005;</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {co.email && <a href={"mailto:" + co.email} style={{ background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>&#9993; Email</a>}
        {co.phone && <a href={"tel:" + co.phone} style={{ background: "#1a3a2a", color: "#10b981", border: "1px solid #10b98140", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>&#9742; Call</a>}
        {co.website && <a href={co.website} target="_blank" rel="noreferrer" style={{ background: "#4a3520", color: "#f59e0b", border: "1px solid #f59e0b40", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>&#9679; Website</a>}
      </div>

      {/* Follow-up section */}
      <div style={{ background: followup && followUpStatus(followup) === "overdue" ? "#4a202040" : followup && followUpStatus(followup) === "due" ? "#4a352040" : "#111827", border: "1px solid " + (followup && followUpStatus(followup) === "overdue" ? "#ef444440" : followup && followUpStatus(followup) === "due" ? "#f59e0b40" : "#1e293b"), borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <label style={ls}>Follow-up</label>
        {editing ? (
          <div>
            <input type="date" value={followup} onChange={e => setFollowup(e.target.value)} style={{ background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <QuickDateBtn label="Tomorrow" days={1} onClick={setFollowupDays} />
              <QuickDateBtn label="3 Days" days={3} onClick={setFollowupDays} />
              <QuickDateBtn label="1 Week" days={7} onClick={setFollowupDays} />
              <QuickDateBtn label="2 Weeks" days={14} onClick={setFollowupDays} />
              <QuickDateBtn label="1 Month" days={30} onClick={setFollowupDays} />
              <button onClick={() => setFollowup("")} style={{ background: "#4a2020", color: "#ef4444", border: "1px solid #ef444440", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Clear</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {followup ? (<><FollowUpBadge dateStr={followup} /><span style={{ fontSize: 13, color: "#94a3b8" }}>{followup}</span><button onClick={clearFollowup} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11 }}>&#10005;</button></>) : <span style={{ fontSize: 13, color: "#475569" }}>No follow-up set</span>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={ls}>Status</label>
          {editing ? <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 12 }}>{STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select> : <Badge status={status} />}
        </div>
        <div style={{ flex: 1 }}>
          <label style={ls}>Segment</label>
          {editing ? <select value={segment} onChange={e => setSegment(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 12 }}><option value="seller">Seller</option><option value="buyer">Buyer</option><option value="unknown">Unknown</option></select> : <SegBadge segment={segment} />}
        </div>
        <div style={{ flex: 1 }}>
          <label style={ls}>Priority</label>
          {editing ? <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 12 }}><option value="">None</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select> : <span style={vs}>{priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : "\u2014"}</span>}
        </div>
      </div>
      <div style={{ background: "#111827", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={fs}><label style={ls}>Location</label><span style={vs}>{[co.city, co.state, co.zip].filter(Boolean).join(", ") || "\u2014"}</span></div>
        <div style={fs}><label style={ls}>Phone</label><span style={vs}>{co.phone || "\u2014"}</span></div>
        <div style={fs}><label style={ls}>Email</label><span style={{ ...vs, wordBreak: "break-all" }}>{co.email || "\u2014"}</span></div>
        <div style={fs}><label style={ls}>Website</label><span style={{ ...vs, wordBreak: "break-all" }}>{co.website || "\u2014"}</span></div>
        <div style={fs}><label style={ls}>Category</label><span style={vs}>{co.category || "\u2014"}</span></div>
        <div style={fs}><label style={ls}>Est. ATM Count</label><span style={{ ...vs, color: co.estimated_atm_count ? "#10b981" : "#475569", fontWeight: co.estimated_atm_count ? 700 : 400, fontSize: co.estimated_atm_count ? 18 : 14 }}>{co.estimated_atm_count ? co.estimated_atm_count.toLocaleString() : "\u2014"}</span></div>
        {co.year_founded && <div style={fs}><label style={ls}>Year Founded</label><span style={vs}>{co.year_founded}</span></div>}
        {co.employee_count && <div style={fs}><label style={ls}>Employees</label><span style={vs}>{co.employee_count}</span></div>}
        {co.last_contacted_at && <div style={fs}><label style={ls}>Last Contacted</label><span style={vs}>{new Date(co.last_contacted_at).toLocaleDateString()}</span></div>}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ ...ls, marginBottom: 8 }}>Contacts ({contacts.length})</label>
        {loadingContacts ? <div style={{ color: "#475569", fontSize: 12 }}>Loading...</div> :
          contacts.length === 0 ? <div style={{ color: "#475569", fontSize: 12 }}>No linked contacts</div> :
          contacts.map((c, i) => <ContactCard key={i} contact={c} />)}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={ls}>Notes</label>
        {editing ? <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 8, borderRadius: 6, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} /> : <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, maxHeight: 150, overflowY: "auto" }}>{notes || "\u2014"}</div>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {editing ? (<><button onClick={save} disabled={saving} style={{ flex: 1, background: "#10b981", color: "#fff", border: "none", padding: 10, borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{saving ? "Saving..." : "Save"}</button><button onClick={() => setEditing(false)} style={{ background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", padding: "10px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>Cancel</button></>) : (<button onClick={() => setEditing(true)} style={{ flex: 1, background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640", padding: 10, borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Edit Lead</button>)}
      </div>
    </div>
  );
}

export default function CRM() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [segFilter, setSegFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [followFilter, setFollowFilter] = useState("all");
  const [hasEmail, setHasEmail] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [sortBy, setSortBy] = useState("atm_count");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({});
  const [followStats, setFollowStats] = useState({ overdue: 0, due: 0, upcoming: 0 });
  const PS = 50;

  useEffect(() => {
    api("crm_stats?select=*").then(d => {
      if (d && d[0]) {
        const s = d[0];
        setStats({ total: s.total_active, withEmail: s.with_email, withPhone: s.with_phone, withAtmCount: s.with_atm_count, confirmed: s.confirmed_atm, operators: s.operators });
      }
    }).catch(e => console.error(e));

    // Load follow-up counts
    const t = today();
    Promise.all([
      api("atm_companies?select=id&next_followup_at=lt." + t + "&next_followup_at=not.is.null&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)"),
      api("atm_companies?select=id&next_followup_at=eq." + t + "&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)"),
      api("atm_companies?select=id&next_followup_at=gt." + t + "&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)"),
    ]).then(([overdue, due, upcoming]) => {
      setFollowStats({ overdue: overdue.length, due: due.length, upcoming: upcoming.length });
    }).catch(e => console.error(e));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = "atm_companies?select=*&order=" + (sortBy === "atm_count" ? "estimated_atm_count.desc.nullslast" : sortBy === "name" ? "company_name.asc" : sortBy === "city" ? "city.asc.nullslast" : sortBy === "followup" ? "next_followup_at.asc.nullslast" : "updated_at.desc") + "&offset=" + (page * PS) + "&limit=" + PS;
      q += "&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)";
      if (catFilter !== "all") q += "&category=eq." + catFilter;
      if (segFilter !== "all") q += "&segment=eq." + segFilter;
      if (statusFilter !== "all") q += "&status=eq." + statusFilter;
      if (followFilter === "overdue") q += "&next_followup_at=lt." + today() + "&next_followup_at=not.is.null";
      if (followFilter === "due") q += "&next_followup_at=eq." + today();
      if (followFilter === "due_or_overdue") q += "&next_followup_at=lte." + today() + "&next_followup_at=not.is.null";
      if (followFilter === "has_followup") q += "&next_followup_at=not.is.null";
      if (hasEmail) q += "&email=not.is.null";
      if (hasPhone) q += "&phone=not.is.null";
      if (search) q += "&or=(company_name.ilike.*" + search + "*,city.ilike.*" + search + "*,state.ilike.*" + search + "*,notes.ilike.*" + search + "*)";
      const data = await api(q);
      setCompanies(data);
      let cq = "atm_companies?select=count&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)";
      if (catFilter !== "all") cq += "&category=eq." + catFilter;
      if (segFilter !== "all") cq += "&segment=eq." + segFilter;
      if (statusFilter !== "all") cq += "&status=eq." + statusFilter;
      if (followFilter === "overdue") cq += "&next_followup_at=lt." + today() + "&next_followup_at=not.is.null";
      if (followFilter === "due") cq += "&next_followup_at=eq." + today();
      if (followFilter === "due_or_overdue") cq += "&next_followup_at=lte." + today() + "&next_followup_at=not.is.null";
      if (followFilter === "has_followup") cq += "&next_followup_at=not.is.null";
      if (hasEmail) cq += "&email=not.is.null";
      if (hasPhone) cq += "&phone=not.is.null";
      if (search) cq += "&or=(company_name.ilike.*" + search + "*,city.ilike.*" + search + "*,state.ilike.*" + search + "*,notes.ilike.*" + search + "*)";
      const cr = await fetch(SUPABASE_URL + "/rest/v1/" + cq, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
      const rng = cr.headers.get("content-range");
      if (rng) setTotal(parseInt(rng.split("/")[1]) || 0);
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  }, [page, catFilter, segFilter, statusFilter, followFilter, hasEmail, hasPhone, search, sortBy]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [catFilter, segFilter, statusFilter, followFilter, hasEmail, hasPhone, search, sortBy]);

  const upd = (u) => { setCompanies(p => p.map(c => c.id === u.id ? u : c)); setSelected(u); };
  const ss = { background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: "7px 10px", borderRadius: 4, fontSize: 12 };

  const box = (label, value, color, onClick) => (
    <div onClick={onClick} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 100, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#e2e8f0" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", background: "#0a0e17", color: "#e2e8f0", minHeight: "100vh" }}>
      <div style={{ background: "#0f1219", borderBottom: "1px solid #1e293b", padding: "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>ATM Brokerage <span style={{ color: "#3b82f6", fontWeight: 400 }}>CRM</span></h1>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{total.toLocaleString()} companies &#183; Page {page + 1} of {Math.ceil(total / PS) || 1}</div>
          </div>
          <input type="text" placeholder="Search companies, cities, states..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 320, background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: "10px 14px", borderRadius: 6, fontSize: 13, outline: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          {box("Total Active", stats.total || 0, "#e2e8f0")}
          {box("With Email", stats.withEmail || 0, "#3b82f6")}
          {box("With Phone", stats.withPhone || 0, "#10b981")}
          {box("Confirmed ATM", stats.confirmed || 0, "#ef4444")}
          {box("Operators", stats.operators || 0, "#8b5cf6")}
        </div>
        {/* Follow-up alert bar */}
        {(followStats.overdue > 0 || followStats.due > 0) && (
          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            {followStats.overdue > 0 && box("Overdue", followStats.overdue, "#ef4444", () => { setFollowFilter("overdue"); setSortBy("followup"); })}
            {followStats.due > 0 && box("Due Today", followStats.due, "#f59e0b", () => { setFollowFilter("due"); setSortBy("followup"); })}
            {box("Upcoming", followStats.upcoming, "#3b82f6", () => { setFollowFilter("has_followup"); setSortBy("followup"); })}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={ss}><option value="all">All Categories</option>{CATS.filter(c => c !== "all").map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
          <select value={segFilter} onChange={e => setSegFilter(e.target.value)} style={ss}><option value="all">All Segments</option>{SEGS.filter(s => s !== "all").map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}</select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={ss}><option value="all">All Statuses</option>{STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
          <select value={followFilter} onChange={e => setFollowFilter(e.target.value)} style={ss}>
            <option value="all">All Follow-ups</option>
            <option value="due_or_overdue">Due / Overdue</option>
            <option value="overdue">Overdue Only</option>
            <option value="due">Due Today</option>
            <option value="has_followup">Has Follow-up</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={ss}><option value="atm_count">Sort: ATM Count &#8595;</option><option value="followup">Sort: Follow-up Date</option><option value="name">Sort: Name A-Z</option><option value="city">Sort: City A-Z</option><option value="recent">Sort: Recently Updated</option></select>
          <label style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={hasEmail} onChange={e => setHasEmail(e.target.checked)} /> Has Email</label>
          <label style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} /> Has Phone</label>
          <button onClick={load} style={{ ...ss, cursor: "pointer", background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640" }}>&#8635; Refresh</button>
        </div>
      </div>
      <div style={{ overflowX: "auto", marginRight: selected ? 460 : 0, transition: "margin 0.2s" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "#475569", fontSize: 14 }}>Loading...</div> : (<>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "2px solid #1e293b", background: "#0f1219" }}>
              {["Company", "Location", "Status", "Segment", "Category", "ATMs", "Contact"].map((h, i) => <th key={h} style={{ padding: "10px 12px", textAlign: i === 5 ? "center" : "left", color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>{h}</th>)}
            </tr></thead>
            <tbody>{companies.map(c => <Row key={c.id} co={c} onClick={setSelected} sel={selected?.id === c.id} />)}</tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: 16 }}>
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={{ ...ss, cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>&#8592; Prev</button>
            <span style={{ fontSize: 12, color: "#475569", padding: "7px 14px" }}>{page * PS + 1}&#8211;{Math.min((page + 1) * PS, total)} of {total.toLocaleString()}</span>
            <button onClick={() => setPage(page + 1)} disabled={(page + 1) * PS >= total} style={{ ...ss, cursor: (page + 1) * PS >= total ? "not-allowed" : "pointer", opacity: (page + 1) * PS >= total ? 0.4 : 1 }}>Next &#8594;</button>
          </div>
        </>)}
      </div>
      {selected && <Detail co={selected} onClose={() => setSelected(null)} onUpdate={upd} />}
    </div>
  );
}
