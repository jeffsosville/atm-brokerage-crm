import { adminDb as db } from "../../../../lib/serverAuth";
import { gmail, hasToken, headersOf, part, toRaw, authorizedCron, GmailError } from "../../../../lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Puts CRM-drafted replies (inbound_items.draft_text) into Gmail Drafts. Never sends.
// Port of gmail_draft_push.py (which ran from cron on Jeff's Mac). pg_cron calls this every 5 minutes.
//   1. creates (or updates, after a redraft) the Gmail draft as a reply in the same thread
//   2. deletes leftover drafts for items answered some other way, closed, or withdrawn

const ATM_BOXES = ["info", "john"];

const SIGNATURE = `Thanks,
John

John Sosville
john@atmbrokerage.com
303-517-2568
ATM Brokerage
www.atmbrokerage.com
888-430-5535

Check out our sister company:
Connect ATM
www.connectatm.com

The information transmitted is intended only for the person or entity to which it is addressed and may contain confidential, proprietary, and/or privileged material. Any review, retransmission, dissemination or other use of, or taking of any action in reliance upon this information by persons or entities other than the intended recipient is prohibited. If you received this in error, please contact the sender and delete the material from all computers.`;

const SIG_HTML = `<div>John Sosville<br><a href="mailto:john@atmbrokerage.com">john@atmbrokerage.com</a><br>303-517-2568<br><b>ATM Brokerage</b><br><a href="https://www.atmbrokerage.com">www.atmbrokerage.com</a><br>888-430-5535<br><br>Check out our sister company:<br><b>Connect ATM</b><br><a href="https://www.connectatm.com">www.connectatm.com</a><br><br><span style="font-size:11px;color:#777">The information transmitted is intended only for the person or entity to which it is addressed and may contain confidential, proprietary, and/or privileged material. Any review, retransmission, dissemination or other use of, or taking of any action in reliance upon this information by persons or entities other than the intended recipient is prohibited. If you received this in error, please contact the sender and delete the material from all computers.</span></div>`;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const b64lines = (s) => Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");

function stripSignoff(text) {
  return (text || "").trimEnd().replace(
    /\n+\s*(best|thanks|thank you|regards|best regards|cheers|sincerely)[^\n]*\n+\s*(john|john sosville|atm brokerage)[^\n]*(\n+\s*[A-Za-z][A-Za-z ]{0,30})?\s*$/i, "").trimEnd();
}

function buildRaw({ to, subject, body, orig, quote, box, sig }) {
  const reply = stripSignoff(body);
  const [name, address, sigText, sigHtml] = sig || [];
  const h = orig ? headersOf(orig) : {};
  let subj = subject || "(no subject)";
  if (orig && !/^re:/i.test(subj)) subj = "Re: " + subj;

  let quoteTxt = "", quoteHtml = "";
  if (orig && quote) {
    const attr = `On ${h.date || ""}, ${h.from || ""} wrote:`;
    let oTxt = part(orig.payload, "text/plain");
    let oHtml = part(orig.payload, "text/html");
    if (!oHtml && oTxt) oHtml = esc(oTxt).replace(/\n/g, "<br>");
    if (!oTxt && oHtml) oTxt = oHtml.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "");
    oHtml = oHtml.replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/gi, "");
    quoteTxt = "\n\n" + attr + "\n" + oTxt.split("\n").map((l) => "> " + l).join("\n");
    quoteHtml = `<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${esc(attr)}<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${oHtml}</blockquote></div>`;
  }

  const text = reply + "\n\n" + (sigText || SIGNATURE) + quoteTxt;
  const html = `<div dir="ltr">${esc(reply).replace(/\n/g, "<br>")}<br><br>Thanks,<br>John<br><br><div dir="ltr" class="gmail_signature">${sigHtml || SIG_HTML}</div></div>${quoteHtml}`;

  const boundary = "crm_" + Math.random().toString(36).slice(2);
  const lines = [];
  if (!ATM_BOXES.includes(box) && address) lines.push(`From: ${encHeader(name || "John Sosville")} <${address}>`);
  lines.push(`To: ${to}`, `Subject: ${encHeader(subj)}`);
  if (h["message-id"]) {
    lines.push(`In-Reply-To: ${h["message-id"]}`, `References: ${((h.references || "") + " " + h["message-id"]).trim()}`);
  }
  lines.push("MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64lines(text),
    `--${boundary}`, 'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64lines(html),
    `--${boundary}--`, "");
  return toRaw(lines.join("\r\n"));
}

async function getMsg(box, id) {
  try { return await gmail(box, `/messages/${id}`, { query: { format: "full" } }); }
  catch (e) { if (e instanceof GmailError && (e.status === 404 || e.status === 400)) return null; throw e; }
}

async function findOriginal(box, fromEmail, subject) {
  const r = await gmail(box, "/messages", { query: { q: `from:${fromEmail} newer_than:30d`, maxResults: 10 } });
  const base = (subject || "").trim().replace(/^(re|fwd?):\s*/i, "").toLowerCase();
  for (const m of r.messages || []) {
    const full = await getMsg(box, m.id);
    if (!full) continue;
    if (!base || (headersOf(full).subject || "").toLowerCase().includes(base)) return full;
  }
  return null;
}

async function delDraft(box, id) {
  try { await gmail(box, `/drafts/${id}`, { method: "DELETE" }); } catch (e) { if (!(e instanceof GmailError)) throw e; }
}

export async function GET(request) {
  if (!authorizedCron(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";

  const { data: mbs } = await db.from("crm_mailboxes").select("key, display_name, address, signature_text, signature_html").eq("active", true);
  const sigs = {}, ready = new Set();
  for (const m of mbs || []) {
    sigs[m.key] = [m.display_name, m.address, m.signature_text, m.signature_html];
    if (await hasToken(m.key)) ready.add(m.key);
  }

  const { data: items, error } = await db.rpc("gmail_drafts_to_push", { p_boxes: [...ready] });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const report = { to_push: items?.length || 0, pushed: 0, failed: [], cleared: 0 };
  for (const it of items || []) {
    if (dry) continue;
    let box = it.draft_mailbox;
    try {
      let orig = null, used = null, draftId = it.draft_gmail_id, subject = it.subject;
      const form = it.source === "website_form";
      if (!ATM_BOXES.includes(box)) {
        if (it.orig_gmail_id) orig = await getMsg(box, it.orig_gmail_id);
        if (!orig && !form) orig = await findOriginal(box, it.to_email, subject);
        used = box;
      } else if (form) {
        used = box;
      }
      if (it.orig_gmail_id && ATM_BOXES.includes(box)) {
        for (const b of ATM_BOXES) {
          if (!ready.has(b)) continue;
          const o = await getMsg(b, it.orig_gmail_id);
          if (o) { orig = o; used = b; break; }
        }
      }
      if (!orig && !form && ATM_BOXES.includes(box)) {
        used = box;
        orig = await findOriginal(box, it.to_email, subject);
        if (!orig) throw new Error(`original email not found in ${box}@ — not drafting`);
      }
      if (used !== box && draftId) { await delDraft(box, draftId); draftId = null; }
      box = used;
      if (orig) subject = headersOf(orig).subject || subject;
      const message = { raw: buildRaw({ to: it.to_email, subject, body: it.draft_text, orig, quote: !form, box, sig: sigs[box] }) };
      if (orig) message.threadId = orig.threadId;
      if (draftId && form) { await delDraft(box, draftId); draftId = null; }
      let res = null;
      if (draftId) {
        try { res = await gmail(box, `/drafts/${draftId}`, { method: "PUT", body: { id: draftId, message } }); }
        catch (e) { if (!(e instanceof GmailError)) throw e; }
      }
      if (!res) res = await gmail(box, "/drafts", { method: "POST", body: { message } });
      await db.from("inbound_items").update({
        draft_gmail_id: res.id, draft_mailbox: box, draft_thread_id: res.message?.threadId || null,
        draft_pushed_at: new Date().toISOString(), draft_error: null,
      }).eq("id", it.id);
      report.pushed++;
    } catch (e) {
      const msg = `Gmail push: ${e.message || e}`.slice(0, 500);
      await db.from("inbound_items").update({ draft_error: msg }).eq("id", it.id);
      report.failed.push({ id: it.id, error: msg });
    }
  }

  // Leftover drafts: item answered another way, closed, or draft withdrawn in the CRM
  const { data: left } = await db.from("inbound_items").select("id, draft_mailbox, draft_gmail_id")
    .not("draft_gmail_id", "is", null).is("draft_cleared_at", null)
    .or("status.in.(replied,closed,not_a_lead),draft_text.is.null").limit(50);
  for (const r of left || []) {
    if (dry) continue;
    if (ready.has(r.draft_mailbox)) await delDraft(r.draft_mailbox, r.draft_gmail_id);
    await db.from("inbound_items").update({ draft_cleared_at: new Date().toISOString() }).eq("id", r.id);
    report.cleared++;
  }

  return Response.json({ ok: true, ...report });
}

export const POST = GET;
