import assert from 'node:assert/strict';
import worker,{PLAN_LIMITS,EntitlementDO} from '../src/index.js';
import {MONTHLY_IDS,ANNUAL_IDS,periodEnd} from '../src/billing-periods.mjs';
class Storage{constructor(){this.map=new Map();this.lock=Promise.resolve();}async get(k){return structuredClone(this.map.get(k));}async put(k,v){this.map.set(k,structuredClone(v));}async delete(k){this.map.delete(k);}async transaction(fn){const before=this.lock;let done;this.lock=new Promise(r=>done=r);await before;try{return await fn(this);}finally{done();}}}
const expected=[599,799,1195,1499,2290];
for(const [i,id]of MONTHLY_IDS.entries()){assert.equal(PLAN_LIMITS[id].price_cents,expected[i]);assert.equal(PLAN_LIMITS[ANNUAL_IDS[i]].price_cents,expected[i]*12);assert.equal(PLAN_LIMITS[id].billing_interval,'monthly');assert.equal(PLAN_LIMITS[ANNUAL_IDS[i]].renewal_mode,'manual');}
assert.equal(PLAN_LIMITS.single1v5.duration_days,1);assert.equal(PLAN_LIMITS.week7v5.duration_days,7);assert.equal(PLAN_LIMITS.creator30v5.duration_days,30);
assert.equal(new Date(periodEnd(Date.parse('2028-01-31T12:30:00Z'),PLAN_LIMITS.basicmonthv6)).toISOString(),'2028-02-29T12:30:00.000Z');
assert.equal(new Date(periodEnd(Date.parse('2028-02-29T12:30:00Z'),PLAN_LIMITS.basicyearv6)).toISOString(),'2029-02-28T12:30:00.000Z');
const response=await worker.fetch(new Request('https://worldify.com.br/api/config'),{}),config=await response.json();assert.equal(response.status,200);assert.deepEqual(config.monthly_plan_ids,MONTHLY_IDS);assert.deepEqual(config.annual_plan_ids,ANNUAL_IDS);assert.equal(config.purchasable_plan_ids.length,10);assert.equal(config.plans.studioyearv6.price_cents,27480);
const obj=new EntitlementDO({storage:new Storage()});
const grant=async(plan,bid)=>(await obj.fetch(new Request('https://internal/grant',{method:'POST',body:JSON.stringify({plan,billing_id:bid})}))).json();
const now=Date.now(),first=await grant('basicmonthv6','v6-first');assert.equal(first.plan,'basicmonthv6');assert.ok(Math.abs(first.premium_until_ms-periodEnd(now,PLAN_LIMITS.basicmonthv6))<3000);
const duplicate=await grant('basicmonthv6','v6-first');assert.equal(duplicate.duplicate,true);assert.equal(duplicate.premium_until_ms,first.premium_until_ms);
const second=await grant('basicmonthv6','v6-second');assert.equal(second.premium_until_ms,periodEnd(first.premium_until_ms,PLAN_LIMITS.basicmonthv6));
const upgraded=await grant('studioyearv6','v6-upgrade');assert.equal(upgraded.plan,'studioyearv6');assert.ok(upgraded.premium_until_ms>second.premium_until_ms+364*86400000,'upgrade preserves old access');
console.log('PASS: 10 prices, legacy receipts, calendar/leap dates, public catalog, grants, duplicate payments, renewal stacking and upgrade preservation.');
