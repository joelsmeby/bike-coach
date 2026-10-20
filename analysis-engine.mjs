// One offline analysis engine, executed by the browser and Qt's JavaScript runtime.
// Keep this module free of browser/Node dependencies. Non-finite plot values serialize as null.
export const ENGINE_VERSION = 'shared-motion/2.0.0';
export const DEFAULT_SETTINGS = {
 filter:'median',window_samples:3,cutoff_hz:5,mode:'sequence',core_g:.4,expand_g:.6,min_core_s:.12,max_window_s:3,
 impact_g:1.5,impact_search_s:.3,gap_s:.12,accel_range_g:2,gyro_range_dps:250,uniform_hz:0,assumed_speed_mph:18,
 distance_mode:'auto',gps_max_sync_s:.25,gps_max_gap_s:1.5,gps_max_age_s:1,gps_max_accuracy_m:20,
 gyro_detection:'assist',gyro_join_s:.35,gyro_refine_s:.12,gyro_bridge_g:1,gyro_evidence:'support',gyro_channel:'all',
 gyro_trend_s:.12,gyro_context_s:.3,gyro_ratio:.65,gyro_floor_dps:1,merge_gap_s:.2,landing_hold_s:.08
};
const finite = x => typeof x === 'number' && Number.isFinite(x);
const sum = a => a.reduce((s,x)=>s+x,0), mean = a => sum(a)/a.length;
const max = a => a.reduce((m,x)=>Math.max(m,x),-Infinity), min = a => a.reduce((m,x)=>Math.min(m,x),Infinity);
const norm = a => Math.sqrt(sum(a.map(x=>x*x)));
const median = a => {const b=a.slice().sort((x,y)=>x-y),n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;};
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
// Match Python's ties-to-even rounding for physical windows converted to samples.
const round = x => {const n=Math.floor(x),d=x-n;return d===.5?n+n%2:Math.round(x);};
const odd = n => n+(1-n%2);
export function search(a,x,right=false){let l=0,h=a.length;while(l<h){const m=(l+h)>>1;if(a[m]<x||(right&&a[m]===x))l=m+1;else h=m;}return l;}
function linspace(a,b,n){return Array.from({length:n},(_,i)=>a+(b-a)*i/(n-1));}
function interp(x,t,y){const r=search(t,x);if(!r)return y[0];if(r===t.length)return y[y.length-1];const f=(x-t[r-1])/(t[r]-t[r-1]);return y[r-1]*(1-f)+y[r]*f;}
function trap(t,y){let s=0;for(let i=1;i<t.length;i++)s+=(y[i]+y[i-1])*(t[i]-t[i-1])/2;return s;}
export function segments(t,gap){const out=[];let a=0;for(let i=1;i<t.length;i++)if(t[i]-t[i-1]>gap){out.push([a,i]);a=i;}out.push([a,t.length]);return out;}
function runs(mask,offset=0){const out=[];let a=-1;for(let i=0;i<=mask.length;i++){if(mask[i]&&a<0)a=i;if(!mask[i]&&a>=0){out.push([a+offset,i-1+offset]);a=-1;}}return out;}
function box(a,w,kind='mean'){const h=(w-1)/2,out=[];for(let i=0;i<a.length;i++){const v=[];for(let k=-h;k<=h;k++)v.push(a[clamp(i+k,0,a.length-1)]);out.push(kind==='median'?median(v):mean(v));}return out;}
export function settings(input={}){
 for(const k of Object.keys(input))if(!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS,k))throw Error('Unknown setting: '+k);
 const s=Object.assign({},DEFAULT_SETTINGS,input);
 for(const k of Object.keys(s))if(typeof DEFAULT_SETTINGS[k]==='number'&&!finite(s[k]))throw Error('Settings must be finite numbers.');
 if(!['raw','median','mean','butterworth'].includes(s.filter)||!['sequence','threshold'].includes(s.mode))throw Error('Unknown filter or detector.');
 if(!Number.isInteger(s.window_samples)||s.window_samples<1||s.window_samples%2!==1)throw Error('Filter window must be a positive odd number.');
 if(!(0<s.core_g&&s.core_g<=s.expand_g&&0<s.min_core_s&&s.min_core_s<=s.max_window_s))throw Error('Invalid load thresholds/durations.');
 for(const k of ['cutoff_hz','impact_search_s','gap_s','accel_range_g','gyro_range_dps','impact_g','gyro_bridge_g','gyro_trend_s','gyro_context_s','gyro_floor_dps','gps_max_sync_s','gps_max_gap_s','gps_max_age_s','gps_max_accuracy_m','landing_hold_s'])if(!(s[k]>0))throw Error(k+' must be positive.');
 for(const k of ['uniform_hz','assumed_speed_mph','merge_gap_s','gyro_join_s','gyro_refine_s'])if(s[k]<0)throw Error(k+' cannot be negative.');
 if(!['assist','off'].includes(s.gyro_detection)||!['off','support'].includes(s.gyro_evidence)||!['all','pitch'].includes(s.gyro_channel)||!(s.gyro_ratio>0&&s.gyro_ratio<1)||!['auto','assumed'].includes(s.distance_mode))throw Error('Invalid gyro or distance setting.');
 return s;
}
export function recordingDefaults(ride){
 const oldRange=ride.accel.some(v=>v.some(x=>Math.abs(Math.abs(x)-2)<=.00017));
 return Object.assign({},DEFAULT_SETTINGS,{accel_range_g:oldRange?2:16,gyro_range_dps:oldRange?250:2000});
}
// Second-order bilinear Butterworth, steady-state filter initialization, odd 9-sample padding.
function butterworth(a,cutoff,fs){
 const k=Math.tan(Math.PI*cutoff/fs),z=1/(1+Math.SQRT2*k+k*k),b0=k*k*z,b1=2*b0,b2=b0,a1=2*(k*k-1)*z,a2=(1-Math.SQRT2*k+k*k)*z;
 const pass = x => {let z1=(1-b0)*x[0],z2=(b2-a2)*x[0];return x.map(v=>{const y=b0*v+z1;z1=b1*v-a1*y+z2;z2=b2*v-a2*y;return y;});};
 const ext=a.slice(1,10).reverse().map(v=>2*a[0]-v).concat(a,a.slice(-10,-1).reverse().map(v=>2*a[a.length-1]-v));
 return pass(pass(ext).reverse()).reverse().slice(9,-9);
}
export function filterLoad(t,raw,input={}){
 const s=settings(input),out=raw.slice(),warnings=[];
 for(const [a,b] of segments(t,s.gap_s)){
  const v=raw.slice(a,b);let clean=v;
  if(s.filter==='median'||s.filter==='mean')clean=box(v,s.window_samples,s.filter);
  if(s.filter==='butterworth'){
   if(v.length<3){warnings.push('Short segment left unfiltered.');continue;}
   const tt=t.slice(a,b),fs=(tt.length-1)/(tt[tt.length-1]-tt[0]);
   if(s.cutoff_hz>=fs/2)throw Error('Cutoff must be below Nyquist.');
   if(v.length<=9){warnings.push('Short segment left unfiltered (Butterworth padding).');continue;}
   const grid=linspace(tt[0],tt[tt.length-1],tt.length),uniform=grid.map(x=>interp(x,tt,v)),filtered=butterworth(uniform,s.cutoff_hz,fs);
   clean=tt.map(x=>interp(x,grid,filtered));
  }
  for(let i=a;i<b;i++)out[i]=clean[i-a];
 }
 return {filtered:out,warnings:[...new Set(warnings)]};
}
export function bikeFrame(ride){
 const c=ride.calibration||{},basis=[c.forward,c.left,c.up],bias=c.bias||[0,0,0];
 if(!basis.every(v=>Array.isArray(v)&&v.length===3&&v.every(finite))||!Array.isArray(bias)||bias.length!==3||!bias.every(finite))return null;
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(Math.abs(sum(basis[i].map((x,k)=>x*basis[j][k]))-(i===j?1:0))>.03001)return null;
 return ride.gyro.map(v=>basis.map(axis=>sum(axis.map((x,i)=>x*(v[i]-bias[i])))));
}
// Degree-one Savitzky–Golay: centered means with fitted linear end windows.
function trend(v,w){
 const h=(w-1)/2,n=v.length,out=box(v,w);
 for(const [start,first,last] of [[0,0,h],[n-w,n-h,n]]){
  const y=v.slice(start,start+w),ym=mean(y),den=w*(w*w-1)/12,slope=sum(y.map((x,i)=>(i-h)*(x-ym)))/den;
  for(let i=first;i<last;i++)out[i]=ym+slope*(i-start-h);
 }
 return out;
}
export function vibration(ride,t,s,parts){
 const out=t.map(()=>null),warnings=[];let rates=ride.gyro,channel='all axes';
 if(s.gyro_evidence==='off')return {rough:out,channel:'off',warnings};
 if(s.gyro_channel==='pitch'){const frame=bikeFrame(ride);if(!frame)return {rough:out,channel:'pitch unavailable',warnings:['Pitch evidence needs a valid saved bike frame; no device axis was substituted.']};rates=frame.map(v=>[v[1]]);channel='bike pitch rate';}
 const clipped=ride.gyro.map(v=>v.some(x=>Math.abs(x)>=s.gyro_range_dps*.9999));
 for(const [a,b] of parts){
  const tt=t.slice(a,b),n=tt.length;if(n<8)continue;
  const fs=(n-1)/(tt[n-1]-tt[0]);if(fs<20)continue;
  const w=odd(Math.max(5,round(s.gyro_trend_s*fs))),rw=odd(Math.max(3,round(.06*fs))),guard=(w-1)/2+(rw-1)/2;
  if(n<=2*guard+3)continue;
  const grid=linspace(tt[0],tt[n-1],n),power=tt.map(()=>0);
  for(let axis=0;axis<rates[0].length;axis++){
   const column=rates.slice(a,b).map(v=>v[axis]),v=grid.map(x=>interp(x,tt,column)),sm=trend(v,w);
   for(let i=0;i<n;i++)power[i]+=(v[i]-sm[i])**2;
  }
  const rough=box(power,rw).map(x=>Math.sqrt(Math.max(0,x))),clipValues=clipped.slice(a,b).map(Number),flags=grid.map(x=>interp(x,tt,clipValues)>0);
  const invalid=flags.map((_,i)=>i<guard||i>=n-guard||flags.slice(Math.max(0,i-guard),Math.min(n,i+guard+1)).some(Boolean));
  const bad=invalid.map(Number);
  for(let i=0;i<n;i++)out[a+i]=interp(tt[i],grid,bad)>0?null:interp(tt[i],grid,rough);
 }
 warnings.push('Gyro contrast is a heuristic; centered filters blur timing.');
 return {rough:out,channel,warnings};
}
export function gyroEvidence(t,rough,event,s,part){
 const r={status:'unavailable',support_score:null,takeoff_score:null,landing_score:null,before_dps:null,flight_dps:null,after_dps:null,takeoff_supported:false,landing_supported:false,reasons:[]};
 if(s.gyro_evidence==='off')return Object.assign({},r,{status:'off',reasons:['Gyro evidence disabled.']});
 const [a,b]=part,dt=(t[b-1]-t[a])/(b-a-1),guard=Math.max(s.gyro_trend_s/2+.03,((odd(Math.max(5,round(s.gyro_trend_s/dt)))-1)/2+(odd(Math.max(3,round(.06/dt)))-1)/2)*dt);
 const start=event.start_s,end=start+event.window_s;
 for(const [key,lo,hi] of [['before_dps',start-guard-s.gyro_context_s,start-guard],['flight_dps',start+guard,end-guard],['after_dps',end+guard,end+guard+s.gyro_context_s]]){
  const first=search(t,lo),last=search(t,hi,true),values=rough.slice(first,last);
  if(lo<t[a]||hi>t[b-1]||values.length<3||hi-lo<.06||!values.every(finite)){r.reasons.push(key+': insufficient continuous, unclipped gyro coverage.');continue;}
  r[key]=Math.sqrt(trap(t.slice(first,last),values.map(x=>x*x))/(t[last-1]-t[first]));
 }
 if(r.flight_dps===null)return r;
 for(const [side,key] of [['takeoff','before_dps'],['landing','after_dps']]){
  const base=r[key];if(base===null)continue;
  if(base<s.gyro_floor_dps){r.reasons.push(side+': surrounding trail already quiet; contrast is inconclusive.');continue;}
  r[side+'_score']=100*clamp(1-r.flight_dps/base,0,1);r[side+'_supported']=r.flight_dps/base<=s.gyro_ratio;
 }
 const scores=[r.takeoff_score,r.landing_score];
 if(scores.every(x=>x!==null)){r.support_score=min(scores);r.status=r.takeoff_supported&&r.landing_supported?'supports':r.takeoff_supported||r.landing_supported?'mixed':'no contrast';}
 else if(scores.some(x=>x!==null))r.status='partial';
 r.reasons.push('Score is a heuristic; see gyro_detection for actual timing/join changes.');return r;
}
function windowEvidence(t,rough,left,right,s,part){const [a,b]=part,dt=(t[b-1]-t[a])/(b-a-1);return gyroEvidence(t,rough,{start_s:t[left],window_s:t[right]-t[left]+dt},s,part);}
function canBridge(t,clean,rough,p,w,s,part){
 if(s.gyro_detection!=='assist'||s.gyro_evidence==='off')return false;
 const left=p.left,right=w.right,dt=(t[part[1]-1]-t[part[0]])/(part[1]-part[0]-1),a=p.right+1,b=w.left;
 if(t[w.left]-t[p.right]>s.gyro_join_s+1e-8||t[right]-t[left]+dt>s.max_window_s||a>=b||!rough.slice(left,right+1).every(finite))return false;
 if(mean(clean.slice(a,b))>s.gyro_bridge_g||max(clean.slice(a,b))>=s.impact_g)return false;
 const e=windowEvidence(t,rough,left,right,s,part);if(e.status!=='supports')return false;
 return rough.slice(a,b).every(x=>x<=Math.min(e.before_dps,e.after_dps)*s.gyro_ratio);
}
export function refineWindow(t,clean,raw,rough,w,s,part){
 const left=w.left,right=w.right;
 if(s.gyro_detection!=='assist'||s.gyro_refine_s===0)return [left,right,'acceleration timing'];
 const e=windowEvidence(t,rough,left,right,s,part);
 if(e.status!=='supports'||!rough.slice(left,right+1).every(finite))return [left,right,'acceleration timing: gyro contrast insufficient or unavailable'];
 const threshold=Math.min(e.before_dps,e.after_dps)*s.gyro_ratio,a=Math.max(part[0]+1,search(t,t[left]-s.gyro_refine_s)),b=Math.min(part[1]-1,search(t,t[right]+s.gyro_refine_s,true));
 const quiet=rough.slice(a,b).map(x=>finite(x)&&x<=threshold),dt=(t[part[1]-1]-t[part[0]])/(part[1]-part[0]-1),choices=[];
 for(const [first,last] of runs(quiet,a)){
  if(t[first]>t[left]+s.gyro_refine_s+1e-8||t[last]<t[right]-s.gyro_refine_s-1e-8)continue;
  const overlap=Math.max(0,t[Math.min(last,right)]-t[Math.max(first,left)]+dt);
  if(overlap<Math.max(s.min_core_s,.5*(t[right]-t[left]+dt)))continue;
  let l=first>=left?first:left,r=last<=right?last:right;
  if(first<left)while(l>first&&clean[l-1]<Math.max(.8,s.expand_g)&&raw[l-1]<s.impact_g)l--;
  if(last>right)while(r<last&&clean[r+1]<Math.max(.8,s.expand_g)&&raw[r+1]<s.impact_g)r++;
  if(l>r||t[r]-t[l]+dt>s.max_window_s)continue;
  if(!runs(clean.slice(l,r+1).map(x=>x<s.core_g),l).some(([x,y])=>t[y]-t[x]+dt+1e-8>=s.min_core_s))continue;
  choices.push([overlap,l,r]);
 }
 if(!choices.length)return [left,right,'acceleration timing: no safe gyro refinement'];
 choices.sort((a,b)=>b[0]-a[0]||b[1]-a[1]||b[2]-a[2]);const [,l,r]=choices[0];return [l,r,l!==left||r!==right?'gyro refined timing':'gyro agrees with acceleration timing'];
}
export function gpsSummary(g){
 if(!g)return {available:false,note:'No matching GPS metadata.'};
 const p=g.points,intervals=[];for(let i=1;i<p.length;i++)if(p[i].segment===p[i-1].segment)intervals.push(p[i].t-p[i-1].t);
 return {available:true,fix_count:p.length,speed_fix_count:p.filter(x=>x.speed!==null).length,median_interval_s:intervals.length?median(intervals):null,largest_interval_s:intervals.length?max(intervals):null,sync_uncertainty_s:g.uncertainty_s,timing_method:g.timing_method,note:'Position accuracy is not speed accuracy. RTC alignment and clock drift may add error.'};
}
export function estimateDistance(g,e,s){
 const r={source:'assumed_constant_speed_x_candidate_window',quality:'assumed',distance_m:s.assumed_speed_mph*.44704*e.window_s,mean_horizontal_mps:s.assumed_speed_mph*.44704,approach_horizontal_mps:null,fixes_in_window:0,reasons:[]};
 if(s.distance_mode==='assumed')return Object.assign({},r,{reasons:['Assumed-speed mode selected.']});
 if(!g)return Object.assign({},r,{reasons:['No matching GPS data.']});
 r.sync_uncertainty_s=g.uncertainty_s;r.timing_method=g.timing_method;
 if(s.uniform_hz)return Object.assign({},r,{reasons:['Uniform-rate override changes the IMU clock; GPS alignment disabled.']});
 if(g.uncertainty_s>s.gps_max_sync_s)return Object.assign({},r,{reasons:['GPS/IMU synchronization uncertainty exceeds the allowed limit.']});
 const p=g.points,start=e.start_s,end=start+e.window_s,good=p=>p.accuracy<=s.gps_max_accuracy_m&&finite(p.speed),ts=p.map(x=>x.t),l=search(ts,start,true)-1,h=search(ts,end);
 let approach=p.filter(x=>x.t>=start-3&&x.t<=start);
 if(approach.length&&good(approach[approach.length-1])&&start-approach[approach.length-1].t<=s.gps_max_age_s){
  const seg=approach[approach.length-1].segment;approach=approach.filter(x=>x.segment===seg);
  if(approach.length>=2&&approach.every(good)&&approach.every((x,i)=>!i||x.t-approach[i-1].t<=s.gps_max_gap_s))r.approach_horizontal_mps=median(approach.map(x=>x.speed));
 }
 const reasons=[];
 if(l>=0&&l<h&&h<p.length){
  const local=p.slice(l,h+1),gaps=local.slice(1).map((x,i)=>x.t-local[i].t);
  if(local.every(good)&&local.every(x=>x.segment===local[0].segment)&&max(gaps)<=s.gps_max_gap_s&&start-local[0].t<=s.gps_max_age_s&&local[local.length-1].t-end<=s.gps_max_age_s){
   const grid=[start].concat(local.filter(x=>x.t>start&&x.t<end).map(x=>x.t),[end]),v=grid.map(x=>interp(x,local.map(p=>p.t),local.map(p=>p.speed))),d=trap(grid,v),inside=local.filter(x=>x.t>=start&&x.t<=end).length,sparse=max(gaps)>.25||inside<3||g.uncertainty_s>.1||g.timing_method==='phone-command';
   return Object.assign({},r,{source:'gps_horizontal_speed_integral',quality:sparse?'sparse':'sampled',distance_m:d,mean_horizontal_mps:d/e.window_s,fixes_in_window:inside,largest_gap_s:max(gaps),position_accuracy_worst_m:max(local.map(x=>x.accuracy)),reasons:[sparse?'Sparse or approximate GPS; interpolation cannot resolve instantaneous takeoff speed.':'Reported horizontal speed; browser velocity accuracy is unavailable.']});
  }
  reasons.push('GPS coverage crosses a gap/segment, is stale, or has missing speed/poor position quality.');
 }else reasons.push('GPS does not bracket the full candidate interval.');
 if(r.approach_horizontal_mps!==null)return Object.assign({},r,{source:'gps_approach_speed',quality:'approach_only',distance_m:r.approach_horizontal_mps*e.window_s,mean_horizontal_mps:r.approach_horizontal_mps,reasons:reasons.concat(['Recent approach horizontal speed held constant; flight speed was not measured.'])});
 return Object.assign({},r,{reasons:reasons.concat(['No usable recent approach speed; using the explicit speed assumption.'])});
}
export function analyzeRide(ride,input={}){
 if(!ride||!Array.isArray(ride.time)||ride.time.length<4||!Array.isArray(ride.accel)||!Array.isArray(ride.gyro)||ride.accel.length!==ride.time.length||ride.gyro.length!==ride.time.length||!ride.time.every((x,i)=>finite(x)&&(!i||x>ride.time[i-1]))||![ride.accel,ride.gyro].every(rows=>rows.every(v=>Array.isArray(v)&&v.length===3&&v.every(finite))))throw Error('Analysis needs finite, strictly increasing sample times and matching 3-axis data.');
 const s=settings(input),t=ride.time.map((x,i)=>s.uniform_hz?i/s.uniform_hz:x),raw=ride.accel.map(norm),filtered=filterLoad(t,raw,s),clean=filtered.filtered,parts=segments(t,s.gap_s),v=vibration(ride,t,s,parts),rough=v.rough;
 const calibratedRates=bikeFrame(ride),rotationRates=calibratedRates||ride.gyro;
 const clipped=ride.accel.map(v=>v.some(x=>Math.abs(x)>=s.accel_range_g*.9999)),gclip=ride.gyro.map(v=>v.some(x=>Math.abs(x)>=s.gyro_range_dps*.9999)),events=[];
 for(const [a,b] of parts){
  const dt=(t[b-1]-t[a])/(b-a-1),windows=[];
  for(const [cs,ce] of runs(clean.slice(a,b).map(x=>x<s.core_g),a)){
   if(t[ce]-t[cs]+dt+1e-8<s.min_core_s)continue;
   let l=cs,r=ce;while(l>a&&clean[l-1]<s.expand_g)l--;while(r+1<b&&clean[r+1]<s.expand_g)r++;
   if(t[r]-t[l]+dt>s.max_window_s||l===a||r===b-1)continue;
   const last=windows[windows.length-1],core=[t[cs],t[ce]];
   if(last&&last.left===l&&last.right===r){last.cores.push(core);continue;}
   windows.push({left:l,right:r,cores:[core],parts:1,gyro_joins:0});
  }
  const joined=[];
  for(const w of windows){
   const prev=joined[joined.length-1];let join=false,gyroJoin=false;
   if(prev&&s.merge_gap_s>0&&t[w.left]-t[prev.right]<=s.merge_gap_s+1e-8&&t[w.right]-t[prev.left]+dt<=s.max_window_s){
    const contact=clean.slice(prev.right+1,w.left).map(x=>x>=Math.max(.8,s.expand_g));
    join=!runs(contact,prev.right+1).some(([x,y])=>t[y]-t[x]+dt+1e-8>=s.landing_hold_s);
   }
   if(!join&&prev){const limit=Math.min(b,search(t,t[w.right]+s.impact_search_s,true)),hit=s.mode==='threshold'||raw.slice(w.right+1,limit).some(x=>x>s.impact_g);gyroJoin=hit&&canBridge(t,clean,rough,prev,w,s,[a,b]);join=gyroJoin;}
   if(join){prev.right=w.right;prev.cores=prev.cores.concat(w.cores);prev.parts+=w.parts;if(gyroJoin)prev.gyro_joins++;}else joined.push(w);
  }
  for(const w of joined){
   const seedLeft=w.left,seedRight=w.right;let [l,r,reason]=refineWindow(t,clean,raw,rough,w,s,[a,b]),limit=Math.min(b,search(t,t[r]+s.impact_search_s,true));
   let hit=raw.slice(r+1,limit).findIndex(x=>x>s.impact_g);
   if(hit<0&&s.mode==='sequence'&&(l!==seedLeft||r!==seedRight)){const sl=Math.min(b,search(t,t[seedRight]+s.impact_search_s,true)),sh=raw.slice(seedRight+1,sl).findIndex(x=>x>s.impact_g);if(sh>=0){l=seedLeft;r=seedRight;limit=sl;hit=sh;reason='acceleration timing: gyro refinement would lose observed impact';}}
   const index=hit<0?null:r+1+hit;if(s.mode==='sequence'&&index===null)continue;
   const e={start_index:l,end_index:r,start_s:t[l],end_s:t[r],window_s:t[r]-t[l]+dt,cores:w.cores,joined_windows:w.parts,
    gyro_detection:{mode:s.gyro_detection,joined_gaps:w.gyro_joins,timing:reason,acceleration_start_s:t[seedLeft],acceleration_end_s:t[seedRight],start_shift_s:t[l]-t[seedLeft],end_shift_s:t[r]-t[seedRight]},
    impact_s:index===null?null:t[index],impact_g:index===null?null:raw[index],mean_g:mean(raw.slice(l,r+1)),min_g:min(raw.slice(l,r+1)),clipped:clipped.slice(l,limit).some(Boolean),gyro_clipped:gclip.slice(l,limit).some(Boolean)};
   const frame=rotationRates;
   e.rotation={roll:0,pitch:0,yaw:0};e.rotationTravel={roll:0,pitch:0,yaw:0};e.rotation_frame=calibratedRates?'bike':'device';
   for(let i=l+1;i<=r;i++)for(let axis=0;axis<3;axis++){const key=['roll','pitch','yaw'][axis],dt=t[i]-t[i-1];e.rotation[key]+=(frame[i-1][axis]+frame[i][axis])*dt/2;e.rotationTravel[key]+=(Math.abs(frame[i-1][axis])+Math.abs(frame[i][axis]))*dt/2;}
   e.gyro_evidence=Object.assign({},gyroEvidence(t,rough,e,s,[a,b]),{channel:v.channel});
   const d=estimateDistance(ride.gps,e,s);e.distance_m=d.distance_m;e.distance_ft=d.distance_m/.3048;e.assumed_speed_mph=s.assumed_speed_mph;e.distance_source=d.source;e.distance_evidence=d;
   e.height_m=9.80665*e.window_s*e.window_s/8;e.height_ft=e.height_m/.3048;e.height_source='ballistic_equal_height_candidate_window';
   e.height_assumption='Estimate from candidate duration; assumes ballistic flight and equal takeoff/landing elevation. Not measured height.';
   events.push(e);
  }
 }
 const intervals=t.slice(1).map((x,i)=>x-t[i]).filter(x=>x<=s.gap_s),warnings=(ride.warnings||[]).concat(filtered.warnings,v.warnings);
 if(s.uniform_hz)warnings.push('Uniform sample-rate override active: RTC gaps and timing jitter are ignored.');
 return {time:t,raw,filtered:clean,events,clipped,gyro_clipped:gclip,gyro_rates:rotationRates,gyro_frame:calibratedRates?'bike':'device',gyro_vibration:rough,gyro_channel:v.channel,sample_hz:intervals.length?1/mean(intervals):0,gap_count:parts.length-1,gps:gpsSummary(ride.gps),warnings,algorithm_version:ENGINE_VERSION};
}
export function importGps(lines){
 const comments={};
 for(const name of ['BikeCoachRide','BikeCoachGPS']){const line=lines.find(x=>x.startsWith('# '+name+'='));if(line){try{comments[name]=JSON.parse(line.split('=').slice(1).join('='));}catch(error){return {gps:null,warnings:['GPS metadata is invalid; using the speed assumption.']};}}}
 const g=comments.BikeCoachGPS,r=comments.BikeCoachRide;
 if(!g)return {gps:null,warnings:[]};
 try{
  if(!r||g.schemaVersion!==1||!/^[a-f0-9]{16}$/.test(g.id)||g.id!==r.id)throw Error('recording identity mismatch');
  const q=g.sync;if(!q||![q.phoneEpochMs,q.boardMs,q.uncertaintyMs].every(finite)||q.uncertaintyMs<0||q.uncertaintyMs>2000||![q.boardMs,r.startBoardMs].every(x=>Number.isInteger(x)&&x>=0&&x<2**32))throw Error('invalid clock synchronization');
  const delta=(r.startBoardMs-q.boardMs+2**32)%2**32;if(delta>60000)throw Error('clock synchronization is too far from recording start');
  const start=q.phoneEpochMs+delta;if(!Array.isArray(g.points)||g.points.length>100000)throw Error('invalid point list');
  let last=-Infinity;
  const points=g.points.map(p=>{
   if(!p||![p.timestamp,p.latitude,p.longitude,p.accuracy].every(finite)||p.timestamp<=last||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180||p.accuracy<0||!Number.isInteger(p.segment)||p.segment<0)throw Error('invalid GPS fix');
   last=p.timestamp;return Object.assign({},p,{t:(p.timestamp-start)/1000,speed:finite(p.speed)&&p.speed>=0&&p.speed<=40?p.speed:null});
  });
  if(g.endEpochMs!=null&&(!finite(g.endEpochMs)||g.endEpochMs<start))throw Error('invalid recording end time');
  return {gps:{points:points.filter(p=>p.timestamp>=start&&(g.endEpochMs==null||p.timestamp<=g.endEpochMs)),uncertainty_s:q.uncertaintyMs/1000,timing_method:g.timingMethod||r.timingMethod||'board-clock',id:g.id},warnings:[]};
 }catch(e){return {gps:null,warnings:['GPS ignored: '+e.message+'. Using the speed assumption.']};}
}
function csvCells(line){const out=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){out.push(value.trim());value='';}else value+=c;}if(quoted)throw Error('Unclosed CSV quote.');out.push(value.trim());return out;}
export function parseRide(text){
 const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/),warnings=[];let calibration={};
 const cal=lines.find(x=>x.startsWith('# BikeCoachCalibration='));if(cal){try{calibration=JSON.parse(cal.split('=').slice(1).join('='));}catch(error){warnings.push('Calibration comment is invalid; displaying device axes.');}}
 const rows=lines.filter(x=>x.trim()&&!x.startsWith('#')),head=csvCells(rows.shift()||''),required=['rtcDate','rtcTime','aX','aY','aZ','gX','gY','gZ'];
 if(!required.every(k=>head.includes(k)))throw Error('CSV needs rtcDate, rtcTime, aX/aY/aZ (mg), gX/gY/gZ (degrees/s).');
 const time=[],accel=[],gyro=[],rates=[];let first=null;
 for(let i=0;i<rows.length;i++){
  const cells=csvCells(rows[i]),row={};head.forEach((k,j)=>row[k]=cells[j]);
  const date=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(row.rtcDate||''),clock=/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,6})$/.exec(row.rtcTime||'');
  if(!date||!clock)throw Error('Invalid RTC timestamp near CSV row '+(i+2));
  const [,month,day,year]=date.map(Number),hh=Number(clock[1]),mm=Number(clock[2]),ss=Number(clock[3]),fraction=Number('0.'+clock[4]),base=new Date(Date.UTC(year,month-1,day,hh,mm,ss));
  if(base.getUTCFullYear()!==year||base.getUTCMonth()!==month-1||base.getUTCDate()!==day||hh>23||mm>59||ss>59)throw Error('Invalid RTC timestamp near CSV row '+(i+2));
  const stamp=base.getTime()/1000+fraction;if(first===null)first=stamp;
  const values=['aX','aY','aZ','gX','gY','gZ'].map(k=>row[k]==null||row[k]===''?NaN:Number(row[k]));
  if(!values.every(finite))throw Error('Invalid sensor record near CSV row '+(i+2));
  // Avoid epoch-sized floating point cancellation; retain microsecond RTC precision.
  time.push(Math.round((stamp-first)*1e6)/1e6);accel.push(values.slice(0,3).map(x=>x/1000));gyro.push(values.slice(3));
  const hz=Number(row.output_Hz);if(finite(hz)&&hz>0)rates.push(hz);
 }
 if(time.length<4)throw Error('Recording needs at least four valid samples.');
 if(time.some((x,i)=>i&&x<time[i-1]))throw Error('RTC timestamps move backwards. Split the recording at the clock reset first.');
 const repeats=time.filter((x,i)=>i&&x===time[i-1]).length;
 if(repeats){
  if(time[time.length-1]<=0)throw Error('Recording has no measurable timestamp span.');
  const dt=time[time.length-1]/(time.length-1),original=time.slice();
  for(let a=0;a<time.length;){let b=a+1;while(b<time.length&&original[b]===original[a])b++;if(b-a>1){let width=b<time.length?original[b]-original[a]:dt*(b-a);if(width>.12)width=dt*(b-a);for(let i=a;i<b;i++)time[i]+=(i-a)*width/(b-a);}a=b;}
  warnings.push(repeats+' repeated RTC stamps: sample times interpolated within bins; boundaries are approximate.');
 }
 const g=importGps(lines);warnings.push('Acceleration units assumed mg; gyro units assumed degrees/s. Sensor ranges are editable assumptions.',...g.warnings);
 return {time,accel,gyro,calibration,warnings,repeated_timestamps:repeats,reported_hz:rates.length?median(rates):null,gps:g.gps};
}
// A JSON boundary prevents runtime-specific object conversions and invalid JSON numbers.
export function dispatch(request){
 const {operation,args}=JSON.parse(request);const functions={analyzeRide,parseRide,filterLoad,recordingDefaults,settings,importGps,estimateDistance,gpsSummary,bikeFrame};
 if(operation==='metadata')return JSON.stringify({version:ENGINE_VERSION,defaults:DEFAULT_SETTINGS});
 if(!functions[operation])throw Error('Unknown engine operation.');
 return JSON.stringify(functions[operation](...args));
}
