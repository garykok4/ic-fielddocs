BEGIN;
CREATE OR REPLACE FUNCTION public.fd_project_delete(p_project uuid, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 proj public.projects;
 link record;
 n bigint;
 counts jsonb := '[]'::jsonb;
 blocked boolean := false;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active=true AND role='admin') THEN
  RAISE EXCEPTION 'Active administrator access required';
 END IF;
 SELECT * INTO proj FROM public.projects WHERE id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project no longer exists'; END IF;
 FOR link IN
  SELECT ns.nspname AS schema_name, cl.relname AS table_name, at.attname AS column_name,
   cardinality(c.conkey) AS columns_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid=c.conrelid
  JOIN pg_namespace ns ON ns.oid=cl.relnamespace
  JOIN pg_attribute at ON at.attrelid=c.conrelid AND at.attnum=c.conkey[1]
  WHERE c.contype='f' AND c.confrelid='public.projects'::regclass
  ORDER BY ns.nspname,cl.relname,at.attname
 LOOP
  IF link.columns_count<>1 THEN RAISE EXCEPTION 'Project has an unsupported composite relationship. No records were deleted.'; END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',link.schema_name,link.table_name,link.column_name) INTO n USING p_project;
  IF n>0 THEN
   counts:=counts||jsonb_build_array(jsonb_build_object('table',link.table_name,'count',n,
     'setup',link.schema_name='public' AND link.table_name IN ('project_staff','project_notification_preferences')));
   IF NOT (link.schema_name='public' AND link.table_name IN ('project_staff','project_notification_preferences')) THEN blocked:=true; END IF;
  END IF;
 END LOOP;
 IF p_name IS NULL THEN
  RETURN jsonb_build_object('name',proj.project_name,'records',counts,'blocked',blocked);
 END IF;
 IF p_name<>proj.project_name THEN RAISE EXCEPTION 'Project name does not match. Review the project again.'; END IF;
 IF blocked THEN RAISE EXCEPTION 'This project contains linked records. Nothing was deleted. Review the listed records first.'; END IF;
 -- Only setup records are automatically removed. All project-content relationships were checked above.
 DELETE FROM public.project_notification_preferences WHERE project_id=p_project;
 DELETE FROM public.project_staff WHERE project_id=p_project;
 DELETE FROM public.projects WHERE id=p_project;
 RETURN jsonb_build_object('deleted',true,'id',p_project);
END;
$$;
REVOKE ALL ON FUNCTION public.fd_project_delete(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fd_project_delete(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
