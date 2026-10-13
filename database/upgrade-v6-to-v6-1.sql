-- Field Docs V6.1: rich-text reports. Existing plain-text fields are retained.
begin;
alter table public.daily_reports add column if not exists rich_text jsonb not null default '{}'::jsonb;
alter table public.daily_reports add column if not exists report_revision integer not null default 0;
alter table public.daily_reports add column if not exists edited_at timestamptz;
alter table public.daily_reports add column if not exists edited_by uuid;
create or replace function public.fielddocs_report_revision() returns trigger
language plpgsql set search_path=public as $$
begin new.report_revision:=old.report_revision+1; new.edited_at:=now(); return new; end $$;
drop trigger if exists fielddocs_report_revision on public.daily_reports;
create trigger fielddocs_report_revision before update on public.daily_reports for each row execute function public.fielddocs_report_revision();
revoke all on function public.fielddocs_report_revision() from public,anon,authenticated;

create or replace function public.fielddocs_report_save(p_id uuid,p_revision integer,p_project uuid,p_date date,p_weather text,p_work text,p_labour text,p_issues text,p_rich jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r daily_reports; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from staff_profiles s where s.id=actor and s.active=true and
 (s.role='admin' or exists(select 1 from project_staff a where a.staff_id=actor and a.project_id=p_project))) then raise exception 'Project access required'; end if;
 if p_date is null or p_project is null then raise exception 'Project and report date are required'; end if;
 if p_rich is null or jsonb_typeof(p_rich)<>'object' or octet_length(p_rich::text)>1000000 then raise exception 'Report formatting is invalid or too large'; end if;
 if exists(select 1 from jsonb_each(p_rich) x where x.key not in ('work_completed','labour','issues') or x.value->>'type' is distinct from 'doc') then raise exception 'Invalid formatted report section'; end if;
 if length(coalesce(p_weather,''))>2000 or length(coalesce(p_work,''))+length(coalesce(p_labour,''))+length(coalesce(p_issues,''))>500000 then raise exception 'Report text is too long'; end if;
 if p_id is null then
 insert into daily_reports(project_id,report_date,weather,work_completed,labour,issues,rich_text,edited_by)
 values(p_project,p_date,coalesce(p_weather,''),coalesce(p_work,''),coalesce(p_labour,''),coalesce(p_issues,''),p_rich,actor) returning * into r;
 else
 select * into r from daily_reports where id=p_id for update;
 if r.id is null or r.project_id<>p_project then raise exception 'Report not found in this project'; end if;
 if p_revision is null or r.report_revision<>p_revision then raise exception 'Someone updated this report. Reload it before saving to avoid overwriting their changes.'; end if;
 update daily_reports set report_date=p_date,weather=coalesce(p_weather,''),work_completed=coalesce(p_work,''),labour=coalesce(p_labour,''),issues=coalesce(p_issues,''),rich_text=p_rich,edited_by=actor where id=p_id returning * into r;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.fielddocs_report_save(uuid,integer,uuid,date,text,text,text,text,jsonb) from public,anon;
grant execute on function public.fielddocs_report_save(uuid,integer,uuid,date,text,text,text,text,jsonb) to authenticated;
commit;
notify pgrst,'reload schema';
