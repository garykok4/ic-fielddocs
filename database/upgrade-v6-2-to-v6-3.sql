-- V6.3: optional-project tasks. Run after V5/V6 migrations. Safe to rerun.
begin;
alter table public.project_tasks alter column project_id drop not null;
create or replace function public.fielddocs_task_allowed(p_project uuid,p_creator uuid,p_assignee uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.staff_profiles s where s.id=auth.uid() and s.active=true and
 (case when p_project is null then s.role='admin' or s.id=p_creator or s.id=p_assignee else public.schedule_v4_allowed(p_project) end));
$$;
revoke all on function public.fielddocs_task_allowed(uuid,uuid,uuid) from public;
grant execute on function public.fielddocs_task_allowed(uuid,uuid,uuid) to authenticated;
drop policy if exists project_tasks_read on public.project_tasks;
create policy project_tasks_read on public.project_tasks for select to authenticated using(public.fielddocs_task_allowed(project_id,created_by,assignee_id));
drop policy if exists task_comments_read on public.task_comments;
create policy task_comments_read on public.task_comments for select to authenticated using(exists(select 1 from public.project_tasks t where t.id=task_id and public.fielddocs_task_allowed(t.project_id,t.created_by,t.assignee_id)));
-- Active staff names for general-task assignment; email addresses are not exposed.
create or replace function public.fielddocs_general_task_team()
returns table(id uuid,full_name text,email text,role text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.staff_profiles s where s.id=auth.uid() and s.active=true) then raise exception 'Active staff required'; end if;
 return query select s.id,s.full_name::text,''::text,s.role::text from public.staff_profiles s where s.active=true order by s.full_name;
end $$;
revoke all on function public.fielddocs_general_task_team() from public;
grant execute on function public.fielddocs_general_task_team() to authenticated;
create or replace function public.fielddocs_task_save(p_task jsonb,p_revision bigint default null)
returns public.project_tasks language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.project_tasks; result public.project_tasks; pid uuid:=nullif(p_task->>'project_id','')::uuid; tid uuid:=coalesce((p_task->>'id')::uuid,gen_random_uuid()); aid uuid:=nullif(p_task->>'assignee_id','')::uuid; sid uuid:=nullif(p_task->>'activity_id','')::uuid;
begin
 if not public.fielddocs_task_allowed(pid,auth.uid(),auth.uid()) then raise exception 'Project access required' using errcode='42501'; end if;
 select * into old from public.project_tasks where id=tid for update;
 if found then
  if not public.fielddocs_task_allowed(old.project_id,old.created_by,old.assignee_id) then raise exception 'Task access required'; end if;
  if old.project_id is distinct from pid then raise exception 'Task belongs to another project'; end if;
  if p_revision is distinct from old.revision then raise exception 'Task changed in another session. Close and reload before saving.' using errcode='40001'; end if;
 elsif p_revision is not null then raise exception 'Task no longer exists. Reload.'; end if;
 if aid is not null and not exists(select 1 from public.staff_profiles s where s.id=aid and s.active=true and (pid is null or s.role='admin' or exists(select 1 from public.project_staff ps where ps.project_id=pid and ps.staff_id=s.id))) then raise exception 'Assignee must be active project staff'; end if;
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
 if not found or not public.fielddocs_task_allowed(t.project_id,t.created_by,t.assignee_id) then raise exception 'Task access required'; end if;
 if t.revision is distinct from p_revision then raise exception 'Task changed. Reload before deleting.'; end if;
 delete from public.project_tasks where id=p_id;
end $$;
revoke all on function public.fielddocs_task_delete(uuid,bigint) from public;
grant execute on function public.fielddocs_task_delete(uuid,bigint) to authenticated;
create or replace function public.fielddocs_task_comment(p_task uuid,p_body text)
returns public.task_comments language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.task_comments;
begin
 if not exists(select 1 from public.project_tasks t where t.id=p_task and public.fielddocs_task_allowed(t.project_id,t.created_by,t.assignee_id)) then raise exception 'Task access required'; end if;
 insert into public.task_comments(task_id,author_id,author_name,body) select p_task,s.id,coalesce(s.full_name,'Team member'),trim(p_body) from public.staff_profiles s where s.id=auth.uid() returning * into r;
 return r;
end $$;
revoke all on function public.fielddocs_task_comment(uuid,text) from public;
grant execute on function public.fielddocs_task_comment(uuid,text) to authenticated;

-- These preferences now control event recipients. Each staff member edits only their own.
create or replace function public.fielddocs_enqueue_digest()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date:=(now() at time zone 'America/Toronto')::date; n integer;
begin
 if extract(isodow from d)>5 then return 0; end if;
 insert into public.fielddocs_email_queue(event_key,kind,recipient_id,payload)
 select 'digest:'||s.id||':'||d,'digest',s.id,jsonb_build_object('date',d)
 from public.staff_profiles s where s.active=true and exists(select 1 from public.project_tasks t where t.assignee_id=s.id and t.status<>'done' and t.due_date<=d+7 and (t.project_id is null or s.role='admin' or exists(select 1 from public.project_staff ps where ps.project_id=t.project_id and ps.staff_id=s.id)))
 on conflict(event_key) do nothing;
 get diagnostics n=row_count; return n;
end $$;
revoke all on function public.fielddocs_enqueue_digest() from public,anon,authenticated;
grant execute on function public.fielddocs_enqueue_digest() to service_role;


notify pgrst, 'reload schema';
commit;
