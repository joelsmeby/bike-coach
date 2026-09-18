import {orientationAngles,angleLabel} from './orientation.mjs';
import {Receiver,decode} from './core.mjs';
import {rideStore,recordStore} from './storage.js?v=3';
import {calibrate,samplesFromCsv,validCalibration,calibratedCsv,hasLevelReference,setLevelReference,useLevelReference} from './calibration.mjs?v=5';
import {RideWorkflow} from './ride-workflow.mjs';
const $=id=>document.getElementById(id),uuid=n=>`7b7e${n}-6f1d-4f35-9f55-42494b45434f`,enc=new TextEncoder();
const workflow=new RideWorkflow();
let analysisReference=null;
let device,command,statusChar,receiver,ride,operation=false,active=false,finishing=false;
let statusWait=null,tail=Promise.resolve(),packetChain=Promise.resolve(),lastPacket=0,transfer=null,recording=false;
const message=s=>$('status').textContent=s, text=v=>new TextDecoder().decode(v);
const calibrationKey=()=>`calibration:${device.id}`;
function controls(){
 const connected=!!command&&!!device?.gatt.connected,locked=operation||active;
 $('connect').disabled=locked;$('connect').textContent=connected?'Disconnect':'Connect Bike Coach';
 $('calibrate').disabled=!connected||locked||!!workflow.pending;
 $('start').disabled=!connected||locked||!hasLevelReference(workflow.calibration)||!!workflow.pending;
 $('stop').disabled=!connected||locked;$('download').disabled=!connected||locked;
 $('small').disabled=locked;$('cancel').hidden=!active;$('analyze').disabled=locked;
 $('applyCalibration').hidden=!ride||validCalibration(ride.calibration)||!validCalibration(workflow.calibration);
 $('applyCalibration').disabled=locked;
 $('calibrationReport').disabled=!connected||locked;
 $('setLevelReference').disabled=!connected||locked||recording||!!workflow.pending||!validCalibration(workflow.calibration);
 renderOrientation();
 $('calibrationStatus').textContent=!validCalibration(workflow.calibration)?'Calibrate before starting a ride.':hasLevelReference(workflow.calibration)?'Calibration and level reference ready. Recalibrate after remounting the device.':'Calibration ready. Set the level & analysis reference before starting a ride.';
}
function renderOrientation(){
 const angles=orientationAngles(workflow.calibration);
 $('orientationPitch').textContent=angles?angleLabel(angles.pitch):'—';
 $('orientationRoll').textContent=angles?angleLabel(angles.roll):'—';
 $('orientationYaw').textContent='Not measured';
 $('orientationNote').textContent=!angles?'No successful calibration available.':angles.referenced?'Pitch, roll and ride analysis use the same saved level reference.':'Pitch and roll use the original mounting estimate. Set the shared level reference before relying on bike-frame analysis.';
}
function write(s){
 const action=async()=>{if(!device?.gatt.connected||!command)throw Error('Bike Coach disconnected.');const b=enc.encode(s);
 if(command.properties.writeWithoutResponse&&command.writeValueWithoutResponse)await command.writeValueWithoutResponse(b);
 else if(command.writeValueWithResponse)await command.writeValueWithResponse(b);else await command.writeValue(b);};
 const p=tail.then(action);tail=p.catch(()=>{});return p;
}
function rejectStatus(e){if(statusWait){const w=statusWait;statusWait=null;clearTimeout(w.timer);w.reject(e);}}
async function confirmed(cmd,prefixes){
 const response=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{statusWait=null;reject(Error('Board did not confirm the command. Reconnect and try again.'));},5000);statusWait={resolve,reject,timer,prefixes};});response.catch(()=>{});
 try{await write(cmd);return await response;}catch(e){rejectStatus(e);throw e;}
}
function onStatus(e){
 const s=text(e.target.value);
 if(statusWait&&(s.startsWith('ERR,')||statusWait.prefixes.some(p=>s.startsWith(p)))){const w=statusWait;statusWait=null;clearTimeout(w.timer);s.startsWith('ERR,')?w.reject(Error(s)):w.resolve(s);}
 if(s.startsWith('TRANSFER,')&&transfer)transfer.name=s.split(',')[2];
 else if(s==='TRANSFER_DONE')finishTransfer();
 else if(s.startsWith('ERR,')&&active)failTransfer(Error(s));
 else if(!operation&&!active&&s.startsWith('SAVED,'))message('Recording stopped. Ready to download.');
}
function showRide(r){
 ride=r;$('result').hidden=false;$('progress').value=1;
 $('summary').textContent=`${r.name} · ${r.count.toLocaleString()} samples · ${(r.duration/1000).toFixed(1)} seconds`;
 $('saved').textContent=validCalibration(r.calibration)?'This ride has its own saved calibration. Save CSV includes it.':'No calibration is attached. The analyzer will show raw sensor axes.';controls();
}
function failTransfer(e){if(!transfer)return;const t=transfer;transfer=null;active=false;finishing=false;receiver=null;t.reject(e);controls();if(device?.gatt.connected)write('CANCEL_TRANSFER').catch(()=>{});}
function finishTransfer(){if(!transfer?.completed||!receiver?.done)return;const t=transfer;transfer=null;active=false;finishing=false;receiver=null;t.resolve(t.completed);controls();}
function download(kind,expectedName=null){
 if(active)return Promise.reject(Error('A download is already running.'));
 active=true;finishing=false;receiver=new Receiver($('small').checked?20:180);lastPacket=Date.now();$('progress').value=0;controls();
 message(kind==='calibration'?'Downloading the calibration sample…':'Downloading your ride…');
 return new Promise((resolve,reject)=>{transfer={kind,expectedName,name:null,resolve,reject,completed:null,waitingSince:0};write(`GET_LATEST,${receiver.limit},8`).catch(failTransfer);});
}
function onPacket(e){
 const a=new Uint8Array(e.target.value.buffer,e.target.value.byteOffset,e.target.value.byteLength).slice(),owner=transfer;
 packetChain=packetChain.then(async()=>{
  if(!active||!receiver||transfer!==owner)return;
  lastPacket=Date.now();const result=receiver.accept(a);$('progress').value=receiver.size?receiver.offset/receiver.size:0;
  if(!receiver.done)message(`${owner.kind==='calibration'?'Calibration':'Ride'}: ${receiver.offset.toLocaleString()} of ${receiver.size.toLocaleString()} bytes`);
  if(result.done&&!finishing){
   finishing=true;const decoded=decode(receiver.bytes);if(!decoded.count)throw Error('This recording has no motion samples.');
   if(!owner.name){const s=text(await statusChar.readValue());if(s.startsWith('TRANSFER,'))owner.name=s.split(',')[2];}
   if(owner.expectedName&&owner.name!==owner.expectedName)throw Error('The board returned a different recording. Please reconnect and try again.');
   const completed={...decoded,name:owner.name||'ride.BIN',bytes:receiver.bytes.slice(),downloadedAt:new Date().toISOString()};
   if(owner.kind==='calibration'){
    completed.calibration=calibrate(samplesFromCsv(decoded.csv),true);
    await recordStore(`calibration-sample:${device.id}`,completed);
   }else{
    completed.calibration=workflow.forFile(completed.name);
    await rideStore(completed);showRide(completed);workflow.completed(completed.name);
   }
   if(transfer!==owner)return;owner.completed=completed;owner.waitingSince=Date.now();
  }
  if(result.ack)await write(result.ack);
 }).catch(failTransfer);
}
setInterval(()=>{
 if(!active||!receiver||finishing)return;
 if(Date.now()-lastPacket>18000){failTransfer(Error('Download timed out. Reconnect and try again, using smaller packets if needed.'));return;}
 if(Date.now()-lastPacket>=100){const ack=receiver.flush();if(ack)write(ack).catch(failTransfer);}
},100);
let checking=false;
setInterval(async()=>{
 if(!active||!finishing||!transfer?.completed||checking)return;
 checking=true;const owner=transfer;
 try{if(text(await statusChar.readValue())==='TRANSFER_DONE')finishTransfer();
 else if(transfer===owner&&Date.now()-owner.waitingSince>18000)failTransfer(Error('Recording saved, but the board did not confirm completion. Reconnect before continuing.'));}
 catch(e){failTransfer(e);}finally{checking=false;}
},1000);
async function run(action){if(operation||active)return;operation=true;controls();try{await action();}catch(e){message(e.message);}finally{operation=false;controls();}}
$('connect').onclick=async()=>{
 if(device?.gatt.connected){device.gatt.disconnect();return;}
 await run(async()=>{
  if(!navigator.bluetooth)throw Error('Open this page in Bluefy on your iPhone.');
  device=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'BikeCoach'}],optionalServices:[uuid('1000')]});
   device.addEventListener('gattserverdisconnected',()=>{command=null;recording=false;analysisReference=null;workflow.disconnected();rejectStatus(Error('Disconnected. Reconnect before continuing.'));failTransfer(Error('Disconnected during download. Reconnect and try again.'));message('Disconnected. Saved rides are still available.');$('connection').textContent='Not connected';controls();});
  try{
   const server=await device.gatt.connect(),service=await server.getPrimaryService(uuid('1000'));
   command=await service.getCharacteristic(uuid('1001'));statusChar=await service.getCharacteristic(uuid('1002'));
   const dataChar=await service.getCharacteristic(uuid('1003'));
   statusChar.addEventListener('characteristicvaluechanged',onStatus);await statusChar.startNotifications();
   dataChar.addEventListener('characteristicvaluechanged',onPacket);await dataChar.startNotifications();
    const c=await recordStore(calibrationKey());workflow.setCalibration(validCalibration(c)?c:null);
    const ref=await recordStore(`analysis-reference:${device.id}`);analysisReference=hasLevelReference(ref)?ref:(hasLevelReference(c)?c:null);
   $('connection').textContent='Bike Coach connected';message('Connected. Calibrate once, then start your ride.');
  }catch(e){device.gatt.disconnect();throw e;}
 });
};
$('calibrate').onclick=()=>run(async()=>{
 if(workflow.pending)throw Error('Download your current ride before recalibrating.');
 workflow.setCalibration(null);controls();await recordStore(calibrationKey(),null);
 await confirmed('STOP_RIDE',['SAVED,','IDLE']);
 const start=await confirmed('START_RIDE',['LOGGING,']);recording=true;
 const file=start.slice(8);let stopped=false;
 try{
  const deadline=Date.now()+6000;message('Hold still — 6 seconds. Keep the bike upright on level ground.');
  await new Promise((resolve,reject)=>{const timer=setInterval(()=>{
   if(!device?.gatt.connected){clearInterval(timer);reject(Error('Calibration interrupted. Try again.'));return;}
   const remaining=Math.ceil((deadline-Date.now())/1000);
   if(remaining<=0){clearInterval(timer);resolve();}else message(`Hold still — ${remaining} seconds. Keep the bike upright on level ground.`);
  },100);});
  const s=await confirmed('STOP_RIDE',['SAVED,']);recording=false;stopped=true;
  if(s.slice(6)!==file)throw Error('Calibration recording changed. Try again.');
  const sample=await download('calibration',file);
  if(!validCalibration(sample.calibration))throw Error('Calibration failed: '+sample.calibration.reason);
   const prepared=analysisReference?useLevelReference(sample.calibration,analysisReference):sample.calibration;
   const c={...prepared,createdAt:new Date().toISOString(),sourceFile:file};
   await recordStore(calibrationKey(),c);workflow.setCalibration(c);message(hasLevelReference(c)?'Calibration ready. Tap Start ride whenever you are ready.':'Calibration ready. Now set the level & analysis reference.');
 }finally{if(!stopped&&device?.gatt.connected){try{await confirmed('STOP_RIDE',['SAVED,','IDLE']);recording=false;}catch{}}}
});
$('start').onclick=()=>run(async()=>{
 if(!hasLevelReference(workflow.calibration))throw Error('Calibrate and set the level & analysis reference before starting a ride.');
 if(workflow.pending)throw Error('Download your current ride before starting another.');
 await confirmed('STOP_RIDE',['SAVED,','IDLE']);const s=await confirmed('START_RIDE',['LOGGING,']);
 workflow.start(s.slice(8));recording=true;message('Recording your ride. You can move immediately.');
});
$('stop').onclick=()=>run(async()=>{const s=await confirmed('STOP_RIDE',['SAVED,','IDLE']);recording=false;if(s.startsWith('SAVED,'))workflow.stop(s.slice(6));message('Ride stopped. Tap Download latest ride.');});
$('download').onclick=()=>run(async()=>{const r=await download('ride',workflow.pending?.stopped?workflow.pending.name:null);message(validCalibration(r.calibration)?'Download complete. Your ride and its calibration are saved.':'Download complete. No calibration was linked to this ride; see the options below.');});
$('cancel').onclick=()=>failTransfer(Error('Download cancelled. The original stays on the board.'));
$('applyCalibration').onclick=()=>run(async()=>{if(!ride||!validCalibration(workflow.calibration))return;const r={...ride,calibration:structuredClone(workflow.calibration)};await rideStore(r);showRide(r);message('Saved calibration attached to this ride.');});
$('analyze').onclick=()=>location.href='analyzer.html?v=4&latest=1';
function save(csv){if(!ride)return;const data=csv?calibratedCsv(ride.csv,ride.calibration):ride.bytes;
 const url=URL.createObjectURL(new Blob([data],{type:csv?'text/csv':'application/octet-stream'})),a=document.createElement('a');
 a.href=url;a.download=ride.name.replace(/\.[^.]+$/,'')+(csv?'.csv':'.bin');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('saveCsv').onclick=()=>save(true);$('saveBin').onclick=()=>save(false);
rideStore().then(r=>{if(r)showRide(r);}).catch(()=>message('Allow website storage before downloading.'));
controls();if(!navigator.bluetooth)message('For Bluetooth downloads on iPhone, open this page in Bluefy.');
 if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'get_ride_status',description:'Read connection, calibration and ride status.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({connected:!!device?.gatt.connected,recording,downloading:active,calibrationReady:hasLevelReference(workflow.calibration),bytes:receiver?.offset||0,total:receiver?.size||0,savedRide:ride?{name:ride.name,samples:ride.count}:null})})).catch(()=>{});}catch{}}

$('calibrationReport').onclick=()=>run(async()=>{
 const sample=await recordStore(`calibration-sample:${device.id}`);
 if(!sample)throw Error('No calibration sample saved for this device yet. Run Calibrate first.');
 const report={format:'BikeCoachCalibrationReport1',name:sample.name,downloadedAt:sample.downloadedAt,count:sample.count,duration:sample.duration,result:calibrate(samplesFromCsv(sample.csv),true),csv:sample.csv};
 const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='BikeCoach-calibration-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 message('Calibration report prepared. Save it to Files, then attach it in our conversation.');
});

$('setLevelReference').onclick=()=>run(async()=>{
 if(recording||workflow.pending||!validCalibration(workflow.calibration))return;
 const reference=setLevelReference(workflow.calibration);
 if(!reference)throw Error('Could not create a level reference. Calibrate again first.');
 await recordStore(calibrationKey(),reference);
 await recordStore(`analysis-reference:${device.id}`,reference);
 analysisReference=structuredClone(reference);workflow.setCalibration(reference);
 message('Level reference saved. It will be used for both orientation and ride analysis.');
});
