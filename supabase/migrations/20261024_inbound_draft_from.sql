-- Brand sender for a Gmail draft (send-as alias on info@), e.g. "John Sosville <sales@vendingexits.com>".
-- Null = the mailbox's own address (ATM drafts).
alter table public.inbound_items add column if not exists draft_from text;
