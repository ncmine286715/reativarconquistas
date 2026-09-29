(function () {
  'use strict';
  Array.prototype.forEach.call(document.querySelectorAll('a[href="#guia-envio"]'), function (link) {
    link.addEventListener('click', function () { var guide = document.getElementById('guia-envio'); if (guide) guide.open = true; });
  });
  var toggle = document.getElementById('lightMode');
  if (toggle) {
    toggle.checked = document.documentElement.getAttribute('data-light-mode') === 'true';
    toggle.onchange = function () {
      document.documentElement.setAttribute('data-light-mode', toggle.checked ? 'true' : 'false');
      try { localStorage.setItem('rc_light_mode', toggle.checked ? '1' : '0'); } catch (e) {}
    };
  }
  // Native details are closed initially: only the requested tool gets attention.
  var input = document.getElementById('file');
  if (input) input.addEventListener('change', function () {
    if (!input.files || !input.files.length) return;
    var guide = document.getElementById('guia-envio'); if (guide) guide.open = false;
  });
})();
