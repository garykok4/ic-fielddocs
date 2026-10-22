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
