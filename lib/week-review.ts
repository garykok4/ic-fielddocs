import { supabase } from "./supabase";
import { Activity, Snapshot, calculate } from "../app/schedule/engine";
import { isoDay, shiftDate, validDate } from "./work-calendar";
export type ReviewPhoto = {id: string; report_id: string; file_url: string; report_date: string};
export type ReviewData = {snapshot: Snapshot; tasks: Activity[]; photos: ReviewPhoto[]};
export function weekStart(date: string) {
  if (!validDate(date)) throw Error("Choose a valid week.");
  return shiftDate(date, -((isoDay(date).getUTCDay()+6)%7));
}
export async function loadWeekReview(project: string, start: string): Promise<ReviewData> {
  if (!validDate(start)) throw Error("Choose a valid week.");
  const end = shiftDate(start,6);
  const schedule = await supabase.rpc("schedule_v75_read", {p_project:project});
  if (schedule.error) throw schedule.error;
  const reports: {id:string;report_date:string}[] = [];
  for (let offset=0;;offset+=500) {
    const r = await supabase.from("daily_reports").select("id,report_date").eq("project_id",project).gte("report_date",start).lte("report_date",end).order("id").range(offset,offset+499);
    if (r.error) throw r.error;
    reports.push(...r.data || []); if ((r.data || []).length<500) break;
  }
  const photos: ReviewPhoto[]=[];
  for(let i=0;i<reports.length;i+=100) {
    const batch=reports.slice(i,i+100), dates=new Map(batch.map(r=>[r.id,r.report_date]));
    for(let offset=0;;offset+=500) {
      const r=await supabase.from("attachments").select("id,report_id,file_url").in("report_id",batch.map(r=>r.id)).order("id").range(offset,offset+499);
      if(r.error) throw r.error;
      for(const p of r.data || []) if(dates.has(p.report_id)) photos.push({...p,report_date:dates.get(p.report_id)!});
      if((r.data || []).length<500) break;
    }
  }
  return {snapshot:schedule.data, tasks:calculate(schedule.data.tasks,schedule.data.links, undefined, schedule.data.closures).filter(t=>t.item_type==='task' && t.start<=end && t.finish>=start),photos:photos.sort((a,b)=>a.report_date.localeCompare(b.report_date)||a.id.localeCompare(b.id))};
}
export function reviewSignature(data: ReviewData) {
  return JSON.stringify([data.snapshot.revision,data.photos.map(p=>[p.id,p.report_date,p.file_url])]);
}
