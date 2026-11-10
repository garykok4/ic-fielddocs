import {OrientationRecord,companyName,orientationChecks,ackLabel} from './orientation-history';
import {readableDateTime} from './dates';
export async function orientationPdf(rows:OrientationRecord[],providedFonts?:{regular:string;bold:string}){
 if(!rows.length)throw Error('Select orientation records first.');
 const {jsPDF}=await import('jspdf');const doc=new jsPDF({unit:'mm',format:'letter'});
 async function font(path:string){const r=await fetch(path);if(!r.ok)throw Error('PDF fonts could not load.');const b=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);}
 const fonts=providedFonts||{regular:await font('/fonts/FieldDocsSans.ttf'),bold:await font('/fonts/FieldDocsSans-Bold.ttf')};
 doc.addFileToVFS('Orientation.ttf',fonts.regular);doc.addFont('Orientation.ttf','Orientation','normal');doc.addFileToVFS('OrientationBold.ttf',fonts.bold);doc.addFont('OrientationBold.ttf','Orientation','bold');
 let y=0;
 function page(){doc.setTextColor(24,42,58);doc.setDrawColor(249,115,22);doc.line(16,20,200,20);doc.setFont('Orientation','bold');doc.setFontSize(10);doc.text('I/C CONSTRUCTION INC. / ORIENTATION RECORD',16,15);y=31;}
 function para(text:string,bold=false,size=11){doc.setFont('Orientation',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(text,180) as string[];for(const line of lines){if(y>250){doc.addPage();page();doc.setFont('Orientation',bold?'bold':'normal');doc.setFontSize(size);}doc.text(line,16,y);y+=6;}y+=4;}
 rows.forEach((r,i)=>{if(i)doc.addPage();page();para(r.worker_name||'Name not recorded',true,17);para('Company group: '+companyName(r),true);para('Company as entered: '+(r.company_name||'Not recorded'));para('Project: '+(r.project_name||'Not recorded'));para('Phone: '+(r.phone||'Not recorded'));para('Completed: '+(r.completed_at?readableDateTime(r.completed_at):'Not recorded'));para('Saved acknowledgements',true,13);for(const [key,label] of orientationChecks)para(label+': '+ackLabel(r[key]));para('Record ID: '+r.id,false,9);para('Company grouping is administrative. The original company entry and acknowledgement values above are preserved. This is a record summary, not a signed certificate.',false,9);});
 const n=doc.getNumberOfPages();for(let i=1;i<=n;i++){doc.setPage(i);doc.setFont('Orientation','normal');doc.setFontSize(8);doc.text(`Exported ${readableDateTime(new Date().toISOString())} | Page ${i} of ${n}`,16,270);}return doc;
}
