import test from 'node:test';
import assert from 'node:assert/strict';
import {trailFilename,validRecordingName,renameRecording,parseRenameReply,commandParts} from './recording-names.mjs';
import {parseFileReply,LegacyReceiver} from './file-browser.mjs';
import {RideWorkflow} from './ride-workflow.mjs';
import {includeZero,tickDecimals} from './chart-scale.mjs';

test('trail names become readable filenames while the extension stays locked',()=>{
 assert.equal(trailFilename('Family Man Run 1','dataLog00042.TXT'),'Family_Man_Run_1.TXT');
 assert.equal(trailFilename('Déjà Vu Run 2.csv','old.csv'),'Deja_Vu_Run_2.csv');
 assert.throws(()=>trailFilename('trail.bin','old.TXT'),/extension/);
 assert.throws(()=>trailFilename('  ','old.TXT'));
 assert.throws(()=>trailFilename('x'.repeat(61),'old.TXT'),/60/);
});
test('long filenames list and rename safely; paths and protocol separators fail',()=>{
 const name='A'.repeat(60)+'.TXT';assert.equal(validRecordingName(name),true);
 assert.equal(parseFileReply(`FILE,0,1,${name},1024`,0).name,name);
 for(const bad of ['../ride.TXT','/ride.TXT','ride,2.TXT','ride\n.TXT','a'.repeat(61)+'.TXT'])assert.equal(validRecordingName(bad),false);
 assert.throws(()=>parseRenameReply('RENAMED,old.TXT,wrong.TXT','old.TXT','new.TXT'));
 parseRenameReply('RENAMED,old.TXT,new.TXT','old.TXT','new.TXT');
});
test('renaming a downloaded copy preserves raw data, identity and bike calibration',()=>{
 const original={name:'log.TXT',sourceName:'log.TXT',recordingId:'ride-123',bytes:new Uint8Array([1,2,3]),csv:'raw',calibration:{bikeName:'Patrol'},trainingLabels:{sourceFile:'log.TXT',segments:[1]}};
 const renamed=renameRecording(original,'Trail_Run1.TXT');
 assert.equal(renamed.sourceName,'log.TXT');assert.equal(renamed.originalName,'log.TXT');
 assert.equal(renamed.recordingId,'ride-123');assert.equal(renamed.bytes,original.bytes);assert.equal(renamed.calibration,original.calibration);
 assert.equal(renamed.trainingLabels.sourceFile,'Trail_Run1.TXT');assert.equal(original.trainingLabels.sourceFile,'log.TXT');
 assert.equal(renameRecording(renamed,'Trail_Run2.TXT',{onBoard:true}).sourceName,'Trail_Run2.TXT');
});
test('SD rename keeps the explicit pending bike-profile association',()=>{
 const workflow=new RideWorkflow();workflow.setCalibration({bikeName:'Patrol'});workflow.start('log.TXT');workflow.stop('log.TXT');workflow.rename('log.TXT','Trail.TXT');
 assert.equal(workflow.forFile('log.TXT'),null);assert.deepEqual(workflow.forFile('Trail.TXT'),{bikeName:'Patrol'});
 workflow.disconnected();assert.equal(workflow.forFile('Trail.TXT'),null);
});
test('commands with two maximum-length names round-trip in acknowledged 20-byte writes',()=>{
 const command=`RENAME_FILE,${'A'.repeat(60)}.TXT,${'B'.repeat(60)}.TXT`,parts=commandParts(command);
 assert.equal(parts[0],'CMD_CLEAR');assert.equal(parts.at(-1),'CMD_RUN');
 assert.equal(parts.slice(1,-1).map(p=>p.slice(8)).join(''),command);
 assert(parts.every(p=>new TextEncoder().encode(p).length<=20));
 assert.deepEqual(commandParts('INFO'),['INFO']);assert.throws(()=>commandParts('a'.repeat(161)));
});
test('zero stays in the range for positive-only and negative-only chart data',()=>{
 assert.deepEqual(includeZero(700,1100),[0,1100]);assert.deepEqual(includeZero(-10,-2),[-10,0]);assert.deepEqual(includeZero(-5,8),[-5,8]);
});
test('chart labels preserve 2.5 and 0.25 increments without rounding them to integers or tenths',()=>{
 for(const [step,digits] of [[100,0],[2.5,1],[.25,2],[.005,3]])assert.equal(tickDecimals(step),digits);
});
test('legacy chunk sequence wraps while full packet count is retained',()=>{
 const receiver=new LegacyReceiver();receiver.start(2);receiver.next=65535;
 for(const [seq,offset] of [[65535,0],[0,1]]){const bytes=new Uint8Array(7),view=new DataView(bytes.buffer);view.setUint16(0,seq,true);view.setUint32(2,offset,true);bytes[6]=offset+1;receiver.accept(bytes);}
 assert.equal(receiver.next,65537);assert.equal(receiver.done,true);
});
