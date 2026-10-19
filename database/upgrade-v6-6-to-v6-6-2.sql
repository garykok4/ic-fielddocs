-- Run after the V6.6 estimating migration. Existing estimates retain their pricing model.
begin;
alter table public.fielddocs_fee_scenarios drop constraint if exists fielddocs_fee_scenarios_model_version_check;
alter table public.fielddocs_fee_scenarios add constraint fielddocs_fee_scenarios_model_version_check check(model_version in ('scheps-v1','scheps-v2'));
-- Keep the original RPC/default at v1 for older deployed clients.
create or replace function public.fielddocs_fee_save_v2(p_id uuid,p_revision bigint,p_name text,p_project uuid,p_notes text,p_inputs jsonb,p_model text)
returns public.fielddocs_fee_scenarios language plpgsql security definer set search_path=pg_catalog,public as $$
declare saved public.fielddocs_fee_scenarios;
begin
 if p_model is null or p_model not in ('scheps-v1','scheps-v2') then raise exception 'Unsupported pricing model'; end if;
 -- Existing function enforces access, project permissions, inputs and revision checks.
 saved:=public.fielddocs_fee_save(p_id,p_revision,p_name,p_project,p_notes,p_inputs);
 update public.fielddocs_fee_scenarios set model_version=p_model where id=saved.id returning * into saved;
 return saved;
end $$;
revoke all on function public.fielddocs_fee_save_v2(uuid,bigint,text,uuid,text,jsonb,text) from public;
grant execute on function public.fielddocs_fee_save_v2(uuid,bigint,text,uuid,text,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
