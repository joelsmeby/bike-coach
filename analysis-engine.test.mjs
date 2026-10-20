import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRide,DEFAULT_SETTINGS,settings,parseRide} from './analysis-engine.mjs';
const fixture=()=>{
 const time=Array.from({length:201},(_,i)=>i/50),accel=time.map(t=>[0,0,t>=1&&t<=1.5?.1:t===1.52?2.5:1]);
 return {time,accel,gyro:time.map(()=>[0,0,0]),calibration:{},warnings:[],gps:null};
};
test('known candidate metrics use explicit horizontal speed and equal-height assumption',()=>{
 const e=analyzeRide(fixture()).events[0];
 assert.equal(e.start_s,1);assert.equal(e.end_s,1.5);assert(Math.abs(e.window_s-.52)<1e-10);
 assert(Math.abs(e.distance_ft-13.728)<1e-8);assert(Math.abs(e.height_m-9.80665*.52**2/8)<1e-10);
 assert.equal(e.height_source,'ballistic_equal_height_candidate_window');assert.match(e.height_assumption,/equal takeoff\/landing elevation/);
});
test('changing speed changes distance, not height or detection',()=>{
 const a=analyzeRide(fixture()).events[0],b=analyzeRide(fixture(),{assumed_speed_mph:36}).events[0];
 assert.equal(a.start_s,b.start_s);assert.equal(a.height_m,b.height_m);assert.equal(b.distance_m,a.distance_m*2);
});
test('strict shared settings validation and original input stays intact',()=>{
 for(const value of [{extra:1},{gyro_ratio:1},{window_samples:2},{assumed_speed_mph:-1},{filter:'invalid'}])assert.throws(()=>settings(value));
 const ride=fixture(),before=JSON.stringify(ride);analyzeRide(ride);assert.equal(JSON.stringify(ride),before);
 assert.equal(settings().gyro_detection,DEFAULT_SETTINGS.gyro_detection);
});
test('invalid CSV or GPS cannot manufacture height/distance candidates',()=>{
 assert.throws(()=>parseRide('invalid'));
 const r=fixture();r.accel=r.time.map(()=>[0,0,1]);assert.deepEqual(analyzeRide(r).events,[]);
});
test('legacy entry point delegates to the shared decisions and metrics',async()=>{
 const {analyzeJumps}=await import('./jump-analysis.mjs');const r=fixture();
 const rows=r.time.map((ts,i)=>({ts,aX:r.accel[i][0]*1000,aY:r.accel[i][1]*1000,aZ:r.accel[i][2]*1000,gX:0,gY:0,gZ:0}));
 const legacy=analyzeJumps(rows)[0],shared=analyzeRide(r).events[0];
 assert.equal(legacy.start,shared.start_s);assert.equal(legacy.duration,shared.window_s);assert.equal(legacy.height_m,shared.height_m);assert.equal(legacy.distance_m,shared.distance_m);
});
