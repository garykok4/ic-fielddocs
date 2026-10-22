-- V7.6: allow signed dependency lead/lag in the legacy validation trigger.
CREATE OR REPLACE FUNCTION public.validate_schedule_dependency_v4()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 451));
  if new.lag_work_days is null or new.lag_work_days not between -10000 and 10000 then
    raise exception 'Lag must be between -10000 and 10000 work days';
  end if;
  if new.predecessor_id = new.successor_id then raise exception 'An activity cannot depend on itself'; end if;
  if not exists(select 1 from schedule_tasks where id=new.predecessor_id and project_id=new.project_id and item_type='task')
    or not exists(select 1 from schedule_tasks where id=new.successor_id and project_id=new.project_id and item_type='task') then
    raise exception 'Both activities must belong to this project; phases cannot have dependencies';
  end if;
  if exists (
    with recursive reachable(id) as (
      select new.successor_id
      union
      select d.successor_id from schedule_dependencies d join reachable r on d.predecessor_id=r.id
      where d.project_id=new.project_id and d.id<>new.id
    ) select 1 from reachable where id=new.predecessor_id
  ) then raise exception 'That link creates a circular dependency'; end if;
  return new;
end $function$;
NOTIFY pgrst, 'reload schema';
