import {briefLines} from '../lib/brief-format';
export default function BriefPreview({text}:{text:string}){return <div style={{whiteSpace:'pre-wrap',lineHeight:1.6,overflowWrap:'anywhere'}}>{briefLines(text).map((r,i)=><div key={i}>{r.bold?<strong>{r.text}</strong>:r.text||'\u00a0'}</div>)}</div>;}
