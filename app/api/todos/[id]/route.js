import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json();

  const updates = {};
  const allowedFields = ["title", "notes", "assigned_to", "status", "priority", "due_date"];
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const { data, error } = await supabase
    .from("todos")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ todo: data });
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
