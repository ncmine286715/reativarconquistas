import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const ids=['essential7v4','pro7v4','creator30v4','studio30v4'],MB=1048576;
{
 const mod=await import('../src/index.js');
 const old=await import('./legacy-catalog.mjs');
 for(const [id,p] of Object.entries(old.PLAN_LIMITS))assert.deepEqual(mod.PLAN_LIMITS[id],p,'Preserve every legacy grant: '+id);
 const env={PREMIUM_KV:{async get(){return null;}},SALES_ENABLED:'1'};
 const catalog=await (await mod.default.fetch(new Request('https://worldify.com.br/api/config'),env)).json();
 assert.deepEqual(catalog.display_plan_ids,ids);assert.equal(catalog.payment_provider,'abacate');assert.equal(catalog.infinitepay_configured,false);
 assert.deepEqual(ids.map(id=>catalog.plans[id].price_cents),[790,1490,2990,4990]);assert.equal(catalog.plans.world1,undefined);
 for(const id of ids){const p=mod.PLAN_LIMITS[id],ent={plan:id,premium_until_ms:Date.now()+86400000};
  for(const size of [1,20*MB,p.max_file_bytes]){const allowed=mod.checkEntitlement(ent,p.max_batch,size);assert.equal(allowed.allowed,true);assert.equal(allowed.free_quota_tools[0].limit,p.daily_operations);assert.equal(allowed.requires_completion,true);}
  assert.equal(mod.checkEntitlement(ent,p.max_batch+1,1).code,'BATCH_LIMIT');assert.equal(mod.checkEntitlement(ent,1,p.max_file_bytes+1).code,'SIZE_LIMIT');
  assert.equal(mod.checkEntitlement(ent,1,1,Date.now(),{tool:'world_paint'}).allowed,p.capabilities.world_studio);
  assert.equal(mod.checkEntitlement({...ent,premium_until_ms:Date.now()-1},1,20*MB).allowed,false);
 }
 const retired=await mod.default.fetch(new Request('https://worldify.com.br/api/infinitepay/create',{method:'POST'}),env);assert.equal(retired.status,410);
 class Storage {constructor(){this.map=new Map();this.lock=Promise.resolve();}async get(k){return structuredClone(this.map.get(k));}async put(k,v){this.map.set(k,structuredClone(v));}async transaction(fn){const prev=this.lock;let unlock;this.lock=new Promise(r=>unlock=r);await prev;try{return await fn(this);}finally{unlock();}}}
 const store=new Storage(),obj=new mod.EntitlementDO({storage:store}),call=async(route,body)=>{const r=await obj.fetch(new Request('https://do'+route,{method:'POST',body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
 const day='2026-10-03',q=(op)=>({tool:'paid_operations',limit:3,day,operation_id:op});
 const concurrent=await Promise.all(['a','b','c','d','e'].map(op=>call('/reserve-quota',q(op))));assert.equal(concurrent.filter(r=>r.allowed).length,3,'atomic cap across tabs');
 assert.equal((await call('/reserve-quota',q('a'))).allowed,true,'authorization retry');await call('/release',{operation_id:'b'});assert.equal((await call('/reserve-quota',q('d'))).allowed,true,'failed operation returns quota');
 await call('/complete',{operation_id:'a'});await call('/complete',{operation_id:'a'});const state=await store.get('entitlement');assert.equal(state.quotas['paid_operations:'+day],1,'completion retry consumes once');
 assert.equal((await call('/reserve-quota',{...q('tomorrow'),day:'2026-10-04'})).allowed,true,'new UTC day resets');
 console.log('PASS: legacy preservation, catalog, capacity, Studio, expiry and atomic daily quota passed.');
}
