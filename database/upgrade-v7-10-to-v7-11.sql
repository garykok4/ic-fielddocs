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
