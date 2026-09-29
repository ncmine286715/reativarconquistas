/* Importa modelos Bedrock como mundos jogáveis antes de qualquer ferramenta. */
(function () {
  "use strict";
  async function normalize(file) {
    if (!file || !/\.(?:mctemplate|mctemplet)$/i.test(file.name || "")) return file;
    if (typeof JSZip === "undefined") throw new Error("JSZip não carregou. Recarregue a página.");
    var zip = await JSZip.loadAsync(file);
    var levels = [];
    zip.forEach(function (path, entry) {
      var original = String(entry.unsafeOriginalName || path).replace(/\\/g, "/");
      if (/^\//.test(original) || original.split("/").indexOf("..") >= 0) throw new Error("O modelo contém um caminho de arquivo inválido.");
      if (!entry.dir && /(^|\/)level\.dat$/i.test(path.replace(/\\/g, "/"))) levels.push(path);
    });
    if (levels.length !== 1) throw new Error("O modelo precisa conter exatamente um mundo com level.dat.");
    var levelPath = levels[0].replace(/\\/g, "/");
    var prefix = levelPath.slice(0, -"level.dat".length);
    if (!zip.file(levels[0])) throw new Error("level.dat não encontrado no modelo.");
    var entries = [];
    zip.forEach(function (path, entry) {
      if (entry.dir) return;
      var normalized = path.replace(/\\/g, "/");
      if (normalized.slice(0, prefix.length) !== prefix) return;
      var relative = normalized.slice(prefix.length);
      // manifest.json e texts/ pertencem ao pacote de template, não ao mundo.
      if (!relative || relative === "manifest.json" || /^texts\//i.test(relative)) return;
      if (relative.split("/").some(function (part) { return !part || part === "." || part === ".."; })) throw new Error("O modelo contém um caminho de arquivo inválido.");
      entries.push({ path: relative, entry: entry });
    });
    if (!entries.some(function (item) { return item.path === "level.dat"; })) throw new Error("level.dat não encontrado no mundo do modelo.");
    var out = new JSZip();
    // Reuse JSZip's loaded entries instead of inflating the whole database at once.
    // The copy gets its own name; the original archive remains untouched.
    entries.forEach(function (item) {
      var copy = Object.create(item.entry);
      copy.name = item.path;
      out.files[item.path] = copy;
    });
    var blob = await out.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 }, streamFiles: true });
    var name = file.name.replace(/\.(?:mctemplate|mctemplet)$/i, ".mcworld");
    try { return new File([blob], name, { type: "application/octet-stream", lastModified: file.lastModified }); }
    catch (e) { blob.name = name; blob.lastModified = file.lastModified; return blob; }
  }
  window.RC_worldFormat = { normalize: normalize };
})();
