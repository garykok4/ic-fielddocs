export const SCAN_SOURCES = [
 ['Food processing','Ontario ("food processing" OR "food manufacturing" OR poultry OR bakery) (expansion OR "new plant" OR construction)'],
 ['Industrial development','Ontario (manufacturing OR industrial) ("new facility" OR "plant expansion" OR construction)'],
 ['Warehousing and logistics','Ontario (warehouse OR "cold storage" OR distribution) (expansion OR construction OR development)'],
 ['Oxford and area','(Woodstock OR Ingersoll OR Tillsonburg OR Norwich OR "Oxford County") (plant OR industrial OR commercial) (expansion OR construction OR development)'],
 ['Southwestern Ontario','(London OR Brantford OR Cambridge OR Kitchener OR Waterloo OR Guelph OR Stratford) (factory OR warehouse OR commercial) (expansion OR construction)'],
 ['Ontario announcements','site:news.ontario.ca (manufacturing OR industrial OR food) (expansion OR facility OR construction)'],
 ['Invest Ontario','site:investontario.ca (expansion OR facility OR construction)'],
 ['Federal announcements','site:canada.ca Ontario (factory OR manufacturing OR processing) (expansion OR facility)'],
 ['Municipal development','(site:cityofwoodstock.ca OR site:oxfordcounty.ca OR site:london.ca OR site:brantford.ca) (industrial OR commercial) (development OR planning OR expansion)'],
 ['Manufacturing trade news','site:canadianmanufacturing.com Ontario (expansion OR facility OR construction)'],
 ['Food industry news','(site:foodincanada.com OR site:foodandbeverageontario.ca) (expansion OR facility OR construction)'],
 ['Construction industry news','site:canada.constructconnect.com Ontario (industrial OR commercial OR manufacturing) (project OR construction)'],
 ['Company announcements','(site:newswire.ca OR site:globenewswire.com) Ontario (plant OR facility OR warehouse) (expansion OR construction)'],
 ['Public procurement notices','(site:canadabuys.canada.ca OR site:bidsandtenders.ca OR site:ontariotenders.app.jaggaer.com) Ontario (building OR construction OR renovation)'],
] as const;
export function normalizedTitle(title:string){return title.replace(/\s[-–|]\s[^-–|]+$/,'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();}
export function canonicalUrl(raw:string){try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol))return '';u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid|gclid)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href.replace(/\/$/,'');}catch{return '';}}
const places=['Woodstock','Oxford County','Ingersoll','Tillsonburg','Norwich','London','Brantford','Cambridge','Kitchener','Waterloo','Stratford','Guelph','Hamilton','Windsor','Toronto','Mississauga','Brampton'];
export function candidate(title:string,description:string,url:string,source:string,published:string|null){const text=(title+' '+description).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').slice(0,5000),lower=text.toLowerCase();const municipality=places.find(p=>new RegExp(`\\b${p.toLowerCase()}\\b`).test(lower))||'';
 if(/market (report|size)|stock price|earnings call/.test(lower))return null;
 if(!/expan|construct|new (plant|facility|warehouse)|develop|tender|renovat/.test(lower))return null;
 if(!/ontario/.test(lower)&&!municipality)return null;
 const type=/food|poultry|bakery|dairy|processing/.test(lower)?'Food / processing':/warehouse|storage|logistics|distribution/.test(lower)?'Warehouse / logistics':/manufactur|plant|factory/.test(lower)?'Manufacturing':'Commercial / public';
 const score=Math.min(100,35+(municipality?20:0)+(/woodstock|oxford|ingersoll|tillsonburg|norwich/.test(lower)?20:0)+(/food|processing|cold storage/.test(lower)?15:0)+(/new facility|expansion|construction/.test(lower)?10:0));
 return {title:title.slice(0,500),description:text,municipality,project_type:type,opportunity_score:score,source_url:canonicalUrl(url),source,published};}
export type OpportunityLead={id:string;title:string;description:string;municipality:string;project_type:string;opportunity_score:number;status:string;notes:string;sources:{url:string;title:string;name:string;published:string|null}[];keys:string[];updated_at:string};
