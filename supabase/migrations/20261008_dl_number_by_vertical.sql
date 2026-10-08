-- DL numbers carry the brand: DL-2026-ATM-00054, DL-2026-VND-00055, DL-2026-CLN-00058.
-- The sequence stays shared, so numbers never collide across brands.
create or replace function public.assign_dl_number() returns trigger language plpgsql as $$
declare code text;
begin
  if new.dl_number is null then
    code := case lower(coalesce(new.deal_type, 'atm'))
      when 'vending' then 'VND' when 'cleaning' then 'CLN' when 'pest' then 'PST' else 'ATM' end;
    new.dl_number := 'DL-' || to_char(now(), 'YYYY') || '-' || code || '-' || lpad(nextval('dl_number_seq')::text, 5, '0');
    new.dl_assigned_at := now();
  end if;
  return new;
end $$;
