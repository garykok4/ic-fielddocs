// Storage capacity and AI processing capacity are deliberately separate.
export const AI_FILE_BYTES = 40 * 1024 * 1024;
export const AI_MAX_DOCUMENTS = 100;
export type AISource = {type:'revision'|'upload';id:string};
export type AISelection = AISource & {filename:string;bytes:number;label:string;receipt?:string;notes?:string};
export const aiSupported = (name:string) => /\.(pdf|txt|md)$/i.test(name);
export function aiFileCheck(name:string,bytes:number){
 if(!aiSupported(name))throw Error(`${name}: use PDF, TXT or MD for AI analysis.`);
 if(!Number.isSafeInteger(bytes)||bytes<=0)throw Error(`${name}: the file is empty or its size is invalid.`);
 if(/\.(txt|md)$/i.test(name)&&bytes>1048576)throw Error(`${name}: split text documents into files of 1 MB or less.`);
 if(bytes>AI_FILE_BYTES)throw Error(`${name}: ${(bytes/1048576).toFixed(1)} MB exceeds the 40 MB AI limit for one document. Export relevant pages or split this PDF into smaller files. The full original can remain in Project Files.`);
}
