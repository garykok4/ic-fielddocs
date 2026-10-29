import {Resend} from 'resend';
import {adminDb,staffFromRequest} from '../../../../lib/server/notifications';
import {staffInput,UUID} from '../../../../lib/staff-admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
class StaffError extends Error{constructor(message:string,public status=400){super(message);}}
const headers={'Cache-Control':'no-store'};
const checked=(r:any)=>{if(r.error)throw r.error;return r.data;};
async function access(request:Request){const p=await staffFromRequest(request);if(!p||p.role!=='admin')throw new StaffError('Administrator access required.',403);return p;}
function failure(e:any){const raw=String(e?.message||'');if(raw==='Enter a name, role and valid project selections.')e=new StaffError(raw);return Response.json({error:e instanceof StaffError?raw:raw.includes('another session')?'Staff settings changed in another session. Reload before saving.':raw.includes('schema cache')||raw.includes('does not exist')?'Run the V7.9 staff-management SQL in Supabase first.':raw.includes('configuration')?'Server configuration is incomplete. Check SUPABASE_SERVICE_ROLE_KEY.':'Staff operation failed. Reload the directory and try again. No invitation delivery has been confirmed.'},{status:e instanceof StaffError?e.status:raw.includes('another session')?409:503,headers});}
function mailConfig(){
 const raw=process.env.FIELDDOCS_APP_URL;let url:URL;
 try{url=new URL(raw||'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();}catch{throw new StaffError('Set FIELDDOCS_APP_URL to your HTTPS FieldDocs address in Vercel.',503);}
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM)throw new StaffError('Set RESEND_API_KEY and RESEND_FROM in Vercel to send invitations.',503);
 return new URL('/account-setup',url.origin);
}
export async function GET(request:Request){try{const actor=await access(request);const result=checked(await adminDb().rpc('fd_staff_list',{p_actor:actor.id}));let emailReady=true;try{mailConfig();}catch{emailReady=false;}return Response.json({...result,emailReady},{headers});}catch(e){return failure(e);}}
export async function POST(request:Request){
 let createdId:string|null=null,profileSaved=false;
 try{
  const actor=await access(request),db=adminDb();
  const text=await request.text();if(text.length>30000)throw new StaffError('Request is too large.');
  let b:Record<string,unknown>;try{b=JSON.parse(text);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();}catch{throw new StaffError('Invalid request.');}
  if(!['save','invite','email'].includes(String(b.action)))throw new StaffError('Unknown action.');
  if(b.action==='save'){
   if(typeof b.id!=='string'||!UUID.test(b.id)||!Number.isSafeInteger(b.revision)||Number(b.revision)<0)throw new StaffError('Invalid staff member or revision.');
   const input=staffInput(b);
   if(b.id===actor.id&&(!input.p_active||input.p_role!=='admin'))throw new StaffError('You cannot deactivate or demote your own administrator account.');
   checked(await db.rpc('fd_staff_save',{p_actor:actor.id,p_id:b.id,p_revision:b.revision,...input}));
   return Response.json({message:'Staff settings saved.'},{headers});
  }
  const target=mailConfig();
  const directory=checked(await db.rpc('fd_staff_list',{p_actor:actor.id}));
  let email:string,kind:'invite'|'recovery',userId:string|undefined,input:ReturnType<typeof staffInput>|undefined;
  if(b.action==='invite'){
   input=staffInput(b);if(!input.p_active)throw new StaffError('New invitations need active access. You can deactivate a user later.');
   email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
   if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new StaffError('Enter a valid email address.');
   if(directory.users.some((u:any)=>u.email.toLowerCase()===email))throw new StaffError('This account already exists. Find it in Team & access, save its access settings, then send a setup email.',409);
   if(input.p_projects.some(id=>!directory.projects.some((p:any)=>p.id===id)))throw new StaffError('Choose valid projects.');
   kind='invite';
  }else{
   const person=directory.users.find((u:any)=>u.id===b.id);
   if(!person||!person.active)throw new StaffError('Save an active staff profile before sending an email.');
   email=person.email;userId=person.id;kind=person.confirmed?'recovery':'invite';
  }
  if(!checked(await db.rpc('fd_file_limit',{p_key:'staff-mail:'+email.toLowerCase(),p_max:1,p_seconds:60})))throw new StaffError('Wait one minute before sending another email to this person.',429);
  if(!checked(await db.rpc('fd_file_limit',{p_key:'staff-mail-actor:'+actor.id,p_max:50,p_seconds:86400})))throw new StaffError('Daily staff-email limit reached. Try again tomorrow.',429);
  const generated=await db.auth.admin.generateLink({type:kind,email,options:{redirectTo:target.toString()}});
  if(generated.error||!generated.data?.user||!generated.data.properties?.hashed_token)throw new StaffError('Could not create the setup link. Refresh the directory before retrying; the account may already exist.',502);
  if(userId&&generated.data.user.id!==userId)throw new StaffError('Account changed. Refresh before trying again.',409);
  userId=generated.data.user.id;
  if(input){createdId=userId;checked(await db.rpc('fd_staff_save',{p_actor:actor.id,p_id:userId,p_revision:0,...input}));profileSaved=true;}
  // Recheck administrator and target access before sending. Never return tokens to the browser.
  const latest=checked(await db.rpc('fd_staff_list',{p_actor:actor.id}));
  if(!latest.users.some((u:any)=>u.id===userId&&u.active))throw new StaffError('Account is no longer active. Email was not sent.',409);
  const fragment=new URLSearchParams({token_hash:generated.data.properties.hashed_token,type:kind});target.hash=fragment.toString();
  const sent=await new Resend(process.env.RESEND_API_KEY!).emails.send({from:process.env.RESEND_FROM!,to:email,subject:kind==='invite'?'Your FieldDocs invitation':'Set your FieldDocs password',text:`You have been given access to I/C Construction FieldDocs.\n\nOpen this one-time link to choose your password:\n${target.toString()}\n\nIf the link has expired, ask your administrator to send a new setup email. If you were not expecting this message, contact I/C Construction.`});
  if(sent.error)throw new StaffError('The account is saved, but the email provider did not accept the setup email. Refresh the directory, check Resend configuration, then use Send setup email.',502);
  // Delivery accepted is not the same as inbox delivery.
  await db.from('fielddocs_staff_audit').insert({actor:actor.id,staff_id:userId,action:'setup_email_accepted',details:{provider_id:sent.data?.id||null}});
  return Response.json({message:'Setup email accepted by the email provider. Ask the team member to check their inbox and spam folder.'},{headers});
 }catch(e){if(createdId&&!profileSaved)return Response.json({error:'An authentication account was created, but staff setup did not finish. Refresh Team & access, find the account under Needs setup, save its access settings, then send a setup email.'},{status:409,headers});return failure(e);}
}
