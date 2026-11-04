"use client";
import { useEffect, useRef, useState } from "react";
import { BRANDS } from "../../lib/brands";

// The website chat window. public/chat.js puts this page in an iframe on our sites:
//   /chat?brand=atm&page=<the visitor's page URL>
// The conversation is stored server-side (/api/site-chat); this page keeps only the session id.

const QUICK = {
  atm: ["I'm looking to buy an ATM route", "I want to sell my ATM route", "I'm shopping for ATM machines"],
  vending: ["I'm looking to buy a vending route", "I want to sell my vending business"],
  cleaning: ["I'm looking to buy a cleaning business", "I want to sell my cleaning business"],
};
const store = {
  get: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { window.localStorage.setItem(k, v); } catch {} },
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// Turn URLs in bot text into links without using innerHTML.
function Linked({ text, accent }) {
  const parts = String(text).split(/(https?:\/\/[^\s)]+[^\s).,;!?])/g);
  return parts.map((p, i) => /^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_top" rel="noopener" style={{ color: accent, wordBreak: "break-all" }}>{p.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>
    : <span key={i}>{p}</span>);
}

export default function ChatPage() {
  const [cfg, setCfg] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    document.body.style.background = "#ffffff";
    const q = new URLSearchParams(window.location.search);
    const brand = BRANDS[q.get("brand")] ? q.get("brand") : "atm";
    const page = q.get("page") || "";
    const isListing = /\/atm-route-for-sale\/|\/listing\//i.test(page);
    // One conversation per brand per visitor, kept for a day.
    const key = `sc_session_${brand}`;
    let saved = null;
    try { saved = JSON.parse(store.get(key) || "null"); } catch {}
    const fresh = !saved || Date.now() - saved.at > 864e5;
    const sessionId = fresh ? uuid() : saved.id;
    if (fresh) store.set(key, JSON.stringify({ id: sessionId, at: Date.now() }));
    let visitorId = store.get("sc_visitor");
    if (!visitorId) { visitorId = uuid(); store.set("sc_visitor", visitorId); }
    setCfg({ brand, page, isListing, sessionId, visitorId, b: BRANDS[brand] });
    if (!fresh) {
      fetch(`/api/site-chat?session=${sessionId}`).then((r) => r.json()).then((d) => setMessages(d.messages || [])).catch(() => {});
    }
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (text) => {
    const msg = String(text || "").trim();
    if (!msg || busy || !cfg) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setBusy(true);
    try {
      const r = await fetch("/api/site-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: cfg.sessionId, visitorId: cfg.visitorId, brand: cfg.brand, pageUrl: cfg.page, message: msg }),
      });
      const d = await r.json();
      setMessages((m) => [...m, { role: "assistant", content: d.reply || "Sorry, something went wrong. Please try again." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't connect. Please try again, or call 888-430-5535." }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  if (!cfg) return null;
  const { b, brand, isListing } = cfg;
  const accent = b.accent;
  const quick = messages.length ? [] : [...(isListing ? ["Tell me about this listing"] : []), ...(QUICK[brand] || QUICK.atm)];
  const close = () => window.parent?.postMessage({ type: "sc-close" }, "*");

  return (
    <div style={S.wrap}>
      <div style={{ ...S.header, background: accent }}>
        <div>
          <div style={S.title}>{b.firm}</div>
          <div style={S.sub}>AI assistant · the team follows up by email</div>
        </div>
        <button onClick={close} aria-label="Close chat" style={S.close}>×</button>
      </div>

      <div style={S.body}>
        <div style={S.bot}>
          Hi! Looking to buy or sell {/^[aeiou]/i.test(b.noun) ? "an" : "a"} {b.noun}? I can answer questions about our listings{brand === "atm" ? " and ATM machines" : ""}.
        </div>
        {messages.map((m, i) => (
          <div key={i} style={m.role === "user" ? { ...S.me, background: accent } : S.bot}>
            {m.role === "user" ? m.content : <Linked text={m.content} accent={accent} />}
          </div>
        ))}
        {busy && <div style={{ ...S.bot, color: "#6b7280" }}>Typing…</div>}
        {quick.length > 0 && (
          <div style={S.quickWrap}>
            {quick.map((q) => (
              <button key={q} onClick={() => send(q)} style={{ ...S.quick, borderColor: accent, color: accent }}>{q}</button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} style={S.form}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question…"
          maxLength={1000}
          style={S.input}
          aria-label="Your message"
        />
        <button type="submit" disabled={busy || !input.trim()} style={{ ...S.send, background: accent, opacity: busy || !input.trim() ? 0.5 : 1 }}>Send</button>
      </form>
    </div>
  );
}

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const S = {
  wrap: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: font, fontSize: 14, color: "#111827", background: "#fff" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", color: "#fff", flexShrink: 0 },
  title: { fontWeight: 600, fontSize: 15 },
  sub: { fontSize: 12, opacity: 0.85, marginTop: 2 },
  close: { background: "transparent", border: 0, color: "#fff", fontSize: 26, lineHeight: 1, cursor: "pointer", padding: "0 4px" },
  body: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8, background: "#f9fafb" },
  bot: { alignSelf: "flex-start", maxWidth: "85%", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px 14px 14px 4px", padding: "9px 12px", lineHeight: 1.45, whiteSpace: "pre-wrap" },
  me: { alignSelf: "flex-end", maxWidth: "85%", color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "9px 12px", lineHeight: 1.45, whiteSpace: "pre-wrap" },
  quickWrap: { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", marginTop: 4 },
  quick: { background: "#fff", border: "1px solid", borderRadius: 999, padding: "7px 12px", fontSize: 13, cursor: "pointer", fontFamily: font, textAlign: "left" },
  form: { display: "flex", gap: 8, padding: 10, borderTop: "1px solid #e5e7eb", flexShrink: 0 },
  input: { flex: 1, border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", fontSize: 16, fontFamily: font, outline: "none", minWidth: 0 },
  send: { border: 0, color: "#fff", borderRadius: 10, padding: "0 16px", fontWeight: 600, cursor: "pointer", fontFamily: font },
};
