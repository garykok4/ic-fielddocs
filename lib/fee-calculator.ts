/** Scheps proposed schedule v1. All figures exclude HST. Do not round marginal rates. */
export const MODEL_VERSION = 'scheps-v3';
export type FeeBand = {upper:number|null; percent:number};
export const DEFAULT_BANDS: FeeBand[] = [{upper:500000,percent:8},{upper:1000000,percent:6},{upper:10000000,percent:4},{upper:null,percent:2}];
export function validateBands(bands:FeeBand[]) {
 if(!Array.isArray(bands)||bands.length<1||bands.length>8)throw Error('Use between 1 and 8 PJM bands.');
 let lower=0; bands.forEach((b,i)=>{if(!b||!Number.isFinite(b.percent)||b.percent<0||b.percent>100)throw Error('Each PJM percentage must be between 0 and 100.');if(i===bands.length-1){if(b.upper!==null)throw Error('The final band must be open-ended.');}else{if(typeof b.upper!=='number'||!Number.isFinite(b.upper)||b.upper<=lower||b.upper>1e12)throw Error('PJM upper limits must increase, without gaps or overlaps.');lower=b.upper;}});
}

export const BENCHMARK = { construction: 28972074.64, recordedFee: 800749.77, supervision: 200000, trailer: 36000 };
export type FeeInputs = {
  bands?: FeeBand[];
  constructionCost: number;
  projectMonths: number;
  supervisorAnnualCost: number;
  supervisorAllocation: number;
  trailerRequired: boolean;
  trailerMonthlyCost: number;
  trailerSetup: number;
  historicalTrailerTotal: number;
};
export const DEFAULT_INPUTS: FeeInputs = {
  constructionCost: 2000000, projectMonths: 12, supervisorAnnualCost: 100000,
  supervisorAllocation: 100, trailerRequired: true, trailerMonthlyCost: 1500,
  trailerSetup: 0, historicalTrailerTotal: BENCHMARK.trailer,
};
export const TILLCO_INPUTS: FeeInputs = { ...DEFAULT_INPUTS, constructionCost: BENCHMARK.construction, projectMonths: 24 };
export const MAX_HISTORICAL_TRAILER = 328459.21;
export function validateFeeInputs(i: FeeInputs): void {
  if (!i || typeof i !== 'object') throw Error('Enter the estimating inputs.');
  const limits: [keyof FeeInputs, number][] = [
    ['constructionCost', 1e12], ['projectMonths', 1200], ['supervisorAnnualCost', 1e8],
    ['supervisorAllocation', 100], ['trailerMonthlyCost', 1e7], ['trailerSetup', 1e9],
    ['historicalTrailerTotal', MAX_HISTORICAL_TRAILER],
  ];
  for (const [key, max] of limits) {
    const value = i[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
      throw Error(`${key}: enter a number from 0 to ${max.toLocaleString('en-CA')}.`);
  }
  if (typeof i.trailerRequired !== 'boolean') throw Error('Choose whether a trailer is required.');
}
export function calculateFee(i: FeeInputs, modelVersion: string = MODEL_VERSION) {
  if (!["scheps-v1","scheps-v2","scheps-v3"].includes(modelVersion)) throw Error("Unsupported pricing model");
  validateFeeInputs(i);
  const historicalPjm = BENCHMARK.recordedFee - BENCHMARK.supervision - i.historicalTrailerTotal;
  const fixedHistorical = 250000 * .06 + 1750000 * .04 + 8000000 * .015 + (BENCHMARK.construction - 20000000) * .0075;
  const middleRate = (historicalPjm - fixedHistorical) / 10000000;
  if(modelVersion === "scheps-v3") validateBands(i.bands || DEFAULT_BANDS);
  const bands = (modelVersion === "scheps-v3" ? (i.bands || DEFAULT_BANDS).map((b,index,all)=>{const lower=index===0?0:all[index-1].upper!;return {name:b.upper===null?`Above $${lower.toLocaleString("en-CA")}`:`$${lower.toLocaleString("en-CA")}–$${b.upper.toLocaleString("en-CA")}`,lower,upper:b.upper??Infinity,rate:b.percent/100};}) : modelVersion === "scheps-v2" ? [
    { name: "First $500,000", lower: 0, upper: 500000, rate: .08 },
    { name: "$500,000–$1 million", lower: 500000, upper: 1000000, rate: .06 },
    { name: "$1–$10 million", lower: 1000000, upper: 10000000, rate: .04 },
    { name: "Above $10 million", lower: 10000000, upper: Infinity, rate: .02 },
  ] : [
    { name: 'First $250,000', lower: 0, upper: 250000, rate: .06 },
    { name: '$250,000–$2 million', lower: 250000, upper: 2000000, rate: .04 },
    { name: '$2–$12 million', lower: 2000000, upper: 12000000, rate: middleRate },
    { name: '$12–$20 million', lower: 12000000, upper: 20000000, rate: .015 },
    { name: 'Above $20 million', lower: 20000000, upper: Infinity, rate: .0075 },
  ]).map(b => {const eligible = Math.max(0, Math.min(i.constructionCost, b.upper) - b.lower); return {...b, eligible, fee: eligible * b.rate};});
  const pjm = bands.reduce((sum, b) => sum + b.fee, 0);
  const supervision = i.supervisorAnnualCost * i.projectMonths / 12 * i.supervisorAllocation / 100;
  const trailer = i.trailerRequired ? i.trailerMonthlyCost * i.projectMonths + i.trailerSetup : 0;
  const siteCosts = supervision + trailer;
  return { bands, middleRate, pjm, supervision, trailer, siteCosts, combinedCharge: pjm + siteCosts,
    totalBudget: i.constructionCost + pjm + siteCosts, blendedRate: i.constructionCost ? pjm / i.constructionCost * 100 : 0,
    historicalPjm, reconciledFee: fixedHistorical + middleRate * 10000000 + BENCHMARK.supervision + i.historicalTrailerTotal,
  };
}
export const money = (n: number) => new Intl.NumberFormat('en-CA', {style:'currency',currency:'CAD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
export type FeeScenario = {id:string;name:string;project_id:string|null;notes:string;inputs:FeeInputs;model_version:string;revision:number;created_at:string;updated_at:string};
