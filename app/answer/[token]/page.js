"use client";
import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";

/**
 * /answer/[token]?q=[question_id]
 *
 * Anyone with this link can answer the question.
 * Token identifies who they are (John, Sanny, or seller).
 * No login required.
 *
 * Seller answers are saved but NOT auto-published (is_public=false).
 * Advisor answers can be marked public on submission.
 *
 * Add to atm-brokerage-crm repo at:
 * app/answer/[token]/page.js
 */

const BASE = "";

export default function AnswerPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const responderToken = params.token;
  const questionId = searchParams.get("q");

  const [state, setState] = useState("loading"); // loading | ready | submitting | done | error
  const [responder, setResponder] = useState(null);
  const [question, setQuestion] = useState(null);
  const [existingAnswers, setExistingAnswers] = useState([]);
  const [answer, setAnswer] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [resultMsg, setResultMsg] = useState("");

  useEffect(() => {
    if (!responderToken || !questionId) {
      setState("error");
      return;
    }
    load();
  }, [responderToken, questionId]);

  const load = async () => {
    try {
      const resp = await fetch(`/api/answer-context?token=${responderToken}&q=${questionId}`);
      if (!resp.ok) { setState("error"); return; }
      const data = await resp.json();
      setResponder(data.responder);
      setQuestion(data.question);
      setExistingAnswers(data.existing_answers ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const submit = async () => {
    if (!answer.trim()) return;
    setState("submitting");
    try {
      const resp = await fetch("/api/admin/qa-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responder_token: responderToken,
          question_id: questionId,
          answer: answer.trim(),
          is_public: responder?.role === "advisor" ? isPublic : false,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) { setState("error"); setResultMsg(data.error); return; }
      setResultMsg(data.message);
      setState("done");
    } catch {
      setState("error");
      setResultMsg("Something went wrong. Please try again.");
    }
  };

  // ── STYLES matching atm-brokerage-crm dark theme ──
  const bg = { minHeight: "100vh", background: "#0a0f1a", fontFamily: "system-ui, sans-serif", color: "#e2e8f0" };
  const card = { background: "#111827", border: "1px solid #1e293b", borderRadius: 12, padding: 28, maxWidth: 640, margin: "0 auto" };
  const label = { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" };
  const pill = (color) => ({ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em", background: color === "green" ? "#14532d" : "#1e3a5f", color: color === "green" ? "#4ade80" : "#60a5fa" });

  if (state === "loading") return (
    <div style={{ ...bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#64748b", fontSize: 14 }}>Loading...</div>
    </div>
  );

  if (state === "error") return (
    <div style={{ ...bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...card, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>🔒</div>
        <h2 style={{ color: "#e2e8f0", marginBottom: 8 }}>Invalid or expired link</h2>
        <p style={{ color: "#64748b", fontSize: 14 }}>{resultMsg || "This answer link is no longer valid."}</p>
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 16 }}>Contact <a href="mailto:info@atmbrokerage.com" style={{ color: "#60a5fa" }}>info@atmbrokerage.com</a></p>
      </div>
    </div>
  );

  if (state === "done") return (
    <div style={{ ...bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...card, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
        <h2 style={{ color: "#4ade80", marginBottom: 8 }}>Answer posted</h2>
        <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>{resultMsg}</p>
        {responder?.role === "seller" && (
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 16, padding: "12px 16px", background: "#1e293b", borderRadius: 8 }}>
            ATM Brokerage will review your answer before it appears publicly. Thank you.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ ...bg, padding: "32px 24px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: "#b8410e", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            ATM Brokerage · Buyer Q&A
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
              {question?.deal_name ?? "ATM Route"}
            </h1>
            <span style={pill(responder?.role === "advisor" ? "blue" : "green")}>
              {responder?.role === "seller" ? "Seller" : "Advisor"}
            </span>
          </div>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
            Hi {responder?.name} — a buyer has a question that needs your input.
          </p>
        </div>

        {/* The question */}
        <div style={{ ...card, marginBottom: 16, borderLeft: "3px solid #b8410e" }}>
          <span style={label}>Buyer Question</span>
          <p style={{ fontSize: 16, fontWeight: 600, color: "#e2e8f0", margin: 0, lineHeight: 1.5 }}>
            {question?.question}
          </p>
          {question?.buyer_name && responder?.role !== "seller" && (
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 8, marginBottom: 0 }}>
              Asked by {question.buyer_name}
            </p>
          )}
        </div>

        {/* Existing answers if any */}
        {existingAnswers.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <span style={label}>Answers so far</span>
            {existingAnswers.map((a, i) => (
              <div key={i} style={{ ...card, marginBottom: 8, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={pill(a.answered_by_role === "advisor" ? "blue" : "green")}>
                    {a.answered_by_role}
                  </span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{a.answered_by_name}</span>
                  {a.is_public && <span style={{ fontSize: 11, color: "#4ade80" }}>↗ Public</span>}
                </div>
                <p style={{ margin: 0, fontSize: 14, color: "#94a3b8", lineHeight: 1.6 }}>{a.answer}</p>
              </div>
            ))}
          </div>
        )}

        {/* AI answer for context (advisors only) */}
        {question?.ai_answer && responder?.role === "advisor" && (
          <div style={{ ...card, marginBottom: 16, padding: 16, borderColor: "#4a1d96", opacity: 0.85 }}>
            <span style={{ ...label, color: "#a78bfa" }}>AI Concierge answered (for reference)</span>
            <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{question.ai_answer}</p>
          </div>
        )}

        {/* Answer input */}
        <div style={card}>
          <span style={label}>Your Answer</span>
          {responder?.role === "seller" && (
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12, padding: "10px 14px", background: "#1e293b", borderRadius: 8, lineHeight: 1.5 }}>
              Answer based on your knowledge of the route. ATM Brokerage will review before publishing. Do not include pricing, offers, or buyer-specific details.
            </p>
          )}
          <textarea
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder={responder?.role === "seller"
              ? "Share what you know about this aspect of the route..."
              : "Type your answer — be specific, use real numbers where you have them..."
            }
            rows={6}
            style={{
              width: "100%", background: "#0a0f1a", border: "1px solid #1e293b",
              color: "#e2e8f0", borderRadius: 8, padding: "12px 14px",
              fontSize: 14, fontFamily: "system-ui", resize: "vertical",
              boxSizing: "border-box", outline: "none", lineHeight: 1.6,
            }}
          />

          {/* Public toggle — advisors only */}
          {responder?.role === "advisor" && (
            <div
              onClick={() => setIsPublic(p => !p)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                marginTop: 14, cursor: "pointer", userSelect: "none",
              }}
            >
              <div style={{
                width: 40, height: 22, borderRadius: 11,
                background: isPublic ? "#16a34a" : "#1e293b",
                border: `1px solid ${isPublic ? "#16a34a" : "#334155"}`,
                position: "relative", transition: "all 0.2s",
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  position: "absolute", top: 2,
                  left: isPublic ? 20 : 2,
                  transition: "left 0.2s",
                }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: isPublic ? "#4ade80" : "#94a3b8" }}>
                  {isPublic ? "↗ Publish to listing FAQ" : "Deal hub only"}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {isPublic
                    ? "Visible to all buyers on the public listing page"
                    : "Only visible to NDA-signed buyers in the deal hub"}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={submit}
            disabled={state === "submitting" || !answer.trim()}
            style={{
              marginTop: 18, width: "100%", padding: "13px",
              background: state === "submitting" || !answer.trim() ? "#1e293b" : "#1a1612",
              color: state === "submitting" || !answer.trim() ? "#64748b" : "#fbf8f0",
              border: "none", borderRadius: 8, fontWeight: 700,
              fontSize: 15, cursor: state === "submitting" || !answer.trim() ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {state === "submitting" ? "Posting..." : "Post Answer →"}
          </button>
        </div>

        <p style={{ textAlign: "center", color: "#374151", fontSize: 11, marginTop: 24 }}>
          ATM Brokerage · Confidential · All answers are logged
        </p>
      </div>
    </div>
  );
}
