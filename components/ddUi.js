"use client";
// Shared look for the Due Diligence pages (matches the CRM's dark theme).

export const C = {
  bg: "#0a0e17", panel: "#0f1219", card: "#111827", line: "#1e293b", line2: "#334155",
  text: "#e2e8f0", dim: "#94a3b8", faint: "#64748b", blue: "#3b82f6", blueBg: "#1e3a5f",
};

export const STATE = {
  verified:         { label: "Verified",        fg: "#4ade80", bg: "#14532d55" },
  received:         { label: "To verify",       fg: "#60a5fa", bg: "#1e3a8a55" },
  partial:          { label: "Partial",         fg: "#facc15", bg: "#713f1255" },
  filled_unsourced: { label: "Unsourced",       fg: "#fb923c", bg: "#7c2d1255" },
  requested:        { label: "Requested",       fg: "#c084fc", bg: "#581c8755" },
  missing:          { label: "Missing",         fg: "#f87171", bg: "#7f1d1d55" },
  open:             { label: "Missing",         fg: "#f87171", bg: "#7f1d1d55" },
  declined:         { label: "Seller declined", fg: "#a8a29e", bg: "#44403c55" },
  na:               { label: "N/A",             fg: "#64748b", bg: "#1e293b" },
};

export const VIS = {
  public:   { label: "Listing",   fg: "#4ade80" },
  nda:      { label: "Deal room", fg: "#60a5fa" },
  internal: { label: "Internal",  fg: "#94a3b8" },
};

export function Chip({ state }) {
  const s = STATE[state] || STATE.missing;
  return <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg, whiteSpace: "nowrap" }}>{s.label}</span>;
}

export function ScoreBar({ score, width = 120 }) {
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  const col = v >= 80 ? "#22c55e" : v >= 50 ? "#eab308" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width, height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: v + "%", height: "100%", background: col }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: col, minWidth: 36 }}>{v}%</span>
    </div>
  );
}

export const btn = (primary) => ({
  background: primary ? C.blueBg : "#1a1f2e", color: primary ? "#60a5fa" : C.text,
  border: "1px solid " + (primary ? "#3b82f640" : C.line2), padding: "6px 12px", borderRadius: 6,
  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
});

export const input = {
  width: "100%", boxSizing: "border-box", background: "#1a1f2e", color: C.text, border: "1px solid " + C.line2,
  padding: "8px 10px", borderRadius: 6, fontSize: 13, outline: "none", fontFamily: "inherit",
};

export const money = (n) => (n == null ? "—" : "$" + Number(n).toLocaleString());

export const page = { fontFamily: "'JetBrains Mono', 'SF Mono', monospace", background: C.bg, color: C.text, minHeight: "100vh" };
