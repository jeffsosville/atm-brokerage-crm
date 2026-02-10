"use client";
import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const LEAD_STATUSES = [
  { value: "new", label: "New", color: "#3b82f6", bg: "#1e3a5f" },
  { value: "emailed", label: "Emailed", color: "#f59e0b", bg: "#4a3520" },
  { value: "responded", label: "Responded", color: "#10b981", bg: "#1a3a2a" },
  { value: "called", label: "Called", color: "#8b5cf6", bg: "#2d2550" },
  { value: "in_pipeline", label: "In Pipeline", color: "#ef4444", bg: "#4a2020" },
  { value: "not_interested", label: "Not Interested", color: "#6b7280", bg: "#2a2a2a" },
  { value: "dead", label: "Dead", color: "#374151", bg: "#1a1a1a" },
];

const CATEGORIES = [
  "all", "confirmed_atm", "likely_related", "operator",
  "services", "maybe_related", "manufacturer", "processor",
];

async function supaFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

function StatusBadge({ status }) {
  const s = LEAD_STATUSES.find((l) => l.value === status) || LEAD_STATUSES[0];
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}40`,
      padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
      letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap",
    }}>
      {s.label}
    </span>
  );
}

function CompanyRow({ company, onClick, isSelected }) {
  const atmCount = company.estimated_atm_count;
  return (
    <tr
      onClick={() => onClick(company)}
      style={{
        cursor: "pointer",
        background: isSelected ? "#1a2a3a" : "transparent",
        borderBottom: "1px solid #1a1f2e",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#111827"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <td style={{ padding: "10px 12px", maxWidth: 200 }}>
        <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 13 }}>{company.company_name}</div>
        {company.dba_name && <div style={{ fontSize: 11, color: "#64748b" }}>DBA: {company.dba_name}</div>}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>
        {company.city && company.state ? `${company.city}, ${company.state}` : company.state || "—"}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12 }}>
        <StatusBadge status={company.status || "new"} />
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>{company.category || "—"}</td>
      <td style={{
        padding: "10px 12px", fontSize: 13, textAlign: "center",
        fontWeight: atmCount ? 700 : 400, color: atmCount ? "#10b981" : "#475569",
      }}>
        {atmCount || "—"}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {company.email && <span style={{ color: "#3b82f6", fontSize: 11 }}>✉</span>}
          {company.phone && <span style={{ color: "#10b981", fontSize: 11 }}>☎</span>}
          {company.website && <span style={{ color: "#f59e0b", fontSize: 11 }}>🌐</span>}
        </div>
      </td>
    </tr>
  );
}

function DetailPanel({ company, onClose, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(company.status || "new");
  const [priority, setPriority] = useState(company.priority || "");
  const [notes, setNotes] = useState(company.notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(company.status || "new");
    setPriority(company.priority || "");
    setNotes(company.notes || "");
    setEditing(false);
  }, [company.id]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/atm_companies?id=eq.${company.id}`, {
        method: "PATCH", headers: HEADERS,
        body: JSON.stringify({ status, priority, notes }),
      });
      onUpdate({ ...company, status, priority, notes });
    } catch (e) { console.error(e); }
    setSaving(false);
    setEditing(false);
  };

  const labelStyle = {
    fontSize: 10, fontWeight: 700, color: "#64748b",
    textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4, display: "block",
  };
  const valueStyle = { fontSize: 14, color: "#e2e8f0", lineHeight: 1.5 };
  const fieldStyle = { marginBottom: 16 };

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, width: 440, height: "100vh",
      background: "#0f1219", borderLeft: "1px solid #1e293b", overflowY: "auto",
      padding: 24, zIndex: 100, boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#f1f5f9", fontFamily: "'JetBrains Mono', monospace" }}>
            {company.company_name}
          </h2>
          {company.dba_name && <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>DBA: {company.dba_name}</div>}
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "1px solid #334155", color: "#94a3b8",
          cursor: "pointer", padding: "4px 10px", borderRadius: 4, fontSize: 14,
        }}>✕</button>
      </div>

      {/* Contact Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {company.email && (
          <a href={`mailto:${company.email}`} style={{
            background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640",
            padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
          }}>✉ Email</a>
        )}
        {company.phone && (
          <a href={`tel:${company.phone}`} style={{
            background: "#1a3a2a", color: "#10b981", border: "1px solid #10b98140",
            padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
          }}>☎ Call</a>
        )}
        {company.website && (
          <a href={company.website} target="_blank" rel="noreferrer" style={{
            background: "#4a3520", color: "#f59e0b", border: "1px solid #f59e0b40",
            padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
          }}>🌐 Website</a>
        )}
      </div>

      {/* Status + Priority */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Lead Status</label>
          {editing ? (
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{
              width: "100%", background: "#1a1f2e", color: "#e2e8f0",
              border: "1px solid #334155", padding: 8, borderRadius: 4, fontSize: 13,
            }}>
              {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          ) : <StatusBadge status={status} />}
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Priority</label>
          {editing ? (
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{
              width: "100%", background: "#1a1f2e", color: "#e2e8f0",
              border: "1px solid #334155", padding: 8, borderRadius: 4, fontSize: 13,
            }}>
              <option value="">None</option>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          ) : (
            <span style={valueStyle}>
              {priority === "high" ? "🔴 High" : priority === "medium" ? "🟡 Medium" : priority === "low" ? "🟢 Low" : "—"}
            </span>
          )}
        </div>
      </div>

      {/* Company Info */}
      <div style={{ background: "#111827", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Location</label>
          <span style={valueStyle}>{[company.city, company.state, company.zip].filter(Boolean).join(", ") || "—"}</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Phone</label>
          <span style={valueStyle}>{company.phone || "—"}</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Email</label>
          <span style={{ ...valueStyle, wordBreak: "break-all" }}>{company.email || "—"}</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Website</label>
          <span style={{ ...valueStyle, wordBreak: "break-all" }}>{company.website || "—"}</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Category</label>
          <span style={valueStyle}>{company.category || "—"}</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Estimated ATM Count</label>
          <span style={{
            ...valueStyle,
            color: company.estimated_atm_count ? "#10b981" : "#475569",
            fontWeight: company.estimated_atm_count ? 700 : 400,
            fontSize: company.estimated_atm_count ? 18 : 14,
          }}>{company.estimated_atm_count || "—"}</span>
        </div>
        {company.year_founded && <div style={fieldStyle}><label style={labelStyle}>Year Founded</label><span style={valueStyle}>{company.year_founded}</span></div>}
        {company.employee_count && <div style={fieldStyle}><label style={labelStyle}>Employees</label><span style={valueStyle}>{company.employee_count}</span></div>}
        {company.annual_revenue_estimate && <div style={fieldStyle}><label style={labelStyle}>Est. Revenue</label><span style={valueStyle}>{company.annual_revenue_estimate}</span></div>}
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Notes / Business Description</label>
        {editing ? (
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} style={{
            width: "100%", background: "#1a1f2e", color: "#e2e8f0",
            border: "1px solid #334155", padding: 10, borderRadius: 6,
            fontSize: 13, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box",
          }} />
        ) : (
          <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, maxHeight: 200, overflowY: "auto" }}>
            {notes || "—"}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        {editing ? (
          <>
            <button onClick={save} disabled={saving} style={{
              flex: 1, background: "#10b981", color: "#fff", border: "none",
              padding: 10, borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}>{saving ? "Saving..." : "Save Changes"}</button>
            <button onClick={() => setEditing(false)} style={{
              background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155",
              padding: "10px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer",
            }}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setEditing(true)} style={{
            flex: 1, background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640",
            padding: 10, borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>Edit Lead</button>
        )}
      </div>
    </div>
  );
}

export default function CRM() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hasEmailOnly, setHasEmailOnly] = useState(false);
  const [hasPhoneOnly, setHasPhoneOnly] = useState(false);
  const [sortBy, setSortBy] = useState("atm_count");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({});
  const PAGE_SIZE = 50;

  // Load stats
  useEffect(() => {
    async function loadStats() {
      try {
        const all = await supaFetch("atm_companies?select=category,email,phone,estimated_atm_count");
        const active = all.filter(c => !["dead_url","bank","not_atm","dead_url_maybe_atm"].includes(c.category));
        setStats({
          total: active.length,
          withEmail: active.filter(c => c.email).length,
          withPhone: active.filter(c => c.phone).length,
          withAtmCount: active.filter(c => c.estimated_atm_count).length,
          confirmed: active.filter(c => c.category === "confirmed_atm").length,
          operators: active.filter(c => c.category === "operator").length,
        });
      } catch(e) { console.error(e); }
    }
    loadStats();
  }, []);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      let query = `atm_companies?select=*&order=${
        sortBy === "atm_count" ? "estimated_atm_count.desc.nullslast"
        : sortBy === "name" ? "company_name.asc"
        : sortBy === "city" ? "city.asc.nullslast"
        : "updated_at.desc"
      }&offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`;

      query += `&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)`;
      if (categoryFilter !== "all") query += `&category=eq.${categoryFilter}`;
      if (statusFilter !== "all") query += `&status=eq.${statusFilter}`;
      if (hasEmailOnly) query += `&email=not.is.null`;
      if (hasPhoneOnly) query += `&phone=not.is.null`;
      if (search) query += `&or=(company_name.ilike.*${search}*,city.ilike.*${search}*,state.ilike.*${search}*,notes.ilike.*${search}*)`;

      const data = await supaFetch(query);
      setCompanies(data);

      let countQuery = `atm_companies?select=count&category=not.in.(dead_url,bank,not_atm,dead_url_maybe_atm)`;
      if (categoryFilter !== "all") countQuery += `&category=eq.${categoryFilter}`;
      if (statusFilter !== "all") countQuery += `&status=eq.${statusFilter}`;
      if (hasEmailOnly) countQuery += `&email=not.is.null`;
      if (hasPhoneOnly) countQuery += `&phone=not.is.null`;
      if (search) countQuery += `&or=(company_name.ilike.*${search}*,city.ilike.*${search}*,state.ilike.*${search}*,notes.ilike.*${search}*)`;

      const countRes = await fetch(`${SUPABASE_URL}/rest/v1/${countQuery}`, {
        headers: { ...HEADERS, Prefer: "count=exact", Range: "0-0" },
      });
      const range = countRes.headers.get("content-range");
      if (range) setTotal(parseInt(range.split("/")[1]) || 0);
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  }, [page, categoryFilter, statusFilter, hasEmailOnly, hasPhoneOnly, search, sortBy]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { setPage(0); }, [categoryFilter, statusFilter, hasEmailOnly, hasPhoneOnly, search, sortBy]);

  const handleUpdate = (updated) => {
    setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSelected(updated);
  };

  const selectStyle = {
    background: "#1a1f2e", color: "#e2e8f0", border: "1px solid #334155",
    padding: "7px 10px", borderRadius: 4, fontSize: 12,
  };

  const statBox = (label, value, color) => (
    <div style={{
      background: "#111827", border: "1px solid #1e293b", borderRadius: 8,
      padding: "12px 16px", flex: 1, minWidth: 120,
    }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#e2e8f0" }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
      background: "#0a0e17", color: "#e2e8f0", minHeight: "100vh",
    }}>
      {/* Header */}
      <div style={{ background: "#0f1219", borderBottom: "1px solid #1e293b", padding: "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>
              ATM Brokerage <span style={{ color: "#3b82f6", fontWeight: 400 }}>CRM</span>
            </h1>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
              {total} companies · Page {page + 1} of {Math.ceil(total / PAGE_SIZE) || 1}
            </div>
          </div>
          <input
            type="text" placeholder="Search companies, cities, states..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{
              width: 320, background: "#1a1f2e", color: "#e2e8f0",
              border: "1px solid #334155", padding: "10px 14px", borderRadius: 6, fontSize: 13, outline: "none",
            }}
          />
        </div>

        {/* Stats Row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {statBox("Total Active", stats.total || "—", "#e2e8f0")}
          {statBox("With Email", stats.withEmail || "—", "#3b82f6")}
          {statBox("With Phone", stats.withPhone || "—", "#10b981")}
          {statBox("ATM Count Known", stats.withAtmCount || "—", "#f59e0b")}
          {statBox("Confirmed ATM", stats.confirmed || "—", "#ef4444")}
          {statBox("Operators", stats.operators || "—", "#8b5cf6")}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={selectStyle}>
            <option value="all">All Categories</option>
            {CATEGORIES.filter((c) => c !== "all").map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="all">All Statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={selectStyle}>
            <option value="atm_count">Sort: ATM Count ↓</option>
            <option value="name">Sort: Name A-Z</option>
            <option value="city">Sort: City A-Z</option>
            <option value="recent">Sort: Recently Updated</option>
          </select>
          <label style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={hasEmailOnly} onChange={(e) => setHasEmailOnly(e.target.checked)} /> Has Email
          </label>
          <label style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={hasPhoneOnly} onChange={(e) => setHasPhoneOnly(e.target.checked)} /> Has Phone
          </label>
          <button onClick={loadCompanies} style={{
            ...selectStyle, cursor: "pointer", background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640",
          }}>↻ Refresh</button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", marginRight: selected ? 440 : 0, transition: "margin 0.2s" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#475569", fontSize: 14 }}>Loading...</div>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #1e293b", background: "#0f1219" }}>
                  {["Company", "Location", "Status", "Category", "ATMs", "Contact"].map((h, i) => (
                    <th key={h} style={{
                      padding: "10px 12px", textAlign: i === 4 ? "center" : "left",
                      color: "#475569", fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "1px",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <CompanyRow key={c.id} company={c} onClick={setSelected} isSelected={selected?.id === c.id} />
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: 16 }}>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                style={{ ...selectStyle, cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
                ← Prev
              </button>
              <span style={{ fontSize: 12, color: "#475569", padding: "7px 14px" }}>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <button onClick={() => setPage(page + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
                style={{ ...selectStyle, cursor: (page + 1) * PAGE_SIZE >= total ? "not-allowed" : "pointer", opacity: (page + 1) * PAGE_SIZE >= total ? 0.4 : 1 }}>
                Next →
              </button>
            </div>
          </>
        )}
      </div>

      {/* Detail Panel */}
      {selected && <DetailPanel company={selected} onClose={() => setSelected(null)} onUpdate={handleUpdate} />}
    </div>
  );
}
