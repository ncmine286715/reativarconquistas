const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
global.window=global;
global.JSZip=require(path.join(root,'vendor/jszip.min.js'));
const load=JSZip.loadAsync;
JSZip.loadAsync=async function(input){return load.call(this,input instanceof Blob?await input.arrayBuffer():input);};
for(const f of ['converter.js','world-format.js'])vm.runInThisContext(fs.readFileSync(path.join(root,f),'utf8'));
const rules=['falldamage','firedamage','drowningdamage','dofiretick','tntexplodes','domobspawning','domobloot','dotiledrops','doinsomnia','showdeathmessages'];
function byte(name,value){const n=Buffer.from(name);return Buffer.concat([Buffer.from([1,n.length,0]),n,Buffer.from([value])]);}
const body=Buffer.concat([Buffer.from([10,0,0]),...rules.map(r=>byte(r,1)),byte('FutureFlag',17),Buffer.from([0])]);
const header=Buffer.alloc(8);header.writeInt32LE(10);header.writeInt32LE(body.length,4);
const level=Buffer.concat([header,body]);
async function archive(prefix='',extra=false){let z=new JSZip();z.file(prefix+'level.dat',level);z.file(prefix+'db/CURRENT','MANIFEST-000001\n');z.file(prefix+'db/data.ldb',Buffer.alloc(1024*1024,42));z.file(prefix+'behavior_packs/addon/manifest.json','{"format_version":2}');if(extra){z.file('manifest.json','{}');z.file('texts/en_US.lang','template.name=Test');}return z.generateAsync({type:'uint8array',compression:'DEFLATE'});}
(async()=>{
 const nativeLong = DataView.prototype.getBigInt64;
 try {
  DataView.prototype.getBigInt64 = undefined;
  for (const value of [0n, 9223372036854775807n, -9223372036854775808n, -1234567890123456789n]) {
   const n=Buffer.alloc(8);n.writeBigInt64LE(value);
   const hits={};RC_nbt.walkCollect(Buffer.concat([Buffer.from([10,0,0,4,4,0]),Buffer.from('Seed'),n,Buffer.from([0])]),hits);
   assert.equal(hits.Seed[0].val,String(value),'exact seed on browsers without getBigInt64');
  }
 } finally { DataView.prototype.getBigInt64 = nativeLong; }
 for(const extension of ['mctemplate','mctemplet']) for(const prefix of ['', 'world_template/']) {
  const input=new File([await archive(prefix,true)],'modelo.'+extension);
  const normalized=await RC_worldFormat.normalize(input);
  assert.equal(normalized.name,'modelo.mcworld');
  const z=await JSZip.loadAsync(normalized);
  assert.ok(z.file('level.dat'));assert.ok(z.file('db/CURRENT'));
  assert.equal(z.file('manifest.json'),null);assert.equal(z.file('texts/en_US.lang'),null);
  assert.ok(z.file('behavior_packs/addon/manifest.json'),'nested pack manifests survive');
  assert.equal((await z.file('db/data.ldb').async('uint8array')).length,1024*1024);
 }
 const multi=new JSZip();multi.file('a/level.dat',level);multi.file('b/level.dat',level);
 const multiBytes=await multi.generateAsync({type:'uint8array'});
 await assert.rejects(()=>RC_worldFormat.normalize(new File([multiBytes],'bad.mctemplate')),/exatamente um mundo/);
 const invalid=new JSZip();invalid.file('../level.dat',level);
 const invalidBytes=await invalid.generateAsync({type:'uint8array'});
 await assert.rejects(()=>RC_worldFormat.normalize(new File([invalidBytes],'bad.mctemplate')),/caminho/);
 const input=await archive();
 const out=await RC_convert(input,{reactivateAchievements:false,gameMode:'keep',rules:Object.fromEntries(rules.map(r=>[r,0]))});
 const zout=await JSZip.loadAsync(out.blob),raw=await zout.file('level.dat').async('uint8array');
 const hits={};RC_nbt.walkCollect(RC_nbt.splitLevelDat(raw).body,hits);
 for(const rule of rules) assert.equal(hits[rule][0].val,0,rule+' is applied');
 assert.equal(hits.FutureFlag[0].val,17,'unknown tag is untouched');
 assert.deepEqual(await zout.file('db/data.ldb').async('uint8array'),new Uint8Array(1024*1024).fill(42),'database bytes survive compressed entry reuse');
 const kept=await RC_convert(input,{reactivateAchievements:false,gameMode:'keep',rules:Object.fromEntries(rules.map(r=>[r,null]))});
 const originalZip=await JSZip.loadAsync(kept.blob);
 assert.deepEqual(Buffer.from(await originalZip.file('level.dat').async('uint8array')),level,'all maintain options preserve original level.dat');
 console.log('PASS: both template spellings, nested/root templates, traversal/multiple-world rejection, ten rule edits, no-op preservation and 1MB compressed database round-trip.');
})().catch(e=>{console.error(e);process.exitCode=1;});
