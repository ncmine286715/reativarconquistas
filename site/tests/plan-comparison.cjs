const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const intents = require('../tool-intents.js');
const root = path.resolve(__dirname,'..');
const source = file => fs.readFileSync(path.join(root,file),'utf8');
const real = JSON.parse(fs.readFileSync(path.join(__dirname,'plan-catalog-live.json'),'utf8').replace(/^\uFEFF/,''));
assert.deepEqual(intents.catalogIds(real),['world1','worlds2v1','vip7','vip30']);
assert.equal(intents.includesStudio(real.plans.vip7),true);
assert.equal(intents.includesStudio(real.plans.world1),false);
assert.deepEqual(intents.catalogIds({...real,display_plan_ids:['missing','vip7','vip7']}),['vip7']);
assert.deepEqual(intents.catalogIds({plans:{}}),[]);
assert.deepEqual(intents.eligiblePlanIds(intents.catalogIds(real),real.plans,{tool:'studio'}),['vip7','vip30']);
assert.deepEqual(intents.eligiblePlanIds(intents.catalogIds(real),real.plans,{world_size_bytes:501*1048576}),['vip30']);
assert.equal(intents.choosePlan(intents.catalogIds(real),'',real.plans,{goal:'several'}),'vip7');
assert.equal(intents.choosePlan(intents.catalogIds(real),'',real.plans,{goal:'continuous'}),'vip30');
assert.equal(intents.choosePlan(intents.catalogIds(real),'worlds2v1',real.plans,{goal:'several'}),'worlds2v1','explicit selection wins');
async function check(config) {
 const dom = new JSDOM(source('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://fixture.test/index.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.RC_CONFIG={WORKER_URL:'https://fixture.test'};
 w.RC_auth={user:()=>({uid:'test',email:'fixture@example.test'}),getToken:()=>Promise.resolve('test')};
 w.matchMedia=()=>({matches:false}); w.alert=()=>{};
 w.fetch=async()=>new Response(JSON.stringify(config));
 try {
  w.eval(source('tool-intents.js')); w.eval(source('pagamento.js'));
  await w.RC_pay.planCatalog();
  const ids=intents.catalogIds(config);
  assert.deepEqual(Array.from(w.document.querySelectorAll('.wf-plan-slot:not([hidden]) [data-pay]')).map(x=>x.dataset.pay),ids);
  assert.equal(w.document.querySelectorAll('#planComparison thead th').length,ids.length+1);
  for(const id of ids) {
   w.RC_pay.openPayModal('',id,{source:'pricing_card'});
   assert.equal(w.document.querySelector('#payModal [name=payplan]:checked').value,id);
   const price='R$ '+(config.plans[id].price_cents/100).toFixed(2).replace('.',',');
   assert.equal(w.document.getElementById('payPlanPrice').textContent,price);
   assert.match(w.document.getElementById('payGo').textContent,new RegExp(price.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
   assert.match(w.document.getElementById('paySub').textContent,intents.includesStudio(config.plans[id]) ? /[Ii]nclui World Studio/ : /não inclui World Studio|não incluído/);
  }
  w.document.getElementById('planGoal').value='studio';w.document.getElementById('planGoal').dispatchEvent(new w.Event('change'));
  assert.match(w.document.getElementById('planAdvice').textContent,/[Ii]nclui World Studio/);
  w.RC_pay.openPayModal('','world1',{tool:'studio'});
  assert.equal(w.document.querySelector('#payModal [value=world1]'),null);
  await new Promise(resolve=>setTimeout(resolve,30));
  return dom;
 } catch(error) {dom.window.close();throw error;}
}
(async()=>{
 (await check(real)).window.close();
 const empty=new JSDOM(source('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://fixture.test',runScripts:'outside-only'});
 empty.window.fetch=async()=>new Response(JSON.stringify({plans:{}}));empty.window.eval(source('tool-intents.js'));empty.window.eval(source('pagamento.js'));
 await assert.rejects(empty.window.RC_pay.planCatalog());
 assert.ok(Array.from(empty.window.document.querySelectorAll('.wf-plan-slot [data-pay]')).every(x=>x.disabled));empty.window.close();
 console.log('PASS: live four-plan catalog, missing IDs, Studio, comparison, recommendations and checkout prices.');
})().catch(e=>{console.error(e);process.exitCode=1;});
