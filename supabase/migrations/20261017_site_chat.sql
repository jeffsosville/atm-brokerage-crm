-- Our own website chat (replaces Drift). One session per visitor per site; every message is kept.
-- Once a visitor leaves an email or phone, the session becomes one Inbound queue item (source 'site_chat').
-- Only the server (service role) writes these; CRM staff can read them.

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  site text not null default 'atm',
  vertical_id uuid references public.verticals(id),
  first_page text,
  last_page text,
  route_id uuid references public.atm_routes(id) on delete set null,
  deal_id uuid,
  name text,
  email text,
  phone text,
  intent text,
  inbound_item_id uuid references public.inbound_items(id) on delete set null,
  deal_links_sent_at timestamptz,
  escalated_at timestamptz,
  ip text,
  user_agent text,
  message_count int not null default 0,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists chat_sessions_visitor on public.chat_sessions (visitor_id, site);
create index if not exists chat_sessions_ip on public.chat_sessions (ip, last_message_at);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('visitor', 'assistant', 'staff', 'system')),
  content text not null,
  page text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session on public.chat_messages (session_id, id);

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
drop policy if exists crm_staff_all on public.chat_sessions;
drop policy if exists crm_staff_all on public.chat_messages;
create policy crm_staff_all on public.chat_sessions for all to authenticated using (public.is_crm_staff()) with check (public.is_crm_staff());
create policy crm_staff_all on public.chat_messages for all to authenticated using (public.is_crm_staff()) with check (public.is_crm_staff());
revoke all on public.chat_sessions, public.chat_messages from anon;

-- New queue source
alter table public.inbound_items drop constraint if exists inbound_items_source_check;
alter table public.inbound_items add constraint inbound_items_source_check check (source = any (array[
  'email','deal_room','listing','nda','marketplace','website_form','drift_chat','site_chat','cold_call'
]));

create or replace function public.inbound_items_route()
 returns trigger language plpgsql as $function$
declare v_slug text;
begin
  if new.vertical_id is null and new.deal_id is not null then
    select vertical_id into new.vertical_id from public.atm_deals where id = new.deal_id;
  end if;
  if new.vertical_id is null and new.route_id is not null then
    select vertical_id into new.vertical_id from public.atm_routes where id = new.route_id;
  end if;
  if new.vertical_id is null and new.source in ('drift_chat','site_chat','nda','deal_room','listing') then
    select id into new.vertical_id from public.verticals where slug = 'atm';
  end if;
  if new.vertical_id is not null and (tg_op = 'INSERT' or new.vertical_id is distinct from old.vertical_id) then
    select slug into v_slug from public.verticals where id = new.vertical_id;
    new.owner := case when v_slug in ('cleaning','vending','pest') then 'jeff' else 'john' end;
  end if;
  return new;
end $function$;
