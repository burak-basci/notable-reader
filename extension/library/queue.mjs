/* One queue, one existing PageSession. No synthesizer or second player. MIT. */
export function createReadingQueue({getItem,load,play,stop,onChange=()=>{},onError=()=>{}}){
 let ids=[],index=-1,active=false,advancing=false,epoch=0,previous='',sawPlayback=false;
 const snapshot=()=>({ids:[...ids],index,active,advancing});
 const changed=()=>onChange(snapshot());
 async function advance(){if(!active||advancing)return;advancing=true;const own=epoch;try{const next=index+1;if(next>=ids.length){active=false;return;}const item=await getItem(ids[next]);if(own!==epoch)return;if(!item)throw Error('library_missing');index=next;previous='';sawPlayback=false;await load(item);if(own!==epoch)return;await play();}catch(e){if(own===epoch){active=false;onError(e);}}finally{if(own===epoch){advancing=false;changed();}}}
 return {snapshot,async start(next){if(!Array.isArray(next)||!next.length||next.length>100||next.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))throw Error('library_invalid_queue');epoch++;stop();ids=[...next];index=-1;previous='';active=true;advancing=false;await advance();},state(value){const old=previous;previous=value;if(value==='playing')sawPlayback=true;if(active&&!advancing&&sawPlayback&&value==='ended'&&old!=='ended'){sawPlayback=false;void advance();}if(value==='error'||value==='preempted'){active=false;epoch++;advancing=false;changed();}},cancel(){epoch++;active=false;advancing=false;ids=[];index=-1;previous='';stop();changed();}};
}
