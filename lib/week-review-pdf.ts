import { Activity } from "../app/schedule/engine";
import { readableDate, readableDateTime } from "./dates";
import { ReviewPhoto } from "./week-review";
export type ReviewImage = ReviewPhoto & {caption:string;data:string;width:number;height:number};
export async function reviewImage(photo:ReviewPhoto,caption:string):Promise<ReviewImage> {
  let url:URL; try { url=new URL(photo.file_url); } catch {throw Error('Invalid photo URL.');}
  if(url.protocol!=='https:' && !(url.protocol==='http:' && url.hostname==='127.0.0.1')) throw Error('Photo URL must use HTTPS.');
  const response=await fetch(url.href,{signal:AbortSignal.timeout(30000),credentials:'omit'});
  if(!response.ok) throw Error('A selected photo could not be downloaded. Deselect it or retry.');
  const blob=await response.blob();
  if(blob.size>30*1024*1024) throw Error('A photo is larger than 30 MB. Deselect it and upload a smaller copy.');
  const source=URL.createObjectURL(blob);
  try {
    const img=new Image(); img.src=source; await img.decode();
    const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing is unavailable.');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return {...photo,caption,data:canvas.toDataURL('image/jpeg',.85),width:canvas.width,height:canvas.height};
  } catch {throw Error('A selected photo could not be decoded. Use a JPEG, PNG or WebP image, or deselect it.');}
  finally {URL.revokeObjectURL(source);}
}
export async function createWeekReviewPdf(input:{project:string;start:string;end:string;revision:number;tasks:Activity[];photos:ReviewImage[];summary:string},providedFonts?:{regular:string;bold:string}) {
  const {jsPDF}=await import('jspdf');const doc=new jsPDF({unit:'mm',format:'letter'});
  async function font(path:string){const r=await fetch(path);if(!r.ok)throw Error('PDF fonts could not load.');const b=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);}
  const fonts=providedFonts||{regular:await font('/fonts/FieldDocsSans.ttf'),bold:await font('/fonts/FieldDocsSans-Bold.ttf')};
  doc.addFileToVFS('Review.ttf',fonts.regular);doc.addFont('Review.ttf','Review','normal');doc.addFileToVFS('ReviewBold.ttf',fonts.bold);doc.addFont('ReviewBold.ttf','Review','bold');doc.setFont('Review');
  const clean=(s:string)=>s.replace(/[–—]/g,'-').replace(/[^\x20-\x7e\n\r\t\u00a0-\u00ff]/g,'?');
  const issued=readableDateTime(new Date().toISOString());let y=0;
  function text(s:string,x:number,yy:number,size=10){doc.setFontSize(size);doc.setTextColor(30,49,66);doc.text(clean(s),x,yy);}
  function wrap(s:string,size=10,width=185):string[]{doc.setFontSize(size);return doc.splitTextToSize(clean(s),width);}
  function header(next=false){if(next)doc.addPage();doc.setFillColor(243,112,24);doc.rect(0,0,216,3,'F');text('I/C CONSTRUCTION  /  WEEK IN REVIEW',15,15,9);doc.setFont('Review','bold');const title=wrap(input.project,17);text(title.slice(0,2).join('\n'),15,26,17);doc.setFont('Review','normal');y=title.length>1?41:33;text(`${readableDate(input.start,'always')} - ${readableDate(input.end,'always')}`,15,y,11);y+=12;}
  function paragraph(s:string,size=10){for(const line of wrap(s,size)){if(y>249)header(true);text(line,15,y,size);y+=5;}y+=3;}
  header();paragraph(`Prepared ${issued} | Schedule revision ${input.revision}`,8);
  paragraph('Scheduled work for the selected week. Dates, status and progress reflect the saved schedule at export time; they are not a historical record of work completed during this week.',9);
  if(input.summary.trim()){doc.setFont('Review','bold');paragraph('Weekly summary',12);doc.setFont('Review','normal');paragraph(input.summary);}
  doc.setFont('Review','bold');paragraph(`Scheduled activities (${input.tasks.length})`,12);doc.setFont('Review','normal');
  if(!input.tasks.length)paragraph('No scheduled activities selected.');
  for(const t of input.tasks){if(y>222)header(true);doc.setFont('Review','bold');paragraph(t.name);doc.setFont('Review','normal');paragraph(`${readableDate(t.start,'always')} - ${readableDate(t.finish,'always')} | ${t.status.replaceAll('_',' ')} | ${t.progress}%\nResponsible: ${t.responsible_party||t.trade||'Unassigned'}`,9);doc.setDrawColor(221,229,235);doc.line(15,y-2,200,y-2);y+=3;}
  // One photo per page preserves portrait and landscape proportions and makes captions readable.
  for(let i=0;i<input.photos.length;i++){const p=input.photos[i];header(true);doc.setFont('Review','bold');paragraph(`Project photo ${i+1} of ${input.photos.length}`,12);doc.setFont('Review','normal');paragraph(`Report date: ${readableDate(p.report_date,'always')}`,9);const scale=Math.min(185/p.width,145/p.height),w=p.width*scale,h=p.height*scale;doc.addImage(p.data,'JPEG',15+(185-w)/2,y,w,h);y+=h+8;if(p.caption.trim())paragraph(p.caption,10);}
  for(let i=1;i<=doc.getNumberOfPages();i++){doc.setPage(i);doc.setDrawColor(220,228,236);doc.line(15,259,200,259);text(`Week in review | Issued ${issued}`,15,265,7);text(`${i} / ${doc.getNumberOfPages()}`,187,265,8);}
  return doc;
}
