import {createHash} from 'node:crypto';
import {adminDb} from './notifications';
import {checked,FileError,json} from './project-files';
export const PHOTO_BUCKET='fielddocs-photos';
export const digestToken=(s:string)=>createHash('sha256').update(s).digest('hex');
export function shortText(v:unknown,max:number){if(typeof v!=='string'||v.length>max)throw new FileError(`Text must be at most ${max} characters.`);return v.trim();}
export function photoChanges(b:Record<string,unknown>){const c:Record<string,unknown>={};for(const [key,max] of [['caption',1000],['album',100],['location',160]] as const)if(key in b)c[key]=shortText(b[key],max);
 if('tags'in b){if(!Array.isArray(b.tags)||b.tags.length>20)throw new FileError('Use at most 20 tags.');c.tags=[...new Set(b.tags.map(x=>shortText(x,40)).filter(Boolean))];}
 for(const k of ['customer_visible','archived'])if(k in b){if(typeof b[k]!=='boolean')throw new FileError('Invalid photo setting.');c[k]=b[k];}
 if('taken_on'in b){const d=String(b.taken_on);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw new FileError('Choose a valid photo date.');c.taken_on=d;}return c;}
export async function signedAsset(db:ReturnType<typeof adminDb>,id:string,seconds=900){const a=checked(await db.from('fd_photo_assets').select('*').eq('id',id).eq('ready',true).single());const u=checked(await db.storage.from(PHOTO_BUCKET).createSignedUrl(a.object_path,seconds));return {url:u.signedUrl,filename:a.filename};}
export function photoFailure(e:unknown){if(e instanceof FileError)return json({error:e.message},e.status);const x=e as {code?:string;message?:string};if(['42P01','PGRST202','PGRST205'].includes(x.code||''))return json({error:'Run the V7.13 photo database update in Supabase first.'},503);if(x.code==='P0001')return json({error:x.message},409);console.error('Photo operation failed',x.code||'',x.message||'');return json({error:'Photo operation failed. Check server configuration and try again.'},500);}
