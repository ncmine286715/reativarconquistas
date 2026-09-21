// Bedrock converter integration tests. Run from site/: node tests/converter-roundtrip.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = path.resolve(__dirname, '..');
global.window = global;
global.JSZip = require(path.join(site, 'vendor/jszip.min.js'));
const zipLoad = JSZip.loadAsync;
JSZip.loadAsync = async function (input) {
  return zipLoad.call(this, input instanceof Blob ? await input.arrayBuffer() : input);
};
vm.runInThisContext(fs.readFileSync(path.join(site, 'converter.js'), 'utf8'), { filename: 'converter.js' });

const te = new TextEncoder();
function u16(n) { return Uint8Array.of(n & 255, n >>> 8); }
function i32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); return b; }
function i64(n) { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; }
function cat(...xs) { const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let p = 0; xs.forEach(x => { out.set(x, p); p += x.length; }); return out; }
function named(type, name, payload) { const n = te.encode(name); return cat(Uint8Array.of(type), u16(n.length), n, payload); }
function str(s) { const b = te.encode(s); return cat(u16(b.length), b); }
function level({ hardcore = true, includeHardcore = true } = {}) {
  const body = cat(
    Uint8Array.of(10, 0, 0),
    includeHardcore ? named(1, 'IsHardcore', Uint8Array.of(hardcore ? 1 : 0)) : new Uint8Array(),
    named(1, 'PlayerHasDied', Uint8Array.of(hardcore ? 1 : 0)),
    named(3, 'GameType', i32(1)),
    named(3, 'Difficulty', i32(3)),
    named(8, 'LevelName', str('Fixture world')),
    named(4, 'RandomSeed', i64(123456789)),
    named(7, 'FutureBytes', cat(i32(3), Uint8Array.of(9, 8, 7))),
    Uint8Array.of(0)
  );
  return cat(i32(10), i32(body.length), body);
}
function hits(body) { const h = {}; RC_nbt.walkCollect(body, h); return h; }

(async () => {
  const originalLevel = level();
  const untouched = Uint8Array.from([4, 5, 6, 7]);
  const zip = new JSZip();
  zip.file('level.dat', originalLevel);
  zip.file('db/CURRENT', 'MANIFEST-000001\n');
  zip.file('custom/unknown.bin', untouched);
  const input = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' });

  const out = await RC_convert(input, { gameMode: 'keep', recoverHardcore: true, paidEntitlement: true });
  const zout = await JSZip.loadAsync(out.blob);
  const outputLevel = new Uint8Array(await zout.file('level.dat').async('uint8array'));
  const body = RC_nbt.splitLevelDat(outputLevel).body;
  const h = hits(body);
  assert.ok(h.IsHardcore, 'output tags: ' + Object.keys(h).join(','));
  assert.equal(h.IsHardcore[0].val, 0);
  assert.equal(h.PlayerHasDied[0].val, 0);
  assert.equal(h.GameType[0].val, 1, 'Hardcore recovery must not rewrite unrelated GameType');
  assert.equal(h.Difficulty[0].val, 3);
  assert.deepEqual(Array.from(await zout.file('custom/unknown.bin').async('uint8array')), Array.from(untouched));
  assert.ok(out.changes.some(x => /IsHardcore/.test(x)));

  await assert.rejects(() => RC_convert(input, { gameMode: 'creative' }), /PAID_GAME_MODE/);
  const noMarker = new JSZip(); noMarker.file('level.dat', level({ hardcore: false }));
  const noMarkerInput = await noMarker.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
  await assert.rejects(() => RC_convert(noMarkerInput, { gameMode: 'keep', recoverHardcore: true, paidEntitlement: true }), /HARDCORE_NOT_ACTIVE/);
  const missingMarker = new JSZip(); missingMarker.file('level.dat', level({ includeHardcore: false }));
  const missingMarkerInput = await missingMarker.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
  await assert.rejects(() => RC_convert(missingMarkerInput, { gameMode: 'keep', recoverHardcore: true, paidEntitlement: true }), /HARDCORE_NOT_DETECTED/);
  const normal = await RC_convert(await (async () => {
    const z = new JSZip(); z.file('level.dat', level({ hardcore: false }));
    return z.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
  })(), { gameMode: 'keep', recoverHardcore: true, paidEntitlement: true }).catch(e => e);
  assert.match(String(normal && normal.message), /HARDCORE_NOT_ACTIVE/);
  console.log('PASS: Hardcore detection/recovery, minimal mutation, ZIP round-trip, unknown-file preservation, invalid request and paid mode guard.');
})().catch(e => { console.error(e); process.exitCode = 1; });
