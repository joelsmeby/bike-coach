// Exercise actual chart labels and rendered line colors while zooming/panning.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=process.env.BIKECOACH_WEB_ROOT||dirname(fileURLToPath(import.meta.url));
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,bytes=await readFile(join(root,path==='/'?'analyzer.html':path));res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css'})[extname(path)]||'text/plain');res.end(bytes);}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BIKECOACH_CHROMIUM||undefined});
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.chartFrames={};const proto=CanvasRenderingContext2D.prototype;
  const clear=proto.clearRect,fill=proto.fillText,stroke=proto.stroke;
  proto.clearRect=function(...args){window.chartFrames[this.canvas.id]={labels:[],colors:[]};return clear.apply(this,args);};
  proto.fillText=function(text,...args){window.chartFrames[this.canvas.id]?.labels.push(String(text));return fill.call(this,text,...args);};
  proto.stroke=function(...args){window.chartFrames[this.canvas.id]?.colors.push(this.strokeStyle);return stroke.apply(this,args);};
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/analyzer.html`);
 await page.evaluate(async()=>{
  const {calibrate,setLevelReference}=await import('./calibration.mjs?v=9');
  const calibration=setLevelReference(calibrate(Array.from({length:301},(_,i)=>({ts:i*.02,aX:0,aY:0,aZ:-1000,gX:0,gY:0,gZ:0})),true));
  const rows=Array.from({length:3001},(_,i)=>{
   const time=`00:${String(Math.floor(i/50/60)).padStart(2,'0')}:${(i/50%60).toFixed(2).padStart(5,'0')}`;
   return `01/01/2000,${time},${Math.sin(i)*100},${Math.cos(i)*200},-1000,1,2,3,4,5,6,20,50,`;
  });
  window.chartCsv='# BikeCoachCalibration='+JSON.stringify(calibration)+'\nrtcDate,rtcTime,aX,aY,aZ,gX,gY,gZ,mX,mY,mZ,imu_degC,output_Hz,\n'+rows.join('\n');
  window.bikeCoachNativeLoadLog({text:window.chartCsv,name:'chart-test.csv'});
 });
 await page.waitForFunction(()=>document.querySelector('#sampleCount').textContent==='3,001');
 const ticks=()=>page.evaluate(()=>window.chartFrames.accChart.labels.filter(s=>/^\d+(\.\d+)?s$/.test(s)).map(parseFloat));
 assert.deepEqual(await ticks(),[0,15,30,45,60]);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await page.waitForFunction(()=>parseFloat(document.querySelector('#windowLabel').textContent)<31);
 const zoomed=await ticks();assert(zoomed[0]>14&&zoomed.at(-1)<46);
 const rect=await page.locator('#accChart').boundingBox(),x=rect.x+rect.width*.6,y=rect.y+rect.height*.5;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-rect.width*.2,y,{steps:10});await page.mouse.up();
 await page.waitForFunction(start=>parseFloat(window.chartFrames.accChart.labels.find(s=>/^\d+(\.\d+)?s$/.test(s)))>start+4,zoomed[0]);
 const panned=await ticks();assert(panned[0]>zoomed[0]);assert(panned.at(-1)>zoomed.at(-1));
 await page.mouse.move(x,y);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');
 await page.waitForFunction(span=>parseFloat(document.querySelector('#windowLabel').textContent)<span-1,panned.at(-1)-panned[0]);
 assert.equal(await page.locator('.line-toggle input:checked').count(),10);
 const roll=page.locator('#gyroLegend').getByRole('checkbox',{name:'Roll',exact:true});await roll.uncheck();
 await page.waitForFunction(()=>!window.chartFrames.gyroChart.colors.includes('#60a5fa'));
 assert((await page.evaluate(()=>window.chartFrames.gyroChart.colors)).includes('#f59e0b'));
 await page.selectOption('#coordFrame','raw');await page.locator('#gyroLegend').getByRole('checkbox',{name:'gX',exact:true}).waitFor();
 assert.equal(await page.locator('#gyroLegend').getByRole('checkbox',{name:'gX',exact:true}).isChecked(),false);
 await page.locator('#gyroLegend').getByRole('checkbox',{name:'gX',exact:true}).check();
 await page.waitForFunction(()=>window.chartFrames.gyroChart.colors.includes('#60a5fa'));
 for(const checkbox of await page.locator('#accLegend input').all())await checkbox.uncheck();
 await page.waitForFunction(()=>window.chartFrames.accChart.labels.includes('All lines hidden'));
 assert(!await page.evaluate(()=>window.chartFrames.accChart.colors.some(c=>['#60a5fa','#f59e0b','#34d399'].includes(c))));
 await page.locator('#angleLegend input').uncheck();await page.waitForFunction(()=>!window.chartFrames.angleChart.colors.includes('#60a5fa'));
 const timeLabels=await page.evaluate(()=>Object.values(window.chartFrames).map(f=>f.labels.filter(s=>/^\d+(\.\d+)?s$/.test(s))));
 assert(timeLabels.every(labels=>JSON.stringify(labels)===JSON.stringify(timeLabels[0])));
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
 assert.equal(await page.locator('.line-toggle input').count(),10);
 assert.deepEqual(errors,[]);
 console.log('PASS: elapsed-time axis after button zoom, pan and Ctrl-wheel; synchronized charts; 10 line toggles; stable colors; all-hidden state; coordinate-frame changes; mobile layout.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
