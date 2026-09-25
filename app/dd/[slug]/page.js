"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import LoginPage from "../../../components/LoginPage";
import { authFetch } from "../../../lib/authFetch";
import { C, Chip, ScoreBar, VIS, btn, input, money, page } from "../../../components/ddUi";

const SECTIONS = ["Overview", "Financials", "Contracts", "Equipment", "Locations", "Costs", "Contact"];
const OPEN_STATES = ["missing", "open", "partial", "filled_unsourced", "requested"];

function requestEmail(route, items) {
  const first = (route.seller_contact_name || "").split(" ")[0] || "[name]";
  const qs = items.filter(i => i.seller_question).map(i => "- " + i.seller_question).join("\n");
  return `Subject: A few details buyers are asking about — ${route.title}

Hi ${first},

I'm Chrislie, I work with John Sosville at ATM Brokerage on the listing side. We've had buyer activity on your route and there are a handful of details I don't have yet. Getting these in front of buyers up front usually means better offers and a lot fewer questions later.

When you have a few minutes:
${qs}

Short answers are fine — bullet points in a reply work.

Thanks, Chrislie`;
}

function ItemRow({ it, selected, onSelect, onSave }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({ answer_text: it.answer_text || "", source_who: it.source_who || "", source_method: it.source_method || "", source_note: it.source_note || "", declined_reason: it.declined_reason || "" });
  }, [it]);
  const save = async (extra = {}) => {
    setBusy(true);
    try { await onSave({ action: "item", item_key: it.item_key, ...f, ...extra }); setOpen(false); }
    finally { setBusy(false); }
  };
  const vis = VIS[it.visibility] || VIS.nda;
  const canSelect = OPEN_STATES.includes(it.state) && it.seller_question;

  return (
    <div style={{ borderBottom: "1px solid " + C.line, padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <input type="checkbox" disabled={!canSelect} checked={selected} onChange={e => onSelect(it.item_key, e.target.checked)} style={{ marginTop: 4, visibility: canSelect ? "visible" : "hidden" }} title="Include in seller request" />
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setOpen(!open)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: C.faint, fontSize: 11, minWidth: 28 }}>{it.item_key}</span>
            <span style={{ fontWeight: 700 }}>{it.label}</span>
            <Chip state={it.state} />
            <span style={{ fontSize: 10, color: vis.fg, border: "1px solid " + C.line2, padding: "1px 6px", borderRadius: 3 }} title="Where this shows once verified">{vis.label}</span>
            {it.buyer_asks > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fb923c" }} title={it.last_buyer_ask_at ? "Last asked " + new Date(it.last_buyer_ask_at).toLocaleDateString() : ""}>Buyers asked {it.buyer_asks}×</span>}
          </div>
          {it.answer_text && <div style={{ marginTop: 6, fontSize: 13, color: C.text, whiteSpace: "pre-wrap" }}>{it.answer_text}</div>}
          {!it.answer_text && it.seller_question && <div style={{ marginTop: 6, fontSize: 12, color: C.faint }}>Ask: {it.seller_question}</div>}
          {(it.source_who || it.source_date) && (
            <div style={{ marginTop: 4, fontSize: 11, color: C.faint }}>
              Source: {it.source_who || "—"}{it.source_method ? " · " + it.source_method : ""}{it.source_date ? " · " + it.source_date : ""}
              {it.updated_by && it.updated_by !== "claude-dd-audit" ? " · updated by " + it.updated_by : it.updated_by === "claude-dd-audit" ? " · prefilled from deal room" : ""}
            </div>
          )}
          {it.state === "declined" && it.declined_reason && <div style={{ marginTop: 4, fontSize: 12, color: "#a8a29e" }}>Declined: {it.declined_reason}</div>}
          {it.source_note && !it.source_note.startsWith("Audit:") && <div style={{ marginTop: 4, fontSize: 12, color: C.dim }}>Note: {it.source_note}</div>}
        </div>
        <button onClick={() => setOpen(!open)} style={btn(false)}>{open ? "Close" : "Edit"}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, marginLeft: 28, display: "grid", gap: 8 }}>
          {it.seller_question && <div style={{ fontSize: 12, color: C.faint }}>Checklist asks: {it.seller_question}</div>}
          <textarea rows={3} placeholder="Answer (what the seller / document says)" value={f.answer_text} onChange={e => setF({ ...f, answer_text: e.target.value })} style={input} />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
            <input placeholder="Source — who said it, or which file" value={f.source_who} onChange={e => setF({ ...f, source_who: e.target.value })} style={input} />
            <select value={f.source_method} onChange={e => setF({ ...f, source_method: e.target.value })} style={input}>
              <option value="">How?</option>
              <option value="email">Email</option><option value="phone">Phone (confirm by email)</option>
              <option value="document">Document</option><option value="cim">CIM</option><option value="form">Seller form</option>
            </select>
          </div>
          <input placeholder="Internal note (optional)" value={f.source_note} onChange={e => setF({ ...f, source_note: e.target.value })} style={input} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button disabled={busy} onClick={() => save({ status: "verified" })} style={{ ...btn(true), color: "#4ade80" }}>✓ Verified</button>
            <button disabled={busy} onClick={() => save({ status: "received" })} style={btn(false)}>Received (verify later)</button>
            <button disabled={busy} onClick={() => save({ status: "partial" })} style={btn(false)}>Partial</button>
            <button disabled={busy} onClick={() => save({ status: "requested" })} style={btn(false)}>Requested</button>
            <button disabled={busy} onClick={() => { const r = prompt("Why did the seller decline? (optional)", f.declined_reason || ""); if (r !== null) save({ status: "declined", declined_reason: r }); }} style={btn(false)}>Seller declined</button>
            <button disabled={busy} onClick={() => save({ status: "na" })} style={btn(false)}>N/A</button>
            <button disabled={busy} onClick={() => save({})} style={{ ...btn(false), marginLeft: "auto" }}>Save text only</button>
          </div>
        </div>
      )}
    </div>
  );
}


const BST = {
  verified: ["\u2713 Verified", "#15803d"], provided: ["Provided", "#1d4ed8"], partial: ["Partial", "#b45309"],
  requested: ["Requested", "#7c3aed"], pending: ["Pending", "#9ca3af"], not_provided: ["Not provided", "#6b7280"],
};

// Exactly what buyers would see on the listing page (same data as the public endpoint).
function BadgePreview({ slug, live }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { authFetch("/api/admin/dd/" + slug + "?badge=1").then(setD).catch(() => {}); }, [slug]);
  if (!d) return <div style={{ color: C.faint, fontSize: 12, padding: 16 }}>Loading preview...</div>;
  const col = d.score >= 80 ? "#15803d" : d.score >= 50 ? "#b45309" : "#b91c1c";
  const provided = d.counts.verified + d.counts.provided;
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: live ? "#4ade80" : "#facc15", marginBottom: 8 }}>
        {live ? "LIVE — buyers can see this on the listing page" : "PREVIEW ONLY — not shown to buyers"}
      </div>
      <div style={{ background: "#fff", color: "#1f2937", borderRadius: 10, padding: "16px 18px", fontFamily: "Georgia, serif" }}>
        <div style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "#1f3864", fontWeight: 700 }}>Due diligence transparency</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: col, lineHeight: 1 }}>{d.score}%</div>
          <div style={{ flex: 1, height: 9, background: "#eef1f5", borderRadius: 6, overflow: "hidden" }}><div style={{ width: d.score + "%", height: "100%", background: col }} /></div>
        </div>
        <div style={{ fontSize: 12, color: "#4b5563", marginTop: 8 }}>
          {provided} of {d.total} checklist items provided by the seller · {d.counts.verified} verified by ATM Brokerage{d.counts.requested ? " · " + d.counts.requested + " requested" : ""}
        </div>
        <button onClick={() => setOpen(!open)} style={{ marginTop: 10, background: "none", border: "1px solid #c7ced9", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer", color: "#1f3864" }}>
          {open ? "Hide the checklist" : "See the checklist"}
        </button>
        {open && d.sections.map((sec) => (
          <div key={sec.name}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", margin: "12px 0 4px" }}>{sec.name}</div>
            {sec.items.map((it) => {
              const st = BST[it.status] || BST.pending;
              return (
                <div key={it.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "4px 0", borderBottom: "1px solid #f1f3f6" }}>
                  <span>{it.label}{it.value && <div style={{ fontSize: 11, color: "#6b7280" }}>{it.value}</div>}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st[1], whiteSpace: "nowrap" }}>{st[0]}</span>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 10 }}>We check every listing against our due diligence checklist and show buyers exactly what has been provided. Financials, locations and contracts are shared after an NDA.</div>
      </div>
    </div>
  );
}

export default function DDChecklist() {
  const { slug } = useParams();
  const { user, loading } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState({});
  const [channel, setChannel] = useState("email");
  const [touchNote, setTouchNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(() => authFetch("/api/admin/dd/" + slug).then(setD).catch(e => setErr(e.message)), [slug]);
  useEffect(() => { if (user) load(); }, [user, load]);

  const act = async (body) => {
    try { await authFetch("/api/admin/dd/" + slug, { method: "PATCH", body: JSON.stringify(body) }); await load(); }
    catch (e) { alert(e.message); }
  };

  if (loading) return <div style={{ ...page, padding: 40, color: C.faint }}>Loading...</div>;
  if (!user) return <LoginPage />;
  if (err) return <div style={{ ...page, padding: 40, color: "#f87171" }}>{err} — <a href="/dd" style={{ color: C.blue }}>back to queue</a></div>;
  if (!d) return <div style={{ ...page, padding: 40, color: C.faint }}>Loading...</div>;

  const { route, items, flags, touches, score } = d;
  const selKeys = Object.keys(sel).filter(k => sel[k]);
  const selItems = items.filter(i => selKeys.includes(i.item_key));
  const openFlags = flags.filter(f => !f.resolved);
  const card = { background: C.card, border: "1px solid " + C.line, borderRadius: 8, marginBottom: 16 };
  const h2 = { margin: 0, padding: "12px 16px", fontSize: 13, fontWeight: 700, color: C.dim, borderBottom: "1px solid " + C.line, textTransform: "uppercase", letterSpacing: "0.5px" };

  const selectAllOpen = () => {
    const s = {};
    items.filter(i => OPEN_STATES.includes(i.state) && i.seller_question).forEach(i => (s[i.item_key] = true));
    setSel(s);
  };

  return (
    <div style={page}>
      <div style={{ background: C.panel, borderBottom: "1px solid " + C.line, padding: "16px 24px" }}>
        <a href="/dd" style={{ color: C.faint, textDecoration: "none", fontSize: 13 }}>← DD queue</a>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{route.title}</h1>
          <ScoreBar score={score?.dd_score} width={160} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.dim, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>{money(route.asking_price)}</span>
          {route.terminal_count && <span>{route.terminal_count} terminals</span>}
          <span>{route.status}</span>
          <span>{route.nda_count || 0} NDAs</span>
          <span>{score?.n_verified || 0} verified · {(score?.to_verify_keys || []).length} to verify · {score?.n_gaps || 0} gaps</span>
          <a href={"https://atmbrokerage.com/atm-route-for-sale/" + route.slug + "/"} target="_blank" rel="noreferrer" style={{ color: C.blue }}>Listing ↗</a>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }} title="Off = preview only, below. On = buyers see it on atmbrokerage.com (once the snippet is on the page)">
            <input type="checkbox" checked={route.dd_badge_enabled === true} onChange={(e) => { if (!e.target.checked || confirm("Show the transparency badge to buyers on this listing's atmbrokerage.com page?")) act({ action: "badge", enabled: e.target.checked }); }} />
            Show badge on listing
          </label>
        </div>
        <div style={{ marginTop: 8, fontSize: 12 }}>
          Seller: {route.seller_contact_name || <span style={{ color: "#f87171" }}>no name</span>} · {route.seller_contact_email || <span style={{ color: "#f87171" }}>no direct email — get this first</span>} · {route.seller_contact_phone || <span style={{ color: C.faint }}>no mobile</span>}
        </div>
      </div>

      <div style={{ padding: 24, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 20, alignItems: "start" }}>
        <div>
          {openFlags.length > 0 && (
            <div style={{ ...card, borderColor: "#7c2d12" }}>
              <h2 style={{ ...h2, color: "#fb923c" }}>Contradictions to check ({openFlags.length}) — flag, don't fix silently</h2>
              {openFlags.map(f => (
                <div key={f.id} style={{ display: "flex", gap: 12, padding: "10px 16px", borderBottom: "1px solid " + C.line, fontSize: 13 }}>
                  <div style={{ flex: 1 }}>{f.flag}</div>
                  <button style={btn(false)} onClick={() => { const n = prompt("How was this resolved?"); if (n !== null) act({ action: "flag", id: f.id, resolved: true, resolved_note: n }); }}>Resolve</button>
                </div>
              ))}
            </div>
          )}

          {SECTIONS.map(sec => {
            const list = items.filter(i => (i.section || "Other") === sec);
            if (!list.length) return null;
            const done = list.filter(i => ["verified", "received", "declined", "na"].includes(i.state)).length;
            return (
              <div key={sec} style={card}>
                <h2 style={h2}>{sec} <span style={{ color: C.faint, fontWeight: 400 }}>· {done}/{list.length}</span></h2>
                {list.map(it => (
                  <ItemRow key={it.item_key} it={it} selected={!!sel[it.item_key]}
                    onSelect={(k, v) => setSel({ ...sel, [k]: v })} onSave={act} />
                ))}
              </div>
            );
          })}

          {flags.some(f => f.resolved) && (
            <div style={{ fontSize: 12 }}>
              <button onClick={() => setShowResolved(!showResolved)} style={btn(false)}>{showResolved ? "Hide" : "Show"} resolved flags</button>
              {showResolved && flags.filter(f => f.resolved).map(f => (
                <div key={f.id} style={{ color: C.faint, padding: "6px 0" }}>✓ {f.flag}{f.resolved_note ? " — " + f.resolved_note : ""}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: "sticky", top: 16 }}>
          <div style={card}>
            <h2 style={h2}>Buyer-facing badge</h2>
            <BadgePreview key={String(score?.dd_score) + "-" + (score?.n_verified || 0)} slug={route.slug} live={route.dd_badge_enabled === true} />
          </div>

          <div style={card}>
            <h2 style={h2}>Ask the seller</h2>
            <div style={{ padding: 16, display: "grid", gap: 10, fontSize: 13 }}>
              <div style={{ color: C.dim }}>{selKeys.length ? selKeys.length + " item(s) selected" : "Tick items on the left, or:"}</div>
              <button onClick={selectAllOpen} style={btn(false)}>Select all open items</button>
              {selKeys.length > 0 && (
                <>
                  <button style={btn(true)} onClick={() => { navigator.clipboard.writeText(requestEmail(route, selItems)); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                    {copied ? "Copied ✓" : "Copy request email"}
                  </button>
                  <div style={{ fontSize: 11, color: C.faint }}>One email covering every missing field. Send 8–10am Eastern.</div>
                  <select value={channel} onChange={e => setChannel(e.target.value)} style={input}>
                    <option value="email">Email</option><option value="phone">Phone call</option><option value="other">Other</option>
                  </select>
                  <input placeholder="Note (optional)" value={touchNote} onChange={e => setTouchNote(e.target.value)} style={input} />
                  <button style={btn(true)} onClick={async () => { await act({ action: "touch", channel, item_keys: selKeys, note: touchNote }); setSel({}); setTouchNote(""); }}>
                    Log as sent → mark requested
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={card}>
            <h2 style={h2}>Outreach</h2>
            <div style={{ padding: 16, fontSize: 12, display: "grid", gap: 10 }}>
              {score?.next_touch_due && (
                <div style={{ color: new Date(score.next_touch_due) <= new Date() ? "#facc15" : C.dim }}>
                  Next: {score.next_touch_channel.replace("_", " ")} on {new Date(score.next_touch_due).toLocaleDateString()}
                </div>
              )}
              {score?.escalate_to_john && <div style={{ color: "#f87171" }}>3 unanswered touches on a $500K+ deal — hand to John before the 4th.</div>}
              {!touches.length && <div style={{ color: C.faint }}>No outreach logged yet.</div>}
              {touches.map(t => (
                <div key={t.id} style={{ borderTop: "1px solid " + C.line, paddingTop: 8 }}>
                  <div><b>{t.channel.replace("_", " ")}</b> · {new Date(t.sent_at).toLocaleDateString()} · {t.created_by}</div>
                  {t.item_keys?.length > 0 && <div style={{ color: C.faint }}>Asked: {t.item_keys.join(", ")}</div>}
                  {t.note && <div style={{ color: C.dim }}>{t.note}</div>}
                  {t.replied_at ? <div style={{ color: "#4ade80" }}>Replied {new Date(t.replied_at).toLocaleDateString()}</div>
                    : <button style={{ ...btn(false), marginTop: 4 }} onClick={() => act({ action: "reply", touch_id: t.id })}>Got a reply</button>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
            Rules: every answer gets a source and date. Verbal answers → confirm back by email. Price, offers or valuation → John. Buyers → John. Never push after a second refusal: mark declined.
          </div>
        </div>
      </div>
    </div>
  );
}
