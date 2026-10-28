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
