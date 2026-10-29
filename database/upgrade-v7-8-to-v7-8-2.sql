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
