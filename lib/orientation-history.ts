export type OrientationRecord={id:string;project_id:string;project_name:string;worker_name:string|null;company_name:string|null;company_label:string|null;phone:string|null;completed_at:string|null;acknowledged_site_rules:boolean|null;acknowledged_ppe:boolean|null;acknowledged_emergency:boolean|null;acknowledged_reporting:boolean|null;acknowledged_daily_sign_in:boolean|null};
export const orientationChecks=[['acknowledged_site_rules','Site rules'],['acknowledged_ppe','PPE requirements'],['acknowledged_emergency','Emergency procedures'],['acknowledged_reporting','Hazard reporting'],['acknowledged_daily_sign_in','Daily sign-in requirements']] as const;
export const companyName=(r:OrientationRecord)=>r.company_label?.trim()||r.company_name?.trim()||'Company not entered';
export const companyKey=(s:string)=>s.trim().toLocaleLowerCase('en-CA');
export const ackLabel=(v:unknown)=>v===true?'Acknowledged':v===false?'Not acknowledged':'Not recorded';
export type OrientationSort='company'|'worker'|'oldest'|'newest';
export function orientationRows(rows:OrientationRecord[],project:string,company:string,search:string,sort:OrientationSort){
 const compare=(a:string,b:string)=>a.localeCompare(b,'en',{sensitivity:'base',numeric:true});
 const q=search.trim().toLocaleLowerCase('en-CA');
 return rows.filter(r=>(!project||r.project_id===project)&&(!company||companyKey(companyName(r))===company)&&(!q||[r.worker_name,r.company_name,r.company_label,r.project_name].some(v=>v?.toLocaleLowerCase('en-CA').includes(q)))).sort((a,b)=>{
 const date=(a.completed_at||'').localeCompare(b.completed_at||'');
 return (sort==='company'?compare(companyName(a),companyName(b))||compare(a.worker_name||'',b.worker_name||''):sort==='worker'?compare(a.worker_name||'',b.worker_name||'')||compare(companyName(a),companyName(b)):sort==='oldest'?date:-date)||a.id.localeCompare(b.id);
 });
}
export function selectOrientationRange(ids:string[],selected:Set<string>,anchor:string|null,id:string,range:boolean,checked:boolean){
 const next=new Set(selected),end=ids.indexOf(id),begin=anchor?ids.indexOf(anchor):-1;
 if(end<0)return next;
 const targets=range&&begin>=0?ids.slice(Math.min(begin,end),Math.max(begin,end)+1):[id];
 for(const key of targets)checked?next.add(key):next.delete(key);
 return next;
}
