import test from 'node:test';
import assert from 'node:assert/strict';
import {completeStatusReply,powerDescription} from './device-status.mjs';
import {parseFileReply} from './file-browser.mjs';
const value=text=>new DataView(new TextEncoder().encode(text).buffer);

test('20-byte file notification is completed by reading the full value',async()=>{
 const full='FILE,0,12,dataLog00000.TXT,876542';
 assert.throws(()=>parseFileReply(full.slice(0,20),0));
 const reply=await completeStatusReply(full.slice(0,20),async()=>value(full));
 assert.deepEqual(parseFileReply(reply,0),{done:false,index:0,total:12,name:'dataLog00000.TXT',size:876542});
});
test('read full value even when truncation leaves a valid-looking file size',async()=>{
 const full='FILE,0,1,a.TXT,1234567',short=full.slice(0,-2);
 assert.equal(parseFileReply(short,0).size,12345);
 assert.equal(parseFileReply(await completeStatusReply(short,async()=>value(full)),0).size,1234567);
});
test('INFO state and file survive a shortened notification',async()=>{
 const full='BIKECOACH,FW=0.2.6,STATE=LOGGING,FILE=dataLog00032.TXT';
 assert.equal(await completeStatusReply(full.slice(0,20),async()=>value(full)),full);
});
test('stale or failed full reads are reported instead of accepting partial data',async()=>{
 await assert.rejects(completeStatusReply('FILE,0,',async()=>value('IDLE')),/status changed/);
 await assert.rejects(completeStatusReply('FILE,0,',async()=>{throw Error('disconnected')}),/disconnected/);
});
test('battery voltage estimates are bounded and external supply does not show 100%',()=>{
 assert.match(powerDescription('POWER,3300'),/~0%/);
 assert.match(powerDescription('POWER,3800'),/~50%/);
 assert.match(powerDescription('POWER,4200'),/~100%/);
 assert.match(powerDescription('POWER,5000'),/External power.*unavailable/);
 assert.equal(powerDescription('POWER,0'),'Battery: voltage unavailable');
 assert.equal(powerDescription('POWER,'),'Battery: voltage unavailable');
});
