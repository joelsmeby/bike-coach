export const WORLD=40075016.68557849;
export function project(latitude,longitude){
 const lat=Math.max(-85.05112878,Math.min(85.05112878,latitude))*Math.PI/180;
 return [(longitude+180)/360*WORLD,(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2*WORLD];
}
export function visibleTiles(view,origin,pixels=600){
 const z=Math.max(0,Math.min(19,Math.floor(Math.log2(WORLD*Math.max(1,pixels)/(256*view[2]))))),n=2**z,size=WORLD/n;
 const left=view[0]+origin[0],top=view[1]+origin[1],tiles=[];
 for(let y=Math.max(0,Math.floor(top/size));y<=Math.min(n-1,Math.floor((top+view[3])/size));y++){
  for(let x=Math.floor(left/size);x<=Math.floor((left+view[2])/size);x++){
   tiles.push({key:`${z}/${((x%n)+n)%n}/${y}`,x:x*size-origin[0],y:y*size-origin[1],size});
  }
 }
 return tiles;
}
