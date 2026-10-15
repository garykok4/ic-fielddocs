-- V6.6: internal fee estimating. Run after the V6.3 tasks migration.
begin;
create table if not exists public.fielddocs_estimating_access (
 staff_id uuid primary key references public.staff_profiles(id) on delete cascade,
 granted_by uuid references auth.users(id) on delete set null,
 granted_at timestamptz not null default now()
);
alter table public.fielddocs_estimating_access enable row level security;
revoke all on public.fielddocs_estimating_access from public,anon,authenticated;
create or replace function public.fielddocs_can_estimate()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.staff_profiles s where s.id=auth.uid() and s.active=true and
 (s.role='admin' or exists(select 1 from public.fielddocs_estimating_access a where a.staff_id=s.id)));
$$;
revoke all on function public.fielddocs_can_estimate() from public;
grant execute on function public.fielddocs_can_estimate() to authenticated;
create table if not exists public.fielddocs_fee_scenarios (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 150),
 project_id uuid references public.projects(id) on delete set null,
 notes text not null default '' check(length(notes)<=5000),
 inputs jsonb not null check(jsonb_typeof(inputs)='object'),
 model_version text not null default 'scheps-v1' check(model_version='scheps-v1'),
 revision bigint not null default 0,
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.fielddocs_fee_scenarios enable row level security;
drop policy if exists fee_scenarios_read on public.fielddocs_fee_scenarios;
create policy fee_scenarios_read on public.fielddocs_fee_scenarios for select to authenticated using(public.fielddocs_can_estimate());
revoke all on public.fielddocs_fee_scenarios from public,anon,authenticated;
grant select on public.fielddocs_fee_scenarios to authenticated;
create or replace function public.fielddocs_fee_save(p_id uuid,p_revision bigint,p_name text,p_project uuid,p_notes text,p_inputs jsonb)
returns public.fielddocs_fee_scenarios language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.fielddocs_fee_scenarios; saved public.fielddocs_fee_scenarios; key text; max_value numeric; value numeric;
begin
 if not public.fielddocs_can_estimate() then raise exception 'Estimating access required' using errcode='42501'; end if;
 if p_inputs is null or jsonb_typeof(p_inputs)<>'object' then raise exception 'Enter estimating inputs'; end if;
 for key,max_value in select * from (values ('constructionCost',1000000000000::numeric),('projectMonths',1200),('supervisorAnnualCost',100000000),('supervisorAllocation',100),('trailerMonthlyCost',10000000),('trailerSetup',1000000000),('historicalTrailerTotal',328459.21)) limits(k,m) loop
  if jsonb_typeof(p_inputs->key) is distinct from 'number' then raise exception 'Invalid input: %',key; end if;
  value:=(p_inputs->>key)::numeric;
  if value<0 or value>max_value then raise exception 'Input out of range: %',key; end if;
 end loop;
 if jsonb_typeof(p_inputs->'trailerRequired') is distinct from 'boolean' then raise exception 'Choose whether a trailer is required'; end if;
 if p_project is not null and not public.schedule_v4_allowed(p_project) then raise exception 'Project access required'; end if;
 if p_id is null then
  if p_revision is not null then raise exception 'New scenario cannot have a revision'; end if;
  insert into public.fielddocs_fee_scenarios(name,project_id,notes,inputs,created_by,updated_by)
  values(trim(p_name),p_project,coalesce(p_notes,''),p_inputs,auth.uid(),auth.uid()) returning * into saved;
 else
  select * into old from public.fielddocs_fee_scenarios where id=p_id for update;
  if not found then raise exception 'Scenario no longer exists. Reload.'; end if;
  if old.revision is distinct from p_revision then raise exception 'Scenario changed in another session. Reload before saving.' using errcode='40001'; end if;
  update public.fielddocs_fee_scenarios set name=trim(p_name),project_id=p_project,notes=coalesce(p_notes,''),inputs=p_inputs,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=p_id returning * into saved;
 end if;
 return saved;
end $$;
revoke all on function public.fielddocs_fee_save(uuid,bigint,text,uuid,text,jsonb) from public;
grant execute on function public.fielddocs_fee_save(uuid,bigint,text,uuid,text,jsonb) to authenticated;
create or replace function public.fielddocs_fee_delete(p_id uuid,p_revision bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r bigint;
begin
 if not public.fielddocs_can_estimate() then raise exception 'Estimating access required' using errcode='42501'; end if;
 select revision into r from public.fielddocs_fee_scenarios where id=p_id for update;
 if not found then raise exception 'Scenario no longer exists. Reload.'; end if;
 if r is distinct from p_revision then raise exception 'Scenario changed. Reload before deleting.'; end if;
 delete from public.fielddocs_fee_scenarios where id=p_id;
end $$;
revoke all on function public.fielddocs_fee_delete(uuid,bigint) from public;
grant execute on function public.fielddocs_fee_delete(uuid,bigint) to authenticated;
create or replace function public.fielddocs_estimating_team()
returns table(id uuid,full_name text,role text,can_estimate boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.staff_profiles s where s.id=auth.uid() and s.active=true and s.role='admin') then raise exception 'Administrator access required'; end if;
 return query select s.id,s.full_name::text,s.role::text,(s.role='admin' or a.staff_id is not null) from public.staff_profiles s left join public.fielddocs_estimating_access a on a.staff_id=s.id where s.active=true order by s.full_name;
end $$;
create or replace function public.fielddocs_estimating_grant(p_staff uuid,p_allowed boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.staff_profiles s where s.id=auth.uid() and s.active=true and s.role='admin') then raise exception 'Administrator access required'; end if;
 if p_allowed is null or not exists(select 1 from public.staff_profiles s where s.id=p_staff and s.active=true and s.role<>'admin') then raise exception 'Choose active non-administrator staff'; end if;
 if p_allowed then insert into public.fielddocs_estimating_access(staff_id,granted_by) values(p_staff,auth.uid()) on conflict(staff_id) do nothing;
 else delete from public.fielddocs_estimating_access where staff_id=p_staff; end if;
end $$;
revoke all on function public.fielddocs_estimating_team() from public;
revoke all on function public.fielddocs_estimating_grant(uuid,boolean) from public;
grant execute on function public.fielddocs_estimating_team() to authenticated;
grant execute on function public.fielddocs_estimating_grant(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
