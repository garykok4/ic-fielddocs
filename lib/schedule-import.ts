import {ScheduleDraft,DraftRow} from './schedule-draft';
import {validDate} from './work-calendar';
export type ImportSheet={name:string;rows:string[][]};
export type ImportBook={sheets:ImportSheet[];fingerprint:string};
export const IMPORT_FIELDS=['code','name','phase','trade','duration','start','finish','logic','notes','milestone'] as const;
export type Mapping=Record<typeof IMPORT_FIELDS[number],number>;
const aliases:Record<string,string[]>={code:['id','task id','code'],name:['task','name','task name','activity'],phase:['phase','group'],trade:['trade','responsible','contractor'],duration:['dur (wd)','duration','duration_work_days','work days'],start:['start','start date'],finish:['finish','finish date','end'],logic:['logic','dependencies','predecessors'],notes:['notes','description'],milestone:['milestone','is_milestone']};
export function guessMapping(row:string[]):Mapping{return Object.fromEntries(IMPORT_FIELDS.map(f=>[f,row.findIndex(v=>aliases[f].includes(v.trim().toLowerCase()))])) as Mapping;}
export function headerRow(sheet:ImportSheet){const n=sheet.rows.findIndex(r=>{const m=guessMapping(r);return m.name>=0&&m.duration>=0});return n<0?0:n;}
export function csvRows(text:string){const rows:string[][]=[];let row:string[]=[],v='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);rows.push(row);row=[];v='';}else v+=c;}if(quoted)throw Error('CSV has an unclosed quote.');if(v||row.length){row.push(v);rows.push(row);}return rows;}
export async function readScheduleFile(file:File):Promise<ImportBook>{
 if(!file.size||file.size>5*1024*1024)throw Error('Choose an XLSX or CSV file up to 5 MB.');const buffer=await file.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',buffer);const fingerprint=Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(/\.csv$/i.test(file.name)){const rows=csvRows(new TextDecoder().decode(buffer).replace(/^\uFEFF/,''));if(rows.length>1500)throw Error('Use a CSV with at most 1,500 rows.');return{sheets:[{name:'CSV',rows}],fingerprint};}
 if(!/\.xlsx$/i.test(file.name))throw Error('Supported formats: .xlsx and .csv.');
 const Excel=await import('exceljs');const wb=new (Excel.Workbook||Excel.default.Workbook)();await wb.xlsx.load(buffer);if(wb.worksheets.length>20)throw Error('Use a workbook with at most 20 sheets.');
 const value=(v:any):string=>{if(v===null||v===undefined)return '';if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='object'){if('formula'in v||'sharedFormula'in v){if(v.result===undefined)throw Error('A formula has no saved value. Open, calculate and save the workbook in Excel, then import again.');return value(v.result);}if(v.richText)return v.richText.map((r:any)=>r.text).join('');if(v.error)throw Error('Workbook contains an Excel error: '+v.error);return String(v.text||'');}return String(v);};
 const sheets=wb.worksheets.map(s=>{if(s.rowCount>1500||s.columnCount>250)throw Error('Limit each sheet to 1,500 rows and 250 columns.');const rows:string[][]=[];s.eachRow({includeEmpty:true},r=>{const a:string[]=[];for(let c=1;c<=Math.min(s.columnCount,30);c++)a.push(value(r.getCell(c).value));rows.push(a)});return{name:s.name,rows};});return{sheets,fingerprint};
}
export function draftFromSheet(book:ImportBook,sheet:number,header:number,m:Mapping,source:string,start:string):ScheduleDraft{
 if(m.name<0||m.duration<0)throw Error('Map Task name and Duration columns.');const data=book.sheets[sheet].rows;const rows:DraftRow[]=[];let phase='';
 const field=(r:string[],k:typeof IMPORT_FIELDS[number])=>(m[k]<0?'':r[m[k]]||'').trim();
 for(const [i,r] of data.slice(header+1).entries()){const name=field(r,'name'),dur=field(r,'duration');if(!name)continue;if(!dur&&!field(r,'code')){if(!/^legend|example/i.test(name))phase=name;continue;}
  const duration=Number(dur);if(!dur||!Number.isInteger(duration)||duration<0||duration>1000)throw Error(`Row ${header+i+2}: duration must be 0–1,000 whole work days.`);
  const from=field(r,'start'),to=field(r,'finish');if(from&&!validDate(from)||to&&!validDate(to))throw Error(`Row ${header+i+2}: dates must be Excel dates or YYYY-MM-DD.`);
  rows.push({code:field(r,'code')||`T${rows.length+1}`,name,phase:field(r,'phase')||phase||'Imported schedule',trade:field(r,'trade'),duration,start:from||start,sourceStart:from,sourceFinish:to,logic:field(r,'logic'),notes:field(r,'notes'),milestone:duration===0||/^(true|yes|1)$/i.test(field(r,'milestone')),included:true});}
 const assumptions=book.sheets.find(s=>/assumptions/i.test(s.name));const closures=assumptions?[...new Set(assumptions.rows.slice(6,16).flat().filter(validDate))]:[];const target=assumptions?.rows.find(r=>/target finish/i.test(r[0]))?.find(validDate)||'';const assumedStart=assumptions?.rows.find(r=>/schedule start/i.test(r[0]))?.find(validDate);
 return{source,start:assumedStart||rows.map(r=>r.start).sort()[0]||start,target,closures,assumptions:assumptions?assumptions.rows.filter(r=>r.some(x=>x)).map(r=>r.filter(Boolean).join(' — ')).join('\n').slice(0,20000):'',rows};
}
