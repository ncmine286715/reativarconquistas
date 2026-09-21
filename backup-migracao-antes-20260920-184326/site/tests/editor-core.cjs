// Run from site/: node tests/editor-core.cjs (Node 18+).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = path.resolve(__dirname, '..');
global.window = global;
global.document = {readyState:'loading',addEventListener(){},getElementById(){return null;}};
global.localStorage = {getItem(){return null;},setItem(){}};
global.JSZip = require(path.join(site,'vendor/jszip.min.js'));
const zipLoad = JSZip.loadAsync;
JSZip.loadAsync = async function(input) {
  return zipLoad.call(this, input instanceof Blob ? await input.arrayBuffer() : input);
};
for(const file of ['vendor/leveldb-reader.js','nbt-bedrock.js','leveldb-write.js','db-common.js','chunks.js'])
  vm.runInThisContext(fs.readFileSync(path.join(site,file),'utf8'), {filename:file});
const bytes = s => new TextEncoder().encode(s);
function chunk(x,z,tag,sub) {const b=new Uint8Array(sub===undefined?9:10);const v=new DataView(b.buffer);v.setInt32(0,x,true);v.setInt32(4,z,true);b[8]=tag;if(sub!==undefined)v.setInt8(9,sub);return b;}
function manifest(log,next,seq){return RC_ldbw.framePayload(Uint8Array.from([2,...RC_ldbw.encVarint(log),3,...RC_ldbw.encVarint(next),4,...RC_ldbw.encVarint(seq)]),0).bytes;}
(async()=>{
  const N=RC_nbt2, player=N.encodeNamed(N.N(10,'',N.compound({PlayerLevel:N.N(3,'PlayerLevel',9)})));
  const id=Uint8Array.from([1,2,3,4,5,6,7,8]), digp=new Uint8Array(12);digp.set(bytes('digp'));new DataView(digp.buffer).setInt32(4,2,true);new DataView(digp.buffer).setInt32(8,3,true);
  const actor=new Uint8Array(19);actor.set(bytes('actorprefix'));actor.set(id,11);
  const ops=[{t:'put',k:bytes('~local_player'),v:player},{t:'put',k:chunk(2,3,44),v:Uint8Array.of(40)},{t:'put',k:chunk(2,3,47,-4),v:Uint8Array.of(9,0)},{t:'put',k:chunk(-2,5,44),v:Uint8Array.of(40)},{t:'put',k:digp,v:id},{t:'put',k:actor,v:player}];
  const zip=new JSZip();zip.file('world/db/CURRENT','MANIFEST-000001\n');zip.file('world/db/MANIFEST-000001',manifest(2,3,0));zip.file('world/db/000002.log',RC_ldbw.framePayload(RC_ldbw.buildBatch(ops,2**32+10),0).bytes);
  const original=await zip.generateAsync({type:'blob'}),d=await RC_dbx.openWorld(original);
  assert.equal(d.lastSeq,2**32+15,'sequence includes the WAL, even with an older manifest');
  assert.equal(RC_dbx.parseChunkKey(chunk(2,3,47,-4)).sub,-4);
  RC_sel.add('0:2,3');const result=await RC_reset.applyToBlob(original);const after=await RC_dbx.openFromBlob(result.blob);
  assert.equal(result.delCount,4,'chunk records, digp and its actor are removed');
  assert.equal(after.keys.get(String.fromCharCode(...actor)),false);
  assert.deepEqual(after.keys.get('~local_player').value,player);
  assert.ok(after.keys.get(String.fromCharCode(...chunk(-2,5,44))),'unselected chunk survives');
  const updated=await RC_dbx.openWorld(result.blob);assert.equal(updated.logNumber,2,'retain every pending WAL for Minecraft recovery');
  const second=RC_ldbw.buildDbUpdate({...updated,ops:[{t:'put',k:bytes('test'),v:Uint8Array.of(1)}]});
  assert.equal(Number(new DataView(second.logBytes.buffer).getBigUint64(7,true)),updated.lastSeq+1);
  assert.ok(second.logName.startsWith('world/db/'));
  const out=await RC_dbx.assemble(updated,second.newManifestBytes,second.logName,second.logBytes);
  const reread=await RC_dbx.openFromBlob(out);assert.equal(reread.keys.get('test').value[0],1);assert.deepEqual(reread.keys.get('~local_player').value,player);
  console.log('PASS: chunk deletion, actor ownership, untouched records, nested paths, WAL recovery and 64-bit sequences.');
})().catch(e=>{console.error(e);process.exitCode=1;});
