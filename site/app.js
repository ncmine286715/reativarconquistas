/* ReativaConquistas — frontend (conversão 100% local + conta + AbacatePay).
   Grátis: 1 conversão/semana por navegador (localStorage). Premium: conta
   com pagamento via AbacatePay (Worker). Sem servidor próprio, sem Kiwify.
*/
(function () {
  "use strict";

  var CFG = window.RC_CONFIG || {};
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
      wantIcon = $("wantIcon"), iconFile = $("iconFile"), iconBtn = $("iconBtn"),
      iconPreview = $("iconPreview"), iconName = $("iconName"),
      wantRename = $("wantRename"), renameInput = $("renameInput");

  var FREE_MAX_MB = 10, PRE_MAX_MB = 500;

  var selected = null, selectedIcon = null, selectedList = [];
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
    if (remotePremOk()) {
      quotaBar.classList.add("premium");
      quotaText.innerHTML = "<strong>Premium ativo</strong> na sua conta até <strong>" + new Date(remotePremUntil()).toLocaleDateString("pt-BR") + "</strong> — ilimitado. <a href='minha-conta.html'>Minha conta</a>";
    } else {
      quotaBar.classList.remove("premium");
      var left = freeLeft();
      if (left > 0) {
        quotaText.innerHTML = "Você tem <strong>" + left + " conversão grátis</strong> esta semana, sem cadastro. Arquivo processado <strong>no seu PC</strong>. <a href='#planos'>Ver o Premium</a>";
      } else {
        var arr = quotaUses();
        var next = arr.length ? new Date(arr[0] + WEEK_MS).toLocaleDateString("pt-BR") : "";
        quotaText.innerHTML = "Sua <strong>cota grátis acabou</strong>" + (next ? " (renova em <strong>" + next + "</strong>)" : "") + ". <a href='#planos'><b>Assinar o Premium</b></a>";
      }
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
  function lockedHint(msg) {
    setStatus("", escapeHtml(msg) + ' <a href="#planos"><b>Ver planos</b></a> · <a href="minha-conta.html"><b>Minha conta</b></a>');
    // upsell direto: recurso Premium abre o popup de assinatura na hora
    try { if (window.RC_pay && window.RC_pay.enabled()) window.RC_pay.openPayModal(msg); } catch (e) {}
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

  function pick(list) {
    if (!list || !list.length) return; // usuário cancelou a janela: mantém seleção
    var files = Array.prototype.slice.call(list || []);
    files = files.filter(function (f) { return ACCEPT.test(f.name || ""); });
    if (!files.length) {
      var got = Array.prototype.slice.call(list || []).map(function (f) { return f.name || "?"; }).slice(0, 3).join(", ");
      selected = null; selectedList = [];
      fileName.hidden = true; updateSubmit();
      setStatus("err", "Formato não suportado" + (got ? " (<b>" + escapeHtml(got) + "</b>)" : "") + ". Envie <b>.mcworld</b>, <b>.zip</b> do mundo ou <b>level.dat</b> — foto, .mcpack e .mcaddon <b>não são mundo</b>. Veja <a href='#faq'><b>onde achar o .mcworld</b></a>.");
      return;
    }
    var empty = files.filter(function (f) { return !f.size; });
    if (empty.length) {
      selected = null; selectedList = [];
      fileName.hidden = true; updateSubmit();
      setStatus("err", "O arquivo <b>" + escapeHtml(empty[0].name) + "</b> está <b>vazio</b> (0 bytes). Exporte o mundo de novo.");
      return;
    }
    var maxB = sizeLimitMB() * 1024 * 1024;
    var big = files.filter(function (f) { return f.size > maxB; });
    if (big.length) {
      selected = null; selectedList = [];
      fileName.hidden = true; updateSubmit();
      if (!remotePremOk()) {
        setStatus("err", "Esse mundo passa de <b>10 MB</b> (" + escapeHtml(big[0].name) + "). No grátis o limite é 10 MB — <a href='#planos'><b>o Premium aceita mundos gigantes</b></a>.");
      } else {
        setStatus("err", "Arquivo grande até para o navegador (máx. <b>500 MB</b>): " + escapeHtml(big[0].name));
      }
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
    if (strip.checked && !remotePremOk()) { strip.checked = false; lockedHint("Remover behavior packs é Premium."); }
  });
  if (wantIcon) wantIcon.addEventListener("change", function () {
    if (wantIcon.checked && !remotePremOk()) { wantIcon.checked = false; lockedHint("Trocar a foto do mundo é Premium."); }
  });
  if (wantRename) wantRename.addEventListener("change", function () {
    if (wantRename.checked && !remotePremOk()) { wantRename.checked = false; lockedHint("Renomear o mundo é Premium."); return; }
    if (wantRename.checked) renameInput.focus();
  });
  if (iconBtn) iconBtn.addEventListener("click", function () {
    if (!remotePremOk()) { lockedHint("Trocar a foto do mundo é Premium."); return; }
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

  /* ---------- conversão local ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selected || submit.disabled) return;
    if (!accept.checked) { setStatus("err", "Para converter, você precisa <b>aceitar os Termos</b> marcando a caixinha acima."); return; }

    var prem = remotePremOk();
    var premUnlimited = isPremiumAny(); // Premium da conta (AbacatePay)
    var mode = "survival"; // conquistas exigem Sobrevivência
    if (strip.checked && !prem) { lockedHint("Remover behavior packs é Premium."); return; }
    if (wantIcon.checked && !prem) { lockedHint("Trocar a foto do mundo é Premium."); return; }
    var newName = wantRename && wantRename.checked ? (renameInput.value || "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if ((wantRename && wantRename.checked && !prem) || (newName && !prem)) { lockedHint("Renomear o mundo é Premium."); return; }
    if (!prem && freeLeft() <= 0) { setStatus("err", "Sua <b>cota grátis acabou</b> esta semana. <a href='#planos'><b>Assinar o Premium</b></a> ou <a href='minha-conta.html'><b>entrar na conta</b></a>"); return; }

    var batch = selectedList.length > 1;
    if (batch && !premUnlimited) { lockedHint("Converter vários arquivos de uma vez é Premium. No grátis, converta um por vez."); return; }
    // tamanho vale na hora do clique (o Premium pode ter expirado depois da seleção)
    var maxB = sizeLimitMB() * 1024 * 1024;
    var tooBig = selectedList.filter(function (f) { return f.size > maxB; });
    if (tooBig.length) {
      if (!remotePremOk()) setStatus("err", "Esse mundo passa de <b>10 MB</b> (" + escapeHtml(tooBig[0].name) + "). No grátis o limite é 10 MB — <a href='#planos'><b>o Premium aceita mundos gigantes</b></a>.");
      else setStatus("err", "Arquivo grande até para o navegador (máx. <b>500 MB</b>): " + escapeHtml(tooBig[0].name));
      return;
    }
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

    function summarizeChanges(changes) {
    var list = changes || [];
    var out = [];
    var flags = list.filter(function (c) { return /^byte /.test(c); }).length;
    if (flags) out.push("conquistas liberadas (" + flags + " ajustes)");
    var gt = list.some(function (c) { return /GameType/.test(c); });
    out.push(gt ? "modo Sobrevivência aplicado" : "modo Sobrevivência confirmado");
    list.forEach(function (c) {
      if (/removido world_behavior/.test(c)) out.push("behavior packs removidos");
      else if (/ícone/.test(c)) out.push("foto do mundo atualizada");
      else if (/nome alterado/.test(c)) out.push("mundo renomeado");
    });
    return out.join(" · ");
  }

  function finishSingle(outName, f, res, iconBytes) {
      downloadBlob(res.blob, outName);
      if (!isPremiumAny()) { quotaAdd(); }
      paintQuota();
      setStatus("ok", "Pronto. Download iniciado: <b>" + escapeHtml(outName) +
        "</b><br>" + escapeHtml(summarizeChanges(res.changes)) +
        ". Abra em <b>Sobrevivência</b>, com cheats <b>desligados</b>. <b>Guarde o original</b>.");
      submit.disabled = false;
    }

    // level.dat direto (1 arquivo): foto/nome/behavior são opções de .mcworld
    if (!batch && /\.dat$/i.test(selected.name || "")) {
      selected.arrayBuffer().then(function (ab) {
        return window.RC_local.patchLevelDat(ab, mode);
      }).then(function (res) {
        finishSingle(selected.name.replace(/\.dat$/i, "") + "-conquistas.dat", selected, res, null);
      }).catch(function (err) {
        setStatus("err", friendlyFileErr(err));
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
        setStatus("ok", "Pronto. <b>" + results.length + " arquivos</b> corrigidos e baixados. Abra em <b>Sobrevivência</b>, com cheats <b>desligados</b>. <b>Guarde os originais</b>.");
        submit.disabled = false;
      }).catch(function (err) {
        setStatus("err", friendlyFileErr(err));
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
      setStatus("", "Diagnóstico de <b>" + escapeHtml(f.name) + "</b> — <b>nada foi alterado</b>:<br>· " + det +
        (rep.gameType.length ? "<br>Modo atual (GameType): <b>" + rep.gameType.join(", ") + "</b> (0 = Sobrevivência, 1 = Criativo)" : "") +
        "<br><br>Aperte <b>🔧 Corrigir meu mundo</b> para aplicar.");
    }).catch(function (err) {
      diagBtn.disabled = false;
      setStatus("err", "Não deu para analisar: " + escapeHtml((err && err.message) || err));
    });
  });

  paintContact();
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
