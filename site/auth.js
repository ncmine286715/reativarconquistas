/* ReativaConquistas — conta de verdade em JS (Worker + KV, sem Firebase).
   Cadastro/login com e-mail + senha (senha com hash PBKDF2 no servidor,
   nunca trafega — só no cadastro/login via HTTPS — nem é guardada).
   Expõe window.RC_auth: { enabled, ready, user, onChange, signUpEmail,
   signInEmail, signOut, getToken, openModal }. Sessão em localStorage.
*/
(function () {
  "use strict";

  var TOKEN_KEY = "rc_token";
  var USER_KEY = "rc_user";
  var listeners = [];
  var state = { ready: false, user: null };

  function base() {
    return (((window.RC_CONFIG || {}).WORKER_URL) || "").replace(/\/+$/, "");
  }
  function enabled() { return !!base(); }

  function emit() {
    listeners.forEach(function (cb) { try { cb(state.user); } catch (e) {} });
    try { document.dispatchEvent(new Event("rc-auth")); } catch (e) {}
  }

  function save(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }
  function loadUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); }
    catch (e) { return null; }
  }
  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  function req(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var t = token();
    if (t) opts.headers.Authorization = "Bearer " + t;
    return fetch(base() + path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) {}
        if (!res.ok) throw new Error((j && j.error) || ("Erro " + res.status));
        return j;
      });
    });
  }

  function setUser(u) {
    state.ready = true;
    state.user = u ? { email: u.email || "", name: u.name || "" } : null;
    emit();
  }

  /* ---------- modal Entrar / Criar conta (criado via JS) ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function openModal(mode, notice) {
    closeModal();
    var bg = document.createElement("div");
    bg.className = "modal-bg open";
    bg.id = "authModal";
    bg.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">' +
      "<h3 id='authTitle'>" + (mode === "register" ? "Criar conta" : "Entrar") + "</h3>" +
      (notice ? "<p class='sub'>" + esc(notice) + "</p>" : "<p class='sub'>Sua conta guarda seu Premium. É grátis.</p>") +
      "<div class='status err' id='authMsg' hidden></div>" +
      (mode === "register" ? "<label class='lbl' for='authName'>Nome</label><input id='authName' type='text' maxlength='80' autocomplete='name' style='width:100%;border:1.5px solid var(--line-strong);border-radius:10px;padding:10px 12px;font-size:14px'>" : "") +
      "<label class='lbl' for='authEmail' style='display:block;font-size:13px;font-weight:700;margin:12px 0 5px'>E-mail</label>" +
      "<input id='authEmail' type='email' maxlength='120' autocomplete='email' style='width:100%;border:1.5px solid var(--line-strong);border-radius:10px;padding:10px 12px;font-size:14px'>" +
      "<label class='lbl' for='authPass' style='display:block;font-size:13px;font-weight:700;margin:12px 0 5px'>Senha (8+ caracteres)</label>" +
      "<input id='authPass' type='password' maxlength='128' autocomplete='" + (mode === "register" ? "new-password" : "current-password") + "' style='width:100%;border:1.5px solid var(--line-strong);border-radius:10px;padding:10px 12px;font-size:14px'>" +
      "<div class='row2' style='display:flex;gap:10px;margin-top:14px'>" +
      "<button class='btn-ghost' id='authBack' type='button' style='flex:1'>Voltar</button>" +
      "<button class='btn-ghost' id='authGo' type='button' style='flex:2;background:var(--orange);border-color:var(--orange);color:#fff'>" + (mode === "register" ? "Criar conta" : "Entrar") + "</button></div>" +
      "<div class='secure' style='margin-top:10px;font-size:13px'>" + (mode === "register"
        ? "Já tem conta? <a href='#' id='authSwap'><b>Entrar</b></a>"
        : "Sem conta? <a href='#' id='authSwap'><b>Criar grátis</b></a>") + "</div></div>";
    document.body.appendChild(bg);
    function msg(t) {
      var m = document.getElementById("authMsg");
      if (!m) return;
      if (!t) { m.hidden = true; m.textContent = ""; return; }
      m.hidden = false; m.textContent = t;
    }
    bg.addEventListener("click", function (e) { if (e.target === bg) closeModal(); });
    document.getElementById("authBack").addEventListener("click", closeModal);
    document.getElementById("authSwap").addEventListener("click", function (e) {
      e.preventDefault();
      openModal(mode === "register" ? "login" : "register", notice);
    });
    document.getElementById("authGo").addEventListener("click", function () {
      var email = (document.getElementById("authEmail").value || "").trim();
      var pw = document.getElementById("authPass").value || "";
      var nameEl = document.getElementById("authName");
      var name = nameEl ? (nameEl.value || "").trim() : "";
      var go = document.getElementById("authGo");
      if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(email)) { msg("Informe um e-mail válido."); return; }
      if (pw.length < 8) { msg("A senha precisa de ao menos 8 caracteres."); return; }
      if (mode === "register" && name.length < 2) { msg("Informe seu nome."); return; }
      go.disabled = true; go.textContent = "Aguarde…"; msg(null);
      var p = mode === "register"
        ? window.RC_auth.signUpEmail(email, name, pw)
        : window.RC_auth.signInEmail(email, pw);
      p.then(function () { closeModal(); })
        .catch(function (err) { go.disabled = false; go.textContent = mode === "register" ? "Criar conta" : "Entrar"; msg(err.message); });
    });
  }
  function closeModal() {
    var m = document.getElementById("authModal");
    if (m) m.remove();
  }

  /* ---------- API ---------- */
  window.RC_auth = {
    get ready() { return state.ready; },
    get enabled() { return enabled(); },
    user: function () { return state.user; },
    onChange: function (cb) {
      listeners.push(cb);
      if (state.ready) { try { cb(state.user); } catch (e) {} }
    },
    signUpEmail: function (email, name, password) {
      return req("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, name: name, password: password })
      }).then(function (r) {
        save(r.token, { email: r.email, name: r.name });
        setUser({ email: r.email, name: r.name });
        return state.user;
      });
    },
    signInEmail: function (email, password) {
      return req("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      }).then(function (r) {
        save(r.token, { email: r.email, name: r.name });
        setUser({ email: r.email, name: r.name });
        return state.user;
      });
    },
    signInGoogle: function () {
      return Promise.reject(new Error("Login com Google em breve — use e-mail e senha."));
    },
    signOut: function () {
      var t = token();
      save(null, null);
      setUser(null);
      if (t) req("/api/auth/logout", { method: "POST" }).catch(function () {});
      return Promise.resolve();
    },
    getToken: function () { return Promise.resolve(token()); },
    openModal: openModal
  };

  function boot() {
    if (!enabled()) { state.ready = true; emit(); return; }
    var cached = loadUser();
    var t = token();
    if (!cached || !t) { state.ready = true; setUser(null); return; }
    // valida a sessão guardada
    req("/api/auth/me").then(function (me) {
      save(t, { email: me.email, name: me.name });
      setUser({ email: me.email, name: me.name });
    }).catch(function () {
      save(null, null);
      setUser(null);
    });
  }

  // nav Entrar/Sair + minha-conta usam isso
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
      openModal("login");
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
