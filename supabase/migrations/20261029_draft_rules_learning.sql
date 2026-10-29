-- Learned rules: after John sends an edited draft, Claude checks whether his edit is an industry-wide
-- fact (not a listing detail). If so it suggests a draft_rules row as 'pending'; nothing reaches the
-- drafter until someone approves it in the Inbox. Rejected suggestions are kept so they aren't re-suggested.
alter table public.draft_rules add column if not exists status text not null default 'active';  -- pending | active | rejected | off
alter table public.draft_rules add column if not exists decided_by text;
alter table public.draft_rules add column if not exists decided_at timestamptz;
alter table public.draft_rules add column if not exists why text;  -- for learned rules: what John changed
update public.draft_rules set status = 'active' where active and status is distinct from 'active';
alter table public.draft_outcomes add column if not exists rule_checked_at timestamptz;

-- Undo:
-- alter table public.draft_rules drop column status, drop column decided_by, drop column decided_at, drop column why;
-- alter table public.draft_outcomes drop column rule_checked_at;
