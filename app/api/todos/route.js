import { createClient } from "@supabase/supabase-js";
import { requireStaff } from "../../../lib/serverAuth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Next.js caches server fetches by default; Supabase reads and signed URLs must always be fresh
  { global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) } }
);

export async function GET(request) {
  if (!(await requireStaff(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ todos: data });
}

export async function POST(req) {
  if (!(await requireStaff(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { data, error } = await supabase
    .from("todos")
    .insert({
      title: body.title,
      notes: body.notes || null,
      assigned_to: body.assigned_to || "both",
      priority: body.priority || "medium",
      due_date: body.due_date || null,
      created_by: body.created_by || "unknown",
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ todo: data });
}
