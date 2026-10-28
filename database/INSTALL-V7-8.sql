-- FIELD DOCS V7.5: paste and run the entire file in Supabase SQL Editor.
-- FIELD DOCS V7.4 COMBINED INSTALLER: run the entire contents. Existing V6.4+ app required.
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
alter table public.fielddocs_fee_scenarios add constraint fielddocs_fee_scenarios_model_version_check check(model_version in ('scheps-v1','scheps-v2','scheps-v3'));
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

-- V7.3 estimating customization and opportunity tracker. Run after INSTALL-V7.sql.
begin;
create or replace function public.fd_validate_fee_bands(bands jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare b jsonb; n integer; i integer:=0; prev numeric:=0;
begin
 if jsonb_typeof(bands) is distinct from 'array' then raise exception 'PJM bands must be an array'; end if;
 n:=jsonb_array_length(bands);if n<1 or n>8 then raise exception 'Use 1 to 8 PJM bands'; end if;
 for b in select value from jsonb_array_elements(bands) loop
 i:=i+1;
 if jsonb_typeof(b->'percent') is distinct from 'number' or (b->>'percent')::numeric<0 or (b->>'percent')::numeric>100 then raise exception 'Invalid PJM percentage'; end if;
 if i=n then if jsonb_typeof(b->'upper') is distinct from 'null' then raise exception 'Last band must be open-ended';end if;
 else
 if jsonb_typeof(b->'upper') is distinct from 'number' or (b->>'upper')::numeric<=prev or (b->>'upper')::numeric>1e12 then raise exception 'PJM limits must increase';end if;
 prev:=(b->>'upper')::numeric;
 end if;
 end loop;
end $$;
alter table public.fielddocs_fee_scenarios drop constraint if exists fielddocs_fee_scenarios_model_version_check;
alter table public.fielddocs_fee_scenarios add constraint fielddocs_fee_scenarios_model_version_check check(model_version in ('scheps-v1','scheps-v2','scheps-v3'));
create or replace function public.fielddocs_fee_save_v3(p_id uuid,p_revision bigint,p_name text,p_project uuid,p_notes text,p_inputs jsonb,p_model text)
returns public.fielddocs_fee_scenarios language plpgsql security definer set search_path=pg_catalog,public as $$
declare saved public.fielddocs_fee_scenarios;
begin
 if p_model is null or p_model not in ('scheps-v1','scheps-v2','scheps-v3') then raise exception 'Unsupported pricing model';end if;
 if p_model='scheps-v3' then perform public.fd_validate_fee_bands(coalesce(p_inputs->'bands','[{"upper":500000,"percent":8},{"upper":1000000,"percent":6},{"upper":10000000,"percent":4},{"upper":null,"percent":2}]'::jsonb));end if;
 saved:=public.fielddocs_fee_save(p_id,p_revision,p_name,p_project,p_notes,p_inputs);
 update public.fielddocs_fee_scenarios set model_version=p_model where id=saved.id returning * into saved;return saved;
end $$;
revoke all on function public.fielddocs_fee_save_v3(uuid,bigint,text,uuid,text,jsonb,text) from public;
grant execute on function public.fielddocs_fee_save_v3(uuid,bigint,text,uuid,text,jsonb,text) to authenticated;
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
 p_draft->'inputs'->>'cladding' is null or p_draft->'inputs'->>'cladding' not in ('Insulated metal panels','Metal siding','Brick veneer','Regular clay brick veneer','Precast panels','Mixed / custom') or
 p_draft->'inputs'->>'roofStructure' is null or p_draft->'inputs'->>'roofStructure' not in ('Steel deck and joists','Steel beams and purlins','Wood trusses','Concrete roof','Custom') or
 p_draft->'inputs'->>'roofFinish' is null or p_draft->'inputs'->>'roofFinish' not in ('Single-ply membrane','Insulated metal panel (IMP) roof','Metal roofing','Modified bitumen','Shingles') or
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
 if p_draft ? 'feeBands' then perform public.fd_validate_fee_bands(p_draft->'feeBands');end if;
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
create table if not exists public.fd_opportunity_leads (
 id uuid primary key default gen_random_uuid(), title text not null, description text not null default '',
 municipality text not null default '',project_type text not null default '',opportunity_score integer not null default 0,
 status text not null default 'Lead',notes text not null default '',keys text[] not null default '{}',sources jsonb not null default '[]',
 merged_into uuid references public.fd_opportunity_leads(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists fd_lead_keys on public.fd_opportunity_leads using gin(keys);
create table if not exists public.fd_opportunity_scans(id uuid primary key default gen_random_uuid(),actor uuid,started_at timestamptz not null default now(),finished_at timestamptz,summary jsonb);
alter table public.fd_opportunity_leads enable row level security;
alter table public.fd_opportunity_scans enable row level security;
revoke all on public.fd_opportunity_leads,public.fd_opportunity_scans from public,anon,authenticated;
grant select on public.fd_opportunity_leads,public.fd_opportunity_scans to authenticated;
grant all on public.fd_opportunity_leads,public.fd_opportunity_scans to service_role;
drop policy if exists opportunity_read on public.fd_opportunity_leads;
create policy opportunity_read on public.fd_opportunity_leads for select to authenticated using(public.fielddocs_can_estimate());
drop policy if exists scan_read on public.fd_opportunity_scans;
create policy scan_read on public.fd_opportunity_scans for select to authenticated using(public.fielddocs_can_estimate());
create or replace function public.fd_opportunity_scan_start(p_actor uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare run uuid;
begin
 perform pg_advisory_xact_lock(73001);
 if exists(select 1 from public.fd_opportunity_scans where started_at>now()-interval '2 minutes') then raise exception 'A scan recently started. Wait two minutes before scanning again.';end if;
 insert into public.fd_opportunity_scans(actor) values(p_actor) returning id into run;return run;
end $$;
revoke all on function public.fd_opportunity_scan_start(uuid) from public,anon,authenticated;
grant execute on function public.fd_opportunity_scan_start(uuid) to service_role;
create or replace function public.fd_opportunity_ingest(p_items jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb; match_id uuid; aliases text[]; src jsonb; added integer:=0; matched integer:=0; old_notes text; duplicate public.fd_opportunity_leads;
begin
 perform pg_advisory_xact_lock(73002);
 for item in select value from jsonb_array_elements(p_items) loop
 select array_agg(value) into aliases from jsonb_array_elements_text(item->'keys');
 select id into match_id from public.fd_opportunity_leads where merged_into is null and keys && aliases order by created_at,id limit 1 for update;
 src:=case when coalesce(item->>'source_url','')<>'' then jsonb_build_array(jsonb_build_object('url',item->>'source_url','title',item->>'title','name',item->>'source','published',item->>'published')) else '[]'::jsonb end;
 if match_id is null then
 insert into public.fd_opportunity_leads(title,description,municipality,project_type,opportunity_score,status,notes,keys,sources)
 values(left(item->>'title',500),left(coalesce(item->>'description',''),5000),coalesce(item->>'municipality',''),coalesce(item->>'project_type',''),least(100,greatest(0,coalesce((item->>'opportunity_score')::integer,0))),coalesce(nullif(item->>'status',''),'Lead'),coalesce(item->>'notes',''),aliases,src) returning id into match_id;added:=added+1;
 else
 update public.fd_opportunity_leads l set keys=(select array_agg(distinct k) from unnest(l.keys||aliases) k),
 sources=(select coalesce(jsonb_agg(v),'[]'::jsonb) from (select distinct on (x->>'url') x v from jsonb_array_elements(l.sources||src) x order by x->>'url') q),
 notes=case when item->>'legacy_id' is not null and coalesce(item->>'notes','')<>'' and position(item->>'notes' in l.notes)=0 then l.notes||E'\n\nImported legacy note: '||(item->>'notes') else l.notes end,
 updated_at=now() where id=match_id;matched:=matched+1;
 end if;
 -- Collapse a bridge match (same source URL and a headline previously stored separately).
 for duplicate in select * from public.fd_opportunity_leads where id<>match_id and merged_into is null and keys && aliases for update loop
 update public.fd_opportunity_leads l set keys=(select array_agg(distinct k) from unnest(l.keys||duplicate.keys) k),sources=(select coalesce(jsonb_agg(v),'[]'::jsonb) from (select distinct on (x->>'url') x v from jsonb_array_elements(l.sources||duplicate.sources) x order by x->>'url') q),notes=l.notes||E'\n\nGrouped duplicate: '||duplicate.title||' | Previous status: '||duplicate.status||E'\n'||duplicate.notes where id=match_id;
 update public.fd_opportunity_leads set merged_into=match_id where id=duplicate.id;
 end loop;
 end loop;
 return jsonb_build_object('added',added,'matched',matched);
end $$;
revoke all on function public.fd_opportunity_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.fd_opportunity_ingest(jsonb) to service_role;
create or replace function public.fd_opportunity_edit(p_id uuid,p_updated timestamptz,p_status text,p_notes text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not public.fielddocs_can_estimate() then raise exception 'Estimating access required';end if;
 if p_status not in ('Lead','Researching','Contacted','Qualified','Tendering','Won','Lost','Not pursuing') or p_status is null or p_notes is null or length(p_notes)>20000 then raise exception 'Invalid lead details';end if;
 update public.fd_opportunity_leads set status=p_status,notes=p_notes,updated_at=now() where id=p_id and updated_at=p_updated and merged_into is null;
 if not found then raise exception 'Opportunity changed. Refresh before saving.';end if;
end $$;
revoke all on function public.fd_opportunity_edit(uuid,timestamptz,text,text) from public;
grant execute on function public.fd_opportunity_edit(uuid,timestamptz,text,text) to authenticated;
create or replace function public.fd_opportunity_merge(p_keep uuid,p_others uuid[]) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare other public.fd_opportunity_leads;
begin
 if not public.fielddocs_can_estimate() then raise exception 'Estimating access required';end if;
 perform pg_advisory_xact_lock(73002);
 perform 1 from public.fd_opportunity_leads where id=p_keep and merged_into is null for update;if not found then raise exception 'Choose an active opportunity';end if;
 for other in select * from public.fd_opportunity_leads where id=any(p_others) and id<>p_keep and merged_into is null for update loop
 update public.fd_opportunity_leads l set keys=(select array_agg(distinct k) from unnest(l.keys||other.keys) k),
 sources=(select coalesce(jsonb_agg(v),'[]'::jsonb) from (select distinct on (x->>'url') x v from jsonb_array_elements(l.sources||other.sources) x order by x->>'url') q),
 notes=l.notes||E'\n\nMerged: '||other.title||' | Previous status: '||other.status||E'\n'||other.notes,updated_at=now() where id=p_keep;
 update public.fd_opportunity_leads set merged_into=p_keep,updated_at=now() where id=other.id;
 end loop;
end $$;
revoke all on function public.fd_opportunity_merge(uuid,uuid[]) from public;
grant execute on function public.fd_opportunity_merge(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;

-- V7.4 project cost ledger. Requires V7.3 (including estimating permissions).
begin;
create or replace function public.fd_cost_allowed(pid uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select public.fielddocs_can_estimate() and public.schedule_v4_allowed(pid) $$;
revoke all on function public.fd_cost_allowed(uuid) from public;
grant execute on function public.fd_cost_allowed(uuid) to authenticated;
create table if not exists public.fd_cost_projects(project_id uuid primary key references public.projects(id),budget numeric(16,2) not null default 0 check(budget>=0),uncommitted numeric(16,2) not null default 0 check(uncommitted>=0),revision bigint not null default 0);
create table if not exists public.fd_cost_contracts(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),vendor text not null,reference text not null,original numeric(16,2) not null check(original>0),holdback_pct numeric(7,4) not null default 10 check(holdback_pct between 0 and 100),tax_pct numeric(7,4) not null default 13 check(tax_pct between 0 and 100),remaining_forecast numeric(16,2) check(remaining_forecast>=0),created_at timestamptz not null default now());
create table if not exists public.fd_cost_sov(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),contract_id uuid not null references public.fd_cost_contracts(id),description text not null,original numeric(16,2) not null check(original>=0),verified_pct numeric(7,4) not null default 0 check(verified_pct between 0 and 100));
create table if not exists public.fd_cost_changes(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),contract_id uuid not null references public.fd_cost_contracts(id),sov_id uuid not null references public.fd_cost_sov(id),reference text not null,description text not null,amount numeric(16,2) not null check(amount<>0),status text not null default 'pending' check(status in ('pending','approved','rejected')),approved_by uuid references auth.users(id),approved_at timestamptz,created_at timestamptz not null default now());
create table if not exists public.fd_cost_invoices(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),contract_id uuid not null references public.fd_cost_contracts(id),number text not null,duplicate_key text not null,invoice_date date not null,due_date date,reported_prior numeric(16,2) not null check(reported_prior>=0),claimed_holdback numeric(16,2) not null check(claimed_holdback>=0),claimed_total numeric(16,2) not null check(claimed_total>=0),extra_claim numeric(16,2) not null default 0 check(extra_claim>=0),status text not null default 'draft' check(status in ('draft','approved','void')),gross numeric(16,2) not null default 0,holdback numeric(16,2) not null default 0,tax numeric(16,2) not null default 0,tax_pct numeric(7,4) not null,notes text not null default '',approved_by uuid references auth.users(id),approved_at timestamptz,created_at timestamptz not null default now());
create unique index if not exists fd_cost_duplicate_invoice on public.fd_cost_invoices(project_id,duplicate_key) where status<>'void';
create table if not exists public.fd_cost_invoice_lines(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),sov_id uuid not null references public.fd_cost_sov(id),claimed numeric(16,2) not null check(claimed>=0),approved numeric(16,2) not null check(approved>=0 and approved<=claimed),unique(invoice_id,sov_id));
create table if not exists public.fd_cost_releases(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),amount numeric(16,2) not null check(amount>0),tax numeric(16,2) not null,release_date date not null,reference text not null,created_by uuid references auth.users(id),created_at timestamptz not null default now());
alter table public.fd_cost_releases add column if not exists voided boolean not null default false;
create table if not exists public.fd_cost_payments(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),amount numeric(16,2) not null check(amount>0),payment_date date not null,reference text not null,voided boolean not null default false,created_by uuid references auth.users(id),created_at timestamptz not null default now());
create table if not exists public.fd_cost_documents(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),path text not null unique,filename text not null,created_at timestamptz not null default now());
create table if not exists public.fd_cost_audit(id bigint generated always as identity primary key,project_id uuid not null references public.projects(id),actor uuid references auth.users(id),action text not null,details jsonb not null,created_at timestamptz not null default now());
do $$ declare t text;begin foreach t in array array['fd_cost_projects','fd_cost_contracts','fd_cost_sov','fd_cost_changes','fd_cost_invoices','fd_cost_invoice_lines','fd_cost_releases','fd_cost_payments','fd_cost_documents','fd_cost_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('drop policy if exists cost_read on public.%I',t);
 execute format('create policy cost_read on public.%I for select to authenticated using(public.fd_cost_allowed(project_id))',t);
 end loop;end $$;
create or replace function public.fd_cost_read(p_project uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.fd_cost_allowed(p_project) is not true then raise exception 'Cost control requires estimating access and project assignment.' using errcode='42501';end if;
 return jsonb_build_object('project',coalesce((select to_jsonb(x) from public.fd_cost_projects x where project_id=p_project),jsonb_build_object('project_id',p_project,'revision',0,'budget',0,'uncommitted',0)),
 'contracts',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_contracts x where project_id=p_project),'[]'),
 'sov',coalesce((select jsonb_agg(x order by id) from public.fd_cost_sov x where project_id=p_project),'[]'),
 'changes',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_changes x where project_id=p_project),'[]'),
 'invoices',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_invoices x where project_id=p_project),'[]'),
 'lines',coalesce((select jsonb_agg(x order by id) from public.fd_cost_invoice_lines x where project_id=p_project),'[]'),
 'releases',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_releases x where project_id=p_project),'[]'),
 'payments',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_payments x where project_id=p_project),'[]'),
 'documents',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_documents x where project_id=p_project),'[]'),
 'audit',coalesce((select jsonb_agg(x order by id desc) from (select * from public.fd_cost_audit where project_id=p_project order by id desc limit 200) x),'[]'));
end $$;
revoke all on function public.fd_cost_read(uuid) from public;
grant execute on function public.fd_cost_read(uuid) to authenticated;
-- Input helpers enforce cents and finite bounds before every ledger write.
create or replace function public.fd_cost_money(j jsonb) returns numeric language plpgsql immutable as $$
declare n numeric;begin if jsonb_typeof(j) is distinct from 'number' then raise exception 'Enter a numeric amount';end if;n:=j::text::numeric;if n<>round(n,2) or abs(n)>1e12 then raise exception 'Amounts require at most two decimal places and must be within range';end if;return n;end $$;
create or replace function public.fd_cost_text(j jsonb,lim integer) returns text language plpgsql immutable as $$
begin if jsonb_typeof(j) is distinct from 'string' or length(trim(j#>>'{}'))=0 or length(j#>>'{}')>lim then raise exception 'Required text is missing or too long';end if;return trim(j#>>'{}');end $$;
create or replace function public.fd_cost_action(p_project uuid,p_revision bigint,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare rev bigint; c public.fd_cost_contracts; s public.fd_cost_sov; inv public.fd_cost_invoices; ch public.fd_cost_changes; line jsonb; ident uuid; value numeric; total numeric; prior numeric; revised numeric; retained numeric; tax_value numeric; released numeric; paid numeric; claim numeric; approved numeric; extra numeric; notes text;
begin
 if public.fd_cost_allowed(p_project) is not true then raise exception 'Cost control requires estimating access and project assignment.' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>200000 then raise exception 'Invalid cost data';end if;
 insert into public.fd_cost_projects(project_id) values(p_project) on conflict do nothing;
 select revision into rev from public.fd_cost_projects where project_id=p_project for update;
 if rev is distinct from p_revision then raise exception 'Project costs changed in another session. Refresh and review before saving.' using errcode='40001';end if;
 if p_action='budget' then
 update public.fd_cost_projects set budget=public.fd_cost_money(p_data->'budget'),uncommitted=public.fd_cost_money(p_data->'uncommitted') where project_id=p_project;
 elsif p_action='contract' then
 if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 200 then raise exception 'Provide 1 to 200 SOV lines';end if;
 total:=0;for line in select x.value from jsonb_array_elements(p_data->'lines') x loop total:=total+public.fd_cost_money(line->'amount');end loop;
 insert into public.fd_cost_contracts(project_id,vendor,reference,original,holdback_pct,tax_pct) values(p_project,public.fd_cost_text(p_data->'vendor',200),public.fd_cost_text(p_data->'reference',150),total,public.fd_cost_money(p_data->'holdback_pct'),public.fd_cost_money(p_data->'tax_pct')) returning * into c;
 for line in select x.value from jsonb_array_elements(p_data->'lines') x loop insert into public.fd_cost_sov(project_id,contract_id,description,original) values(p_project,c.id,public.fd_cost_text(line->'description',500),public.fd_cost_money(line->'amount'));end loop;
 elsif p_action in ('progress','sov_edit','change','change_approve','change_reject','forecast','invoice','contract_settings','sov_add') then
 select * into c from public.fd_cost_contracts where id=(p_data->>'contract_id')::uuid and project_id=p_project;if not found then raise exception 'Contract not found';end if;
 if p_action='contract_settings' then
 if exists(select 1 from public.fd_cost_invoices where contract_id=c.id and status<>'void') then raise exception 'Contract terms are locked after invoice entry';end if;
 update public.fd_cost_contracts set vendor=public.fd_cost_text(p_data->'vendor',200),reference=public.fd_cost_text(p_data->'reference',150),holdback_pct=public.fd_cost_money(p_data->'holdback_pct'),tax_pct=public.fd_cost_money(p_data->'tax_pct') where id=c.id;
 elsif p_action='sov_add' then
 insert into public.fd_cost_sov(project_id,contract_id,description,original) values(p_project,c.id,public.fd_cost_text(p_data->'description',500),0);
 elsif p_action='forecast' then update public.fd_cost_contracts set remaining_forecast=case when p_data->'amount'='null'::jsonb then null else public.fd_cost_money(p_data->'amount') end where id=c.id;
 elsif p_action in ('progress','sov_edit','change') then
 select * into s from public.fd_cost_sov where id=(p_data->>'sov_id')::uuid and contract_id=c.id;if not found then raise exception 'SOV line not found';end if;
 if p_action='progress' then
 value:=public.fd_cost_money(p_data->'percent');select s.original+coalesce(sum(amount),0) into revised from public.fd_cost_changes where sov_id=s.id and status='approved';
 select coalesce(sum(l.approved),0) into prior from public.fd_cost_invoice_lines l join public.fd_cost_invoices i on i.id=l.invoice_id where l.sov_id=s.id and i.status='approved';
 if round(revised*value/100,2)<prior then raise exception 'Verified progress cannot fall below approved billing';end if;
 update public.fd_cost_sov set verified_pct=value where id=s.id;
 elsif p_action='sov_edit' then
 if exists(select 1 from public.fd_cost_invoices where contract_id=c.id and status<>'void') or exists(select 1 from public.fd_cost_changes where contract_id=c.id) then raise exception 'SOV base is locked after invoices or changes. Use a change order.';end if;
 value:=public.fd_cost_money(p_data->'amount');update public.fd_cost_sov set description=public.fd_cost_text(p_data->'description',500),original=value where id=s.id;
 -- Original contract follows SOV only before any billing/change history exists.
 update public.fd_cost_contracts set original=(select sum(original) from public.fd_cost_sov where contract_id=c.id) where id=c.id;
 else insert into public.fd_cost_changes(project_id,contract_id,sov_id,reference,description,amount) values(p_project,c.id,s.id,public.fd_cost_text(p_data->'reference',150),public.fd_cost_text(p_data->'description',2000),public.fd_cost_money(p_data->'amount'));end if;
 elsif p_action in ('change_approve','change_reject') then
 select * into ch from public.fd_cost_changes where id=(p_data->>'id')::uuid and contract_id=c.id and status='pending';if not found then raise exception 'Pending change not found';end if;
 if p_action='change_approve' then
 select original+coalesce((select sum(amount) from public.fd_cost_changes where sov_id=ch.sov_id and status='approved'),0)+ch.amount into revised from public.fd_cost_sov where id=ch.sov_id;
 select coalesce(sum(l.approved),0) into prior from public.fd_cost_invoice_lines l join public.fd_cost_invoices i on i.id=l.invoice_id where l.sov_id=ch.sov_id and i.status='approved';
 if revised<prior or revised<0 then raise exception 'Change would reduce SOV below approved billing or zero';end if;
 end if;
 update public.fd_cost_changes set status=case when p_action='change_approve' then 'approved' else 'rejected' end,approved_by=auth.uid(),approved_at=now() where id=ch.id;
 else
 -- Draft or draft update. Approved invoice amounts are immutable.
 if p_data->>'id' is null then
 insert into public.fd_cost_invoices(project_id,contract_id,number,duplicate_key,invoice_date,due_date,reported_prior,claimed_holdback,claimed_total,extra_claim,tax_pct,notes)
 values(p_project,c.id,public.fd_cost_text(p_data->'number',100),lower(regexp_replace(c.vendor,'[^a-zA-Z0-9]','','g'))||':'||lower(regexp_replace(public.fd_cost_text(p_data->'number',100),'[^a-zA-Z0-9]','','g')),(p_data->>'invoice_date')::date,nullif(p_data->>'due_date','')::date,public.fd_cost_money(p_data->'reported_prior'),public.fd_cost_money(p_data->'claimed_holdback'),public.fd_cost_money(p_data->'claimed_total'),public.fd_cost_money(p_data->'extra_claim'),c.tax_pct,coalesce(p_data->>'notes','')) returning * into inv;
 else
 select * into inv from public.fd_cost_invoices where id=(p_data->>'id')::uuid and contract_id=c.id and status='draft';if not found then raise exception 'Editable draft not found';end if;
 update public.fd_cost_invoices set number=public.fd_cost_text(p_data->'number',100),duplicate_key=lower(regexp_replace(c.vendor,'[^a-zA-Z0-9]','','g'))||':'||lower(regexp_replace(public.fd_cost_text(p_data->'number',100),'[^a-zA-Z0-9]','','g')),invoice_date=(p_data->>'invoice_date')::date,due_date=nullif(p_data->>'due_date','')::date,reported_prior=public.fd_cost_money(p_data->'reported_prior'),claimed_holdback=public.fd_cost_money(p_data->'claimed_holdback'),claimed_total=public.fd_cost_money(p_data->'claimed_total'),extra_claim=public.fd_cost_money(p_data->'extra_claim'),notes=coalesce(p_data->>'notes','') where id=inv.id;
 delete from public.fd_cost_invoice_lines where invoice_id=inv.id;
 end if;
 if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 200 then raise exception 'Provide SOV allocations';end if;
 for line in select x.value from jsonb_array_elements(p_data->'lines') x loop
 if not exists(select 1 from public.fd_cost_sov where id=(line->>'sov_id')::uuid and contract_id=c.id) then raise exception 'Invoice SOV line belongs to another contract';end if;
 insert into public.fd_cost_invoice_lines(project_id,invoice_id,sov_id,claimed,approved) values(p_project,inv.id,(line->>'sov_id')::uuid,public.fd_cost_money(line->'claimed'),public.fd_cost_money(line->'approved'));
 end loop;
 end if;
 elsif p_action in ('approve','void_invoice','release','payment','attach','void_payment','void_release') then
 select * into inv from public.fd_cost_invoices where id=(p_data->>'invoice_id')::uuid and project_id=p_project;if not found then raise exception 'Invoice not found';end if;
 select * into c from public.fd_cost_contracts where id=inv.contract_id;
 select coalesce(sum(amount),0) into released from public.fd_cost_releases where invoice_id=inv.id and not voided;
 select coalesce(sum(amount),0) into paid from public.fd_cost_payments where invoice_id=inv.id and not voided;
 if p_action='approve' then
 if inv.status<>'draft' then raise exception 'Only drafts may be approved';end if;
 if inv.extra_claim<>0 then raise exception 'Unapproved extra claim: approve a change order and allocate the claim to SOV first';end if;
 select coalesce(sum(gross),0) into prior from public.fd_cost_invoices where contract_id=c.id and status='approved';
 if inv.reported_prior<>prior then raise exception 'Reported previous billing does not match approved prior gross billing';end if;
 select coalesce(sum(l.claimed),0),coalesce(sum(l.approved),0) into claim,total from public.fd_cost_invoice_lines l where l.invoice_id=inv.id;
 if total<=0 then raise exception 'Positive approved amount required';end if;
 if inv.claimed_holdback<>round(claim*c.holdback_pct/100,2) then raise exception 'Claimed holdback does not match the contract rate';end if;
 if inv.claimed_total<>claim-inv.claimed_holdback+round((claim-inv.claimed_holdback)*c.tax_pct/100,2) then raise exception 'Claimed invoice total does not reconcile';end if;
 for line in select to_jsonb(l) from public.fd_cost_invoice_lines l where invoice_id=inv.id loop
 select * into s from public.fd_cost_sov where id=(line->>'sov_id')::uuid;
 select s.original+coalesce(sum(amount),0) into revised from public.fd_cost_changes where sov_id=s.id and status='approved';
 select coalesce(sum(l.approved),0) into approved from public.fd_cost_invoice_lines l join public.fd_cost_invoices i on i.id=l.invoice_id where l.sov_id=s.id and i.status='approved';
 if approved+(line->>'approved')::numeric>revised then raise exception 'Approved billing exceeds revised SOV';end if;
 if approved+(line->>'approved')::numeric>round(revised*s.verified_pct/100,2) then raise exception 'Approved billing exceeds PM-verified progress';end if;
 end loop;
 select c.original+coalesce(sum(amount),0) into revised from public.fd_cost_changes where contract_id=c.id and status='approved';
 if prior+total>revised then raise exception 'Approved billing exceeds revised contract';end if;
 retained:=round(total*c.holdback_pct/100,2);tax_value:=round((total-retained)*c.tax_pct/100,2);
 update public.fd_cost_invoices set status='approved',gross=total,holdback=retained,tax=tax_value,approved_by=auth.uid(),approved_at=now() where id=inv.id;
 elsif p_action='void_invoice' then
 notes:=public.fd_cost_text(p_data->'reason',2000);
 if inv.status='void' or paid>0 or released>0 then raise exception 'Cannot void an invoice with payments/releases or already void';end if;
 if inv.status='approved' and exists(select 1 from public.fd_cost_invoices where contract_id=c.id and status='approved' and approved_at>inv.approved_at) then raise exception 'Void later approvals first to preserve billing sequence';end if;
 update public.fd_cost_invoices set status='void',notes=inv.notes||E'\nVoid reason: '||notes where id=inv.id;
 elsif p_action='release' then
 if inv.status<>'approved' then raise exception 'Approved invoice required';end if;value:=public.fd_cost_money(p_data->'amount');
 if value+released>inv.holdback then raise exception 'Release exceeds remaining retained holdback';end if;
 if p_data->>'confirmed' is distinct from 'true' then raise exception 'Confirm release authorization and eligibility review';end if;
 insert into public.fd_cost_releases(project_id,invoice_id,amount,tax,release_date,reference,created_by) values(p_project,inv.id,value,round(value*inv.tax_pct/100,2),(p_data->>'date')::date,public.fd_cost_text(p_data->'reference',1000),auth.uid());
 elsif p_action='payment' then
 if inv.status<>'approved' then raise exception 'Approved invoice required';end if;value:=public.fd_cost_money(p_data->'amount');
 select inv.gross-inv.holdback+inv.tax+coalesce(sum(amount+tax),0)-paid into total from public.fd_cost_releases where invoice_id=inv.id and not voided;
 if value>total then raise exception 'Payment exceeds unpaid approved amount including released holdback';end if;
 insert into public.fd_cost_payments(project_id,invoice_id,amount,payment_date,reference,created_by) values(p_project,inv.id,value,(p_data->>'date')::date,public.fd_cost_text(p_data->'reference',200),auth.uid());
 elsif p_action='void_release' then
 notes:=public.fd_cost_text(p_data->'reason',2000);
 select amount+tax into value from public.fd_cost_releases where id=(p_data->>'release_id')::uuid and invoice_id=inv.id and not voided;if not found then raise exception 'Active release not found';end if;
 select inv.gross-inv.holdback+inv.tax+coalesce(sum(amount+tax),0)-value into total from public.fd_cost_releases where invoice_id=inv.id and not voided;
 if paid>total then raise exception 'Void related payment records before reversing this release';end if;
 update public.fd_cost_releases set voided=true where id=(p_data->>'release_id')::uuid;
 elsif p_action='void_payment' then
 notes:=public.fd_cost_text(p_data->'reason',2000);update public.fd_cost_payments set voided=true where id=(p_data->>'payment_id')::uuid and invoice_id=inv.id and not voided;if not found then raise exception 'Active payment not found';end if;
 else
 notes:=public.fd_cost_text(p_data->'path',500);
 if split_part(notes,'/',1)<>p_project::text or split_part(notes,'/',2)<>inv.id::text then raise exception 'Invalid invoice file path';end if;
 if not exists(select 1 from storage.objects where bucket_id='fielddocs-cost-invoices' and name=notes) then raise exception 'Upload not found';end if;
 insert into public.fd_cost_documents(project_id,invoice_id,path,filename) values(p_project,inv.id,notes,public.fd_cost_text(p_data->'filename',200));
 end if;
 else raise exception 'Unknown cost action';end if;
 update public.fd_cost_projects set revision=revision+1 where project_id=p_project;
 insert into public.fd_cost_audit(project_id,actor,action,details) values(p_project,auth.uid(),p_action,p_data);
 return public.fd_cost_read(p_project);
end $$;
revoke all on function public.fd_cost_action(uuid,bigint,text,jsonb) from public;
grant execute on function public.fd_cost_action(uuid,bigint,text,jsonb) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fielddocs-cost-invoices','fielddocs-cost-invoices',false,20971520,array['application/pdf','image/jpeg','image/png']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cost_invoice_upload on storage.objects;
create policy cost_invoice_upload on storage.objects for insert to authenticated with check(bucket_id='fielddocs-cost-invoices' and exists(select 1 from public.fd_cost_invoices i where i.id::text=split_part(name,'/',2) and i.project_id::text=split_part(name,'/',1) and public.fd_cost_allowed(i.project_id)));
drop policy if exists cost_invoice_download on storage.objects;
create policy cost_invoice_download on storage.objects for select to authenticated using(bucket_id='fielddocs-cost-invoices' and exists(select 1 from public.fd_cost_documents d where d.path=name and public.fd_cost_allowed(d.project_id)));
notify pgrst,'reload schema';
commit;

-- V7.5 schedule drafts, FS/SS links, signed lag and project closures.
begin;
alter table public.schedule_dependencies add column if not exists relation text not null default 'FS' check(relation in ('FS','SS'));
do $$ declare c record;begin for c in select conname from pg_constraint where conrelid='public.schedule_dependencies'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%lag_work_days%' loop execute format('alter table public.schedule_dependencies drop constraint %I',c.conname);end loop;end $$;
alter table public.schedule_dependencies add constraint schedule_v75_lag check(lag_work_days between -10000 and 10000);
alter table public.schedule_v4_state add column if not exists closures jsonb not null default '[]';
create table if not exists public.schedule_import_batches(project_id uuid not null references public.projects(id),fingerprint text not null,metadata jsonb not null,created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),primary key(project_id,fingerprint));
alter table public.schedule_import_batches enable row level security;
revoke all on public.schedule_import_batches from public,anon,authenticated;
create or replace function public.schedule_v75_read(p_project uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.schedule_v4_allowed(p_project) is not true then raise exception 'Project access required';end if;
 return public.schedule_v4_read(p_project)||jsonb_build_object('closures',coalesce((select closures from public.schedule_v4_state where project_id=p_project),'[]'::jsonb),'links',coalesce((select jsonb_agg(to_jsonb(d)) from public.schedule_dependencies d where project_id=p_project),'[]'::jsonb),'import_history',coalesce((select jsonb_agg(to_jsonb(b)) from (select metadata,created_at,created_by from public.schedule_import_batches where project_id=p_project order by created_at desc limit 20)b),'[]'::jsonb));
end $$;
revoke all on function public.schedule_v75_read(uuid) from public;
grant execute on function public.schedule_v75_read(uuid) to authenticated;
create or replace function public.schedule_v75_save(p_project uuid,p_revision bigint,p_tasks jsonb,p_links jsonb,p_baseline jsonb,p_closures jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_revision bigint; write_task record; write_link record; item jsonb;
begin
 if public.schedule_v4_allowed(p_project) is not true then raise exception 'Active project staff access required' using errcode='42501'; end if;
 if jsonb_typeof(p_closures) is distinct from 'array' or jsonb_array_length(p_closures)>500 then raise exception 'Invalid shutdown dates';end if;
 for item in select value from jsonb_array_elements(p_closures) loop if jsonb_typeof(item)<>'string' or (item#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' or (item#>>'{}')::date < date '1900-01-01' or (item#>>'{}')::date > date '2200-12-31' then raise exception 'Invalid shutdown date';end if;end loop;
 if jsonb_array_length(p_tasks)>2000 or jsonb_array_length(p_links)>5000 or octet_length(p_tasks::text)>2000000 then raise exception 'Schedule is too large';end if;
 insert into public.schedule_v4_state(project_id) values(p_project) on conflict do nothing;
 select revision into current_revision from public.schedule_v4_state where project_id=p_project for update;
 if p_revision is distinct from current_revision then raise exception 'Schedule changed in another session. Reload before saving; your draft has not been applied.' using errcode='40001'; end if;
 if jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_typeof(p_links) is distinct from 'array' then raise exception 'Invalid schedule data'; end if;
 if p_baseline is not null and p_baseline<>'null'::jsonb and (jsonb_typeof(p_baseline) is distinct from 'object' or jsonb_typeof(p_baseline->'dates') is distinct from 'object') then raise exception 'Invalid baseline'; end if;
 if exists(select 1 from jsonb_array_elements(p_tasks) x group by x->>'id' having count(*)>1) then raise exception 'Duplicate activity ID'; end if;
 if exists(select 1 from jsonb_array_elements(p_links) x group by x->>'predecessor_id',x->>'successor_id' having count(*)>1) then raise exception 'Duplicate dependency'; end if;
 if exists(select 1 from jsonb_array_elements(p_links) x group by x->>'id' having count(*)>1) then raise exception 'Duplicate link ID'; end if;
 -- Never allow an upsert to take over an ID belonging to another project.
 if exists(select 1 from public.schedule_tasks t join jsonb_array_elements(p_tasks) x on t.id=(x->>'id')::uuid where t.project_id<>p_project)
 or exists(select 1 from public.schedule_dependencies d join jsonb_array_elements(p_links) x on d.id=(x->>'id')::uuid where d.project_id<>p_project) then raise exception 'ID belongs to another project'; end if;
 for item in select value from jsonb_array_elements(p_tasks) loop
  if item->>'id' is null or nullif(trim(item->>'name'),'') is null or coalesce(item->>'item_type','') not in ('task','phase')
   or coalesce(item->>'status','') not in ('not_started','in_progress','complete','on_hold') or (item->>'start_date')::date is null
   or (item->>'duration_work_days')::integer is null or (item->>'duration_work_days')::integer not between 0 and 10000
   or (item->>'progress')::integer is null or (item->>'progress')::integer not between 0 and 100 then raise exception 'Invalid activity values'; end if;
  if item->>'item_type'='task' and not coalesce((item->>'is_milestone')::boolean,false) and (item->>'duration_work_days')::integer<1 then raise exception 'Activities need at least one work day'; end if;
  if item->>'parent_id' is not null and (item->>'item_type'='phase' or not exists(select 1 from jsonb_array_elements(p_tasks) parent where parent->>'id'=item->>'parent_id' and parent->>'item_type'='phase')) then raise exception 'Choose a valid phase'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_links) loop
  if item->>'id' is null or item->>'predecessor_id'=item->>'successor_id' or (item->>'lag_work_days')::integer is null or (item->>'lag_work_days')::integer not between -10000 and 10000 or coalesce(item->>'relation','FS') not in ('FS','SS') then raise exception 'Invalid dependency or lag'; end if;
  if not exists(select 1 from jsonb_array_elements(p_tasks) t where t->>'id'=item->>'predecessor_id' and t->>'item_type'='task') or not exists(select 1 from jsonb_array_elements(p_tasks) t where t->>'id'=item->>'successor_id' and t->>'item_type'='task') then raise exception 'Dependencies must connect activities in this project'; end if;
 end loop;
 if exists(with recursive edges as (select x->>'predecessor_id' a,x->>'successor_id' b from jsonb_array_elements(p_links) x), reach(a,b) as (select a,b from edges union select r.a,e.b from reach r join edges e on e.a=r.b) select 1 from reach where a=b) then raise exception 'Circular dependency: remove a link'; end if;
 delete from public.schedule_dependencies where project_id=p_project;
 -- Detach old parent references before phases are removed or reordered.
 update public.schedule_tasks set parent_id=null where project_id=p_project and parent_id is not null;
 delete from public.schedule_tasks where project_id=p_project and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_tasks) x);
 -- Insert phases first so parent foreign keys always resolve.
 for write_task in select * from jsonb_to_recordset(p_tasks) as x(id uuid,name text,trade text,start_date date,duration_work_days integer,progress integer,status text,is_milestone boolean,sort_order integer,notes text,item_type text,parent_id uuid,stage text,responsible_party text,waiting_on text,date_confidence text,customer_visible boolean) order by case when item_type='phase' then 0 else 1 end loop
  insert into public.schedule_tasks(id,project_id,name,trade,start_date,duration_work_days,progress,status,is_milestone,sort_order,notes,item_type,parent_id,created_by,stage,responsible_party,waiting_on,date_confidence,customer_visible)
  values(write_task.id,p_project,write_task.name,write_task.trade,write_task.start_date,write_task.duration_work_days,write_task.progress,write_task.status,coalesce(write_task.is_milestone,false),coalesce(write_task.sort_order,0),write_task.notes,write_task.item_type,write_task.parent_id,auth.uid(),coalesce(write_task.stage,'construction'),write_task.responsible_party,write_task.waiting_on,coalesce(write_task.date_confidence,'estimated'),coalesce(write_task.customer_visible,false))
  on conflict(id) do update set name=excluded.name,trade=excluded.trade,start_date=excluded.start_date,duration_work_days=excluded.duration_work_days,progress=excluded.progress,status=excluded.status,is_milestone=excluded.is_milestone,sort_order=excluded.sort_order,notes=excluded.notes,item_type=excluded.item_type,parent_id=excluded.parent_id,stage=excluded.stage,responsible_party=excluded.responsible_party,waiting_on=excluded.waiting_on,date_confidence=excluded.date_confidence,customer_visible=excluded.customer_visible;
 end loop;
 for write_link in select * from jsonb_to_recordset(p_links) as x(id uuid,predecessor_id uuid,successor_id uuid,lag_work_days integer,relation text) loop
  insert into public.schedule_dependencies(id,project_id,predecessor_id,successor_id,lag_work_days,relation) values(write_link.id,p_project,write_link.predecessor_id,write_link.successor_id,write_link.lag_work_days,coalesce(write_link.relation,'FS'));
 end loop;
 update public.schedule_v4_state set closures=p_closures,revision=revision+1,baseline=nullif(p_baseline,'null'::jsonb),updated_at=now() where project_id=p_project;
 return public.schedule_v75_read(p_project);
end $$;
revoke all on function public.schedule_v75_save(uuid,bigint,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.schedule_v75_save(uuid,bigint,jsonb,jsonb,jsonb,jsonb) to authenticated;


-- Reject old clients rather than silently dropping SS links or shutdown dates.
revoke execute on function public.schedule_v5_save(uuid,bigint,jsonb,jsonb,jsonb) from authenticated,anon,public;
do $$begin if to_regprocedure('public.schedule_v4_save(uuid,bigint,jsonb,jsonb,jsonb)') is not null then execute 'revoke execute on function public.schedule_v4_save(uuid,bigint,jsonb,jsonb,jsonb) from authenticated,anon,public';end if;end $$;
create or replace function public.schedule_v75_import(p_project uuid,p_revision bigint,p_tasks jsonb,p_links jsonb,p_closures jsonb,p_fingerprint text,p_metadata jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare snap jsonb;result jsonb;closed jsonb;
begin
 if public.schedule_v4_allowed(p_project) is not true then raise exception 'Project access required';end if;
 if p_fingerprint is null or p_fingerprint!~'^[a-zA-Z0-9-]{16,100}$' or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>40000 then raise exception 'Invalid import details';end if;
 insert into public.schedule_v4_state(project_id) values(p_project) on conflict do nothing;
 perform 1 from public.schedule_v4_state where project_id=p_project for update;
 if exists(select 1 from public.schedule_import_batches where project_id=p_project and fingerprint=p_fingerprint) then raise exception 'This draft/file was already imported into this project. Refresh the schedule.';end if;
 if jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks) not between 1 and 700 then raise exception 'Invalid import tasks';end if;
 snap:=public.schedule_v75_read(p_project);
 if exists(select 1 from jsonb_array_elements(p_tasks) a join jsonb_array_elements(snap->'tasks') b on a->>'id'=b->>'id') then raise exception 'Import must use new activity IDs';end if;
 select coalesce(jsonb_agg(v),'[]') into closed from (select distinct value v from jsonb_array_elements((snap->'closures')||p_closures))x;
 result:=public.schedule_v75_save(p_project,p_revision,(snap->'tasks')||p_tasks,(snap->'links')||p_links,snap->'baseline',closed);
 insert into public.schedule_import_batches(project_id,fingerprint,metadata,created_by) values(p_project,p_fingerprint,p_metadata,auth.uid());
 return public.schedule_v75_read(p_project);
end $$;
revoke all on function public.schedule_v75_import(uuid,bigint,jsonb,jsonb,jsonb,text,jsonb) from public;
grant execute on function public.schedule_v75_import(uuid,bigint,jsonb,jsonb,jsonb,text,jsonb) to authenticated;
create table if not exists public.schedule_ai_usage(actor uuid primary key references auth.users(id),day date not null,count integer not null,last_request timestamptz not null);
alter table public.schedule_ai_usage enable row level security;
revoke all on public.schedule_ai_usage from public,anon,authenticated;
create or replace function public.schedule_v75_ai_claim(p_project uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.schedule_ai_usage;
begin
 if public.schedule_v4_allowed(p_project) is not true then raise exception 'Project access required';end if;
 insert into public.schedule_ai_usage values(auth.uid(),current_date,0,'2000-01-01') on conflict do nothing;
 select * into u from public.schedule_ai_usage where actor=auth.uid() for update;
 if u.last_request>now()-interval '90 seconds' then raise exception 'Wait 90 seconds between AI requests';end if;
 if u.day=current_date and u.count>=20 then raise exception 'Daily AI generation limit reached (20 requests per user)';end if;
 update public.schedule_ai_usage set day=current_date,count=case when u.day=current_date then u.count+1 else 1 end,last_request=now() where actor=auth.uid();
end $$;
revoke all on function public.schedule_v75_ai_claim(uuid) from public;
grant execute on function public.schedule_v75_ai_claim(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

-- V7.6: allow signed dependency lead/lag in the legacy validation trigger.
CREATE OR REPLACE FUNCTION public.validate_schedule_dependency_v4()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 451));
  if new.lag_work_days is null or new.lag_work_days not between -10000 and 10000 then
    raise exception 'Lag must be between -10000 and 10000 work days';
  end if;
  if new.predecessor_id = new.successor_id then raise exception 'An activity cannot depend on itself'; end if;
  if not exists(select 1 from schedule_tasks where id=new.predecessor_id and project_id=new.project_id and item_type='task')
    or not exists(select 1 from schedule_tasks where id=new.successor_id and project_id=new.project_id and item_type='task') then
    raise exception 'Both activities must belong to this project; phases cannot have dependencies';
  end if;
  if exists (
    with recursive reachable(id) as (
      select new.successor_id
      union
      select d.successor_id from schedule_dependencies d join reachable r on d.predecessor_id=r.id
      where d.project_id=new.project_id and d.id<>new.id
    ) select 1 from reachable where id=new.predecessor_id
  ) then raise exception 'That link creates a circular dependency'; end if;
  return new;
end $function$;
NOTIFY pgrst, 'reload schema';

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

-- V7.8: private AI attachments and larger project-file revisions.
-- Run after V7.7. Storage global limits still depend on your Supabase plan.
begin;
alter table public.fd_revisions drop constraint if exists fd_revisions_bytes_check;
alter table public.fd_revisions add constraint fd_revisions_bytes_check check(bytes between 1 and 1073741824);
update storage.buckets set file_size_limit=1073741824,public=false where id='fielddocs-project-files';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fielddocs-ai-inputs','fielddocs-ai-inputs',false,41943040,array['application/pdf','text/plain'])
on conflict(id) do update set public=false,file_size_limit=41943040,allowed_mime_types=array['application/pdf','text/plain'];
create table if not exists public.fielddocs_ai_uploads(
 id uuid primary key, owner uuid not null references auth.users(id),
 project_id uuid references public.projects(id), kind text not null check(kind in ('budget','schedule')),
 filename text not null check(length(filename) between 1 and 180),
 bytes bigint not null check(bytes between 1 and 41943040), object_path text not null unique,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours'
);
create index if not exists fielddocs_ai_upload_expiry on public.fielddocs_ai_uploads(expires_at);
alter table public.fielddocs_ai_uploads enable row level security;
revoke all on public.fielddocs_ai_uploads from public,anon,authenticated;
grant all on public.fielddocs_ai_uploads to service_role;
-- No public bucket or browser table policies. Server verifies user and project
-- before issuing a short-lived, path-specific signed upload/download token.
notify pgrst,'reload schema';
commit;
