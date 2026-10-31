import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function port() {
  const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));
  const p=s.address().port;await new Promise(r=>s.close(r));return p;
}
async function ready(url) {
  for(let i=0;i<80;i++){
    try {if((await fetch(url)).ok)return;}catch{}
    await new Promise(r=>setTimeout(r,50));
  }throw Error('proxy not ready');
}
const valid = {revision:1,lessons:[
  {id:'1',title:'One',level:'foundation',minutes:9},
  {id:'2',title:'Two',level:'architecture',minutes:12},
  {id:'3',title:'Three',level:'practice',minutes:15}
]};

test('fault proxy: 503 and malformed body are injected, recorded, then recover to real upstream',async()=>{
  const upstream=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(valid));});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const up=upstream.address().port, proxy=await port();
  const dir=await mkdtemp(join(tmpdir(),'kv-e2e-')), log=join(dir,'events.log');
  const child=spawn(process.execPath,['tools/device-smoke/api-proxy.mjs'],{
    cwd:root,env:{...process.env,KV_DEVICE_TEST_MODE:'1',KV_DEVICE_HITS_FILE:log,
      KV_DEVICE_PROXY_PORT:String(proxy),KV_DEVICE_API_URL:`http://127.0.0.1:${up}`},stdio:'ignore'
  });
  const url=`http://127.0.0.1:${proxy}`;
  const control=mode=>fetch(url+'/__control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode})});
  try {
    await ready(url+'/__ready');
    assert.equal((await fetch(url+'/api/lessons')).status,200);
    assert.equal((await control('http-503')).status,200);
    const offline=await fetch(url+'/api/lessons');assert.equal(offline.status,503);
    assert.match(await offline.text(),/E2E-injected/);
    assert.equal((await control('malformed-json')).status,200);
    const malformed=await fetch(url+'/api/lessons');assert.equal(malformed.status,200);
    assert.rejects(()=>malformed.json(),SyntaxError);
    assert.equal((await control('DROP DATABASE')).status,400);
    assert.equal((await control('ok')).status,200);
    const success=await fetch(url+'/api/lessons');assert.equal((await success.json()).lessons.length,3);
    const state=await (await fetch(url+'/__state')).json();
    assert.deepEqual(state,{scenario:'ok',valid:2,rejected:1,malformed:1});
    const text=await readFile(log,'utf8');
    assert.equal((text.match(/ valid-api-hit/g)||[]).length,2);
    for(const event of ['scenario:http-503','injected-http-503','scenario:malformed-json','injected-malformed-json','scenario:ok'])assert.match(text,new RegExp(event));
  }finally{child.kill();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});}
});

test('control endpoint is disabled by default, including private loopback clients',async()=>{
  const proxy=await port(),dir=await mkdtemp(join(tmpdir(),'kv-e2e-safe-'));
  const child=spawn(process.execPath,['tools/device-smoke/api-proxy.mjs'],{
    cwd:root,env:{...process.env,KV_DEVICE_TEST_MODE:'0',KV_DEVICE_PROXY_PORT:String(proxy),KV_DEVICE_HITS_FILE:join(dir,'events.log')},stdio:'ignore'
  });
  try {
    const url=`http://127.0.0.1:${proxy}`;await ready(url+'/__ready');
    assert.equal((await fetch(url+'/__control',{method:'POST',headers:{'content-type':'application/json'},body:'{"mode":"http-503"}'})).status,404);
    assert.equal((await fetch(url+'/__state')).status,404);
  }finally{child.kill();await rm(dir,{recursive:true,force:true});}
});
