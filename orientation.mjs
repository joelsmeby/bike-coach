import {validCalibration,hasLevelReference,MOUNT_LEFT} from './calibration.mjs?v=5';
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const unit=a=>a.map(x=>x/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const left=unit(MOUNT_LEFT),hint=[-.028,-.619,-.785];
const up=unit(hint.map((x,i)=>x-dot(hint,left)*left[i]));
const original={forward:unit(cross(left,up)),left,up};
// A stationary gravity vector contains no heading/yaw information.
export function orientationAngles(calibration){
 if(!validCalibration(calibration))return null;
 const referenced=hasLevelReference(calibration),basis=referenced?calibration.levelFrame:original;
 const measuredUp=referenced?calibration.measuredUp:calibration.up;
 const [f,l,u]=[basis.forward,basis.left,basis.up].map(axis=>dot(measuredUp,axis));
 const pitch=Math.atan2(f,Math.hypot(l,u))*180/Math.PI;
 const roll=Math.hypot(l,u)<1e-6?null:Math.atan2(l,u)*180/Math.PI;
 return {pitch,roll,yaw:null,referenced};
}
export function angleLabel(angle){return angle===null?'Not measured':`${Math.abs(angle)<.05?'0.0':angle.toFixed(1)}°`;}
