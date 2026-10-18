import test from 'node:test';
import assert from 'node:assert/strict';
import {GpsRecorder} from './gps-recorder.mjs';
import {PhoneRideGps} from './phone-ride-gps.mjs';
import {gpsFromCsv,withGps,bindGps} from './gps.mjs';
import {renameRecording} from './recording-names.mjs';
const csv='rtcDate,rtcTime,aX,aY,aZ,gX,gY,gZ,mX,mY,mZ,imu_degC,output_Hz,\n01/01/2000,00:00:00.00,0,0,1000,0,0,0,0,0,0,20,50,\n';
function harness(){
 let clock=1800000000000,accept,error,cleared=false;
 const saved=new Map(),messages=[];
 const recorder=new GpsRecorder({store:async(k,v)=>{saved.set(k,structuredClone(v));},onStatus:s=>messages.push(s),now:()=>clock,
  geo:{watchPosition(a,e,options){accept=a;error=e;assert.equal(options.enableHighAccuracy,true);return 7;},clearWatch(id){assert.equal(id,7);cleared=true;}}});
 const workflow=new PhoneRideGps(recorder,{now:()=>clock,mono:()=>clock});
 return {recorder,workflow,saved,messages,get cleared(){return cleared;},advance(ms){clock+=ms;},fix(){accept({timestamp:clock,coords:{latitude:47,longitude:-122,accuracy:5,speed:4}});},deny(){error({code:1});}};
}
test('legacy ride captures, persists and exports GPS with approximate alignment; raw bytes and rename survive',async()=>{
 const h=harness();await h.workflow.start(async()=>{h.advance(100);return 'LOGGING,ride1.TXT';});
 h.advance(100);h.fix();h.advance(1000);h.fix();h.recorder.visibility(true);h.advance(500);h.recorder.visibility(false);
 const track=await h.recorder.end();h.workflow.stop(track);assert(h.cleared);assert.equal(h.saved.get('gps:'+track.id).points.length,2);
 const attached=h.workflow.attach({name:'ride1.TXT',csv,duration:1600});assert(attached.gps);assert.equal(attached.gps.timingMethod,'phone-command');
 const decoded=gpsFromCsv(attached.csv);assert.equal(decoded.points.length,2);assert.equal(decoded.sync.uncertaintyMs,75);assert(decoded.events.some(e=>e.type==='hidden'));
 const renamed=renameRecording({name:'ride1.TXT',csv:attached.csv,gps:decoded,bytes:new Uint8Array([1,2])},'Trail_Run_1.TXT');
 assert.deepEqual([...renamed.bytes],[1,2]);assert.equal(gpsFromCsv(withGps(renamed.csv,renamed.gps)).id,track.id);
 assert.equal(withGps(attached.csv,decoded).match(/# BikeCoachGPS=/g).length,1);
});
test('wrong file, wrong duration and disconnect cannot attach a legacy track',async()=>{
 const h=harness();await h.workflow.start(async()=> 'LOGGING,ride1.TXT');h.advance(10000);h.fix();h.workflow.stop(await h.recorder.end());
 assert.equal(h.workflow.attach({name:'ride2.TXT',csv,duration:10000}).gps,null);
 assert.equal(h.workflow.attach({name:'ride1.TXT',csv,duration:100}).gps,null);
 h.workflow.rename('ride1.TXT','Trail.TXT');assert(h.workflow.attach({name:'Trail.TXT',csv,duration:10000}).gps);
 h.workflow.invalidate();assert.equal(h.workflow.attach({name:'Trail.TXT',csv,duration:10000}).gps,null);
});
test('native ride IDs bind persisted GPS across download/reload and reject different rides',async()=>{
 const h=harness(),id='0123456789abcdef';await h.recorder.begin(id,{boardMs:100,phoneEpochMs:1800000000000,uncertaintyMs:20});h.advance(100);h.fix();await h.recorder.end();
 const source='# BikeCoachRide='+JSON.stringify({id,startBoardMs:150})+'\n'+csv;
 const gps=bindGps(source,h.saved.get('gps:'+id));assert(gps);assert.equal(gps.startEpochMs,1800000000050);
 assert.equal(gpsFromCsv(withGps(source,gps)).points[0].latitude,47);
 assert.equal(bindGps(source.replace(id,'fedcba9876543210'),gps),null);
});
test('denied permission remains explicit and exports an empty track without inventing coordinates',async()=>{
 const h=harness();await h.workflow.start(async()=> 'LOGGING,ride1.TXT');h.deny();assert(h.cleared);assert.match(h.messages.at(-1),/permission denied/);
 h.advance(1000);h.workflow.stop(await h.recorder.end());const attached=h.workflow.attach({name:'ride1.TXT',csv,duration:1000});assert.equal(gpsFromCsv(attached.csv).points.length,0);
});
test('start failure clears GPS watch and cannot leave a matching ride association',async()=>{
 const h=harness();await assert.rejects(h.workflow.start(async()=>{throw Error('No confirmation');}),/No confirmation/);assert(h.cleared);assert.equal(h.workflow.pending,null);
});
