"use client";
import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";

const SUPABASE_URL = "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indncm14aHhvem95dmNtdmJmdXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4MzI5MTUsImV4cCI6MjA3NDQwODkxNX0.zuOIlNRTC3kjBWHxp9_sef2V9pe9erDSljEcJ2EL9to";

const api = async (path, opts = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  return r.json();
};

const fileIcon = (name) => {
  const ext = (name || "").split(".").pop().toLowerCase();
  const icons = { pdf: "📄", xlsx: "📊", xls: "📊", csv: "📊", doc: "📃", docx: "📃", png: "🖼️", jpg: "🖼️" };
  return icons[ext] || "📁";
};
const formatBytes = (b) => { if (!b) return ""; if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(1) + " KB"; return (b / 1048576).toFixed(1) + " MB"; };

export default function DealHub() {
  const params = useParams();
  const token = params.token;
  const [valid, setValid] = useState(null);
  const [deal, setDeal] = useState(null);
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [gateInput, setGateInput] = useState({ name: "", email: "", phone: "" });
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [gateError, setGateError] = useState("");
  const [gateComplete, setGateComplete] = useState(false);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const tokens = await api("deal_tokens?token=eq." + token + "&select=*");
        if (!tokens.length) { setValid(false); setError("Invalid or expired link."); return; }
        const t = tokens[0];
        if (new Date(t.expires_at) < new Date()) { setValid(false); setError("This link has expired."); return; }

        const dealId = t.deal_id || t.listing_id;
        const deals = await api("atm_deals?id=eq." + dealId + "&select=*");
        if (deals.length) setDeal(deals[0]);
        const f = await api("listing_files?listing_id=eq." + dealId + "&is_active=eq.true&select=*&order=uploaded_at.desc");
        setFiles(f || []);

        // If buyer info already on token, skip gate
        if (t.buyer_email) {
          const buyerInfo = { name: t.buyer_name || "", email: t.buyer_email || "", phone: t.buyer_phone || "" };
          setBuyer(buyerInfo);
          setGateComplete(true);
          setMessages([{ role: "assistant", content: "Hi" + (t.buyer_name ? " " + t.buyer_name.split(" ")[0] : "") + "! I'm the Deal Concierge for " + (deals[0]?.deal_name || "this ATM route") + ". What would you like to know?" }]);
        }

        setValid(true);
      } catch (e) { setValid(false); setError("Something went wrong."); }
    })();
  }, [token]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const submitGate = async () => {
    if (!gateInput.email.trim()) { setGateError("Email is required."); return; }
    setGateSubmitting(true);
    setGateError("");
    try {
      // Save buyer info to the token row
      await api("deal_tokens?token=eq." + token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          buyer_name: gateInput.name.trim() || null,
          buyer_email: gateInput.email.trim(),
          buyer_phone: gateInput.phone.trim() || null,
        }),
      });

      const buyerInfo = { name: gateInput.name.trim(), email: gateInput.email.trim(), phone: gateInput.phone.trim() };
      setBuyer(buyerInfo);
      setGateComplete(true);
      setMessages([{ role: "assistant", content: "Hi" + (buyerInfo.name ? " " + buyerInfo.name.split(" ")[0] : "") + "! I'm the Deal Concierge for " + (deal?.deal_name || "this ATM route") + (deal?.dl_number ? " (" + deal.dl_number + ")" : "") + ". I can answer questions about the financials, equipment, operations, and help you understand if this route is right for you. What would you like to know?" }]);
    } catch (e) {
      setGateError("Something went wrong. Please try again.");
    }
    setGateSubmitting(false);
  };

  const viewFile = async (file) => {
    try {
      const resp = await fetch("/api/files?path=" + encodeURIComponent(file.storage_path));
      const data = await resp.json();
      if (data.url) window.open(data.url, "_blank");
      else alert("Could not get file URL");
    } catch (e) { alert("Error accessing file."); }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const q = chatInput.trim();
    setChatInput("");
    setMessages(function(p) { return [...p, { role: "user", content: q }]; });
    setChatLoading(true);
    try {
      const resp = await fetch("/api/concierge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: deal?.id,
          question: q,
          token: token,
          buyerName: buyer.name,
          buyerEmail: buyer.email,
          buyerPhone: buyer.phone,
          history: messages.slice(-6),
        }),
      });
      if (!resp.ok) throw new Error("API error");
      const data = await resp.json();
      setMessages(function(p) { return [...p, { role: "assistant", content: data.answer, escalated: data.escalated }]; });
    } catch (err) {
      setMessages(function(p) { return [...p, { role: "assistant", content: "Sorry, I had trouble with that. Please try again or contact info@atmbrokerage.com." }]; });
    }
    setChatLoading(false);
  };

  if (valid === null) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 16 }}>Loading Deal Room...</div><div style={{ color: "#64748b" }}>Verifying access</div></div>
    </div>
  );

  if (!valid) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: 40, background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div><h2>Access Denied</h2><p style={{ color: "#64748b" }}>{error}</p>
      </div>
    </div>
  );

  // Gate screen — collect buyer info before showing deal room
  if (!gateComplete) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f172a, #1e293b)", fontFamily: "system-ui" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 420, width: "100%", margin: "0 24px", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: "#3b82f6", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>ATM Brokerage · Confidential</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{deal?.deal_name || "ATM Deal Room"}</h2>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>Please confirm your details to access the deal room and documents.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Full Name</label>
            <input
              value={gateInput.name}
              onChange={e => setGateInput({ ...gateInput, name: e.target.value })}
              placeholder="John Smith"
              style={{ width: "100%", marginTop: 4, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Email Address *</label>
            <input
              value={gateInput.email}
              onChange={e => setGateInput({ ...gateInput, email: e.target.value })}
              onKeyDown={e => e.key === "Enter" && submitGate()}
              placeholder="john@example.com"
              type="email"
              style={{ width: "100%", marginTop: 4, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Phone Number</label>
            <input
              value={gateInput.phone}
              onChange={e => setGateInput({ ...gateInput, phone: e.target.value })}
              onKeyDown={e => e.key === "Enter" && submitGate()}
              placeholder="555-123-4567"
              type="tel"
              style={{ width: "100%", marginTop: 4, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>

          {gateError && <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{gateError}</p>}

          <button
            onClick={submitGate}
            disabled={gateSubmitting || !gateInput.email.trim()}
            style={{ marginTop: 4, padding: "12px", background: gateSubmitting || !gateInput.email.trim() ? "#94a3b8" : "#1e40af", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: gateSubmitting || !gateInput.email.trim() ? "not-allowed" : "pointer" }}
          >
            {gateSubmitting ? "Verifying..." : "Access Deal Room →"}
          </button>
        </div>

        <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 11, marginTop: 16, marginBottom: 0 }}>Your information is kept confidential. All access is logged.</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)", padding: "24px 32px", color: "#fff" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>ATM Brokerage Deal Room</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{deal?.deal_name || "ATM Route"}</h1>
            {deal?.dl_number && <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>{deal.dl_number}</div>}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {deal?.atm_count && <div style={{ background: "rgba(96,165,250,0.15)", padding: "8px 16px", borderRadius: 8, textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 700 }}>{deal.atm_count}</div><div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>ATMs</div></div>}
            {deal?.asking_price && <div style={{ background: "rgba(34,197,94,0.15)", padding: "8px 16px", borderRadius: 8, textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 700, color: "#4ade80" }}>${Number(deal.asking_price).toLocaleString()}</div><div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>Asking</div></div>}
            {deal?.route_state && <div style={{ background: "rgba(168,85,247,0.15)", padding: "8px 16px", borderRadius: 8, textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 700, color: "#c084fc" }}>{deal.route_cities ? deal.route_cities + ", " : ""}{deal.route_state}</div><div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>Location</div></div>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", margin: 0 }}>Deal Documents</h2><p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>{files.length} file{files.length !== 1 ? "s" : ""}</p></div>
            <button onClick={function() { setChatOpen(true); }} style={{ background: "linear-gradient(135deg, #1e40af, #3b82f6)", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer", boxShadow: "0 2px 8px rgba(30,64,175,0.3)" }}>💬 Ask Deal Concierge</button>
          </div>
          {files.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}><div style={{ fontSize: 48, marginBottom: 16 }}>📂</div><p>Documents are being prepared.</p></div>
          ) : (
            <div>{files.map(function(file, i) { return (
              <div key={file.id} onClick={function() { viewFile(file); }} style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < files.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer" }} onMouseOver={function(e) { e.currentTarget.style.background = "#f8fafc"; }} onMouseOut={function(e) { e.currentTarget.style.background = "transparent"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 24 }}>{fileIcon(file.file_name)}</span><div><div style={{ fontWeight: 600, color: "#1e293b", fontSize: 14 }}>{file.file_name}</div><div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{formatBytes(file.file_size)} · {new Date(file.uploaded_at).toLocaleDateString()}</div></div></div>
                <div style={{ color: "#3b82f6", fontSize: 13, fontWeight: 600 }}>View →</div>
              </div>
            ); })}</div>
          )}
        </div>
        <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 12 }}><p>Confidential. All access logged.</p><p style={{ marginTop: 4 }}>ATM Brokerage · 200+ deals since 2012 · info@atmbrokerage.com</p></div>
      </div>

      {chatOpen && (
        <div style={{ position: "fixed", top: 0, right: 0, width: 420, maxWidth: "100vw", height: "100dvh", background: "#fff", boxShadow: "-4px 0 32px rgba(0,0,0,0.15)", zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <div style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Deal Concierge</div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>{deal?.dl_number || "ATM Brokerage"}{buyer.name ? " · " + buyer.name : ""}</div>
            </div>
            <button onClick={function() { setChatOpen(false); }} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 18 }}>✕</button>
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map(function(msg, i) { return (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "85%", padding: "10px 14px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: msg.role === "user" ? "#1e40af" : "#f1f5f9", color: msg.role === "user" ? "#fff" : "#1e293b", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {msg.content}
                  {msg.escalated && <div style={{ marginTop: 8, padding: "6px 10px", background: "#dbeafe", borderRadius: 8, fontSize: 12, color: "#1e40af" }}>📋 Flagged for our team. We'll follow up shortly.</div>}
                </div>
              </div>
            ); })}
            {chatLoading && <div style={{ display: "flex", justifyContent: "flex-start" }}><div style={{ padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: "#f1f5f9", color: "#64748b", fontSize: 14 }}>Thinking...</div></div>}
          </div>
          <div style={{ borderTop: "1px solid #e2e8f0", padding: 12, display: "flex", gap: 8 }}>
            <input value={chatInput} onChange={function(e) { setChatInput(e.target.value); }} onKeyDown={function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }} placeholder="Ask about this listing..." disabled={chatLoading} style={{ flex: 1, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 14, outline: "none" }} />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ padding: "10px 18px", background: chatLoading || !chatInput.trim() ? "#94a3b8" : "#1e40af", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, cursor: chatLoading || !chatInput.trim() ? "not-allowed" : "pointer" }}>{chatLoading ? "..." : "Send"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
