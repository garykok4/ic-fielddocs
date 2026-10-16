import {calculateFee,money} from '../lib/fee-calculator';
export default function FeeVisual({result:r}:{result:ReturnType<typeof calculateFee>}){
 const parts=[{name:'PJM',value:r.pjm,color:'#2d66cb'},{name:'Supervision',value:r.supervision,color:'#f5cd44'},{name:'Trailer',value:r.trailer,color:'#e877af'}];
 const maxRate=Math.max(.06,...r.bands.map(b=>b.rate));
 return <section className="fee-panel fee-visual" aria-label="Estimate visual summary">
  <div className="fee-summary-cards"><div className="fee-total"><span>PJM only</span><strong>{money(r.pjm)}</strong><small>{r.blendedRate.toFixed(2)}% blended PJM</small></div><div><span>Supervision and trailer</span><strong>{money(r.siteCosts)}</strong><small>Separate site costs</small></div><div><span>Combined charge</span><strong>{money(r.combinedCharge)}</strong><small>PJM + supervision + trailer</small></div></div>
  <div className="fee-charge-bar" role="img" aria-label={parts.map(p=>`${p.name} ${money(p.value)}`).join(', ')}>{parts.filter(p=>p.value>0).map(p=><span key={p.name} style={{width:`${r.combinedCharge?p.value/r.combinedCharge*100:0}%`,background:p.color}}/>)}</div>
  {!r.combinedCharge&&<small>No charges at these inputs.</small>}
  <div className="fee-chart-legend">{parts.map(p=><span key={p.name}><i style={{background:p.color}}/>{p.name} {money(p.value)}</span>)}</div>
  <div className="fee-visual-budget"><span>Construction plus combined charge</span><strong>{money(r.totalBudget)}</strong></div>
  <h2>Graduated PJM rates</h2><div className="fee-rate-bars">{r.bands.map((b,index)=><div className="fee-rate-row" key={b.name}><span>{b.name}</span><div className="fee-rate-track" aria-hidden="true"><i style={{width:`${b.rate/maxRate*100}%`}}/></div><strong>{(b.rate*100).toFixed(index===2?3:2)}%</strong></div>)}</div>
  <p className="fee-fine">Each rate applies only to its cost band. No PJM is added to supervision or trailer. Rates shown are marginal rates, not shares of the total fee.</p>
 </section>;
}
