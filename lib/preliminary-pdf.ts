import {BudgetDraft,estimateBudget} from './preliminary';
import {money,DEFAULT_BANDS} from './fee-calculator';
import {readableDateTime} from './dates';
export async function buildBudgetPdf(name:string,project:string,draft:BudgetDraft,providedFonts?:{regular:string;bold:string}){
 const result=estimateBudget(draft);const {jsPDF}=await import('jspdf');const doc=new jsPDF({unit:'mm',format:'letter'});
 async function font(path:string){const r=await fetch(path);if(!r.ok)throw Error('PDF fonts could not load.');const b=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);}
 const fonts=providedFonts||{regular:await font('/fonts/FieldDocsSans.ttf'),bold:await font('/fonts/FieldDocsSans-Bold.ttf')};
 doc.addFileToVFS('regular.ttf',fonts.regular);doc.addFont('regular.ttf','FieldDocs','normal');doc.addFileToVFS('bold.ttf',fonts.bold);doc.addFont('bold.ttf','FieldDocs','bold');
 const W=215.9,H=279.4,M=15;let y=0,first=true;
 function page(title:string){if(!first)doc.addPage();first=false;doc.setFillColor(24,60,64);doc.rect(0,0,W,3,'F');doc.setFont('FieldDocs','bold');doc.setFontSize(13);doc.setTextColor(24,60,64);doc.text('I/C CONSTRUCTION | PRELIMINARY BUDGET',M,15);doc.setFontSize(10);doc.text(title,M,23);y=33;}
 function text(s:string,size=9,bold=false){doc.setFont('FieldDocs',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(35,50,66);const lines=doc.splitTextToSize(s,W-2*M) as string[];for(const line of lines){if(y>H-23)page('Budget detail (continued)');doc.setFont('FieldDocs',bold?'bold':'normal');doc.setFontSize(size);doc.text(line,M,y);y+=size*.42+1;}y+=2;}
 page('Class D planning estimate • CAD before HST');text(name,16,true);text(project||'Standalone estimate');text('Issued '+readableDateTime(new Date().toISOString()));
 text(result.missing?`INCOMPLETE: ${result.missing} active lines are unpriced. Totals cover priced scope only.`:'Preliminary planning estimate — estimator review required.',10,true);
 text('Quantities are conceptual. AI allowances are unverified and are not supplier quotations. No HST, land purchase or financing included.');
 for(const [label,value] of [['Direct construction',result.direct],['Contingency',result.contingency],['Engineering',result.engineering],['Architectural',result.architect],['PJM fee',result.fee.pjm],['Site supervision',result.fee.supervision],['Site trailer',result.fee.trailer],['Total before HST',result.budget]] as [string,number][])text(`${label}: ${money(value)}`,11,label==='Total before HST');
 text(`Planning range: ${money(result.low)} – ${money(result.high)} (±${draft.inputs.rangePct}%). This is an allowance, not a guaranteed accuracy range.`);
 text(`Gross floor area: ${result.area.toLocaleString()} sf. Construction duration: ${draft.inputs.months} months. Supervisor allocation: ${draft.inputs.allocation}%.`);
 page('Scope, quantities and rate sources');
 for(const row of result.rows){if(y>H-65)page('Scope detail (continued)');text(`${row.group} / ${row.name}`,10,true);text(`${row.quantity.toLocaleString('en-CA',{maximumFractionDigits:2})} ${row.unit} × ${row.rate===null?'unpriced':money(row.rate)} = ${row.excluded?'EXCLUDED':row.missing?'UNPRICED':money(row.amount)}`);text('Rate source: '+(row.source||'Not recorded; verify before issue'),8);if(row.notes)text(row.notes,8);}
 page('Assumptions and exclusions');text(draft.notes||'No additional assumptions recorded.');text(`Assemblies: ${draft.inputs.structure}; ${draft.inputs.cladding}; ${draft.inputs.roofStructure}; ${draft.inputs.roofFinish}.`);text(`Consultants: engineering ${draft.inputs.engineeringPct}%, architecture ${draft.inputs.architectPct}%; contingency ${draft.inputs.contingencyPct}%, applied to direct construction. PJM applies to direct construction plus contingency; supervision and trailer are separate.`);
 text('Graduated PJM bands (each rate applies only to its cost band):',10,true);for(const [i,band] of (draft.feeBands||DEFAULT_BANDS).entries()){const lower=i===0?0:(draft.feeBands||DEFAULT_BANDS)[i-1].upper!;text(`${money(lower)} ${band.upper===null?'and above':'to '+money(band.upper)}: ${band.percent}%`,9);}
 const count=doc.getNumberOfPages();for(let p=1;p<=count;p++){doc.setPage(p);doc.setFont('FieldDocs','normal');doc.setFontSize(8);doc.setTextColor(90,100,110);doc.text(`Preliminary / CAD before HST | Page ${p} of ${count}`,M,H-10);}
 return doc;
}
