/* ReativaConquistas — login SÓ com Google (Firebase), 100% em JS.
   Conta/pagamento continuam no Worker (Premium vinculado ao e-mail).
   Se window.RC_FIREBASE estiver vazio, o login fica desligado.
   Expõe window.RC_auth: { enabled, ready, user, onChange, signInGoogle,
   signOut, getToken, openModal }.
*/
(function () {
  "use strict";

  var listeners = [];
  var state = { ready: false, enabled: false, user: null };
  var auth = null;

  function emit() {
    listeners.forEach(function (cb) { try { cb(state.user); } catch (e) {} });
    try { document.dispatchEvent(new Event("rc-auth")); } catch (e) {}
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Falha ao carregar " + src)); };
      document.head.appendChild(s);
    });
  }

  function boot() {
    var cfg = window.RC_FIREBASE || {};
    if (!cfg.apiKey) { state.ready = true; emit(); return; }
    state.enabled = true;
    loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js")
      .then(function () { return loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"); })
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        auth = firebase.auth();
        auth.onAuthStateChanged(function (u) {
          state.ready = true;
          state.user = u ? { email: u.email || "", name: u.displayName || "" } : null;
          emit();
        });
      })
      .catch(function () { state.enabled = false; state.ready = true; emit(); });
  }

  function closeModal() {
    var m = document.getElementById("authModal");
    if (m) m.remove();
  }

  // Modal só com Google (sem campo de senha).
  function openModal() {
    closeModal();
    var bg = document.createElement("div");
    bg.className = "modal-bg open";
    bg.id = "authModal";
    bg.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">' +
      "<h3 id='authTitle'>Entrar</h3>" +
      "<p class='sub'>Um clique com sua conta Google — sem senha pra decorar, sem cadastro chato. É grátis e seu Premium fica guardado nela.</p>" +
      "<div class='status err' id='authMsg' hidden></div>" +
      "<button class='btn-ghost' id='authGoogle' type='button' style='width:100%;background:#fff;font-weight:700'>Continuar com Google</button>" +
      "<div class='row2' style='margin-top:10px'><button class='btn-ghost' id='authBack' type='button' style='width:100%'>Voltar</button></div></div>";
    document.body.appendChild(bg);
    bg.addEventListener("click", function (e) { if (e.target === bg) closeModal(); });
    document.getElementById("authBack").addEventListener("click", closeModal);
    document.getElementById("authGoogle").addEventListener("click", function () {
      var go = document.getElementById("authGoogle");
      var m = document.getElementById("authMsg");
      go.disabled = true; go.textContent = "Abrindo o Google…";
      window.RC_auth.signInGoogle().then(function () { closeModal(); })
        .catch(function (err) {
          go.disabled = false; go.textContent = "Continuar com Google";
          var msg = String((err && err.code) || "");
          if (/popup-closed|user-cancelled|cancelled-popup-request/.test(msg)) { closeModal(); return; }
          if (/unauthorized-domain/.test(msg)) {
            m.hidden = false;
            m.textContent = "Domínio não autorizado no Firebase (Authorized domains).";
            return;
          }
          m.hidden = false;
          m.textContent = "Não entrou: " + String((err && err.message) || err);
        });
    });
  }

  window.RC_auth = {
    get ready() { return state.ready; },
    get enabled() { return state.enabled; },
    user: function () { return state.user; },
    onChange: function (cb) {
      listeners.push(cb);
      if (state.ready) { try { cb(state.user); } catch (e) {} }
    },
    signInGoogle: function () {
      if (!state.enabled || !auth) return Promise.reject(new Error("Login ainda não configurado."));
      return auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () { return state.user; });
    },
    signInEmail: function () {
      return Promise.reject(new Error("Login só com Google."));
    },
    signUpEmail: function () {
      return Promise.reject(new Error("Conta só com Google — clique em Continuar com Google."));
    },
    signOut: function () {
      // sair = sem Premium: limpa o cache local junto (senão o Premium "sobrevive" ao logout)
      try { localStorage.removeItem("rc_prem_remote"); } catch (e) {}
      var p = auth ? auth.signOut() : Promise.resolve();
      return p;
    },
    getToken: function () {
      var u = auth && auth.currentUser;
      return u ? u.getIdToken() : Promise.resolve("");
    },
    openModal: openModal
  };

  function wireNav() {
    var nav = document.getElementById("navAuth");
    if (!nav) return;
    window.RC_auth.onChange(function (u) {
      if (!window.RC_auth.enabled) { nav.hidden = true; return; }
      nav.hidden = false;
      nav.textContent = u ? ("Sair (" + (u.email || "").split("@")[0] + ")") : "Entrar";
    });
    nav.addEventListener("click", function (e) {
      e.preventDefault();
      var u = window.RC_auth.user();
      if (u) {
        if (window.confirm("Sair da conta " + u.email + "?")) window.RC_auth.signOut();
        return;
      }
      openModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  function init() { boot(); wireNav(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
