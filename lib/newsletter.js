// Newsletter lists. Source of truth is the business-listings `subscribers` table (the vertical sites
// write there); `newsletter_subscriptions` in this database is the CRM's copy, kept in step by the
// sites and by the toggle here.
import { createClient } from "@supabase/supabase-js";
import { adminDb } from "./serverAuth";

export const LIST_VERTICALS = ["atm", "vending", "cleaning", "pest"];

let lists = null;
function listsDb() {
  const url = process.env.SUBSCRIBERS_SUPABASE_URL;
  const key = process.env.SUBSCRIBERS_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  if (!lists) lists = createClient(url, key, { auth: { persistSession: false } });
  return lists;
}
export const listsConfigured = () => !!(process.env.SUBSCRIBERS_SUPABASE_URL && process.env.SUBSCRIBERS_SUPABASE_SERVICE_KEY);

/** Turn someone on or off a vertical's weekly list. Writes the master list first, then the CRM copy. */
export async function setSubscription(email, vertical, on, by) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Invalid email");
  if (!LIST_VERTICALS.includes(vertical)) throw new Error("Unknown list");
  const db = listsDb();
  if (!db) throw new Error("Lists aren't connected yet: add SUBSCRIBERS_SUPABASE_URL and SUBSCRIBERS_SUPABASE_SERVICE_KEY in Vercel.");
  const { data, error } = await db.rpc("set_subscription", { p_email: e, p_vertical: vertical, p_on: !!on, p_source: `crm:${by || "staff"}` });
  if (error) throw new Error(error.message);
  const status = (Array.isArray(data) ? data[0] : data)?.status || (on ? "subscribed" : "unsubscribed");
  const now = new Date().toISOString();
  const row = { email: e, vertical, status: status === "none" ? "unsubscribed" : status, updated_by: `crm:${by || "staff"}` };
  if (row.status === "subscribed") Object.assign(row, { subscribed_at: now, unsubscribed_at: null, source: "crm" });
  if (row.status === "unsubscribed") row.unsubscribed_at = now;
  const { error: mErr } = await adminDb.from("newsletter_subscriptions").upsert(row, { onConflict: "email,vertical" });
  if (mErr) throw new Error(mErr.message);
  return row.status;
}
