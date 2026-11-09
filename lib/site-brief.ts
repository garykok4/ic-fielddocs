import { Activity, Snapshot, calculate } from '../app/schedule/engine';
import { isoDay, shiftDate, validDate, projectCalendar } from './work-calendar';
import { readableDate } from './dates';
export const briefWeek = (date:string) => {if(!validDate(date))throw Error('Choose a valid week.'); return shiftDate(date,-((isoDay(date).getUTCDay()+6)%7));};
/** Counts working days after the earlier date through the later date, excluding today for future deadlines. */
export function briefDue(due:string,asOf:string,closures:string[]=[]){
 const calendar=projectCalendar(closures),count=Math.abs(calendar.distance(asOf,due)),days=`${count} work ${count===1?'day':'days'}`;
 if(due<asOf)return `due ${readableDate(due)}, ${days} overdue${count===0?' (due date has passed)':''}`;
 if(due===asOf)return `due ${readableDate(due)}, today (0 work days)`;
 return `due ${readableDate(due)}, in ${days}`;
}
export function briefText(name:string,s:Snapshot,start:string,asOf:string,customer=false) {
 start=briefWeek(start);if(!validDate(asOf))throw Error('Choose a valid preparation date.');
 const end=shiftDate(start,6),nextStart=shiftDate(start,7),nextEnd=shiftDate(start,13);
 const tasks=calculate(s.tasks,s.links,asOf,s.closures).filter(t=>t.item_type==='task'&&t.status!=='complete'&&t.progress<100&&(!customer||t.customer_visible));
 const headings=['Overdue','Continuing this week and finishing this week','Starting this week and finishing this week','Continuing this week','Starting this week','Starting next week'];
 const groups:Activity[][]=headings.map(()=>[]);
 for(const t of tasks){
   // Overdue takes precedence, so an activity is never repeated elsewhere.
   if(t.finish<asOf){groups[0].push(t);continue;}
   if(t.start<=end&&t.finish>=start){const begins=t.start>=start,finishes=t.finish<=end;groups[finishes?(begins?2:1):(begins?4:3)].push(t);}
   else if(t.start>=nextStart&&t.start<=nextEnd)groups[5].push(t);
 }
 const lines=[`${name} — Weekly Site Brief`,`${readableDate(start,'always')} – ${readableDate(end,'always')}`,`Schedule revision ${s.revision} · Prepared ${readableDate(asOf,'always')}`, '', 'Here is what the schedule says should be happening on site.', `Open activities only. Dates are scheduled expectations. Overdue status and countdowns are as of ${readableDate(asOf,'always')}; weekends, Ontario holidays and project shutdowns are excluded from workday counts.`, ''];
 for(let i=0;i<groups.length;i++){
   const items=groups[i];if(!items.length)continue;
   const sort=i===0?'finish':'start';items.sort((a,b)=>a[sort].localeCompare(b[sort])||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
   lines.push(headings[i]+':');
   for(const t of items)lines.push(`• ${t.name} — ${briefDue(t.finish,asOf,s.closures)}`);
   lines.push('');
 }
 if(!groups.some(g=>g.length))lines.push('No overdue or open activities scheduled for this week or starting next week.','');
 lines.push('Let us know which trades need a push, and where you need information, decisions, or support.');
 return lines.join('\n');
}
