"use client";
import {DEFAULT_BANDS,FeeBand} from '../lib/fee-calculator';
import FeeNumberInput from './FeeNumberInput';
export default function FeeBandEditor({value,onChange}:{value:FeeBand[];onChange:(b:FeeBand[])=>void}) {
 const update=(i:number,v:Partial<FeeBand>)=>onChange(value.map((b,j)=>j===i?{...b,...v}:b));
 return <section style={{padding:'16px 0'}}><h3>Customize PJM bands</h3><p>Each percentage applies only within its band. Upper limits must increase; the last band covers all remaining costs. Changes belong to this estimate.</p>
 {value.map((b,i)=><div key={i} style={{display:'flex',gap:12,alignItems:'end',flexWrap:'wrap',marginBottom:12}}><label style={{flex:1}}>Band {i+1} upper limit (CAD){b.upper===null?<p>No upper limit</p>:<FeeNumberInput value={b.upper} max={1e12} onChange={upper=>update(i,{upper})}/>}</label><label style={{flex:1}}>Band {i+1} rate (%)<FeeNumberInput value={b.percent} max={100} onChange={percent=>update(i,{percent})}/></label>{value.length>1&&<button type="button" onClick={()=>{const n=value.filter((_,j)=>j!==i).map(b=>({...b}));n[n.length-1].upper=null;onChange(n);}}>Remove band {i+1}</button>}</div>)}
 <button type="button" disabled={value.length>=8} onClick={()=>{const n=value.map(b=>({...b}));const lower=n.length>1?n[n.length-2].upper||0:0;n[n.length-1].upper=lower+1000000;n.push({upper:null,percent:n[n.length-1].percent});onChange(n);}}>Add band</button>{' '}<button type="button" onClick={()=>onChange(DEFAULT_BANDS.map(b=>({...b})))}>Reset to 8 / 6 / 4 / 2%</button></section>;
}
