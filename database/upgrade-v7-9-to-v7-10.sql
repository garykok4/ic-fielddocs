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
