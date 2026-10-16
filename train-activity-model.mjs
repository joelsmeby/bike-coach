// Retrain the movement KNN from a guided Artemis CSV and the existing model.
// Usage: node train-activity-model.mjs /path/to/dataLog9.csv [--write]
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import currentModel from './activity-model.mjs';
import {FEATURE_NAMES, extractActivityFeatures, classifyActivityFeatures} from './activity-detector.mjs';

const sourcePath=process.argv[2];
if(!sourcePath){console.error('Usage: node train-activity-model.mjs ride.csv [--write]');process.exit(2)}
const source=await readFile(sourcePath,'utf8');
const header=source.split(/\r?\n/).find(line=>line.startsWith('# BikeCoachTraining='));
if(!header)throw new Error('Training labels are missing from the CSV.');
const labels=JSON.parse(header.slice('# BikeCoachTraining='.length));
if(labels.protocolId!=='bike-movement-3min-v1'||labels.durationSeconds!==180)throw new Error('Unsupported training protocol.');
const columns=['aX','aY','aZ','gX','gY','gZ'];
const lines=source.split(/\r?\n/);
const csvHeader=lines.findIndex(line=>line.startsWith('rtcDate,rtcTime,'));
if(csvHeader<0)throw new Error('Missing Artemis CSV header.');
const fields=lines[csvHeader].split(',');
const positions=columns.map(key=>fields.indexOf(key));
if(positions.some(index=>index<0))throw new Error('Missing acceleration or gyro columns.');
const rows=[];
for(const line of lines.slice(csvHeader+1)){
  if(!line.trim())continue;
  const parts=line.split(',');
  const match=parts[1]?.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if(!match)throw new Error(`Invalid timestamp: ${parts[1]}`);
  const time=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
  const values=positions.map(index=>Number(parts[index]));
  if(values.some(value=>!Number.isFinite(value)))throw new Error('Invalid IMU reading.');
  rows.push({ts:time,...Object.fromEntries(columns.map((key,index)=>[key,values[index]]))});
}
if(rows.length<8000)throw new Error('Training ride is too short.');
const first=rows[0].ts, duration=rows.at(-1).ts-first;
if(Math.abs(duration-180)>1)throw new Error(`Expected 180 s, found ${duration.toFixed(1)} s.`);
// The Artemis clock reports centiseconds, so two adjacent ~50 Hz samples can tie.
for(let i=1;i<rows.length;i++)if(rows[i].ts<rows[i-1].ts||rows[i].ts-rows[i-1].ts>.1)throw new Error(`Timestamp discontinuity near row ${i}.`);
const segments=labels.segments;
if(!Array.isArray(segments)||!segments.length)throw new Error('No labeled segments.');
for(let i=0;i<segments.length;i++){
  const segment=segments[i];
  if(!Number.isFinite(segment.startSeconds)||!Number.isFinite(segment.endSeconds)||segment.endSeconds<=segment.startSeconds||
     (i&&segment.startSeconds<segments[i-1].endSeconds))throw new Error('Invalid or overlapping segments.');
}
const mapLabel=label=>({acceleration:'accel_brake',braking:'accel_brake'})[label]||label;
const rideId=labels.sourceFile.replace(/\.[^.]+$/,'');
// Re-running with the same ride replaces its windows instead of doubling them.
const priorExamples=currentModel.examples.filter(item=>item.sourceRide!==rideId);
const oldRides=new Set(priorExamples.map(item=>item.sourceRide));
const priorModel={...currentModel,examples:priorExamples};
if(FEATURE_NAMES.join()!==currentModel.featureNames.join())throw new Error('Feature schema mismatch.');

// Match the analyzer: average raw readings into 25 Hz buckets, then use 2 s windows.
const buckets=new Map(), bucketSeconds=1/currentModel.sampleRateHz;
for(const row of rows){
  const key=Math.floor((row.ts-first)/bucketSeconds+1e-6);
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(row);
}
const resampled=[...buckets.values()].map(group=>({ts:group.reduce((sum,r)=>sum+r.ts,0)/group.length,...Object.fromEntries(columns.map(key=>[key,group.reduce((sum,r)=>sum+r[key],0)/group.length]))}));
const examples=[], holdout=[];
for(const [index,segment] of segments.entries()){
  if(segment.label==='exclude')continue;
  const label=mapLabel(segment.label);
  if(!priorExamples.some(item=>item.label===label))throw new Error(`Unknown label: ${label}`);
  const section=[];
  // Full window inside the segment plus 0.5 s transition buffer on each side.
  for(let center=Math.ceil(segment.startSeconds+1.5);center<=segment.endSeconds-1.5;center+=currentModel.strideSeconds){
    const window=resampled.filter(row=>row.ts>=first+center-1&&row.ts<first+center+1);
    if(window.length<currentModel.sampleRateHz*1.5)continue;
    section.push({label,features:extractActivityFeatures(window),sourceRide:rideId,segment:index,time:center});
  }
  if(!section.length)throw new Error(`No usable samples in ${segment.label} at ${segment.startSeconds}s.`);
  // Keep the last third of each section for diagnostic evaluation only.
  const split=Math.max(1,Math.floor(section.length*2/3));
  examples.push(...section.slice(0,split));
  holdout.push(...section.slice(split));
}
const evaluate=(model,items)=>{
  const confusion={}, correct=items.reduce((count,item)=>{
    const predicted=classifyActivityFeatures(item.features,model).label;
    (confusion[item.label]??={})[predicted]=(confusion[item.label][predicted]||0)+1;
    return count+Number(predicted===item.label);
  },0);
  return {windows:items.length,correct,accuracy:items.length?correct/items.length:null,confusion};
};
const allNew=[...examples,...holdout];
const before=evaluate(priorModel,allNew);
const training=[...priorExamples,...examples];
const interim={...currentModel,examples:training};
const diagnostic=evaluate(interim,holdout);
const model={...currentModel,
  modelId:'activity-knn-v2', trainedFrom:[...oldRides,rideId],
  examples:[...priorExamples,...allNew.map(({label,features,sourceRide})=>({label,features,sourceRide}))],
  generatedAt:new Date().toISOString(),
  trainingEvaluation:{
    warning:'Labels follow the guided schedule and are not rider-corrected. The post-training holdout shares the same ride and is optimistic; validate on a third independent labeled ride.',
    sourceSha256:createHash('sha256').update(source).digest('hex'),
    sourceSamples:rows.length, trainingRides:[...new Set([...oldRides,rideId])],
    addedWindows:allNew.length, preTrainingOnNewRide:before,
    sameRideSectionHoldout:{...diagnostic,trainingWindows:training.length}
  }
};
console.log(JSON.stringify({sourceRide:rideId,samples:rows.length,durationSeconds:duration,addedWindows:allNew.length,
  byLabel:Object.fromEntries([...new Set(allNew.map(x=>x.label))].map(label=>[label,allNew.filter(x=>x.label===label).length])),
  preTrainingOnNewRide:before,sameRideSectionHoldout:diagnostic},null,2));
if(process.argv.includes('--write')){
  const destination=join(dirname(fileURLToPath(import.meta.url)),'activity-model.mjs');
  await writeFile(destination,`// Generated by train-activity-model.mjs. Do not edit by hand.\nexport default ${JSON.stringify(model,null,2)};\n`);
  console.log(`Wrote ${destination}`);
}
