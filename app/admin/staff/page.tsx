"use client";
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../../../lib/supabase';
import {StaffDirectory,StaffMember} from '../../../lib/staff-admin';
import '../../../components/project-work.css';
import './staff.css';
type Form={name:string;email:string;role:string;active:boolean;estimating:boolean;projects:string[]};
async function api(body?:unknown){const session=await supabase.auth.getSession();if(session.error||!session.data.session)throw Error('Sign in with an administrator account.');const r=await fetch('/api/admin/staff',{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+session.data.session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Staff request failed.');return data;}
export default function StaffPage(){
 const [directory,setDirectory]=useState<StaffDirectory|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[editing,setEditing]=useState<StaffMember|'new'|null>(null),[search,setSearch]=useState(''),[filter,setFilter]=useState('all');
 async function load(){setLoading(true);setError('');try{setDirectory(await api());}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const members=(directory?.users||[]).filter(u=>(filter==='all'||(filter==='active'&&u.active)||(filter==='inactive'&&u.has_profile&&!u.active)||(filter==='setup'&&!u.has_profile))&&`${u.full_name} ${u.email}`.toLowerCase().includes(search.toLowerCase()));
 return <main className="pw staff-page"><div className="eyebrow">I/C CONSTRUCTION / ADMINISTRATION</div><div className="staff-header"><div><h1>Team & access</h1><p className="muted">Invite your team, manage access and assign projects.</p></div><button disabled={!directory||loading} onClick={()=>{setNotice('');setEditing('new');}}>Invite team member</button></div>
 {error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status" className="notice success">{notice}</p>}
 {directory&&!directory.emailReady&&<p className="notice warning">Invitations need the server settings RESEND_API_KEY, RESEND_FROM and FIELDDOCS_APP_URL. You can still activate existing accounts and manage access.</p>}
 <div className="staff-tools"><label>Search team<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or email"/></label><label>Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Everyone</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="setup">Needs setup</option></select></label><button className="secondary" disabled={loading} onClick={()=>void load()}>Refresh</button></div>
 {loading&&!directory?<p>Loading team…</p>:directory&&<><p className="muted">{directory.users.filter(u=>u.active).length} active · {directory.users.filter(u=>!u.has_profile).length} need setup · {members.length} shown</p><div className="staff-cards">{members.map(u=><article className="panel staff-card" key={u.id}><div className="staff-card-top"><h2>{u.full_name||u.email}</h2><span className={'staff-status '+(u.active?'active':'')}>{!u.has_profile?'Needs setup':u.active?'Active':'Inactive'}</span></div><p className="staff-email">{u.email}</p><p>{u.role==='admin'?'Administrator · All projects':'Team member · '+u.projects.length+' assigned projects'}{u.estimating&&u.role!=='admin'?' · Estimating':''}</p><p className="muted">{u.confirmed?'Email confirmed':'Email not yet confirmed'}{u.id===directory.actor?' · You':''}</p><button className="secondary" onClick={()=>{setNotice('');setEditing(u);}}>{u.has_profile?'Manage access':'Set up access'}</button></article>)}</div>{!members.length&&<p>No team members match your search.</p>}</>}
 {editing&&directory&&<StaffEditor key={editing==='new'?'new':editing.id} member={editing} directory={directory} close={()=>setEditing(null)} saved={async(message)=>{setEditing(null);setNotice(message);await load();}}/>}
 </main>;
}
function StaffEditor({member,directory,close,saved}:{member:StaffMember|'new';directory:StaffDirectory;close:()=>void;saved:(message:string)=>Promise<void>}){
 const isNew=member==='new',self=!isNew&&member.id===directory.actor;
 const initial:Form=isNew?{name:'',email:'',role:'pm',active:true,estimating:false,projects:[]}:{name:member.full_name,email:member.email,role:member.role,active:member.active,estimating:member.estimating,projects:member.projects};
 const [form,setForm]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false);const dirty=JSON.stringify(form)!==JSON.stringify(initial);
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty,busy]);
 const change=(key:keyof Form,value:unknown)=>setForm(old=>({...old,[key]:value}));
 function cancel(){if(!busy&&(!dirty||confirm('Discard these unsaved staff settings?')))close();}
 async function act(action:'save'|'invite'|'email'){
  if(inFlight.current)return;
  if(action==='email'&&!confirm(`Send a password setup email to ${form.email}?`))return;
  if(action!=='email'&&form.role==='admin'&&(isNew||member.role!=='admin')&&!confirm('Grant administrator access? This person can access all projects and manage staff.'))return;
  if(action==='save'&&!isNew&&member.active&&!form.active&&!confirm('Deactivate this person’s FieldDocs access? Their existing records will be kept.'))return;
  inFlight.current=true;setBusy(true);setError('');
  try{const response=await api({action,...form,...(!isNew?{id:member.id,revision:member.revision}:{})});await saved(response.message);}catch(e){setError((e as Error).message);}finally{inFlight.current=false;setBusy(false);}
 }
 return <dialog ref={dialog} className="staff-dialog pw" aria-labelledby="staff-editor-title" onCancel={e=>{e.preventDefault();cancel();}}><form onSubmit={e=>{e.preventDefault();void act(isNew?'invite':'save');}}>
 <h2 id="staff-editor-title">{isNew?'Invite team member':'Manage team member'}</h2>
 {error&&<p className="notice error" role="alert">{error}</p>}
 <fieldset disabled={busy}><div className="staff-fields"><label>Full name<input required maxLength={150} value={form.name} onChange={e=>change('name',e.target.value)}/></label><label>Email<input type="email" required maxLength={254} disabled={!isNew} value={form.email} onChange={e=>change('email',e.target.value)}/></label><label>Role<select aria-label="Role" disabled={self} value={form.role} onChange={e=>change('role',e.target.value)}><option value="pm">Team member (PM / site manager)</option><option value="admin">Administrator</option></select></label><label className="staff-check"><input type="checkbox" disabled={self||isNew} checked={form.active} onChange={e=>change('active',e.target.checked)}/>Active access</label></div>
 <label className="staff-check"><input type="checkbox" disabled={form.role==='admin'} checked={form.role==='admin'||form.estimating} onChange={e=>change('estimating',e.target.checked)}/>Estimating & cost-control access</label><p className="muted">Administrators can access all projects and manage staff. Team members see assigned projects. Estimating access adds budget, fee and cost-control tools.</p>
 <div className="staff-projects"><div className="staff-header"><h3>Assigned projects</h3><div><button type="button" className="secondary" onClick={()=>change('projects',directory.projects.map(p=>p.id))}>Select all</button> <button type="button" className="secondary" onClick={()=>change('projects',[])}>Clear selection</button></div></div>{form.role==='admin'&&<p className="muted">Assignments are optional for administrators; they already have access to all projects.</p>}{directory.projects.map(p=><label className="staff-check" key={p.id}><input type="checkbox" checked={form.projects.includes(p.id)} onChange={e=>change('projects',e.target.checked?[...form.projects,p.id]:form.projects.filter(id=>id!==p.id))}/>{p.project_name}</label>)}{!directory.projects.length&&<p>No projects yet. You can assign them later.</p>}</div>
 </fieldset><div className="staff-actions"><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button><button disabled={busy||(isNew&&!directory.emailReady)}>{busy?'Working…':isNew?'Create & send invitation':'Save access'}</button>{!isNew&&<button type="button" className="secondary" disabled={busy||dirty||!member.active||!directory.emailReady} onClick={()=>void act('email')}>Send setup email</button>}</div>{!isNew&&<p className="muted">Save access changes before sending a setup email. The recipient chooses their own password.</p>}
 </form></dialog>;
}
