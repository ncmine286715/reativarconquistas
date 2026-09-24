/* Coordinates shared by map selection and ground preloading. No WebGL dependency. */
(function (root) {
  'use strict';
  function mapBlock(clientX, clientY, rect, canvas, view) {
    var pixelX = (clientX - rect.left) * canvas.width / rect.width;
    var pixelZ = (clientY - rect.top) * canvas.height / rect.height;
    var chunkX = Math.floor((pixelX - view.pad) / view.scale + view.minX);
    var chunkZ = Math.floor((pixelZ - view.pad) / view.scale + view.minZ);
    return { chunkX: chunkX, chunkZ: chunkZ,
      x: Math.floor(((pixelX - view.pad) / view.scale + view.minX) * 16),
      z: Math.floor(((pixelZ - view.pad) / view.scale + view.minZ) * 16) };
  }
  function footprintChunks(x, z, width, depth) {
    if (![x,z,width,depth].every(Number.isFinite) || width < 1 || depth < 1) throw new Error('Invalid footprint');
    var ids = [];
    for (var cx = Math.floor(x/16); cx <= Math.floor((x+width-1)/16); cx++)
      for (var cz = Math.floor(z/16); cz <= Math.floor((z+depth-1)/16); cz++) ids.push('0:' + cx + ':' + cz);
    return ids;
  }
  var api = { mapBlock: mapBlock, footprintChunks: footprintChunks };
  root.RC_builderPosition = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
