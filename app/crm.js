"use client";
import { useState, useEffect, useCallback } from "react";

const SB = "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const SK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indncm14aHhvem95dmNtdmJmdXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4MzI5MTUsImV4cCI6MjA3NDQwODkxNX0.zuOIlNRTC3kjBWHxp9_sef2V9pe9erDSljEcJ2EL9to";
const H = { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json", Prefer: "return=representation" };

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
const SEGS = ["all","seller","buyer","both","unknown"];
const STAGES = [
  { v: "prospect", l: "Prospect", c: "#3b82f6" },
  { v: "contacted", l: "Contacted", c: "#8b5cf6" },
  { v: "interested", l: "Interested", c: "#f59e0b" },
  { v: "valuation", l: "Valuation", c: "#f97316" },
  { v: "listed", l: "Listed", c: "#10b981" },
  { v: "under_contract", l: "Under Contract", c: "#06b6d4" },
  { v: "closed", l: "Closed", c: "#22c55e" },
  { v: "dead_deal", l: "Dead", c: "#6b7280" },
];

async function api(path) {
  const r = await fetch(SB + "/rest/v1/" + path, { headers: H });
  if (!r.ok) throw new Error("Supabase error: " + r.status);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(SB + "/rest/v1/" + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Supabase error: " + r.status);
  return r.json();
}
async function apiPatch(path, body) {
  const r = await fetch(SB + "/rest/v1/" + path, { method: "PATCH", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Supabase error: " + r.status);
  return r.json();
}

function today() { return new Date().toISOString().split("T")[0]; }
function followUpStatus(d) { if (!d) return null; const x = d.split("T")[0], t = today(); return x < t ? "overdue" : x === t ? "due" : "upcoming"; }
function money(n) { return n ? "$" + Number(n).toLocaleString() : "\u2014"; }

function FollowUpBadge({ dateStr }) {
  const s = followUpStatus(dateStr);
  if (!s) return null;
  const d = dateStr.split("T")[0];
  const cfg = { overdue: { c: "#ef4444", b: "#4a2020", l: "Overdue" }, due: { c: "#f59e0b", b: "#4a3520", l: "Due Today" }, upcoming: { c: "#3b82f6", b: "#1e3a5f", l: d } };
  const x = cfg[s];
  return <span style={{ background: x.b, color: x.c, border: "1px solid " + x.c + "40", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{x.l}</span>;
}
function Badge({ status }) {
  const s = STATUSES.find(x => x.v === status) || STATUSES[0];
  return <span style={{ background: s.b, color: s.c, border: "1px solid " + s.c + "40", padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{s.l}</span>;
}
function SegBadge({ segment }) {
  const m = { seller: { c: "#ef4444", b: "#4a2020" }, buyer: { c: "#10b981", b: "#1a3a2a" }, both: { c: "#f59e0b", b: "#4a3520" }, unknown: { c: "#64748b", b: "#1a1f2e" } };
  const s = m[segment] || m.unknown;
  return <span style={{ background: s.b, color: s.c, border: "1px solid " + s.c + "40", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{segment || "unknown"}</span>;
}
function StageBadge({ stage }) {
  const s = STAGES.find(x => x.v === stage) || STAGES[0];
  return <span style={{ background: s.c + "20", color: s.c, border: "1px solid " + s.c + "40", padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{s.l}</span>;
}

// ======================== PIPELINE VIEW ========================

function DealCard({ deal, onClick }) {
  const fu = deal.next_followup_at;
  return (
    <div onClick={() => onClick(deal)} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 12, marginBottom: 8, cursor: "pointer", transition: "border-color 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#334155"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#1e293b"}>
      <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 13, marginBottom: 4 }}>{deal.deal_name || "Untitled Deal"}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        {deal.atm_count && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>{deal.atm_count.toLocaleString()} ATMs</span>}
        {deal.asking_price && <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>{money(deal.asking_price)}</span>}
      </div>
      {deal.route_state && <div style={{ fontSize: 11, color: "#64748b" }}>{deal.route_cities ? deal.route_cities + ", " + deal.route_state : deal.route_state}</div>}
      {fu && <div style={{ marginTop: 4 }}><FollowUpBadge dateStr={fu} /></div>}
      {deal.priority === "high" && <div style={{ marginTop: 4 }}><span style={{ background: "#4a2020", color: "#ef4444", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600 }}>HIGH</span></div>}
    </div>
  );
}

function PipelineColumn({ stage, deals, onDealClick }) {
  const s = STAGES.find(x => x.v === stage.v);
  const columnDeals = deals.filter(d => d.stage === stage.v);
  return (
    <div style={{ minWidth: 220, maxWidth: 260, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "0 4px" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.c }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.l}</span>
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>({columnDeals.length})</span>
      </div>
      <div style={{ background: "#0a0e17", borderRadius: 8, padding: 8, minHeight: 200, border: "1px solid #1a1f2e" }}>
        {columnDeals.length === 0 ? <div style={{ color: "#334155", fontSize: 12, textAlign: "center", padding: 20 }}>No deals</div> :
          columnDeals.map(d => <DealCard key={d.id} deal={d} onClick={onDealClick} />)}
      </div>
    </div>
  );
}

function DealDetail({ deal, onClose, onUpdate, onDelete }) {
  const [stage, setStage] = useState(deal.stage);
  const [name, setName] = useState(deal.deal_name || "");
  const [atmCount, setAtmCount] = useState(deal.atm_count || "");
  const [asking, setAsking] = useState(deal.asking_price || "");
  const [offer, setOffer] = useState(deal.offer_price || "");
  const [finalP, setFinalP] = useState(deal.final_price || "");
  const [commission, setCommission] = useState(deal.commission || "");
  const [routeState, setRouteState] = useState(deal.route_state || "");
  const [routeCities, setRouteCities] = useState(deal.route_cities || "");
  const [followup, setFollowup] = useState(deal.next_followup_at ? deal.next_followup_at.split("T")[0] : "");
  const [priority, setPriority] = useState(deal.priority || "");
  const [notes, setNotes] = useState(deal.notes || "");
  const [saving, setSaving] = useState(false);
  const [seller, setSeller] = useState(null);

  useEffect(() => {
    if (deal.seller_company_id) {
      api("atm_companies?id=eq." + deal.seller_company_id + "&select=company_name,email,phone,website,city,state").then(d => { if (d[0]) setSeller(d[0]); });
    }
  }, [deal.seller_company_id]);

  const setFollowupDays = (days) => { const d = new Date(); d.setDate(d.getDate() + days); setFollowup(d.toISOString().split("T")[0]); };

  const save = async () => {
    setSaving(true);
    const body = {
      stage, deal_name: name, atm_count: atmCount || null, asking_price: asking || null,
      offer_price: offer || null, final_price: finalP || null, commission: commission || null,
      route_state: routeState || null, route_cities: routeCities || null,
      next_followup_at: followup || null, priority: priority || null, notes,
      stage_changed_at: stage !== deal.stage ? new Date().toISOString() : deal.stage_changed_at,
      updated_at: new Date().toISOString(),
    };
    if (stage === "listed" && !deal.listed_at) body.listed_at = new Date().toISOString();
    if (stage === "under_contract" && !deal.under_contract_at) body.under_contract_at = new Date().toISOString();
    if (stage === "closed" && !deal.closed_at) body.closed_at = new Date().toISOString();
    try {
      await apiPatch("atm_deals?id=eq." + deal.id, body);
      onUpdate({ ...deal, ...body });
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const ls = { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4, display: "block" };
  const inp = { width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 8, borderRadius: 4, fontSize: 13, boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", top: 0, right: 0, width: 480, height: "100vh", background: "#0f1219", borderLeft: "1px solid #1e293b", overflowY: "auto", padding: 24, zIndex: 100, boxShadow: "-4px 0 24px rgba(0,0,0,0.4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>Deal Details</h2>
        <button onClick={onClose} style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", cursor: "pointer", padding: "4px 10px", borderRadius: 4, fontSize: 14 }}>&#10005;</button>
      </div>

      {/* Seller info */}
      {seller && (
        <div style={{ background: "#111827", borderRadius: 8, padding: 12, marginBottom: 16, border: "1px solid #1e293b" }}>
          <label style={ls}>Seller</label>
          <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14 }}>{seller.company_name}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{seller.city}, {seller.state}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {seller.email && <a href={"mailto:" + seller.email} style={{ background: "#1e3a5f", color: "#3b82f6", padding: "4px 12px", borderRadius: 4, fontSize: 11, textDecoration: "none", fontWeight: 600 }}>&#9993; Email</a>}
            {seller.phone && <a href={"tel:" + seller.phone} style={{ background: "#1a3a2a", color: "#10b981", padding: "4px 12px", borderRadius: 4, fontSize: 11, textDecoration: "none", fontWeight: 600 }}>&#9742; Call</a>}
          </div>
        </div>
      )}

      {/* Stage */}
      <div style={{ marginBottom: 16 }}>
        <label style={ls}>Stage</label>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {STAGES.map(s => (
            <button key={s.v} onClick={() => setStage(s.v)} style={{ background: stage === s.v ? s.c + "30" : "#1a1f2e", color: stage === s.v ? s.c : "#64748b", border: "1px solid " + (stage === s.v ? s.c + "60" : "#334155"), padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{s.l}</button>
          ))}
        </div>
      </div>

      {/* Deal info */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div><label style={ls}>Deal Name</label><input value={name} onChange={e => setName(e.target.value)} style={{ ...inp, gridColumn: "1/3" }} /></div>
        <div><label style={ls}>ATM Count</label><input type="number" value={atmCount} onChange={e => setAtmCount(e.target.value)} style={inp} /></div>
        <div><label style={ls}>Asking Price</label><input type="number" value={asking} onChange={e => setAsking(e.target.value)} style={inp} placeholder="$" /></div>
        <div><label style={ls}>Offer Price</label><input type="number" value={offer} onChange={e => setOffer(e.target.value)} style={inp} placeholder="$" /></div>
        <div><label style={ls}>Final Price</label><input type="number" value={finalP} onChange={e => setFinalP(e.target.value)} style={inp} placeholder="$" /></div>
        <div><label style={ls}>Commission</label><input type="number" value={commission} onChange={e => setCommission(e.target.value)} style={inp} placeholder="$" /></div>
        <div><label style={ls}>Priority</label><select value={priority} onChange={e => setPriority(e.target.value)} style={inp}><option value="">None</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
      </div>

      {/* Location */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div><label style={ls}>Route State</label><input value={routeState} onChange={e => setRouteState(e.target.value)} style={inp} /></div>
        <div><label style={ls}>Route Cities</label><input value={routeCities} onChange={e => setRouteCities(e.target.value)} style={inp} /></div>
      </div>

      {/* Follow-up */}
      <div style={{ marginBottom: 16 }}>
        <label style={ls}>Follow-up</label>
        <input type="date" value={followup} onChange={e => setFollowup(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[["Tomorrow",1],["3 Days",3],["1 Week",7],["2 Weeks",14],["1 Month",30]].map(([l,d]) =>
            <button key={l} onClick={() => setFollowupDays(d)} style={{ background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>{l}</button>
          )}
          <button onClick={() => setFollowup("")} style={{ background: "#4a2020", color: "#ef4444", border: "1px solid #ef444440", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Clear</button>
        </div>
      </div>

      {/* Timestamps */}
      {(deal.listed_at || deal.under_contract_at || deal.closed_at) && (
        <div style={{ background: "#111827", borderRadius: 8, padding: 12, marginBottom: 16, border: "1px solid #1e293b" }}>
          {deal.listed_at && <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Listed: {new Date(deal.listed_at).toLocaleDateString()}</div>}
          {deal.under_contract_at && <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Under Contract: {new Date(deal.under_contract_at).toLocaleDateString()}</div>}
          {deal.closed_at && <div style={{ fontSize: 12, color: "#22c55e", fontWeight: 700 }}>Closed: {new Date(deal.closed_at).toLocaleDateString()}</div>}
        </div>
      )}

      {/* Notes */}
      <div style={{ marginBottom: 16 }}>
        <label style={ls}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} style={{ ...inp, resize: "vertical" }} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} disabled={saving} style={{ flex: 1, background: "#10b981", color: "#fff", border: "none", padding: 12, borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{saving ? "Saving..." : "Save Deal"}</button>
        <button onClick={() => { if (confirm("Delete this deal? This cannot be undone.")) onDelete(deal.id); }} style={{ background: "#4a2020", color: "#ef4444", border: "1px solid #ef444440", padding: "12px 16px", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Delete</button>
      </div>
    </div>
  );
}

function Pipeline() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const loadDeals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("atm_deals?select=*&order=updated_at.desc");
      setDeals(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  const handleUpdate = (updated) => {
    setDeals(p => p.map(d => d.id === updated.id ? updated : d));
    setSelected(updated);
  };

  const totalValue = deals.filter(d => d.stage !== "dead_deal" && d.stage !== "closed").reduce((s, d) => s + (Number(d.asking_price) || 0), 0);
  const closedValue = deals.filter(d => d.stage === "closed").reduce((s, d) => s + (Number(d.final_price) || Number(d.asking_price) || 0), 0);

  return (
    <div>
      {/* Pipeline stats */}
      <div style={{ display: "flex", gap: 10, padding: "16px 24px", flexWrap: "wrap" }}>
        <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", minWidth: 120 }}>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>Active Deals</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>{deals.filter(d => d.stage !== "dead_deal" && d.stage !== "closed").length}</div>
        </div>
        <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", minWidth: 120 }}>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>Pipeline Value</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#10b981" }}>{money(totalValue)}</div>
        </div>
        <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", minWidth: 120 }}>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>Closed Value</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#22c55e" }}>{money(closedValue)}</div>
        </div>
        <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", minWidth: 120 }}>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>Total Deals</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>{deals.length}</div>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>Loading pipeline...</div> : (
        <div style={{ display: "flex", gap: 12, padding: "0 24px 24px", overflowX: "auto", marginRight: selected ? 480 : 0, transition: "margin 0.2s" }}>
          {STAGES.filter(s => s.v !== "dead_deal").map(s => <PipelineColumn key={s.v} stage={s} deals={deals} onDealClick={setSelected} />)}
        </div>
      )}

      {selected && <DealDetail deal={selected} onClose={() => setSelected(null)} onUpdate={handleUpdate} onDelete={async (id) => {
        try {
          await fetch(SB + "/rest/v1/atm_deals?id=eq." + id, { method: "DELETE", headers: H });
          setDeals(p => p.filter(d => d.id !== id));
          setSelected(null);
        } catch (e) { console.error(e); }
      }} />}
    </div>
  );
}

// ======================== CRM TABLE VIEW ========================

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

function ContactCard({ contact, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(contact.first_name || "");
  const [lastName, setLastName] = useState(contact.last_name || "");
  const [email, setEmail] = useState(contact.email || "");
  const [phone, setPhone] = useState(contact.phone || "");
  const [tags, setTags] = useState(contact.tags || "");
  const [seg, setSeg] = useState(contact.segment || "unknown");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body = { first_name: firstName || null, last_name: lastName || null, email: email || null, phone: phone || null, tags: tags || null, segment: seg };
      await apiPatch("atm_contacts?id=eq." + contact.id, body);
      onSave({ ...contact, ...body });
      setEditing(false);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const del = async () => {
    if (!confirm("Delete this contact?")) return;
    try {
      await fetch(SB + "/rest/v1/atm_contacts?id=eq." + contact.id, { method: "DELETE", headers: H });
      onDelete(contact.id);
    } catch (e) { console.error(e); }
  };

  const inp = { width: "100%", background: "#111827", color: "#e2e8f0", border: "1px solid #334155", padding: 5, borderRadius: 4, fontSize: 12, boxSizing: "border-box" };

  if (editing) return (
    <div style={{ background: "#1a1f2e", borderRadius: 6, padding: 10, marginBottom: 6, border: "1px solid #3b82f640" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
        <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" style={inp} />
        <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" style={inp} />
      </div>
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={{ ...inp, marginBottom: 6 }} />
      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" style={{ ...inp, marginBottom: 6 }} />
      <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma separated)" style={{ ...inp, marginBottom: 6 }} />
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Segment</div>
        <div style={{ display: "flex", gap: 4 }}>
          {["seller","buyer","both","unknown"].map(s => <button key={s} onClick={() => setSeg(s)} style={{ background: seg === s ? (s === "seller" ? "#4a2020" : s === "buyer" ? "#1a3a2a" : s === "both" ? "#4a3520" : "#1a1f2e") : "#111827", color: seg === s ? (s === "seller" ? "#ef4444" : s === "buyer" ? "#10b981" : s === "both" ? "#f59e0b" : "#64748b") : "#475569", border: "1px solid #334155", padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", textTransform: "uppercase" }}>{s}</button>)}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={save} disabled={saving} style={{ background: "#10b981", color: "#fff", border: "none", padding: "5px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{saving ? "..." : "Save"}</button>
        <button onClick={() => setEditing(false)} style={{ background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Cancel</button>
        <button onClick={del} style={{ background: "#4a2020", color: "#ef4444", border: "1px solid #ef444440", padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", marginLeft: "auto" }}>Delete</button>
      </div>
    </div>
  );

  return (
    <div style={{ background: "#1a1f2e", borderRadius: 6, padding: 10, marginBottom: 6, border: "1px solid #334155" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{contact.first_name || ""} {contact.last_name || ""}{!contact.first_name && !contact.last_name && contact.name ? contact.name : ""}</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <SegBadge segment={contact.segment} />
          <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}>&#9998;</button>
        </div>
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

function AddContactForm({ companyId, onAdd }) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [seg, setSeg] = useState("unknown");
  const [saving, setSaving] = useState(false);
  const inp = { width: "100%", background: "#111827", color: "#e2e8f0", border: "1px solid #334155", padding: 5, borderRadius: 4, fontSize: 12, boxSizing: "border-box" };

  const save = async () => {
    if (!email && !phone && !firstName) return;
    setSaving(true);
    try {
      const body = { company_id: companyId, first_name: firstName || null, last_name: lastName || null, email: email || null, phone: phone || null, segment: seg, source: "manual" };
      const result = await apiPost("atm_contacts", body);
      onAdd(result[0] || { ...body, id: "temp-" + Date.now() });
      setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setSeg("unknown"); setOpen(false);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  if (!open) return <button onClick={() => setOpen(true)} style={{ background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>+ Add Contact</button>;

  return (
    <div style={{ background: "#1a1f2e", borderRadius: 6, padding: 10, marginTop: 6, border: "1px solid #3b82f640" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
        <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" style={inp} />
        <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" style={inp} />
      </div>
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={{ ...inp, marginBottom: 6 }} />
      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" style={{ ...inp, marginBottom: 6 }} />
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["seller","buyer","both","unknown"].map(s => <button key={s} onClick={() => setSeg(s)} style={{ background: seg === s ? (s === "seller" ? "#4a2020" : s === "buyer" ? "#1a3a2a" : s === "both" ? "#4a3520" : "#1a1f2e") : "#111827", color: seg === s ? (s === "seller" ? "#ef4444" : s === "buyer" ? "#10b981" : s === "both" ? "#f59e0b" : "#64748b") : "#475569", border: "1px solid #334155", padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", textTransform: "uppercase" }}>{s}</button>)}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={save} disabled={saving} style={{ background: "#10b981", color: "#fff", border: "none", padding: "5px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{saving ? "..." : "Save"}</button>
        <button onClick={() => setOpen(false)} style={{ background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

function CompanyDetail({ co, onClose, onUpdate, onCreateDeal }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(co.status || "new");
  const [segment, setSegment] = useState(co.segment || "unknown");
  const [priority, setPriority] = useState(co.priority || "");
  const [notes, setNotes] = useState(co.notes || "");
  const [followup, setFollowup] = useState(co.next_followup_at ? co.next_followup_at.split("T")[0] : "");
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [loadingC, setLoadingC] = useState(false);
  const [activities, setActivities] = useState([]);
  const [loadingA, setLoadingA] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logType, setLogType] = useState("call_made");
  const [logNote, setLogNote] = useState("");
  const [loggingActivity, setLoggingActivity] = useState(false);
  const [compName, setCompName] = useState(co.company_name || "");
  const [dba, setDba] = useState(co.dba_name || "");
  const [city, setCity] = useState(co.city || "");
  const [state, setState] = useState(co.state || "");
  const [zip, setZip] = useState(co.zip || "");
  const [phone, setPhone] = useState(co.phone || "");
  const [email, setEmail] = useState(co.email || "");
  const [website, setWebsite] = useState(co.website || "");
  const [category, setCategory] = useState(co.category || "");
  const [atmCount, setAtmCount] = useState(co.estimated_atm_count || "");

  const loadActivities = () => {
    setLoadingA(true);
    api("atm_activity_log?company_id=eq." + co.id + "&order=created_at.desc&limit=30")
      .then(d => setActivities(d)).catch(e => console.error(e)).finally(() => setLoadingA(false));
  };

  useEffect(() => {
    setStatus(co.status || "new"); setSegment(co.segment || "unknown");
    setPriority(co.priority || ""); setNotes(co.notes || "");
    setFollowup(co.next_followup_at ? co.next_followup_at.split("T")[0] : ""); setEditing(false);
    setShowLogForm(false); setLogNote("");
    setCompName(co.company_name || ""); setDba(co.dba_name || "");
    setCity(co.city || ""); setState(co.state || ""); setZip(co.zip || "");
    setPhone(co.phone || ""); setEmail(co.email || "");
    setWebsite(co.website || ""); setCategory(co.category || "");
    setAtmCount(co.estimated_atm_count || "");
    setLoadingC(true);
    api("atm_contacts?company_id=eq." + co.id + "&order=segment.asc,email.asc&limit=50")
      .then(d => setContacts(d)).catch(e => console.error(e)).finally(() => setLoadingC(false));
    loadActivities();
  }, [co.id]);

  const logActivity = async (type, subject, body) => {
    try {
      await apiPost("atm_activity_log", { company_id: co.id, type, channel: "manual", direction: type.includes("received") ? "inbound" : "outbound", subject: subject || null, body: body || null });
      loadActivities();
    } catch (e) { console.error(e); }
  };

  const submitLog = async () => {
    setLoggingActivity(true);
    const labels = { call_made: "Phone call", call_received: "Incoming call", email_sent: "Email sent", email_received: "Email received", note_added: "Note", meeting: "Meeting" };
    await logActivity(logType, labels[logType], logNote);
    setLogNote(""); setShowLogForm(false); setLoggingActivity(false);
  };

  const setFollowupDays = (d) => { const x = new Date(); x.setDate(x.getDate() + d); setFollowup(x.toISOString().split("T")[0]); };

  const save = async () => {
    setSaving(true);
    try {
      const body = { status, segment, priority, notes, next_followup_at: followup || null, last_contacted_at: new Date().toISOString(),
        company_name: compName || null, dba_name: dba || null, city: city || null, state: state || null, zip: zip || null,
        phone: phone || null, email: email || null, website: website || null, category: category || null,
        estimated_atm_count: atmCount ? Number(atmCount) : null };
      await apiPatch("atm_companies?id=eq." + co.id, body);
      if (status !== (co.status || "new")) {
        await logActivity("status_changed", "Status: " + (co.status || "new") + " \u2192 " + status, null);
      }
      onUpdate({ ...co, ...body });
    } catch (e) { console.error(e); }
    setSaving(false); setEditing(false);
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
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {co.email && <a href={"mailto:" + co.email} style={{ background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>&#9993; Email</a>}
        {co.phone && <a href={"tel:" + co.phone} style={{ background: "#1a3a2a", color: "#10b981", border: "1px solid #10b98140", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>&#9742; Call</a>}
        {co.website && <a href={co.website} target="_blank" rel="noreferrer" style={{ background: "#4a3520", color: "#f59e0b", border: "1px solid #f59e0b40", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>&#9679; Web</a>}
        <button onClick={() => onCreateDeal(co)} style={{ background: "#10b98120", color: "#10b981", border: "1px solid #10b98140", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Create Deal</button>
        <button onClick={() => setEditing(!editing)} style={{ background: editing ? "#4a352040" : "#1e3a5f", color: editing ? "#f59e0b" : "#3b82f6", border: "1px solid " + (editing ? "#f59e0b40" : "#3b82f640"), padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{editing ? "Cancel Edit" : "Edit Lead"}</button>
      </div>

      {/* Follow-up */}
      <div style={{ background: followup && followUpStatus(followup) === "overdue" ? "#4a202040" : "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <label style={ls}>Follow-up</label>
        {editing ? (
          <div>
            <input type="date" value={followup} onChange={e => setFollowup(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, marginBottom: 6, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[["Tomorrow",1],["3 Days",3],["1 Wk",7],["2 Wks",14],["1 Mo",30]].map(([l,d]) =>
                <button key={l} onClick={() => setFollowupDays(d)} style={{ background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>{l}</button>
              )}
              <button onClick={() => setFollowup("")} style={{ background: "#4a2020", color: "#ef4444", border: "1px solid #ef444440", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Clear</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {followup ? <><FollowUpBadge dateStr={followup} /><span style={{ fontSize: 13, color: "#94a3b8" }}>{followup}</span></> : <span style={{ fontSize: 13, color: "#475569" }}>No follow-up set</span>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}><label style={ls}>Status</label>{editing ? <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 12 }}>{STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select> : <Badge status={status} />}</div>
        <div style={{ flex: 1 }}><label style={ls}>Segment</label>{editing ? <select value={segment} onChange={e => setSegment(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 12 }}><option value="seller">Seller</option><option value="buyer">Buyer</option><option value="both">Both</option><option value="unknown">Unknown</option></select> : <SegBadge segment={segment} />}</div>
        <div style={{ flex: 1 }}><label style={ls}>Priority</label>{editing ? <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 12 }}><option value="">None</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select> : <span style={vs}>{priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : "\u2014"}</span>}</div>
      </div>

      <div style={{ background: "#111827", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        {editing ? (<>
          <div style={{ ...fs, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label style={ls}>Company Name</label><input value={compName} onChange={e => setCompName(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
            <div><label style={ls}>DBA</label><input value={dba} onChange={e => setDba(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
          </div>
          <div style={{ ...fs, display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <div><label style={ls}>City</label><input value={city} onChange={e => setCity(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
            <div><label style={ls}>State</label><input value={state} onChange={e => setState(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
            <div><label style={ls}>Zip</label><input value={zip} onChange={e => setZip(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
          </div>
          <div style={fs}><label style={ls}>Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
          <div style={fs}><label style={ls}>Email</label><input value={email} onChange={e => setEmail(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
          <div style={fs}><label style={ls}>Website</label><input value={website} onChange={e => setWebsite(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
          <div style={{ ...fs, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label style={ls}>Category</label><select value={category} onChange={e => setCategory(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 12 }}><option value="">None</option><option value="confirmed_atm">Confirmed ATM</option><option value="operator">Operator</option><option value="likely_related">Likely Related</option><option value="services">Services</option><option value="maybe_related">Maybe Related</option><option value="manufacturer">Manufacturer</option><option value="processor">Processor</option></select></div>
            <div><label style={ls}>Est. ATM Count</label><input type="number" value={atmCount} onChange={e => setAtmCount(e.target.value)} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 6, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} /></div>
          </div>
        </>) : (<>
          <div style={fs}><label style={ls}>Location</label><span style={vs}>{[co.city, co.state, co.zip].filter(Boolean).join(", ") || "\u2014"}</span></div>
          <div style={fs}><label style={ls}>Phone</label><span style={vs}>{co.phone || "\u2014"}</span></div>
          <div style={fs}><label style={ls}>Email</label><span style={{ ...vs, wordBreak: "break-all" }}>{co.email || "\u2014"}</span></div>
          <div style={fs}><label style={ls}>Website</label><span style={{ ...vs, wordBreak: "break-all" }}>{co.website || "\u2014"}</span></div>
          <div style={fs}><label style={ls}>Category</label><span style={vs}>{co.category || "\u2014"}</span></div>
          <div style={fs}><label style={ls}>Est. ATM Count</label><span style={{ ...vs, color: co.estimated_atm_count ? "#10b981" : "#475569", fontWeight: co.estimated_atm_count ? 700 : 400, fontSize: co.estimated_atm_count ? 18 : 14 }}>{co.estimated_atm_count ? co.estimated_atm_count.toLocaleString() : "\u2014"}</span></div>
          {co.last_contacted_at && <div style={fs}><label style={ls}>Last Contacted</label><span style={vs}>{new Date(co.last_contacted_at).toLocaleDateString()}</span></div>}
        </>)}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ ...ls, marginBottom: 8 }}>Contacts ({contacts.length})</label>
        {loadingC ? <div style={{ color: "#475569", fontSize: 12 }}>Loading...</div> :
          contacts.length === 0 ? <div style={{ color: "#475569", fontSize: 12 }}>No linked contacts</div> :
          contacts.map((c, i) => <ContactCard key={c.id || i} contact={c} onSave={(updated) => setContacts(p => p.map(x => x.id === updated.id ? updated : x))} onDelete={(id) => setContacts(p => p.filter(x => x.id !== id))} />)}
        <AddContactForm companyId={co.id} onAdd={(c) => setContacts(p => [...p, c])} />
      </div>

      {/* Activity Log */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={ls}>Activity ({activities.length})</label>
          <button onClick={() => setShowLogForm(!showLogForm)} style={{ background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640", padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Log Activity</button>
        </div>

        {showLogForm && (
          <div style={{ background: "#1a1f2e", border: "1px solid #334155", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
              {[["call_made","&#9742; Called"],["call_received","&#9742; Received Call"],["email_sent","&#9993; Emailed"],["email_received","&#9993; Email Received"],["meeting","&#9679; Meeting"],["note_added","&#9998; Note"]].map(([v,l]) =>
                <button key={v} onClick={() => setLogType(v)} dangerouslySetInnerHTML={{__html: l}} style={{ background: logType === v ? "#3b82f620" : "#111827", color: logType === v ? "#3b82f6" : "#94a3b8", border: "1px solid " + (logType === v ? "#3b82f640" : "#334155"), padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 600 }} />
              )}
            </div>
            <textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder="What happened?" rows={2} style={{ width: "100%", background: "#111827", color: "#e2e8f0", border: "1px solid #334155", padding: 8, borderRadius: 4, fontSize: 12, resize: "vertical", boxSizing: "border-box", marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={submitLog} disabled={loggingActivity} style={{ background: "#10b981", color: "#fff", border: "none", padding: "6px 16px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{loggingActivity ? "Saving..." : "Save"}</button>
              <button onClick={() => { setShowLogForm(false); setLogNote(""); }} style={{ background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", padding: "6px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}

        {loadingA ? <div style={{ color: "#475569", fontSize: 12 }}>Loading...</div> :
          activities.length === 0 ? <div style={{ color: "#475569", fontSize: 12 }}>No activity logged yet</div> :
          <div style={{ maxHeight: 250, overflowY: "auto" }}>
            {activities.map((a, i) => {
              const icons = { call_made: "&#9742;", call_received: "&#9742;", email_sent: "&#9993;", email_received: "&#9993;", note_added: "&#9998;", meeting: "&#9679;", status_changed: "&#8635;", deal_created: "&#10003;" };
              const colors = { call_made: "#10b981", call_received: "#10b981", email_sent: "#3b82f6", email_received: "#3b82f6", note_added: "#94a3b8", meeting: "#f59e0b", status_changed: "#8b5cf6", deal_created: "#22c55e" };
              const timeAgo = (d) => { const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return Math.floor(s/60) + "m ago"; if (s < 86400) return Math.floor(s/3600) + "h ago"; return Math.floor(s/86400) + "d ago"; };
              return (
                <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < activities.length - 1 ? "1px solid #1a1f2e" : "none" }}>
                  <span dangerouslySetInnerHTML={{__html: icons[a.type] || "&#9679;"}} style={{ color: colors[a.type] || "#64748b", fontSize: 14, minWidth: 18, textAlign: "center" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#e2e8f0" }}>{a.subject || a.type.replace(/_/g, " ")}</div>
                    {a.body && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{a.body}</div>}
                  </div>
                  <span style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>{timeAgo(a.created_at)}</span>
                </div>
              );
            })}
          </div>
        }
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={ls}>Notes</label>
        {editing ? <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} style={{ width: "100%", background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: 8, borderRadius: 6, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} /> : <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, maxHeight: 150, overflowY: "auto" }}>{notes || "\u2014"}</div>}
      </div>

      {editing && (
        <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 0, background: "#0f1219", padding: "12px 0" }}>
          <button onClick={save} disabled={saving} style={{ flex: 1, background: "#10b981", color: "#fff", border: "none", padding: 10, borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{saving ? "Saving..." : "Save Changes"}</button>
        </div>
      )}
    </div>
  );
}

// ======================== MAIN CRM ========================

export default function CRM() {
  const [view, setView] = useState("crm"); // crm or pipeline
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
    api("crm_stats?select=*").then(d => { if (d && d[0]) { const s = d[0]; setStats({ total: s.total_active, withEmail: s.with_email, withPhone: s.with_phone, withAtmCount: s.with_atm_count, confirmed: s.confirmed_atm, operators: s.operators }); } }).catch(e => console.error(e));
    const t = today();
    Promise.all([
      api("atm_companies?select=id&next_followup_at=lt." + t + "&next_followup_at=not.is.null&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)"),
      api("atm_companies?select=id&next_followup_at=eq." + t + "&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)"),
      api("atm_companies?select=id&next_followup_at=gt." + t + "&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)"),
    ]).then(([o, d, u]) => setFollowStats({ overdue: o.length, due: d.length, upcoming: u.length })).catch(e => console.error(e));
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
      const cr = await fetch(SB + "/rest/v1/" + cq, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
      const rng = cr.headers.get("content-range");
      if (rng) setTotal(parseInt(rng.split("/")[1]) || 0);
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  }, [page, catFilter, segFilter, statusFilter, followFilter, hasEmail, hasPhone, search, sortBy]);

  useEffect(() => { if (view === "crm") load(); }, [load, view]);
  useEffect(() => { setPage(0); }, [catFilter, segFilter, statusFilter, followFilter, hasEmail, hasPhone, search, sortBy]);

  const upd = (u) => { setCompanies(p => p.map(c => c.id === u.id ? u : c)); setSelected(u); };
  const ss = { background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: "7px 10px", borderRadius: 4, fontSize: 12 };

  const createDeal = async (co) => {
    try {
      const deal = await apiPost("atm_deals", {
        seller_company_id: co.id,
        deal_name: co.company_name + " - ATM Route",
        atm_count: co.estimated_atm_count,
        route_state: co.state,
        route_cities: co.city,
        stage: "prospect",
      });
      // Update company status
      await apiPatch("atm_companies?id=eq." + co.id, { status: "in_pipeline" });
      upd({ ...co, status: "in_pipeline" });
      setView("pipeline");
      setSelected(null);
    } catch (e) { console.error(e); alert("Error creating deal: " + e.message); }
  };

  const box = (label, value, color, onClick) => (
    <div onClick={onClick} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 100, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#e2e8f0" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );

  const tabStyle = (active) => ({ background: active ? "#1e3a5f" : "transparent", color: active ? "#3b82f6" : "#64748b", border: active ? "1px solid #3b82f640" : "1px solid transparent", padding: "8px 20px", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: "0.5px" });

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", background: "#0a0e17", color: "#e2e8f0", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#0f1219", borderBottom: "1px solid #1e293b", padding: "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>ATM Brokerage <span style={{ color: "#3b82f6", fontWeight: 400 }}>CRM</span></h1>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => { setView("crm"); setSelected(null); }} style={tabStyle(view === "crm")}>Companies</button>
              <button onClick={() => { setView("pipeline"); setSelected(null); }} style={tabStyle(view === "pipeline")}>Pipeline</button>
            </div>
          </div>
          {view === "crm" && <input type="text" placeholder="Search companies, cities, states..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 320, background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155", padding: "10px 14px", borderRadius: 6, fontSize: 13, outline: "none" }} />}
        </div>

        {view === "crm" && (<>
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 12 }}>{total.toLocaleString()} companies &#183; Page {page + 1} of {Math.ceil(total / PS) || 1}</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            {box("Total Active", stats.total || 0, "#e2e8f0")}
            {box("With Email", stats.withEmail || 0, "#3b82f6")}
            {box("With Phone", stats.withPhone || 0, "#10b981")}
            {box("Confirmed ATM", stats.confirmed || 0, "#ef4444")}
            {box("Operators", stats.operators || 0, "#8b5cf6")}
          </div>
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
            <select value={followFilter} onChange={e => setFollowFilter(e.target.value)} style={ss}><option value="all">All Follow-ups</option><option value="due_or_overdue">Due / Overdue</option><option value="overdue">Overdue Only</option><option value="due">Due Today</option><option value="has_followup">Has Follow-up</option></select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={ss}><option value="atm_count">Sort: ATM Count &#8595;</option><option value="followup">Sort: Follow-up</option><option value="name">Sort: Name A-Z</option><option value="city">Sort: City A-Z</option><option value="recent">Sort: Recent</option></select>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={hasEmail} onChange={e => setHasEmail(e.target.checked)} /> Email</label>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} /> Phone</label>
            <button onClick={load} style={{ ...ss, cursor: "pointer", background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640" }}>&#8635; Refresh</button>
          </div>
        </>)}
      </div>

      {/* Content */}
      {view === "pipeline" ? <Pipeline /> : (
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
      )}

      {/* Detail panels */}
      {selected && view === "crm" && <CompanyDetail co={selected} onClose={() => setSelected(null)} onUpdate={upd} onCreateDeal={createDeal} />}
    </div>
  );
}
