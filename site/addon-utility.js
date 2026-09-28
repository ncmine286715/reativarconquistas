/* Local Bedrock pack preparation. Metadata credits do not affect achievements. */
(function () {
  "use strict";
  var input = document.getElementById("addonUtilityFile");
  var authorInput = document.getElementById("addonAuthors");
  var run = document.getElementById("addonUtilityRun");
  var status = document.getElementById("addonUtilityStatus");
  if (!input || !run) return;

  function fail(message) { throw new Error(message); }
  function entries(zip) { return Object.keys(zip.files).filter(function (name) { return !zip.files[name].dir; }); }
  function safe(zip) {
    var names = entries(zip);
    if (!names.length || names.length > 10000) fail("O pacote está vazio ou tem arquivos demais.");
    var bytes = 0;
    names.forEach(function (name) {
      if (/^(\/|[A-Za-z]:)|(^|\/)\.\.(\/|$)|\\/.test(name)) fail("O ZIP contém caminhos inválidos.");
      bytes += +((zip.files[name]._data || {}).uncompressedSize || 0);
    });
    if (bytes > 250 * 1024 * 1024) fail("Pacote descompactado acima de 250 MB.");
    return names;
  }
  function manifests(names) { return names.filter(function (name) { return /(^|\/)manifest\.json$/i.test(name); }); }
  function updateManifest(zip, path, authors) {
    return zip.file(path).async("string").then(function (raw) {
      var manifest;
      try { manifest = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch (e) { fail("manifest.json inválido: " + path); }
      if (!manifest || !manifest.header || !Array.isArray(manifest.modules) || !manifest.modules.length) fail("O manifest.json não parece ser de um pacote Bedrock: " + path);
      if (authors.length) {
        if (!manifest.metadata || typeof manifest.metadata !== "object" || Array.isArray(manifest.metadata)) manifest.metadata = {};
        manifest.metadata.authors = authors;
        zip.file(path, JSON.stringify(manifest, null, 2) + "\n");
      }
      return manifest;
    });
  }
  function unpackSingle(zip, authors) {
    var names = safe(zip), paths = manifests(names);
    if (paths.length !== 1) fail("Este ZIP precisa conter exatamente um pacote com manifest.json. Para vários pacotes, use .mcaddon.");
    var path = paths[0], prefix = path.slice(0, path.length - "manifest.json".length);
    if (names.some(function (name) { return !name.startsWith(prefix); })) fail("Arquivos fora da pasta do pacote. Organize o ZIP antes de converter.");
    return updateManifest(zip, path, authors).then(function () {
      if (!prefix) return zip;
      var output = new JSZip();
      return Promise.all(names.map(function (name) {
        return zip.file(name).async("uint8array").then(function (data) { output.file(name.slice(prefix.length), data); });
      })).then(function () { return output; });
    });
  }
  function prepareAddon(zip, authors) {
    var names = safe(zip), inner = names.filter(function (name) { return /\.mcpack$/i.test(name); });
    var paths = manifests(names);
    if (!inner.length && !paths.length) fail("Nenhum manifest.json ou .mcpack encontrado neste .mcaddon.");
    if (inner.length > 20 || paths.length > 20) fail("Este add-on tem pacotes demais.");
    var work = paths.map(function (path) { return updateManifest(zip, path, authors); });
    inner.forEach(function (path) {
      work.push(zip.file(path).async("uint8array").then(function (bytes) {
        if (bytes.byteLength > 60 * 1024 * 1024) fail("Um .mcpack interno é grande demais.");
        return JSZip.loadAsync(bytes).then(function (child) { return unpackSingle(child, authors); })
          .then(function (child) { return child.generateAsync({ type: "uint8array", compression: "DEFLATE" }); })
          .then(function (data) { zip.file(path, data); });
      }));
    });
    return Promise.all(work).then(function () { return zip; });
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
  run.addEventListener("click", function () {
    var file = input.files && input.files[0];
    if (!file) { status.textContent = "Selecione um pacote primeiro."; return; }
    if (!/\.(zip|mcpack|mcaddon)$/i.test(file.name)) { status.textContent = "Use .zip, .mcpack ou .mcaddon."; return; }
    if (file.size > 60 * 1024 * 1024) { status.textContent = "Limite: 60 MB por arquivo."; return; }
    var authors = (authorInput.value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (authors.length > 10 || authors.some(function (s) { return s.length > 80; })) { status.textContent = "Use até 10 autores, com no máximo 80 caracteres cada."; return; }
    if (typeof JSZip === "undefined") { status.textContent = "Leitor ZIP indisponível. Recarregue a página."; return; }
    run.disabled = true; status.textContent = "Verificando pacote…";
    JSZip.loadAsync(file).then(function (zip) {
      var addon = /\.mcaddon$/i.test(file.name);
      return (addon ? prepareAddon(zip, authors) : unpackSingle(zip, authors)).then(function (out) {
        return out.generateAsync({ type: "blob", compression: "DEFLATE" }).then(function (blob) {
          var base = file.name.replace(/\.(zip|mcpack|mcaddon)$/i, "").replace(/[^\w.\- À-ÿ]/g, "_");
          download(blob, base + (authors.length ? "-autores" : "") + (addon ? ".mcaddon" : ".mcpack"));
          status.textContent = "Pacote pronto. Confira a importação no Minecraft; autores não liberam conquistas.";
        });
      });
    }).catch(function (error) { status.textContent = error && error.message || "Não foi possível preparar este pacote."; })
      .finally(function () { run.disabled = false; });
  });
})();
