'use client';
import {Upload} from 'tus-js-client';
export async function uploadLargeFile(bucket:string,path:string,token:string,file:File,mime:string,progress:(percent:number)=>void=()=>{}) {
 const base=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
 if(base.hostname.endsWith('.supabase.co'))base.hostname=base.hostname.replace('.supabase.co','.storage.supabase.co');
 const endpoint=base.origin+'/storage/v1/upload/resumable';
 await new Promise<void>((resolve,reject)=>{
  const upload=new Upload(file,{endpoint,headers:{'x-signature':token,'x-upsert':'false'},chunkSize:6*1024*1024,retryDelays:[0,1000,3000,5000,10000],uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,
   // Include the reserved path, avoiding accidental resume into another revision.
   fingerprint:async()=>[bucket,path,file.size,file.lastModified].join('|'),
   metadata:{bucketName:bucket,objectName:path,contentType:mime,cacheControl:'0'},
   onProgress:(n,total)=>progress(Math.round(n/total*100)),onSuccess:()=>resolve(),onError:e=>reject(Error('Upload interrupted: '+e.message+' Check Storage limits and retry.'))});
  void upload.findPreviousUploads().then(previous=>{if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start();}).catch(reject);
 });
}
