export type StaffMember={id:string;email:string;full_name:string;role:string;active:boolean;has_profile:boolean;revision:number;confirmed:boolean;last_sign_in_at:string|null;invited_at:string|null;projects:string[];estimating:boolean};
export type StaffDirectory={actor:string;users:StaffMember[];projects:{id:string;project_name:string}[];emailReady:boolean};
export function staffInput(b:Record<string,unknown>){
 const name=typeof b.name==='string'?b.name.trim():'';
 if(!name||name.length>150||!['admin','pm'].includes(String(b.role))||typeof b.active!=='boolean'||typeof b.estimating!=='boolean'||!Array.isArray(b.projects)||b.projects.length>1000||b.projects.some(p=>typeof p!=='string'||!UUID.test(p)))throw Error('Enter a name, role and valid project selections.');
 return {p_name:name,p_role:b.role as string,p_active:b.active,p_estimating:b.estimating,p_projects:[...new Set(b.projects as string[])]};
}
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
