const assert = require('node:assert/strict');
const P = require('../builder-position.js');

// The visual chunk and the chosen block must agree, including negative coordinates.
const canvas = {width: 820, height: 220};
const rect = {left: 100, top: 20, width: 410, height: 110};
const view = {pad: 14, scale: 40, minX: -2, minZ: -2};
const point = P.mapBlock(100 + (14 + 2.5 * 40) / 2, 20 + (14 + 1.25 * 40) / 2, rect, canvas, view);
assert.deepEqual(point, {chunkX: 0, chunkZ: -1, x: 8, z: -12});
assert.deepEqual(P.footprintChunks(-1, -1, 2, 2), ['0:-1:-1', '0:-1:0', '0:0:-1', '0:0:0']);
assert.deepEqual(P.footprintChunks(16, -32, 16, 16), ['0:1:-2']);
assert.deepEqual(P.footprintChunks(0, 0, 33, 1), ['0:0:0', '0:1:0', '0:2:0']);
assert.throws(() => P.footprintChunks(0, 0, 0, 1), /Invalid footprint/);
console.log('Builder map and footprint positions OK');
