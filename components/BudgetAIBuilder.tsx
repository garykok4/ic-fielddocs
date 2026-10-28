'use client';
import {useEffect,useRef,useState} from 'react';
import AIDocuments,{analyzeDocuments} from './AIDocuments';
import type {AISelection} from '../lib/ai-documents';
import {supabase} from '../lib/supabase';
import {BudgetDraft,SavedBudget,estimateBudget,FIELDS,OPTIONS} from '../lib/preliminary';
import type {BudgetAIResult} from '../lib/budget-ai';
import {money} from '../lib/fee-calculator';
import './lookahead-export.css';
export default function BudgetAIBuilder({seed,saved,project,close,apply}:{seed:BudgetDraft;saved:SavedBudget[];project:string;close:()=>void;apply:(r:BudgetAIResult)=>void}){
 const [progress,setProgress]=useState('');
 const ref=useRef<HTMLDialogElement>(null);const [scope,setScope]=useState(''),[reference,setReference]=useState(''),[files,setFiles]=useState<AISelection[]>([]),[consent,setConsent]=useState(false),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<BudgetAIResult|null>(null);
 useEffect(()=>{const active=document.activeElement;ref.current?.showModal();return()=>{ref.current?.close();if(active instanceof HTMLElement)active.focus();};},[]);
 async function generate(){setError('');setBusy(true);setResult(null);setReviewed(false);try{
  if(!consent)throw Error('Confirm document sharing.');
  const receipts=await analyzeDocuments(project,'budget',files,setFiles,setProgress);
  const session=await supabase.auth.getSession();const token=session.data.session?.access_token;if(!token)throw Error('Sign in again.');
  const body=new FormData();body.set('scope',scope);body.set('reference',reference);body.set('project',project);body.set('seed',JSON.stringify(seed));body.set('consent',String(consent));body.set('analyses',JSON.stringify(receipts));
  const response=await fetch('/api/budget-draft',{method:'POST',headers:{Authorization:'Bearer '+token},body,signal:AbortSignal.timeout(115000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Budget generation failed.');
  estimateBudget(data.draft.draft);setResult(data.draft);
 }catch(e){setError((e as Error).name==='TimeoutError'?'Request timed out. Your current budget was not changed.':(e as Error).message);}finally{setBusy(false);}}
 const priced=result?estimateBudget(result.draft):null;
 return <dialog ref={ref} className="la-dialog" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
  <header><div><div className="la-eyebrow">PRELIMINARY ESTIMATING</div><h2>Build budget with AI</h2><p>Scope to an editable Class D worksheet · CAD before HST</p></div><button disabled={busy} onClick={close} aria-label="Close AI budget">×</button></header>
  <div className="la-body">{error&&<p role="alert" className="la-error">{error}</p>}
  <fieldset disabled={busy}>
   <label>Project scope and constraints<textarea aria-label="Project scope and constraints" style={{width:'100%',minHeight:140}} maxLength={20000} value={scope} onChange={e=>{setScope(e.target.value);setResult(null);setReviewed(false);}} placeholder="Location, building use, floor area, storeys, basement, structure, cladding, roof, servicing, finishes, exclusions and expected duration…"/></label>
   <div className="la-grid"><label>Saved rate reference<select aria-label="Saved rate reference" value={reference} onChange={e=>{setReference(e.target.value);setResult(null);setReviewed(false);}}><option value="">No reference — AI allowances / unpriced scope</option>{saved.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
   <AIDocuments key={project} project={project} kind="budget" value={files} onChange={v=>{setFiles(v);setResult(null);setReviewed(false);}} busy={busy} onBusy={setBusy}/>
   {progress&&busy&&<p role="status">{progress}</p>}
   <p className="la-info">Uses the open worksheet's building inputs as starting assumptions and retains its PJM bands. Only your scope, starting inputs, selected rate reference and attached files are sent to the AI provider. It does not search your other projects or verify current market prices.</p>
   <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I agree to send this information to the configured AI provider.</label>
   <p><button className="la-primary" disabled={busy||!consent||scope.trim().length<20} onClick={()=>void generate()}>{busy?'Building budget…':result?'Generate another draft':'Generate budget draft'}</button></p>
  </fieldset>
  {result&&priced&&<section><h3>{result.name}</h3><p><strong>{money(priced.budget)}</strong> including calculated fees / allowances · {priced.missing} active lines unpriced</p><p>Unverified AI allowances can be priced without being reliable. Review scope, quantities, sources and exclusions before issuing.</p>
   <ul>{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
   <details><summary>Review building inputs and assumptions</summary><dl>{FIELDS.map(([k,label,unit])=><div key={k}><dt>{label}</dt><dd>{result.draft.inputs[k].toLocaleString()} {unit}</dd></div>)}{Object.keys(OPTIONS).map(k=><div key={k}>{k}: {result.draft.inputs[k as keyof typeof OPTIONS]}</div>)}</dl><pre style={{whiteSpace:'pre-wrap'}}>{result.draft.notes}</pre></details>
   <div style={{overflowX:'auto',maxHeight:420}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>Scope</th><th>Quantity</th><th>Rate</th><th>Amount / status</th></tr></thead><tbody>{priced.rows.map(r=><tr key={r.id} style={{borderBottom:'1px solid #dce4ee'}}><td style={{padding:8}}><strong>{r.name}</strong><small style={{display:'block'}}>{r.source}</small><small style={{display:'block'}}>{r.notes}</small></td><td>{r.quantity.toLocaleString()} {r.unit}</td><td>{r.rate===null?'Unpriced':money(r.rate)}</td><td>{r.excluded?'Excluded':r.missing?'Unpriced':money(r.amount)}</td></tr>)}</tbody></table></div>
   <p>This creates a new unsaved budget in the worksheet, replacing the currently open draft. Existing saved budgets remain unchanged. You can edit every value before saving.</p>
   <label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I have reviewed the proposed scope, exclusions, assumptions and rates.</label>
   <p><button className="la-primary" disabled={!reviewed||busy} onClick={()=>apply(result)}>Use draft in worksheet</button></p>
  </section>}
 </div></dialog>;
}
