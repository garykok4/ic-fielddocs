/** Ontario planning calendar. Weekend observance is a scheduling convention, not a payroll determination. */
export type Holiday={date:string;name:string;observed:boolean;actualDate:string};
export const isoDay=(s:string)=>new Date(s+'T00:00:00Z');
export const isoFormat=(d:Date)=>d.toISOString().slice(0,10);
export const shiftDate=(s:string,n:number)=>isoFormat(new Date(+isoDay(s)+n*86400000));
export const validDate=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(+isoDay(s))&&isoFormat(isoDay(s))===s;
export const ontarioToday=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const weekend=(s:string)=>[0,6].includes(isoDay(s).getUTCDay());
const cache=new Map<number,Holiday[]>();
function easter(year:number){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;return `${year}-${String(Math.floor(n/31)).padStart(2,'0')}-${String(n%31+1).padStart(2,'0')}`;}
const monday=(year:number,month:number,n:number)=>{const first=`${year}-${String(month).padStart(2,'0')}-01`;return shiftDate(first,(8-isoDay(first).getUTCDay())%7+(n-1)*7);};
export function ontarioHolidays(year:number):Holiday[]{
 if(cache.has(year))return cache.get(year)!;
 if(!Number.isInteger(year)||year<1900||year>9998)return [];
 const before25=`${year}-05-24`,victoria=shiftDate(before25,-((isoDay(before25).getUTCDay()+6)%7));
 const base=[['New Year’s Day',`${year}-01-01`],['Family Day',monday(year,2,3)],['Good Friday',shiftDate(easter(year),-2)],['Victoria Day',victoria],['Canada Day',`${year}-07-01`],['Labour Day',monday(year,9,1)],['Thanksgiving',monday(year,10,2)],['Christmas Day',`${year}-12-25`],['Boxing Day',`${year}-12-26`]];
 const rows:Holiday[]=base.map(([name,date])=>({date,name,observed:false,actualDate:date})),closed=new Set(rows.map(h=>h.date));
 for(const h of [...rows])if(weekend(h.date)){let observed=shiftDate(h.date,1);while(weekend(observed)||closed.has(observed))observed=shiftDate(observed,1);closed.add(observed);rows.push({date:observed,name:h.name+' (observed)',observed:true,actualDate:h.date});}
 rows.sort((a,b)=>a.date.localeCompare(b.date));cache.set(year,rows);return rows;
}
export function holidayOn(date:string):Holiday|undefined{return validDate(date)?ontarioHolidays(Number(date.slice(0,4))).find(h=>h.date===date):undefined;}
export function isWorkDay(date:string){return validDate(date)&&!weekend(date)&&!holidayOn(date);}
export function nextWorkDay(date:string){if(!validDate(date))throw Error('Invalid working-calendar date.');while(!isWorkDay(date))date=shiftDate(date,1);return date;}
export function addWorkDays(date:string,amount:number){if(!validDate(date)||!Number.isInteger(amount)||Math.abs(amount)>10000)throw Error('Invalid working-day calculation.');const dir=amount<0?-1:1;for(let n=0;n<Math.abs(amount);){date=shiftDate(date,dir);if(!validDate(date))throw Error("Date is outside the supported calendar range.");if(isWorkDay(date))n++;}return date;}
/** Working days strictly after a, through b; negative for reversed intervals. */
export function workingDaysBetween(a:string,b:string):number{if(!validDate(a)||!validDate(b))throw Error('Invalid working-calendar date.');if(a>b)return -workingDaysBetween(b,a);let count=0;while(a<b){a=shiftDate(a,1);if(isWorkDay(a))count++;}return count;}
export function dueCountdown(due:string|null|undefined,status?:string,asOf=ontarioToday()):string{
 if(status==='done'||status==='complete')return 'Completed';if(!due||!validDate(due))return 'No due date';if(due===asOf)return 'Due today';
 if(due<asOf){const count=workingDaysBetween(due,asOf);return count?`${count} work ${count===1?'day':'days'} overdue`:'Overdue';}
 const count=workingDaysBetween(asOf,due);return count?`Due in ${count} work ${count===1?'day':'days'}`:'No work days left before due date';
}
export const COUNTDOWN_HELP='Working days after today through the due date; Saturdays, Sundays and Ontario holiday closures are excluded. Today’s remaining hours are not counted.';

/** Per-project closures extend the standard Ontario planning calendar. */
export function projectCalendar(closures:string[]=[]){
 if(closures.length>500||closures.some(d=>!validDate(d)))throw Error('Provide up to 500 valid shutdown dates.');
 const closed=new Set(closures),work=(s:string)=>isWorkDay(s)&&!closed.has(s);
 const normalize=(s:string)=>{if(!validDate(s))throw Error('Invalid date.');while(!work(s))s=shiftDate(s,1);return s;};
 const add=(s:string,n:number)=>{if(!validDate(s)||!Number.isInteger(n)||Math.abs(n)>20000)throw Error('Invalid work-day offset.');const dir=n<0?-1:1;for(let i=0;i<Math.abs(n);){s=shiftDate(s,dir);if(!validDate(s))throw Error('Date out of range.');if(work(s))i++;}return s;};
 const distance=(a:string,b:string):number=>{if(!validDate(a)||!validDate(b))throw Error('Invalid date.');if(a>b)return -distance(b,a);let n=0;while(a<b){a=shiftDate(a,1);if(work(a))n++;}return n;};
 return {work,normalize,add,distance,finish:(s:string,n:number)=>add(s,Math.max(0,n-1))};
}
