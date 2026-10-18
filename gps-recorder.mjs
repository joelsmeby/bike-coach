import {normalizeFix,MAX_POINTS} from './gps.mjs?v=2';
export class GpsRecorder{
 constructor({store,onStatus=()=>{},geo=globalThis.navigator?.geolocation,now=()=>Date.now()}={}){this.store=store;this.onStatus=onStatus;this.geo=geo;this.now=now;this.watch=null;this.current=null;this.queue=Promise.resolve();this.segment=0;this.lastSave=0;this.wake=null;}
 status(text){this.onStatus(text);}
 async persist(){
  if(!this.current)return;
  const snapshot=structuredClone(this.current);
  this.queue=this.queue.catch(()=>{}).then(()=>this.store('gps:'+snapshot.id,snapshot));
  try{await this.queue;}catch(error){this.stopWatch();this.status('GPS storage failed. Bike recording continues; keep this page open and export GPS before leaving.');throw error;}
 }
 async begin(id,sync){
  if(this.current)await this.end('replaced');
  this.current={schemaVersion:1,id,sync,points:[],events:[],startedEpochMs:this.now(),endEpochMs:null};this.segment=0;
  await this.persist();
  if(!this.geo){this.status('GPS unavailable in this browser. Bike recording continues.');return;}
  this.status('GPS: waiting for location permission or a satellite fix…');
  const owner=this.current;
  try{this.watch=this.geo.watchPosition(p=>{if(this.current===owner)this.accept(p);},e=>{if(this.current===owner)this.error(e);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});}catch(e){this.error(e);}
  this.timer=setInterval(()=>{if(!this.current||this.watch===null)return;const last=this.current.points.at(-1);if(!last||this.now()-last.timestamp>15000)this.status('GPS signal missing or paused. Keep Bluefy visible; bike recording continues.');},5000);
  await this.keepAwake();
 }
 async keepAwake(){try{if(this.current&&globalThis.document?.visibilityState==='visible'&&globalThis.navigator?.wakeLock&&!this.wake){const lock=await navigator.wakeLock.request('screen');if(!this.current||this.watch===null){await lock.release();return;}this.wake=lock;lock.addEventListener('release',()=>{if(this.wake===lock)this.wake=null;});}}catch{}}
 accept(position){
  if(!this.current||this.watch===null)return;
  const p=normalizeFix(position,this.segment),last=this.current.points.at(-1);
  if(!p||p.timestamp<this.current.startedEpochMs-1000||p.timestamp>this.now()+2000||(last&&p.timestamp<=last.timestamp))return;
  if(this.current.points.length>=MAX_POINTS){this.stopWatch();this.current.events.push({type:'limit',timestamp:this.now()});this.persist().catch(()=>{});this.status('GPS capacity reached. Bike recording continues.');return;}
  this.current.points.push(p);this.status(`GPS: ${this.current.points.length} fixes · accuracy ±${Math.round(p.accuracy)} m${p.speed===null?'':' · '+(p.speed*3.6).toFixed(1)+' km/h'}${p.accuracy>30?' · weak signal':''}`);
  if(this.now()-this.lastSave>=5000){this.lastSave=this.now();this.persist().catch(()=>{});}
 }
 error(error){if(!this.current)return;this.current.events.push({type:'error',code:Number(error.code)||0,timestamp:this.now()});this.segment++;this.persist().catch(()=>{});if(error.code===1){this.stopWatch();this.status('GPS permission denied. Bike recording continues without a route.');}else this.status('GPS signal unavailable. Waiting for another fix; bike recording continues.');}
 visibility(hidden){if(!this.current)return;this.segment++;this.current.events.push({type:hidden?'hidden':'visible',timestamp:this.now()});this.persist().catch(()=>{});if(hidden)this.status('GPS may pause while Bluefy is hidden. Keep the screen on for a complete route.');else this.keepAwake();}
 stopWatch(){if(this.watch!==null){this.geo?.clearWatch(this.watch);this.watch=null;}clearInterval(this.timer);this.wake?.release().catch(()=>{});this.wake=null;}
 async end(reason='stopped'){
  if(!this.current)return;this.stopWatch();this.current.endEpochMs=this.now();this.current.events.push({type:reason,timestamp:this.now()});
  const session=this.current,result=structuredClone(session);await this.persist();if(this.current===session)this.current=null;this.status(`GPS saved: ${result.points.length} fixes${reason==='disconnected'?' · partial route; Bluetooth disconnected':''}.`);return result;
 }
}
