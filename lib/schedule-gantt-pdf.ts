import { LookaheadReport, daysBetween, validateLookahead } from './lookahead';
import { holidayOn, isoDay, projectCalendar, shiftDate, ontarioToday } from './work-calendar';
import { readableDate, readableDateTime } from './dates';

type RGB = [number, number, number];
const palette: RGB[] = [[95,147,211],[173,143,129],[190,117,197],[217,151,50],[65,160,135],[210,113,156],[121,139,65],[92,164,182]];
const safe = (s: string) => s.replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[’‘]/g, "'");
export async function createScheduleGanttPdf(report: LookaheadReport, providedFonts?: {regular:string;bold:string}) {
  const o = report.options;
  validateLookahead(o);
  const { jsPDF } = await import('jspdf');
  const sheet = o.layout === 'sheet';
  const rangeDays = daysBetween(o.start,o.end)+1;
  const groups = new Map<string, typeof report.tasks>();
  for (const t of report.tasks) {
    const key = t.parent_id || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const rowCount = report.tasks.length + groups.size;
  if (sheet && rowCount > 450) throw Error('Single-sheet export supports up to 450 rows including phases. Choose readable pages for this schedule.');
  const W = sheet ? Math.max(431.8, Math.min(3000, rangeDays * (rangeDays <= 90 ? 5 : 1.5) + 140)) : o.paper === 'letter' ? 279.4 : 431.8;
  const H = sheet ? Math.max(279.4, rowCount*13 + 120) : o.paper === 'letter' ? 215.9 : 279.4;
  if (H > 5000) throw Error('This schedule is too tall for one sheet. Choose readable pages.');
  const doc = new jsPDF({orientation: W >= H ? 'landscape' : 'portrait', unit:'mm',format:[W,H]});
  async function font(path:string) {
    const r = await fetch(path); if (!r.ok) throw Error('PDF fonts could not load. Refresh and try again.');
    const bytes = new Uint8Array(await r.arrayBuffer()); let binary = '';
    for(let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  const fonts=providedFonts || {regular:await font('/fonts/FieldDocsSans.ttf'),bold:await font('/fonts/FieldDocsSans-Bold.ttf')};
  doc.addFileToVFS('FieldDocsSans.ttf',fonts.regular);doc.addFont('FieldDocsSans.ttf','FieldDocs','normal');
  doc.addFileToVFS('FieldDocsSans-Bold.ttf',fonts.bold);doc.addFont('FieldDocsSans-Bold.ttf','FieldDocs','bold');
  doc.setFont('FieldDocs','normal');
  const M=12, bottom=H-32, left=o.details ? 100 : M, right=W-M, timelineWidth=right-left;
  const work=projectCalendar(report.closures).work;
  const special=(d:string)=>holidayOn(d)?.name || (report.closures?.includes(d) ? 'Project shutdown' : '');
  const numbers=new Map(report.tasks.map((t,i)=>[t.id,i+1]));
  const keyOf=(t:LookaheadReport['tasks'][number])=>o.colourBy==='phase' ? report.phases?.[t.parent_id||''] || 'Unphased' : t.trade || 'Unassigned trade';
  const keys=[...new Set(report.tasks.map(keyOf))].sort();
  const colors=new Map(keys.map((k,i)=>[k,palette[i%palette.length]]));
  const color=(t:LookaheadReport['tasks'][number])=>colors.get(keyOf(t))!;
  const text=(s:string,x:number,y:number,size=8,bold=false)=>{doc.setFont('FieldDocs',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(34,49,62);doc.text(safe(s),x,y);};
  const lines=(s:string,w:number,size=8):string[]=>{doc.setFont('FieldDocs','normal');doc.setFontSize(size);return doc.splitTextToSize(safe(s),w);};
  const fit=(s:string,w:number,size=8)=>{doc.setFontSize(size);let value=safe(s);if(doc.getTextWidth(value)<=w)return value;while(value && doc.getTextWidth(value+'...')>w)value=value.slice(0,-1);return value+'...';};
  let first=true;
  function page(title:string,start:string,end:string) {
    if(!first)doc.addPage([W,H],W>=H?'landscape':'portrait');first=false;
    doc.setFillColor(24,60,64);doc.rect(0,0,W,3,'F');
    text('I/C CONSTRUCTION  /  '+(o.fullProject?'PROJECT SCHEDULE':'LOOK-AHEAD'),M,12,9,true);
    text(fit(report.project,W-2*M,17),M,23,17,true);
    text(`${title}  |  ${readableDate(start,'always')} - ${readableDate(end,'always')}`,M,31,10);
    text(`${report.tasks.length} selected activities | Revision ${report.revision} | ${report.hidden} activities outside selection`,M,38,8);
    let x=M,y=45;
    for(const k of keys){const label=fit(k,65,7), width=Math.min(70,doc.getTextWidth(label)+9);if(x+width>right){x=M;y+=5;}
      doc.setFillColor(...colors.get(k)!);doc.rect(x,y-2.5,4,2.5,'F');text(label,x+6,y,7);x+=width;}
    // Extremely large trade lists are put in the optional register; avoid consuming the whole chart.
    return y+6;
  }
  type Row={phase:string;task?:LookaheadReport['tasks'][number]};
  const ordered:Row[]=[];
  for(const [id,tasks] of groups){ordered.push({phase:report.phases?.[id]||'Unphased activities'});for(const task of tasks)ordered.push({phase:report.phases?.[id]||'Unphased activities',task});}
  // Keep full look-aheads together; very long projects use two-year horizontal panels.
  const panelDays=sheet?rangeDays:Math.min(rangeDays,731);

  for(let start=o.start;start<=o.end;start=shiftDate(start,panelDays)){
    const end=shiftDate(start,panelDays-1)<o.end?shiftDate(start,panelDays-1):o.end;
    const days=daysBetween(start,end)+1, cw=timelineWidth/days;
    const scale=days<=42?'day':days<=366?'week':'month';
    const rows: Row[]=[];
    for(const [id,tasks] of groups){const overlapping=tasks.filter(t=>t.start<=end && t.finish>=start);
      if(overlapping.length){const phase=report.phases?.[id]||'Unphased activities';rows.push({phase});overlapping.forEach(task=>rows.push({phase,task}));}}
    let index=0,part=0;
    do{
      let y=page(`${o.fullProject?'Full project':'Gantt schedule'}${part?' (continued)':''}`,start,end);
      if(y>bottom-30)throw Error('Too many legend categories. Filter the export or use single-sheet layout.');
      if(index>0 && rows[index]?.task){text(fit(rows[index].phase+' (continued)',W-2*M,9),M,y+3,9,true);y+=7;}
      const top=y, gridTop=y+14;
      doc.setFillColor(237,242,246);doc.rect(M,y,W-2*M,14,'F');
      if(o.details)text('ACTIVITY / DATES / RESPONSIBILITY',M+2,y+9,7,true);
      const ticks:{date:string;offset:number;end:number}[]=[];
      for(let d=0;d<days;d++){
        const date=shiftDate(start,d), dt=isoDay(date);
        const tick=d===0 || (scale==='day'?dt.getUTCDay()===1:scale==='week'?dt.getUTCDay()===1:dt.getUTCDate()===1);
        if(tick)ticks.push({date,offset:d,end:days});
      }
      ticks.forEach((t,i)=>{t.end=ticks[i+1]?.offset??days;});
      if(scale==='day') {
        ticks.forEach(t=>{const span=(t.end-t.offset)*cw;if(span>9)text(fit(readableDate(t.date,'never'),span-1,7),left+t.offset*cw+1,top+4,7,true);});
        for(let d=0;d<days;d++){const date=shiftDate(start,d),x=left+d*cw;
          text(String(Number(date.slice(8))),x+Math.max(.4,cw/2-1),top+9,7);
          text('SMTWTFS'[isoDay(date).getUTCDay()],x+Math.max(.4,cw/2-1),top+12.5,6);}
      } else {
        // Two-level year/month or month/week headings stay legible on long schedules.
        const bands:{key:string;offset:number;end:number}[]=[];
        for(let d=0;d<days;d++){const date=shiftDate(start,d),key=date.slice(0,scale==='week'?7:4);
          if(bands.at(-1)?.key!==key)bands.push({key,offset:d,end:days});}
        bands.forEach((band,i)=>{band.end=bands[i+1]?.offset??days;const span=(band.end-band.offset)*cw;
          const label=scale==='week'?isoDay(shiftDate(start,band.offset)).toLocaleDateString('en-CA',{timeZone:'UTC',month:'short',year:'numeric'}):band.key;
          if(span>9)text(fit(label,span-1,7),left+band.offset*cw+.5,top+4,7,true);});
        ticks.forEach(t=>{const span=(t.end-t.offset)*cw;
          const label=scale==='week'?String(Number(t.date.slice(8))):isoDay(t.date).toLocaleDateString('en-CA',{timeZone:'UTC',month:'short'});
          if(span>4)text(fit(label,span-.5,6),left+t.offset*cw+.25,top+10,6);});
      }
      y=gridTop;
      const positions=new Map<string,{start:number;end:number;y:number;clippedStart:boolean;clippedEnd:boolean}>();
      while(index<rows.length){
        const row=rows[index],t=row.task;
        const detailLines=t&&o.details?lines(`#${numbers.get(t.id)} ${t.name}`,82,8):[];
        const info=t?[o.responsible?[t.trade,t.responsible_party].filter(Boolean).join(' / '):'',o.progress?`${t.progress}% complete`:''].filter(Boolean).join(' | '):'';
        const infoLines=t&&o.details?lines(info,82,6.5):[];
        const label=t?`#${numbers.get(t.id)} ${t.name}${info?' | '+info:''}`:'';
        const labelStart=t?Math.min(left+daysBetween(start,t.start<start?start:t.start)*cw,Math.max(left,right-Math.min(150,timelineWidth))):left;
        const labelLines=t&&!o.details?lines(label,right-labelStart-2,8):[];
        const rh=t?Math.max(13,o.details?detailLines.length*3.3+infoLines.length*2.7+8:labelLines.length*3.3+8):7;
        if(rh>bottom-gridTop-7)throw Error('An activity label is too long for this paper size. Use single-sheet layout or shorten the activity name.');
        if(y+rh+(t?0:13)>bottom && y>gridTop){if(sheet)throw Error('This detail layout exceeds one sheet. Turn off task details or choose readable pages.');break;}
        if(!t){doc.setFillColor(225,234,239);doc.rect(M,y,W-2*M,rh,'F');text(fit(row.phase,W-2*M-4,9),M+2,y+4.7,9,true);y+=rh;index++;continue;}
        if(index%2===0){doc.setFillColor(250,252,253);doc.rect(M,y,W-2*M,rh,'F');}
        for(let d=0;d<days;d++){
          const date=shiftDate(start,d);if(!work(date)){
            doc.setFillColor(...(special(date)?[254,239,209]:[237,242,247]) as RGB);doc.rect(left+d*cw,y,cw,rh,'F');}
        }
        doc.setDrawColor(215,224,232);doc.setLineWidth(.12);
        for(const tick of ticks)doc.line(left+tick.offset*cw,y,left+tick.offset*cw,y+rh);
        if(scale==='day')for(let d=0;d<=days;d++)doc.line(left+d*cw,y,left+d*cw,y+rh);
        const a=t.start<start?start:t.start,b=t.finish>end?end:t.finish;
        const x=left+daysBetween(start,a)*cw, finish=left+(daysBetween(start,b)+1)*cw;
        const mid=y+(o.details?rh/2:rh-4);
        if(o.details){text(detailLines.join('\n'),M+2,y+4,8,true);text(`${readableDate(t.start,'never')} - ${readableDate(t.finish,'never')}`,M+2,y+4+detailLines.length*3.3,6.5);if(info)text(infoLines.join('\n'),M+2,y+7+detailLines.length*3.3,6.5);}
        else {
          text(labelLines.join('\n'),labelStart+.5,y+3.7,8);
        }
        doc.setFillColor(...color(t));doc.setDrawColor(...(o.critical&&t.critical?[197,43,54]:color(t)) as RGB);doc.setLineWidth(o.critical && t.critical ? .6 : .15);
        if(t.is_milestone){const cx=Math.min(right-2,Math.max(left+2,x+cw/2));doc.lines([[2,2],[-2,2],[-2,-2],[2,-2]],cx,mid-2,[1,1],'FD',true);}
        else {doc.rect(x,mid-2,Math.max(.3,finish-x),4,'FD');if(o.progress && t.progress>0){doc.setFillColor(28,55,65);doc.rect(x,mid+1,Math.max(.2,(finish-x)*Math.min(100,t.progress)/100),.7,'F');}}
        if(t.start<start)text('<',x+.5,mid+1,7,true);if(t.finish>end)text('>',finish-2.5,mid+1,7,true);
        positions.set(t.id,{start:x,end:finish,y:mid,clippedStart:t.start<start,clippedEnd:t.finish>end});
        doc.setLineWidth(.1);doc.setDrawColor(227,233,238);doc.line(M,y+rh,right,y+rh);y+=rh;index++;
      }
      let offPage=0;
      if(o.dependencies){doc.setDrawColor(82,98,111);doc.setLineWidth(.25);
        for(const l of report.links){const a=positions.get(l.predecessor_id),b=positions.get(l.successor_id);
          if(!a&&!b)continue;
          if(!a||!b||b.clippedStart||((l.relation||'FS')==='SS'?a.clippedStart:a.clippedEnd)){offPage++;continue;}
          const x=(l.relation||'FS')==='SS'?a.start:a.end;
          const bend=Math.max(left+1,Math.min(right-1,x+2));
          doc.line(x,a.y,bend,a.y);doc.line(bend,a.y,bend,b.y-3);doc.line(bend,b.y-3,b.start,b.y-3);doc.line(b.start,b.y-3,b.start,b.y-1);
          doc.line(b.start,b.y-1,b.start-1,b.y-2);doc.line(b.start,b.y-1,b.start+1,b.y-2);
        }
      }

      const today=ontarioToday();if(today>=start&&today<=end){const x=left+(daysBetween(start,today)+.5)*cw;doc.setDrawColor(37,112,109);doc.setLineDashPattern([1,1],0);doc.line(x,gridTop,x,y);doc.setLineDashPattern([],0);}
      text(`${o.critical?'Red outline: critical | ':''}Diamond: milestone | Shaded: weekends / holidays / shutdowns | < >: continues outside dates`,M,H-24,7);
      text(`${offPage?`${offPage} dependency references continue outside this page; see activity register. `:''}${sheet?'Custom-size sheet: print at actual size or tile; fit-to-paper reduces text.':'Headers repeat on continuation pages.'}`,M,H-19,7);
      part++;
    }while(index<rows.length);
  }
  // The register is opt-in, except dependency exports always retain complete link references.
  if(o.register||o.dependencies){let y=page('Activity register',o.start,o.end);
    for(const t of report.tasks){const deps=o.dependencies?report.links.filter(l=>l.successor_id===t.id).map(l=>`${l.relation||'FS'} #${numbers.get(l.predecessor_id)} (${l.lag_work_days>=0?'+':''}${l.lag_work_days} work days)`).join(', '):'';
      const body=`#${numbers.get(t.id)} ${t.name}\n${readableDate(t.start,'always')} - ${readableDate(t.finish,'always')}${o.responsible?' | '+[t.trade,t.responsible_party].filter(Boolean).join(' / '):''}${o.progress?' | '+t.progress+'% complete':''}${o.critical&&t.critical?' | CRITICAL':''}${deps?'\nPredecessors: '+deps:''}`;
      for(const line of lines(body,W-2*M,9)){if(y>bottom)y=page('Activity register (continued)',o.start,o.end);text(line,M,y,9);y+=4.2;}y+=4;
    }
  }
  const pages=doc.getNumberOfPages();
  for(let p=1;p<=pages;p++){doc.setPage(p);doc.setDrawColor(200,212,222);doc.line(M,H-15,right,H-15);text(`Issued ${readableDateTime(report.issued)} | Schedule revision ${report.revision} | Page ${p} of ${pages}`,M,H-10,7);text('Saved schedule snapshot. Dates may change. Internal notes and personal to-dos excluded.',M,H-5,7);}
  return doc;
}
