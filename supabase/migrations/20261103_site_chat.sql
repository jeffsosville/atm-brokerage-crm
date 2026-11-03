-- Website chat (replaces Drift). One row per chat session in the widget on atmbrokerage.com,
-- vendingexits.com and cleaningexits.com. The conversation lives here; once the visitor gives an
-- email or phone, the chat also becomes an inbound_items row (source 'drift_chat', captured_by
-- 'site_chat') so it lands in the queue, gets drafted and joins the person's history.
-- Only the server (service role) writes this table; CRM staff can read it.

create table if not exists public.site_chat_sessions (
  id uuid primary key,
  visitor_id text,
  brand text not null default 'atm',
  page_url text,
  route_id uuid,
  deal_id uuid,
  ip_hash text,
  user_agent text,
  messages jsonb not null default '[]'::jsonb,
  turns integer not null default 0,
  intent text,
  summary text,
  page_title text,
  lead_name text,
  lead_email text,
  lead_phone text,
  escalated boolean not null default false,
  escalation_reason text,
  inbound_item_id uuid references public.inbound_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_chat_sessions_ip_updated on public.site_chat_sessions (ip_hash, updated_at desc);
create index if not exists site_chat_sessions_visitor on public.site_chat_sessions (visitor_id, created_at desc);
create index if not exists site_chat_sessions_created on public.site_chat_sessions (created_at desc);

alter table public.site_chat_sessions enable row level security;
revoke all on public.site_chat_sessions from anon, authenticated;
grant select on public.site_chat_sessions to authenticated;
drop policy if exists site_chat_sessions_staff_read on public.site_chat_sessions;
create policy site_chat_sessions_staff_read on public.site_chat_sessions
  for select to authenticated using (public.is_crm_staff());
