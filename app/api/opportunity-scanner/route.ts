import {NextResponse} from 'next/server';
import Parser from 'rss-parser';
import {createHash} from 'node:crypto';
import {adminDb,staffFromRequest} from '../../../lib/server/notifications';
import {SCAN_SOURCES,candidate,canonicalUrl,normalizedTitle} from '../../../lib/opportunities';
export const runtime='nodejs';export const maxDuration=60;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function POST(request:Request){
 let db:ReturnType<typeof adminDb>|null=null,runId:string|null=null;
 try{
  const staff=await staffFromRequest(request);if(!staff)return NextResponse.json({error:'Sign in as active staff.'},{status:401});db=adminDb();
  if(staff.role!=='admin'){const access=await db.from('fielddocs_estimating_access').select('staff_id').eq('staff_id',staff.id).maybeSingle();if(access.error)throw access.error;if(!access.data)return NextResponse.json({error:'Estimating access required.'},{status:403});}
  const lease=await db.rpc('fd_opportunity_scan_start',{p_actor:staff.id});if(lease.error)return NextResponse.json({error:lease.error.message},{status:409});runId=lease.data;
  const parser=new Parser();const results:{name:string;count:number;error?:string}[]=[],items:any[]=[];
  // Bounded parallel requests. All source URLs are fixed server-side news searches.
  for(let i=0;i<SCAN_SOURCES.length;i+=5){await Promise.all(SCAN_SOURCES.slice(i,i+5).map(async([name,query])=>{try{const url='https://news.google.com/rss/search?'+new URLSearchParams({q:query+' when:180d',hl:'en-CA',gl:'CA',ceid:'CA:en'});const r=await fetch(url,{signal:AbortSignal.timeout(7000),cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);const xml=await r.text();if(xml.length>2000000)throw Error('Feed too large');const feed=await parser.parseString(xml);let count=0;for(const x of feed.items.slice(0,30)){const date=x.isoDate||x.pubDate||'';const parsed=Date.parse(date);if(!Number.isFinite(parsed)||parsed<Date.now()-180*86400000||parsed>Date.now()+86400000)continue;const c=candidate(x.title||'',x.contentSnippet||x.content||'',x.link||'',name,new Date(parsed).toISOString());if(c&&c.source_url){items.push(c);count++;}}results.push({name,count});}catch(e){results.push({name,count:0,error:(e as Error).message});}}));}
  // Retain legacy records and their notes/status in the new grouped tracker. Never delete the old tables.
  const legacy:any[]=[];
  for(let offset=0;offset<10000;offset+=500){const r=await db.from('opportunities').select('*').order('id').range(offset,offset+499);if(r.error){if(r.error.code!=='42P01'&&r.error.code!=='PGRST205')throw r.error;break;}legacy.push(...r.data||[]);if((r.data||[]).length<500)break;}
  const candidates=[...legacy.map(o=>({...o,source:o.source||'Previous tracker',legacy_id:String(o.id),source_url:canonicalUrl(o.source_url||''),published:null})),...items].filter(o=>o.title).map(o=>({...o,keys:[...(o.source_url?['url:'+hash(o.source_url)]:[]),'title:'+hash(normalizedTitle(o.title)),...(o.legacy_id?['legacy:'+o.legacy_id]:[])]}));
  const saved=await db.rpc('fd_opportunity_ingest',{p_items:candidates});if(saved.error)throw saved.error;
  const summary={...saved.data,sources:results,articles:items.length,legacy:legacy.length,coverage:'Public news search across 14 topic/source groups; not a direct crawl of tender portals or municipal planning files.'};
  const finished=await db.from('fd_opportunity_scans').update({finished_at:new Date().toISOString(),summary}).eq('id',runId);if(finished.error)throw finished.error;
  return NextResponse.json(summary);
 }catch(e){if(db&&runId)await db.from('fd_opportunity_scans').update({finished_at:new Date().toISOString(),summary:{error:(e as Error).message}}).eq('id',runId);return NextResponse.json({error:(e as Error).message},{status:500});}
}
export async function GET(){return NextResponse.json({error:'Use the authenticated Scan for opportunities button.'},{status:405});}
