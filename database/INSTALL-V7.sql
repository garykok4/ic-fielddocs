-- FIELD DOCS V7: RUN ALL CONTENTS IN SUPABASE SQL EDITOR.
-- Requires installed V6.4+ schema. Safe to rerun; does not delete existing estimates.

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


-- Run after the V6.6 estimating migration. Existing estimates retain their pricing model.
begin;
alter table public.fielddocs_fee_scenarios drop constraint if exists fielddocs_fee_scenarios_model_version_check;
alter table public.fielddocs_fee_scenarios add constraint fielddocs_fee_scenarios_model_version_check check(model_version in ('scheps-v1','scheps-v2'));
-- Keep the original RPC/default at v1 for older deployed clients.
create or replace function public.fielddocs_fee_save_v2(p_id uuid,p_revision bigint,p_name text,p_project uuid,p_notes text,p_inputs jsonb,p_model text)
returns public.fielddocs_fee_scenarios language plpgsql security definer set search_path=pg_catalog,public as $$
declare saved public.fielddocs_fee_scenarios;
begin
 if p_model is null or p_model not in ('scheps-v1','scheps-v2') then raise exception 'Unsupported pricing model'; end if;
 -- Existing function enforces access, project permissions, inputs and revision checks.
 saved:=public.fielddocs_fee_save(p_id,p_revision,p_name,p_project,p_notes,p_inputs);
 update public.fielddocs_fee_scenarios set model_version=p_model where id=saved.id returning * into saved;
 return saved;
end $$;
revoke all on function public.fielddocs_fee_save_v2(uuid,bigint,text,uuid,text,jsonb,text) from public;
grant execute on function public.fielddocs_fee_save_v2(uuid,bigint,text,uuid,text,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;


-- V7 preliminary budgets. Requires V6.6 estimating permissions.
begin;
create table if not exists public.fielddocs_preliminary_estimates (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 150),
 project_id uuid references public.projects(id) on delete set null,
 draft jsonb not null check(jsonb_typeof(draft)='object'),
 revision bigint not null default 0,
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.fielddocs_preliminary_estimates enable row level security;
revoke all on public.fielddocs_preliminary_estimates from public,anon,authenticated;
grant select on public.fielddocs_preliminary_estimates to authenticated;
drop policy if exists preliminary_read on public.fielddocs_preliminary_estimates;
create policy preliminary_read on public.fielddocs_preliminary_estimates for select to authenticated using(public.fielddocs_can_estimate());
create or replace function public.fielddocs_preliminary_save(p_id uuid,p_revision bigint,p_name text,p_project uuid,p_draft jsonb)
returns public.fielddocs_preliminary_estimates language plpgsql security definer set search_path=pg_catalog,public as $$
declare saved public.fielddocs_preliminary_estimates; old_revision bigint; k text; limit_value numeric; n numeric; line jsonb; item record;
begin
 if not public.fielddocs_can_estimate() then raise exception 'Estimating access required' using errcode='42501'; end if;
 if p_project is not null and not public.schedule_v4_allowed(p_project) then raise exception 'Project access required'; end if;
 if p_draft is null or jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>200000 or p_draft->>'version' is distinct from 'class-d-v1' or jsonb_typeof(p_draft->'inputs') is distinct from 'object' or jsonb_typeof(p_draft->'lines') is distinct from 'object' or jsonb_typeof(p_draft->'notes') is distinct from 'string' or length(p_draft->>'notes')>20000 then raise exception 'Invalid budget draft'; end if;
 for k,limit_value in select * from (values
 ('footprint',1e8::numeric),('floors',100),('height',200),('perimeter',1e6),('basementArea',1e8),('basementHeight',100),('wallThickness',120),('footingWidth',240),('footingDepth',120),('slabThickness',120),('basementSlab',120),('upperSlab',120),('doors',10000),('doorArea',10000),('overheadDoors',10000),('overheadArea',10000),('windows',10000),('windowArea',10000),('roofFactor',10),('partitionLength',1e7),('interiorDoors',10000),('washrooms',1000),('stairs',1000),('elevators',100),('paving',1e9),('landscape',1e9),('waterLength',1e7),('sanitaryLength',1e7),('stormLength',1e7),('engineeringPct',100),('architectPct',100),('contingencyPct',100),('rangePct',100),('months',1200),('supervisorAnnual',1e8),('allocation',100),('trailerMonthly',1e7),('trailerSetup',1e9)) limits(key,maxval) loop
 if jsonb_typeof(p_draft->'inputs'->k) is distinct from 'number' then raise exception 'Invalid input: %',k; end if;
 n:=(p_draft->'inputs'->>k)::numeric;
 if n<0 or n>limit_value then raise exception 'Input out of range: %',k; end if;
 if k=any(array['floors','doors','overheadDoors','windows','interiorDoors','washrooms','stairs','elevators']) and n<>trunc(n) then raise exception 'Counts must be whole numbers'; end if;
 end loop;
 if (p_draft->'inputs'->>'footprint')::numeric<=0 or (p_draft->'inputs'->>'floors')::numeric<1 then raise exception 'Positive footprint and storeys required'; end if;
 foreach k in array array['basement','servicing','sprinklers','trailer'] loop
 if jsonb_typeof(p_draft->'inputs'->k) is distinct from 'boolean' then raise exception 'Invalid scope selection'; end if;
 end loop;
 if (p_draft->'inputs'->>'basement')::boolean and ((p_draft->'inputs'->>'basementArea')::numeric<=0 or (p_draft->'inputs'->>'basementArea')::numeric>(p_draft->'inputs'->>'footprint')::numeric) then raise exception 'Invalid basement area'; end if;
 if p_draft->'inputs'->>'structure' is null or p_draft->'inputs'->>'structure' not in ('Steel frame','Wood frame','Concrete frame','Loadbearing masonry') or
 p_draft->'inputs'->>'cladding' is null or p_draft->'inputs'->>'cladding' not in ('Insulated metal panels','Metal siding','Brick veneer','Precast panels','Mixed / custom') or
 p_draft->'inputs'->>'roofStructure' is null or p_draft->'inputs'->>'roofStructure' not in ('Steel deck and joists','Wood trusses','Concrete roof','Custom') or
 p_draft->'inputs'->>'roofFinish' is null or p_draft->'inputs'->>'roofFinish' not in ('Single-ply membrane','Metal roofing','Modified bitumen','Shingles') or
 p_draft->'inputs'->>'upperFloor' is null or p_draft->'inputs'->>'upperFloor' not in ('Concrete slab','Composite / timber assembly') then raise exception 'Invalid assembly selection'; end if;
 for item in select * from jsonb_each(p_draft->'lines') loop
 if item.key<>all(array['mobilization','demolition','earthwork','footings','pads','foundationwalls','groundslab','basementslab','slabbase','waterproofing','upperfloor','upperconcrete','structure','stairs','elevators','cladding','roofstructure','roofing','doors','overhead','windows','partitions','interiordoors','finishes','millwork','hvac','electrical','plumbing','sprinklers','firewater','equipment','water','sanitary','storm','connections','paving','landscape','exterior','testing','permits','other']) then raise exception 'Unknown budget line'; end if;
 line:=item.value;
 if jsonb_typeof(line) is distinct from 'object' or jsonb_typeof(line->'excluded') is distinct from 'boolean' or jsonb_typeof(line->'source') is distinct from 'string' or length(line->>'source')>500 or jsonb_typeof(line->'notes') is distinct from 'string' or length(line->>'notes')>2000 then raise exception 'Invalid line details'; end if;
 foreach k in array array['rate','quantity'] loop
 if not (line ? k) or jsonb_typeof(line->k) not in ('number','null') then raise exception 'Invalid rate or quantity'; end if;
 if jsonb_typeof(line->k)='number' and ((line->>k)::numeric<0 or (line->>k)::numeric>1e12) then raise exception 'Rate or quantity out of range'; end if;
 end loop;
 end loop;
 if p_id is null then
 if p_revision is not null then raise exception 'New estimate cannot have a revision'; end if;
 insert into public.fielddocs_preliminary_estimates(name,project_id,draft,created_by,updated_by) values(trim(p_name),p_project,p_draft,auth.uid(),auth.uid()) returning * into saved;
 else
 select revision into old_revision from public.fielddocs_preliminary_estimates where id=p_id for update;
 if not found then raise exception 'Estimate no longer exists'; end if;
 if old_revision is distinct from p_revision then raise exception 'Estimate changed in another session. Reload before saving.' using errcode='40001'; end if;
 update public.fielddocs_preliminary_estimates set name=trim(p_name),project_id=p_project,draft=p_draft,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=p_id returning * into saved;
 end if;
 return saved;
end $$;
revoke all on function public.fielddocs_preliminary_save(uuid,bigint,text,uuid,jsonb) from public;
grant execute on function public.fielddocs_preliminary_save(uuid,bigint,text,uuid,jsonb) to authenticated;
create or replace function public.fielddocs_preliminary_delete(p_id uuid,p_revision bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r bigint;
begin
 if not public.fielddocs_can_estimate() then raise exception 'Estimating access required' using errcode='42501'; end if;
 select revision into r from public.fielddocs_preliminary_estimates where id=p_id for update;
 if not found or r is distinct from p_revision then raise exception 'Estimate changed or was removed. Reload before deleting.'; end if;
 delete from public.fielddocs_preliminary_estimates where id=p_id;
end $$;
revoke all on function public.fielddocs_preliminary_delete(uuid,bigint) from public;
grant execute on function public.fielddocs_preliminary_delete(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
