/* One browser facade for the server owned plan catalog and user entitlements. */
(function () {
  "use strict";
  var state = { status: "loading", authenticated: false, active: false, plan: "", plan_label: "", expires_at: null, premium_until_ms: 0, world_credits: 0, active_world_projects: 0, max_file_mb: null, max_file_bytes: null, max_batch: 0, allowed_tools: [], capabilities: {}, account_email: "", error: null, loaded_at: 0, _identity_key: "" };
  var pending = null;
  var authWait = null;
  var listeners = [];
  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(message)); }, ms);
      Promise.resolve(promise).then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  function user() { try { return window.RC_auth && window.RC_auth.user ? window.RC_auth.user() : null; } catch (e) { return null; } }
  function emptyRights() {
    return { active: false, plan: "", plan_label: "", expires_at: null, premium_until_ms: 0, world_credits: 0, active_world_projects: 0, max_file_mb: null, max_file_bytes: null, max_batch: 0, allowed_tools: [], capabilities: {}, account_email: "", pending_payment: null };
  }
  function identityKey() {
    if (window.RC_auth && window.RC_auth.ready === false) return "auth:loading";
    if (window.RC_auth && window.RC_auth.error) return "auth:error";
    var u = user();
    return u && u.uid ? "uid:" + u.uid : "anonymous";
  }
  function snapshot() {
    var current = identityKey();
    if (state._identity_key && current !== state._identity_key) {
      return Object.assign({}, state, emptyRights(), { status: "loading", authenticated: current.indexOf("uid:") === 0, _identity_key: current });
    }
    var copy = Object.assign({}, state);
    delete copy._identity_key;
    return copy;
  }
  function publish(next, key) {
    state = Object.assign({}, state, next || {});
    if (key) state._identity_key = key;
    window.RC_entitlementState = snapshot();
    listeners.slice().forEach(function (fn) { try { fn(snapshot()); } catch (e) {} });
    return snapshot();
  }
  function valid(ent) {
    var bytesValid = ent && (ent.max_file_bytes === null || (Number.isFinite(+ent.max_file_bytes) && +ent.max_file_bytes >= 0));
    return !!ent && typeof ent.plan === "string" && bytesValid && Number.isFinite(+ent.max_batch) && Array.isArray(ent.allowed_tools) && !!ent.capabilities;
  }
  function failedState(error, key) {
    var expired = error && (error.status === 401 || error.code === "AUTH_EXPIRED");
    var next = publish(Object.assign(emptyRights(), { status: expired ? "session_expired" : "error", authenticated: key.indexOf("uid:") === 0, error: String((error && error.message) || error || "network_error"), loaded_at: 0 }), key);
    if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("entitlement_load_error", { reason: expired ? "session_expired" : "unavailable" });
    return Object.assign(error instanceof Error ? error : new Error(String(error)), { entitlement_status: next.status });
  }
  function waitForAuth() {
    if (!window.RC_auth || window.RC_auth.ready !== false) return null;
    publish(Object.assign(emptyRights(), { status: "loading", error: null }), "auth:loading");
    if (!authWait) {
      authWait = new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          authWait = null;
          reject(new Error("A sessão Google demorou para carregar. Recarregue a página e tente novamente."));
        }, 12000);
        window.RC_auth.onChange(function () {
          if (settled || (window.RC_auth && window.RC_auth.ready === false)) return;
          settled = true;
          clearTimeout(timer);
          authWait = null;
          load({ force: true }).then(resolve, reject);
        });
      });
    }
    return authWait;
  }
  function load(options) {
    options = options || {};
    var authPending = waitForAuth();
    if (authPending) return authPending;
    var key = identityKey();
    if (key === "auth:error") {
      var authError = Object.assign(new Error("Não foi possível carregar sua sessão Google. Tente novamente."), { code: "AUTH_UNAVAILABLE" });
      publish(Object.assign(emptyRights(), { status: "error", authenticated: false, error: authError.message }), key);
      return Promise.reject(authError);
    }
    if (pending && pending.identity === key) return pending.promise;
    if (!options.force && state.status === "ready" && state._identity_key === key && Date.now() - state.loaded_at < 30000) return Promise.resolve(snapshot());

    var currentUser = user();
    var request = { identity: key, promise: null };
    publish(Object.assign(emptyRights(), { status: "loading", authenticated: !!currentUser, error: null, loaded_at: 0 }), key);
    pending = request;
    request.promise = withTimeout(Promise.resolve().then(function () {
      if (!window.RC_pay) throw new Error("ENTITLEMENT_CLIENT_UNAVAILABLE");
      if (currentUser) {
        if (typeof window.RC_pay.entitlements !== "function") throw new Error("ENTITLEMENT_CLIENT_UNAVAILABLE");
        return window.RC_pay.entitlements();
      }
      if (typeof window.RC_pay.planCatalog !== "function") throw new Error("PLAN_CATALOG_UNAVAILABLE");
      return window.RC_pay.planCatalog().then(function (catalog) {
        var free = catalog && catalog.free;
        if (!free || free.id !== "free") throw new Error("PLAN_CATALOG_INVALID");
        var guest = Object.assign({}, free, { authenticated: false, active: false, status: "unauthenticated", plan: "free", plan_label: free.label || "Plano gratuito", expires_at: null, premium_until_ms: 0, world_credits: 0, active_world_projects: 0, account_email: "" });
        if (!valid(guest)) throw new Error("PLAN_CATALOG_INVALID");
        return guest;
      });
    }), 15000, "A verificação do plano demorou demais. Tente novamente.").then(function (ent) {
      if (identityKey() !== key) return load({ force: true });
      if (!valid(ent) || (currentUser && ent.authenticated !== true)) throw new Error("ENTITLEMENT_RESPONSE_INVALID");
      var status = currentUser ? "ready" : "unauthenticated";
      var loaded = publish(Object.assign({}, ent, { status: status, error: null, loaded_at: Date.now() }), key);
      if (window.RC_pay.track) window.RC_pay.track("entitlement_loaded", { plan: loaded.plan });
      return loaded;
    }).catch(function (error) {
      if (identityKey() !== key) return load({ force: true });
      throw failedState(error, key);
    }).finally(function () { if (pending === request) pending = null; });
    return request.promise;
  }
  function refresh() { return load({ force: true }); }
  function getPlan() { var current = snapshot(); return current.status === "ready" || current.status === "unauthenticated" ? current : null; }
  function canUseTool(tool) {
    var current = snapshot();
    if (current.status !== "ready" && current.status !== "unauthenticated") return { status: current.status, allowed: false };
    var allowed = (current.allowed_tools || []).indexOf(String(tool || "").toLowerCase()) >= 0;
    return { status: current.status, allowed: allowed, plan: current.plan, capability: current.capabilities || {} };
  }
  function canUseFile(files) {
    var current = snapshot();
    if (current.status !== "ready" && current.status !== "unauthenticated") return { status: current.status, allowed: false };
    var list = Array.prototype.slice.call(files || []);
    var maxBytes = current.max_file_bytes === null ? null : +current.max_file_bytes;
    var tooLarge = maxBytes === null ? [] : list.filter(function (file) { return +file.size > maxBytes; });
    var maxBatch = Math.max(1, +current.max_batch || 1);
    return { status: current.status, allowed: !tooLarge.length && list.length <= maxBatch, too_large: tooLarge, max_file_bytes: maxBytes, max_file_mb: current.max_file_mb, max_batch: maxBatch, plan: current.plan, plan_label: current.plan_label };
  }
  function checkOperation(payload) {
    var current = snapshot();
    if (current.status !== "ready" && current.status !== "unauthenticated") return Promise.reject(Object.assign(new Error("Não foi possível verificar seu plano agora. Tente novamente."), { code: current.status === "session_expired" ? "AUTH_EXPIRED" : "ENTITLEMENT_UNAVAILABLE" }));
    if (!window.RC_pay || !window.RC_pay.authorizeOperation) return Promise.reject(new Error("Não foi possível verificar seu plano agora. Tente novamente."));
    payload = payload || {};
    return window.RC_pay.authorizeOperation(payload.worlds, payload.size_bytes, payload.features, payload.operation_id, payload.world_project_id, payload.world_fingerprint);
  }
  function complete(operationId, worldFingerprint) { return window.RC_pay.completeOperation(operationId, worldFingerprint || ""); }
  function release(operationId) { return window.RC_pay.releaseOperation(operationId); }
  function messageForPending(pending) {
    var plan = pending && pending.plan_label || pending && pending.plan || "plano escolhido";
    if (pending && pending.status === "checkout_creation_uncertain") return "Estamos confirmando a criação do Pix. Para continuar sem gerar outra cobrança, selecione novamente o mesmo plano. Se já pagou, atualize os benefícios em Minha conta.";
    return "Seu pagamento do plano " + plan + " ainda está em confirmação. Atualize os benefícios em Minha conta; não faça outra compra.";
  }
  function messageForError(error) {
    var code = error && error.payload && error.payload.code || error && error.code || "";
    if (error && (error.status === 401 || code === "AUTH_EXPIRED")) return "Sua sessão Google expirou. Entre novamente para verificar seus benefícios.";
    if (error && (error.status === 503 || error.status >= 500) || code === "ENTITLEMENT_UNAVAILABLE") return "Não foi possível verificar seu plano agora. Tente novamente. Nenhuma nova compra é necessária.";
    if (code === "PAYMENT_PENDING") return messageForPending(state.pending_payment);
    if (code === "TOOL_QUOTA_EXCEEDED") return "O limite diário de operações do seu plano foi atingido. Ele reinicia às 21h de Brasília (00h UTC). Seu arquivo original permanece intacto.";
    if (code === "SIZE_LIMIT") {
      var limit = error.payload && error.payload.max_file_mb;
      return limit == null ? "O arquivo excede o limite deste plano." : "O arquivo excede o limite de " + limit + " MB deste plano.";
    }
    if (code === "BATCH_LIMIT") return "O lote excede o limite de " + ((error.payload && error.payload.max_batch) || "mundos") + " deste plano.";
    if (code === "WORLD_CREDIT_EXHAUSTED") return "O crédito já foi aplicado a outro mundo. Reenvie o arquivo do projeto usado para continuar editando.";
    if (code === "NO_ENTITLEMENT") return "Este recurso precisa de um plano pago. Seus benefícios foram consultados no servidor.";
    return String((error && error.message) || "Não foi possível validar esta operação. Tente novamente.");
  }
  function worldProjectInfo(file) {
    if (!file || !window.JSZip) return Promise.resolve({ project_id: "", fingerprint: "" });
    return JSZip.loadAsync(file).then(function (zip) {
      var match = /^RCWP:([a-zA-Z0-9_-]{8,120})$/.exec(String(zip.comment || ""));
      var projectId = match ? match[1] : "";
      var entry = null;
      Object.keys(zip.files || {}).some(function (name) {
        if (String(name).toLowerCase().replace(/\\/g, "/").split("/").pop() === "level.dat") { entry = zip.files[name]; return true; }
        return false;
      });
      if (!entry || !window.crypto || !crypto.subtle) return { project_id: projectId, fingerprint: "" };
      return entry.async("uint8array").then(function (bytes) {
        return crypto.subtle.digest("SHA-256", bytes).then(function (hash) {
          var hex = Array.prototype.map.call(new Uint8Array(hash), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
          return { project_id: projectId, fingerprint: hex };
        });
      });
    }).catch(function () { return { project_id: "", fingerprint: "" }; });
  }
  function markWorldForCompletion(blob, projectId) {
    if (!blob || !projectId || !window.JSZip) return Promise.resolve({ blob: blob, fingerprint: "" });
    return JSZip.loadAsync(blob).then(function (zip) {
      zip.comment = "RCWP:" + projectId;
      var entry = null;
      Object.keys(zip.files || {}).some(function (name) {
        if (String(name).toLowerCase().replace(/\\/g, "/").split("/").pop() === "level.dat") { entry = zip.files[name]; return true; }
        return false;
      });
      if (!entry || !window.crypto || !crypto.subtle) throw new Error("Não foi possível identificar este mundo para salvar o crédito com segurança.");
      var hashPromise = entry.async("uint8array").then(function (bytes) { return crypto.subtle.digest("SHA-256", bytes); }).then(function (hash) {
        return Array.prototype.map.call(new Uint8Array(hash), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      });
      return Promise.all([zip.generateAsync({ type: "blob", compression: "STORE" }), hashPromise]).then(function (result) {
        return { blob: result[0], fingerprint: result[1] };
      });
    });
  }
  function markWorld(blob, projectId) {
    return markWorldForCompletion(blob, projectId).then(function (result) { return result.blob; });
  }
  function subscribe(fn) { if (typeof fn === "function") listeners.push(fn); return function () { listeners = listeners.filter(function (item) { return item !== fn; }); }; }
  window.RC_entitlements = { load: load, refresh: refresh, getPlan: getPlan, canUseTool: canUseTool, canUseFile: canUseFile, checkOperation: checkOperation, complete: complete, release: release, messageForPending: messageForPending, messageForError: messageForError, worldProjectInfo: worldProjectInfo, markWorld: markWorld, markWorldForCompletion: markWorldForCompletion, subscribe: subscribe, state: snapshot };
  window.RC_entitlementState = snapshot();
  if (window.RC_auth && window.RC_auth.onChange) window.RC_auth.onChange(function () { refresh().catch(function () {}); });
  document.addEventListener("rc-auth", function () { refresh().catch(function () {}); });
  document.addEventListener("rc-pay-ready", function () { if (user() || !window.RC_auth || window.RC_auth.ready) refresh().catch(function () {}); });
})();
