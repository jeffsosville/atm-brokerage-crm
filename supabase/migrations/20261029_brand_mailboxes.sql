-- Each brand works out of its own Gmail inbox. One row per mailbox the CRM syncs and drafts into.
-- Adding a brand (pest, HVAC...) = one row here + a one-time `python3 gmail_auth.py <key>` on the sync machine.
create table if not exists public.crm_mailboxes (
  key            text primary key,          -- token_<key>.pickle on the sync machine; inbound_items.draft_mailbox
  address        text not null unique,
  vertical       text not null,             -- verticals.slug
  display_name   text not null default 'John Sosville',
  signature_text text,                      -- null = the ATM signature built into gmail_draft_push.py
  signature_html text,
  active         boolean not null default true,
  connected_at   timestamptz,               -- set by gmail_sync.py once the mailbox's sign-in works
  last_sync_at   timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.crm_mailboxes enable row level security;  -- service role only
comment on table public.crm_mailboxes is 'Gmail mailboxes the CRM syncs and drafts into. Brand drafts go to the brand mailbox only once connected_at is set; until then they fall back to info@.';

insert into public.crm_mailboxes (key, address, vertical, signature_text, signature_html) values
  ('info', 'info@atmbrokerage.com', 'atm', null, null),
  ('john', 'john@atmbrokerage.com', 'atm', null, null),
  ('cleaning', 'hello@cleaningexits.com', 'cleaning',
   E'Thanks,\nJohn\n\nJohn Sosville\nhello@cleaningexits.com\n303-517-2568\nCleaningExits\nwww.cleaningexits.com\n\nThe information transmitted is intended only for the person or entity to which it is addressed and may contain confidential, proprietary, and/or privileged material. Any review, retransmission, dissemination or other use of, or taking of any action in reliance upon this information by persons or entities other than the intended recipient is prohibited. If you received this in error, please contact the sender and delete the material from all computers.',
   '<div>John Sosville<br><a href="mailto:hello@cleaningexits.com">hello@cleaningexits.com</a><br>303-517-2568<br><b>CleaningExits</b><br><a href="https://www.cleaningexits.com">www.cleaningexits.com</a><br><br><span style="font-size:11px;color:#777">The information transmitted is intended only for the person or entity to which it is addressed and may contain confidential, proprietary, and/or privileged material. Any review, retransmission, dissemination or other use of, or taking of any action in reliance upon this information by persons or entities other than the intended recipient is prohibited. If you received this in error, please contact the sender and delete the material from all computers.</span></div>'),
  ('vending', 'info@vendingexits.com', 'vending',
   E'Thanks,\nJohn\n\nJohn Sosville\ninfo@vendingexits.com\n303-517-2568\nVendingExits\nwww.vendingexits.com\n\nThe information transmitted is intended only for the person or entity to which it is addressed and may contain confidential, proprietary, and/or privileged material. Any review, retransmission, dissemination or other use of, or taking of any action in reliance upon this information by persons or entities other than the intended recipient is prohibited. If you received this in error, please contact the sender and delete the material from all computers.',
   '<div>John Sosville<br><a href="mailto:info@vendingexits.com">info@vendingexits.com</a><br>303-517-2568<br><b>VendingExits</b><br><a href="https://www.vendingexits.com">www.vendingexits.com</a><br><br><span style="font-size:11px;color:#777">The information transmitted is intended only for the person or entity to which it is addressed and may contain confidential, proprietary, and/or privileged material. Any review, retransmission, dissemination or other use of, or taking of any action in reliance upon this information by persons or entities other than the intended recipient is prohibited. If you received this in error, please contact the sender and delete the material from all computers.</span></div>')
on conflict (key) do nothing;
-- info@ and john@ are already signed in on the sync machine
update public.crm_mailboxes set connected_at = now() where key in ('info', 'john') and connected_at is null;

-- Which mailbox an email was synced from, and its RFC Message-ID (the same email can sit in two mailboxes)
alter table public.atm_activity_log add column if not exists mailbox text;
alter table public.atm_activity_log add column if not exists message_id text;
create index if not exists atm_activity_log_message_id on public.atm_activity_log (message_id) where message_id is not null;
create index if not exists atm_activity_log_thread on public.atm_activity_log (thread_id) where thread_id is not null;

-- Queue item: the mailbox its email arrived in, and the Gmail thread the draft was created in
-- (a brand draft can start a new thread in the brand inbox; a reply sent there marks the item replied)
alter table public.inbound_items add column if not exists mailbox text;
alter table public.inbound_items add column if not exists draft_thread_id text;

-- undo:
-- alter table public.inbound_items drop column if exists draft_thread_id, drop column if exists mailbox;
-- alter table public.atm_activity_log drop column if exists message_id, drop column if exists mailbox;
-- drop table if exists public.crm_mailboxes;
