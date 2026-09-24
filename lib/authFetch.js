"use client";
import { supabase } from "./supabase";

// fetch() that sends the signed-in user's access token to our API routes.
export async function authFetch(url, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/"; throw new Error("Not signed in"); }
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}
