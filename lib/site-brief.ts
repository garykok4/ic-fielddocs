import { Activity, Snapshot, calculate } from '../app/schedule/engine';
import { isoDay, shiftDate, validDate } from './work-calendar';
import { readableDate } from './dates';
export type BriefTodo = {id:string;title:string;due_date:string|null;status:string};
export const briefWeek = (date:string) => {if(!validDate(date))throw Error('Choose a valid week.'); return shiftDate(date,-((isoDay(date).getUTCDay()+6)%7));};
export function briefText(name:string,s:Snapshot,start:string,todos:BriefTodo[],asOf:string,customer=false) {
  start=briefWeek(start); const end=shiftDate(start,6);
  const all=calculate(s.tasks,s.links,asOf,s.closures);
  const tasks=all.filter(t=>t.item_type==='task'&&(!customer||t.customer_visible));
  const open=(t:Activity)=>t.status!=='complete'&&t.progress<100;
  const overlap=(t:Activity)=>t.start<=end&&t.finish>=start;
  const lines=[`${name} — Weekly Site Brief`,`${readableDate(start,'always')} – ${readableDate(end,'always')}`,`Schedule revision ${s.revision} · Prepared ${readableDate(asOf,'always')}`, '', 'Here is what the schedule says should be happening on site this week.', 'Dates are scheduled expectations. Status and progress reflect the current records, not a historical site confirmation.', ''];
  const groups=[...s.tasks.filter(t=>t.item_type==='phase').sort((a,b)=>a.sort_order-b.sort_order).map(p=>({id:p.id,name:p.name})),{id:null,name:'Other activities'}];
  for(const group of groups){
    const rows=tasks.filter(t=>t.parent_id===group.id).sort((a,b)=>a.start.localeCompare(b.start)||a.name.localeCompare(b.name));
    const sections:[string,Activity[]][]=[['Continuing this week',rows.filter(t=>overlap(t)&&t.start<start&&open(t))],['Starting this week',rows.filter(t=>t.start>=start&&t.start<=end&&open(t))],['Scheduled to finish this week',rows.filter(t=>t.finish>=start&&t.finish<=end&&open(t))],['Needs attention',rows.filter(t=>open(t)&&(t.finish<asOf&&t.finish<=end||t.critical&&overlap(t)||t.status==='on_hold'&&t.start<=end))]];
    if(!sections.some(([,r])=>r.length))continue;
    lines.push(group.name.toUpperCase(),'');
    for(const [heading,items] of sections){if(!items.length)continue;lines.push(heading+':');for(const t of items){const tags=[t.critical?'critical path':'',t.finish<asOf?'overdue as of preparation':'',t.status==='on_hold'?'on hold':''].filter(Boolean);lines.push(`• ${t.name} (${readableDate(t.start)} – ${readableDate(t.finish)})${t.trade?' · '+t.trade:''}${tags.length?' ['+tags.join('; ')+']':''}`);}lines.push('');}
  }
  if(!customer){const upcoming=todos.filter(t=>t.status!=='done'&&t.due_date&&t.due_date<=shiftDate(end,14)).sort((a,b)=>(a.due_date||'').localeCompare(b.due_date||''));if(upcoming.length){lines.push('UPCOMING PREPARATIONS & OPEN TO-DOS','Due through '+readableDate(shiftDate(end,14))+'; includes earlier outstanding items.');for(const t of upcoming)lines.push(`• ${t.title} — due ${readableDate(t.due_date!)}${t.status==='blocked'?' [blocked]':''}`);lines.push('');}}
  if(lines.length===7)lines.push('No open scheduled activities for this week.','');
  lines.push('Let us know which trades need a push, and where you need information, decisions, or support.');
  return lines.join('\n');
}
