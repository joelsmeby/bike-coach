import {validCalibration,usesDeviceAxes,DEVICE_FORWARD,DEVICE_LEFT,DEVICE_UP} from './calibration.mjs?v=9';
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
// A stationary gravity vector contains no heading/yaw information.
export function orientationAngles(calibration){
 if(!validCalibration(calibration)||!usesDeviceAxes(calibration))return null;
 const measuredUp=calibration.measuredUp||calibration.up;
 const [f,l,u]=[DEVICE_FORWARD,DEVICE_LEFT,DEVICE_UP].map(axis=>dot(measuredUp,axis));
 const pitch=Math.atan2(f,Math.hypot(l,u))*180/Math.PI;
 const roll=Math.hypot(l,u)<1e-6?null:Math.atan2(l,u)*180/Math.PI;
 return {pitch,roll,yaw:null,referenced:true};
}
export function angleLabel(angle){return angle===null?'Not measured':`${Math.abs(angle)<.05?'0.0':angle.toFixed(1)}°`;}
