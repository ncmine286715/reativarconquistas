/* ReativaConquistas — frontend ESTÁTICO (sem servidor, sem AbacatePay)
   Conversão 100% local (converter.js) + licença Kiwify (codes.js).
   Cota grátis: 1/semana por navegador (localStorage). Premium via código.
*/
(function () {
  "use strict";

  var CFG = window.RC_CONFIG || {};
  var PRODUCTS = CFG.PRODUCTS || {};
  var FREE_PER_WEEK = CFG.FREE_PER_WEEK || 1;
  var WEEK_MS = 7 * 24 * 3600 * 1000;

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var form = $("form"), input = $("file"), drop = $("drop"),
      fileName = $("fileName"), submit = $("submit"), strip = $("strip"),
      accept = $("accept"), status = $("status"),
      quotaBar = $("quotaBar"), quotaText = $("quotaText"),
      creativeLabel = $("creativeLabel"),
      wantIcon = $("wantIcon"), iconFile = $("iconFile"), iconBtn = $("iconBtn"),
      iconPreview = $("iconPreview"), iconName = $("iconName"),
      wantRename = $("wantRename"), renameInput = $("renameInput");

  var licModal = $("licModal");
  var selected = null, selectedIcon = null, selectedList = [];
  var diagBtn = $("diagnose");

  /* ---------- preços / links Kiwify ---------- */
  function paintProducts() {
    ["single", "monthly", "lifetime"].forEach(function (k) {
      var p = PRODUCTS[k];
      if (!p) return;
      var priceEl = document.getElementById("price-" + k);
      if (priceEl && p.price) priceEl.textContent = p.price;
      var btns = document.querySelectorAll('[data-buy="' + k + '"]');
      btns.forEach(function (b) {
        if (p.url) { b.href = p.url; b.classList.remove("disabled"); }
        else {
          b.href = "sucesso.html";
          b.setAttribute("data-noconfig", "1");
        }
      });
    });
    if (CFG.SUPPORT_EMAIL) {
      document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
        if (a.id !== "supEmail") a.href = "mailto:" + CFG.SUPPORT_EMAIL;
      });
      var se = $("supEmail");
      if (se) se.textContent = CFG.SUPPORT_EMAIL;
    }
    if (CFG.OPERATOR_CITY_UF) { var oc = $("opCity"); if (oc) oc.textContent = CFG.OPERATOR_CITY_UF; }
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-buy]');
    if (b && b.getAttribute("data-noconfig")) {
      e.preventDefault();
      setStatus("", "Os links da Kiwify ainda não foram configurados neste site. Fale com <b>" + escapeHtml(CFG.SUPPORT_EMAIL || "o suporte") + "</b> ou veja o <b>KIWIFY_SETUP.md</b>.");
      document.getElementById("converter").scrollIntoView({ behavior: "smooth" });
    }
  });

  /* ---------- licença ---------- */
  function lic() { try { return window.RC_codes.getLicense(); } catch (e) { return null; } }
  function isPremium() { try { return window.RC_codes.isPremium(); } catch (e) { return false; } }
  // Premium da conta (pagamento Abacate) — soma ao código local.
  function remotePremUntil() {
    try {
      var r = JSON.parse(localStorage.getItem("rc_prem_remote") || "null");
      return (r && +r.until) || 0;
    } catch (e) { return 0; }
  }
  function remotePremOk() { return remotePremUntil() > Date.now(); }
  function isPremiumAny() { return isPremium() || remotePremOk(); }
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

  function quotaUses() {
    try {
      var arr = JSON.parse(localStorage.getItem("rc_quota") || "[]");
      var now = Date.now();
      arr = arr.filter(function (t) { return now - t < WEEK_MS; });
      localStorage.setItem("rc_quota", JSON.stringify(arr));
      return arr;
    } catch (e) { return []; }
  }
  function quotaAdd() {
    var arr = quotaUses(); arr.push(Date.now());
    try { localStorage.setItem("rc_quota", JSON.stringify(arr)); } catch (e) {}
  }
  function freeLeft() { return Math.max(0, FREE_PER_WEEK - quotaUses().length); }

  function paintQuota() {
    var l = lic();
    if (remotePremOk() && !(l && (l.type === "M" || l.type === "V"))) {
      quotaBar.classList.add("premium");
      quotaText.innerHTML = "<strong>Premium ativo</strong> na sua conta até <strong>" + new Date(remotePremUntil()).toLocaleDateString("pt-BR") + "</strong> — ilimitado. <a href='minha-conta.html'>Minha conta</a>";
      updateSubmit();
      return;
    }
    if (l && (l.type === "M" || l.type === "V")) {
      quotaBar.classList.add("premium");
      var txt = l.type === "V"
        ? "<strong>Vitalício ativo</strong> — conversões ilimitadas neste navegador."
        : "<strong>Premium ativo</strong> até <strong>" + new Date(l.expiresAt).toLocaleDateString("pt-BR") + "</strong> — ilimitado.";
      quotaText.innerHTML = txt + ' <a href="#" id="licManage">Gerenciar código</a>';
    } else if (l && l.type === "A") {
      quotaBar.classList.remove("premium");
      quotaText.innerHTML = "Você tem <strong>1 conversão avulsa</strong> liberada neste navegador. <a href='#planos'>Ver planos</a>";
    } else {
      quotaBar.classList.remove("premium");
      var left = freeLeft();
      if (left > 0) {
        quotaText.innerHTML = "Você tem <strong>" + left + " conversão grátis</strong> esta semana, sem cadastro. Arquivo processado <strong>no seu PC</strong>. <a href='#planos'>Ver o Premium</a>";
      } else {
        var arr = quotaUses();
        var next = arr.length ? new Date(arr[0] + WEEK_MS).toLocaleDateString("pt-BR") : "";
        quotaText.innerHTML = "Sua <strong>cota grátis acabou</strong>" + (next ? " (renova em <strong>" + next + "</strong>)" : "") + ". <a href='#planos'>Liberar com código Kiwify</a>";
      }
    }
    var m = $("licManage");
    if (m) m.addEventListener("click", function (e) { e.preventDefault(); openLic(); });
    updateSubmit();
  }

  /* ---------- status ---------- */
  function setStatus(kind, html) {
    if (!kind) { status.hidden = true; status.className = "status"; status.textContent = ""; return; }
    status.hidden = false;
    status.className = "status " + kind;
    status.innerHTML = html;
  }
  function lockedHint(msg) {
    setStatus("", escapeHtml(msg) + ' <a href="#planos"><b>Ver planos Kiwify</b></a> · <a href="#" data-lic><b>Tenho código</b></a>');
  }

  /* ---------- arquivo ---------- */
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function baseName(name) { return name.replace(/\.(mcworld|zip)$/i, "") + "-conquistas.mcworld"; }

  var ACCEPT = /\.(mcworld|zip|dat)$/i;

  function pick(list) {
    if (!list || !list.length) return; // usuário cancelou a janela: mantém seleção
    var files = Array.prototype.slice.call(list || []);
    files = files.filter(function (f) { return ACCEPT.test(f.name || ""); });
    if (!files.length) {
      selected = null; selectedList = [];
      fileName.hidden = true; updateSubmit();
      setStatus("err", "Formato não suportado. Envie <b>.mcworld</b>, <b>.zip</b> ou <b>level.dat</b>.");
      return;
    }
    var big = files.filter(function (f) { return f.size > 100 * 1024 * 1024; });
    if (big.length) {
      selected = null; selectedList = [];
      fileName.hidden = true; updateSubmit();
      setStatus("err", "Arquivo grande demais (máx. <b>100 MB</b> cada): " + escapeHtml(big[0].name));
      return;
    }
    selectedList = files;
    selected = files[0];
    if (files.length > 1) {
      fileName.textContent = files.length + " arquivos selecionados (lote = Premium)";
      fileName.hidden = false;
      setStatus(null);
    } else if (selected) {
      fileName.textContent = selected.name + "  (" + fmtSize(selected.size) + ")";
      fileName.hidden = false;
      setStatus(null);
    }
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

  if (strip) strip.addEventListener("change", function () {
    if (strip.checked && !lic()) { strip.checked = false; lockedHint("Remover behavior packs é Premium (código Kiwify)."); }
  });
  if (creativeLabel) creativeLabel.addEventListener("click", function () {
    if (!lic()) {
      var r = document.querySelector('input[name="gamemode"][value="survival"]');
      setTimeout(function () { if (r) r.checked = true; }, 0);
      lockedHint("Modo Criativo é Premium (código Kiwify).");
    }
  });
  if (wantIcon) wantIcon.addEventListener("change", function () {
    if (wantIcon.checked && !lic()) { wantIcon.checked = false; lockedHint("Trocar a foto do mundo é Premium."); }
  });
  if (wantRename) wantRename.addEventListener("change", function () {
    if (wantRename.checked && !lic()) { wantRename.checked = false; lockedHint("Renomear o mundo é Premium."); return; }
    if (wantRename.checked) renameInput.focus();
  });
  if (iconBtn) iconBtn.addEventListener("click", function () {
    if (!lic()) { lockedHint("Trocar a foto do mundo é Premium."); return; }
    iconFile.click();
  });
  if (iconFile) iconFile.addEventListener("change", function () {
    var f = iconFile.files && iconFile.files[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setStatus("err", "Ícone: envie <b>PNG ou JPG</b>."); return; }
    if (f.size > 5 * 1024 * 1024) { setStatus("err", "Ícone grande demais (máx. <b>5 MB</b>)."); return; }
    selectedIcon = f;
    wantIcon.checked = true;
    iconName.textContent = f.name + " (" + fmtSize(f.size) + ")";
    var url = URL.createObjectURL(f);
    iconPreview.src = url; iconPreview.style.display = "block";
    setStatus(null);
  });

  /* ---------- modal licença ---------- */
  function openLic() { if (licModal) { licModal.classList.add("open"); paintLicState(); } }
  function closeLic() { if (licModal) licModal.classList.remove("open"); }
  function paintLicState() {
    var l = lic();
    var box = $("licState");
    if (!box) return;
    if (l && (l.type === "M" || l.type === "V")) {
      var info = window.RC_codes.typeInfo(l.type);
      box.innerHTML = "Código ativo: <b>" + escapeHtml(l.code) + "</b> (" + info.label + ")" +
        (l.type === "M" ? " até <b>" + new Date(l.expiresAt).toLocaleDateString("pt-BR") + "</b>." : " (sem validade).") +
        ' <a href="#" id="licClear">Remover</a>';
      var c = $("licClear");
      if (c) c.addEventListener("click", function (e) {
        e.preventDefault();
        try { localStorage.removeItem("rc_license_v1"); } catch (err) {}
        paintQuota(); paintLicState();
      });
    } else if (l && l.type === "A") {
      box.innerHTML = "Código avulso pronto: <b>" + escapeHtml(l.code) + "</b> (vale 1 conversão).";
    } else {
      box.innerHTML = "Nenhum código ativo neste navegador.";
    }
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-lic]");
    if (t) { e.preventDefault(); openLic(); }
  });
  var navLic = $("navLic");
  if (navLic) navLic.addEventListener("click", function (e) { e.preventDefault(); openLic(); });
  if (licModal) {
    licModal.addEventListener("click", function (e) { if (e.target === licModal) closeLic(); });
    var cx = $("licCancel");
    if (cx) cx.addEventListener("click", closeLic);
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLic(); });

  var licGo = $("licGo");
  if (licGo) licGo.addEventListener("click", function () {
    var raw = ($("licInput").value || "").trim();
    if (!raw) { $("licInput").focus(); return; }
    licGo.disabled = true; licGo.textContent = "Verificando…";
    window.RC_codes.activateCode(raw).then(function (r) {
      licGo.disabled = false; licGo.textContent = "Ativar";
      if (!r.valid) {
        setStatus("err", "Código inválido: " + escapeHtml(r.reason || "confira e tente de novo."));
        closeLic();
        document.getElementById("converter").scrollIntoView({ behavior: "smooth" });
        return;
      }
      closeLic(); paintQuota();
      setStatus("ok", "Código <b>" + escapeHtml(r.label) + "</b> ativo neste navegador. Pode converter.");
    }).catch(function () {
      licGo.disabled = false; licGo.textContent = "Ativar";
      setStatus("err", "Não deu para validar o código. Tente de novo.");
    });
  });

  /* ---------- conversão local ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selected || submit.disabled) return;
    if (!accept.checked) { setStatus("err", "Para converter, você precisa <b>aceitar os Termos</b> marcando a caixinha acima."); return; }

    var l = lic();
    var prem = !!(l && (l.type === "M" || l.type === "V" || l.type === "A"));
    if (remotePremOk()) prem = true;
    var premUnlimited = isPremiumAny(); // código M/V ou Premium da conta
    var mode = (document.querySelector('input[name="gamemode"]:checked') || {}).value || "survival";
    if (mode === "creative" && !prem) { lockedHint("Modo Criativo é Premium."); return; }
    if (strip.checked && !prem) { lockedHint("Remover behavior packs é Premium."); return; }
    if (wantIcon.checked && !prem) { lockedHint("Trocar a foto do mundo é Premium."); return; }
    var newName = wantRename && wantRename.checked ? (renameInput.value || "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if ((wantRename && wantRename.checked && !prem) || (newName && !prem)) { lockedHint("Renomear o mundo é Premium."); return; }
    if (!prem && freeLeft() <= 0) { setStatus("err", "Sua <b>cota grátis acabou</b> esta semana. <a href='#planos'><b>Ver planos Kiwify</b></a> ou <a href='#' data-lic><b>ativar código</b></a>"); return; }

    var batch = selectedList.length > 1;
    if (batch && !premUnlimited) { lockedHint("Converter vários arquivos de uma vez é Premium (código Kiwify). No grátis/avulso, converta um por vez."); return; }
    if (typeof window.RC_convert === "undefined" || ((batch || /\.dat$/i.test(selected.name || "")) && typeof window.RC_local === "undefined")) {
      setStatus("err", "Conversor ainda carregando (JSZip). Aguarde 5s e tente de novo.");
      return;
    }

    setStatus("", '<span class="spin"></span> Corrigindo <b>no seu PC</b>, aguarde… (arquivo não é enviado)');
    submit.disabled = true;

    var iconPromise = Promise.resolve(null);
    if (wantIcon.checked && selectedIcon) {
      iconPromise = selectedIcon.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }

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

    function finishSingle(outName, f, res, iconBytes) {
      downloadBlob(res.blob, outName);
      if (l && l.type === "A") { try { window.RC_codes.consumeSingleUse(); } catch (err) {} }
      else if (!isPremiumAny()) { quotaAdd(); }
      paintQuota();
      var det = (res.changes || []).slice(0, 6).map(escapeHtml).join("<br>· ");
      setStatus("ok", "Pronto. Download iniciado: <b>" + escapeHtml(outName) +
        "</b>. Abra em <b>" + (mode === "creative" ? "Criativo" : "Sobrevivência") + "</b>" +
        (mode === "survival" ? " e com cheats <b>desligados</b>" : "") +
        ". <b>Guarde o original</b>." + (det ? "<br><span style='font-size:12.5px;color:var(--muted)'>· " + det + "</span>" : ""));
      submit.disabled = false;
    }

    // level.dat direto (1 arquivo): foto/nome/behavior são opções de .mcworld
    if (!batch && /\.dat$/i.test(selected.name || "")) {
      selected.arrayBuffer().then(function (ab) {
        return window.RC_local.patchLevelDat(ab, mode);
      }).then(function (res) {
        finishSingle(selected.name.replace(/\.dat$/i, "") + "-conquistas.dat", selected, res, null);
      }).catch(function (err) {
        setStatus("err", "Não deu certo: " + escapeHtml((err && err.message) || err));
        submit.disabled = false;
      });
      return;
    }

    // lote premium: vale modo + behavior pack (foto/nome: um arquivo por vez)
    if (batch) {
      if ((wantIcon.checked && selectedIcon) || newName) {
        setStatus("err", "No lote, <b>foto e nome</b> não se aplicam — converta um arquivo por vez para usá-los.");
        submit.disabled = false;
        return;
      }
      window.RC_local.convertBatch(selectedList, { gameMode: mode, strip: strip.checked }).then(function (results) {
        results.forEach(function (r) {
          downloadBlob(r.blob, r.outName);
        });
        paintQuota();
        setStatus("ok", "Pronto. <b>" + results.length + " arquivos</b> corrigidos e baixados. Abra em <b>" +
          (mode === "creative" ? "Criativo" : "Sobrevivência") + "</b>. <b>Guarde os originais</b>.");
        submit.disabled = false;
      }).catch(function (err) {
        setStatus("err", "Não deu certo: " + escapeHtml((err && err.message) || err));
        submit.disabled = false;
      });
      return;
    }

    Promise.all([selected.arrayBuffer(), iconPromise]).then(function (arr) {
      return window.RC_convert(arr[0], { gameMode: mode, strip: strip.checked, iconBytes: arr[1], worldName: newName }).then(function (res) {
        return { res: res, iconBytes: arr[1] };
      });
    }).then(function (both) {
      finishSingle(baseName(selected.name), selected, both.res, both.iconBytes);
    }).catch(function (err) {
      setStatus("err", "Não deu certo: " + escapeHtml((err && err.message) || err));
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
      setStatus("", "Diagnóstico de <b>" + escapeHtml(f.name) + "</b> — <b>nada foi alterado</b>:<br>· " + det +
        (rep.gameType.length ? "<br>Modo atual (GameType): <b>" + rep.gameType.join(", ") + "</b> (0 = Sobrevivência, 1 = Criativo)" : "") +
        "<br><br>Aperte <b>Corrigir e baixar</b> para aplicar.");
    }).catch(function (err) {
      diagBtn.disabled = false;
      setStatus("err", "Não deu para analisar: " + escapeHtml((err && err.message) || err));
    });
  });

  // ?codigo= na URL (volta da Kiwify / e-mail) ativa sozinho
  try {
    var q = new URLSearchParams(location.search).get("codigo");
    if (q) {
      var inp = $("licInput");
      if (inp) inp.value = q;
      openLic();
    }
  } catch (e) {}

  paintProducts();
  paintQuota();
  refreshRemotePrem(); // Premium da conta (se logado) — atualiza a cota sozinho
  document.addEventListener("rc-auth", function () { setTimeout(refreshRemotePrem, 150); });
})();
