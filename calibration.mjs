// Pitch-only mounting changes preserve the device's bike-left axis.
// Gravity establishes up; left × up establishes forward without a heading sensor.
export const MOUNT_LEFT = [-0.837, -0.415, 0.357];
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
const norm = a => Math.hypot(...a);
const unit = a => a.map(x=>x/norm(a));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const acc = s => [s.aX,s.aY,s.aZ];
const gyro = s => [s.gX,s.gY,s.gZ];
const mean = a => [0,1,2].map(i=>a.reduce((sum,v)=>sum+v[i],0)/a.length);
function frameForUp(measuredUp,leftReference=MOUNT_LEFT){
  const up=unit(measuredUp),leftHint=unit(leftReference),sideways=dot(up,leftHint);
  if(Math.abs(sideways)>Math.sin(10*Math.PI/180))return null;
  const left=unit(leftHint.map((x,i)=>x-sideways*up[i]));
  return {forward:unit(cross(left,up)),left,up};
}
export function calibrate(samples, standalone=false) {
  let diagnostics=null;
  const bad = reason => ({ok:false, reason, diagnostics});
  if(!samples.length) return bad('No samples to calibrate.');
  // Use file-relative time, not the phone's clock. Discard the first second of handling.
  const first = samples[0].ts;
  const time = s => Number.isFinite(s.elapsed_ms)?s.elapsed_ms/1000:s.ts-first;
  const rows = standalone ? samples : samples.filter(s=>time(s)>=1 && time(s)<=5);
  if(rows.length<80 || (standalone ? time(rows.at(-1))-time(rows[0])<3.8 : time(rows[0])>1.15 || time(rows.at(-1))<4.85))
    return bad('Not enough opening data. Record at least six seconds while holding the bike still.');
  for(let i=0;i<rows.length;i++) {
    if(![...acc(rows[i]),...gyro(rows[i]),time(rows[i])].every(Number.isFinite)) return bad('Invalid opening sensor data.');
    if(i && (time(rows[i])<=time(rows[i-1]) || time(rows[i])-time(rows[i-1])>0.15))
      return bad('The opening samples have timing gaps. Start another recording.');
  }
  const aa=rows.map(acc), gg=rows.map(gyro), gravity=mean(aa), bias=mean(gg), g=norm(gravity);
  const deviations=(a,m)=>a.map(v=>norm(v.map((x,i)=>x-m[i])));
  const ad=deviations(aa,gravity), gd=deviations(gg,bias);
  const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
  diagnostics={samples:rows.length,gravityMg:g,accelRmsMg:rms(ad),accelPeakMg:Math.max(...ad),gyroRmsDps:rms(gd),gyroPeakDps:Math.max(...gd),gyroBiasDps:bias,gyroBiasMagnitudeDps:norm(bias)};
  const f=n=>n.toFixed(2);
  if(g<850 || g>1150) return bad(`Mean acceleration is ${f(g)} mg; expected 850–1150 mg. Save the calibration report so the sensor readings can be checked.`);
  const failures=[];
  if(diagnostics.accelRmsMg>20)failures.push(`acceleration variation ${f(diagnostics.accelRmsMg)} mg (limit 20)`);
  if(diagnostics.accelPeakMg>70)failures.push(`acceleration peak deviation ${f(diagnostics.accelPeakMg)} mg (limit 70)`);
  // Real stationary Artemis recordings show about 2.3–2.4 °/s RMS sample noise.
  // Motion is still guarded by acceleration variation and the separate mean-bias limit.
  if(diagnostics.gyroRmsDps>3.5)failures.push(`gyro variation ${f(diagnostics.gyroRmsDps)} °/s (limit 3.5)`);
  if(diagnostics.gyroPeakDps>8)failures.push(`gyro peak deviation ${f(diagnostics.gyroPeakDps)} °/s (limit 8)`);
  if(failures.length)return bad('Stillness check failed: '+failures.join('; ')+'. This can be motion or sensor noise. If the device was stationary, save the calibration report.');
  if(norm(bias)>3)return bad(`The gyro has a steady offset of ${f(norm(bias))} °/s (limit 3). This is not a motion-variation failure. Save the calibration report before changing the limits.`);
  const frame=frameForUp(gravity);
  if(!frame)
    return bad('The bike appears leaned over, or the mounting changed sideways. Hold it upright on level ground.');
  return {ok:true,version:standalone?2:1,windowSeconds:standalone?[time(rows[0]),time(rows.at(-1))]:[1,5],sampleCount:rows.length,...frame,bias,
    gravityMg:g,accelRmsMg:rms(ad),gyroRmsDps:rms(gd),diagnostics};
}
export function validCalibration(c){
  if(!c?.ok || ![1,2,3].includes(c.version))return false;
  const axes=[c.forward,c.left,c.up];
  if(![...axes,c.bias].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))return false;
  const validFrame=frame=>{const a=[frame?.forward,frame?.left,frame?.up];return a.every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)&&Math.abs(norm(v)-1)<1e-5)&&Math.abs(dot(a[0],a[1]))<1e-5&&Math.abs(dot(a[0],a[2]))<1e-5&&Math.abs(dot(a[1],a[2]))<1e-5&&dot(cross(a[0],a[1]),a[2])>.99999;};
  if(c.version===3&&(!c.levelReferenced||!Array.isArray(c.measuredUp)||c.measuredUp.length!==3||!c.measuredUp.every(Number.isFinite)||Math.abs(norm(c.measuredUp)-1)>=1e-5||dot(c.measuredUp,c.up)<.99999||!validFrame(c.levelFrame)))return false;
  return validFrame(c)&&norm(c.bias)<=3&&
    axes.every(v=>Math.abs(norm(v)-1)<1e-5);
}
export function hasLevelReference(c){return validCalibration(c)&&c.version===3&&c.levelReferenced===true;}
export function setLevelReference(c){
  if(!validCalibration(c))return null;
  const measuredUp=c.version===3?c.measuredUp:c.up;
  const levelFrame={forward:[...c.forward],left:[...c.left],up:[...c.up]};
  return {...structuredClone(c),version:3,levelReferenced:true,levelFrame,measuredUp:[...measuredUp]};
}
export function useLevelReference(c,reference){
  if(!validCalibration(c)||!hasLevelReference(reference))return null;
  const measuredUp=c.version===3?c.measuredUp:c.up,frame=frameForUp(measuredUp,reference.levelFrame.left);
  if(!frame)return null;
  const levelFrame={forward:[...reference.levelFrame.forward],left:[...reference.levelFrame.left],up:[...reference.levelFrame.up]};
  return {...structuredClone(c),version:3,levelReferenced:true,...frame,levelFrame,measuredUp:[...measuredUp]};
}
export function samplesFromCsv(csv){return csv.trim().split(/\r?\n/).slice(1).map(line=>{
  const p=line.split(',').map(Number);return {aX:p[2],aY:p[3],aZ:p[4],gX:p[5],gY:p[6],gZ:p[7],ts:p[13]/1000,elapsed_ms:p[13]};
});}
export const CALIBRATION_PREFIX='# BikeCoachCalibration=';
export function calibratedCsv(csv,c){return validCalibration(c)?CALIBRATION_PREFIX+JSON.stringify(c)+'\r\n'+csv:csv;}
export function csvCalibration(csv){const line=csv.split(/\r?\n/).find(x=>x.startsWith(CALIBRATION_PREFIX));if(!line)return null;try{const c=JSON.parse(line.slice(CALIBRATION_PREFIX.length));return validCalibration(c)?c:null;}catch{return null;}}
export function applyCalibration(s,c) {
  if(!c?.ok) return s;
  const a=acc(s), g=gyro(s).map((x,i)=>x-c.bias[i]), m=[s.mX,s.mY,s.mZ];
  for(const [axis,v] of [['Forward',c.forward],['Left',c.left],['Up',c.up]]) {
    s['a'+axis]=dot(a,v); s['m'+axis]=dot(m,v);
  }
  [s.rollRate,s.pitchRate,s.yawRate]=[c.forward,c.left,c.up].map(v=>dot(g,v));
  return s;
}
