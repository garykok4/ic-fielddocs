import {adminDb} from '../../../lib/server/notifications';
import {body,checked,FileError,json,verifyPin} from '../../../lib/server/project-files';
import {digestToken,photoFailure,signedAsset} from '../../../lib/server/photos';
export const runtime='nodejs';
export async function POST(request:Request){try{const b=await body(request),token=String(b.token||'');if(!/^[a-f0-9]{64}$/.test(token))throw new FileError('This photo link is unavailable.',404);const db=adminDb();
 // Per-link limit prevents PIN guessing; never log the token or PIN.
 if(!checked(await db.rpc('fd_file_limit',{p_key:'photos:'+digestToken(token),p_max:120,p_seconds:600})))throw new FileError('Too many attempts. Wait 10 minutes and try again.',429);
 const share=checked(await db.from('fd_photo_shares').select('*').eq('token_hash',digestToken(token)).eq('revoked',false).gt('expires_at',new Date().toISOString()).maybeSingle());
 if(!share)throw new FileError('This photo link has expired or been revoked.',404);
 if(share.pin_hash&&!verifyPin(String(b.pin||''),share.pin_hash))return json({error:b.pin?'Incorrect PIN.':'Enter the PIN supplied by your project manager.',pin_required:true},401);
 const project=checked(await db.from('projects').select('project_name').eq('id',share.project_id).single());
 const ids=share.items.map((x:any)=>x.photo_id);const live=checked(await db.from('fd_photos').select('id').in('id',ids).eq('project_id',share.project_id).eq('archived',false).eq('ready',true));const available=new Set(live.map(p=>p.id));
 const photos=[];for(const item of share.items){if(!available.has(item.photo_id))continue;const a=checked(await db.from('fd_photo_assets').select('id').eq('id',item.asset_id).eq('photo_id',item.photo_id).eq('ready',true).single());photos.push({id:item.photo_id,caption:item.caption,taken_on:item.taken_on,url:(await signedAsset(db,a.id,60)).url});}
 return json({title:share.title,project:project.project_name,expires_at:share.expires_at,photos});
 }catch(e){return photoFailure(e);}}
