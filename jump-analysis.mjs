// Compatibility API: all jump decisions/metrics now come from the shared engine.
import {analyzeRide} from './analysis-engine.mjs';
export function analyzeJumps(rows, options={}) {
  if(!Array.isArray(rows)||rows.length<4)return [];
  const first=rows[0].ts;
  const ride={time:rows.map(r=>r.ts-first),accel:rows.map(r=>[r.aX,r.aY,r.aZ].map(Number).map(x=>x/1000)),gyro:rows.map(r=>[r.gX,r.gY,r.gZ].map(Number)),calibration:options.calibration||{},gps:options.gps||null,warnings:[]};
  const settings=Object.assign({},options.settings||{});
  if(options.lowG!=null)settings.core_g=options.lowG;
  if(options.minFlight!=null)settings.min_core_s=options.minFlight;
  if(options.maxFlight!=null)settings.max_window_s=options.maxFlight;
  return analyzeRide(ride,settings).events.map(e=>Object.assign({},e,{start:e.start_s,end:e.end_s,duration:e.window_s,minG:e.min_g,landingG:e.impact_g,confidence:e.gyro_evidence.status}));
}
