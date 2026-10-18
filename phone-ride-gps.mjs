import {newRideId,withGps} from './gps.mjs?v=2';

// Firmware without ride IDs cannot prove an association after a disconnect.
// Keep that association only for this uninterrupted start/stop/download workflow.
export class PhoneRideGps {
 constructor(recorder,{now=()=>Date.now(),mono=()=>performance.now()}={}){this.recorder=recorder;this.now=now;this.mono=mono;this.pending=null;}
 async start(command){
  this.pending=null;
  const id=newRideId();
  await this.recorder.begin(id,{phoneEpochMs:this.now(),boardMs:0,uncertaintyMs:0});
  const before=this.now(),mono=this.mono();
  try{
   const reply=await command(),elapsed=this.mono()-mono;
   if(Math.abs(this.now()-before-elapsed)>100)throw Error('Phone clock changed while starting. Stop recording and retry.');
   const track=this.recorder.current;
   track.sync={phoneEpochMs:before+elapsed/2,boardMs:0,uncertaintyMs:elapsed/2+25};
   track.timingMethod='phone-command';
   this.pending={id,name:reply.slice(8),start:track.sync.phoneEpochMs,uncertaintyMs:track.sync.uncertaintyMs,track:null};
   await this.recorder.persist();
   return reply;
  }catch(error){await this.recorder.end('start-unconfirmed').catch(()=>{});throw error;}
 }
 stop(track){if(this.pending&&track?.id===this.pending.id)this.pending.track=track;}
 invalidate(){this.pending=null;}
 rename(oldName,newName){if(this.pending?.name===oldName)this.pending.name=newName;}
 attach(recording){
  const p=this.pending,g=p?.track;
  if(!g||p.name!==recording.name||g.events.some(e=>e.type==='disconnected')||!Number.isFinite(g.endEpochMs))return {csv:recording.csv,gps:null};
  const expected=g.endEpochMs-p.start;
  // Stop-command latency and the first/last 50 Hz sample bound this check.
  if(!Number.isFinite(recording.duration)||Math.abs(expected-recording.duration)>Math.max(2000,p.uncertaintyMs*2+100))return {csv:recording.csv,gps:null};
  const metadata={id:p.id,startBoardMs:0,timingMethod:'phone-command'};
  const csv='# BikeCoachRide='+JSON.stringify(metadata)+'\n'+recording.csv;
  return {csv:withGps(csv,g),gps:{...g,startEpochMs:p.start}};
 }
}
