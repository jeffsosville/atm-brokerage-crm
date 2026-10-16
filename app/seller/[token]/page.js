"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

// Seller due-diligence portal. One link per listing; no login.
// Every item gets one of three answers: the answer (or a file), "coming soon" with a date,
// or "won't provide". Built for a route owner on a phone, not a CRM user.

const K = {
  bg: "#EEF1F4", paper: "#FFFFFF", ink: "#18212F", muted: "#566173", line: "#D6DCE3",
  done: "#1F7A4D", doneBg: "#E6F3EC", soon: "#9A6408", soonBg: "#FBF1DE", no: "#5F6672", noBg: "#ECEEF1",
  need: "#A33A2C", needBg: "#FBEAE7",
};
const FONT = "'Public Sans', system-ui, -apple-system, Segoe UI, sans-serif";

const STATUS = {
  verified: { text: "Verified", fg: K.done, bg: K.doneBg },
  received: { text: "Answered", fg: K.done, bg: K.doneBg },
  partial: { text: "Partly answered", fg: K.soon, bg: K.soonBg },
  filled_unsourced: { text: "Please confirm", fg: K.soon, bg: K.soonBg },
  coming_soon: { text: "Coming soon", fg: K.soon, bg: K.soonBg },
  declined: { text: "Won't provide", fg: K.no, bg: K.noBg },
  requested: { text: "Needed", fg: K.need, bg: K.needBg },
  missing: { text: "Needed", fg: K.need, bg: K.needBg },
};
const OPEN = ["missing", "requested", "partial", "filled_unsourced"];
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

function Badge({ state }) {
  const s = STATUS[state] || STATUS.missing;
  return <span style={{ fontSize: 13, fontWeight: 600, color: s.fg, background: s.bg, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{s.text}</span>;
}

function Item({ it, token, accent, onSaved }) {
  const [mode, setMode] = useState(null); // answer | soon | decline
  const [text, setText] = useState(it.answer || "");
  const [date, setDate] = useState(it.expected_date || "");
  const [reason, setReason] = useState(it.reason || "");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setText(it.answer || ""); setDate(it.expected_date || ""); setReason(it.reason || ""); }, [it]);

  const post = async (path, body) => {
    const r = await fetch(`/api/seller/${token}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
    return d;
  };

  const save = async () => {
    setErr(""); setBusy(true);
    try {
      let d;
      if (mode === "answer" && file) {
        const start = await post("/upload", { step: "start", item_key: it.key, file_name: file.name, file_size: file.size, file_type: file.type });
        const up = await supabase.storage.from("deal-files").uploadToSignedUrl(start.path, start.token, file, { contentType: file.type || "application/octet-stream" });
        if (up.error) throw new Error("The upload didn't go through. Try again, or email the file to your broker.");
        d = await post("/upload", { step: "finish", item_key: it.key, path: start.path, file_name: file.name, file_size: file.size, file_type: file.type, answer_text: text });
      } else if (mode === "answer") {
        d = await post("", { item_key: it.key, choice: "answer", answer_text: text });
      } else if (mode === "soon") {
        d = await post("", { item_key: it.key, choice: "soon", expected_date: date, answer_text: text });
      } else {
        d = await post("", { item_key: it.key, choice: "decline", reason });
      }
      setMode(null); setFile(null);
      onSaved(it.key, d);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const choice = (m, label) => (
    <button type="button" onClick={() => { setMode(mode === m ? null : m); setErr(""); }} aria-pressed={mode === m}
      style={{ flex: "1 1 0", minWidth: 0, minHeight: 44, padding: "10px 8px", borderRadius: 8, fontFamily: FONT, fontSize: 15, fontWeight: 600, cursor: "pointer",
        border: `1.5px solid ${mode === m ? accent : K.line}`, background: mode === m ? accent : K.paper, color: mode === m ? "#fff" : K.ink }}>
      {label}
    </button>
  );

  const field = { width: "100%", boxSizing: "border-box", fontFamily: FONT, fontSize: 16, color: K.ink, border: `1.5px solid ${K.line}`, borderRadius: 8, padding: "10px 12px", background: "#fff" };
  const canSave = mode === "answer" ? (text.trim() || file) : mode === "soon" ? !!date : mode === "decline";

  return (
    <div id={"item-" + it.key} style={{ padding: "18px 0", borderTop: `1px solid ${K.line}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>{it.label}</div>
          {it.question && it.question !== it.label && <div style={{ fontSize: 15, color: K.muted, marginTop: 4, lineHeight: 1.5 }}>{it.question}</div>}
        </div>
        <Badge state={it.state} />
      </div>

      {it.state === "coming_soon" && it.expected_date && <div style={{ fontSize: 14, color: K.soon, marginTop: 8 }}>You said by {fmtDate(it.expected_date)}</div>}
      {it.state === "declined" && it.reason && <div style={{ fontSize: 14, color: K.no, marginTop: 8 }}>Your reason: {it.reason}</div>}
      {it.answer && !mode && <div style={{ fontSize: 15, marginTop: 8, padding: "10px 12px", background: K.paper, border: `1px solid ${K.line}`, borderRadius: 8, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{it.answer}</div>}

      {it.locked ? (
        <div style={{ fontSize: 14, color: K.done, marginTop: 10 }}>We've verified this. Nothing to do.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {choice("answer", it.answer ? "Update" : "Answer")}
            {choice("soon", "Coming soon")}
            {choice("decline", "Won't provide")}
          </div>

          {mode && (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {mode === "answer" && (
                <>
                  <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer. Short is fine." style={{ ...field, resize: "vertical" }} />
                  <label style={{ fontSize: 15, color: K.muted, display: "grid", gap: 6 }}>
                    Or attach a file (PDF, spreadsheet, photo)
                    <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontFamily: FONT, fontSize: 15 }} />
                  </label>
                </>
              )}
              {mode === "soon" && (
                <>
                  <label style={{ fontSize: 15, color: K.muted, display: "grid", gap: 6 }}>
                    When will you have it?
                    <input type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} style={field} />
                  </label>
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything we should know? (optional)" style={field} />
                </>
              )}
              {mode === "decline" && (
                <>
                  <div style={{ fontSize: 15, color: K.muted, lineHeight: 1.5 }}>Buyers will see this item marked as not provided. That's your call, and it's better than leaving it blank.</div>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional), e.g. kept by my accountant" style={field} />
                </>
              )}
              {err && <div role="alert" style={{ fontSize: 15, color: K.need }}>{err}</div>}
              <button type="button" disabled={!canSave || busy} onClick={save}
                style={{ minHeight: 48, borderRadius: 8, border: "none", fontFamily: FONT, fontSize: 16, fontWeight: 700, cursor: canSave && !busy ? "pointer" : "default",
                  background: canSave && !busy ? K.ink : K.line, color: "#fff" }}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SellerPortal() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/seller/${token}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || "This link isn't working.");
    else setD(j);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const onSaved = (key, res) => {
    setD((prev) => prev && ({
      ...prev, score: res.score ?? prev.score,
      items: prev.items.map((i) => (i.key === key ? { ...i, state: res.state } : i)),
    }));
    load();
  };

  const accent = d?.brand?.accent || "#1D4ED8";
  const items = d?.items || [];
  const open = items.filter((i) => OPEN.includes(i.state));
  const asked = useMemo(() => items.filter((i) => OPEN.includes(i.state) && i.buyers_asked > 0).sort((a, b) => b.buyers_asked - a.buyers_asked).slice(0, 5), [items]);
  const askedKeys = new Set(asked.map((i) => i.key));
  const sections = useMemo(() => {
    const out = [];
    for (const it of items) {
      if (askedKeys.has(it.key)) continue;
      let s = out.find((x) => x.name === it.section);
      if (!s) out.push((s = { name: it.section, items: [] }));
      s.items.push(it);
    }
    return out;
  }, [items, asked]);

  const finish = async () => {
    setFinishing(true);
    try {
      const r = await fetch(`/api/seller/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "done" }) });
      if (r.ok) setFinished(true);
    } finally { setFinishing(false); }
  };

  const shell = (children) => (
    <div style={{ background: K.bg, minHeight: "100vh", fontFamily: FONT, color: K.ink }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`body{background:${K.bg}!important}@media (prefers-reduced-motion: reduce){*{transition:none!important}}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid ${accent};outline-offset:2px}`}</style>
      {children}
    </div>
  );

  if (err) return shell(<div style={{ maxWidth: 560, margin: "0 auto", padding: "64px 20px" }}><h1 style={{ fontSize: 24, margin: 0 }}>This link isn't working</h1><p style={{ fontSize: 17, color: K.muted, lineHeight: 1.6 }}>{err}</p></div>);
  if (!d) return shell(<div style={{ padding: 40, color: K.muted }}>Loading your checklist…</div>);

  const first = (d.seller.name || "").split(" ")[0];
  const pct = Math.max(0, Math.min(100, d.score));
  const answeredCount = items.length - open.length;

  return shell(
    <>
      <header style={{ background: K.paper, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "22px 20px 26px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: accent }}>{d.brand.firm}</div>
          <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: "14px 0 0", fontWeight: 800, letterSpacing: "-0.01em" }}>{d.listing.title}</h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: K.muted, margin: "12px 0 0", maxWidth: 600 }}>
            {first ? `${first}, these` : "These"} are the questions buyers ask before they make an offer. Answer each one, tell us when it's coming, or tell us you won't provide it. Every answer goes straight into your listing file, and you can come back to this link any time.
          </p>
        </div>
      </header>

      <div style={{ position: "sticky", top: 0, zIndex: 5, background: K.ink, color: "#fff" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 16 }}><span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{pct}%</span> of your file is complete</div>
            <div style={{ fontSize: 14, opacity: 0.75, whiteSpace: "nowrap" }}>{answeredCount} of {items.length} done</div>
          </div>
          <div style={{ height: 10, background: "rgba(255,255,255,.18)", borderRadius: 999, marginTop: 10, overflow: "hidden" }}>
            <div style={{ width: pct + "%", height: "100%", background: pct >= 70 ? "#4ADE80" : "#FBBF24", transition: "width .5s ease" }} />
          </div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>Listings at 70% or higher show buyers a transparency badge.</div>
        </div>
      </div>

      <main style={{ maxWidth: 680, margin: "0 auto", padding: "8px 20px 64px" }}>
        {asked.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 20, margin: "0 0 4px", fontWeight: 800 }}>Start here</h2>
            <p style={{ fontSize: 15, color: K.muted, margin: "0 0 4px" }}>Buyers have asked about these the most.</p>
            {asked.map((it) => <Item key={it.key} it={it} token={token} accent={accent} onSaved={onSaved} />)}
          </section>
        )}

        {sections.map((s) => (
          <section key={s.name} style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 20, margin: "0 0 4px", fontWeight: 800 }}>{s.name}</h2>
            {s.items.map((it) => <Item key={it.key} it={it} token={token} accent={accent} onSaved={onSaved} />)}
          </section>
        ))}

        <section style={{ marginTop: 40, background: K.paper, border: `1px solid ${K.line}`, borderRadius: 12, padding: 20 }}>
          {finished || d.submitted_at ? (
            <>
              <h2 style={{ fontSize: 20, margin: 0 }}>Thanks, your broker has been told.</h2>
              <p style={{ fontSize: 16, color: K.muted, lineHeight: 1.6, margin: "8px 0 0" }}>You can still come back to this link to add anything that's coming soon. We'll remind you when a date you gave comes up.</p>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 20, margin: 0 }}>Finished for now?</h2>
              <p style={{ fontSize: 16, color: K.muted, lineHeight: 1.6, margin: "8px 0 14px" }}>
                {open.length ? `${open.length} item${open.length === 1 ? " still needs" : "s still need"} an answer. You can send what you have and come back later.` : "Every item has an answer."}
              </p>
              <button type="button" onClick={finish} disabled={finishing}
                style={{ width: "100%", minHeight: 50, borderRadius: 8, border: "none", background: accent, color: "#fff", fontFamily: FONT, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>
                {finishing ? "Sending…" : "Send to my broker"}
              </button>
            </>
          )}
        </section>

        <p style={{ fontSize: 14, color: K.muted, lineHeight: 1.6, marginTop: 24 }}>
          Questions? Call {d.brand.phone} or email {d.brand.email}. Your financials, locations and contracts are only shared with buyers who have signed an NDA.
        </p>
      </main>
    </>
  );
}
