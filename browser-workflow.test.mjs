// Integration test: real browser/IndexedDB, simulated Artemis with 20-byte BLE.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/package.json':import.meta.url);
const {chromium}=require('playwright');
const root=dirname(fileURLToPath(import.meta.url));
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const bytes=await readFile(join(root,path==='/'?'index.html':path));res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css'})[extname(path)]||'text/html');res.end(bytes);}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BIKECOACH_CHROMIUM||undefined});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(()=>{
  Object.defineProperty(navigator,'share',{value:undefined,configurable:true});
  let gpsTimer;
  Object.defineProperty(navigator,'geolocation',{value:{watchPosition(success){const fix=()=>success({timestamp:Date.now(),coords:{latitude:47,longitude:-122,accuracy:5,speed:3}});gpsTimer=setInterval(fix,100);return 9;},clearWatch(){clearInterval(gpsTimer);}},configurable:true});

  const encode=s=>new TextEncoder().encode(s),view=s=>new DataView(encode(s).buffer);
  class Characteristic extends EventTarget{
   constructor(raw=''){super();this.raw=raw;this.value=view(raw);this.properties={writeWithoutResponse:true};}
   async startNotifications(){}
   async readValue(){this.value=view(this.raw);this.dispatchEvent(new Event('characteristicvaluechanged'));return this.value;}
   notify(raw){this.raw=raw;this.value=view(raw.slice(0,20));this.dispatchEvent(new Event('characteristicvaluechanged'));}
  }
  const status=new Characteristic(),data=new Characteristic(),power=new Characteristic('POWER,3820'),command=new Characteristic();
  const rows=Array.from({length:100},(_,i)=>`01/01/2000,00:00:${(i/50).toFixed(2).padStart(5,'0')},0,0,1000,0,0,0,0,0,0,20,50,`);
  const csv='rtcDate,rtcTime,aX,aY,aZ,gX,gY,gZ,mX,mY,mZ,imu_degC,output_Hz,\n'+rows.join('\n');
  const files=new Map([['dataLog00042.TXT',encode(csv)],['OtherTrail_Run1.TXT',encode(csv)]]);
  let staged='',transfer=null,rideStarted=0,lastRide='';
  window.fakeBoard={files,commands:[],packetSizes:[],stagedWrites:[]};
  command.writeValueWithoutResponse=async bytes=>{
   const raw=new TextDecoder().decode(bytes);window.fakeBoard.stagedWrites.push(bytes.length);
   if(bytes.length>20)throw Error('Command exceeded 20-byte link');
   let cmd=raw;
   if(raw==='CMD_CLEAR'){staged='';queueMicrotask(()=>status.notify('CMD_READY'));return;}
   if(raw.startsWith('CMD_ADD,')){staged+=raw.slice(8);queueMicrotask(()=>status.notify('CMD_READY'));return;}
   if(raw==='CMD_RUN'){cmd=staged;staged='';}
   window.fakeBoard.commands.push(cmd);
   let reply;
   if(cmd==='INFO')reply='BIKECOACH,FW=0.2.8,STATE=IDLE,FILE=';
   else if(cmd==='START_RIDE'){rideStarted=Date.now();lastRide='GPS_Ride.TXT';reply='LOGGING,'+lastRide;}
   else if(cmd==='STOP_RIDE'){
    if(!rideStarted)reply='IDLE';
    else{const count=Math.max(2,Math.floor((Date.now()-rideStarted)/20));const rideRows=Array.from({length:count},(_,i)=>`01/01/2000,00:00:${(i/50).toFixed(2).padStart(5,'0')},0,0,1000,0,0,0,0,0,0,20,50,`);files.set(lastRide,encode(csv.split('\n')[0]+'\n'+rideRows.join('\n')));rideStarted=0;reply='SAVED,'+lastRide;}
   }
   else if(cmd.startsWith('GET_LATEST')){transfer={name:lastRide,bytes:files.get(lastRide),offset:0,count:0,limit:Number(cmd.split(',')[1])};reply=`FILE_BEGIN,${lastRide},${transfer.bytes.length}`;}
   else if(cmd.startsWith('LIST_FILES,')){const i=Number(cmd.split(',')[1]),entries=[...files];reply=i===entries.length?`FILES_END,${i}`:`FILE,${i},${entries.length},${entries[i][0]},${entries[i][1].length}`;}
   else if(cmd.startsWith('RENAME_FILE,')){const [,oldName,newName]=cmd.split(',');if([...files.keys()].some(n=>n.toLowerCase()===newName.toLowerCase()))reply='ERR,NAME_EXISTS';else{files.set(newName,files.get(oldName));files.delete(oldName);reply=`RENAMED,${oldName},${newName}`;}}
   else if(cmd.startsWith('GET_FILE,')){const [,name,limit]=cmd.split(',');transfer={name,bytes:files.get(name),offset:0,count:0,limit:Number(limit)};reply=`FILE_BEGIN,${name},${transfer.bytes.length}`;}
   else if(cmd==='FILE_READY'){
    const owner=transfer;
    const timer=setInterval(()=>{if(owner!==transfer){clearInterval(timer);return;}
     if(owner.offset===owner.bytes.length){clearInterval(timer);status.notify(`FILE_END,${owner.name},${owner.bytes.length},CHUNKS=${owner.count}`);return;}
     const chunk=owner.bytes.slice(owner.offset,owner.offset+owner.limit-6),packet=new Uint8Array(chunk.length+6),v=new DataView(packet.buffer);
     v.setUint16(0,owner.count%65536,true);v.setUint32(2,owner.offset,true);packet.set(chunk,6);owner.offset+=chunk.length;owner.count++;
     window.fakeBoard.packetSizes.push(packet.length);data.value=v;data.dispatchEvent(new Event('characteristicvaluechanged'));
    },1);return;
   }else if(cmd==='CANCEL_TRANSFER'){transfer=null;reply='TRANSFER_CANCELLED';}
   else throw Error('Unexpected command '+cmd);
   queueMicrotask(()=>status.notify(reply));
  };
  const chars={'1001':command,'1002':status,'1003':data,'1004':power};
  const device=new EventTarget();device.id='fake-bike';device.gatt={connected:false,async connect(){this.connected=true;return{getPrimaryService:async()=>({getCharacteristic:async uuid=>chars[uuid.slice(4,8)]})};},disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
  Object.defineProperty(navigator,'bluetooth',{value:{requestDevice:async()=>device},configurable:true});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(async()=>{
  const {calibrate,setLevelReference}=await import('./calibration.mjs?v=9'),{createProfile}=await import('./profiles.mjs?v=2'),{recordStore}=await import('./storage.js?v=3');
  const rows=Array.from({length:301},(_,i)=>({ts:i*.02,aX:0,aY:0,aZ:-1000,gX:0,gY:0,gZ:0}));
  const calibration=setLevelReference(calibrate(rows,true));
  await recordStore('bike-profiles:fake-bike',[createProfile({id:'test-bike',name:'Test bike',calibration,mountPitch:0,mountRoll:0})]);
 });
 await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#firmwareStatus').textContent.includes('0.2.8'));
 assert.match(await page.textContent('#recordingStatus'),/OFF/);
 await page.click('#listFiles');await page.waitForFunction(()=>document.querySelector('#fileListStatus').textContent==='2 recordings on the SD card.');
 const long='Family_Man_Run_1_20261017_Long_Trail_Name';
 await page.locator('[data-rename="dataLog00042.TXT"]').click();await page.fill('#trailName',long);await page.click('#confirmRename');
 await page.waitForFunction(()=>!document.querySelector('#renameDialog').open);
 assert.equal(await page.evaluate(name=>window.fakeBoard.files.has(name),long+'.TXT'),true);
 await page.fill('#fileSearch','Family');assert.equal(await page.locator('#fileList .file-row').count(),1);
 await page.locator(`[data-rename="${long}.TXT"]`).click();await page.fill('#trailName','OtherTrail_Run1');await page.click('#confirmRename');
 assert.match(await page.textContent('#renameError'),/already exists/);await page.click('#cancelRename');
 await page.check('#small');await page.locator(`[data-filename="${long}.TXT"]`).click();
 await page.waitForFunction(()=>!document.querySelector('#result').hidden&&document.querySelector('#summary').textContent.includes('100 samples'),{timeout:15000});
 await page.waitForFunction(()=>!document.querySelector('#renameRide').disabled);
 assert.equal(await page.evaluate(()=>Math.max(...window.fakeBoard.packetSizes)),20);
 const originalBytes=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('bikecoach-rides',1);r.onsuccess=()=>resolve(r.result)});return new Promise(resolve=>{const r=db.transaction('rides').objectStore('rides').get('latest');r.onsuccess=()=>resolve([...r.result.bytes])});});
 await page.click('#renameRide');await page.fill('#trailName','Family Man Afternoon Run 2');await page.click('#confirmRename');await page.waitForFunction(()=>!document.querySelector('#renameDialog').open);
 const saved=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('bikecoach-rides',1);r.onsuccess=()=>resolve(r.result)});return new Promise(resolve=>{const r=db.transaction('rides').objectStore('rides').get('latest');r.onsuccess=()=>resolve(r.result)});});
 assert.equal(saved.name,'Family_Man_Afternoon_Run_2.TXT');assert.equal(saved.sourceName,long+'.TXT');assert(saved.recordingId);assert.deepEqual(Object.values(saved.bytes),originalBytes);
 assert.equal(await page.evaluate(name=>window.fakeBoard.files.has(name),long+'.TXT'),true);
 const downloadPromise=page.waitForEvent('download');await page.click('#saveCsv');const download=await downloadPromise;assert.equal(download.suggestedFilename(),'Family_Man_Afternoon_Run_2.csv');
 const analyzer=await page.context().newPage();analyzer.on('pageerror',error=>errors.push(error.message));
 await analyzer.goto(`http://127.0.0.1:${server.address().port}/analyzer.html?v=16&latest=1`);
 await analyzer.waitForFunction(()=>document.querySelector('#status').textContent.includes('100 samples'));
 assert((await analyzer.textContent('#sourceLabel')).includes('Family_Man_Afternoon_Run_2.TXT'));
 await analyzer.close();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.BIKECOACH_SCREENSHOT)await page.screenshot({path:process.env.BIKECOACH_SCREENSHOT,fullPage:true});

 // A full new ride automatically records location on legacy v0.2.8 firmware.
 await page.click('#start');await page.waitForFunction(()=>document.querySelector('#recordingStatus').textContent.includes('ON'));
 await page.waitForFunction(()=>document.querySelector('#gpsStatus').textContent.includes('fixes'));
 await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#recordingStatus').textContent.includes('OFF'));
 page.once('dialog',dialog=>dialog.accept());await page.click('#download');
 await page.waitForFunction(()=>document.querySelector('#gpsStatus').textContent.includes('GPS attached:'));
 await page.waitForFunction(()=>!document.querySelector('#saveGps').disabled);
 const gpsRide=await page.evaluate(async()=>{const {rideStore}=await import('./storage.js?v=3');return rideStore();});
 assert(gpsRide.gps.points.length>0);assert.match(gpsRide.csv,/# BikeCoachGPS=/);assert.match(gpsRide.csv,/# BikeCoachRide=/);
 assert.equal(gpsRide.gps.timingMethod,'phone-command');assert(!new TextDecoder().decode(new Uint8Array(Object.values(gpsRide.bytes))).includes('BikeCoachGPS'));
 const gpsDownloadPromise=page.waitForEvent('download');await page.click('#saveCsv');const gpsDownload=await gpsDownloadPromise;
 const exported=await readFile(await gpsDownload.path(),'utf8');assert.match(exported,/# BikeCoachGPS=/);assert.match(exported,/"latitude":47/);
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#result').hidden);
 const mapPage=await context.newPage();mapPage.on('pageerror',error=>errors.push(error.message));
 await mapPage.goto(`http://127.0.0.1:${server.address().port}/analyzer.html?latest=1`);
 await mapPage.waitForSelector('#gpsRoute svg');assert.match(await mapPage.textContent('#gpsRoute'),/usable GPS fixes/);
 const analyzerDownloadPromise=mapPage.waitForEvent('download');await mapPage.click('#exportGpsRide');const analyzerDownload=await analyzerDownloadPromise;
 assert.match(await readFile(await analyzerDownload.path(),'utf8'),/# BikeCoachGPS=/);await mapPage.close();
 await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#firmwareStatus').textContent.includes('0.2.8'));
 await page.evaluate(()=>navigator.bluetooth.requestDevice().then(device=>device.gatt.disconnect()));
 assert.match(await page.textContent('#recordingStatus'),/unknown/);assert.equal(await page.locator('#fileList .file-row').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: automatic GPS start/stop, track persistence, GPS CSV export, route rendering, analyzer export, reload, plus connect, complete short-MTU list, long SD rename, collision guard, 20-byte handshake transfer, local rename, raw bytes/identity, CSV export, analyzer load, mobile layout, disconnect.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
