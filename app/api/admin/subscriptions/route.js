import { requireStaff } from "../../../../lib/serverAuth";
import { setSubscription, listsConfigured } from "../../../../lib/newsletter";

export const dynamic = "force-dynamic";

// GET  → { configured } (whether the toggle can write to the master list)
// POST { email, vertical, on } → turns that person on/off the vertical's weekly list
export async function GET(request) {
  if (!(await requireStaff(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ configured: listsConfigured() });
}

export async function POST(request) {
  const staff = await requireStaff(request);
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { email, vertical, on } = await request.json().catch(() => ({}));
  try {
    const status = await setSubscription(email, vertical, !!on, staff.user?.email || "internal");
    return Response.json({ ok: true, status });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
