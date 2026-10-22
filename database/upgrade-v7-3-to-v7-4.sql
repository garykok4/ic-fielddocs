-- V7.4 project cost ledger. Requires V7.3 (including estimating permissions).
begin;
create or replace function public.fd_cost_allowed(pid uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select public.fielddocs_can_estimate() and public.schedule_v4_allowed(pid) $$;
revoke all on function public.fd_cost_allowed(uuid) from public;
grant execute on function public.fd_cost_allowed(uuid) to authenticated;
create table if not exists public.fd_cost_projects(project_id uuid primary key references public.projects(id),budget numeric(16,2) not null default 0 check(budget>=0),uncommitted numeric(16,2) not null default 0 check(uncommitted>=0),revision bigint not null default 0);
create table if not exists public.fd_cost_contracts(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),vendor text not null,reference text not null,original numeric(16,2) not null check(original>0),holdback_pct numeric(7,4) not null default 10 check(holdback_pct between 0 and 100),tax_pct numeric(7,4) not null default 13 check(tax_pct between 0 and 100),remaining_forecast numeric(16,2) check(remaining_forecast>=0),created_at timestamptz not null default now());
create table if not exists public.fd_cost_sov(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),contract_id uuid not null references public.fd_cost_contracts(id),description text not null,original numeric(16,2) not null check(original>=0),verified_pct numeric(7,4) not null default 0 check(verified_pct between 0 and 100));
create table if not exists public.fd_cost_changes(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),contract_id uuid not null references public.fd_cost_contracts(id),sov_id uuid not null references public.fd_cost_sov(id),reference text not null,description text not null,amount numeric(16,2) not null check(amount<>0),status text not null default 'pending' check(status in ('pending','approved','rejected')),approved_by uuid references auth.users(id),approved_at timestamptz,created_at timestamptz not null default now());
create table if not exists public.fd_cost_invoices(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),contract_id uuid not null references public.fd_cost_contracts(id),number text not null,duplicate_key text not null,invoice_date date not null,due_date date,reported_prior numeric(16,2) not null check(reported_prior>=0),claimed_holdback numeric(16,2) not null check(claimed_holdback>=0),claimed_total numeric(16,2) not null check(claimed_total>=0),extra_claim numeric(16,2) not null default 0 check(extra_claim>=0),status text not null default 'draft' check(status in ('draft','approved','void')),gross numeric(16,2) not null default 0,holdback numeric(16,2) not null default 0,tax numeric(16,2) not null default 0,tax_pct numeric(7,4) not null,notes text not null default '',approved_by uuid references auth.users(id),approved_at timestamptz,created_at timestamptz not null default now());
create unique index if not exists fd_cost_duplicate_invoice on public.fd_cost_invoices(project_id,duplicate_key) where status<>'void';
create table if not exists public.fd_cost_invoice_lines(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),sov_id uuid not null references public.fd_cost_sov(id),claimed numeric(16,2) not null check(claimed>=0),approved numeric(16,2) not null check(approved>=0 and approved<=claimed),unique(invoice_id,sov_id));
create table if not exists public.fd_cost_releases(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),amount numeric(16,2) not null check(amount>0),tax numeric(16,2) not null,release_date date not null,reference text not null,created_by uuid references auth.users(id),created_at timestamptz not null default now());
alter table public.fd_cost_releases add column if not exists voided boolean not null default false;
create table if not exists public.fd_cost_payments(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),amount numeric(16,2) not null check(amount>0),payment_date date not null,reference text not null,voided boolean not null default false,created_by uuid references auth.users(id),created_at timestamptz not null default now());
create table if not exists public.fd_cost_documents(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),invoice_id uuid not null references public.fd_cost_invoices(id),path text not null unique,filename text not null,created_at timestamptz not null default now());
create table if not exists public.fd_cost_audit(id bigint generated always as identity primary key,project_id uuid not null references public.projects(id),actor uuid references auth.users(id),action text not null,details jsonb not null,created_at timestamptz not null default now());
do $$ declare t text;begin foreach t in array array['fd_cost_projects','fd_cost_contracts','fd_cost_sov','fd_cost_changes','fd_cost_invoices','fd_cost_invoice_lines','fd_cost_releases','fd_cost_payments','fd_cost_documents','fd_cost_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('drop policy if exists cost_read on public.%I',t);
 execute format('create policy cost_read on public.%I for select to authenticated using(public.fd_cost_allowed(project_id))',t);
 end loop;end $$;
create or replace function public.fd_cost_read(p_project uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.fd_cost_allowed(p_project) is not true then raise exception 'Cost control requires estimating access and project assignment.' using errcode='42501';end if;
 return jsonb_build_object('project',coalesce((select to_jsonb(x) from public.fd_cost_projects x where project_id=p_project),jsonb_build_object('project_id',p_project,'revision',0,'budget',0,'uncommitted',0)),
 'contracts',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_contracts x where project_id=p_project),'[]'),
 'sov',coalesce((select jsonb_agg(x order by id) from public.fd_cost_sov x where project_id=p_project),'[]'),
 'changes',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_changes x where project_id=p_project),'[]'),
 'invoices',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_invoices x where project_id=p_project),'[]'),
 'lines',coalesce((select jsonb_agg(x order by id) from public.fd_cost_invoice_lines x where project_id=p_project),'[]'),
 'releases',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_releases x where project_id=p_project),'[]'),
 'payments',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_payments x where project_id=p_project),'[]'),
 'documents',coalesce((select jsonb_agg(x order by created_at,id) from public.fd_cost_documents x where project_id=p_project),'[]'),
 'audit',coalesce((select jsonb_agg(x order by id desc) from (select * from public.fd_cost_audit where project_id=p_project order by id desc limit 200) x),'[]'));
end $$;
revoke all on function public.fd_cost_read(uuid) from public;
grant execute on function public.fd_cost_read(uuid) to authenticated;
-- Input helpers enforce cents and finite bounds before every ledger write.
create or replace function public.fd_cost_money(j jsonb) returns numeric language plpgsql immutable as $$
declare n numeric;begin if jsonb_typeof(j) is distinct from 'number' then raise exception 'Enter a numeric amount';end if;n:=j::text::numeric;if n<>round(n,2) or abs(n)>1e12 then raise exception 'Amounts require at most two decimal places and must be within range';end if;return n;end $$;
create or replace function public.fd_cost_text(j jsonb,lim integer) returns text language plpgsql immutable as $$
begin if jsonb_typeof(j) is distinct from 'string' or length(trim(j#>>'{}'))=0 or length(j#>>'{}')>lim then raise exception 'Required text is missing or too long';end if;return trim(j#>>'{}');end $$;
create or replace function public.fd_cost_action(p_project uuid,p_revision bigint,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare rev bigint; c public.fd_cost_contracts; s public.fd_cost_sov; inv public.fd_cost_invoices; ch public.fd_cost_changes; line jsonb; ident uuid; value numeric; total numeric; prior numeric; revised numeric; retained numeric; tax_value numeric; released numeric; paid numeric; claim numeric; approved numeric; extra numeric; notes text;
begin
 if public.fd_cost_allowed(p_project) is not true then raise exception 'Cost control requires estimating access and project assignment.' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>200000 then raise exception 'Invalid cost data';end if;
 insert into public.fd_cost_projects(project_id) values(p_project) on conflict do nothing;
 select revision into rev from public.fd_cost_projects where project_id=p_project for update;
 if rev is distinct from p_revision then raise exception 'Project costs changed in another session. Refresh and review before saving.' using errcode='40001';end if;
 if p_action='budget' then
 update public.fd_cost_projects set budget=public.fd_cost_money(p_data->'budget'),uncommitted=public.fd_cost_money(p_data->'uncommitted') where project_id=p_project;
 elsif p_action='contract' then
 if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 200 then raise exception 'Provide 1 to 200 SOV lines';end if;
 total:=0;for line in select x.value from jsonb_array_elements(p_data->'lines') x loop total:=total+public.fd_cost_money(line->'amount');end loop;
 insert into public.fd_cost_contracts(project_id,vendor,reference,original,holdback_pct,tax_pct) values(p_project,public.fd_cost_text(p_data->'vendor',200),public.fd_cost_text(p_data->'reference',150),total,public.fd_cost_money(p_data->'holdback_pct'),public.fd_cost_money(p_data->'tax_pct')) returning * into c;
 for line in select x.value from jsonb_array_elements(p_data->'lines') x loop insert into public.fd_cost_sov(project_id,contract_id,description,original) values(p_project,c.id,public.fd_cost_text(line->'description',500),public.fd_cost_money(line->'amount'));end loop;
 elsif p_action in ('progress','sov_edit','change','change_approve','change_reject','forecast','invoice','contract_settings','sov_add') then
 select * into c from public.fd_cost_contracts where id=(p_data->>'contract_id')::uuid and project_id=p_project;if not found then raise exception 'Contract not found';end if;
 if p_action='contract_settings' then
 if exists(select 1 from public.fd_cost_invoices where contract_id=c.id and status<>'void') then raise exception 'Contract terms are locked after invoice entry';end if;
 update public.fd_cost_contracts set vendor=public.fd_cost_text(p_data->'vendor',200),reference=public.fd_cost_text(p_data->'reference',150),holdback_pct=public.fd_cost_money(p_data->'holdback_pct'),tax_pct=public.fd_cost_money(p_data->'tax_pct') where id=c.id;
 elsif p_action='sov_add' then
 insert into public.fd_cost_sov(project_id,contract_id,description,original) values(p_project,c.id,public.fd_cost_text(p_data->'description',500),0);
 elsif p_action='forecast' then update public.fd_cost_contracts set remaining_forecast=case when p_data->'amount'='null'::jsonb then null else public.fd_cost_money(p_data->'amount') end where id=c.id;
 elsif p_action in ('progress','sov_edit','change') then
 select * into s from public.fd_cost_sov where id=(p_data->>'sov_id')::uuid and contract_id=c.id;if not found then raise exception 'SOV line not found';end if;
 if p_action='progress' then
 value:=public.fd_cost_money(p_data->'percent');select s.original+coalesce(sum(amount),0) into revised from public.fd_cost_changes where sov_id=s.id and status='approved';
 select coalesce(sum(l.approved),0) into prior from public.fd_cost_invoice_lines l join public.fd_cost_invoices i on i.id=l.invoice_id where l.sov_id=s.id and i.status='approved';
 if round(revised*value/100,2)<prior then raise exception 'Verified progress cannot fall below approved billing';end if;
 update public.fd_cost_sov set verified_pct=value where id=s.id;
 elsif p_action='sov_edit' then
 if exists(select 1 from public.fd_cost_invoices where contract_id=c.id and status<>'void') or exists(select 1 from public.fd_cost_changes where contract_id=c.id) then raise exception 'SOV base is locked after invoices or changes. Use a change order.';end if;
 value:=public.fd_cost_money(p_data->'amount');update public.fd_cost_sov set description=public.fd_cost_text(p_data->'description',500),original=value where id=s.id;
 -- Original contract follows SOV only before any billing/change history exists.
 update public.fd_cost_contracts set original=(select sum(original) from public.fd_cost_sov where contract_id=c.id) where id=c.id;
 else insert into public.fd_cost_changes(project_id,contract_id,sov_id,reference,description,amount) values(p_project,c.id,s.id,public.fd_cost_text(p_data->'reference',150),public.fd_cost_text(p_data->'description',2000),public.fd_cost_money(p_data->'amount'));end if;
 elsif p_action in ('change_approve','change_reject') then
 select * into ch from public.fd_cost_changes where id=(p_data->>'id')::uuid and contract_id=c.id and status='pending';if not found then raise exception 'Pending change not found';end if;
 if p_action='change_approve' then
 select original+coalesce((select sum(amount) from public.fd_cost_changes where sov_id=ch.sov_id and status='approved'),0)+ch.amount into revised from public.fd_cost_sov where id=ch.sov_id;
 select coalesce(sum(l.approved),0) into prior from public.fd_cost_invoice_lines l join public.fd_cost_invoices i on i.id=l.invoice_id where l.sov_id=ch.sov_id and i.status='approved';
 if revised<prior or revised<0 then raise exception 'Change would reduce SOV below approved billing or zero';end if;
 end if;
 update public.fd_cost_changes set status=case when p_action='change_approve' then 'approved' else 'rejected' end,approved_by=auth.uid(),approved_at=now() where id=ch.id;
 else
 -- Draft or draft update. Approved invoice amounts are immutable.
 if p_data->>'id' is null then
 insert into public.fd_cost_invoices(project_id,contract_id,number,duplicate_key,invoice_date,due_date,reported_prior,claimed_holdback,claimed_total,extra_claim,tax_pct,notes)
 values(p_project,c.id,public.fd_cost_text(p_data->'number',100),lower(regexp_replace(c.vendor,'[^a-zA-Z0-9]','','g'))||':'||lower(regexp_replace(public.fd_cost_text(p_data->'number',100),'[^a-zA-Z0-9]','','g')),(p_data->>'invoice_date')::date,nullif(p_data->>'due_date','')::date,public.fd_cost_money(p_data->'reported_prior'),public.fd_cost_money(p_data->'claimed_holdback'),public.fd_cost_money(p_data->'claimed_total'),public.fd_cost_money(p_data->'extra_claim'),c.tax_pct,coalesce(p_data->>'notes','')) returning * into inv;
 else
 select * into inv from public.fd_cost_invoices where id=(p_data->>'id')::uuid and contract_id=c.id and status='draft';if not found then raise exception 'Editable draft not found';end if;
 update public.fd_cost_invoices set number=public.fd_cost_text(p_data->'number',100),duplicate_key=lower(regexp_replace(c.vendor,'[^a-zA-Z0-9]','','g'))||':'||lower(regexp_replace(public.fd_cost_text(p_data->'number',100),'[^a-zA-Z0-9]','','g')),invoice_date=(p_data->>'invoice_date')::date,due_date=nullif(p_data->>'due_date','')::date,reported_prior=public.fd_cost_money(p_data->'reported_prior'),claimed_holdback=public.fd_cost_money(p_data->'claimed_holdback'),claimed_total=public.fd_cost_money(p_data->'claimed_total'),extra_claim=public.fd_cost_money(p_data->'extra_claim'),notes=coalesce(p_data->>'notes','') where id=inv.id;
 delete from public.fd_cost_invoice_lines where invoice_id=inv.id;
 end if;
 if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 200 then raise exception 'Provide SOV allocations';end if;
 for line in select x.value from jsonb_array_elements(p_data->'lines') x loop
 if not exists(select 1 from public.fd_cost_sov where id=(line->>'sov_id')::uuid and contract_id=c.id) then raise exception 'Invoice SOV line belongs to another contract';end if;
 insert into public.fd_cost_invoice_lines(project_id,invoice_id,sov_id,claimed,approved) values(p_project,inv.id,(line->>'sov_id')::uuid,public.fd_cost_money(line->'claimed'),public.fd_cost_money(line->'approved'));
 end loop;
 end if;
 elsif p_action in ('approve','void_invoice','release','payment','attach','void_payment','void_release') then
 select * into inv from public.fd_cost_invoices where id=(p_data->>'invoice_id')::uuid and project_id=p_project;if not found then raise exception 'Invoice not found';end if;
 select * into c from public.fd_cost_contracts where id=inv.contract_id;
 select coalesce(sum(amount),0) into released from public.fd_cost_releases where invoice_id=inv.id and not voided;
 select coalesce(sum(amount),0) into paid from public.fd_cost_payments where invoice_id=inv.id and not voided;
 if p_action='approve' then
 if inv.status<>'draft' then raise exception 'Only drafts may be approved';end if;
 if inv.extra_claim<>0 then raise exception 'Unapproved extra claim: approve a change order and allocate the claim to SOV first';end if;
 select coalesce(sum(gross),0) into prior from public.fd_cost_invoices where contract_id=c.id and status='approved';
 if inv.reported_prior<>prior then raise exception 'Reported previous billing does not match approved prior gross billing';end if;
 select coalesce(sum(l.claimed),0),coalesce(sum(l.approved),0) into claim,total from public.fd_cost_invoice_lines l where l.invoice_id=inv.id;
 if total<=0 then raise exception 'Positive approved amount required';end if;
 if inv.claimed_holdback<>round(claim*c.holdback_pct/100,2) then raise exception 'Claimed holdback does not match the contract rate';end if;
 if inv.claimed_total<>claim-inv.claimed_holdback+round((claim-inv.claimed_holdback)*c.tax_pct/100,2) then raise exception 'Claimed invoice total does not reconcile';end if;
 for line in select to_jsonb(l) from public.fd_cost_invoice_lines l where invoice_id=inv.id loop
 select * into s from public.fd_cost_sov where id=(line->>'sov_id')::uuid;
 select s.original+coalesce(sum(amount),0) into revised from public.fd_cost_changes where sov_id=s.id and status='approved';
 select coalesce(sum(l.approved),0) into approved from public.fd_cost_invoice_lines l join public.fd_cost_invoices i on i.id=l.invoice_id where l.sov_id=s.id and i.status='approved';
 if approved+(line->>'approved')::numeric>revised then raise exception 'Approved billing exceeds revised SOV';end if;
 if approved+(line->>'approved')::numeric>round(revised*s.verified_pct/100,2) then raise exception 'Approved billing exceeds PM-verified progress';end if;
 end loop;
 select c.original+coalesce(sum(amount),0) into revised from public.fd_cost_changes where contract_id=c.id and status='approved';
 if prior+total>revised then raise exception 'Approved billing exceeds revised contract';end if;
 retained:=round(total*c.holdback_pct/100,2);tax_value:=round((total-retained)*c.tax_pct/100,2);
 update public.fd_cost_invoices set status='approved',gross=total,holdback=retained,tax=tax_value,approved_by=auth.uid(),approved_at=now() where id=inv.id;
 elsif p_action='void_invoice' then
 notes:=public.fd_cost_text(p_data->'reason',2000);
 if inv.status='void' or paid>0 or released>0 then raise exception 'Cannot void an invoice with payments/releases or already void';end if;
 if inv.status='approved' and exists(select 1 from public.fd_cost_invoices where contract_id=c.id and status='approved' and approved_at>inv.approved_at) then raise exception 'Void later approvals first to preserve billing sequence';end if;
 update public.fd_cost_invoices set status='void',notes=inv.notes||E'\nVoid reason: '||notes where id=inv.id;
 elsif p_action='release' then
 if inv.status<>'approved' then raise exception 'Approved invoice required';end if;value:=public.fd_cost_money(p_data->'amount');
 if value+released>inv.holdback then raise exception 'Release exceeds remaining retained holdback';end if;
 if p_data->>'confirmed' is distinct from 'true' then raise exception 'Confirm release authorization and eligibility review';end if;
 insert into public.fd_cost_releases(project_id,invoice_id,amount,tax,release_date,reference,created_by) values(p_project,inv.id,value,round(value*inv.tax_pct/100,2),(p_data->>'date')::date,public.fd_cost_text(p_data->'reference',1000),auth.uid());
 elsif p_action='payment' then
 if inv.status<>'approved' then raise exception 'Approved invoice required';end if;value:=public.fd_cost_money(p_data->'amount');
 select inv.gross-inv.holdback+inv.tax+coalesce(sum(amount+tax),0)-paid into total from public.fd_cost_releases where invoice_id=inv.id and not voided;
 if value>total then raise exception 'Payment exceeds unpaid approved amount including released holdback';end if;
 insert into public.fd_cost_payments(project_id,invoice_id,amount,payment_date,reference,created_by) values(p_project,inv.id,value,(p_data->>'date')::date,public.fd_cost_text(p_data->'reference',200),auth.uid());
 elsif p_action='void_release' then
 notes:=public.fd_cost_text(p_data->'reason',2000);
 select amount+tax into value from public.fd_cost_releases where id=(p_data->>'release_id')::uuid and invoice_id=inv.id and not voided;if not found then raise exception 'Active release not found';end if;
 select inv.gross-inv.holdback+inv.tax+coalesce(sum(amount+tax),0)-value into total from public.fd_cost_releases where invoice_id=inv.id and not voided;
 if paid>total then raise exception 'Void related payment records before reversing this release';end if;
 update public.fd_cost_releases set voided=true where id=(p_data->>'release_id')::uuid;
 elsif p_action='void_payment' then
 notes:=public.fd_cost_text(p_data->'reason',2000);update public.fd_cost_payments set voided=true where id=(p_data->>'payment_id')::uuid and invoice_id=inv.id and not voided;if not found then raise exception 'Active payment not found';end if;
 else
 notes:=public.fd_cost_text(p_data->'path',500);
 if split_part(notes,'/',1)<>p_project::text or split_part(notes,'/',2)<>inv.id::text then raise exception 'Invalid invoice file path';end if;
 if not exists(select 1 from storage.objects where bucket_id='fielddocs-cost-invoices' and name=notes) then raise exception 'Upload not found';end if;
 insert into public.fd_cost_documents(project_id,invoice_id,path,filename) values(p_project,inv.id,notes,public.fd_cost_text(p_data->'filename',200));
 end if;
 else raise exception 'Unknown cost action';end if;
 update public.fd_cost_projects set revision=revision+1 where project_id=p_project;
 insert into public.fd_cost_audit(project_id,actor,action,details) values(p_project,auth.uid(),p_action,p_data);
 return public.fd_cost_read(p_project);
end $$;
revoke all on function public.fd_cost_action(uuid,bigint,text,jsonb) from public;
grant execute on function public.fd_cost_action(uuid,bigint,text,jsonb) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fielddocs-cost-invoices','fielddocs-cost-invoices',false,20971520,array['application/pdf','image/jpeg','image/png']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cost_invoice_upload on storage.objects;
create policy cost_invoice_upload on storage.objects for insert to authenticated with check(bucket_id='fielddocs-cost-invoices' and exists(select 1 from public.fd_cost_invoices i where i.id::text=split_part(name,'/',2) and i.project_id::text=split_part(name,'/',1) and public.fd_cost_allowed(i.project_id)));
drop policy if exists cost_invoice_download on storage.objects;
create policy cost_invoice_download on storage.objects for select to authenticated using(bucket_id='fielddocs-cost-invoices' and exists(select 1 from public.fd_cost_documents d where d.path=name and public.fd_cost_allowed(d.project_id)));
notify pgrst,'reload schema';
commit;
