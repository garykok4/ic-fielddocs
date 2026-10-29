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
