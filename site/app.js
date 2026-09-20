/* ReativaConquistas — frontend (conversão 100% local + conta + AbacatePay).
   Grátis e ilimitado p/ mundos de até 10 MB. Acima disso (mundos gigantes,
   mais processamento) é VIP na conta via AbacatePay (Worker).
*/
(function () {
  "use strict";

  var CFG = window.RC_CONFIG || {};
  var FREE_MAX_MB = CFG.FREE_MAX_MB || 10;
  var PRE_MAX_MB = CFG.PRE_MAX_MB || 500;

  /* ---------- tema claro/escuro (sem flash: <head> já aplicou) ---------- */
  function applyThemeBtn() {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    document.querySelectorAll(".theme-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", dark ? "true" : "false");
      b.title = dark ? "Mudar para modo claro" : "Mudar para modo escuro";
    });
  }
  function cycleTheme() {
    var root = document.documentElement;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("rc_theme", next); } catch (e) {}
    applyThemeBtn();
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".theme-btn") : null;
    if (b) { e.preventDefault(); cycleTheme(); }
  });
  applyThemeBtn();

  /* ---------- barra fixa: aparece depois do conversor, some nos planos ---------- */
  (function sticky() {
    var bar = $("stickyCta"), x = $("stickyX");
    if (!bar) return;
    var dead = false;
    if (x) x.addEventListener("click", function () { dead = true; bar.hidden = true; });
    function tick() {
      if (dead) return;
      var conv = $("converter"), plans = $("planos");
      var c = conv ? conv.getBoundingClientRect() : null;
      var p = plans ? plans.getBoundingClientRect() : null;
      var pastConv = !!c && c.bottom < 0;
      var atPlans = !!p && p.top < window.innerHeight * 0.7 && p.bottom > window.innerHeight * 0.3;
      bar.hidden = !(pastConv && !atPlans);
    }
    window.addEventListener("scroll", tick, { passive: true });
    tick();
  })();

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var form = $("form"), input = $("file"), drop = $("drop"),
      fileName = $("fileName"), submit = $("submit"),
      accept = $("accept"), status = $("status"),
      quotaBar = $("quotaBar"), quotaText = $("quotaText"),
      wantIcon = $("wantIcon"), iconFile = $("iconFile"), iconBtn = $("iconBtn"),
      iconPreview = $("iconPreview"), iconName = $("iconName"),
      wantRename = $("wantRename"), renameInput = $("renameInput"),
      keepSel = $("keepinv"), coordSel = $("showcoords"),
      daySel = $("daycycle"), weatherSel = $("weather"),
      badgeFile = $("badgeFile");

  var selected = null, selectedIconBytes = null, selectedList = [], iconPreset = null, presetBytes = null;

  /* ---------- menu hambúrguer / drawer ---------- */
  (function drawer() {
    var hamb = $("hamb"), dr = $("drawer"), bg = $("drawerBg"), x = $("drawerClose");
    if (!hamb || !dr) return;
    function open(o) {
      dr.classList.toggle("open", o);
      dr.setAttribute("aria-hidden", o ? "false" : "true");
      hamb.setAttribute("aria-expanded", o ? "true" : "false");
      if (bg) bg.hidden = !o;
      if (o) { var f = dr.querySelector("a"); if (f) f.focus(); }
      else hamb.focus();
    }
    hamb.addEventListener("click", function () { open(!dr.classList.contains("open")); });
    if (x) x.addEventListener("click", function () { open(false); });
    if (bg) bg.addEventListener("click", function () { open(false); });
    dr.addEventListener("click", function (e) { if (e.target.tagName === "A") open(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && dr.classList.contains("open")) open(false); });
  })();

  function setBadge() {
    if (!badgeFile) return;
    if (selectedList.length > 1) { badgeFile.textContent = selectedList.length + " arquivos"; }
    else if (selected) { badgeFile.textContent = "arquivo ok"; }
    else { badgeFile.textContent = "aguardando arquivo"; }
  }
  function paintPresets() {
    try {
      var row = $("presetRow");
      if (!row || !window.RC_icons) return;
      row.innerHTML = "";
      window.RC_icons.list.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn-ghost";
        b.title = it.name;
        b.style.padding = "6px";
        var cv = document.createElement("canvas");
        cv.style.width = "48px"; cv.style.height = "48px";
        cv.style.imageRendering = "pixelated";
        window.RC_icons.preview(cv, it.id);
        b.appendChild(cv);
        var lb = document.createElement("div");
        lb.style.fontSize = "11px";
        lb.textContent = it.name;
        b.appendChild(lb);
        b.addEventListener("click", function () {
          if (!needPremium("Ícones prontos são VIP.")) return;
          iconPreset = it.id;
          presetBytes = null;
          selectedIconBytes = null;
          wantIcon.checked = true;
          iconName.textContent = "Gerando " + it.name + "…";
          window.RC_icons.make(it.id).then(function (bytes) {
            presetBytes = bytes;
            selectedIconBytes = null;
            iconName.textContent = "Ícone pronto: " + it.name + " (JPEG)";
            showIconPreview(new Blob([bytes], { type: "image/jpeg" }));
            setStatus(null);
          }).catch(function (err) {
            iconName.textContent = "";
            setStatus("err", "Não deu para gerar o ícone: " + escapeHtml((err && err.message) || err));
          });
        });
        row.appendChild(b);
      });
    } catch (e) {}
  }
  var diagBtn = $("diagnose");

  /* ---------- contato / operador (rodapé) ---------- */
  function paintContact() {
    if (CFG.SUPPORT_EMAIL) {
      document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
        if (a.id !== "supEmail") a.href = "mailto:" + CFG.SUPPORT_EMAIL;
      });
      var se = $("supEmail");
      if (se) se.textContent = CFG.SUPPORT_EMAIL;
    }
    if (CFG.OPERATOR_CITY_UF) { var oc = $("opCity"); if (oc) oc.textContent = CFG.OPERATOR_CITY_UF; }
  }

  /* ---------- Premium = conta (AbacatePay) ---------- */
  // Premium da conta (pagamento Abacate) — soma ao código local.
  function remotePremUntil() {
    try {
      var r = JSON.parse(localStorage.getItem("rc_prem_remote") || "null");
      return (r && +r.until) || 0;
    } catch (e) { return 0; }
  }
  function remotePremOk() { return remotePremUntil() > Date.now(); }
  function isPremiumAny() { return remotePremOk(); }
  function refreshRemotePrem() {
    try {
      var u = (window.RC_auth && window.RC_auth.user()) || null;
      if (!u || !u.email || !window.RC_pay || !window.RC_pay.enabled()) return;
      window.RC_pay.remotePremiumMs(u.email).then(function (ms) {
        try {
          if (ms > Date.now()) localStorage.setItem("rc_prem_remote", JSON.stringify({ until: ms }));
          else localStorage.removeItem("rc_prem_remote");
        } catch (e) {}
        paintQuota();
      });
    } catch (e) {}
  }

  function paintQuota() {
    if (remotePremOk()) {
      quotaBar.classList.add("premium");
      quotaText.innerHTML = "<strong>VIP ativo</strong> na sua conta até <strong>" + new Date(remotePremUntil()).toLocaleDateString("pt-BR") + "</strong> — mundos gigantes liberados. <a href='minha-conta.html'>Minha conta</a>";
    } else {
      quotaBar.classList.remove("premium");
      quotaText.innerHTML = "Mundos de até <strong>10 MB: grátis e ilimitado</strong>. Mundos gigantes (acima de 10 MB) exigem mais processamento — <a href='#planos'><b>libere com o VIP</b></a>";
    }
    updateSubmit();
  }

  /* ---------- status ---------- */
  function setStatus(kind, html) {
    if (!kind) { status.hidden = true; status.className = "status"; status.textContent = ""; return; }
    status.hidden = false;
    status.className = "status " + kind;
    status.innerHTML = html;
  }
  function loggedIn() {
    try { return !!((window.RC_auth && window.RC_auth.user()) || null); } catch (e) { return false; }
  }
  // Recurso pago: sem login -> entra primeiro; logado sem VIP -> assinar.
  function needPremium(msg, plan) {
    if (!loggedIn()) {
      setStatus("", escapeHtml(msg) + ' <a href="minha-conta.html"><b>Entre com Google</b></a> para continuar.');
      try { if (window.RC_auth) window.RC_auth.openModal(); } catch (e) {}
      return false;
    }
    if (!remotePremOk()) { lockedHint(msg, plan); return false; }
    return true;
  }
  function lockedHint(msg, plan) {
    setStatus("", escapeHtml(msg) + ' <a href="#planos"><b>Ver planos</b></a> · <a href="minha-conta.html"><b>Minha conta</b></a>');
    // upsell direto: recurso VIP abre o popup de assinatura na hora
    try { if (window.RC_pay && window.RC_pay.enabled()) window.RC_pay.openPayModal(msg, plan); } catch (e) {}
  }

  /* ---------- arquivo ---------- */
  function friendlyFileErr(err) {
    var m = String((err && err.message) || err || "");
    if (/level\.dat n(o|ã)o encontrado/i.test(m)) return "Esse arquivo <b>não parece um mundo válido</b> (falta o level.dat dentro). Exporte de novo pelo jogo — veja <a href='#faq'><b>onde achar o .mcworld</b></a>.";
    if (/NBT|truncado|inválido|root não é|bytes sobrando|não é Compound/i.test(m)) return "Não consegui ler esse mundo (arquivo <b>corrompido ou incompleto</b>). Exporte/baixe de novo e tente.";
    if (/JSZip|central directory|corrupt|encrypted|senha/i.test(m)) return "Esse <b>.zip não abre</b> (corrompido ou com senha). Compacte de novo, sem senha.";
    return "Não deu certo: " + escapeHtml(m);
  }

  function sizeLimitMB() { return remotePremOk() ? PRE_MAX_MB : FREE_MAX_MB; }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function baseName(name) { return name.replace(/\.(mcworld|zip)$/i, "") + "-conquistas.mcworld"; }

  var ACCEPT = /\.(mcworld|zip|dat)$/i;

  var GM_NAMES = ["Sobrevivência", "Criativo", "Aventura"];
  function gmName(v) { return GM_NAMES[v] || ("modo " + v); }
  function paintWorldInfo(rep, multi) {
    var box = $("worldInfo");
    if (!box) return;
    if (!rep || !rep.ok) { box.hidden = true; return; }
    box.hidden = false;
    $("wiName").textContent = (rep.worldName && rep.worldName[0]) || "(sem nome no level.dat)";
    var seed = (rep.seed && rep.seed[0]) || null;
    $("wiSeed").textContent = seed || "—";
    var cp = $("seedCopy");
    if (cp) {
      cp.hidden = !seed;
      cp.onclick = function () {
        var done = function () { cp.textContent = "Copiado!"; setTimeout(function () { cp.textContent = "Copiar"; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(seed).then(done, done);
        else {
          var ta = document.createElement("textarea");
          ta.value = seed; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); } catch (e) {}
          ta.remove(); done();
        }
      };
    }
    $("wiMode").textContent = rep.gameType.length ? rep.gameType.map(gmName).join(", ") : "—";
    $("wiDiff").textContent = (rep.difficulty && rep.difficulty.length === 1) ? diffName(rep.difficulty[0]) : "—";
    $("wiSpawn").textContent = (rep.spawn && rep.spawn[0] !== null && rep.spawn[0] !== undefined) ? rep.spawn.join(", ") : "—";
    var st = rep.alreadyClean ? "pronto p/ conquistas" : (rep.wouldChange.length + " ajuste(s) pendente(s)");
    if (rep.locked && (rep.locked.hasLockedBehaviorPack || []).indexOf(1) >= 0) st += " · pack travado!";
    if (multi) st += " (1º de " + multi + ")";
    $("wiStatus").textContent = st;
  }
  var raioXSeq = 0;
  function raioX() {
    var box = $("filex");
    setBadge();
    if (!box) return;
    if (!selected || typeof window.RC_local === "undefined") { box.hidden = true; paintWorldInfo(null); return; }
    var my = ++raioXSeq;
    var f = selectedList.length > 1 ? selectedList[0] : selected;
    box.hidden = false;
    box.textContent = "Lendo mundo…";
    f.arrayBuffer().then(function (ab) { return window.RC_local.diagnoseAny(ab, f.name); }).then(function (rep) {
      if (my !== raioXSeq) return;
      if (!rep.ok) { box.hidden = true; paintWorldInfo(null); return; }
      paintWorldInfo(rep, selectedList.length > 1 ? selectedList.length : 0);
      var df = (rep.difficulty && rep.difficulty.length === 1) ? diffName(rep.difficulty[0]) : null;
      var t = "Raio-X: " + (rep.alreadyClean ? "já limpo" : (rep.wouldChange.length + " ajustes pendentes"));
      if (df) t += " · dificuldade " + df;
      if (rep.seed && rep.seed.length) t += " · seed " + rep.seed[0];
      if (rep.spawn && rep.spawn[0] !== null && rep.spawn[0] !== undefined) t += " · spawn (" + rep.spawn.join(", ") + ")";
      if (selectedList.length > 1) t += " (1º de " + selectedList.length + ")";
      box.textContent = t;
    }).catch(function () { if (my === raioXSeq) { box.hidden = true; paintWorldInfo(null); } });
  }
  function pick(list) {
    if (!list || !list.length) return;
    var bx0 = $("filex"); if (bx0) bx0.hidden = true; // usuário cancelou a janela: mantém seleção
    var files = Array.prototype.slice.call(list || []);
    files = files.filter(function (f) { return ACCEPT.test(f.name || ""); });
    if (!files.length) {
      var got = Array.prototype.slice.call(list || []).map(function (f) { return f.name || "?"; }).slice(0, 3).join(", ");
      selected = null; selectedList = [];
      fileName.hidden = true; paintWorldInfo(null); setBadge(); updateSubmit();
      setStatus("err", "Formato não suportado" + (got ? " (<b>" + escapeHtml(got) + "</b>)" : "") + ". Envie <b>.mcworld</b>, <b>.zip</b> do mundo ou <b>level.dat</b> — foto, .mcpack e .mcaddon <b>não são mundo</b>. Veja <a href='#faq'><b>onde achar o .mcworld</b></a>.");
      return;
    }
    var empty = files.filter(function (f) { return !f.size; });
    if (empty.length) {
      selected = null; selectedList = [];
      fileName.hidden = true; paintWorldInfo(null); setBadge(); updateSubmit();
      setStatus("err", "O arquivo <b>" + escapeHtml(empty[0].name) + "</b> está <b>vazio</b> (0 bytes). Exporte o mundo de novo.");
      return;
    }
    var maxB = sizeLimitMB() * 1024 * 1024;
    var big = files.filter(function (f) { return f.size > maxB; });
    if (big.length) {
      selected = null; selectedList = [];
      fileName.hidden = true; paintWorldInfo(null); setBadge(); updateSubmit();
      if (!remotePremOk()) {
        // gatilho contextual: mundo gigante bloqueado abre a oferta VIP na hora
        // (Passe 24h pré-selecionado: entrada mais barata p/ um mundo só)
        lockedHint("Esse mundo passa de 10 MB (" + big[0].name + "). Mundos gigantes são VIP — conversão ilimitada, sem limite de tamanho.", "vip24h");
      } else {
        setStatus("err", "Arquivo grande até para o navegador (máx. <b>500 MB</b>): " + escapeHtml(big[0].name));
      }
      return;
    }
    selectedList = files;
    selected = files[0];
    if (files.length > 1) {
      fileName.textContent = files.length + " arquivos selecionados (lote = VIP)";
      fileName.hidden = false;
      setStatus(null);
    } else if (selected) {
      fileName.textContent = selected.name + "  (" + fmtSize(selected.size) + ")";
      fileName.hidden = false;
      setStatus(null);
    }
    raioX();
    updateSubmit();
  }

  function updateSubmit() {
    submit.disabled = !(selected && accept.checked);
    if (diagBtn) diagBtn.disabled = !selected;
  }

  input.addEventListener("change", function () { pick(input.files); });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) { pick(e.dataTransfer.files); });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  accept.addEventListener("change", updateSubmit);

  var gameSel = $("gamemode");
  if (gameSel) gameSel.addEventListener("change", function () {
    if (gameSel.value !== "keep" && !needPremium("Mudar o modo de jogo é VIP.")) gameSel.value = "keep";
  });
  if (wantIcon) wantIcon.addEventListener("change", function () {
    if (wantIcon.checked && !remotePremOk()) { wantIcon.checked = false; lockedHint("Trocar a foto do mundo é VIP."); }
  });
  if (wantRename) wantRename.addEventListener("change", function () {
    if (wantRename.checked) renameInput.focus();
  });
  function showIconPreview(blob) {
    try {
      var url = URL.createObjectURL(blob);
      iconPreview.src = url;
      iconPreview.style.display = "block";
    } catch (e) {}
  }
  // O mundo Bedrock usa world_icon.jpeg (JPEG). Converte qualquer upload
  // (PNG/JPG/WebP) para JPEG quadrado 512px via canvas — antes o site
  // enviava o PNG cru como pack_icon.png e o jogo ignorava a foto.
  function fileToJpegBytes(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          URL.revokeObjectURL(url);
          var S = 512;
          var c = document.createElement("canvas");
          c.width = S; c.height = S;
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, S, S);
          var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          var sc = Math.max(S / iw, S / ih); // cover: preenche o quadrado
          var dw = iw * sc, dh = ih * sc;
          ctx.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
          c.toBlob(function (blob) {
            if (!blob) { reject(new Error("Falha ao converter a imagem.")); return; }
            blob.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, reject);
          }, "image/jpeg", 0.92);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Não consegui ler essa imagem.")); };
      img.src = url;
    });
  }
  if (iconBtn) iconBtn.addEventListener("click", function () {
    if (!needPremium("Trocar a foto do mundo é VIP.")) return;
    iconFile.click();
  });
  if (iconFile) iconFile.addEventListener("change", function () {
    var f = iconFile.files && iconFile.files[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type || "")) { setStatus("err", "Foto: envie <b>PNG, JPG ou WebP</b> (vira JPEG sozinha)."); return; }
    if (f.size > 8 * 1024 * 1024) { setStatus("err", "Foto grande demais (máx. <b>8 MB</b>)."); return; }
    iconName.textContent = "Convertendo para JPEG…";
    fileToJpegBytes(f).then(function (bytes) {
      selectedIconBytes = bytes;
      presetBytes = null;
      iconPreset = null;
      wantIcon.checked = true;
      iconName.textContent = f.name + " → world_icon.jpeg (" + fmtSize(bytes.length) + ")";
      showIconPreview(new Blob([bytes], { type: "image/jpeg" }));
      setStatus(null);
    }).catch(function (err) {
      setStatus("err", "Foto: " + escapeHtml((err && err.message) || err));
    });
  });

  // Travas VIP nos selects (manter inventário, dia/noite + clima).
  [["keepinv", "Manter inventário ao morrer é VIP."], ["daycycle", "Travar o ciclo dia/noite é VIP."], ["weather", "Travar o clima é VIP."]].forEach(function (pair) {
    var el = $(pair[0]);
    if (!el) return;
    el.addEventListener("change", function () {
      if (el.value !== "-1" && !needPremium(pair[1])) el.value = "-1";
    });
  });

  /* ---------- conversão local ---------- */
  function selRule(el) {
    if (!el) return null;
    var v = parseInt(el.value, 10);
    return (v === 0 || v === 1) ? v : null;
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selected || submit.disabled) return;
    if (!accept.checked) { setStatus("err", "Para converter, você precisa <b>aceitar os Termos</b> marcando a caixinha acima."); return; }

    var prem = remotePremOk();
    var premUnlimited = isPremiumAny(); // Premium da conta (AbacatePay)
    var batch = selectedList.length > 1;
    var mode = "survival";
    try {
      var gs = $("gamemode");
      if (gs && premUnlimited && ["survival", "creative", "adventure", "keep"].indexOf(gs.value) >= 0) mode = gs.value;
      if (mode === "keep" && !premUnlimited) mode = "survival";
    } catch (e2) { mode = "survival"; }
    var rules = {
      keepinventory: selRule(keepSel),
      showcoordinates: selRule(coordSel),
      dodaylightcycle: null,
      doweathercycle: null
    };
    var dv = selRule(daySel);
    if (dv !== null) rules.dodaylightcycle = dv === 0 ? 0 : 1; // travar = dodaylightcycle 0
    var wv = selRule(weatherSel);
    if (wv !== null) rules.doweathercycle = wv === 0 ? 0 : 1;
    var wantsTime = rules.dodaylightcycle !== null || rules.doweathercycle !== null;
    var wantsKeep = rules.keepinventory !== null;
    var iconBytes = (wantIcon.checked && (selectedIconBytes || presetBytes)) || null;
    var wantsPrem = !!iconBytes || batch || (mode !== "survival" && mode !== "keep") || wantsTime || wantsKeep;
    if (wantsPrem && !loggedIn()) {
      setStatus("err", "Essa função é VIP. <a href='minha-conta.html'><b>Entre com Google</b></a> primeiro, depois assine.");
      try { if (window.RC_auth) window.RC_auth.openModal(); } catch (e3) {}
      return;
    }
    var diffSel = $("difficulty");
    var difficulty = diffSel ? parseInt(diffSel.value, 10) : -1;
    if (!(difficulty >= 0 && difficulty <= 3)) difficulty = null; // conquistas exigem Sobrevivência
    if (wantIcon.checked && !prem) { lockedHint("Trocar a foto do mundo é VIP."); return; }
    if (wantsTime && !prem) { lockedHint("Travar dia/noite e clima é VIP."); return; }
    if (wantsKeep && !prem) { lockedHint("Manter inventário ao morrer é VIP."); return; }
    var newName = wantRename && wantRename.checked ? (renameInput.value || "").replace(/\s+/g, " ").trim().slice(0, 60) : "";

    if (batch && !premUnlimited) { lockedHint("Converter vários arquivos de uma vez é VIP. No grátis, converta um por vez."); return; }
    // tamanho vale na hora do clique (o VIP pode ter expirado depois da seleção)
    var maxB = sizeLimitMB() * 1024 * 1024;
    var tooBig = selectedList.filter(function (f) { return f.size > maxB; });
    if (tooBig.length) {
      if (!remotePremOk()) lockedHint("Esse mundo passa de 10 MB (" + tooBig[0].name + "). Mundos gigantes são VIP — conversão ilimitada, sem limite de tamanho.");
      else setStatus("err", "Arquivo grande até para o navegador (máx. <b>500 MB</b>): " + escapeHtml(tooBig[0].name));
      return;
    }
    if (typeof window.RC_convert === "undefined" || ((batch || /\.dat$/i.test(selected.name || "")) && typeof window.RC_local === "undefined")) {
      setStatus("err", "Conversor ainda carregando (JSZip). Aguarde 5s e tente de novo.");
      return;
    }

    setStatus("", '<span class="spin"></span> Corrigindo <b>no seu PC</b>, aguarde… (arquivo não é enviado)');
    submit.disabled = true;

    var iconPromise = Promise.resolve(wantIcon.checked ? iconBytes : null);

    function downloadBlob(blob, name) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    var DIFFS = ["Pacífico", "Fácil", "Normal", "Difícil"];
  function diffName(v) { return DIFFS[v] || ("nível " + v); }
  function summarizeChanges(changes) {
    var list = changes || [];
    var out = [];
    var flags = list.filter(function (c) { return /^byte /.test(c); }).length;
    if (flags) out.push("conquistas liberadas (" + flags + " ajustes)");
    var gm = null;
    list.forEach(function (c) {
      var g2 = /\(GameType\) = \d+ -> (\d)/.exec(c);
      if (g2) gm = +g2[1];
    });
    var GMN = ["Sobrevivência", "Criativo", "Aventura"];
    out.push(gm === null ? "modo Sobrevivência confirmado" : ("modo " + (GMN[gm] || gm) + " aplicado"));
    var RULE_TXT = { keepinventory: "manter inventário", showcoordinates: "coordenadas na tela", dodaylightcycle: "ciclo dia/noite", doweathercycle: "clima" };
    list.forEach(function (c) {
      var dm = /\(Difficulty\) = \d+ -> (\d)/.exec(c);
      if (dm) { out.push("dificuldade " + diffName(+dm[1])); return; }
      var rl = /\((keepinventory|showcoordinates|dodaylightcycle|doweathercycle)\) = \d+ -> (\d)/.exec(c);
      if (rl) { out.push((RULE_TXT[rl[1]] || rl[1]) + (rl[2] === "1" ? " ligado" : " desligado")); return; }
      if (/foto do mundo|world_icon/.test(c)) { out.push("foto do mundo atualizada"); return; }
      if (/nome alterado/.test(c)) { out.push("mundo renomeado"); return; }
      if (/levelname\.txt/.test(c)) { out.push("nome em levelname.txt"); return; }
    });
    return out.join(" · ");
  }

  function finishSingle(outName, f, res, iconBytes) {
      downloadBlob(res.blob, outName);
      paintQuota();
      // gatilho pós-valor: só aparece DEPOIS da conversão grátis dar certo
      var nudge = isPremiumAny() ? "" : "<br><span style='font-size:13px'>Curtiu? O <a href='#planos'><b>VIP</b></a> libera mundos gigantes, foto e modo de jogo.</span>";
      setStatus("ok", "Pronto. Download iniciado: <b>" + escapeHtml(outName) +
        "</b><br>" + escapeHtml(summarizeChanges(res.changes)) +
        ". Abra em <b>Sobrevivência</b>, com cheats <b>desligados</b>. <b>Guarde o original</b>." + nudge);
      submit.disabled = false;
    }

    // level.dat direto (1 arquivo): foto não existe avulsa,
    // mas nome e regras ficam dentro do NBT e aplicam.
    if (!batch && /\.dat$/i.test(selected.name || "")) {
      selected.arrayBuffer().then(function (ab) {
        return window.RC_local.patchLevelDat(ab, mode, difficulty, { rules: rules, worldName: newName });
      }).then(function (res) {
        finishSingle(selected.name.replace(/\.dat$/i, "") + "-conquistas.dat", selected, res, null);
      }).catch(function (err) {
        setStatus("err", friendlyFileErr(err));
        submit.disabled = false;
      });
      return;
    }

    // lote VIP: vale modo + regras (foto/nome: um por vez)
    if (batch) {
      if ((wantIcon.checked && iconBytes) || newName) {
        setStatus("err", "No lote, <b>foto e nome único</b> não se aplicam — um por vez para usá-los.");
        submit.disabled = false;
        return;
      }
      window.RC_local.convertBatch(selectedList, { gameMode: mode, difficulty: difficulty, rules: rules }).then(function (results) {
        results.forEach(function (r) {
          downloadBlob(r.blob, r.outName);
        });
        paintQuota();
        setStatus("ok", "Pronto. <b>" + results.length + " arquivos</b> corrigidos e baixados. Abra em <b>Sobrevivência</b>, com cheats <b>desligados</b>. <b>Guarde os originais</b>.");
        submit.disabled = false;
      }).catch(function (err) {
        setStatus("err", friendlyFileErr(err));
        submit.disabled = false;
      });
      return;
    }

    Promise.all([selected.arrayBuffer(), iconPromise]).then(function (arr) {
      if (wantIcon.checked && arr[1] && !(arr[1][0] === 0xFF && arr[1][1] === 0xD8)) {
        throw new Error("Ícone inválido: o mundo usa world_icon.jpeg (JPEG). Escolha a imagem de novo.");
      }
      return window.RC_convert(arr[0], { gameMode: mode, iconBytes: arr[1], worldName: newName, difficulty: difficulty, rules: rules }).then(function (res) {
        return { res: res, iconBytes: arr[1] };
      });
    }).then(function (both) {
      finishSingle(baseName(selected.name), selected, both.res, both.iconBytes);
    }).catch(function (err) {
      setStatus("err", friendlyFileErr(err));
      submit.disabled = false;
    });
  });

  /* ---------- diagnóstico --check (somente leitura, não consome cota) ---------- */
  if (diagBtn) diagBtn.addEventListener("click", function () {
    if (!selected) { input.click(); return; }
    if (typeof window.RC_local === "undefined") {
      setStatus("err", "Ferramentas locais ainda carregando. Aguarde 5s e tente de novo.");
      return;
    }
    var f = selectedList.length > 1 ? selectedList[0] : selected;
    setStatus("", '<span class="spin"></span> Analisando <b>sem modificar nada</b>…');
    diagBtn.disabled = true;
    f.arrayBuffer().then(function (ab) {
      return window.RC_local.diagnoseAny(ab, f.name);
    }).then(function (rep) {
      diagBtn.disabled = false;
      if (!rep.ok) { setStatus("err", "Não deu para analisar: " + escapeHtml(rep.error || "arquivo inválido")); return; }
      if (rep.alreadyClean) {
        setStatus("ok", "<b>" + escapeHtml(f.name) + "</b> já está limpo (flags zeradas" +
          (rep.gameType.length ? ", GameType = " + rep.gameType.join(", ") : "") + "). Nada a corrigir." +
          (selectedList.length > 1 ? " (mostrei o 1º de " + selectedList.length + ")" : ""));
        return;
      }
      var det = rep.wouldChange.slice(0, 8).map(escapeHtml).join("<br>· ");
      var RULE_LBL = { keepinventory: "manter inventário", showcoordinates: "coordenadas na tela", dodaylightcycle: "ciclo dia/noite", doweathercycle: "clima" };
      var gr = rep.gamerules || {};
      var grTxt = Object.keys(RULE_LBL).map(function (k) {
        return gr[k] === null || gr[k] === undefined ? null : RULE_LBL[k] + " = <b>" + (gr[k] ? "ligado" : "desligado") + "</b>";
      }).filter(Boolean).join(" · ");
      var lockedTxt = rep.locked && ((rep.locked.hasLockedBehaviorPack || []).indexOf(1) >= 0 || (rep.locked.hasLockedResourcePack || []).indexOf(1) >= 0)
        ? "<br>Trava de pack: <b>ativa</b> — remova os behavior packs <b>dentro do jogo</b> antes de exportar o mundo" : "";
      // gatilho contextual: mundo em Criativo/Aventura + usuário grátis
      var vipMode = (!isPremiumAny() && (rep.gameType || []).filter(function (g) { return +g !== 0 && String(g).indexOf("tag") !== 0; }).length)
        ? "<br>Quer <b>manter o Criativo/Aventura</b> em vez de ir para Sobrevivência? Só o <a href='#planos'><b>VIP</b></a> permite." : "";
      setStatus("", "Diagnóstico de <b>" + escapeHtml(f.name) + "</b> — <b>nada foi alterado</b>:<br>· " + det +
        ((rep.worldName && rep.worldName[0]) ? "<br>Nome no level.dat: <b>" + escapeHtml(rep.worldName[0]) + "</b>" : "") +
        ((rep.seed && rep.seed[0]) ? "<br>Seed: <b>" + escapeHtml(rep.seed[0]) + "</b>" : "") +
        (rep.gameType.length ? "<br>Modo atual (GameType): <b>" + rep.gameType.join(", ") + "</b> (0 = Sobrevivência, 1 = Criativo)" : "") +
        (rep.difficulty && rep.difficulty.length ? "<br>Dificuldade atual: <b>" + diffName(rep.difficulty[0]) + "</b>" : "") +
        (grTxt ? "<br>Regras: " + grTxt : "") + lockedTxt + vipMode +
        "<br><br>Aperte <b>Corrigir meu mundo</b> para aplicar.");
    }).catch(function (err) {
      diagBtn.disabled = false;
      setStatus("err", "Não deu para analisar: " + escapeHtml((err && err.message) || err));
    });
  });

  paintContact();
  paintPresets();
  paintQuota();
  refreshRemotePrem(); // Premium da conta (se logado) — atualiza a cota sozinho
  document.addEventListener("rc-auth", function () {
    setTimeout(function () {
      var u = null;
      try { u = (window.RC_auth && window.RC_auth.user()) || null; } catch (e) {}
      if (!u) {
        // deslogou: limpa qualquer resto de Premium e volta pro grátis na hora
        try { localStorage.removeItem("rc_prem_remote"); } catch (e) {}
        paintQuota();
        return;
      }
      refreshRemotePrem();
    }, 150);
  });
})();
