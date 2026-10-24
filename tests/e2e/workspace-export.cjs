/* E2E do shell do editor: carrega um mundo, confere o shell, exporta pelo painel Exportar e
   compara o arquivo gerado com o original (só level.dat pode mudar).
   BASE_URL=https://worldify.com.br roda contra produção (consome a cota grátis do IP). Requer playwright-core e um Chromium: PLAYWRIGHT_CORE=<pasta do playwright-core> CHROME=<chrome.exe>. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const JSZip=require('../../site/vendor/jszip.min.js');
const {chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core');
const site=path.resolve(__dirname,'../../site'),world=path.join(site,'tests/preview-world.mcworld');
const T={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.json':'application/json'};
(async()=>{
 const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(site,u);fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end()}r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});r.end(d)})});
 await new Promise(r=>srv.listen(0,r));const base=process.env.BASE_URL||('http://localhost:'+srv.address().port);
 const b=await chromium.launch({executablePath:process.env.CHROME});
 try{
  const ctx=await b.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/index.html');await p.addStyleTag({content:'.rc-consent{display:none!important}'});
  assert.equal(await p.evaluate(()=>document.getElementById('form').classList.contains('wf-ws-on')),false,'shell off sem mundo');
  await p.setInputFiles('#filex',world);await p.waitForFunction(()=>document.getElementById('form').classList.contains('wf-ws-on'),null,{timeout:20000});
  const tools=await p.evaluate(()=>[...document.querySelectorAll('.wf-editor-tool')].map(b=>b.textContent.trim()));
  for(const t of ['Conquistas','Mundo','Regras','Jogador','Add-ons','Chunks','Diagnóstico','Exportar'])assert.ok(tools.includes(t),'ferramenta '+t);
  assert.ok(tools.some(t=>/World Studio/.test(t)),'World Studio');
  await p.evaluate(()=>window.WF_editor.open('wfExport'));
  assert.equal(await p.evaluate(()=>document.getElementById('submit').disabled),true,'download bloqueado até aceitar os termos');
  await p.evaluate(()=>{const a=document.getElementById('accept');a.checked=true;a.dispatchEvent(new Event('change',{bubbles:true}))});
  const dl=p.waitForEvent('download',{timeout:60000});await p.click('#submit');const d=await dl;
  const out=path.join(os.tmpdir(),'wf-export-'+Date.now()+'.mcworld');await d.saveAs(out);
  const A=await JSZip.loadAsync(fs.readFileSync(world)),B=await JSZip.loadAsync(fs.readFileSync(out));
  const names=z=>Object.keys(z.files).filter(n=>!z.files[n].dir).sort();
  assert.deepEqual(names(B),names(A),'mesma lista de arquivos');
  const changed=[];for(const n of names(A)){const x=await A.file(n).async('uint8array'),y=await B.file(n).async('uint8array');if(Buffer.compare(Buffer.from(x),Buffer.from(y)))changed.push(n)}
  assert.deepEqual(changed,['level.dat'],'somente level.dat muda');
  assert.deepEqual(errors,[],'sem erros de página');
  fs.unlinkSync(out);
  console.log('PASS: shell do editor, exportação pelo painel e integridade (só level.dat alterado).');
 } finally{await b.close();srv.close()}
})().catch(e=>{console.error(e);process.exit(1)});
