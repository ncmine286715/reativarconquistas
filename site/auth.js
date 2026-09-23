/* ReativaConquistas — autenticação somente com Google/Firebase. */
(function () {
  "use strict";
  var listeners = [], state = { ready: false, user: null, error: "" }, auth = null;
  function emit() { listeners.forEach(function (f) { try { f(state.user); } catch (e) {} }); try { document.dispatchEvent(new Event("rc-auth")); } catch (e) {} }
  function load(src) { return new Promise(function (ok, no) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { no(new Error("Falha ao carregar o Firebase")); }; document.head.appendChild(s); }); }
  function clearLocalVip() { try { localStorage.removeItem("rc_prem_remote"); localStorage.removeItem("rc_prem_email"); } catch (e) {} }
  function boot() {
    // Migração: a autenticação atual usa Firebase; descarte sessão antiga do Worker.
    try { localStorage.removeItem("rc_token"); } catch (e) {}
    var cfg = window.RC_FIREBASE || {};
    if (!cfg.apiKey) { state.ready = true; emit(); return; }
    load("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js").then(function () { return load("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"); }).then(function () {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      auth = firebase.auth();
      auth.onAuthStateChanged(function (u) { state.user = u ? { email: u.email || "", name: u.displayName || "", uid: u.uid || "", photo: u.photoURL || "" } : null; state.error = ""; if (!u) clearLocalVip(); state.ready = true; emit(); });
    }).catch(function () { state.error = "AUTH_UNAVAILABLE"; state.ready = true; emit(); });
  }
  function close() { var m = document.getElementById("authModal"); if (m) m.remove(); }
  function open() {
    close(); var bg = document.createElement("div"); bg.className = "modal-bg open"; bg.id = "authModal";
    bg.innerHTML = '<div class="modal auth-card" role="dialog" aria-modal="true"><h3>Entrar com Google</h3><p class="sub">Use sua conta Google para entrar. O VIP comprado será vinculado automaticamente a essa conta.</p><div class="status err" id="authMsg" hidden></div><button class="google-btn" id="authGoogle" type="button"><span class="google-g" aria-hidden="true">G</span><span>Continuar com Google</span></button><div class="row2" style="margin-top:10px"><button class="btn-ghost" id="authCancel" type="button" style="width:100%">Voltar</button></div><p class="auth-note">Sem senha criada no site. A autenticação é feita pelo Google/Firebase.</p></div>';
    document.body.appendChild(bg); bg.addEventListener("click", function (e) { if (e.target === bg) close(); }); document.getElementById("authCancel").onclick = close;
    document.getElementById("authGoogle").onclick = function () { var b = this, m = document.getElementById("authMsg"); b.disabled = true; b.textContent = "Abrindo o Google…"; window.RC_auth.signInGoogle().then(close).catch(function (e) { b.disabled = false; b.textContent = "Continuar com Google"; m.hidden = false; m.textContent = /unauthorized-domain/.test(String(e.code || "")) ? "Este domínio ainda não está autorizado no Firebase." : "Não foi possível entrar: " + (e.message || e); }); };
  }
  window.RC_auth = { get ready() { return state.ready; }, get error() { return state.error; }, get enabled() { return !!window.RC_FIREBASE; }, user: function () { return state.user; }, onChange: function (f) { listeners.push(f); if (state.ready) f(state.user); }, openModal: open, signInGoogle: function () { if (!auth) return Promise.reject(new Error("Firebase ainda está carregando.")); return auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }, signInEmail: function () { return Promise.reject(new Error("Use o botão Continuar com Google.")); }, signUpEmail: function () { return Promise.reject(new Error("A conta é criada pelo Google.")); }, signOut: function () { clearLocalVip(); return auth ? auth.signOut() : Promise.resolve(); }, getToken: function () { return auth && auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(""); } };
  function wire() { var n = document.getElementById("navAuth"); if (!n) return; window.RC_auth.onChange(function (u) { n.hidden = false; n.textContent = u ? ("Sair (" + (u.email || "").split("@")[0] + ")") : "Entrar"; }); n.onclick = function (e) { e.preventDefault(); if (state.user) window.RC_auth.signOut(); else open(); }; }
  boot(); if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
})();
