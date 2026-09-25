-- Field Docs V5. Requires the installed expanded V4 migration.
-- Additive and transactional. Run in Supabase SQL Editor before installing V5.
begin;
do $$ begin
 if to_regprocedure('public.schedule_v4_read(uuid)') is null then raise exception 'Install expanded V4 SQL first'; end if;
end $$;
alter table public.schedule_tasks
 add column if not exists stage text not null default 'construction' check(stage in ('construction','preconstruction')),
 add column if not exists responsible_party text,
 add column if not exists waiting_on text,
 add column if not exists date_confidence text not null default 'estimated' check(date_confidence in ('estimated','confirmed')),
 add column if not exists customer_visible boolean not null default false;
create or replace function public.schedule_v5_save(p_project uuid,p_revision bigint,p_tasks jsonb,p_links jsonb,p_baseline jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_revision bigint; write_task record; write_link record; item jsonb;
begin
 if not public.schedule_v4_allowed(p_project) then raise exception 'Active project staff access required' using errcode='42501'; end if;
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
  if item->>'id' is null or item->>'predecessor_id'=item->>'successor_id' or (item->>'lag_work_days')::integer is null or (item->>'lag_work_days')::integer not between 0 and 10000 then raise exception 'Invalid dependency or lag'; end if;
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
 for write_link in select * from jsonb_to_recordset(p_links) as x(id uuid,predecessor_id uuid,successor_id uuid,lag_work_days integer) loop
  insert into public.schedule_dependencies(id,project_id,predecessor_id,successor_id,lag_work_days) values(write_link.id,p_project,write_link.predecessor_id,write_link.successor_id,write_link.lag_work_days);
 end loop;
 update public.schedule_v4_state set revision=revision+1,baseline=nullif(p_baseline,'null'::jsonb),updated_at=now() where project_id=p_project;
 return public.schedule_v4_read(p_project);
end $$;
revoke all on function public.schedule_v5_save(uuid,bigint,jsonb,jsonb,jsonb) from public;
grant execute on function public.schedule_v5_save(uuid,bigint,jsonb,jsonb,jsonb) to authenticated;

-- Directory is scoped to the project; no company-wide staff enumeration by PMs.
create or replace function public.fielddocs_project_team(p_project uuid)
returns table(id uuid,full_name text,email text,role text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not public.schedule_v4_allowed(p_project) then raise exception 'Project access required' using errcode='42501'; end if;
 return query select s.id,s.full_name::text,s.email::text,s.role::text from public.staff_profiles s
 where s.active=true and (s.role='admin' or exists(select 1 from public.project_staff ps where ps.staff_id=s.id and ps.project_id=p_project)) order by s.full_name;
end $$;
revoke all on function public.fielddocs_project_team(uuid) from public;
grant execute on function public.fielddocs_project_team(uuid) to authenticated;

create table if not exists public.project_tasks (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 250),
 description text not null default '' check(length(description)<=10000),
 assignee_id uuid references public.staff_profiles(id) on delete set null,
 due_date date,
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 status text not null default 'todo' check(status in ('todo','in_progress','blocked','done')),
 activity_id uuid references public.schedule_tasks(id) on delete set null,
 revision bigint not null default 0,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz
);
create index if not exists project_tasks_project on public.project_tasks(project_id);
create index if not exists project_tasks_assignee_due on public.project_tasks(assignee_id,due_date) where status<>'done';
alter table public.project_tasks enable row level security;
drop policy if exists project_tasks_read on public.project_tasks;
create policy project_tasks_read on public.project_tasks for select to authenticated using(public.schedule_v4_allowed(project_id));
revoke all on public.project_tasks from anon,authenticated;
grant select on public.project_tasks to authenticated;

create table if not exists public.task_comments (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.project_tasks(id) on delete cascade,
 author_id uuid references public.staff_profiles(id) on delete set null,
 author_name text not null,
 body text not null check(length(trim(body)) between 1 and 5000),
 created_at timestamptz not null default now()
);
alter table public.task_comments enable row level security;
drop policy if exists task_comments_read on public.task_comments;
create policy task_comments_read on public.task_comments for select to authenticated using(exists(select 1 from public.project_tasks t where t.id=task_id and public.schedule_v4_allowed(t.project_id)));
revoke all on public.task_comments from anon,authenticated;
grant select on public.task_comments to authenticated;

create or replace function public.fielddocs_task_save(p_task jsonb,p_revision bigint default null)
returns public.project_tasks language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.project_tasks; result public.project_tasks; pid uuid:=(p_task->>'project_id')::uuid; tid uuid:=coalesce((p_task->>'id')::uuid,gen_random_uuid()); aid uuid:=nullif(p_task->>'assignee_id','')::uuid; sid uuid:=nullif(p_task->>'activity_id','')::uuid;
begin
 if not public.schedule_v4_allowed(pid) then raise exception 'Project access required' using errcode='42501'; end if;
 select * into old from public.project_tasks where id=tid for update;
 if found then
  if old.project_id<>pid then raise exception 'Task belongs to another project'; end if;
  if p_revision is distinct from old.revision then raise exception 'Task changed in another session. Close and reload before saving.' using errcode='40001'; end if;
 elsif p_revision is not null then raise exception 'Task no longer exists. Reload.'; end if;
 if aid is not null and not exists(select 1 from public.staff_profiles s where s.id=aid and s.active=true and (s.role='admin' or exists(select 1 from public.project_staff ps where ps.project_id=pid and ps.staff_id=s.id))) then raise exception 'Assignee must be active project staff'; end if;
 if sid is not null and not exists(select 1 from public.schedule_tasks where id=sid and project_id=pid and item_type='task') then raise exception 'Choose an activity in this project'; end if;
 if old.id is null then
  insert into public.project_tasks(id,project_id,title,description,assignee_id,due_date,priority,status,activity_id,created_by,completed_at)
  values(tid,pid,trim(p_task->>'title'),coalesce(p_task->>'description',''),aid,nullif(p_task->>'due_date','')::date,coalesce(p_task->>'priority','normal'),coalesce(p_task->>'status','todo'),sid,auth.uid(),case when p_task->>'status'='done' then now() end) returning * into result;
 else
  update public.project_tasks set title=trim(p_task->>'title'),description=coalesce(p_task->>'description',''),assignee_id=aid,due_date=nullif(p_task->>'due_date','')::date,priority=coalesce(p_task->>'priority','normal'),status=coalesce(p_task->>'status','todo'),activity_id=sid,revision=revision+1,updated_at=now(),completed_at=case when p_task->>'status'='done' then coalesce(old.completed_at,now()) end where id=tid returning * into result;
 end if;
 return result;
end $$;
revoke all on function public.fielddocs_task_save(jsonb,bigint) from public;
grant execute on function public.fielddocs_task_save(jsonb,bigint) to authenticated;
create or replace function public.fielddocs_task_delete(p_id uuid,p_revision bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t public.project_tasks;
begin
 select * into t from public.project_tasks where id=p_id for update;
 if not found or not public.schedule_v4_allowed(t.project_id) then raise exception 'Task access required'; end if;
 if t.revision is distinct from p_revision then raise exception 'Task changed. Reload before deleting.'; end if;
 delete from public.project_tasks where id=p_id;
end $$;
revoke all on function public.fielddocs_task_delete(uuid,bigint) from public;
grant execute on function public.fielddocs_task_delete(uuid,bigint) to authenticated;
create or replace function public.fielddocs_task_comment(p_task uuid,p_body text)
returns public.task_comments language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.task_comments;
begin
 if not exists(select 1 from public.project_tasks t where t.id=p_task and public.schedule_v4_allowed(t.project_id)) then raise exception 'Task access required'; end if;
 insert into public.task_comments(task_id,author_id,author_name,body) select p_task,s.id,coalesce(s.full_name,'Team member'),trim(p_body) from public.staff_profiles s where s.id=auth.uid() returning * into r;
 return r;
end $$;
revoke all on function public.fielddocs_task_comment(uuid,text) from public;
grant execute on function public.fielddocs_task_comment(uuid,text) to authenticated;

-- These preferences now control event recipients. Each staff member edits only their own.
create table if not exists public.project_notification_preferences (
 project_id uuid not null references public.projects(id) on delete cascade,
 staff_id uuid not null references public.staff_profiles(id) on delete cascade,
 notify_orientations boolean not null default false,
 notify_sign_ins boolean not null default false,
 notify_visitors boolean not null default false,
 primary key(project_id,staff_id)
);
alter table public.project_notification_preferences enable row level security;
do $$ declare p record; begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='project_notification_preferences' loop execute format('drop policy %I on public.project_notification_preferences',p.policyname); end loop;
end $$;
create policy fielddocs_preferences_read on public.project_notification_preferences for select to authenticated using(staff_id=auth.uid() and public.schedule_v4_allowed(project_id));
create policy fielddocs_preferences_insert on public.project_notification_preferences for insert to authenticated with check(staff_id=auth.uid() and public.schedule_v4_allowed(project_id));
create policy fielddocs_preferences_update on public.project_notification_preferences for update to authenticated using(staff_id=auth.uid() and public.schedule_v4_allowed(project_id)) with check(staff_id=auth.uid() and public.schedule_v4_allowed(project_id));
revoke all on public.project_notification_preferences from anon,authenticated;
grant select,insert,update on public.project_notification_preferences to authenticated;
grant all on public.project_notification_preferences to service_role;

-- Email is event-based. This queue is inaccessible to browser clients.
create table if not exists public.fielddocs_email_queue (
 id uuid primary key default gen_random_uuid(),
 event_key text unique not null,
 project_id uuid references public.projects(id) on delete cascade,
 kind text not null,
 recipient_id uuid references public.staff_profiles(id) on delete cascade,
 payload jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','sending','sent','skipped','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 sent_at timestamptz,
 last_error text,
 created_at timestamptz not null default now()
);
alter table public.fielddocs_email_queue enable row level security;
revoke all on public.fielddocs_email_queue from public,anon,authenticated;
grant all on public.fielddocs_email_queue to service_role;
create index if not exists fielddocs_email_pending on public.fielddocs_email_queue(status,available_at);

create table if not exists public.fielddocs_email_deliveries (
 id text primary key,
 event_id uuid not null references public.fielddocs_email_queue(id) on delete cascade,
 email text not null,
 message jsonb not null,
 attempted_at timestamptz,
 sent_at timestamptz,
 provider_id text
);
alter table public.fielddocs_email_deliveries enable row level security;
revoke all on public.fielddocs_email_deliveries from public,anon,authenticated;
grant all on public.fielddocs_email_deliveries to service_role;

create or replace function public.fielddocs_queue_assignment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.assignee_id is not null and new.status<>'done' and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id) then
 insert into public.fielddocs_email_queue(event_key,project_id,kind,recipient_id,payload)
 values('assignment:'||new.id||':'||new.revision,new.project_id,'assignment',new.assignee_id,jsonb_build_object('task_id',new.id)) on conflict(event_key) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.fielddocs_queue_assignment() from public;
drop trigger if exists fielddocs_task_assignment on public.project_tasks;
create trigger fielddocs_task_assignment after insert or update on public.project_tasks for each row execute function public.fielddocs_queue_assignment();

create or replace function public.fielddocs_queue_site_event()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.fielddocs_email_queue(event_key,project_id,kind,payload)
 values(tg_table_name||':'||(to_jsonb(new)->>'id'),new.project_id,tg_table_name,jsonb_build_object('record_id',to_jsonb(new)->>'id')) on conflict(event_key) do nothing;
 return new;
end $$;
revoke all on function public.fielddocs_queue_site_event() from public;
do $$ declare tab text; begin
 foreach tab in array array['site_orientations','trade_sign_ins','visitor_sign_ins'] loop
 if to_regclass('public.'||tab) is null then raise exception 'Missing existing form table: %',tab; end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=tab and column_name='id' and data_type='uuid') then raise exception 'V5 expects a UUID id on %. Check schema before installing.',tab; end if;
 execute format('drop trigger if exists fielddocs_site_event on public.%I',tab);
 execute format('create trigger fielddocs_site_event after insert on public.%I for each row execute function public.fielddocs_queue_site_event()',tab);
 end loop;
end $$;

create or replace function public.fielddocs_enqueue_digest()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date:=(now() at time zone 'America/Toronto')::date; n integer;
begin
 if extract(isodow from d)>5 then return 0; end if;
 insert into public.fielddocs_email_queue(event_key,kind,recipient_id,payload)
 select 'digest:'||s.id||':'||d,'digest',s.id,jsonb_build_object('date',d)
 from public.staff_profiles s where s.active=true and exists(select 1 from public.project_tasks t where t.assignee_id=s.id and t.status<>'done' and t.due_date<=d+7 and (s.role='admin' or exists(select 1 from public.project_staff ps where ps.project_id=t.project_id and ps.staff_id=s.id)))
 on conflict(event_key) do nothing;
 get diagnostics n=row_count; return n;
end $$;
revoke all on function public.fielddocs_enqueue_digest() from public,anon,authenticated;
grant execute on function public.fielddocs_enqueue_digest() to service_role;

create or replace function public.fielddocs_claim_email(p_event text default null,p_actor uuid default null,p_limit integer default 10)
returns setof public.fielddocs_email_queue language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 return query with candidates as (
 select q.id from public.fielddocs_email_queue q where
 (q.status='pending' or (q.status='sending' and q.lease_until<now())) and q.available_at<=now() and q.attempts<5
 and (p_event is null or q.event_key=p_event)
 and (p_actor is null or exists(select 1 from public.staff_profiles s where s.id=p_actor and s.active=true and (s.role='admin' or q.recipient_id=s.id or exists(select 1 from public.project_staff ps where ps.staff_id=s.id and ps.project_id=q.project_id))))
 order by q.created_at for update skip locked limit greatest(1,least(p_limit,25))
 ) update public.fielddocs_email_queue q set status='sending',attempts=q.attempts+1,lease_until=now()+interval '10 minutes' from candidates c where q.id=c.id returning q.*;
end $$;
revoke all on function public.fielddocs_claim_email(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.fielddocs_claim_email(text,uuid,integer) to service_role;
commit;
notify pgrst,'reload schema';
