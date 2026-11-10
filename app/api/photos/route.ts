import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {adminDb,staffFromRequest} from '../../../lib/server/notifications';
import {allRows,body,checked,FileError,hashPin,json,newToken,staffAccess,uuid,textField} from '../../../lib/server/project-files';
import {digestToken,PHOTO_BUCKET,photoChanges,photoFailure,shortText,signedAsset} from '../../../lib/server/photos';
export const runtime='nodejs';
export async function POST(request:Request){try{
 const b=await body(request),actor=await staffFromRequest(request);if(!actor)throw new FileError('Sign in with an active staff account.',401);
 const db=adminDb();const action=String(b.action);
 if(action==='list'){
  let ids:string[]=[];
  if(b.project){const id=uuid(b.project);await staffAccess(request,id);ids=[id];}
  else if(actor.role!=='admin')ids=(await allRows<any>((f,t)=>db.from('project_staff').select('project_id').eq('staff_id',actor.id).order('project_id').range(f,t))).map(x=>x.project_id);
  if(!b.project&&actor.role!=='admin'&&!ids.length)return json({photos:[],next:null});
  const offset=Number(b.offset||0);if(!Number.isSafeInteger(offset)||offset<0)throw new FileError('Invalid page.');
  let q=db.from('fd_photos').select('*,projects(project_name)').eq('ready',true).eq('archived',b.archived===true);
  if(ids.length)q=q.in('project_id',ids);
  if(b.customer===true)q=q.eq('customer_visible',true);
  if(b.from)q=q.gte('taken_on',photoChanges({taken_on:b.from}).taken_on);
  if(b.to)q=q.lte('taken_on',photoChanges({taken_on:b.to}).taken_on);
  const rows=checked(await q.order('taken_on',{ascending:false}).order('id').range(offset,offset+59));
  const photos=await Promise.all(rows.map(async p=>({...p,project_name:p.projects?.project_name,...await signedAsset(db,p.display_asset),original_url:(await signedAsset(db,p.original_asset)).url})));
  return json({photos,next:rows.length===60?offset+60:null});
 }
 if(action==='report_photos'){
  const report=checked(await db.from('daily_reports').select('project_id').eq('id',uuid(b.report)).single());await staffAccess(request,report.project_id);
  const links=await allRows<any>((f,t)=>db.from('fd_photo_report_links').select('*').eq('report_id',b.report).order('photo_id').range(f,t));
  return json({photos:await Promise.all(links.map(async x=>({id:x.photo_id,caption:x.caption,asset_id:x.asset_id,...await signedAsset(db,x.asset_id)})))});
 }
 if(action==='link_report'){const report=uuid(b.report);const ids=Array.isArray(b.ids)?b.ids.map(uuid):[];if(ids.length>100)throw new FileError('Select up to 100 photos.');checked(await db.rpc('fd_photo_link_report',{p_report:report,p_ids:ids,p_actor:actor.id}));return json({ok:true});}
 if(action==='task_photos'){
  const task=checked(await db.from('project_tasks').select('project_id').eq('id',uuid(b.task)).single());await staffAccess(request,task.project_id);
  const links=checked(await db.from('fd_photo_task_links').select('photo_id').eq('task_id',b.task));
  const photos=[];for(const l of links){const p=checked(await db.from('fd_photos').select('*').eq('id',l.photo_id).single());if(p.project_id!==task.project_id)throw new FileError('Invalid linked photo.',403);photos.push({...p,project_name:p.projects?.project_name,...await signedAsset(db,p.display_asset)});}return json({photos});
 }
 if(action==='task'){
  const p=checked(await db.from('fd_photos').select('*').eq('id',uuid(b.photo)).single());await staffAccess(request,p.project_id);
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:request.headers.get('authorization')!}},auth:{persistSession:false}});
  const task=checked(await client.rpc('fd_photo_task',{p_photo:p.id,p_task:{id:uuid(b.id),title:textField(b.title,200),description:shortText(b.description||'',4000),assignee_id:b.assignee?uuid(b.assignee):null,due_date:b.due?photoChanges({taken_on:b.due}).taken_on:null,priority:'normal',status:'todo'}}));return json({task});
 }
 const project=uuid(b.project),access=await staffAccess(request,project);
 if(action==='reserve'){
  const filename=textField(b.filename,200).replace(/[\\/\x00-\x1f\x7f]/g,'_'),mime=String(b.mime),bytes=Number(b.bytes);
  if(!['image/jpeg','image/png','image/webp'].includes(mime)||!Number.isSafeInteger(bytes)||bytes<1||bytes>1073741824)throw new FileError('Use JPG, PNG or WebP, up to 1 GB subject to Storage limits.');
  const id=b.photo?uuid(b.photo):randomUUID(),asset=randomUUID();let version=0;
  if(b.photo){const p=checked(await db.from('fd_photos').select('*').eq('id',id).eq('project_id',project).eq('ready',true).eq('archived',false).single());version=p.version;if(b.version!==version)throw new FileError('Photo changed. Refresh before marking up.',409);}
  else checked(await db.from('fd_photos').insert({id,project_id:project,uploaded_by:actor.id,uploader_name:access.name,...photoChanges(b)}));
  const path=`${project}/${id}/${asset}.${mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp'}`;
  checked(await db.from('fd_photo_assets').insert({id:asset,photo_id:id,object_path:path,filename,mime,bytes,kind:b.photo?'markup':'original',created_by:actor.id,base_version:version}));
  const upload=checked(await db.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path,{upsert:false}));
  return json({photo:id,asset,path,token:upload.token,bucket:PHOTO_BUCKET});
 }
 if(action==='finish'){
  const a=checked(await db.from('fd_photo_assets').select('*').eq('id',uuid(b.asset)).single());
  const p=checked(await db.from('fd_photos').select('project_id').eq('id',a.photo_id).single());if(p.project_id!==project)throw new FileError('Photo access required.',403);
  const info=checked(await db.storage.from(PHOTO_BUCKET).info(a.object_path));
  if(Number(info.size)!==Number(a.bytes))throw new FileError('Upload size did not match. Retry the upload.');
  const signed=checked(await db.storage.from(PHOTO_BUCKET).createSignedUrl(a.object_path,60));
  const res=await fetch(signed.signedUrl,{
  headers:{Range:'bytes=0-15'},
  cache:'no-store',
  signal:AbortSignal.timeout(20000)
});
  if(!res.ok||!res.body)throw new FileError('Unable to verify uploaded photo. Retry.');
  const reader=res.body.getReader();const data=new Uint8Array(16);let received=0;try{while(received<16){const part=await reader.read();if(part.done)break;const piece=part.value.subarray(0,16-received);data.set(piece,received);received+=piece.length;}}finally{void reader.cancel().catch(()=>{});}
  const jpg=data[0]===255&&data[1]===216&&data[2]===255,png=[137,80,78,71,13,10,26,10].every((n,i)=>data[i]===n),webp=new TextDecoder().decode(data.slice(0,4))==='RIFF'&&new TextDecoder().decode(data.slice(8,12))==='WEBP';
  if(!(a.mime==='image/jpeg'?jpg:a.mime==='image/png'?png:webp))throw new FileError('The file contents are not a supported photo.');
  checked(await db.rpc('fd_photo_finish',{p_asset:a.id,p_actor:actor.id}));return json({ok:true});
 }
 if(action==='update'){
  const p=checked(await db.from('fd_photos').select('project_id').eq('id',uuid(b.id)).single());if(p.project_id!==project)throw new FileError('Photo access required.',403);
  if(!Number.isSafeInteger(b.version))throw new FileError('Missing photo version.');
  const photo=checked(await db.rpc('fd_photo_change',{p_id:b.id,p_actor:actor.id,p_version:b.version,p_changes:photoChanges(b)}));return json({photo});
 }
 if(action==='shares'){return json({shares:await allRows<any>((f,t)=>db.from('fd_photo_shares').select('id,title,expires_at,revoked,created_at').eq('project_id',project).order('created_at',{ascending:false}).order('id').range(f,t))});}
 if(action==='revoke'){checked(await db.from('fd_photo_shares').update({revoked:true}).eq('id',uuid(b.id)).eq('project_id',project));return json({ok:true});}
 if(action==='share'){
  const ids=Array.isArray(b.ids)?[...new Set(b.ids.map(uuid))]:[];if(!ids.length||ids.length>100)throw new FileError('Select 1–100 photos.');
  const days=Number(b.days);if(!Number.isInteger(days)||days<1||days>90)throw new FileError('Choose 1–90 days.');
  const rows=checked(await db.from('fd_photos').select('*').in('id',ids).eq('project_id',project).eq('ready',true).eq('archived',false));if(rows.length!==ids.length)throw new FileError('Some photos are unavailable. Refresh your selection.');
  const token=newToken(),items=rows.map(p=>({photo_id:p.id,asset_id:p.display_asset,caption:p.caption,taken_on:p.taken_on}));
  const share=checked(await db.from('fd_photo_shares').insert({project_id:project,token_hash:digestToken(token),title:textField(b.title,160),pin_hash:b.pin?hashPin(String(b.pin)):null,items,expires_at:new Date(Date.now()+days*86400000).toISOString(),created_by:actor.id}).select('id,expires_at').single());
  return json({share,path:`/shared-photos#${token}`});
 }
 throw new FileError('Unknown photo operation.');
 }catch(e){return photoFailure(e);}}
