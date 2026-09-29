/* ES5: the help page remains readable even if an old engine cannot run the editor. */
(function () {
  var light = false;
  try { light = localStorage.getItem('rc_light_mode') === '1'; } catch (e) {}
  var nav = window.navigator || {};
  if ((nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) || (nav.connection && nav.connection.saveData)) light = true;
  document.documentElement.setAttribute('data-light-mode', light ? 'true' : 'false');
  var supported = !!(window.Promise && window.fetch && window.FileReader && window.Uint8Array && window.TextDecoder);
  // Capability checks must also work under the site's CSP, which forbids eval.
  supported = supported && !!(window.URLSearchParams && window.Symbol && Promise.prototype.finally);
  function ready() {
    var notice = document.getElementById('compatibilityNotice');
    if (!supported && notice) {
      notice.hidden = false;
      notice.textContent = 'Este navegador consegue mostrar o guia, mas não possui todos os recursos para editar mundos. Atualize o navegador, se seu aparelho permitir, ou use um computador. Seu arquivo original permanece intacto.';
      var input = document.getElementById('file'); if (input) input.disabled = true;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  // Some Android browsers expose Blob but lack its convenience method.
  if (window.Blob && !Blob.prototype.arrayBuffer && window.Promise) Blob.prototype.arrayBuffer = function () {
    var blob = this; return new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = function () { reject(reader.error); }; reader.readAsArrayBuffer(blob); });
  };
})();
