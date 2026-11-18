import { adminDb as db } from "./serverAuth";

// Gmail API over fetch for the CRM mailboxes (crm_mailboxes). Replaces gmail_sync.py /
// gmail_draft_push.py that used to run from cron on Jeff's Mac.
// Refresh tokens live in gmail_tokens (service role only); the OAuth client is
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (same client as credentials.json).

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const tokenCache = {};

export class GmailError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function accessToken(box) {
  const c = tokenCache[box];
  if (c && c.expires > Date.now() + 60_000) return c.token;
  const { data: row } = await db.from("gmail_tokens").select("refresh_token").eq("mailbox", box).maybeSingle();
  if (!row?.refresh_token) throw new GmailError(401, `${box}: no Gmail token (run gmail_export_tokens.py)`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new GmailError(res.status, `${box}: token refresh failed: ${j.error || res.status} ${j.error_description || ""}`.trim());
  tokenCache[box] = { token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

export async function hasToken(box) {
  const { data } = await db.from("gmail_tokens").select("mailbox").eq("mailbox", box).maybeSingle();
  return !!data;
}

export async function gmail(box, path, { method = "GET", query, body } = {}) {
  const token = await accessToken(box);
  const qs = query ? "?" + new URLSearchParams(Object.entries(query).flatMap(([k, v]) =>
    Array.isArray(v) ? v.map((x) => [k, x]) : v == null ? [] : [[k, String(v)]])) : "";
  const res = await fetch(`${API}${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new GmailError(res.status, `${box} ${method} ${path}: ${res.status} ${j.error?.message || ""}`.trim());
  return j;
}

export const headersOf = (msg) =>
  Object.fromEntries((msg?.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));

export function parseAddress(raw) {
  if (!raw) return null;
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase() || null;
}

const b64 = (d) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

export function part(payload, mime) {
  if (!payload) return "";
  if (payload.mimeType === mime && payload.body?.data) return b64(payload.body.data);
  for (const p of payload.parts || []) {
    const t = part(p, mime);
    if (t) return t;
  }
  return "";
}

/** Plain-text body with quoted history removed (same rules as gmail_sync.py body_text). */
export function bodyText(payload) {
  let t = part(payload, "text/plain");
  if (!t) {
    const h = part(payload, "text/html");
    if (h) t = h.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ");
  }
  t = (t || "").split(/\n\s*On .{5,200}wrote:\s*\n|\n-{2,}\s*Original Message|\n\s*From: .*\n\s*Sent: /)[0];
  t = t.split("\n").filter((l) => !l.trimStart().startsWith(">")).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").replace(/\x00/g, "").trim().slice(0, 8000);
}

export function toRaw(str) {
  return Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function authorizedCron(request) {
  const secret = process.env.INBOX_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return [bearer, request.headers.get("x-cron-secret"), url.searchParams.get("secret")].includes(secret);
}
