const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..'),assets=fs.existsSync(path.join(root,'public'))?'public':'site',source=fs.readFileSync(path.join(root,assets,'pagamento.js'),'utf8');
(async()=>{
 for(const scenario of [
  {query:'?checkout_id=checkout_v4',billing:'',depix:'chk_old',expected:'/api/abacate/status?id=checkout_v4'},
  {query:'',billing:'checkout_saved',depix:'chk_old',expected:'/api/abacate/status?id=checkout_saved'},
  {query:'?id=chk_legacy',billing:'checkout_saved',depix:'',expected:'/api/depix/status?id=chk_legacy'}
 ]){
  const d=new JSDOM('<div id="box"></div>',{url:'https://worldify.com.br/sucesso.html'+scenario.query,runScripts:'outside-only'}),w=d.window,requests=[];
  w.RC_CONFIG={WORKER_URL:'https://api.test',PAYMENT_PROVIDER:'abacate'};w.RC_auth={user:()=>({email:'fixture@example.test'}),getToken:async()=> 'fixture'};
  w.localStorage.setItem('rc_pending_billing',scenario.billing);w.localStorage.setItem('rc_pending_depix',scenario.depix);
  w.fetch=async(url)=>{requests.push(url);return new Response(JSON.stringify({paid:false,status:'PENDING'}));};w.eval(source);await w.RC_pay.checkReturn();assert.ok(requests.some(url=>url.endsWith(scenario.expected)),scenario.expected);assert.match(w.document.getElementById('box').textContent,/ainda não confirmado/);w.close();
 }
 console.log('PASS: AbacatePay callback ID, saved checkout recovery and legacy Depix callback route.');
})().catch(e=>{console.error(e);process.exitCode=1;});
