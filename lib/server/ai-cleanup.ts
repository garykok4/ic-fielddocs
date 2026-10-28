import {adminDb} from './notifications';
export async function cleanupAIUploads(){
 const db=adminDb();let removed=0;
 // Bound each run; the next cron / upload request continues any remaining backlog.
 const r=await db.from('fielddocs_ai_uploads').select('id,object_path').lt('expires_at',new Date().toISOString()).order('expires_at').limit(100);
 if(r.error)throw Error('AI attachment cleanup needs the V7.8 migration.');
 for(let i=0;i<(r.data||[]).length;i+=25){const group=r.data!.slice(i,i+25);const deleted=await db.storage.from('fielddocs-ai-inputs').remove(group.map(x=>x.object_path));if(deleted.error)throw Error('AI attachment storage cleanup failed.');const rows=await db.from('fielddocs_ai_uploads').delete().in('id',group.map(x=>x.id));if(rows.error)throw Error('AI attachment metadata cleanup failed.');removed+=group.length;}
 return removed;
}
