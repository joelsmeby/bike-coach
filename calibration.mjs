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
export function calibrate(samples) {
  const bad = reason => ({ok:false, reason});
  if(!samples.length) return bad('No samples to calibrate.');
  // Use file-relative time, not the phone's clock. Discard the first second of handling.
  const first = samples[0].ts;
  const time = s => Number.isFinite(s.elapsed_ms)?s.elapsed_ms/1000:s.ts-first;
  const rows = samples.filter(s=>time(s)>=1 && time(s)<=5);
  if(rows.length<80 || time(rows[0])>1.15 || time(rows.at(-1))<4.85)
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
  if(g<850 || g>1150) return bad('Opening acceleration is not close to gravity. Hold the bike still and try again.');
  if(rms(ad)>20 || Math.max(...ad)>70 || rms(gd)>0.8 || Math.max(...gd)>3 || norm(bias)>3)
    return bad('The bike moved during calibration. Start again and hold it still through the countdown.');
  const up=unit(gravity), leftHint=unit(MOUNT_LEFT), sideways=dot(up,leftHint);
  if(Math.abs(sideways)>Math.sin(10*Math.PI/180))
    return bad('The bike appears leaned over, or the mounting changed sideways. Hold it upright on level ground.');
  const left=unit(leftHint.map((x,i)=>x-sideways*up[i]));
  const forward=unit(cross(left,up));
  return {ok:true,version:1,windowSeconds:[1,5],sampleCount:rows.length,forward,left,up,bias,
    gravityMg:g,accelRmsMg:rms(ad),gyroRmsDps:rms(gd)};
}
export function applyCalibration(s,c) {
  if(!c?.ok) return s;
  const a=acc(s), g=gyro(s).map((x,i)=>x-c.bias[i]), m=[s.mX,s.mY,s.mZ];
  for(const [axis,v] of [['Forward',c.forward],['Left',c.left],['Up',c.up]]) {
    s['a'+axis]=dot(a,v); s['m'+axis]=dot(m,v);
  }
  [s.rollRate,s.pitchRate,s.yawRate]=[c.forward,c.left,c.up].map(v=>dot(g,v));
  return s;
}
