import { createClient } from "@supabase/supabase-js";

// Service-role client for server routes only. Never import this from a client component.
export const adminDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Returns the signed-in CRM user from the Bearer token, or null.
export async function getUser(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await adminDb.auth.getUser(token);
  return data?.user || null;
}

export const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });
