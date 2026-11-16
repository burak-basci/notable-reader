// Compatibility module for old integrations. The Reader has no paid edition or remote account.
export const FREE_CAPABILITIES = Object.freeze({audioExport:true, documentExport:true, formats:Object.freeze(['mp3','wav','pdf','html'])});
export const getCapabilities = () => FREE_CAPABILITIES;
export async function getStatus(){return {status:'free',capabilities:FREE_CAPABILITIES};}
export async function requireExport(){return {allowed:true,capabilities:FREE_CAPABILITIES};}
export class PremiumError extends Error{constructor(code='activation_unavailable'){super(code);this.name='PremiumError';this.code=code;}}
const unavailable=async()=>{throw new PremiumError('activation_unavailable');};
export const activate=unavailable,requestRecovery=unavailable,recover=unavailable,deactivate=unavailable,verifyLease=unavailable;
export const checkoutTarget=async()=>({url:null,direct:false}),portalTarget=checkoutTarget;
export const urls=async()=>({});
