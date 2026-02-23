"use client";
import { useState, useEffect, useRef } from "react";

const SB = "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const SK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indncm14aHhvem95dmNtdmJmdXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4MzI5MTUsImV4cCI6MjA3NDQwODkxNX0.zuOIlNRTC3kjBWHxp9_sef2V9pe9erDSljEcJ2EL9to";
const api = async (p, o = {}) => { const r = await fetch(SB + "/rest/v1/" + p, { headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json", ...o.headers }, ...o }); return r.json(); };
const APP = typeof window !== "undefined" ? window.location.origin : "";

export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [deals, setDeals] = useState([]);
  const [sel, setSel] = useState(null);
  const [files, setFiles] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("deals");
  const [nd, setNd] = useState({ deal_name: "", atm_count: "", asking_price: "", route_state: "", route_cities: "", stage: "prospect" });
  const [cimText, setCimText] = useState("");
  const fRef = useRef(null);

  useEffect(() => { if (typeof window !== "undefined" && localStorage.getItem("adm") === "1") setAuthed(true); }, []);
  const login = () => { if (pin === "2026") { setAuthed(true); localStorage.setItem("adm", "1"); } else setMsg("Wrong PIN"); };
  const loadDeals = async () => { setDeals(await api("atm_deals?select=*&order=created_at.desc") || []); };
  const loadFiles = async (id) => { setFiles(await api("listing_files?listing_id=eq." + id + "&is_active=eq.true&select=*&order=uploaded_at.desc") || []); };
  const loadTokens = async (id) => { setTokens(await api("deal_tokens?deal_id=eq." + id + "&select=*&order=created_at.desc") || []); };
  const pick = async (d) => { setSel(d); await loadFiles(d.id); await loadTokens(d.id); };
  useEffect(() => { if (authed) loadDeals(); }, [authed]);

  const createDeal = async () => {
    if (!nd.deal_name) { setMsg("Name required"); return; }
    setLoading("c");
    const resp = await fetch("/api/admin/deal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_name: nd.deal_name, atm_count: nd.atm_count ? parseInt(nd.atm_count) : null, asking_price: nd.asking_price ? parseFloat(nd.asking_price) : null, route_state: nd.route_state || null, route_cities: nd.route_cities || null, stage: nd.stage }) }); const r = await resp.json();
    setMsg("Created! DL#: " + (r[0]?.dl_number || "assigned"));
    setNd({ deal_name: "", atm_count: "", asking_price: "", route_state: "", route_cities: "", stage: "prospect" });
    loadDeals(); setLoading("");
  };

  const upload = async (e) => {
    const f = e.target.files[0]; if (!f || !sel) return;
    setLoading("u");
    const fd = new FormData(); fd.append("file", f); fd.append("dealId", sel.id);
    const r = await fetch("/api/broker/upload", { method: "POST", body: fd });
    const d = await r.json();
    setMsg(d.error ? "Error: " + d.error : "Uploaded: " + f.name);
    loadFiles(sel.id); setLoading(""); if (fRef.current) fRef.current.value = "";
  };

  const delFile = async (id) => { if (!confirm("Delete?")) return; await fetch("/api/broker/upload?fileId=" + id, { method: "DELETE" }); loadFiles(sel.id); };

  const ingest = async () => {
    if (!cimText.trim() || !sel) { setMsg("Paste CIM text first"); return; }
    setLoading("i");
    const r = await fetch("/api/admin/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dealId: sel.id, dlNumber: sel.dl_number, text: cimText, sourceType: "cim", sourceName: "CIM - " + sel.deal_name }) });
    const d = await r.json();
    setMsg(d.error ? "Error: " + d.error : "Ingested " + d.chunks + " chunks!"); setCimText(""); setLoading("");
  };

  const loadFaq = async () => {
    if (!sel) return; setLoading("f");
    const r = await fetch("/api/admin/ingest-faq", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dealId: sel.id, dlNumber: sel.dl_number }) });
    const d = await r.json();
    setMsg(d.error ? "Error: " + d.error : "Loaded " + d.chunks + " FAQ chunks!"); setLoading("");
  };

  const genToken = async () => {
    if (!sel) return; setLoading("t");
    const r = await fetch("/api/admin/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dealId: sel.id }) });
    const d = await r.json();
    if (d.token) { const u = APP + "/deals/" + d.token; navigator.clipboard.writeText(u).catch(() => {}); setMsg("Link copied! " + u); }
    else setMsg("Error: " + d.error);
    loadTokens(sel.id); setLoading("");
  };

  const checkStatus = async () => {
    if (!sel) return;
    const ch = await api("deal_embeddings?deal_id=eq." + sel.id + "&select=source_type");
    const t = {}; (ch || []).forEach(c => { t[c.source_type] = (t[c.source_type] || 0) + 1; });
    const s = Object.entries(t).map(([k, v]) => k + ": " + v).join(", ");
    setMsg("Concierge: " + (s || "EMPTY - needs ingestion!") + " | Total: " + (ch?.length || 0));
  };

  const I = { background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13, width: "100%" };
  const B = { background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" };

  if (!authed) return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 32, maxWidth: 320, textAlign: "center" }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 18, marginBottom: 16 }}>Admin Access</h2>
        <input type="password" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="PIN" style={{ ...I, textAlign: "center", fontSize: 20, marginBottom: 12 }} />
        <button onClick={login} style={B}>Enter</button>
        {msg && <p style={{ color: "#f87171", marginTop: 8, fontSize: 13 }}>{msg}</p>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", color: "#e2e8f0", fontFamily: "system-ui" }}>
      <div style={{ background: "#111827", borderBottom: "1px solid #1e293b", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><span style={{ fontWeight: 700, fontSize: 16 }}>ATM Brokerage Admin</span> <span style={{ color: "#64748b", fontSize: 12, marginLeft: 8 }}>Manage Deals · Upload Docs · Generate Links</span></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("deals")} style={{ ...B, background: tab === "deals" ? "#2563eb" : "#1e293b" }}>All Deals</button>
          <button onClick={() => setTab("new")} style={{ ...B, background: tab === "new" ? "#2563eb" : "#1e293b" }}>+ New Deal</button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        {msg && <div style={{ background: "#1e3a5f", border: "1px solid #2563eb", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#93c5fd", marginBottom: 16 }}>{msg} <span style={{ cursor: "pointer", float: "right" }} onClick={() => setMsg("")}>✕</span></div>}

        {tab === "new" && (
          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Create New Deal</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1/-1" }}><label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>Deal Name *</label><input value={nd.deal_name} onChange={e => setNd({ ...nd, deal_name: e.target.value })} placeholder="e.g. Buffalo ATM Portfolio - 237 ATMs" style={I} /></div>
              <div><label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>ATM Count</label><input type="number" value={nd.atm_count} onChange={e => setNd({ ...nd, atm_count: e.target.value })} placeholder="237" style={I} /></div>
              <div><label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>Asking Price ($)</label><input type="number" value={nd.asking_price} onChange={e => setNd({ ...nd, asking_price: e.target.value })} placeholder="2220000" style={I} /></div>
              <div><label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>State</label><input value={nd.route_state} onChange={e => setNd({ ...nd, route_state: e.target.value })} placeholder="NY" style={I} /></div>
              <div><label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>City</label><input value={nd.route_cities} onChange={e => setNd({ ...nd, route_cities: e.target.value })} placeholder="Buffalo" style={I} /></div>
              <div><label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>Stage</label><select value={nd.stage} onChange={e => setNd({ ...nd, stage: e.target.value })} style={I}><option value="prospect">Prospect</option><option value="listed">Listed</option><option value="under_contract">Under Contract</option><option value="closed">Closed</option></select></div>
            </div>
            <button onClick={createDeal} disabled={loading === "c"} style={{ ...B, marginTop: 16 }}>{loading === "c" ? "Creating..." : "Create Deal"}</button>
          </div>
        )}

        {tab === "deals" && (
          <div style={{ display: "grid", gridTemplateColumns: sel ? "300px 1fr" : "1fr", gap: 16 }}>
            <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Deals ({deals.length})</h3>
              <div style={{ maxHeight: 600, overflow: "auto" }}>
                {deals.map(d => (
                  <div key={d.id} onClick={() => pick(d)} style={{ padding: "10px 12px", borderBottom: "1px solid #1e293b", cursor: "pointer", background: sel?.id === d.id ? "#1e293b" : "transparent", borderRadius: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{d.deal_name || "Unnamed"}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{d.dl_number} · {d.route_cities || ""} {d.route_state || ""} · {d.asking_price ? "$" + Number(d.asking_price).toLocaleString() : ""} · {d.stage}</div>
                  </div>
                ))}
              </div>
            </div>

            {sel && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{sel.deal_name}</h3>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{sel.dl_number} · {sel.route_cities || ""} {sel.route_state || ""} · {sel.atm_count || "?"} ATMs · ${sel.asking_price ? Number(sel.asking_price).toLocaleString() : "TBD"} · {sel.stage}</div>
                  <button onClick={checkStatus} style={{ marginTop: 8, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Check Concierge Status</button>
                </div>

                <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Documents ({files.length})</h3>
                    <label style={{ ...B, cursor: "pointer" }}>{loading === "u" ? "Uploading..." : "Upload File"}<input ref={fRef} type="file" onChange={upload} style={{ display: "none" }} /></label>
                  </div>
                  {files.length === 0 ? <p style={{ color: "#64748b", fontSize: 13 }}>No files yet.</p> : files.map(f => (
                    <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1e293b" }}>
                      <div><div style={{ fontSize: 13, fontWeight: 600 }}>{f.file_name}</div><div style={{ fontSize: 11, color: "#64748b" }}>{(f.file_size / 1024).toFixed(1)} KB · {new Date(f.uploaded_at).toLocaleDateString()}</div></div>
                      <button onClick={() => delFile(f.id)} style={{ background: "#1e293b", color: "#f87171", border: "1px solid #7f1d1d", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Delete</button>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Ingest for AI Concierge</h3>
                  <p style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Paste CIM text. The AI concierge will use this to answer buyer questions.</p>
                  <textarea value={cimText} onChange={e => setCimText(e.target.value)} placeholder="Paste CIM text here..." style={{ ...I, minHeight: 140, resize: "vertical", fontFamily: "monospace" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={ingest} disabled={loading === "i"} style={{ ...B, background: "#059669" }}>{loading === "i" ? "Ingesting..." : "Ingest CIM"}</button>
                    <button onClick={loadFaq} disabled={loading === "f"} style={{ ...B, background: "#d97706" }}>{loading === "f" ? "Loading..." : "Load ATM FAQ"}</button>
                  </div>
                </div>

                <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Buyer Access Links</h3>
                    <button onClick={genToken} disabled={loading === "t"} style={B}>{loading === "t" ? "..." : "Generate New Link"}</button>
                  </div>
                  {tokens.map(t => (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1e293b" }}>
                      <div>
                        <div style={{ fontSize: 12, fontFamily: "monospace", color: "#93c5fd", cursor: "pointer" }} onClick={() => { navigator.clipboard.writeText(APP + "/deals/" + t.token); setMsg("Copied!"); }}>{APP}/deals/{t.token}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>Expires: {new Date(t.expires_at).toLocaleDateString()}</div>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(APP + "/deals/" + t.token); setMsg("Copied!"); }} style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Copy</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
