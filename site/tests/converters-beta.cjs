const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const JSZip=require('../vendor/jszip.min.js');global.window=global;global.JSZip=JSZip;
for(const file of ['nbt-bedrock.js','builder-config.js','builder-transform.js','builder-core.js','java-structure.js','converters-beta.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{filename:file});
// An independent big-endian Java fixture, crossing long boundaries (3 bits / block).
const str=s=>{const b=Buffer.from(s),n=Buffer.alloc(2);n.writeUInt16BE(b.length);return Buffer.concat([n,b]);};
const i32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
const named=(t,n,b)=>Buffer.concat([Buffer.from([t]),str(n),b]);
const cmp=entries=>Buffer.concat([...entries,Buffer.from([0])]);
const integer=(n,v)=>named(3,n,i32(v));
const names=['minecraft:air','minecraft:stone','minecraft:dirt','minecraft:glass','minecraft:diamond_block'];
const sx=4,sy=3,sz=7,volume=sx*sy*sz,values=Array.from({length:volume},(_,i)=>i%names.length),words=Array(Math.ceil(volume*3/64)).fill(0n);
values.forEach((v,i)=>{const bit=i*3,w=Math.floor(bit/64),shift=bit%64;words[w]|=BigInt(v)<<BigInt(shift);if(shift+3>64)words[w+1]|=BigInt(v)>>BigInt(64-shift);});
function fixture({negative=false,complex=false,invalid=false}={}){const longs=Buffer.concat(words.map(w=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt.asUintN(64,w));return b;}));const palette=names.map((name,i)=>cmp([named(8,'Name',str(complex&&i===2?'minecraft:chest':name))]));const region=cmp([named(10,'Size',cmp([integer('x',negative?-sx:sx),integer('y',sy),integer('z',sz)])),named(9,'BlockStatePalette',Buffer.concat([Buffer.from([10]),i32(names.length),...palette])),named(12,'BlockStates',Buffer.concat([i32(invalid?0:words.length),invalid?Buffer.alloc(0):longs]))]);return named(10,'',cmp([named(10,'Regions',cmp([named(10,'Region',region)]))]));}
(async()=>{
 const raw=fixture(),file=new File([zlib.gzipSync(raw)],'fixture.litematic'),model=await RC_javaStructure.parse(file),bytes=WF_converters.encodeStructure(model),round=RC_builderCore.parseStructure(bytes);
 assert.deepEqual(round.size,[sx,sy,sz]);
 for(let y=0;y<sy;y++)for(let z=0;z<sz;z++)for(let x=0;x<sx;x++){const expected=names[values[(y*sz+z)*sx+x]],b=round.blocks.find(b=>b.x===x&&b.y===y&&b.z===z);if(expected==='minecraft:air')assert.equal(b,undefined);else assert.equal(b.block.name,expected,`position ${x},${y},${z}`);}
 for(const [options,pattern] of [[{negative:true},/eixos positivos/],[{complex:true},/conversão segura/],[{invalid:true},/incompletos/]])await assert.rejects(()=>RC_javaStructure.parse(new File([fixture(options)],'bad.litematic')),pattern);
 const pack=new JSZip(),manifest={format_version:2,header:{uuid:'fixture-pack',name:'Fixture',version:[1,0,0]},modules:[{type:'data',uuid:'fixture-module',version:[1,0,0]}],dependencies:[{uuid:'other',version:[1,0,0]}]};pack.file('manifest.json',JSON.stringify(manifest));pack.file('textures/test.png',Buffer.from([1,2,3,4]));
 const outer=new JSZip();outer.file('nested.mcpack',await pack.generateAsync({type:'uint8array'}));const result=await WF_converters.prepareAddon(new File([await outer.generateAsync({type:'uint8array'})],'fixture.mcaddon'));
 const out=await JSZip.loadAsync(await result.blob.arrayBuffer()),nested=await JSZip.loadAsync(await out.file('nested.mcpack').async('uint8array')),converted=JSON.parse(await nested.file('manifest.json').async('string'));
 assert.equal(converted.metadata.product_type,'addon');assert.deepEqual(converted.dependencies,manifest.dependencies);assert.deepEqual(Buffer.from(await nested.file('textures/test.png').async('uint8array')),Buffer.from([1,2,3,4]));assert.match(result.name,/\.mcaddon$/);
 const invalid=new JSZip();invalid.file('../manifest.json',JSON.stringify(manifest));const invalidBytes=await invalid.generateAsync({type:'uint8array'});await assert.rejects(()=>WF_converters.prepareAddon(new File([invalidBytes],'bad.mcaddon')),/caminho/);
 console.log('PASS: GZIP Litematic to Bedrock roundtrip, asymmetric coordinates, packed-long boundaries, conservative refusal, nested addon manifests, untouched dependencies/assets and unsafe path rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
