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

begin;
create table if not exists public.fd_weekly_briefs (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 week_start date not null, body text not null check(length(body) between 1 and 50000),
 schedule_revision bigint not null, updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null, unique(project_id,week_start)
);
alter table public.fd_weekly_briefs enable row level security;
revoke all on public.fd_weekly_briefs from anon,authenticated;
grant select on public.fd_weekly_briefs to authenticated;
drop policy if exists weekly_brief_read on public.fd_weekly_briefs;
create policy weekly_brief_read on public.fd_weekly_briefs for select to authenticated using(public.schedule_v4_allowed(project_id));
create or replace function public.fd_save_weekly_brief(p_project uuid,p_week date,p_revision bigint,p_body text) returns void language plpgsql security definer set search_path=public as $$
declare current_revision bigint;
begin
 if public.schedule_v4_allowed(p_project) is not true then raise exception 'Project access required'; end if;
 if p_week is null or extract(isodow from p_week)<>1 then raise exception 'Choose a Monday'; end if;
 if p_body is null or length(trim(p_body))=0 or length(p_body)>50000 then raise exception 'Enter a brief of 1–50000 characters'; end if;
 select revision into current_revision from public.schedule_v4_state where project_id=p_project for update;
 if current_revision is null or current_revision is distinct from p_revision then raise exception 'Schedule changed. Generate the brief again.'; end if;
 insert into public.fd_weekly_briefs(project_id,week_start,body,schedule_revision,created_by) values(p_project,p_week,p_body,p_revision,auth.uid())
 on conflict(project_id,week_start) do update set body=excluded.body,schedule_revision=excluded.schedule_revision,updated_at=now(),created_by=auth.uid();
end $$;
revoke all on function public.fd_save_weekly_brief(uuid,date,bigint,text) from public,anon;
grant execute on function public.fd_save_weekly_brief(uuid,date,bigint,text) to authenticated;
commit;


-- V7.12 orientation company groups
begin;
-- Administrative classification is separate from the worker's submitted record.
create table if not exists public.fd_orientation_companies (
 orientation_id uuid primary key references public.site_orientations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 company_label text not null check(length(trim(company_label)) between 1 and 150),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null
);
alter table public.fd_orientation_companies enable row level security;
revoke all on public.fd_orientation_companies from public,anon,authenticated;
grant select on public.fd_orientation_companies to authenticated;
drop policy if exists fd_orientation_companies_read on public.fd_orientation_companies;
create policy fd_orientation_companies_read on public.fd_orientation_companies for select to authenticated using(public.schedule_v4_allowed(project_id));
create or replace function public.fd_orientation_read(p_after uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.staff_profiles where id=auth.uid() and active=true) then raise exception 'Active staff access required';end if;
 return coalesce((select jsonb_agg(r.obj order by r.id) from (
 select o.id, jsonb_build_object('id',o.id,'project_id',o.project_id,'worker_name',o.worker_name,'company_name',o.company_name,'phone',o.phone,'completed_at',o.completed_at,
 'project_name',p.project_name,'company_label',g.company_label,
 'acknowledged_site_rules',o.acknowledged_site_rules,'acknowledged_ppe',o.acknowledged_ppe,
 'acknowledged_emergency',o.acknowledged_emergency,'acknowledged_reporting',o.acknowledged_reporting,
 'acknowledged_daily_sign_in',o.acknowledged_daily_sign_in) obj
 from public.site_orientations o join public.projects p on p.id=o.project_id
 left join public.fd_orientation_companies g on g.orientation_id=o.id and g.project_id=o.project_id
 where public.schedule_v4_allowed(o.project_id) and (p_after is null or o.id>p_after)
 order by o.id limit 500
 ) r),'[]'::jsonb);
end $$;
create or replace function public.fd_orientation_group(p_ids uuid[],p_label text) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer; expected integer; label text;
begin
 if not exists(select 1 from public.staff_profiles where id=auth.uid() and active=true) then raise exception 'Active staff access required';end if;
 if p_ids is null or cardinality(p_ids)=0 or cardinality(p_ids)>5000 or array_position(p_ids,null) is not null then raise exception 'Select between 1 and 5000 records';end if;
 label:=nullif(trim(p_label),'');
 if length(label)>150 then raise exception 'Company names may contain up to 150 characters';end if;
 select count(distinct x) into expected from unnest(p_ids) x;
 select count(*) into n from public.site_orientations where id=any(p_ids) and public.schedule_v4_allowed(project_id);
 if n<>expected then raise exception 'One or more records are missing or outside your assigned projects';end if;
 perform 1 from public.site_orientations where id=any(p_ids) order by id for update;
 select count(*) into n from public.site_orientations where id=any(p_ids) and public.schedule_v4_allowed(project_id);
 if n<>expected then raise exception 'Record access changed. Refresh and retry.';end if;
 if label is null then delete from public.fd_orientation_companies where orientation_id=any(p_ids);
 else insert into public.fd_orientation_companies(orientation_id,project_id,company_label,updated_by)
 select id,project_id,label,auth.uid() from public.site_orientations where id=any(p_ids)
 on conflict(orientation_id) do update set company_label=excluded.company_label,project_id=excluded.project_id,updated_by=auth.uid(),updated_at=now();end if;
 return n;
end $$;
revoke all on function public.fd_orientation_read(uuid) from public,anon;
revoke all on function public.fd_orientation_group(uuid[],text) from public,anon;
grant execute on function public.fd_orientation_read(uuid) to authenticated;
grant execute on function public.fd_orientation_group(uuid[],text) to authenticated;
commit;


-- Field Docs V7.13: private project photo workspace. Run after V7.12. Repeat-safe.
begin;
create table if not exists public.fd_photos (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 caption text not null default '' check(length(caption)<=1000), album text not null default '' check(length(album)<=100),
 location text not null default '' check(length(location)<=160), tags text[] not null default '{}',
 taken_on date not null default current_date, created_at timestamptz not null default now(),
 uploaded_by uuid not null, uploader_name text not null, original_asset uuid, display_asset uuid,
 ready boolean not null default false, archived boolean not null default false, customer_visible boolean not null default false,
 version integer not null default 0
);
create table if not exists public.fd_photo_assets (
 id uuid primary key default gen_random_uuid(), photo_id uuid not null references public.fd_photos(id),
 object_path text not null unique, filename text not null, mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
 bytes bigint not null check(bytes between 1 and 1073741824), kind text not null check(kind in ('original','markup')),
 ready boolean not null default false, created_at timestamptz not null default now(), created_by uuid not null,
 base_version integer not null default 0, unique(photo_id,id)
);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='fd_photo_original_fk') then
 alter table public.fd_photos add constraint fd_photo_original_fk foreign key(id,original_asset) references public.fd_photo_assets(photo_id,id);
 alter table public.fd_photos add constraint fd_photo_display_fk foreign key(id,display_asset) references public.fd_photo_assets(photo_id,id);
 end if;
end $$;
create table if not exists public.fd_photo_report_links (
 report_id uuid not null references public.daily_reports(id) on delete cascade,
 photo_id uuid not null references public.fd_photos(id), asset_id uuid not null,
 caption text not null, primary key(report_id,photo_id), foreign key(photo_id,asset_id) references public.fd_photo_assets(photo_id,id)
);
create table if not exists public.fd_photo_shares (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 token_hash text not null unique, title text not null, pin_hash text, items jsonb not null,
 expires_at timestamptz not null, revoked boolean not null default false, created_at timestamptz not null default now(), created_by uuid not null
);
create table if not exists public.fd_photo_audit (
 id bigint generated always as identity primary key, project_id uuid not null references public.projects(id),
 photo_id uuid references public.fd_photos(id), actor_id uuid not null, action text not null, created_at timestamptz not null default now()
);
create index if not exists fd_photos_feed on public.fd_photos(project_id,taken_on desc,id);
create index if not exists fd_photo_shares_project on public.fd_photo_shares(project_id,created_at desc);
alter table public.fd_photos enable row level security;
alter table public.fd_photo_assets enable row level security;
alter table public.fd_photo_report_links enable row level security;
alter table public.fd_photo_shares enable row level security;
alter table public.fd_photo_audit enable row level security;
revoke all on public.fd_photos,public.fd_photo_assets,public.fd_photo_report_links,public.fd_photo_shares,public.fd_photo_audit from public,anon,authenticated;
grant all on public.fd_photos,public.fd_photo_assets,public.fd_photo_report_links,public.fd_photo_shares,public.fd_photo_audit to service_role;
grant usage,select on sequence public.fd_photo_audit_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fielddocs-photos','fielddocs-photos',false,1073741824,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=1073741824,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists fd_photos_private_guard on storage.objects;
create policy fd_photos_private_guard on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'fielddocs-photos') with check(bucket_id<>'fielddocs-photos');
-- All mutation RPCs check active project access and lock rows. Callable by server only.
create or replace function public.fd_photo_change(p_id uuid,p_actor uuid,p_version integer,p_changes jsonb)
returns public.fd_photos language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.fd_photos; result public.fd_photos;
begin
 select * into p from public.fd_photos where id=p_id for update;
 if p.id is null or not public.fd_file_allowed(p.project_id,p_actor) then raise exception 'Project access required'; end if;
 if p.version<>p_version then raise exception 'Photo changed. Refresh before saving.'; end if;
 update public.fd_photos set caption=coalesce(p_changes->>'caption',caption),album=coalesce(p_changes->>'album',album),
 location=coalesce(p_changes->>'location',location),taken_on=coalesce((p_changes->>'taken_on')::date,taken_on),
 tags=case when p_changes ? 'tags' then array(select jsonb_array_elements_text(p_changes->'tags')) else tags end,
 customer_visible=coalesce((p_changes->>'customer_visible')::boolean,customer_visible),
 archived=coalesce((p_changes->>'archived')::boolean,archived),version=version+1 where id=p_id returning * into result;
 insert into public.fd_photo_audit(project_id,photo_id,actor_id,action) values(p.project_id,p_id,p_actor,'Photo details updated: '||p_changes::text);
 return result;
end $$;
create or replace function public.fd_photo_finish(p_asset uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.fd_photo_assets; p public.fd_photos;
begin
 select * into a from public.fd_photo_assets where id=p_asset;
 select * into p from public.fd_photos where id=a.photo_id for update;
 if p.id is null or not public.fd_file_allowed(p.project_id,p_actor) then raise exception 'Project access required'; end if;
 if a.ready then return; end if;
 if p.archived or (a.kind='markup' and p.version<>a.base_version) then raise exception 'Photo changed. Refresh and retry markup.'; end if;
 if a.kind='original' and p.original_asset is not null then raise exception 'Original already saved'; end if;
 update public.fd_photo_assets set ready=true where id=p_asset;
 update public.fd_photos set original_asset=case when a.kind='original' then a.id else original_asset end,
 display_asset=a.id,ready=true,version=version+1 where id=p.id;
 insert into public.fd_photo_audit(project_id,photo_id,actor_id,action) values(p.project_id,p.id,p_actor,'Saved '||a.kind);
end $$;
create or replace function public.fd_photo_link_report(p_report uuid,p_ids uuid[],p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare pid uuid;
begin
 select project_id into pid from public.daily_reports where id=p_report for update;
 if pid is null or not public.fd_file_allowed(pid,p_actor) then raise exception 'Report access required'; end if;
 if cardinality(p_ids)>100 then raise exception 'Select at most 100 photos'; end if;
 if exists(select 1 from unnest(p_ids) u where not exists(select 1 from public.fd_photos p where p.id=u and p.project_id=pid and p.ready and not p.archived)) then raise exception 'All photos must belong to this report project'; end if;
 insert into public.fd_photo_report_links(report_id,photo_id,asset_id,caption)
 select p_report,id,display_asset,caption from public.fd_photos where id=any(p_ids)
 on conflict(report_id,photo_id) do nothing;
 insert into public.fd_photo_audit(project_id,actor_id,action) values(pid,p_actor,'Added photo selection to daily report '||p_report);
end $$;
revoke all on function public.fd_photo_change(uuid,uuid,integer,jsonb),public.fd_photo_finish(uuid,uuid),public.fd_photo_link_report(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.fd_photo_change(uuid,uuid,integer,jsonb),public.fd_photo_finish(uuid,uuid),public.fd_photo_link_report(uuid,uuid[],uuid) to service_role;
notify pgrst,'reload schema';
commit;

begin;
create table if not exists public.fd_photo_task_links (
 task_id uuid not null references public.project_tasks(id) on delete cascade,
 photo_id uuid not null references public.fd_photos(id), primary key(task_id,photo_id)
);
alter table public.fd_photo_task_links enable row level security;
revoke all on public.fd_photo_task_links from public,anon,authenticated;
grant all on public.fd_photo_task_links to service_role;
create or replace function public.fd_photo_task(p_photo uuid,p_task jsonb)
returns public.project_tasks language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.fd_photos; t public.project_tasks; tid uuid:=(p_task->>'id')::uuid;
begin
 select * into p from public.fd_photos where id=p_photo;
 if p.id is null or not p.ready or p.archived or not public.fd_file_allowed(p.project_id,auth.uid()) then raise exception 'Photo access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tid::text,713));
 select * into t from public.project_tasks where id=tid;
 if found then
  if t.created_by=auth.uid() and exists(select 1 from public.fd_photo_task_links where task_id=tid and photo_id=p_photo) then return t; end if;
  raise exception 'Task identifier already exists';
 end if;
 t:=public.fielddocs_task_save(p_task||jsonb_build_object('project_id',p.project_id,'activity_id',null),null);
 insert into public.fd_photo_task_links(task_id,photo_id) values(t.id,p.id);
 return t;
end $$;
revoke all on function public.fd_photo_task(uuid,jsonb) from public,anon;
grant execute on function public.fd_photo_task(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
