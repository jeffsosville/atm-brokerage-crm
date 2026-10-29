"use client";
// Drafting rules: industry-wide facts every draft must follow (e.g. "SBA doesn't work for ATM routes").
// Suggestions come from John's edits; nothing reaches the drafter until someone approves it here.
import { useEffect, useState } from "react";
import { authFetch } from "../lib/authFetch";
import { VerticalBadge } from "../lib/vertical";

const btn = (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 4, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const ta = { width: "100%", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: 8, fontSize: 13, fontFamily: "inherit", lineHeight: 1.45, resize: "vertical", boxSizing: "border-box" };

function Suggestion({ r, onDone }) {
  const [text, setText] = useState(r.rule);
  const [busy, setBusy] = useState(false);
  async function act(action) {
    setBusy(true);
    try { await authFetch("/api/admin/rules", { method: "PATCH", body: JSON.stringify({ id: r.id, action, rule: text }) }); onDone(); }
    catch (e) { alert(e.message); setBusy(false); }
  }
  return (
    <div style={{ background: "#111827", border: "1px solid #78350f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 11, color: "#94a3b8" }}>
        <VerticalBadge slug={r.vertical} />
        {r.why && <span>Learned from John's edit: {r.why}</span>}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={ta} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={busy} onClick={() => act("approve")} style={btn("#16a34a")}>Approve: use in every draft</button>
        <button disabled={busy} onClick={() => act("reject")} style={btn("#1e293b", "#94a3b8")}>Not a rule</button>
      </div>
    </div>
  );
}

export default function RulesPanel({ vertical = "all" }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState("");
  const [addV, setAddV] = useState(vertical === "all" ? "atm" : vertical);

  useEffect(() => { authFetch(`/api/admin/rules?vertical=${vertical}`).then(setD).catch(() => setD(null)); }, [vertical, tick]);
  useEffect(() => { if (vertical !== "all") setAddV(vertical); }, [vertical]);
  if (!d) return null;
  const refresh = () => setTick((t) => t + 1);

  async function off(id) {
    if (!window.confirm("Stop using this rule in drafts?")) return;
    try { await authFetch("/api/admin/rules", { method: "PATCH", body: JSON.stringify({ id, action: "off" }) }); refresh(); } catch (e) { alert(e.message); }
  }
  async function add() {
    try { await authFetch("/api/admin/rules", { method: "POST", body: JSON.stringify({ vertical: addV, rule: adding }) }); setAdding(""); refresh(); } catch (e) { alert(e.message); }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {d.pending.length > 0 && (<>
        <div style={{ fontSize: 10, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, marginBottom: 8 }}>
          {d.pending.length} suggested drafting rule{d.pending.length > 1 ? "s" : ""} from John's edits
        </div>
        {d.pending.map((r) => <Suggestion key={r.id} r={r} onDone={refresh} />)}
      </>)}
      <button onClick={() => setOpen(!open)} style={{ ...btn("transparent", "#64748b"), padding: 0, fontWeight: 600 }}>
        {open ? "▾" : "▸"} Drafting rules ({d.active.length})
      </button>
      {open && (
        <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 12, marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Every draft for that brand follows these, and they beat John's past answers.</div>
          {d.active.length === 0 && <div style={{ color: "#475569", fontSize: 13 }}>No rules yet.</div>}
          {d.active.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #1e293b" }}>
              <VerticalBadge slug={r.vertical} />
              <div style={{ flex: 1, fontSize: 13, color: "#cbd5e1", lineHeight: 1.45 }}>{r.rule}</div>
              <button onClick={() => off(r.id)} style={btn("#1e293b", "#94a3b8")}>Turn off</button>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <textarea value={adding} onChange={(e) => setAdding(e.target.value)} rows={2} placeholder="Add a rule, e.g. Seller financing is rare on ATM routes; don't promise it." style={ta} />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <select value={addV} onChange={(e) => setAddV(e.target.value)} style={{ ...ta, width: "auto", padding: "6px 8px" }}>
                <option value="atm">ATM</option><option value="vending">Vending</option><option value="cleaning">Cleaning</option>
              </select>
              <button disabled={adding.trim().length < 10} onClick={add} style={btn("#2563eb")}>Add rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
