"use client";
import { useEffect, useRef, useState } from "react";
import { loadWeekReview, ReviewData, reviewSignature, weekStart } from "../lib/week-review";
import { ontarioToday, shiftDate } from "../lib/work-calendar";
import { readableDate } from "../lib/dates";
import "./lookahead-export.css";
import "./week-review.css";
export default function WeekReviewExport({project,projectName,close}:{project:string;projectName:string;close:()=>void}) {
  const [start,setStart]=useState(()=>shiftDate(weekStart(ontarioToday()),-7));
  const [data,setData]=useState<ReviewData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [tasks,setTasks]=useState<Set<string>>(new Set()),[photos,setPhotos]=useState<Set<string>>(new Set()),[captions,setCaptions]=useState<Record<string,string>>({});
  const [summary,setSummary]=useState(''),[pdf,setPdf]=useState('');
  const ref=useRef<HTMLDialogElement>(null),preview=useRef(''),sequence=useRef(0),generating=useRef(false);
  const end=shiftDate(start,6);
  function invalidate(){if(preview.current)URL.revokeObjectURL(preview.current);preview.current='';setPdf('');}
  function accept(next:ReviewData){setData(next);setTasks(new Set(next.tasks.filter(t=>t.customer_visible).map(t=>t.id)));setPhotos(new Set());setCaptions({});}
  useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();return()=>{sequence.current++;if(preview.current)URL.revokeObjectURL(preview.current);if(previous instanceof HTMLElement)previous.focus();};},[]);
  useEffect(()=>{const seq=++sequence.current;setData(null);setBusy(true);setError('');setNotice('');invalidate();setTasks(new Set());setPhotos(new Set());setCaptions({});setSummary('');loadWeekReview(project,start).then(next=>{if(seq===sequence.current)accept(next);}).catch(e=>{if(seq===sequence.current)setError(e.message);}).finally(()=>{if(seq===sequence.current)setBusy(false);});},[project,start]);
  function toggle(id:string,selected:Set<string>,set:(s:Set<string>)=>void){invalidate();const n=new Set(selected);n.has(id)?n.delete(id):n.add(id);set(n);}
  async function generate(){if(!data||generating.current)return;generating.current=true;setBusy(true);setError('');setNotice('');invalidate();try{
    const fresh=await loadWeekReview(project,start);
    if(reviewSignature(fresh)!==reviewSignature(data)){accept(fresh);setNotice('The saved schedule or report photos changed. Review the refreshed selections and preview again.');return;}
    const {createWeekReviewPdf,reviewImage}=await import('../lib/week-review-pdf');
    const images=[];
    for(const p of fresh.photos.filter(p=>photos.has(p.id))){setNotice(`Preparing photo ${images.length+1} of ${photos.size}…`);images.push(await reviewImage(p,captions[p.id]||''));}
    const doc=await createWeekReviewPdf({project:projectName,start,end,revision:fresh.snapshot.revision,tasks:fresh.tasks.filter(t=>tasks.has(t.id)),photos:images,summary});
    preview.current=URL.createObjectURL(doc.output('blob'));setPdf(preview.current);setNotice('PDF ready. Review the preview before sharing.');
  }catch(e){setError((e as Error).message);}finally{generating.current=false;setBusy(false);}}
  return <dialog ref={ref} className="la-dialog review-dialog" aria-labelledby="review-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <header><div><div className="la-eyebrow">FIELD DOCS / CLIENT UPDATE</div><h2 id="review-title">Export week in review</h2><p>{projectName}</p></div><button disabled={busy} onClick={close}>Close</button></header>
    <div className="la-body">
      {error&&<p role="alert" className="la-error">{error}</p>}{notice&&<p role="status" className="la-notice">{notice}</p>}
      <fieldset disabled={busy}><div className="la-grid"><label>Week containing<input type="date" value={start} onChange={e=>{if(e.target.value)setStart(weekStart(e.target.value));}}/></label><p>{readableDate(start,'always')} – {readableDate(end,'always')}<br/>Monday through Sunday</p></div>
      <p className="la-info">Tasks overlap the selected week. Status and progress are current as of export, not a historical completion record. Photos come from this project’s daily reports dated within the week, regardless of when the photos were uploaded.</p>
      <label>Weekly summary (optional)<textarea maxLength={4000} rows={4} value={summary} onChange={e=>{invalidate();setSummary(e.target.value);}} placeholder="Highlights, progress and items to flag for the client"/></label>
      <div className="la-selection-heading"><h3>Scheduled tasks · {tasks.size} selected</h3><button onClick={()=>{invalidate();setTasks(new Set(data?.tasks.map(t=>t.id)));}}>Select all tasks</button><button onClick={()=>{invalidate();setTasks(new Set());}}>Clear tasks</button></div>
      <p>Customer-visible tasks are selected initially. Review before including internal activities.</p>
      <div className="la-selection">{data?.tasks.map(t=><label key={t.id}><input type="checkbox" checked={tasks.has(t.id)} onChange={()=>toggle(t.id,tasks,setTasks)}/><span>{t.name}<small>{readableDate(t.start)} – {readableDate(t.finish)} · {t.status.replaceAll('_',' ')} · {t.progress}%{!t.customer_visible?' · Internal activity':''}</small></span></label>)}{data&&!data.tasks.length&&<p>No scheduled tasks overlap this week. You can still export selected photos or a written summary.</p>}</div>
      <div className="la-selection-heading"><h3>Report photos · {photos.size} selected</h3><button onClick={()=>{invalidate();setPhotos(new Set(data?.photos.map(p=>p.id)));}}>Select all photos</button><button onClick={()=>{invalidate();setPhotos(new Set());}}>Clear photos</button></div>
      <p>Photos start unselected. Select the images you want your client to see.</p>
      <div className="review-photos">{data?.photos.map((p,i)=><article key={p.id}><label><input type="checkbox" checked={photos.has(p.id)} onChange={()=>toggle(p.id,photos,setPhotos)}/>Photo {i+1} · {readableDate(p.report_date)}<img src={p.file_url} alt={`Report photo ${i+1}`} loading="lazy" onError={e=>{e.currentTarget.alt='Photo unavailable or unsupported. Deselect it to export.';}}/></label><a href={`/reports/${p.report_id}`} target="_blank" rel="noreferrer">View source report</a><label>Caption for photo {i+1}<textarea rows={2} maxLength={500} value={captions[p.id]||''} onChange={e=>{invalidate();setCaptions(old=>({...old,[p.id]:e.target.value}));}}/></label></article>)}</div>
      {data&&!data.photos.length&&<p>No report photos found for this project and week.</p>}
      <p className="la-info">Internal task notes and report text are excluded. Your chosen photos and captions are included. The export downloads a PDF; it does not send it to anyone.</p>
      </fieldset>
      <footer><button className="la-primary" disabled={busy||!data||(!tasks.size&&!photos.size&&!summary.trim())} onClick={()=>void generate()}>{busy?'Please wait…':'Preview week in review'}</button>{pdf&&<a href={pdf} download={`${projectName.replace(/[^a-z0-9_-]/gi,'_').slice(0,60)}_${start}_week_in_review.pdf`}>Download PDF</a>}</footer>
      {pdf&&<iframe title="Week in review PDF preview" src={pdf}/>}
    </div>
  </dialog>;
}
