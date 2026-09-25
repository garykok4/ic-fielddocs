-- Field Docs V6. Run once in the Supabase SQL editor after V5.
-- All file tables are service-only. Every API operation checks active staff + project membership.
begin;
create table if not exists public.fd_documents (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 number text not null check(length(number) between 1 and 80), title text not null check(length(title) between 1 and 200),
 discipline text not null check(length(discipline) between 1 and 80), kind text not null check(length(kind) between 1 and 80),
 folder text not null default '' check(length(folder)<=120), current_revision uuid,
 publisher_name text, published_at timestamptz, version integer not null default 0, created_at timestamptz not null default now(),
 unique(project_id,number)
);
create table if not exists public.fd_revisions (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.fd_documents(id),
 label text not null check(length(label) between 1 and 40), issue_date date not null,
 issue_status text not null check(issue_status in ('For Review','For Tender','Issued for Construction','As Built','For Information')),
 filename text not null, object_path text not null unique, bytes bigint not null check(bytes between 1 and 52428800),
 mime text not null, uploaded_by uuid not null, uploader_name text not null,
 uploaded_at timestamptz not null default now(), ready boolean not null default false, ever_published boolean not null default false,
 unique(document_id,label), unique(document_id,id)
);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='fd_current_revision_fk') then
 alter table public.fd_documents add constraint fd_current_revision_fk foreign key(id,current_revision)
 references public.fd_revisions(document_id,id) deferrable initially deferred;
 end if;
end $$;
create table if not exists public.fd_file_audit (
 id bigint generated always as identity primary key, project_id uuid not null references public.projects(id),
 document_id uuid references public.fd_documents(id), revision_id uuid references public.fd_revisions(id),
 action text not null, actor_id uuid not null, actor_name text not null, created_at timestamptz not null default now()
);
create table if not exists public.fd_portals (
 project_id uuid primary key references public.projects(id), token text not null unique,
 enabled boolean not null default false, pin_hash text, expires_at timestamptz,
 version integer not null default 0, updated_at timestamptz not null default now()
);
create table if not exists public.fd_file_limits (
 key text primary key, window_start timestamptz not null default now(), count integer not null default 1
);
create index if not exists fd_revision_document on public.fd_revisions(document_id,uploaded_at desc);
create index if not exists fd_audit_project on public.fd_file_audit(project_id,created_at desc);
alter table public.fd_documents enable row level security;
alter table public.fd_revisions enable row level security;
alter table public.fd_file_audit enable row level security;
alter table public.fd_portals enable row level security;
alter table public.fd_file_limits enable row level security;
revoke all on public.fd_documents,public.fd_revisions,public.fd_file_audit,public.fd_portals,public.fd_file_limits from public,anon,authenticated;
grant all on public.fd_documents,public.fd_revisions,public.fd_file_audit,public.fd_portals,public.fd_file_limits to service_role;
grant usage,select on sequence public.fd_file_audit_id_seq to service_role;

-- Extra restrictive policies protect this bucket even if an older permissive policy exists.
insert into storage.buckets(id,name,public,file_size_limit)
values('fielddocs-project-files','fielddocs-project-files',false,52428800)
on conflict(id) do update set public=false,file_size_limit=52428800;
drop policy if exists fd_private_files_guard on storage.objects;
create policy fd_private_files_guard on storage.objects as restrictive for all to anon,authenticated
using(bucket_id <> 'fielddocs-project-files') with check(bucket_id <> 'fielddocs-project-files');

create or replace function public.fd_file_allowed(p_project uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from staff_profiles s where s.id=p_actor and s.active=true and
 (s.role='admin' or exists(select 1 from project_staff a where a.project_id=p_project and a.staff_id=s.id)))
 and exists(select 1 from projects where id=p_project);
$$;

-- Atomic document publishing, optimistic locking, and audit record in one transaction.
create or replace function public.fd_file_publish(p_document uuid,p_revision uuid,p_version integer,p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare d fd_documents; actor text;
begin
 select * into d from fd_documents where id=p_document for update;
 if d.id is null or not fd_file_allowed(d.project_id,p_actor) then raise exception 'Project access required'; end if;
 if d.version<>p_version then raise exception 'Document changed. Refresh and try again.'; end if;
 if p_revision is not null and not exists(select 1 from fd_revisions where id=p_revision and document_id=d.id and ready) then
 raise exception 'Upload is not ready to publish'; end if;
 select coalesce(full_name,'Team member') into actor from staff_profiles where id=p_actor;
 update fd_documents set current_revision=p_revision,publisher_name=actor,published_at=now(),version=version+1 where id=d.id;
 if p_revision is not null then update fd_revisions set ever_published=true where id=p_revision; end if;
 insert into fd_file_audit(project_id,document_id,revision_id,action,actor_id,actor_name)
 values(d.project_id,d.id,p_revision,case when p_revision is null then 'Unpublished' else 'Published' end,p_actor,actor);
end $$;

create or replace function public.fd_file_limit(p_key text,p_max integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 delete from fd_file_limits where window_start<now()-interval '1 day';
 insert into fd_file_limits(key) values(p_key)
 on conflict(key) do update set
 count=case when fd_file_limits.window_start<now()-make_interval(secs=>p_seconds) then 1 else fd_file_limits.count+1 end,
 window_start=case when fd_file_limits.window_start<now()-make_interval(secs=>p_seconds) then now() else fd_file_limits.window_start end
 returning count into n;
 return n<=p_max;
end $$;

create or replace function public.fd_portal_save(p_project uuid,p_actor uuid,p_version integer,p_token text,p_enabled boolean,p_pin text,p_expiry timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare actor text; v integer;
begin
 if not fd_file_allowed(p_project,p_actor) then raise exception 'Project access required'; end if;
 select version into v from fd_portals where project_id=p_project for update;
 if v is null or v<>p_version then raise exception 'Access settings changed. Refresh and try again.'; end if;
 select coalesce(full_name,'Team member') into actor from staff_profiles where id=p_actor;
 update fd_portals set token=p_token,enabled=p_enabled,pin_hash=p_pin,expires_at=p_expiry,version=version+1,updated_at=now() where project_id=p_project;
 insert into fd_file_audit(project_id,action,actor_id,actor_name) values(p_project,'Contractor access updated',p_actor,actor);
end $$;
revoke all on function public.fd_file_allowed(uuid,uuid),public.fd_file_publish(uuid,uuid,integer,uuid),public.fd_file_limit(text,integer,integer),public.fd_portal_save(uuid,uuid,integer,text,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fd_file_allowed(uuid,uuid),public.fd_file_publish(uuid,uuid,integer,uuid),public.fd_file_limit(text,integer,integer),public.fd_portal_save(uuid,uuid,integer,text,boolean,text,timestamptz) to service_role;
create or replace function public.fd_file_metadata(p_document uuid,p_actor uuid,p_version integer,p_number text,p_title text,p_discipline text,p_kind text,p_folder text)
returns void language plpgsql security definer set search_path=public as $$
declare d fd_documents; actor text;
begin
 select * into d from fd_documents where id=p_document for update;
 if d.id is null or not fd_file_allowed(d.project_id,p_actor) then raise exception 'Project access required'; end if;
 if d.version<>p_version then raise exception 'Document changed. Refresh and try again.'; end if;
 select coalesce(full_name,'Team member') into actor from staff_profiles where id=p_actor;
 update fd_documents set number=p_number,title=p_title,discipline=p_discipline,kind=p_kind,folder=p_folder,version=version+1 where id=d.id;
 insert into fd_file_audit(project_id,document_id,action,actor_id,actor_name) values(d.project_id,d.id,'Document details updated',p_actor,actor);
end $$;
revoke all on function public.fd_file_metadata(uuid,uuid,integer,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.fd_file_metadata(uuid,uuid,integer,text,text,text,text,text) to service_role;
create or replace function public.fd_file_finish(p_revision uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r fd_revisions; p uuid; actor text;
begin
 select * into r from fd_revisions where id=p_revision for update;
 select project_id into p from fd_documents where id=r.document_id;
 if p is null or not fd_file_allowed(p,p_actor) then raise exception 'Project access required'; end if;
 if r.ready then return; end if;
 select coalesce(full_name,'Team member') into actor from staff_profiles where id=p_actor;
 update fd_revisions set ready=true where id=r.id;
 insert into fd_file_audit(project_id,document_id,revision_id,action,actor_id,actor_name) values(p,r.document_id,r.id,'Uploaded privately',p_actor,actor);
end $$;
revoke all on function public.fd_file_finish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fd_file_finish(uuid,uuid) to service_role;
commit;
notify pgrst,'reload schema';
