// Builder core integration test: synthetic .mcstructure -> existing v9 subchunk -> validated .mcworld.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = path.resolve(__dirname, '..');
global.window = global;
global.document = {readyState:'loading',addEventListener(){},getElementById(){return null;}};
global.localStorage = {getItem(){return null;},setItem(){}};
global.JSZip = require(path.join(site, 'vendor/jszip.min.js'));
const zipLoad = JSZip.loadAsync;
JSZip.loadAsync = async input => zipLoad.call(JSZip, input instanceof Blob ? await input.arrayBuffer() : input);
for (const file of ['vendor/leveldb-reader.js','nbt-bedrock.js','leveldb-write.js','db-common.js','builder-config.js','builder-transform.js','builder-core.js']) vm.runInThisContext(fs.readFileSync(path.join(site,file),'utf8'), {filename:file});
const bytes = s => new TextEncoder().encode(s);
function manifest(log,next,seq){return RC_ldbw.framePayload(Uint8Array.from([2,...RC_ldbw.encVarint(log),3,...RC_ldbw.encVarint(next),4,...RC_ldbw.encVarint(seq)]),0).bytes;}
function paletteEntry(name) {
  const N = RC_nbt2;
  const value = N.compound({name:N.N(N.T_STRING,'name',name),states:N.N(N.T_COMPOUND,'states',N.compound({})),version:N.N(N.T_INT,'version',17959425)});
  return {name,raw:N.encode({t:N.T_COMPOUND,n:'',v:value})};
}
function structureFile() {
  const N = RC_nbt2, stone = paletteEntry('minecraft:stone'), glass = paletteEntry('minecraft:glass');
  const palettes = [stone,glass].map(p => ({t:N.T_COMPOUND,n:'',v:RC_nbt2.parse(p.raw).root.v}));
  const primary = {t:N.T_LIST,n:'',v:N.listOf(N.T_INT,[0,1])};
  const root = N.compound({
    format_version:N.N(N.T_INT,'format_version',1),
    size:N.N(N.T_LIST,'size',N.listOf(N.T_INT,[2,1,1])),
    structure:N.N(N.T_COMPOUND,'structure',N.compound({
      block_indices:N.N(N.T_LIST,'block_indices',N.listOf(N.T_LIST,[primary])),
      entities:N.N(N.T_LIST,'entities',N.listOf(N.T_COMPOUND,[])),
      palette:N.N(N.T_COMPOUND,'palette',N.compound({default:N.N(N.T_COMPOUND,'default',N.compound({
        block_palette:N.N(N.T_LIST,'block_palette',N.listOf(N.T_COMPOUND,palettes)),
        block_position_data:N.N(N.T_COMPOUND,'block_position_data',N.compound({}))
      }))}))
    }))
  });
  return N.encode({t:N.T_COMPOUND,n:'',v:root});
}
function indexedStructureFile() {
  const N = RC_nbt2, stone = paletteEntry('minecraft:stone'), glass = paletteEntry('minecraft:glass');
  const palette = [stone,glass].map(p => ({t:N.T_COMPOUND,n:'',v:RC_nbt2.parse(p.raw).root.v}));
  const root = N.compound({
    format_version:N.N(N.T_INT,'format_version',1), size:N.N(N.T_LIST,'size',N.listOf(N.T_INT,[2,2,3])),
    structure:N.N(N.T_COMPOUND,'structure',N.compound({
      block_indices:N.N(N.T_LIST,'block_indices',N.listOf(N.T_LIST,[{t:N.T_LIST,n:'',v:N.listOf(N.T_INT,Array.from({length:12},(_,i)=>i%2))}])),
      entities:N.N(N.T_LIST,'entities',N.listOf(N.T_COMPOUND,[])),
      palette:N.N(N.T_COMPOUND,'palette',N.compound({default:N.N(N.T_COMPOUND,'default',N.compound({block_palette:N.N(N.T_LIST,'block_palette',N.listOf(N.T_COMPOUND,palette)),block_position_data:N.N(N.T_COMPOUND,'block_position_data',N.compound({}))}))}))
    }))
  });
  return N.encode({t:N.T_COMPOUND,n:'',v:root});
}
function directionalStructureFile() {
  const N = RC_nbt2;
  const chest = RC_nbt2.parse(paletteEntry('minecraft:chest').raw).root;
  chest.v.map.states = N.N(N.T_COMPOUND,'states',N.compound({facing_direction:N.N(N.T_INT,'facing_direction',2)}));
  const stairs = RC_nbt2.parse(paletteEntry('minecraft:oak_stairs').raw).root;
  stairs.v.map.states = N.N(N.T_COMPOUND,'states',N.compound({weirdo_direction:N.N(N.T_INT,'weirdo_direction',3),upside_down_bit:N.N(N.T_BYTE,'upside_down_bit',0)}));
  const root = N.compound({
    format_version:N.N(N.T_INT,'format_version',1), size:N.N(N.T_LIST,'size',N.listOf(N.T_INT,[2,1,1])),
    structure:N.N(N.T_COMPOUND,'structure',N.compound({
      block_indices:N.N(N.T_LIST,'block_indices',N.listOf(N.T_LIST,[{t:N.T_LIST,n:'',v:N.listOf(N.T_INT,[0,1])}])),
      entities:N.N(N.T_LIST,'entities',N.listOf(N.T_COMPOUND,[])),
      palette:N.N(N.T_COMPOUND,'palette',N.compound({default:N.N(N.T_COMPOUND,'default',N.compound({
        block_palette:N.N(N.T_LIST,'block_palette',N.listOf(N.T_COMPOUND,[chest,stairs])), block_position_data:N.N(N.T_COMPOUND,'block_position_data',N.compound({}))
      }))}))
    }))
  });
  return N.encode({t:N.T_COMPOUND,n:'',v:root});
}
(async()=>{
  const T = RC_builderTransform;
  assert.deepEqual(T.size([2, 3, 4], 90), [4, 3, 2]);
  assert.deepEqual(T.world({x:0,y:2,z:0}, [2,3,4], {x:10,y:20,z:30}, 90), {x:13,y:22,z:30});
  assert.deepEqual(T.world({x:0,y:2,z:0}, [2,3,4], {x:10,y:20,z:30}, 180), {x:11,y:22,z:33});
  assert.deepEqual(T.world({x:1,y:2,z:3}, [2,3,4], {x:10,y:20,z:30}, 270), {x:13,y:22,z:30});
  const directional = RC_nbt2.parse(paletteEntry('minecraft:chest').raw).root;
  directional.v.map.states = RC_nbt2.N(RC_nbt2.T_COMPOUND, 'states', RC_nbt2.compound({facing_direction:RC_nbt2.N(RC_nbt2.T_INT,'facing_direction',2)}));
  const rotatedDirectional = RC_nbt2.parse(T.rotateStates(directional, 90)).root;
  assert.equal(rotatedDirectional.v.map.states.v.map.facing_direction.v, 5, 'norte vira leste em 90 graus');
  const indexed = RC_builderCore.parseStructure(indexedStructureFile());
  assert.equal(indexed.blocks.find(b=>b.x===0&&b.y===0&&b.z===1).block.name,'minecraft:glass','índices mcstructure percorrem Z, Y e X');
  assert.equal(indexed.blocks.find(b=>b.x===1&&b.y===1&&b.z===2).block.name,'minecraft:glass');
  const air = paletteEntry('minecraft:air'), idx = new Uint16Array(4096);
  const sub = RC_builderCore.encodeSubchunk({version:9,prefix:Uint8Array.of(9,1,0),primary:{idx,palette:[air]},secondary:null});
  const key = RC_builderCore.subKey(0,0,0);
  const ops = [{t:'put',k:key,v:sub}];
  const zip = new JSZip();
  zip.file('world/db/CURRENT','MANIFEST-000001\n');
  zip.file('world/db/MANIFEST-000001',manifest(2,3,0));
  zip.file('world/db/000002.log',RC_ldbw.framePayload(RC_ldbw.buildBatch(ops,1),0).bytes);
  const world = await zip.generateAsync({type:'blob'});
  const result = await RC_builderCore.apply(world, structureFile(), {x:1,y:0,z:1,maxBlocks:10});
  assert.equal(result.build.ops.length,1);
  const after = await RC_dbx.openFromBlob(result.blob);
  let updated; after.keys.forEach(kv => { if(kv && kv !== false && RC_builderCore.eq(kv.keyBytes,key)) updated=kv.value; });
  const decoded = RC_builderCore.decodeSubchunk(updated);
  assert.equal(decoded.primary.palette[decoded.primary.idx[RC_builderCore.storageIndex(1,0,1)]].name,'minecraft:stone');
  assert.equal(decoded.primary.palette[decoded.primary.idx[RC_builderCore.storageIndex(2,0,1)]].name,'minecraft:glass');
  const rotated = await RC_builderCore.apply(world, directionalStructureFile(), {x:5,y:0,z:5,rotation:90,maxBlocks:10});
  const rotatedDb = await RC_dbx.openFromBlob(rotated.blob);
  let rotatedSub; rotatedDb.keys.forEach(kv => { if(kv && kv !== false && RC_builderCore.eq(kv.keyBytes,key)) rotatedSub=kv.value; });
  const rotatedDecoded = RC_builderCore.decodeSubchunk(rotatedSub);
  const chest = rotatedDecoded.primary.palette[rotatedDecoded.primary.idx[RC_builderCore.storageIndex(5,0,5)]];
  const stairs = rotatedDecoded.primary.palette[rotatedDecoded.primary.idx[RC_builderCore.storageIndex(5,0,6)]];
  assert.equal(chest.name,'minecraft:chest');
  assert.equal(RC_nbt2.parse(chest.raw).root.v.map.states.v.map.facing_direction.v,5,'a escrita usa a mesma rotação do preview');
  assert.equal(RC_nbt2.parse(stairs.raw).root.v.map.states.v.map.weirdo_direction.v,0,'estado de escada é rotacionado');
  const replaceResult = await RC_builderCore.apply(result.blob, structureFile(), {x:1,y:0,z:1,maxBlocks:10,mode:'ignore_air'});
  assert.equal(replaceResult.build.replaced,2,'ignorar ar mantém o terreno onde a estrutura é ar e substitui os blocos sólidos');
  const onlyAirResult = await RC_builderCore.apply(result.blob, structureFile(), {x:1,y:0,z:1,maxBlocks:10,mode:'only_air'});
  assert.equal(onlyAirResult.build.ops.length,0,'somente ar não regrava chunk quando todos os destinos estão ocupados');
  assert.equal(onlyAirResult.build.skipped,2);
  await assert.rejects(() => RC_builderCore.apply(world, structureFile(), {x:20,y:0,z:1,maxBlocks:10}), /ainda não foi carregada/);
  const high = await RC_builderCore.apply(world, structureFile(), {x:1,y:16,z:1,maxBlocks:10});
  assert.ok(high.build.createdSubchunks >= 1, 'céu acima do terreno vira subchunk de ar nova em vez de recusar');
  const highDb = await RC_dbx.openFromBlob(high.blob);
  const highKey = RC_builderCore.subKey(0,0,1);
  let highSub; highDb.keys.forEach(kv => { if(kv && kv !== false && RC_builderCore.eq(kv.keyBytes,highKey)) highSub=kv.value; });
  assert.ok(highSub, 'nova subchunk foi gravada no mundo');
  const highDecoded = RC_builderCore.decodeSubchunk(highSub);
  assert.equal(highDecoded.primary.palette[highDecoded.primary.idx[RC_builderCore.storageIndex(1,0,1)]].name,'minecraft:stone','bloco no céu é lido de volta');
  const logPal = paletteEntry('minecraft:oak_log');
  const logIdx = new Uint16Array(4096); logIdx[RC_builderCore.storageIndex(1,1,0)] = 1;
  const logSub = RC_builderCore.encodeSubchunk({version:8,prefix:Uint8Array.of(8,1),primary:{idx:logIdx,palette:[air,logPal]},secondary:null});
  const zip2 = new JSZip();
  zip2.file('world/db/CURRENT','MANIFEST-000001\n');
  zip2.file('world/db/MANIFEST-000001',manifest(2,3,0));
  zip2.file('world/db/000002.log',RC_ldbw.framePayload(RC_ldbw.buildBatch([{t:'put',k:RC_builderCore.subKey(0,0,0),v:logSub}],1),0).bytes);
  const db2 = await RC_dbx.openFromBlob(await zip2.generateAsync({type:'blob'}));
  const clearPlan = RC_builderCore.plan({db:db2}, RC_builderCore.parseStructure(structureFile()), {x:0,y:0,z:0,maxBlocks:10,clearTrees:true});
  assert.ok(clearPlan.cleared >= 1, 'tronco na área é marcado para remoção');
  assert.equal(clearPlan.placed, 2, 'limpeza não rouba blocos da estrutura');
  const digPlan = RC_builderCore.plan({db:db2}, RC_builderCore.parseStructure(structureFile()), {x:0,y:0,z:0,maxBlocks:10,dig:{'1,1,0':1}});
  assert.ok(digPlan.dug >= 1, 'buraco da borracha vira ar');
  const paintPlan = RC_builderCore.plan({db:db2}, RC_builderCore.parseStructure(structureFile()), {x:0,y:0,z:0,maxBlocks:10,paint:{'2,0,0':'minecraft:oak_log'}});
  assert.ok(paintPlan.painted >= 1, 'pincel grava bloco copiado da paleta do mundo');
  assert.throws(() => RC_builderCore.plan({db:db2}, RC_builderCore.parseStructure(structureFile()), {x:0,y:0,z:0,maxBlocks:10,paint:{'2,0,0':'minecraft:diamond_block'}}), /nunca apareceu/, 'pincel recusa bloco que o mundo nunca teve');
  const official = new Uint8Array(fs.readFileSync(path.join(__dirname, 'house1.mcstructure')));
  assert.throws(() => RC_builderCore.parseStructure(official), /dados especiais/, 'casa oficial com cama e baú é recusada sem escrever nada');
  const statueRaw = new Uint8Array(fs.readFileSync(path.join(__dirname, 'statue.mcstructure')));
  const officialStructure = RC_builderCore.parseStructure(statueRaw);
  assert.ok(officialStructure.skippedStructureBlocks > 0, 'o Structure Block de origem é removido da cópia');
  assert.equal(officialStructure.size.length, 3);
  assert.ok(officialStructure.blocks.length > 0, 'estrutura oficial contém blocos');
  assert.ok(officialStructure.blocks.every(b => /^minecraft:/.test(b.block.name)), 'paleta oficial Bedrock reconhecida');
  const officialResult = await RC_builderCore.apply(world, statueRaw, {x:1,y:0,z:1,maxBlocks:120000});
  assert.ok(officialResult.build.ops.length >= 1, 'estrutura oficial gera atualização de chunk');
  console.log('PASS: Builder parses structures, shares preview/write rotation, rotates block states, preserves v9 chunks, supports all insertion modes, validates exact written states and refuses unvisited chunks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
