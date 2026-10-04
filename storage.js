function transact(mode,action){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('bikecoach-rides',1);request.onupgradeneeded=()=>request.result.createObjectStore('rides');request.onerror=()=>reject(request.error);
 request.onsuccess=()=>{const db=request.result,tx=db.transaction('rides',mode);let result;tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('Saving interrupted'));};
  try{action(tx.objectStore('rides'),v=>{result=v;});}catch(e){tx.abort();reject(e);}
 };
});}
export function recordStore(key,value){return transact(value===undefined?'readonly':'readwrite',(s,done)=>{const q=value===undefined?s.get(key):s.put(value,key);q.onsuccess=()=>done(value===undefined?q.result:value);});}
// Archive the previous download and replace latest in one transaction: a full
// browser store must never destroy the last saved ride or silently lose backup.
export function rideStore(value){if(value===undefined)return recordStore('latest');return transact('readwrite',(s,done)=>{
 const q=s.get('latest');q.onsuccess=()=>{const old=q.result;
  if(old&&old.downloadedAt!==value.downloadedAt){const key='ride-archive:'+(old.downloadedAt||'earlier')+':'+old.name;s.put(old,key);}
  s.put(value,'latest');done(value);
 };
});}
export function listSavedRides(){return transact('readonly',(s,done)=>{
 const items=[],q=s.openCursor();q.onsuccess=()=>{const cursor=q.result;if(!cursor){done(items.sort((a,b)=>(b.downloadedAt||'').localeCompare(a.downloadedAt||'')));return;}
  if(cursor.key==='latest'||String(cursor.key).startsWith('ride-archive:')){const r=cursor.value;if(r?.name)items.push({key:cursor.key,name:r.name,downloadedAt:r.downloadedAt});}cursor.continue();
 };
});}
