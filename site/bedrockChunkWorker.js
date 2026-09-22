/* Only decode existing Bedrock records here. The LevelDB reader stays upstream. */
self.window = self;
importScripts('nbt-bedrock.js', 'builder-core.js', 'bedrock-block-renderer-registry.js');
self.onmessage = function (event) {
  var request = event.data, sections = [], errors = [];
  try {
    request.records.forEach(function (record) {
      var decoded = RC_builderCore.decodeSubchunk(record.bytes);
      if (!decoded) { errors.push('Subchunk Y=' + record.y + ': formato não suportado'); return; }
      var subY = decoded.version === 9 ? new DataView(record.bytes.buffer, record.bytes.byteOffset, record.bytes.byteLength).getInt8(2) : record.y;
      if (subY !== record.y) { errors.push('Subchunk Y divergente: ' + record.y + '/' + subY); return; }
      sections.push({ y: subY, layers: [decoded.primary, decoded.secondary].filter(Boolean).map(function (storage) {
        return { indices: storage.idx, palette: storage.palette.map(function (block) {
          return { name: block.name, states: RC_BedrockBlockRendererRegistry.states(block) };
        }) };
      }) });
    });
    var transfers = [];
    sections.forEach(function (section) { section.layers.forEach(function (layer) { transfers.push(layer.indices.buffer); }); });
    self.postMessage({ id: request.id, sections: sections, errors: errors }, transfers);
  } catch (error) { self.postMessage({ id: request.id, error: error.message }); }
};
