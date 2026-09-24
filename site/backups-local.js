/* Backups explícitos no dispositivo do usuário; nenhum upload é feito. */
(function () {
  "use strict";
  var DB_NAME = "reativaconquistas-local-v1", STORE = "worldBackups", dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    if (!window.indexedDB) return Promise.reject(new Error("Este navegador não oferece armazenamento local compatível."));
    dbPromise = new Promise(function (resolve, reject) {
      var request;
      try { request = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Não consegui abrir a biblioteca local.")); };
      request.onblocked = function () { reject(new Error("Feche outras abas do site e tente de novo.")); };
    }).catch(function (error) { dbPromise = null; throw error; });
    return dbPromise;
  }
  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Falha no armazenamento local.")); };
    });
  }
  async function save(file, label) {
    if (!file || !file.size) throw new Error("Escolha um arquivo de mundo antes de guardar o backup.");
    if (navigator.storage && navigator.storage.estimate) {
      try {
        var estimate = await navigator.storage.estimate();
        if (estimate.quota && estimate.usage != null && estimate.quota - estimate.usage < file.size * 1.1) throw new Error("Há pouco espaço local livre. Apague backups antigos ou baixe o original para o aparelho.");
      } catch (e) { if (e && e.message && /pouco espaço/.test(e.message)) throw e; }
    }
    var db = await openDb(), record = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
      name: file.name || "mundo.mcworld", label: String(label || "Cópia de segurança").trim().slice(0, 80),
      size: file.size, createdAt: new Date().toISOString(), blob: file.slice(0, file.size, file.type || "application/octet-stream")
    };
    var tx = db.transaction(STORE, "readwrite");
    var done = new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(record); };
      tx.onerror = function () { reject(tx.error || new Error("Não foi possível guardar o backup. O navegador pode estar sem espaço.")); };
      tx.onabort = function () { reject(tx.error || new Error("O navegador cancelou o backup. Confira o espaço disponível.")); };
    });
    tx.objectStore(STORE).put(record);
    return done;
  }
  async function list() {
    var db = await openDb(), tx = db.transaction(STORE, "readonly"), store = tx.objectStore(STORE);
    return new Promise(function (resolve, reject) {
      var records = [], request = store.openCursor();
      request.onsuccess = function () {
        var cursor = request.result;
        if (!cursor) { records.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }); resolve(records); return; }
        var value = cursor.value || {};
        records.push({ id: value.id, name: value.name, label: value.label, size: value.size, createdAt: value.createdAt });
        cursor.continue();
      };
      request.onerror = function () { reject(request.error || new Error("Não consegui listar os backups.")); };
    });
  }
  async function remove(id) {
    var db = await openDb(), tx = db.transaction(STORE, "readwrite");
    var done = new Promise(function (resolve, reject) {
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error || new Error("Não foi possível excluir o backup.")); };
      tx.onabort = function () { reject(tx.error || new Error("A exclusão foi cancelada.")); };
    });
    tx.objectStore(STORE).delete(id);
    return done;
  }
  async function download(id) {
    var db = await openDb(), record = await requestResult(db.transaction(STORE, "readonly").objectStore(STORE).get(id));
    if (!record || !record.blob) throw new Error("Este backup não foi encontrado no armazenamento local.");
    var url = URL.createObjectURL(record.blob), a = document.createElement("a");
    a.href = url; a.download = record.name || "mundo-backup.mcworld"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  window.RC_backups = { save: save, list: list, remove: remove, download: download };
})();
