const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../pagamento.js'),'utf8');
const ids=['world1','worlds2v1','vip7','vip30'];
const plans=Object.fromEntries(ids.map((id,i)=>[id,{id,label:id,price_cents:[599,1190,799,2490][i],kind:i<2?'world_credit':'time',credit_count:[1,2,0,0][i],max_file_mb:500,max_file_bytes:500*1048576,allowed_tools:["convert","builder","world_paint"],max_batch:20,duration_days:i<2?0:7}]));
const settle=()=>new Promise(r=>setTimeout(r,15));
(async()=>{
 for(const id of ids){
  const dom=new JSDOM('<body><div id="box"></div></body>',{url:'https://app.example',runScripts:'outside-only'});
  const w=dom.window,requests=[],popup={location:{href:''},close(){this.closed=true;}};
  let rejectCheckout=false, expiredOnce=false;
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
    if(expiredOnce){expiredOnce=false;return {ok:false,status:409,text:async()=>JSON.stringify({error:'Link anterior expirou',code:'CHECKOUT_EXPIRED'})};}
    payload={id:'fixture-order',url:'https://checkout.infinitepay.com.br/fixture'};
   }
   return {ok:true,status:200,text:async()=>JSON.stringify(payload),json:async()=>payload};
  };
  w.eval(fs.readFileSync(path.join(__dirname,'../tool-intents.js'),'utf8'));w.eval(source);assert.equal(typeof w.RC_pay.completeOperation,'function');assert.equal(typeof w.RC_pay.releaseOperation,'function');await w.RC_pay.planCatalog();
  w.RC_pay.checkout(id,null,{preserve_context:true});await settle();
  const doc=w.document;
  assert.equal(doc.querySelector('input[name="payplan"]:checked').value,id);
  assert.equal(doc.querySelector('.pay-form-grid').hidden,true,'legacy CPF/email fields hidden');
  assert.match(doc.getElementById('payMethodBadge').textContent,/PIX OU CARTÃO/i);
  assert.match(doc.getElementById('payIntroText').textContent,/InfinitePay/i);
  doc.getElementById('payGo').click();await settle();
  assert.equal(requests.filter(r=>r.url.endsWith('/create')).length,0,'terms required');
  doc.getElementById('payTerms').checked=true;
  rejectCheckout=true;doc.getElementById('payGo').click();await settle();
  assert.equal(doc.getElementById('payGo').disabled,false,'failure restores button without undefined handlers');
  assert.match(doc.getElementById('payMsg').textContent,/Indisponível/);
  rejectCheckout=false;expiredOnce=id==='world1';
  w.RC_entitlements.refresh=()=>Promise.reject(new Error('Legacy benefits provider unavailable'));
  doc.getElementById('payGo').click();await settle();
  const create=requests.filter(r=>r.url.endsWith('/create'));
  assert.ok(create.every(r=>r.url.endsWith('/api/infinitepay/create')),'no Depix/Abacate fallback');
  assert.equal(JSON.parse(create[0].opts.body).plan,id);
  assert.equal(JSON.parse(create[0].opts.body).request_id,JSON.parse(create[1].opts.body).request_id,'stable request ID after retry');
  if(id==='world1')assert.notEqual(JSON.parse(create[1].opts.body).request_id,JSON.parse(create[2].opts.body).request_id,'only an explicitly expired request is renewed');
  assert.equal(popup.location.href,'https://checkout.infinitepay.com.br/fixture');
  dom.window.close();
 }
 console.log('PASS: all plan buttons route to InfinitePay, terms, hidden legacy fields, checkout error/retry, preserved editor tab.');
})().catch(e=>{console.error(e);process.exitCode=1;});
