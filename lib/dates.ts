import {isoDay,ontarioToday,validDate} from './work-calendar';
export function readableDate(value:string|null|undefined,year:'auto'|'always'|'never'='auto',asOf=ontarioToday()):string{
 if(!value)return '';if(!validDate(value))return value;
 return isoDay(value).toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',...(year==='always'||year==='auto'&&value.slice(0,4)!==asOf.slice(0,4)?{year:'numeric' as const}:{})});
}
export function readableDateTime(value:string|null|undefined):string{if(!value)return '';const d=new Date(value);if(!Number.isFinite(+d))return value;return d.toLocaleString('en-US',{timeZone:'America/Toronto',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});}
