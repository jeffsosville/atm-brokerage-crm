"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import LoginPage from "../../components/LoginPage";
import { authFetch } from "../../lib/authFetch";
import { C, ScoreBar, btn, money, page } from "../../components/ddUi";

export default function DDQueue() {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState("active");
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!user) return;
    setRows(null);
    authFetch("/api/admin/dd?status=" + status).then(d => setRows(d.routes)).catch(e => setErr(e.message));
  }, [user, status]);

  if (loading) return <div style={{ ...page, padding: 40, color: C.faint }}>Loading...</div>;
  if (!user) return <LoginPage />;

  const list = rows || [];
  const complete = list.filter(r => r.file_complete).length;
  const avg = list.length ? Math.round(list.reduce((s, r) => s + Number(r.dd_score || 0), 0) / list.length) : 0;
  const due = list.filter(r => r.next_touch_due && new Date(r.next_touch_due) <= new Date()).length;
  const esc = list.filter(r => r.escalate_to_john).length;

  const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: C.faint, fontWeight: 700, borderBottom: "1px solid " + C.line, textTransform: "uppercase", letterSpacing: "0.5px" };
  const td = { padding: "12px", borderBottom: "1px solid " + C.line, fontSize: 13, verticalAlign: "middle" };

  return (
    <div style={page}>
      <div style={{ background: C.panel, borderBottom: "1px solid " + C.line, padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <a href="/" style={{ color: C.faint, textDecoration: "none", fontSize: 13 }}>← CRM</a>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Due Diligence <span style={{ color: C.blue, fontWeight: 400 }}>Queue</span></h1>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {["active", "pending", "all"].map(s => (
            <button key={s} onClick={() => setStatus(s)} style={btn(status === s)}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {[["Listings", list.length], ["Avg score", avg + "%"], ["Complete files", complete + " / " + list.length], ["Follow-ups due", due, due ? "#facc15" : null], ["Escalate to John", esc, esc ? "#f87171" : null]].map(([l, v, col]) => (
            <div key={l} style={{ background: C.card, border: "1px solid " + C.line, borderRadius: 8, padding: "12px 16px", minWidth: 140 }}>
              <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: col || C.text }}>{v}</div>
            </div>
          ))}
        </div>

        {err && <div style={{ color: "#f87171", marginBottom: 12 }}>{err}</div>}
        {!rows && !err && <div style={{ color: C.faint }}>Loading...</div>}

        {rows && (
          <div style={{ overflowX: "auto", background: C.card, border: "1px solid " + C.line, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead><tr>
                <th style={th}>Listing</th><th style={th}>Asking</th><th style={th}>Score</th>
                <th style={th}>Missing</th><th style={th}>Partial</th><th style={th}>To verify</th>
                <th style={th}>Flags</th><th style={th}>Outreach</th>
              </tr></thead>
              <tbody>
                {list.map(r => {
                  const overdue = r.next_touch_due && new Date(r.next_touch_due) <= new Date();
                  return (
                    <tr key={r.route_id} onClick={() => (window.location.href = "/dd/" + r.slug)} style={{ cursor: "pointer" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#162033")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ ...td, maxWidth: 340 }}>
                        <div style={{ fontWeight: 700 }}>{r.title}</div>
                        {r.escalate_to_john && <div style={{ fontSize: 11, color: "#f87171", marginTop: 2 }}>3 touches unanswered — escalate to John</div>}
                      </td>
                      <td style={td}>{money(r.asking_price)}</td>
                      <td style={td}><ScoreBar score={r.dd_score} /></td>
                      <td style={{ ...td, color: (r.missing_keys || []).length ? "#f87171" : C.faint }}>{(r.missing_keys || []).length}</td>
                      <td style={{ ...td, color: (r.partial_keys || []).length ? "#facc15" : C.faint }}>{(r.partial_keys || []).length}</td>
                      <td style={{ ...td, color: (r.to_verify_keys || []).length ? "#60a5fa" : C.faint }}>{(r.to_verify_keys || []).length}</td>
                      <td style={{ ...td, color: r.open_flags ? "#fb923c" : C.faint }}>{r.open_flags}</td>
                      <td style={{ ...td, fontSize: 12 }}>
                        {r.touches ? (
                          <>
                            <div>{r.touches} touch{r.touches > 1 ? "es" : ""}{r.unanswered_touches ? ", " + r.unanswered_touches + " unanswered" : ""}</div>
                            {r.next_touch_due && <div style={{ color: overdue ? "#facc15" : C.faint }}>Next: {r.next_touch_channel.replace("_", " ")} {new Date(r.next_touch_due).toLocaleDateString()}</div>}
                          </>
                        ) : <span style={{ color: C.faint }}>Not contacted</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11, color: C.faint, marginTop: 12 }}>Sorted by deal size and buyer activity. Score counts verified/received answers fully and partial answers as half.</div>
      </div>
    </div>
  );
}
