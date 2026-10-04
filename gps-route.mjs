import {gpsSummary,positionAt,approachSpeed,goodPoint,connectedPoints} from './gps.mjs?v=1';
export function renderGpsRoute(container,gps,jumps=[],firstSampleMs=0,onJump=()=>{}){
 container.replaceChildren();
 const add=(tag,text,parent=container)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent.append(e);return e;};
 if(!gps){add('p','No phone GPS attached. Record a new ride with phone GPS enabled, or import its matching GPS file.').className='footer';return;}
 const s=gpsSummary(gps),summary=add('p',`${s.usable} usable GPS fixes · approximate recorded distance ${(s.distance/1000).toFixed(2)} km · peak reported speed ${s.maxSpeed===null?'unavailable':(s.maxSpeed*3.6).toFixed(1)+' km/h'} · ${s.gaps} breaks or rejected intervals`);
 summary.className='footer';
 add('p',`Ride start: ${new Date(gps.startEpochMs).toLocaleString()}. Initial timing uncertainty about ±${Math.ceil(gps.sync.uncertaintyMs)} ms; board-clock drift can add error over long rides. Gaps and fixes worse than ±30 m are excluded from the route. Distance excludes gaps and may be biased by GPS noise.`).className='footer';
 if(gps.events?.some(e=>e.type==='hidden'))add('p','Bluefy was hidden during this recording. The route may be incomplete.').className='footer';
 if(!gps.endEpochMs)add('p','GPS capture has no saved stop confirmation. Showing the fixes last saved on the phone.').className='footer';
 const usable=s.points.filter(goodPoint);
 if(!usable.length){add('p','No usable location fixes. Check location permission, sky visibility, and that Bluefy stayed open.');return;}
 const lat0=usable[0].latitude,lon0=usable[0].longitude,cos=Math.max(.00001,Math.cos(lat0*Math.PI/180));
 const xy=p=>[(((p.longitude-lon0+540)%360)-180)*111195*cos,-(p.latitude-lat0)*111195];
 let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
 for(const p of usable){const [x,y]=xy(p);xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
 const span=Math.max(100,xmax-xmin,(ymax-ymin)*1.6)*1.15,base=[(xmin+xmax)/2-span/2,(ymin+ymax)/2-span/3.2,span,span/1.6];
 let view=[...base];
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('role','img');svg.setAttribute('aria-label','North-up GPS route with numbered jump candidates');svg.style.cssText='width:100%;height:320px;background:#11141a;border-radius:8px;touch-action:pan-y';container.append(svg);
 const node=(tag,attrs)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);return el;};
 let d='';
 // Break at rejected fixes, explicit visibility interruptions, and missing samples.
 for(let i=0;i<s.points.length;i++){const p=s.points[i];if(!goodPoint(p))continue;const [x,y]=xy(p);d+=(i&&connectedPoints(s.points[i-1],p)?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';}
 node('path',{d,fill:'none',stroke:'#60a5fa','stroke-width':3,'vector-effect':'non-scaling-stroke'});
 for(const [p,color] of [[usable[0],'#4ade80'],[usable.at(-1),'#fbbf24']]){const [cx,cy]=xy(p);node('circle',{cx,cy,r:span*.006,fill:color});}
 const marks=[];
 const controls=add('div');controls.className='smallrow';
 function redraw(){svg.setAttribute('viewBox',view.join(' '));for(const m of marks){m.circle.setAttribute('r',view[2]*.03);m.text.setAttribute('font-size',view[2]*.035);}}
 for(const [label,factor] of [['Zoom in',.5],['Zoom out',2],['Fit route',0]]){const b=add('button',label,controls);b.onclick=()=>{if(!factor)view=[...base];else{const w=Math.max(20,Math.min(base[2]*4,view[2]*factor)),h=w/1.6;view=[view[0]+view[2]/2-w/2,view[1]+view[3]/2-h/2,w,h];}redraw();};}
 for(const [label,dx,dy] of [['←',-.25,0],['→',.25,0],['↑',0,-.25],['↓',0,.25]]){const b=add('button',label,controls);b.setAttribute('aria-label','Pan route '+label);b.onclick=()=>{view[0]+=view[2]*dx;view[1]+=view[3]*dy;redraw();};}
 add('p','North is up · green: first GPS fix · yellow: last GPS fix · numbered circles: jump candidates. Route-only map; no street tiles or location uploads.').className='footer';
 const list=add('div');list.style.overflow='auto';const table=add('table',undefined,list),head=add('thead',undefined,table),tr=add('tr',undefined,head);
 for(const label of ['Jump','Ride time','GPS location','Approach speed'])add('th',label,tr);
 const body=add('tbody',undefined,table);
 jumps.forEach((jump,index)=>{
  const seconds=firstSampleMs/1000+jump.start,p=positionAt(gps,seconds),row=add('tr',undefined,body),cell=add('td',undefined,row),button=add('button',String(index+1),cell);button.onclick=()=>onJump(jump);
  add('td',seconds.toFixed(2)+' s',row);add('td',p?`±${Math.round(p.accuracy)} m (interpolated)`:'Unavailable / gap',row);
  const speed=p?approachSpeed(gps,seconds):null;add('td',speed===null?'—':(speed*3.6).toFixed(1)+' km/h',row);
  if(!p)return;
  const [cx,cy]=xy(p),circle=node('circle',{cx,cy,r:span*.012,fill:'#f472b6',tabindex:'0',role:'button','aria-label':'Inspect jump '+(index+1)});
  const text=node('text',{x:cx,y:cy,'text-anchor':'middle','dominant-baseline':'central',fill:'#0f1115','font-size':span*.013,'pointer-events':'none'});text.textContent=String(index+1);
  circle.style.cssText='cursor:pointer;outline:none';circle.setAttribute('vector-effect','non-scaling-stroke');circle.onfocus=()=>{circle.setAttribute('stroke','#fff');circle.setAttribute('stroke-width','2');};circle.onblur=()=>circle.removeAttribute('stroke');circle.onclick=()=>onJump(jump);circle.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onJump(jump);}};marks.push({circle,text});
 });
 if(!jumps.length)add('p','No jump candidates in this ride.').className='footer';redraw();
}
