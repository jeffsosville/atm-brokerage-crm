import { createClient } from "@supabase/supabase-js";

// Service-role client for server routes only. Never import this from a client component.
export const adminDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Next.js caches server fetches by default; Supabase reads and signed URLs must always be fresh
  { global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) } }
);

// Returns the signed-in CRM user from the Bearer token, or null.
export async function getUser(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await adminDb.auth.getUser(token);
  return data?.user || null;
}

export const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

// Staff check for admin routes: a signed-in CRM user (super_user or broker profile),
// or a server-to-server call carrying the internal secret.
export async function requireStaff(request) {
  const secret = process.env.INBOX_CRON_SECRET || process.env.CRON_SECRET;
  if (secret && request.headers.get("x-internal-secret") === secret) return { internal: true };
  const user = await getUser(request);
  if (!user) return null;
  const { data: profile } = await adminDb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || !["super_user", "broker"].includes(String(profile.role))) return null;
  return { user };
}
