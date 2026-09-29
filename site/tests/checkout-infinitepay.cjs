const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../pagamento.js'),'utf8');
const ids=['world1','ouro','diamante','vip7','vip30','creator'];
const plans=Object.fromEntries(ids.map((id,i)=>[id,{id,label:id,price_cents:[599,1499,2290,799,2490,3990][i],kind:i<3?'world_credit':'time',credit_count:[1,3,5,0,0,0][i],max_file_mb:500,max_batch:20,duration_days:i<3?0:7}]));
const settle=()=>new Promise(r=>setTimeout(r,15));
(async()=>{
 for(const id of ids){
  const dom=new JSDOM('<body><div id="box"></div></body>',{url:'https://app.example',runScripts:'outside-only'});
  const w=dom.window,requests=[],popup={location:{href:''},close(){this.closed=true;}};
  let rejectCheckout=false;
  w.RC_CONFIG={PAYMENT_PROVIDER:'infinitepay',DEPIX_ENABLED:true,WORKER_URL:'https://api.example'};
  w.RC_auth={user:()=>({uid:'buyer',email:'buyer@example.com'}),getToken:()=>Promise.resolve('token')};
  w.RC_entitlements={refresh:()=>Promise.resolve({active:false})};
  w.open=()=>popup;
  w.fetch=async(url,opts={})=>{
   requests.push({url,opts});
   let payload={};
   if(url.endsWith('/api/config'))payload={plans,infinitepay_configured:true,sales_enabled:true};
   if(url.endsWith('/api/infinitepay/create')){
    if(rejectCheckout)return {ok:false,status:502,text:async()=>JSON.stringify({error:'Indisponível para teste'})};
    payload={id:'fixture-order',url:'https://checkout.infinitepay.com.br/fixture'};
   }
   return {ok:true,status:200,text:async()=>JSON.stringify(payload),json:async()=>payload};
  };
  w.eval(source);await w.RC_pay.planCatalog();
  w.RC_pay.checkout(id,null,{preserve_context:true});await settle();
  const doc=w.document;
  assert.equal(doc.querySelector('input[name="payplan"]:checked').value,id);
  assert.equal(doc.querySelector('.pay-form-grid').hidden,true,'legacy CPF/email fields hidden');
  assert.match(doc.getElementById('payMethodBadge').textContent,/InfinitePay/i);
  doc.getElementById('payGo').click();await settle();
  assert.equal(requests.filter(r=>r.url.endsWith('/create')).length,0,'terms required');
  doc.getElementById('payTerms').checked=true;
  rejectCheckout=true;doc.getElementById('payGo').click();await settle();
  assert.equal(doc.getElementById('payGo').disabled,false,'failure restores button without undefined handlers');
  assert.match(doc.getElementById('payMsg').textContent,/Indisponível/);
  rejectCheckout=false;doc.getElementById('payGo').click();await settle();
  const create=requests.filter(r=>r.url.endsWith('/create'));
  assert.ok(create.every(r=>r.url.endsWith('/api/infinitepay/create')),'no Depix/Abacate fallback');
  assert.equal(JSON.parse(create[0].opts.body).plan,id);
  assert.equal(JSON.parse(create[0].opts.body).request_id,JSON.parse(create[1].opts.body).request_id,'stable request ID after retry');
  assert.equal(popup.location.href,'https://checkout.infinitepay.com.br/fixture');
  dom.window.close();
 }
 console.log('PASS: all plan buttons route to InfinitePay, terms, hidden legacy fields, checkout error/retry, preserved editor tab.');
})().catch(e=>{console.error(e);process.exitCode=1;});
