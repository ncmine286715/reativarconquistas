const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JSZip = require('../vendor/jszip.min.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../addon-utility.js'), 'utf8');
const manifest = JSON.stringify({format_version:2,header:{name:'Example',uuid:'abc',version:[1,0,0]},modules:[{type:'resources',uuid:'def',version:[1,0,0]}]});
async function run(name, archive, authors) {
  let click, saved;
  const elements = {
    addonUtilityFile:{files:[]}, addonAuthors:{value:authors},
    addonUtilityRun:{disabled:false,addEventListener(_,fn){click=fn}},
    addonUtilityStatus:{textContent:''}
  };
  const bytes = await archive.generateAsync({type:'uint8array'});
  bytes.name = name; bytes.size = bytes.length; elements.addonUtilityFile.files=[bytes];
  const context={JSZip,Promise,setTimeout(fn,ms){return setTimeout(fn,Math.min(ms,5))},URL:{createObjectURL(blob){saved=blob;return 'blob:test'},revokeObjectURL(){}},document:{getElementById(id){return elements[id]},body:{appendChild(){}},createElement(){return {click(){},remove(){}}}}};
  vm.runInNewContext(source,context);
  click();
  for(let i=0;i<200 && elements.addonUtilityRun.disabled;i++) await new Promise(r=>setTimeout(r,5));
  return {status:elements.addonUtilityStatus.textContent,blob:saved};
}
(async()=>{
  const zip=new JSZip(); zip.file('pack/manifest.json',manifest);zip.file('pack/textures/a.txt','data');
  const out=await run('pack.zip',zip,'NCMINE, Ana');
  assert.ok(out.blob,out.status);
  const result=await JSZip.loadAsync(await out.blob.arrayBuffer());
  assert.deepEqual(JSON.parse(await result.file('manifest.json').async('string')).metadata.authors,['NCMINE','Ana']);
  assert.equal(await result.file('textures/a.txt').async('string'),'data');
  const bundle=new JSZip();bundle.file('packs/sample.mcpack',await zip.generateAsync({type:'uint8array'}));
  const combined=await run('bundle.mcaddon',bundle,'Maker');
  assert.ok(combined.blob,combined.status);
  const outer=await JSZip.loadAsync(await combined.blob.arrayBuffer());
  const inner=await JSZip.loadAsync(await outer.file('packs/sample.mcpack').async('uint8array'));
  assert.deepEqual(JSON.parse(await inner.file('manifest.json').async('string')).metadata.authors,['Maker']);
  const invalid=new JSZip();invalid.file('readme.txt','hello');
  const rejected=await run('invalid.zip',invalid,'');
  assert.equal(rejected.blob,undefined);
  assert.match(rejected.status,/manifest.json/);
  console.log('PASS: ZIP pack normalization, author metadata, asset preservation and invalid pack rejection.');
})().catch(e=>{console.error(e);process.exitCode=1});
