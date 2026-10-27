begin;
create table if not exists public.fielddocs_budget_ai_usage (
 actor uuid primary key references auth.users(id), day date not null,
 count integer not null default 0, last_request timestamptz not null
);
alter table public.fielddocs_budget_ai_usage enable row level security;
revoke all on public.fielddocs_budget_ai_usage from public,anon,authenticated;
create or replace function public.fielddocs_budget_ai_claim() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.fielddocs_budget_ai_usage; today_utc date:=(now() at time zone 'UTC')::date;
begin
 if auth.uid() is null or public.fielddocs_can_estimate() is not true then raise exception 'Estimating access required'; end if;
 insert into public.fielddocs_budget_ai_usage values(auth.uid(),today_utc,0,'2000-01-01') on conflict do nothing;
 select * into u from public.fielddocs_budget_ai_usage where actor=auth.uid() for update;
 if u.last_request>now()-interval '90 seconds' then raise exception 'Wait 90 seconds between AI budget requests'; end if;
 if u.day=today_utc and u.count>=20 then raise exception 'Daily AI budget limit reached (20 requests per user)'; end if;
 update public.fielddocs_budget_ai_usage set day=today_utc,count=case when u.day=today_utc then u.count+1 else 1 end,last_request=now() where actor=auth.uid();
end $$;
revoke all on function public.fielddocs_budget_ai_claim() from public,anon;
grant execute on function public.fielddocs_budget_ai_claim() to authenticated;
notify pgrst,'reload schema';
commit;
