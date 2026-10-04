import assert from 'node:assert/strict';
import * as worker from '../src/index.js';
class Storage {
 constructor(){this.map=new Map();this.lock=Promise.resolve();}
 async get(k,type){const v=this.map.get(k);return type==='json'&&typeof v==='string'?JSON.parse(v):structuredClone(v);}
 async put(k,v){this.map.set(k,structuredClone(v));} async delete(k){this.map.delete(k);}
 async list({prefix='' }={}){return {keys:[...this.map.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};}
 async transaction(fn){const prev=this.lock;let unlock;this.lock=new Promise(r=>unlock=r);await prev;try{return await fn(this);}finally{unlock();}}
}
class Namespace {constructor(){this.objects=new Map();}idFromName(n){return n;}get(n){if(!this.objects.has(n))this.objects.set(n,new worker.EntitlementDO({storage:new Storage()}));const obj=this.objects.get(n);return {fetch:(r,init)=>obj.fetch(r instanceof Request?r:new Request(r,init))};}}
const ids=['essential7v4','pro7v4','creator30v4','studio30v4'];
const env={PREMIUM_KV:new Storage(),ENTITLEMENTS:new Namespace(),FIREBASE_WEB_API_KEY:'fixture',ABACATEPAY_V4_API_KEY:'fixture',ABACATEPAY_API_KEY:'legacy',ABACATEPAY_V4_WEBHOOK_SECRET:'new-secret',WEBHOOK_SECRET:'old-secret',PUBLIC_BASE_URL:'https://worldify.com.br',ALLOWED_ORIGINS:'https://worldify.com.br',INFINITEPAY_LEGACY_HANDLE:'legacy-store',PAYMENT_PROVIDER:'abacate',SALES_ENABLED:'1'};
for(const id of ids)env['ABACATEPAY_PRODUCT_ID_'+id.toUpperCase()]='product_'+id;
let creates=0,productPriceOverride=null;const records=new Map(),originalFetch=globalThis.fetch;
const j=(o,status=200)=>new Response(JSON.stringify(o),{status});
globalThis.fetch=async(url,opt={})=>{
 const u=String(url);
 if(u==='https://api.checkout.infinitepay.io/payment_check'){assert.equal(JSON.parse(opt.body).handle,'legacy-store');return j({success:true,paid:true,amount:799});}
 if(u.includes('identitytoolkit.googleapis.com')){const token=JSON.parse(opt.body).idToken;return j({users:[{localId:'uid_'+token,email:token+'@example.test',displayName:'Fixture'}]});}
 if(u.includes('/products/get')){const id=new URL(u).searchParams.get('id'),plan=id.replace('product_','');return j({data:{id,price:productPriceOverride??worker.PLAN_LIMITS[plan].price_cents,currency:'BRL',cycle:null,status:'ACTIVE',devMode:false}});}
 if(u.endsWith('/checkouts/create')){const b=JSON.parse(opt.body),plan=b.metadata.plan;assert.deepEqual(b.methods,['PIX']);assert.equal(b.completionUrl,'https://worldify.com.br/sucesso.html');assert.equal(b.metadata.firebase_uid,'uid_'+b.metadata.email.split('@')[0]);const id='checkout_'+(++creates),record={id,url:'https://app.abacatepay.com/pay/'+id,status:'PENDING',amount:worker.PLAN_LIMITS[plan].price_cents,paidAmount:0,devMode:false,metadata:b.metadata};records.set(id,record);return j({data:record});}
 if(u.includes('/checkouts/get')){const r=records.get(new URL(u).searchParams.get('id'));return r?j({data:r}):j({},404);}
 if(u.includes('/v1/billing/get')){if(new URL(u).searchParams.get('id')==='legacy_billing' && opt.headers.Authorization==='Bearer legacy')return j({data:{id:'legacy_billing',status:'PAID',metadata:{plan:'vip7',firebase_uid:'uid_legacybuyer',email:'legacybuyer@example.test'},paidAt:new Date().toISOString()}});return j({},404);}
 throw Error('Unexpected outbound request '+u);
};
const request=(route,{token='buyer',body,method=body?'POST':'GET',headers={}}={})=>worker.default.fetch(new Request('https://worldify.com.br'+route,{method,headers:{Origin:'https://worldify.com.br',Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
try {
 for(const [i,plan] of ids.entries()){
  const token='buyer'+i,body={plan,request_id:'checkout-request-v4-'+i,terms_accepted:true,terms_version:'2026-10-03-v4'};
  const response=await request('/api/abacate/create',{token,body});assert.equal(response.status,200);const c=await response.json();
  const again=await request('/api/abacate/create',{token,body:{...body,request_id:'checkout-reopen-v4-'+i}});assert.equal((await again.json()).id,c.id,'reopen reuses pending checkout');
  assert.equal((await (await request('/api/abacate/status?id='+c.id,{token})).json()).paid,false,'pending does not grant');
  assert.equal((await request('/api/abacate/status?id='+c.id,{token:'attacker'})).status,403,'UID ownership required');
  Object.assign(records.get(c.id),{status:'PAID',paidAmount:worker.PLAN_LIMITS[plan].price_cents,paidAt:new Date().toISOString()});
  const webhook=()=>request('/api/abacate/webhook?secret=new-secret',{body:{event:'checkout.completed',data:{checkout:{id:c.id}}}});
  const results=await Promise.all([request('/api/abacate/status?id='+c.id,{token}),webhook(),webhook()]);for(const r of results)assert.equal(r.status,200);
  const ent=await(await request('/api/entitlements',{token})).json();assert.equal(ent.plan,plan);const expected=worker.PLAN_LIMITS[plan].duration_days*86400000;assert.ok(Math.abs(ent.premium_until_ms-Date.now()-expected)<3000,'grant exactly once across webhook/status retries');
 }
 assert.equal(creates,4,'exactly one checkout per buyer');
 const legacy=await request('/api/abacate/status?id=legacy_billing',{token:'legacybuyer'});assert.equal(legacy.status,200);assert.equal((await legacy.json()).paid,true);const legacyEnt=await(await request('/api/entitlements',{token:'legacybuyer'})).json();assert.equal(legacyEnt.plan,'vip7','previous key and v1 receipt remain redeemable');
 assert.equal((await request('/api/abacate/create',{body:{plan:'vip7',request_id:'checkout-old-tier-00001',terms_accepted:true}})).status,400,'old offers retired');
 assert.equal((await request('/api/abacate/create',{body:{plan:ids[0],request_id:'checkout-without-terms-01'}})).status,400,'terms required');
 productPriceOverride=799;const mismatch=await request('/api/abacate/create',{token:'mismatch',body:{plan:ids[0],request_id:'checkout-mismatch-00001',terms_accepted:true}});assert.equal(mismatch.status,502);assert.equal(creates,4,'product price mismatch blocks creation');productPriceOverride=null;
 await env.PREMIUM_KV.put('pend:old_infinite_order',JSON.stringify({uid:'uid_oldinfinite',email:'oldinfinite@example.test',plan:'vip7',via:'infinitepay'}));const oldInf=await request('/api/infinitepay/status?order_nsu=old_infinite_order&transaction_nsu=legacy_tx&slug=legacy_slug',{token:'oldinfinite'});assert.equal(oldInf.status,200);assert.equal((await oldInf.json()).paid,true,'old InfinitePay checkout can still activate');
 const invalid=records.get('checkout_1');invalid.paidAmount=1;assert.equal((await request('/api/abacate/status?id=checkout_1',{token:'buyer0'})).status,500,'underpaid result rejected');invalid.paidAmount=invalid.amount;invalid.devMode=true;assert.equal((await request('/api/abacate/status?id=checkout_1',{token:'buyer0'})).status,500,'test-mode result rejected');invalid.devMode=false;
 assert.equal((await request('/api/abacate/webhook?secret=wrong',{body:{}})).status,403);
 const upgrade=new worker.EntitlementDO({storage:new Storage()}),call=async(body)=> (await upgrade.fetch(new Request('https://do/grant',{method:'POST',body:JSON.stringify(body)}))).json();
 await call({billing_id:'a',plan:ids[0]});const up=await call({billing_id:'b',plan:ids[1]});assert.equal(up.plan,ids[1]);assert.ok(Math.abs(up.premium_until_ms-Date.now()-14*86400000)<3000,'upgrade preserves remaining days');const studio=await call({billing_id:'c',plan:ids[2]});assert.equal(studio.plan,ids[2]);assert.ok(Math.abs(studio.premium_until_ms-Date.now()-44*86400000)<3000);
 console.log('PASS: AbacatePay four prices, Google ownership, terms, duplicate checkout, webhook/status races, amount/environment rejection and upgrades.');
} finally {globalThis.fetch=originalFetch;}
