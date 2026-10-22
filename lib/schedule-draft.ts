import {calculate,Task,Link,Snapshot} from '../app/schedule/engine';
import {validDate,projectCalendar} from './work-calendar';
export type DraftRow={code:string;name:string;phase:string;trade:string;duration:number;start:string;sourceStart:string;sourceFinish:string;logic:string;notes:string;milestone:boolean;included:boolean};
export type ScheduleDraft={source:string;start:string;target:string;closures:string[];assumptions:string;rows:DraftRow[]};
export type DraftEdge={code:string;relation:'FS'|'SS';lag:number};
export function parseLogic(text:string):DraftEdge[]{
 if(!text.trim()||/^start\b/i.test(text.trim()))return [];
 let relation:'FS'|'SS'='FS';return text.replace(/\([^)]*\)/g,'').split(/[;,]/).filter(s=>s.trim()).map(part=>{const m=part.trim().match(/^(?:(FS|SS)\s+)?([A-Za-z0-9_-]+)(?:\s*([+-])\s*(\d+)\s*(?:d|wd)?)?$/i);if(!m)throw Error(`Cannot read dependency "${part.trim()}". Use FS T1 +2d; SS T2 -1d.`);if(m[1])relation=m[1].toUpperCase() as 'FS'|'SS';return{code:m[2],relation,lag:(m[3]==='-'?-1:1)*Number(m[4]||0)};});
}
export function buildDraft(d:ScheduleDraft,project:string,preserveStarts=false){
 if(!validDate(d.start)||d.start<'1900-01-01'||d.start>'2200-12-31')throw Error('Choose a start date between 1900 and 2200.');
 if(d.target&&!validDate(d.target))throw Error('Invalid target finish.');
 projectCalendar(d.closures);const rows=d.rows.filter(r=>r.included);if(!rows.length||rows.length>500)throw Error('Select 1–500 activities.');
 const codes=new Set<string>();for(const r of d.rows){if(!/^[A-Za-z0-9_-]{1,40}$/.test(r.code)||codes.has(r.code))throw Error(`Missing, invalid or duplicate task ID: ${r.code}`);codes.add(r.code);if(r.name.length>1000||r.notes.length>5000)throw Error('Task name or notes too long.');}
 const base=(id:string,name:string):Task=>({id,project_id:project,name,trade:'',start_date:d.start,duration_work_days:1,progress:0,status:'not_started',is_milestone:false,sort_order:0,notes:'',item_type:'task',parent_id:null,stage:'construction',date_confidence:'estimated',customer_visible:false});
 const phases=[...new Set(rows.map(r=>r.phase||'Imported schedule'))];const tasks:Task[]=phases.map((n,i)=>({...base('phase:'+i,n),item_type:'phase',sort_order:i*1000}));const links:Link[]=[];
 for(const [i,r] of rows.entries()){const deps=parseLogic(r.logic);for(const e of deps){if(!rows.some(r=>r.code===e.code))throw Error(`${r.code} depends on ${e.code}, which is missing or excluded. Include it or edit the dependency.`);links.push({id:`link:${links.length}`,project_id:project,predecessor_id:e.code,successor_id:r.code,lag_work_days:e.lag,relation:e.relation});}
  tasks.push({...base(r.code,r.name),trade:r.trade,start_date:preserveStarts?r.sourceStart||r.start||d.start:deps.length?d.start:r.start||d.start,duration_work_days:r.milestone?0:r.duration,is_milestone:r.milestone,parent_id:'phase:'+phases.indexOf(r.phase||'Imported schedule'),sort_order:phases.indexOf(r.phase||'Imported schedule')*1000+i+1,notes:r.notes});}
 const activities=calculate(tasks,links,undefined,d.closures);const differences=rows.flatMap(r=>{const a=activities.find(a=>a.id===r.code)!;return r.sourceStart&&r.sourceFinish&&(r.sourceStart!==a.start||r.sourceFinish!==a.finish)?[`${r.code}: source ${r.sourceStart}–${r.sourceFinish}; calculated ${a.start}–${a.finish}`]:[]});
 return{tasks,links,activities,differences,finish:activities.filter(a=>a.item_type==='task').map(a=>a.finish).sort().at(-1)||d.start};
}
export function materializeDraft(d:ScheduleDraft,project:string,preserve:boolean,snapshot:Snapshot){const b=buildDraft(d,project,preserve);const ids=new Map(b.tasks.map(t=>[t.id,crypto.randomUUID()]));const offset=Math.max(0,...snapshot.tasks.map(t=>t.sort_order))+1;return{tasks:b.tasks.map(t=>({...t,id:ids.get(t.id)!,parent_id:t.parent_id?ids.get(t.parent_id)!:null,sort_order:t.sort_order+offset})),links:b.links.map(l=>({...l,id:crypto.randomUUID(),predecessor_id:ids.get(l.predecessor_id)!,successor_id:ids.get(l.successor_id)!}))};}
export function validateAIDraft(raw:unknown,start:string,target:string,closures:string[]):ScheduleDraft{
 const r=raw as ScheduleDraft;if(!r||!Array.isArray(r.rows)||r.rows.length<1||r.rows.length>120||typeof r.assumptions!=='string'||r.assumptions.length>20000)throw Error('AI returned an incomplete or oversized draft. Try a smaller scope.');
 const rows=r.rows.map((x,i)=>{if(!x||['code','name','phase','trade','logic','notes'].some(k=>typeof (x as any)[k]!=='string')||!Number.isInteger(x.duration)||x.duration<0||x.duration>1000||typeof x.milestone!=='boolean')throw Error(`AI task ${i+1} is invalid. Generate again.`);return{...x,start,sourceStart:'',sourceFinish:'',included:true};});
 const d={source:'AI schedule',start,target,closures,assumptions:r.assumptions,rows};buildDraft(d,'preview');return d;
}
