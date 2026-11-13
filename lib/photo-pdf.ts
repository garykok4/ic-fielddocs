import type {Photo} from './photos';

// Process one image at a time; never retain a gallery of decoded full-size images.
async function imageForPdf(url:string){
 const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('Photo could not be downloaded. Refresh the photo list, select it again and retry.');
 const blob=await r.blob(),source=URL.createObjectURL(blob),img=new Image();
 const canvas=document.createElement('canvas');
 try {
  img.src=source;await img.decode();
  const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing is unavailable in this browser.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return {data:canvas.toDataURL('image/jpeg',.8),width:canvas.width,height:canvas.height};
 }finally{img.src='';canvas.width=canvas.height=1;URL.revokeObjectURL(source);}
}
export async function createPhotoPdf(project:string,photos:Photo[],captions:boolean,progress:(s:string)=>void){
 if(!photos.length)throw Error('Select at least one photo.');
 const {jsPDF}=await import('jspdf');
 const doc=new jsPDF({unit:'mm',format:'letter',compress:true});
 async function font(path:string){const r=await fetch(path,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('PDF font could not load. Please retry.');const bytes=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
 for(const [file,style] of [['FieldDocsSans.ttf','normal'],['FieldDocsSans-Bold.ttf','bold']]){doc.addFileToVFS(file,await font('/fonts/'+file));doc.addFont(file,'FieldDocs',style);}
 const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+'T12:00:00').toLocaleDateString('en-CA',{month:'long',day:'numeric',year:'numeric'}):'Date not recorded';
 function header(continuation=false){
  doc.setFillColor(24,43,58);doc.rect(0,0,216,20,'F');doc.setTextColor(255,255,255);doc.setFont('FieldDocs','bold');doc.setFontSize(12);doc.text('I/C  FIELD DOCS',15,13);
  doc.setFillColor(244,124,32);doc.rect(0,20,216,1.4,'F');doc.setTextColor(24,43,58);doc.setFontSize(16);
  const lines:string[]=doc.splitTextToSize(project||'Project',185);doc.text(lines.slice(0,2),15,32);doc.setFont('FieldDocs','normal');doc.setFontSize(9);doc.text(continuation?'PHOTO CAPTION / CONTINUED':'PROJECT PHOTOS',15,48);
 }
 for(let i=0;i<photos.length;i++){
  const p=photos[i];progress(`Preparing photo ${i+1} of ${photos.length}…`);
  let img;try{img=await imageForPdf(p.url);}catch(e){throw Error(`Photo ${i+1} (${p.filename}): ${(e as Error).message} No PDF was downloaded.`);}
  if(i)doc.addPage();header();doc.setFontSize(10);doc.text(`Photo ${i+1} of ${photos.length}  |  ${date(p.taken_on)}`,15,57);
  const scale=Math.min(185/img.width,158/img.height),w=img.width*scale,h=img.height*scale;
  doc.addImage(img.data,'JPEG',15+(185-w)/2,64+(158-h)/2,w,h,undefined,'FAST');
  if(captions&&p.caption?.trim()){
   doc.setFontSize(10);const lines:string[]=doc.splitTextToSize(p.caption.replace(/\r\n/g,'\n'),185);let y=232;
   for(const line of lines){if(y>253){doc.addPage();header(true);doc.setFontSize(10);doc.text(`Photo ${i+1} of ${photos.length}`,15,57);y=67;}doc.text(line,15,y);y+=5;}
  }
 }
 const pages=doc.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setDrawColor(215,223,229);doc.line(15,261,200,261);doc.setFont('FieldDocs','normal');doc.setFontSize(8);doc.setTextColor(80,95,108);doc.text('I/C Construction / Project photos',15,267);doc.text(`${i} / ${pages}`,200,267,{align:'right'});}
 return doc;
}
