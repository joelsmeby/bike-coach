import {project,WORLD,visibleTiles} from './gps-map.mjs?v=1';
import {gpsSummary,positionAt,approachSpeed,goodPoint,connectedPoints} from './gps.mjs?v=1';
export function renderGpsRoute(container,gps,jumps=[],firstSampleMs=0,onJump=()=>{}){
 container.replaceChildren();
 const add=(tag,text,parent=container)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent.append(e);return e;};
 if(!gps){add('p','No phone GPS attached. Record a new ride with phone GPS enabled, or import its matching GPS file.').className='footer';return;}
 const details=add('details');add('summary','GPS quality & timing',details);
 const s=gpsSummary(gps),summary=add('p',`${s.usable} usable GPS fixes · approximate recorded distance ${(s.distance/1000).toFixed(2)} km · peak reported speed ${s.maxSpeed===null?'unavailable':(s.maxSpeed*3.6).toFixed(1)+' km/h'} · ${s.gaps} breaks or rejected intervals`);
 summary.className='footer';
 add('p',`Ride start: ${new Date(gps.startEpochMs).toLocaleString()}. Initial timing uncertainty about ±${Math.ceil(gps.sync.uncertaintyMs)} ms; board-clock drift can add error over long rides. Gaps and fixes worse than ±30 m are excluded from the route. Distance excludes gaps and may be biased by GPS noise.`).className='footer';
 if(gps.events?.some(e=>e.type==='hidden'))add('p','Bluefy was hidden during this recording. The route may be incomplete.').className='footer';
 if(!gps.endEpochMs)add('p','GPS capture has no saved stop confirmation. Showing the fixes last saved on the phone.').className='footer';
 for(const el of [...container.children])if(el!==details)details.append(el);
 const usable=s.points.filter(goodPoint);
 if(!usable.length){add('p','No usable location fixes. Check location permission, sky visibility, and that Bluefy stayed open.');return;}
 const origin=project(usable[0].latitude,usable[0].longitude);
 const xy=p=>{const v=project(p.latitude,p.longitude);return [((v[0]-origin[0]+WORLD*1.5)%WORLD)-WORLD/2,v[1]-origin[1]];};
 let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
 for(const p of usable){const [x,y]=xy(p);xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
 const span=Math.max(100,xmax-xmin,(ymax-ymin)*1.6)*1.15,base=[(xmin+xmax)/2-span/2,(ymin+ymax)/2-span/3.2,span,span/1.6];
 let view=[...base];
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('role','group');svg.setAttribute('aria-label','North-up GPS route with numbered jump candidates');svg.style.cssText='width:100%;height:320px;background:#11141a;border-radius:8px;touch-action:none';container.append(svg);
 const node=(tag,attrs)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);return el;};
 const tiles=document.createElementNS(ns,'g');svg.append(tiles);
 const credit=add('div');credit.style.cssText='font-size:12px;text-align:right;padding:5px;background:#f1f5f9;color:#17202a';
 const copyright=add('a','© OpenStreetMap contributors',credit);copyright.href='https://www.openstreetmap.org/copyright';copyright.target='_blank';copyright.rel='noopener';copyright.style.color='#174b76';
 const mapStatus=add('p','Loading background map…');mapStatus.className='footer';mapStatus.setAttribute('role','status');
 let generation=0;
 function drawTiles(){
  const current=++generation,wanted=visibleTiles(view,origin,svg.clientWidth||600),keep=new Set();
  for(const tile of wanted){
   const id=tile.key+'@'+tile.x;keep.add(id);let img=[...tiles.children].find(e=>e.dataset.key===id);
   if(!img){img=document.createElementNS(ns,'image');img.dataset.key=id;img.setAttribute('x',tile.x);img.setAttribute('y',tile.y);img.setAttribute('width',tile.size);img.setAttribute('height',tile.size);img.setAttribute('preserveAspectRatio','none');img.setAttribute('href','https://tile.openstreetmap.org/'+tile.key+'.png');img.onload=()=>{img.dataset.loaded='true';updateMapStatus();};img.onerror=()=>{img.dataset.failed='true';updateMapStatus();};tiles.append(img);}
  }
  for(const img of [...tiles.children])if(!keep.has(img.dataset.key))img.remove();
  updateMapStatus();
  setTimeout(()=>{if(current===generation&&tiles.querySelector('image:not([data-loaded]):not([data-failed])'))mapStatus.textContent='Map is slow to load. Your route remains available.';},8000);
 }
 function updateMapStatus(){const images=[...tiles.children];mapStatus.textContent=images.some(e=>e.dataset.failed)?'Some background tiles are unavailable. Your route is still shown.':images.length&&images.every(e=>e.dataset.loaded)?'Drag to pan · use + / − to zoom.':'Loading background map…';}
 let d='';
 // Break at rejected fixes, explicit visibility interruptions, and missing samples.
 for(let i=0;i<s.points.length;i++){const p=s.points[i];if(!goodPoint(p))continue;const [x,y]=xy(p);d+=(i&&connectedPoints(s.points[i-1],p)?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';}
 node('path',{d,fill:'none',stroke:'#60a5fa','stroke-width':3,'vector-effect':'non-scaling-stroke'});
 for(const [p,color] of [[usable[0],'#4ade80'],[usable.at(-1),'#fbbf24']]){const [cx,cy]=xy(p);node('circle',{cx,cy,r:span*.006,fill:color});}
 const marks=[];
 const controls=add('div');controls.className='smallrow';
 function redraw(){svg.setAttribute('viewBox',view.join(' '));drawTiles();for(const m of marks){m.circle.setAttribute('r',view[2]*.03);m.text.setAttribute('font-size',view[2]*.035);}}
 for(const [label,factor] of [['Zoom in',.5],['Zoom out',2],['Fit route',0]]){const b=add('button',label,controls);b.onclick=()=>{if(!factor)view=[...base];else{const w=Math.max(20,Math.min(base[2]*4,view[2]*factor)),h=w/1.6;view=[view[0]+view[2]/2-w/2,view[1]+view[3]/2-h/2,w,h];}redraw();};}
 for(const [label,dx,dy] of [['←',-.25,0],['→',.25,0],['↑',0,-.25],['↓',0,.25]]){const b=add('button',label,details);b.setAttribute('aria-label','Pan route '+label);b.onclick=()=>{view[0]+=view[2]*dx;view[1]+=view[3]*dy;redraw();};}
 add('p','Green: start · yellow: finish · pink numbers: jump candidates.').className='footer';
 add('p','Background maps need internet. OpenStreetMap receives requests for the area shown; your sensor recording is not uploaded. Trail coverage varies.',details).className='footer';
 let drag=null,moved=false;
 svg.addEventListener('pointerdown',e=>{if(e.target.closest('[role=button]'))return;drag={x:e.clientX,y:e.clientY,view:[...view],id:e.pointerId};moved=false;svg.setPointerCapture(e.pointerId);});
 svg.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const rect=svg.getBoundingClientRect(),dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;view=[drag.view[0]-dx/rect.width*drag.view[2],drag.view[1]-dy/rect.height*drag.view[3],drag.view[2],drag.view[3]];svg.setAttribute('viewBox',view.join(' '));});
 const end=e=>{if(!drag||e.pointerId!==drag.id)return;drag=null;if(moved)redraw();};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
 container.append(details);
 const list=add('div',undefined,details);list.style.overflow='auto';const table=add('table',undefined,list),head=add('thead',undefined,table),tr=add('tr',undefined,head);
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

