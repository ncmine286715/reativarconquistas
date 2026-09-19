/* ReativaConquistas — login Firebase 100% em JS (pré-integrado).
   Se window.RC_FIREBASE estiver vazio, fica desligado (site funciona normal).
   Expõe window.RC_auth: { ready, user, onChange, signInGoogle, signInEmail,
   signUpEmail, signOut, getToken }. Usa os builds "compat" via CDN.
*/
(function () {
  "use strict";

  var listeners = [];
  var state = { ready: false, enabled: false, user: null };
  var auth = null;

  function emit() {
    listeners.forEach(function (cb) { try { cb(state.user); } catch (e) {} });
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
    if (!cfg.apiKey) return; // pré-integrado, mas ainda sem projeto: desligado
    state.enabled = true;
    loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js")
      .then(function () { return loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"); })
      .then(function () {
        firebase.initializeApp(cfg);
        auth = firebase.auth();
        auth.onAuthStateChanged(function (u) {
          state.ready = true;
          state.user = u ? { email: u.email || "", name: u.displayName || "", uid: u.uid } : null;
          emit();
        });
      })
      .catch(function () { state.enabled = false; });
  }

  function needAuth() {
    if (!state.enabled || !auth) throw new Error("Login ainda não configurado (firebase-config.js).");
    return auth;
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
      var a = needAuth();
      return a.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () { return state.user; });
    },
    signInEmail: function (email, password) {
      var a = needAuth();
      return a.signInWithEmailAndPassword(email, password).then(function () { return state.user; });
    },
    signUpEmail: function (email, password) {
      var a = needAuth();
      return a.createUserWithEmailAndPassword(email, password).then(function () { return state.user; });
    },
    signOut: function () {
      var a = needAuth();
      return a.signOut();
    },
    getToken: function () {
      var u = auth && auth.currentUser;
      return u ? u.getIdToken() : Promise.resolve("");
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
