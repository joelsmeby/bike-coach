// Run in CI for changes on either platform: same source + same defaults + same outcomes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {ENGINE_VERSION,DEFAULT_SETTINGS,parseRide,analyzeRide} from '../analysis-engine.mjs';
const python=process.env.BIKECOACH_PYTHON||'python3';
const run=spawnSync(python,['desktop/tests/parity_cases.py'],{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,PYTHONPATH:'desktop',QT_QPA_PLATFORM:'offscreen'}});
if(run.error||run.status!==0)throw Error(run.error?.message||run.stderr);
const fixtures=JSON.parse(run.stdout);
assert.equal(fixtures.metadata.version,ENGINE_VERSION);
assert.deepEqual(fixtures.python_defaults,DEFAULT_SETTINGS,'Python/UI defaults must match the shared engine');
function same(a,b,path){
 if(typeof b==='number'){assert.equal(typeof a,'number',path);assert(Math.abs(a-b)<=2e-6*Math.max(1,Math.abs(b)),`${path}: ${a} != ${b}`);return;}
 if(Array.isArray(b)){assert(Array.isArray(a),path);assert.equal(a.length,b.length,path);b.forEach((v,i)=>same(a[i],v,path+'['+i+']'));return;}
 if(b&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);for(const k of Object.keys(b))same(a[k],b[k],path+'.'+k);return;}
 assert.equal(a,b,path);
}
for(const f of fixtures.cases){const result=analyzeRide(parseRide(f.csv),f.settings);for(const key of Object.keys(f.expected))same(result[key],f.expected[key],f.name+'.'+key);}
console.log(`PASS: ${fixtures.cases.length} shared-engine desktop/Node cases; defaults, importer, filters, gyro, GPS, height, distance and event decisions agree.`);
