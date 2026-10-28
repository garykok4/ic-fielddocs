import {createHmac,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {adminDb,staffFromRequest} from './notifications';
import {allRows,BUCKET,checked,FileError,uuid} from './project-files';
import {AISource,AI_MAX_DOCUMENTS,aiFileCheck} from '../ai-documents';
export const AI_BUCKET='fielddocs-ai-inputs';
export async function aiAccess(request:Request,project:string,kind:string){
 if(kind!=='budget'&&kind!=='schedule')throw new FileError('Invalid builder.');
 const actor=await staffFromRequest(request);if(!actor)throw new FileError('Sign in with an active staff account.',401);
 const db=adminDb();
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:request.headers.get('authorization')||''}},auth:{persistSession:false,autoRefreshToken:false}});
 if(kind==='budget'){const r=await client.rpc('fielddocs_can_estimate');if(r.error||r.data!==true)throw new FileError('Estimating access required.',403);}
 if(kind==='schedule'&&!project)throw new FileError('Select a project.');
 if(project){uuid(project);const r=await client.rpc('schedule_v75_read',{p_project:project});if(r.error)throw new FileError('Project access required.',403);}
 return {db,actor:actor.id,client};
}
export async function resolveSource(request:Request,project:string,kind:string,source:AISource,context?:Awaited<ReturnType<typeof aiAccess>>){
 const {db,actor}=context||await aiAccess(request,project,kind);uuid(source?.id);
 if(source.type==='revision'){
  if(!project||!checked(await db.rpc('fd_file_allowed',{p_project:project,p_actor:actor})))throw new FileError('Project file access required.',403);
  const r=checked(await db.from('fd_revisions').select('*').eq('id',source.id).eq('ready',true).maybeSingle());
  if(!r)throw new FileError('Drawing revision is unavailable.',404);
  const d=checked(await db.from('fd_documents').select('*').eq('id',r.document_id).eq('project_id',project).maybeSingle());
  if(!d)throw new FileError('This drawing belongs to a different project.',403);
  return {db,actor,bucket:BUCKET,path:r.object_path as string,filename:r.filename as string,bytes:Number(r.bytes),label:`${d.number} · ${d.title} · Rev ${r.label} · ${r.issue_date} · ${d.current_revision===r.id?'Published':'Private / not current published revision'}`};
 }
 if(source.type!=='upload')throw new FileError('Invalid document source.');
 const r=checked(await db.from('fielddocs_ai_uploads').select('*').eq('id',source.id).eq('owner',actor).eq('kind',kind).maybeSingle());
 if(!r||r.project_id!==(project||null)||Date.parse(r.expires_at)<=Date.now())throw new FileError('Temporary attachment expired or is unavailable. Attach it again.',403);
 return {db,actor,bucket:AI_BUCKET,path:r.object_path as string,filename:r.filename as string,bytes:Number(r.bytes),label:r.filename as string};
}
export async function aiProjectFiles(request:Request,project:string,kind:string){
 const {db,actor}=await aiAccess(request,project,kind);
 if(!project||!checked(await db.rpc('fd_file_allowed',{p_project:project,p_actor:actor})))throw new FileError('Project file access required.',403);
 const docs=await allRows((a,b)=>db.from('fd_documents').select('id,number,title,discipline,current_revision').eq('project_id',project).order('id').range(a,b));
 const files:any[]=[];
 for(let i=0;i<docs.length;i+=100){const group=docs.slice(i,i+100);const revs=await allRows((a,b)=>db.from('fd_revisions').select('id,document_id,filename,bytes,label,issue_date,uploaded_at').in('document_id',group.map(d=>d.id)).eq('ready',true).order('id').range(a,b));
 for(const r of revs){const d=group.find(d=>d.id===r.document_id)!;files.push({...r,number:d.number,title:d.title,discipline:d.discipline,published:d.current_revision===r.id});}}
 return files.sort((a,b)=>a.number.localeCompare(b.number,undefined,{numeric:true})||b.uploaded_at.localeCompare(a.uploaded_at));
}
function signature(value:string){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('Missing server configuration.');return createHmac('sha256',key).update('fielddocs-ai-v78:'+value).digest('base64url');}
export function signAnalysis(value:Record<string,unknown>){const encoded=Buffer.from(JSON.stringify({...value,expires:Date.now()+12*3600000})).toString('base64url');return encoded+'.'+signature(encoded);}
export function verifyAnalysis(receipt:unknown,owner:string,project:string,kind:string){
 if(typeof receipt!=='string'||receipt.length>50000)throw Error('Invalid document analysis.');
 const [raw,sig,...rest]=receipt.split('.');const expected=Buffer.from(signature(raw));const actual=Buffer.from(sig||'');
 if(rest.length||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error('Document analysis could not be verified. Analyze it again.');
 const v=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
 if(v.owner!==owner||v.project!==project||v.kind!==kind||v.expires<Date.now())throw Error('Document analysis expired or belongs to another workspace. Analyze it again.');
 return v as {source:AISource;filename:string;label:string;notes:string};
}
export async function analysisContent(request:Request,project:string,kind:string,raw:unknown){
 const context=await aiAccess(request,project,kind);const {actor}=context;
 if(!Array.isArray(raw)||raw.length>AI_MAX_DOCUMENTS)throw Error(`Select no more than ${AI_MAX_DOCUMENTS} documents per draft.`);
 const content:any[]=[];const names:string[]=[];const manifest:string[]=[];const seen=new Set<string>();
 for(const receipt of raw){const v=verifyAnalysis(receipt,actor,project,kind);const key=v.source.type+':'+v.source.id;if(seen.has(key))throw Error('Duplicate document analysis.');seen.add(key);
  // Recheck permissions and revision identity at generation, not just when selected.
  const src=await resolveSource(request,project,kind,v.source,context);aiFileCheck(src.filename,src.bytes);
  if(v.filename!==src.filename)throw Error('Document changed. Analyze it again.');
  names.push(src.filename);manifest.push(src.label);content.push({type:'input_text',text:`Document evidence summary (AI extracted; may omit details). Source: ${src.label}. Filename: ${src.filename}\n${v.notes}`});
 }
 return {content,files:names,manifest};
}
export async function boundedForm(request:Request){const reader=request.body?.getReader();if(!reader)throw Error('Missing request.');const chunks:Uint8Array[]=[];let n=0;while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>3*1024*1024){await reader.cancel();throw Error('Too much analysis text in one draft. Select fewer documents.');}chunks.push(r.value);}return new Response(Buffer.concat(chunks),{headers:{'content-type':request.headers.get('content-type')||''}}).formData();}
