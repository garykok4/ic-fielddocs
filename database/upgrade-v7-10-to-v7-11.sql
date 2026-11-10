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
