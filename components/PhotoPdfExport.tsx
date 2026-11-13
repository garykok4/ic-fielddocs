"use client";
import {useState} from 'react';
import type {Photo} from '../lib/photos';
export default function PhotoPdfExport({photos,projectName,busy,run}:{photos:Photo[];projectName:string;busy:boolean;run:(operation:()=>Promise<void>)=>Promise<void>}){
 const [captions,setCaptions]=useState(true),[progress,setProgress]=useState('');
 return <><label className="photo-check"><input type="checkbox" checked={captions} disabled={busy} onChange={e=>setCaptions(e.target.checked)}/>Include captions in PDF</label><button disabled={busy||!photos.length} onClick={()=>void run(async()=>{
  const selected=[...photos],include=captions;setProgress('Preparing PDF…');
  try{const {createPhotoPdf}=await import('../lib/photo-pdf');const doc=await createPhotoPdf(projectName,selected,include,setProgress);const name=(projectName||'Project').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,80)||'Project';await doc.save(`${name}-photos.pdf`,{returnPromise:true});}
  finally{setProgress('');}
 })}>Download selected photos as PDF</button>{progress&&<span role="status" aria-live="polite">{progress}</span>}</>;
}
