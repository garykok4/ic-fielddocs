'use client';
import BriefPreview from './BriefPreview';
import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import {readableDate} from '../lib/dates';
export default function SavedSiteBriefs({project}:{project:string}){
 const [rows,setRows]=useState<{id:string;week_start:string;body:string;schedule_revision:number}[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;setRows([]);setError('');supabase.from('fd_weekly_briefs').select('id,week_start,body,schedule_revision').eq('project_id',project).order('week_start',{ascending:false}).limit(12).then(({data,error}:any)=>{if(live){if(error)setError(error.message);else setRows(data||[]);}});return()=>{live=false;};},[project]);
 return <section><h2>Weekly site briefs</h2>{error&&<p role="alert">Weekly briefs unavailable: {error}</p>}{!error&&!rows.length&&<p>No briefs saved yet. Generate a customer edition from the schedule, review it, then save it here.</p>}{rows.map(r=><article key={r.id} style={{breakInside:'auto',borderTop:'1px solid #ddd',padding:'16px 0'}}><h3>Week of {readableDate(r.week_start)} · Schedule revision {r.schedule_revision}</h3><BriefPreview text={r.body}/></article>)}<small>Latest 12 saved weeks. Each brief is a reviewed snapshot; later schedule edits do not change it.</small></section>;
}
