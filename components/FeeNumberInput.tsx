import {useEffect,useRef,useState} from 'react';
const format=(value:number)=>Number.isFinite(value)?value.toLocaleString('en-CA',{maximumFractionDigits:20}):'';
export default function FeeNumberInput({value,onChange,max}:{value:number;onChange:(value:number)=>void;max:number}){
 const [text,setText]=useState(format(value));
 const last=useRef(value);
 useEffect(()=>{if(!Object.is(value,last.current)){setText(format(value));last.current=value}},[value]);
 return <input type="text" inputMode="decimal" value={text} aria-invalid={!Number.isFinite(value)||value<0||value>max} onChange={e=>{
  const raw=e.target.value.replace(/,/g,'');
  if(!/^\d*(\.\d*)?$/.test(raw))return;
  const [whole,fraction]=raw.split('.');
  const formatted=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction!==undefined?'.'+fraction:'');
  const input=e.currentTarget;
  const significant=input.value.slice(0,input.selectionStart??input.value.length).replace(/,/g,'').length;
  let position=0,count=0;
  while(position<formatted.length&&count<significant){if(formatted[position]!==',')count++;position++}
  setText(formatted);
  requestAnimationFrame(()=>{if(document.activeElement===input)input.setSelectionRange(position,position)});
  const number=raw===''||raw==='.'?NaN:Number(raw);last.current=number;onChange(number);
 }} onBlur={()=>setText(format(value))}/>;
}
