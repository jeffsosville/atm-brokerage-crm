-- Lock down the CRM database (Oct 2026).
-- Before: the public browser key (shipped in page code) could read every deal file path, every buyer's
-- name/email/phone and deal room link, all CIM/financial text, and edit or delete deals.
-- After: only signed-in CRM staff (profiles.role super_user or broker) can use these tables directly.
-- Buyers and sellers reach their data only through server routes that check their link
-- (/api/deal-room/<token>, /api/files, /api/concierge, /api/seller/<token>), which use the service role.
--
-- APPLY ONLY AFTER the matching code is deployed (CRM pages send the signed-in user's session;
-- the deal room reads through /api/deal-room). Logs from Oct 14-16 show the public key is used only by
-- those browser pages; every server caller already uses the service role.

create or replace function public.is_crm_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text in ('super_user', 'broker')
  );
$$;
revoke all on function public.is_crm_staff() from public;
grant execute on function public.is_crm_staff() to authenticated, anon;

do $$
declare
  t text;
  pol record;
  tables text[] := array[
    'atm_activity_log','atm_companies','atm_contacts','atm_deals','atm_knowledge_base','atm_listings',
    'atm_machines','atm_notifications','atm_relationship_summaries','buyer_engagement','deal_answers',
    'deal_embeddings','deal_questions','deal_tokens','file_access_logs','listing_files','todos'
  ];
begin
  foreach t in array tables loop
    -- drop every policy that lets anyone in (public/anon role with no real condition)
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and (roles::text like '%public%' or roles::text like '%anon%')
        and coalesce(qual, 'true') = 'true'
        and coalesce(with_check, 'true') = 'true'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists crm_staff_all on public.%I', t);
    execute format('create policy crm_staff_all on public.%I for all to authenticated using (public.is_crm_staff()) with check (public.is_crm_staff())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Views that ran with their owner's rights were readable with the public key.
alter view public.atm_companies_enriched set (security_invoker = true);
alter view public.crm_stats set (security_invoker = true);
alter view public.v_dd_demand set (security_invoker = true);
revoke all on public.atm_companies_enriched, public.crm_stats, public.v_dd_demand from anon;
