-- Standing rules for the email drafter: things that are true across every listing in a vertical
-- (e.g. "SBA doesn't work for ATM routes"). Every active rule for the vertical goes into every draft
-- prompt and overrides past answers. email_qa is per-listing; this is per-industry.
create table if not exists public.draft_rules (
  id          uuid primary key default gen_random_uuid(),
  vertical    text not null,              -- verticals.slug ('atm', 'vending', 'cleaning'...)
  topic       text,                       -- financing, process, pricing_terms...
  rule        text not null,              -- written as an instruction to the drafter
  source      text not null default 'manual',  -- manual | learned
  source_outcome_id bigint,               -- draft_outcomes.id it was learned from, if any
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.draft_rules enable row level security;  -- service role only
create index if not exists draft_rules_vertical_active on public.draft_rules (vertical) where active;
comment on table public.draft_rules is 'Industry-wide facts the drafter must always follow, per vertical. Overrides email_qa past answers.';

insert into public.draft_rules (vertical, topic, rule)
select 'atm', 'financing',
  'SBA financing generally does not work for ATM routes or ATM businesses; almost all ATM deals are cash (some sellers carry a note, most do not). If a buyer mentions SBA financing, a pre-qual or an SBA lender, tell them plainly and kindly that SBA loans generally don''t work in the ATM industry and ask if they''d consider a cash deal. Never say SBA "can work" or "depends on the deal", and never praise their SBA pre-approval as a fit.'
where not exists (select 1 from public.draft_rules where vertical = 'atm' and topic = 'financing');

-- Undo: drop table public.draft_rules;
