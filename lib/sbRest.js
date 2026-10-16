"use client";
// Headers for the CRM pages' direct database calls. They carry the signed-in user's session, so the
// database can allow CRM staff only (the public browser key alone gets nothing).
import { supabase } from "./supabase";

export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function userHeaders(extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    apikey: ANON,
    Authorization: "Bearer " + (session?.access_token || ANON),
    "Content-Type": "application/json",
    ...extra,
  };
}

// fetch() to our own API routes with the user's session (for routes that require a CRM user).
export async function userFetch(url, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { ...(opts.headers || {}) };
  if (session?.access_token) headers.Authorization = "Bearer " + session.access_token;
  return fetch(url, { ...opts, headers });
}
