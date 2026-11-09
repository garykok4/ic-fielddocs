'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {Snapshot} from '../app/schedule/engine';
import {ontarioToday,shiftDate} from '../lib/work-calendar';
import {briefWeek,briefText} from '../lib/site-brief';
import {buildLookahead} from '../lib/lookahead';
import './lookahead-export.css';
type Project={id:string;project_name:string};
type Draft={project:Project;snapshot:Snapshot;text:string};
export default function WeeklySiteBrief({projects,close}:{projects:Project[];close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),seq=useRef(0);
 const [start,setStart]=useState(()=>briefWeek(ontarioToday())),[selected,setSelected]=useState<string[]>(projects.map(p=>p.id)),[customer,setCustomer]=useState(false),[drafts,setDrafts]=useState<Draft[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reviewed,setReviewed]=useState(false);
 useEffect(()=>{const old=document.activeElement;dialog.current?.showModal();return()=>{seq.current++;if(old instanceof HTMLElement)old.focus();};},[]);
 function invalidate(){setDrafts([]);setReviewed(false);setNotice('');}
 async function generate(){const token=++seq.current;setBusy(true);setError('');setNotice('');setReviewed(false);setDrafts([]);try{
 const out:Draft[]=[];
 for(const project of projects.filter(p=>selected.includes(p.id))){
 const r=await supabase.rpc('schedule_v75_read',{p_project:project.id});if(r.error)throw Error(project.project_name+': '+r.error.message);
 out.push({project,snapshot:r.data,text:briefText(project.project_name,r.data,start,ontarioToday(),customer)});
 }if(token===seq.current)setDrafts(out);
 }catch(e){if(token===seq.current)setError((e as Error).message);}finally{if(token===seq.current)setBusy(false);}}
 async function action(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function fresh(d:Draft){const r=await supabase.rpc('schedule_v75_read',{p_project:d.project.id});if(r.error)throw r.error;if(r.data.revision!==d.snapshot.revision)throw Error(d.project.project_name+': schedule changed. Generate the brief again before sharing.');}
 return <dialog ref={dialog} className="la-dialog" aria-labelledby="brief-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}><header><div><div className="la-eyebrow">FIELD DOCS / WEEKLY COORDINATION</div><h2 id="brief-title">Weekly Site Brief</h2></div><button disabled={busy} onClick={close}>Close</button></header><div className="la-body">
 {error&&<p role="alert" className="la-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <fieldset disabled={busy}><label>Week containing<input type="date" value={start} onChange={e=>{if(e.target.value){setStart(briefWeek(e.target.value));invalidate();}}}/></label>
 {projects.length>1&&<details open><summary>Projects ({selected.length} selected)</summary><button onClick={()=>{setSelected(projects.map(p=>p.id));invalidate();}}>Select all</button><button onClick={()=>{setSelected([]);invalidate();}}>Clear</button>{projects.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>{setSelected(s=>e.target.checked?[...s,p.id]:s.filter(id=>id!==p.id));invalidate();}}/>{p.project_name}</label>)}</details>}
 <label><input type="checkbox" checked={customer} onChange={e=>{setCustomer(e.target.checked);invalidate();}}/>Customer edition — only customer-visible schedule activities</label>
 <p>Monday–Sunday. Each open activity appears once, with combined starting/continuing and finishing headings. All overdue activities appear first. Due dates and countdowns use today in Ontario, excluding weekends, Ontario holidays and project shutdowns. Completed activities are omitted. No emails are sent.</p>
 <button disabled={!selected.length} onClick={()=>void generate()}>{busy?'Preparing…':'Generate brief'}</button>
 {drafts.map((d,i)=><section key={d.project.id}><h3>{d.project.project_name}</h3><label>Edit brief<textarea rows={22} maxLength={50000} style={{width:'100%',lineHeight:1.6}} value={d.text} onChange={e=>{setDrafts(ds=>ds.map((x,j)=>j===i?{...x,text:e.target.value}:x));setReviewed(false);setNotice('');}}/></label>
 <button onClick={()=>void action(async()=>{await fresh(d);const {downloadLookahead}=await import('../lib/lookahead-pdf');await downloadLookahead(buildLookahead(d.project.project_name,d.snapshot,{start,end:shiftDate(start,6),format:'gantt',paper:'tabloid',layout:'pages',colourBy:'phase',phase:'',trade:'',stage:'',customerOnly:customer,milestones:true,responsible:true,progress:true,critical:true,dependencies:false,excludeComplete:false,selected:null}));setNotice('Selected-week Gantt downloaded separately. Attach it with the brief.');})}>Download this week’s Gantt</button>
 {customer&&<button disabled={!reviewed||!d.text.trim()} onClick={()=>void action(async()=>{await fresh(d);const r=await supabase.rpc('fd_save_weekly_brief',{p_project:d.project.id,p_week:start,p_revision:d.snapshot.revision,p_body:d.text});if(r.error)throw r.error;setNotice('Saved to this project’s Customer summary. Re-saving the same week replaces that saved brief.');})}>Save to customer summary</button>}
 </section>)}
 {drafts.length>0&&<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed these briefs and the information included for the intended audience.</label><button disabled={!reviewed} onClick={()=>void action(async()=>{for(const d of drafts)await fresh(d);await navigator.clipboard.writeText(drafts.map(d=>d.text).join('\n\n────────────────────\n\n'));setNotice('Copied for email. Paste into your email and review recipients.');})}>Copy for email</button><button disabled={!reviewed} onClick={()=>void action(async()=>{for(const d of drafts)await fresh(d);const {briefPdf}=await import('../lib/site-brief-pdf');const doc=await briefPdf(drafts.map(d=>d.text));doc.save(`FieldDocs_${start}_weekly_brief.pdf`);setNotice('PDF downloaded.');})}>Download brief PDF</button></>}
 </fieldset></div></dialog>;
}
