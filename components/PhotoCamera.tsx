"use client";
import {useEffect,useRef,useState} from 'react';

export default function PhotoCamera({close,captured}:{close:()=>void;captured:(file:File)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),video=useRef<HTMLVideoElement>(null);
 const stream=useRef<MediaStream|null>(null),alive=useRef(false),taking=useRef(false);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function stop(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;}
 useEffect(()=>{
  alive.current=true;let cancelled=false;dialog.current?.showModal();
  const hidden=()=>{if(document.hidden){stop();setReady(false);setError('Camera paused. Close and reopen Take photo to continue.');}};
  document.addEventListener('visibilitychange',hidden);
  void (async()=>{
   try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera unavailable here. Use Choose photos to upload from your camera roll.');
    const s=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920,max:1920},height:{ideal:1080,max:1920},frameRate:{ideal:15,max:15}}});
    if(cancelled||document.hidden){s.getTracks().forEach(t=>t.stop());return;}
    stream.current=s;
    if(video.current){video.current.srcObject=s;await video.current.play();}
   }catch(e){
    if(cancelled)return;stop();
    setError((e as Error).name==='NotAllowedError'?'Camera permission was not granted. Allow camera access for Field Docs, or use Choose photos.':'Could not open the camera. Close this window and use Choose photos to upload from your camera roll.');
   }
  })();
  return()=>{cancelled=true;alive.current=false;stop();document.removeEventListener('visibilitychange',hidden);};
 },[]);
 async function take(){
  const v=video.current;if(taking.current||!v||!v.videoWidth||!v.videoHeight)return;
  taking.current=true;setBusy(true);setError('');
  const canvas=document.createElement('canvas');
  try{
   const scale=Math.min(1,1920/Math.max(v.videoWidth,v.videoHeight));
   canvas.width=Math.max(1,Math.round(v.videoWidth*scale));canvas.height=Math.max(1,Math.round(v.videoHeight*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not prepare photo.');
   ctx.drawImage(v,0,0,canvas.width,canvas.height);
   stop();setReady(false);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not capture photo.')),'image/jpeg',0.9));
   if(!alive.current)return;
   captured(new File([blob],'site-photo-'+Date.now()+'.jpg',{type:'image/jpeg',lastModified:Date.now()}));
  }catch{if(alive.current)setError('Could not capture photo. Close and reopen the camera, or use Choose photos.');}
  finally{canvas.width=canvas.height=1;taking.current=false;if(alive.current)setBusy(false);}
 }
 return <dialog ref={dialog} className="photos-dialog" aria-labelledby="photo-camera-title" onCancel={e=>{e.preventDefault();close();}}>
  <header><h2 id="photo-camera-title">Take photo</h2><button onClick={close}>Close</button></header>
  <p>Capture a site photo up to 1920 pixels. For full-resolution originals, use Choose photos.</p>
  {error&&<p role="alert" className="photos-error">{error}</p>}
  <video ref={video} autoPlay muted playsInline onLoadedData={()=>setReady(true)} style={{display:'block',width:'100%',maxHeight:'55dvh',objectFit:'contain',background:'#182b3a'}}/>
  <div className="photos-toolbar"><button className="photos-primary" disabled={!ready||busy||!!error} onClick={()=>void take()}>{busy?'Preparing photo…':ready?'Capture photo':'Opening camera…'}</button></div>
  <p className="photos-muted">Capture adds one photo to your upload queue. It is not saved to your camera roll. Choose Upload / retry queue to save it to the project.</p>
 </dialog>;
}
