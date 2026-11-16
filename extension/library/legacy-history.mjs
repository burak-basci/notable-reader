/* Earlier releases saved anonymous points, not a reading log. Recover a point
 * only when an unambiguous, explicitly saved text still supplies its metadata. */
import * as store from './store.mjs';
import {cleanText,documentChunks} from '../tools/reader/document-chunks.mjs';
import {wordOffsets} from '../playback/timeline.js';
const key='readingHistoryRecoveryV1';
const fingerprint=text=>{let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return text.length+'-'+(hash>>>0).toString(16);};
export async function recoverLegacyHistory(api){
 if(api.extension?.inIncognitoContext)return {unrecoverable:0};
 const saved=await api.storage.local.get([key,'resumePoints']);if(saved[key])return saved[key];
 const points=saved.resumePoints||{},items=await store.listItems(),candidates=new Map();
 for(const item of items){const text=cleanText(item.text),fp=fingerprint(text),list=candidates.get(fp)||[];list.push({...item,text});candidates.set(fp,list);}
 let recovered=0;for(const [fp,point]of Object.entries(points)){
  const found=candidates.get(fp);if(found?.length!==1||!Number.isSafeInteger(point.chunk)||point.chunk<0||!Number.isFinite(point.ts))continue;
  const item=found[0],{chunks}=documentChunks(item.text),chunk=chunks[point.chunk];if(!chunk)continue;
  const word=Math.max(0,Math.min(chunk.words.length-1,Number.isInteger(point.word)?point.word:0)),chunkChar=wordOffsets(chunk.text,chunk.words)?.[word]?.start||0,char=chunk.start+chunkChar;
  const doc={...item,fingerprint:fp,recovered:true},existing=await store.findHistory(doc);if(!existing)await store.recordHistory({document:doc,position:{chunk:point.chunk,word,char,chunkChar},readAt:point.ts,progress:char/Math.max(1,item.text.length),token:'legacy-recovery',sequence:1});recovered++;
 }
 const result={recovered,unrecoverable:Math.max(0,Object.keys(points).length-recovered)};await api.storage.local.set({[key]:result});return result;
}
