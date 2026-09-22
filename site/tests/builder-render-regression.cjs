// Regressions: real Bedrock palette names must resolve to local textures;
// surface sampling must retain ground and trunks beneath tree canopies.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const site = path.resolve(__dirname, '..');
global.window = global;
for (const file of ['nbt-bedrock.js', 'builder-transform.js', 'builder-core.js', 'bedrock-block-renderer-registry.js', 'chunk-preview-manager.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(site, file), 'utf8'), {filename: file});
}
const registry = RC_BedrockBlockRendererRegistry;
for (const fixture of ['house1.mcstructure', 'statue.mcstructure']) {
  const structure = RC_builderCore.parseStructure(fs.readFileSync(path.join(__dirname, fixture)), {allowComplex: true});
  for (const block of structure.palette) {
    if (/minecraft:(air|structure_block)$/.test(block.name)) continue;
    const def = registry.get(block);
    for (const face of ['top', 'side', 'bottom']) {
      assert.ok(fs.existsSync(path.join(site, 'mc/block', def[face] + '.png')), `${fixture}: ${block.name} ${face}: ${def[face]}`);
    }
  }
}
assert.equal(registry.get({name:'minecraft:oak_stairs'}).side, 'oak_planks');
assert.equal(registry.get({name:'minecraft:stone_brick_stairs'}).side, 'stone_bricks');
assert.equal(registry.get({name:'minecraft:wooden_door',states:{upper_block_bit:1}}).side, 'oak_door_top');
assert.equal(registry.get({name:'minecraft:planks',states:{wood_type:'birch'}}).side, 'birch_planks');
assert.equal(registry.get({name:'minecraft:grass'}).bottom, 'dirt');
assert.notEqual(registry.signature({name:'minecraft:oak_log',states:{pillar_axis:'x'}}), registry.signature({name:'minecraft:oak_log',states:{pillar_axis:'y'}}));
global.RC_dbx = {parseChunkKey: key => key};
const manager = new RC_ChunkPreviewManager({db:{keys:new Map([['negative', {keyBytes:{dim:0,cx:-1,cz:-1,tag:47,sub:-1}}]])}});
assert.ok(manager.records.get('0:-1:-1').subchunks.has(-1), 'subchunk Y=-1 is real terrain, not a sentinel');
const chunk = {blocks:[], byPos:new Map()};
for (let y=60; y<=80; y++) {
  const b={x:-1,y,z:-1,name:y===60?'minecraft:grass':y===80?'minecraft:oak_leaves':'minecraft:oak_log',transparent:y===80};
  chunk.blocks.push(b);chunk.byPos.set(`-1,${y},-1`,b);
}
manager.loadedChunks.set('0:-1:-1',chunk);
const visible=manager.getRenderBlocks(65,32);
assert.ok(visible.some(b=>b.y===60),'ground remains below foliage');
assert.ok(visible.some(b=>b.y===70),'trunk remains below canopy');
assert.ok(visible.some(b=>b.y===80),'canopy remains');
assert.equal(manager.requiredKeys(-1,-1).length,25);
console.log('PASS: fixture textures, Bedrock states, negative subchunks, canopy/trunk/ground and 5x5 window.');
