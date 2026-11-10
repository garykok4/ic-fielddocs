import {supabase} from './supabase';
export type Photo={id:string;project_id:string;project_name?:string;caption:string;album:string;location:string;tags:string[];taken_on:string;created_at:string;uploader_name:string;version:number;customer_visible:boolean;archived:boolean;original_asset:string;display_asset:string;url:string;original_url:string;filename:string};
export type PhotoPage={photos:Photo[];next:number|null};
export async function photoApi(action:string,data:Record<string,unknown>={}) {
 const {data:session}=await supabase.auth.getSession();
 if(!session.session)throw Error('Sign in to manage photos.');
 const r=await fetch('/api/photos',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.session.access_token}`},body:JSON.stringify({action,...data})});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Photo operation failed.');return result;
}
export async function allProjectPhotos(project:string,filters:Record<string,unknown>={}) : Promise<Photo[]> {
 const out:Photo[]=[];let offset:number|null=0;
 while(offset!==null){const r:PhotoPage=await photoApi('list',{project,offset,...filters});out.push(...r.photos);offset=r.next;}return out;
}
export const PHOTO_MIMES=['image/jpeg','image/png','image/webp'];
export function photoInput(file:File){if(!PHOTO_MIMES.includes(file.type))throw Error('Use JPG, PNG or WebP photos. Convert HEIC photos to JPG first.');if(file.size<1||file.size>1073741824)throw Error('Photos must be between 1 byte and 1 GB, subject to your Supabase Storage plan.');}
export function filterPhotos(photos:Photo[],search:string,album:string,from:string,to:string){const q=search.toLocaleLowerCase();return photos.filter(p=>(!album||p.album===album)&&(!from||p.taken_on>=from)&&(!to||p.taken_on<=to)&&(!q||[p.caption,p.location,p.uploader_name,p.filename,...p.tags].join(' ').toLocaleLowerCase().includes(q)));}

export function photoUuid(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
