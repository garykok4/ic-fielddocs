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

-- V7.8.2: atomic, project-scoped schedule reset. Safe to run again.
begin;
create or replace function public.schedule_v782_clear(p_project uuid,p_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare snap jsonb;
begin
 if public.schedule_v4_allowed(p_project) is not true then
  raise exception 'Active project staff access required' using errcode='42501';
 end if;
 insert into public.schedule_v4_state(project_id) values(p_project) on conflict do nothing;
 perform 1 from public.schedule_v4_state where project_id=p_project for update;
 snap:=public.schedule_v75_read(p_project);
 -- Existing save validates the revision, deletes links before tasks and advances
 -- the revision. The entire reset rolls back if either step fails.
 perform public.schedule_v75_save(p_project,p_revision,'[]'::jsonb,'[]'::jsonb,null,snap->'closures');
 delete from public.schedule_import_batches where project_id=p_project;
 return public.schedule_v75_read(p_project);
end $$;
revoke all on function public.schedule_v782_clear(uuid,bigint) from public,anon;
grant execute on function public.schedule_v782_clear(uuid,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;

-- V7.9: administrator staff management. Run once; safe to rerun.
begin;
alter table public.staff_profiles add column if not exists admin_revision bigint not null default 0;
create table if not exists public.fielddocs_staff_audit(
 id bigint generated always as identity primary key,actor uuid references auth.users(id),
 staff_id uuid references auth.users(id),action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
alter table public.fielddocs_staff_audit enable row level security;
revoke all on public.fielddocs_staff_audit from public,anon,authenticated;
grant select,insert on public.fielddocs_staff_audit to service_role;
grant usage,select on sequence public.fielddocs_staff_audit_id_seq to service_role;
create or replace function public.fd_staff_revision() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin new.admin_revision:=old.admin_revision+1;return new;end $$;
drop trigger if exists fd_staff_revision on public.staff_profiles;
create trigger fd_staff_revision before update on public.staff_profiles for each row execute function public.fd_staff_revision();
create or replace function public.fd_staff_assignment_revision() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op<>'INSERT' then update public.staff_profiles set admin_revision=admin_revision where id=old.staff_id;end if;
 if tg_op<>'DELETE' and (tg_op='INSERT' or new.staff_id is distinct from old.staff_id) then update public.staff_profiles set admin_revision=admin_revision where id=new.staff_id;end if;
 return null;
end $$;
drop trigger if exists fd_staff_assignment_revision on public.project_staff;
create trigger fd_staff_assignment_revision after insert or update or delete on public.project_staff for each row execute function public.fd_staff_assignment_revision();
drop trigger if exists fd_staff_estimate_revision on public.fielddocs_estimating_access;
create trigger fd_staff_estimate_revision after insert or update or delete on public.fielddocs_estimating_access for each row execute function public.fd_staff_assignment_revision();
create or replace function public.fd_staff_list(p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.staff_profiles where id=p_actor and active=true and role='admin') then raise exception 'Administrator access required' using errcode='42501';end if;
 if (select count(*) from auth.users where email is not null)>5000 then raise exception 'Staff directory exceeds 5000 accounts; contact your administrator for pagination support';end if;
 return jsonb_build_object('actor',p_actor,'users',coalesce((select jsonb_agg(jsonb_build_object(
 'id',u.id,'email',u.email,'full_name',coalesce(s.full_name,''),'role',coalesce(s.role,'pm'),'active',coalesce(s.active,false),
 'has_profile',s.id is not null,'revision',coalesce(s.admin_revision,0),'confirmed',u.email_confirmed_at is not null,
 'last_sign_in_at',u.last_sign_in_at,'invited_at',u.invited_at,
 'projects',coalesce((select jsonb_agg(distinct project_id) from public.project_staff where staff_id=u.id),'[]'::jsonb),
 'estimating',exists(select 1 from public.fielddocs_estimating_access where staff_id=u.id)
 ) order by lower(u.email)) from auth.users u left join public.staff_profiles s on s.id=u.id where u.email is not null),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(jsonb_build_object('id',id,'project_name',project_name) order by project_name) from public.projects),'[]'::jsonb));
end $$;
create or replace function public.fd_staff_save(p_actor uuid,p_id uuid,p_revision bigint,p_name text,p_role text,p_active boolean,p_projects uuid[],p_estimating boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare rev bigint; mail text;
begin
 perform pg_advisory_xact_lock(790031);
 if not exists(select 1 from public.staff_profiles where id=p_actor and active=true and role='admin') then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_role is null or p_role not in ('admin','pm') or p_active is null or p_estimating is null or p_projects is null or cardinality(p_projects)>1000 then raise exception 'Invalid staff settings';end if;
 if p_id=p_actor and (not p_active or p_role<>'admin') then raise exception 'You cannot deactivate or demote your own administrator account';end if;
 select email into mail from auth.users where id=p_id;
 if mail is null then raise exception 'An email account is required';end if;
 select admin_revision into rev from public.staff_profiles where id=p_id for update;
 if p_revision is distinct from coalesce(rev,0) then raise exception 'Staff settings changed in another session. Reload before saving.' using errcode='40001';end if;
 if exists(select 1 from unnest(p_projects) x where x is null or not exists(select 1 from public.projects where id=x)) then raise exception 'Choose valid projects';end if;
 if exists(select 1 from public.staff_profiles where id=p_id and active=true and role='admin') and (not p_active or p_role<>'admin')
 and not exists(select 1 from public.staff_profiles where id<>p_id and active=true and role='admin') then raise exception 'Keep at least one active administrator';end if;
 insert into public.staff_profiles(id,full_name,email,role,active,admin_revision) values(p_id,trim(p_name),mail,p_role,p_active,1)
 on conflict(id) do update set full_name=excluded.full_name,email=excluded.email,role=excluded.role,active=excluded.active;
 delete from public.project_staff where staff_id=p_id and not(project_id=any(p_projects));
 insert into public.project_staff(project_id,staff_id,role) select distinct x,p_id,'pm' from unnest(p_projects) x
 where not exists(select 1 from public.project_staff where staff_id=p_id and project_id=x);
 if p_estimating then insert into public.fielddocs_estimating_access(staff_id,granted_by) values(p_id,p_actor) on conflict do nothing;
 else delete from public.fielddocs_estimating_access where staff_id=p_id;end if;
 insert into public.fielddocs_staff_audit(actor,staff_id,action,details) values(p_actor,p_id,'settings_saved',jsonb_build_object('role',p_role,'active',p_active,'projects',p_projects,'estimating',p_estimating));
 return jsonb_build_object('id',p_id,'revision',(select admin_revision from public.staff_profiles where id=p_id));
end $$;
revoke all on function public.fd_staff_list(uuid),public.fd_staff_save(uuid,uuid,bigint,text,text,boolean,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.fd_staff_list(uuid),public.fd_staff_save(uuid,uuid,bigint,text,text,boolean,uuid[],boolean) to service_role;
revoke all on function public.fd_staff_revision(),public.fd_staff_assignment_revision() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

begin;
create table if not exists public.fd_procurement_rules (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 activity_id uuid not null references public.schedule_tasks(id) on delete cascade,
 assignee_id uuid not null references public.staff_profiles(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200),
 months integer not null check(months between 0 and 36),
 created_by uuid references auth.users(id) on delete set null,
 trigger_date date not null, released boolean not null default false,
 task_id uuid references public.project_tasks(id) on delete set null
);
create unique index if not exists fd_procurement_unique on public.fd_procurement_rules(activity_id,lower(trim(title)));
alter table public.fd_procurement_rules enable row level security;
drop policy if exists fd_procurement_read on public.fd_procurement_rules;
create policy fd_procurement_read on public.fd_procurement_rules for select to authenticated using(public.schedule_v4_allowed(project_id));
revoke all on public.fd_procurement_rules from public,anon,authenticated;
grant select on public.fd_procurement_rules to authenticated,service_role;

-- Run inside the schedule writer's transaction or from the daily job. Serializing
-- against the schedule state also prevents a second worker releasing the same rule.
create or replace function public.fd_procurement_sync(p_project uuid,p_revision bigint,p_starts jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; due date; tid uuid; n int:=0;
begin
 perform 1 from public.schedule_v4_state where project_id=p_project and revision=p_revision for update;
 if not found then raise exception 'Schedule changed in another session. Reload the schedule.'; end if;
 for r in select q.*,a.name,a.status from public.fd_procurement_rules q join public.schedule_tasks a on a.id=q.activity_id and a.project_id=q.project_id where q.project_id=p_project for update of q loop
  if not (p_starts ? r.activity_id::text) then continue; end if;
  due:=((p_starts->>r.activity_id::text)::date-make_interval(months=>r.months))::date;
  update public.fd_procurement_rules set trigger_date=due where id=r.id and trigger_date<>due;
  if r.released then
   update public.project_tasks set due_date=due,revision=revision+1,updated_at=now() where id=r.task_id and project_id=p_project and status<>'done' and activity_id=r.activity_id and due_date is distinct from due;
  elsif due <= (now() at time zone 'America/Toronto')::date and r.status<>'complete' and exists(select 1 from public.staff_profiles s where s.id=r.assignee_id and s.active and (s.role='admin' or exists(select 1 from public.project_staff ps where ps.project_id=p_project and ps.staff_id=s.id))) then
   insert into public.project_tasks(project_id,title,description,assignee_id,due_date,activity_id,created_by)
   values(p_project,r.title,'Schedule reminder: '||r.name||'. Lead time: '||r.months||' calendar month(s).',r.assignee_id,due,r.activity_id,r.created_by) returning id into tid;
   update public.fd_procurement_rules set released=true,task_id=tid where id=r.id;
   n:=n+1;
  end if;
 end loop;
 return n;
end $$;
revoke all on function public.fd_procurement_sync(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.fd_procurement_sync(uuid,bigint,jsonb) to service_role;

create or replace function public.fd_procurement_add(p_project uuid,p_revision bigint,p_activity uuid,p_start date,p_title text,p_assignee uuid,p_months int)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if public.schedule_v4_allowed(p_project) is not true then raise exception 'Project access required'; end if;
 perform 1 from public.schedule_v4_state where project_id=p_project and revision=p_revision for update;
 if not found then raise exception 'Schedule changed. Reload before adding a reminder.';end if;
 if not exists(select 1 from public.schedule_tasks where project_id=p_project and id=p_activity and item_type='task' and status<>'complete') then raise exception 'Choose an unfinished activity';end if;
 if not exists(select 1 from public.fielddocs_project_team(p_project) s where s.id=p_assignee) then raise exception 'Choose a member of this project team';end if;
 insert into public.fd_procurement_rules(project_id,activity_id,assignee_id,title,months,created_by,trigger_date) values(p_project,p_activity,p_assignee,trim(p_title),p_months,auth.uid(),p_start);
 perform public.fd_procurement_sync(p_project,p_revision,jsonb_build_object(p_activity::text,p_start));
end $$;
create or replace function public.fd_procurement_remove(p_project uuid,p_rule uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if public.schedule_v4_allowed(p_project) is not true then raise exception 'Project access required';end if;
 delete from public.fd_procurement_rules where project_id=p_project and id=p_rule;
end $$;
revoke all on function public.fd_procurement_add(uuid,bigint,uuid,date,text,uuid,int),public.fd_procurement_remove(uuid,uuid) from public,anon;
grant execute on function public.fd_procurement_add(uuid,bigint,uuid,date,text,uuid,int),public.fd_procurement_remove(uuid,uuid) to authenticated;

create or replace function public.schedule_v710_save(p_project uuid,p_revision bigint,p_tasks jsonb,p_links jsonb,p_baseline jsonb,p_closures jsonb,p_starts jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s jsonb;begin
 s:=public.schedule_v75_save(p_project,p_revision,p_tasks,p_links,p_baseline,p_closures);
 perform public.fd_procurement_sync(p_project,(s->>'revision')::bigint,p_starts);
 return s;end $$;
create or replace function public.schedule_v710_import(p_project uuid,p_revision bigint,p_tasks jsonb,p_links jsonb,p_closures jsonb,p_fingerprint text,p_metadata jsonb,p_starts jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s jsonb;begin
 s:=public.schedule_v75_import(p_project,p_revision,p_tasks,p_links,p_closures,p_fingerprint,p_metadata);
 perform public.fd_procurement_sync(p_project,(s->>'revision')::bigint,p_starts);
 return s;end $$;
revoke all on function public.schedule_v710_save(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb),public.schedule_v710_import(uuid,bigint,jsonb,jsonb,jsonb,text,jsonb,jsonb) from public,anon;
grant execute on function public.schedule_v710_save(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb),public.schedule_v710_import(uuid,bigint,jsonb,jsonb,jsonb,text,jsonb,jsonb) to authenticated;

-- Date changes are committed atomically above. A daily catch-up releases due rules even
-- if nobody has the project open. Skip retired activities and staff who lost access.
create or replace function public.fd_procurement_tick() returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare p uuid;r record;tid uuid;n int:=0;begin
 for p in select distinct q.project_id from public.fd_procurement_rules q where not q.released and q.trigger_date<=(now() at time zone 'America/Toronto')::date order by q.project_id loop
 perform 1 from public.schedule_v4_state where project_id=p for update;
 for r in select q.*,a.name from public.fd_procurement_rules q join public.schedule_tasks a on a.id=q.activity_id and a.project_id=p and a.status<>'complete' join public.staff_profiles s on s.id=q.assignee_id and s.active where q.project_id=p and not q.released and q.trigger_date<=(now() at time zone 'America/Toronto')::date and (s.role='admin' or exists(select 1 from public.project_staff ps where ps.project_id=p and ps.staff_id=s.id)) for update of q loop
 insert into public.project_tasks(project_id,title,description,assignee_id,due_date,activity_id,created_by) values(p,r.title,'Schedule reminder: '||r.name||'. Lead time: '||r.months||' calendar month(s).',r.assignee_id,r.trigger_date,r.activity_id,r.created_by) returning id into tid;
 update public.fd_procurement_rules set released=true,task_id=tid where id=r.id;n:=n+1;
 end loop;end loop;return n;end $$;
revoke all on function public.fd_procurement_tick() from public,anon,authenticated;
grant execute on function public.fd_procurement_tick() to service_role;
notify pgrst,'reload schema';
commit;
