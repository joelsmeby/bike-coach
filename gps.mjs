// Location stays on this phone and in files the rider explicitly exports.
export const GPS_SCHEMA=1, MAX_POINTS=100000, MAX_GAP_MS=5000, MAX_ACCURACY_M=30;
const finite=Number.isFinite;
export const newRideId=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>v.toString(16).padStart(2,'0')).join('');
export function normalizeFix(position,segment=0){
 const c=position?.coords,t=position?.timestamp;
 if(!c||!finite(t)||![c.latitude,c.longitude,c.accuracy].every(finite)||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||c.accuracy<0)return null;
 return {timestamp:t,latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,
  speed:finite(c.speed)&&c.speed>=0?c.speed:null,heading:finite(c.heading)&&c.heading>=0&&c.heading<360?c.heading:null,
  altitude:finite(c.altitude)?c.altitude:null,altitudeAccuracy:finite(c.altitudeAccuracy)&&c.altitudeAccuracy>=0?c.altitudeAccuracy:null,segment};
}
export function rideMetadata(csv){
 const line=String(csv).split(/\r?\n/).find(l=>l.startsWith('# BikeCoachRide='));
 if(!line)return null;
 try{const m=JSON.parse(line.slice(16));return /^[a-f0-9]{16}$/.test(m.id)&&Number.isInteger(m.startBoardMs)&&m.startBoardMs>=0&&m.startBoardMs<2**32?m:null;}catch{return null;}
}
export function validateGps(g){
 if(g?.schemaVersion!==GPS_SCHEMA||!/^([a-f0-9]{16})$/.test(g.id)||!Array.isArray(g.points)||g.points.length>MAX_POINTS||!finite(g.sync?.phoneEpochMs)||!Number.isInteger(g.sync?.boardMs)||g.sync.boardMs<0||g.sync.boardMs>=2**32||!finite(g.sync?.uncertaintyMs)||g.sync.uncertaintyMs<0||g.sync.uncertaintyMs>2000||!finite(g.startedEpochMs)||(g.endEpochMs!==null&&(!finite(g.endEpochMs)||g.endEpochMs<g.startedEpochMs))||!Array.isArray(g.events)||g.events.length>100000)return null;
 let last=-Infinity;
 const points=[];
 for(const p of g.points){const n=normalizeFix({timestamp:p.timestamp,coords:p},p.segment);if(!n||!Number.isInteger(p.segment)||p.segment<0||p.timestamp<=last)return null;last=p.timestamp;points.push(n);}
 return {...g,points,events:g.events.filter(e=>e&&typeof e.type==='string'&&finite(e.timestamp))};
}
export function bindGps(csv,input){
 const g=validateGps(input),m=rideMetadata(csv);if(!g||!m||m.id!==g.id)return null;
 const delta=(m.startBoardMs-g.sync.boardMs+2**32)%2**32;
 if(delta>60000)return null; // Sync must immediately precede this start, not a previous boot.
 return {...g,startEpochMs:g.sync.phoneEpochMs+delta};
}
export function gpsFromCsv(csv){
 const line=String(csv).split(/\r?\n/).find(l=>l.startsWith('# BikeCoachGPS='));
 try{return line?bindGps(csv,JSON.parse(line.slice(15))):null;}catch{return null;}
}
export function withGps(csv,gps){
 const clean=String(csv).split(/\r?\n/).filter(l=>!l.startsWith('# BikeCoachGPS=')).join('\n');
 const g=bindGps(clean,gps);return g?'# BikeCoachGPS='+JSON.stringify(g)+'\n'+clean:clean;
}
export function goodPoint(p){return p.accuracy<=MAX_ACCURACY_M;}
export function distanceMeters(a,b){
 const rad=Math.PI/180,dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad;
 const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;
 return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function connectedPoints(a,b){const dt=b.timestamp-a.timestamp;return goodPoint(a)&&goodPoint(b)&&a.segment===b.segment&&dt>0&&dt<=MAX_GAP_MS&&distanceMeters(a,b)/(dt/1000)<=40;}
export function gpsSummary(g){
 let distance=0,gaps=0,maxSpeed=null;
 const points=g.points.filter(p=>p.timestamp>=g.startEpochMs&&(!g.endEpochMs||p.timestamp<=g.endEpochMs));
 for(let i=0;i<points.length;i++){const p=points[i];if(goodPoint(p)&&p.speed!==null&&p.speed<=40)maxSpeed=Math.max(maxSpeed??0,p.speed);if(i){if(connectedPoints(points[i-1],p))distance+=distanceMeters(points[i-1],p);else gaps++;}}
 return {points,distance,gaps,maxSpeed,usable:points.filter(goodPoint).length};
}
export function positionAt(g,seconds){
 if(!g||g.sync.uncertaintyMs>1000)return null;
 const t=g.startEpochMs+seconds*1000,points=g.points;
 if(t<g.startEpochMs||(g.endEpochMs&&t>g.endEpochMs))return null;
 const i=points.findIndex(p=>p.timestamp>=t);if(i<0)return null;
 const b=points[i];if(b.timestamp===t&&goodPoint(b))return {...b};if(i===0)return null;
 const a=points[i-1];if(!connectedPoints(a,b))return null;
 const f=(t-a.timestamp)/(b.timestamp-a.timestamp),lonDelta=((b.longitude-a.longitude+540)%360)-180;
 return {latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:((a.longitude+lonDelta*f+540)%360)-180,accuracy:Math.max(a.accuracy,b.accuracy),timestamp:t};
}
export function approachSpeed(g,seconds){
 const t=g.startEpochMs+seconds*1000;
 const p=g.points.filter(p=>p.timestamp>=Math.max(g.startEpochMs,t-3000)&&p.timestamp<=t&&goodPoint(p)&&p.speed!==null&&p.speed<=40);
 if(!p.length||t-p.at(-1).timestamp>2000||p[0].segment!==p.at(-1).segment)return null;
 return p.reduce((sum,x)=>sum+x.speed,0)/p.length;
}
