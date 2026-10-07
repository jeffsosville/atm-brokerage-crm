-- Multi-vertical CRM: keep every deal-linked row tagged with the right vertical.
-- Safe to re-run.
--
-- 1. atm_deals.deal_type (read by the NDA drip) and atm_deals.vertical_id (read by the CRM) stay in sync.
-- 2. Routes and deal tokens inherit their deal's vertical; changing a deal's vertical cascades.
-- 3. Inbound items derive vertical from deal/route before the ATM fallback.
-- 4. Buyer questions inherit from their route.
-- 5. nda_signatures gets vertical_id; vending/cleaning deal-token signers are mirrored into it
--    so every NDA, whatever site it came from, is in one table.
-- 6. Backfill (fixes Longmont: deal_type = vending but vertical_id = ATM default).

create or replace function public.deal_sync_vertical() returns trigger language plpgsql as $$
declare v_slug text;
begin
  if new.deal_type is not null and (tg_op = 'INSERT' or new.deal_type is distinct from old.deal_type) then
    select id into new.vertical_id from public.verticals where slug = lower(new.deal_type);
    if new.vertical_id is null then select id into new.vertical_id from public.verticals where slug = 'atm'; end if;
  elsif new.vertical_id is not null and (tg_op = 'INSERT' or new.vertical_id is distinct from old.vertical_id) then
    select slug into v_slug from public.verticals where id = new.vertical_id;
    if v_slug is not null and v_slug <> 'atm' then new.deal_type := v_slug; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_deal_sync_vertical on public.atm_deals;
create trigger trg_deal_sync_vertical before insert or update of deal_type, vertical_id on public.atm_deals
  for each row execute function public.deal_sync_vertical();

create or replace function public.deal_cascade_vertical() returns trigger language plpgsql as $$
begin
  if new.vertical_id is distinct from old.vertical_id then
    update public.atm_routes  set vertical_id = new.vertical_id where deal_id = new.id and vertical_id is distinct from new.vertical_id;
    update public.deal_tokens set vertical_id = new.vertical_id where deal_id = new.id and vertical_id is distinct from new.vertical_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_deal_cascade_vertical on public.atm_deals;
create trigger trg_deal_cascade_vertical after update of vertical_id on public.atm_deals
  for each row execute function public.deal_cascade_vertical();

create or replace function public.inherit_vertical_from_deal() returns trigger language plpgsql as $$
declare v uuid;
begin
  if new.deal_id is not null and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id or new.vertical_id is null) then
    select vertical_id into v from public.atm_deals where id = new.deal_id;
    if v is not null then new.vertical_id := v; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_route_inherit_vertical on public.atm_routes;
create trigger trg_route_inherit_vertical before insert or update of deal_id on public.atm_routes
  for each row execute function public.inherit_vertical_from_deal();
drop trigger if exists trg_token_inherit_vertical on public.deal_tokens;
create trigger trg_token_inherit_vertical before insert or update of deal_id on public.deal_tokens
  for each row execute function public.inherit_vertical_from_deal();

create or replace function public.inbound_items_route() returns trigger language plpgsql as $$
declare v_slug text;
begin
  if new.vertical_id is null and new.deal_id is not null then
    select vertical_id into new.vertical_id from public.atm_deals where id = new.deal_id;
  end if;
  if new.vertical_id is null and new.route_id is not null then
    select vertical_id into new.vertical_id from public.atm_routes where id = new.route_id;
  end if;
  if new.vertical_id is null and new.source in ('drift_chat','nda','deal_room','listing') then
    select id into new.vertical_id from public.verticals where slug = 'atm';
  end if;
  if new.vertical_id is not null and (tg_op = 'INSERT' or new.vertical_id is distinct from old.vertical_id) then
    select slug into v_slug from public.verticals where id = new.vertical_id;
    new.owner := case when v_slug in ('cleaning','vending','pest') then 'jeff' else 'john' end;
  end if;
  return new;
end $$;

create or replace function public.buyer_question_vertical() returns trigger language plpgsql as $$
begin
  if new.vertical_id is null and new.route_id is not null then
    select vertical_id into new.vertical_id from public.atm_routes where id = new.route_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_bq_vertical on public.buyer_questions;
create trigger trg_bq_vertical before insert on public.buyer_questions
  for each row execute function public.buyer_question_vertical();

alter table public.nda_signatures add column if not exists vertical_id uuid references public.verticals(id);

-- name sorts after nda_signature_link_route so route_id is already resolved
create or replace function public.nda_signature_vertical() returns trigger language plpgsql as $$
begin
  if new.vertical_id is null and new.route_id is not null then
    select vertical_id into new.vertical_id from public.atm_routes where id = new.route_id;
  end if;
  if new.vertical_id is null and coalesce(new.listing_url,'') ~* 'atmbrokerage\.com' then
    select id into new.vertical_id from public.verticals where slug = 'atm';
  end if;
  return new;
end $$;
drop trigger if exists nda_signature_zz_vertical on public.nda_signatures;
create trigger nda_signature_zz_vertical before insert or update on public.nda_signatures
  for each row execute function public.nda_signature_vertical();

create or replace function public.mirror_token_to_nda() returns trigger language plpgsql as $$
declare v_slug text;
begin
  select slug into v_slug from public.verticals where id = new.vertical_id;
  if v_slug is null or v_slug = 'atm' or new.buyer_email is null then return null; end if;
  insert into public.nda_signatures (source, entry_id, email, name, phone, company, listing_url, listing_slug, signed_at, vertical_id, raw)
  values ('deal_token', new.token, lower(new.buyer_email), new.buyer_name, new.buyer_phone, new.buyer_company,
          new.source_url, new.source_listing_slug, coalesce(new.signed_at, new.created_at, now()), new.vertical_id,
          jsonb_build_object('deal_id', new.deal_id, 'token_id', new.id))
  on conflict (source, entry_id) do update set vertical_id = excluded.vertical_id;
  return null;
end $$;
drop trigger if exists trg_mirror_token_to_nda on public.deal_tokens;
create trigger trg_mirror_token_to_nda after insert or update of vertical_id on public.deal_tokens
  for each row execute function public.mirror_token_to_nda();

-- Backfill
update public.atm_deals d set vertical_id = v.id
  from public.verticals v where v.slug = lower(d.deal_type) and d.vertical_id is distinct from v.id;
update public.deal_tokens t set vertical_id = d.vertical_id
  from public.atm_deals d where d.id = t.deal_id and t.vertical_id is distinct from d.vertical_id;
update public.atm_routes r set vertical_id = d.vertical_id
  from public.atm_deals d where d.id = r.deal_id and r.vertical_id is distinct from d.vertical_id;
update public.nda_signatures set listing_url = listing_url where vertical_id is null;  -- fires the vertical trigger

-- Hourly NDA drip from the CRM (half past, so it never collides with the old atmbrokerage-next cron at :00).
-- Replace <CRON_SECRET> with the same secret the other pg_cron jobs use.
-- select cron.schedule('nda-followups-hourly', '30 * * * *', $$
--   select net.http_post(
--     url := 'https://atm-brokerage-crm.vercel.app/api/cron/nda-followups',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body := '{}'::jsonb, timeout_milliseconds := 60000) $$);

-- BizBuySell / BizQuest listing IDs → our deal, so every marketplace lead routes to the right
-- vertical and NDA link. One row per marketplace listing; the inbox cron reads it first and
-- falls back to headline matching and keywords when a listing isn't mapped.
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null default 'bizbuysell',
  external_id text not null,                     -- the "Listing ID" in the lead email
  vertical_id uuid not null references public.verticals(id),
  deal_id uuid references public.atm_deals(id) on delete set null,
  route_id uuid references public.atm_routes(id) on delete set null,
  inhouse_slug text,                             -- vendingexits/cleaningexits listing slug for the NDA link
  headline text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (marketplace, external_id)
);
alter table public.marketplace_listings enable row level security;
-- example:
-- insert into marketplace_listings (external_id, vertical_id, deal_id, inhouse_slug, headline)
-- select '2554771', v.id, null, null, 'Incredible Seattle ATM Opportunity' from verticals v where v.slug = 'atm';
