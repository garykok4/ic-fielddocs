import {BudgetDraft, BudgetInputs, FIELDS, OPTIONS, LINES, newBudget, validateBudget, estimateBudget} from './preliminary';
const string={type:'string'};
const nullableNumber={type:['number','null'],minimum:0,maximum:1e12};
const inputProperties:Record<string,unknown>=Object.fromEntries(FIELDS.map(([key,,, ,max])=>[key,{type:'number',minimum:0,maximum:max}]));
for(const [key,values] of Object.entries(OPTIONS)) inputProperties[key]={type:'string',enum:values};
for(const key of ['basement','servicing','sprinklers','trailer'])inputProperties[key]={type:'boolean'};
export const budgetAISchema={type:'object',additionalProperties:false,required:['name','inputs','assumptions','warnings','rows'],properties:{
 name:string,inputs:{type:'object',additionalProperties:false,required:Object.keys(inputProperties),properties:inputProperties},
 assumptions:string,warnings:{type:'array',maxItems:30,items:string},rows:{type:'array',minItems:LINES.length,maxItems:LINES.length,items:{type:'object',additionalProperties:false,required:['id','quantity','rate','excluded','basis','reference','notes'],properties:{id:{type:'string',enum:LINES.map(l=>l.id)},quantity:nullableNumber,rate:nullableNumber,excluded:{type:'boolean'},basis:{type:'string',enum:['reference','document','allowance','unpriced']},reference:string,notes:string}}}}};
export type BudgetAIResult={name:string;draft:BudgetDraft;warnings:string[];source:string};
const assembly:Record<string,keyof BudgetInputs>={structure:'structure',cladding:'cladding',roofstructure:'roofStructure',roofing:'roofFinish',upperfloor:'upperFloor'};
export function validateBudgetAI(raw:any,seed:BudgetDraft,reference:BudgetDraft|null,referenceName:string,files:string[],source:string):BudgetAIResult {
 validateBudget(seed);if(reference)validateBudget(reference);
 if(!raw || typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>150||typeof raw.assumptions!=='string'||raw.assumptions.length>10000||!Array.isArray(raw.warnings)||raw.warnings.length>30||raw.warnings.some((w:unknown)=>typeof w!=='string'||w.length>500)||!Array.isArray(raw.rows)||raw.rows.length!==LINES.length)throw Error('AI returned an invalid budget. Try a smaller scope.');
 const draft:BudgetDraft={...newBudget(),inputs:raw.inputs,feeBands:seed.feeBands?structuredClone(seed.feeBands):undefined,lines:{},notes:''};
 const seen=new Set<string>();
 for(const row of raw.rows){
  if(!row||!LINES.some(l=>l.id===row.id)||seen.has(row.id)||typeof row.excluded!=='boolean'||typeof row.reference!=='string'||row.reference.length>300||typeof row.notes!=='string'||row.notes.length>1200||!['reference','document','allowance','unpriced'].includes(row.basis))throw Error('AI returned invalid or duplicate budget lines.');
  for(const n of [row.rate,row.quantity])if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e12))throw Error('AI returned invalid quantities or rates.');
  seen.add(row.id);
  const prev=reference?.lines[row.id], key=assembly[row.id];
  const compatible=!key || reference?.inputs[key]===draft.inputs[key];
  const reusable=prev && prev.rate!==null && !prev.excluded && compatible;
  let rate:number|null=row.rate,provenance='';
  if(reusable){rate=prev.rate;provenance=`Provided reference rate: ${referenceName}. ${prev.source||'Source not recorded; review required.'}`;}
  else if(row.basis==='reference')throw Error('AI requested a missing or incompatible reference rate. Try again or remove that reference.');
  else if(row.basis==='document'){
    if(!files.some(f=>row.reference.toLowerCase().includes(f.toLowerCase())))throw Error('A document rate has no matching uploaded filename. Regenerate or use a text scope.');
    provenance=`AI-extracted document rate — verify: ${row.reference}`;
  } else if(row.basis==='allowance')provenance=`AI ALLOWANCE — unverified, not a quote. ${row.reference}`;
  else {rate=null;provenance='UNPRICED — estimator input required';}
  draft.lines[row.id]={rate,quantity:row.quantity,excluded:row.excluded,source:provenance.slice(0,500),notes:`Quantity: ${row.quantity===null?'calculator geometry / allowance':'AI-proposed override; verify units and takeoff'}. ${row.excluded?'AI-proposed exclusion — confirm. ':''}${row.notes}`.slice(0,2000)};
 }
 const warnings=[...raw.warnings,'Review every quantity, rate and exclusion. AI allowances are not verified market prices.'];
 draft.notes=`AI PRELIMINARY DRAFT | ${source}\n${raw.assumptions}\n\nREVIEW ITEMS\n${warnings.map(w=>'- '+w).join('\n')}\n\nDocuments: ${files.join(', ')||'None'}. Rate reference: ${referenceName||'None'}.\nPJM bands retained from your open budget. No HST, land or financing. Consultant percentages, contingency and site costs are calculated separately; avoid double counting.`;
 if(draft.notes.length>20000)throw Error('AI notes are too long.');
 validateBudget(draft);estimateBudget(draft);
 return {name:raw.name.trim(),draft,warnings,source};
}
