/* ReativaConquistas — Editor de player (VIP, 100% local).
   Edita o `~local_player` (ou player_*): hotbar 9 + inventário 27 +
   armadura 4 + ender chest 27 (+ offhand se existir), nível de XP,
   encantamentos (até 255), nome custom, inquebrável e keep_on_death.
   Slots não tocados são recodificados byte-idênticos (round-trip validado);
   só as listas alteradas entram no .log novo. Original intacto, sai arquivo novo.
*/
(function () {
  "use strict";

  var curFile = null, dbData = null, pKey = null, pBytes = null, tree = null;
  var playerDirty = false; // true após qualquer toque do usuário (p/ o botão único)
  var model = null; // {inv:[36], armor:[5], ender:[27], off:[?] , selected, level, dirtyLists}
  var orig = null;  // nós originais p/ recodificar slots intocados
  var itemDB = null, editSlot = null; // {area, idx}

  var ENCH = [
    [0, "Proteção"], [1, "Proteção contra Fogo"], [2, "Peso Pena"], [3, "Proteção contra Explosões"],
    [4, "Proteção contra Projéteis"], [5, "Espinhos"], [6, "Respiração"], [7, "Passos Profundos"],
    [8, "Afinidade Aquática"], [9, "Afiada"], [10, "Julgamento"], [11, "Ruína dos Artrópodes"],
    [12, "Repulsão"], [13, "Aspecto Flamejante"], [14, "Pilhagem"], [15, "Eficiência"],
    [16, "Toque Suave"], [17, "Inquebrável"], [18, "Fortuna"], [19, "Força"],
    [20, "Soco"], [21, "Chama"], [22, "Infinidade"], [23, "Sorte do Mar"],
    [24, "Isca"], [25, "Passos Gelados"], [26, "Remendo"], [27, "Maldição do Vínculo"],
    [28, "Maldição do Desaparecimento"], [29, "Empalamento"], [30, "Correnteza"], [31, "Lealdade"],
    [32, "Condutividade"], [33, "Rajada"], [34, "Perfurante"], [35, "Recarga Rápida"],
    [36, "Velocidade das Almas"]
  ];

  var ALIAS = { espada: "sword", capacete: "helmet", peitoral: "chestplate", calca: "leggings", calça: "leggings", bota: "boots", botas: "boots", picareta: "pickaxe", machado: "axe", pa: "shovel", pá: "shovel", enxada: "hoe", arco: "bow", flecha: "arrow", maca: "apple", maçã: "apple", carne: "beef", totem: "totem", escudo: "shield", elytra: "elytra", elitro: "elytra", perola: "pearl", pérola: "pearl", tocha: "torch", obsidiana: "obsidian", xp: "experience", poco: "potion", poção: "potion", balde: "bucket", vara: "rod", isca: "lure" };

  var ARMOR_LBL = ["Capacete", "Peitoral", "Calça", "Botas"];

  // máximo vanilla por encantamento (Bedrock) — acima disso, só VIP
  var VANILLA_MAX = { 0: 4, 1: 4, 2: 4, 3: 4, 4: 4, 5: 3, 6: 3, 7: 3, 8: 1, 9: 5, 10: 5, 11: 5, 12: 2, 13: 2, 14: 3, 15: 5, 16: 1, 17: 3, 18: 3, 19: 5, 20: 2, 21: 1, 22: 1, 23: 3, 24: 3, 25: 2, 26: 1, 27: 1, 28: 1, 29: 5, 30: 3, 31: 3, 32: 1, 33: 1, 34: 4, 35: 3, 36: 3 };
  function overEnchant(it) {
    for (var i = 0; i < (it.ench || []).length; i++) {
      var mx = VANILLA_MAX[it.ench[i].id];
      if (mx && it.ench[i].lvl > mx) return { id: it.ench[i].id, lvl: it.ench[i].lvl, mx: mx };
    }
    return null;
  }
  function enchName(id) {
    for (var i = 0; i < ENCH.length; i++) if (ENCH[i][0] === id) return ENCH[i][1];
    return "enc#" + id;
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.RC_dbx ? window.RC_dbx.esc(s) : String(s); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function T() { return window.RC_nbt2; }

  function status(html) {
    var el = $("playerStatus");
    if (!el) return;
    if (!html) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false; el.innerHTML = html;
  }

  function emptyItem(slot, withSlot) {
    var m = { Count: 0, Damage: 0, Name: "", WasPickedUp: 0 };
    if (withSlot) m.Slot = slot;
    return m;
  }

  function nodeToItem(node, slotFallback, withSlot) {
    var m = node.v.map || {};
    function num(k, d) { return (m[k] !== undefined) ? m[k].v : d; }
    function str(k) { return (m[k] !== undefined) ? m[k].v : ""; }
    var it = {
      name: str("Name"), count: num("Count", 0), damage: num("Damage", 0),
      slot: (m.Slot !== undefined) ? m.Slot.v : slotFallback,
      picked: num("WasPickedUp", 0), node: node, _original: node,
      ench: [], display: "", unbr: 0, keep: 0, dura: null, repair: null
    };
    var tag = m.tag;
    if (tag && tag.v && tag.v.map) {
      var tm = tag.v.map;
      if (tm.ench && tm.ench.v && tm.ench.v.items) {
        tm.ench.v.items.forEach(function (e) {
          var em = (e.v && e.v.map) || {};
          if (em.id !== undefined) it.ench.push({ id: em.id.v, lvl: em.lvl ? em.lvl.v : 1 });
        });
      }
      if (tm.display && tm.display.v && tm.display.v.map && tm.display.v.map.Name) it.display = tm.display.v.map.Name.v || "";
      if (tm.Unbreakable !== undefined) it.unbr = +tm.Unbreakable.v || 0;
      if (tm["minecraft:keep_on_death"] !== undefined) it.keep = +tm["minecraft:keep_on_death"].v || 0;
      if (tm.Damage !== undefined) it.dura = +tm.Damage.v;
      if (tm.RepairCost !== undefined) it.repair = +tm.RepairCost.v;
    }
    return it;
  }

  function itemToNode(it, withSlot) {
    var N = T(), o = it._original ? Object.assign({}, it._original.v.map) : {};
    o.Count = N.N(1, "Count", it.count & 255);
    o.Damage = N.N(2, "Damage", it.damage | 0);
    o.Name = N.N(8, "Name", it.name || "");
    if (withSlot) o.Slot = N.N(1, "Slot", it.slot & 255); else delete o.Slot;
    o.WasPickedUp = N.N(1, "WasPickedUp", it.picked ? 1 : 0);
    if (it.name) {
      var tm = o.tag && o.tag.v ? Object.assign({}, o.tag.v.map) : {};
      ["ench","Unbreakable","minecraft:keep_on_death","Damage","RepairCost"].forEach(function(k){delete tm[k];});
      if (tm.display) { var display = Object.assign({},tm.display.v.map); delete display.Name; tm.display = N.N(10,"display",N.compound(display)); }
      if (it.ench.length) {
        tm.ench = N.N(9, "ench", N.listOf(10, it.ench.map(function (e) {
          return { t: 10, n: "", v: N.compound({ id: N.N(2, "id", e.id | 0), lvl: N.N(2, "lvl", e.lvl | 0) }) };
        })));
      }
      if (it.display) tm.display = N.N(10, "display", N.compound(Object.assign({}, tm.display && tm.display.v.map, {Name:N.N(8,"Name",it.display)})));
      if (it.unbr) tm.Unbreakable = N.N(1, "Unbreakable", 1);
      if (it.keep) tm["minecraft:keep_on_death"] = N.N(1, "minecraft:keep_on_death", 1);
      if (it.dura !== null) tm.Damage = N.N(3, "Damage", it.dura | 0);
      if (it.repair !== null) tm.RepairCost = N.N(3, "RepairCost", it.repair | 0);
      o.tag = N.N(10, "tag", N.compound(tm));
    }
    return { t: 10, n: "", v: N.compound(o) };
  }

  function itemState(it) { return JSON.stringify([it.name, it.count, it.damage, it.ench, it.display, it.unbr, it.keep, it.dura, it.repair]); }
  function areaChanged(area) { return model[area].some(function(it,i) { return itemState(it) !== orig[area + "State"][i]; }); }
  function isEmpty(it) { return !it.name; }

  /* ---------- carregar ---------- */
  function loadPlayer() {
    if (!curFile) return;
    if (!window.RC_dbx || !window.RC_nbt2) { status("Módulos ainda carregando. Aguarde 5s e reenvie o arquivo."); return; }
    var requestedKey = $("playerSel") && $("playerSel").value;
    model = null; playerDirty = false; editSlot = null; clearPending();
    var loadFile = curFile;
    status('<span class="spin"></span> Lendo player <b>sem alterar nada</b>…');
    window.RC_dbx.openWorld(curFile).then(function (data) {
      if (curFile !== loadFile) return null;
      dbData = data;
      var keys = Array.from(data.db.keys.entries());
      var cands = [];
      keys.forEach(function (e) {
        var sk = e[0], kv = e[1];
        if (!kv || kv === false) return;
        if (sk === "~local_player") cands.unshift({ sk: sk, kv: kv });
        else if (sk.indexOf("player_") === 0) cands.push({ sk: sk, kv: kv });
      });
      if (!cands.length) {
        status("Nenhum player salvo neste mundo (mundo nunca aberto no jogo?). Abra o mundo uma vez no Minecraft e reenvie.");
        return null;
      }
      var sel = $("playerSel");
      if (sel) {
        sel.innerHTML = "";
        cands.forEach(function (c, i) {
          var o = document.createElement("option");
          o.value = c.sk;
          o.textContent = c.sk === "~local_player" ? "Player principal (~local_player)" : ("Visitante " + c.sk);
          sel.appendChild(o);
        });
        if (cands.some(function(c) { return c.sk === requestedKey; })) sel.value = requestedKey;
        sel.hidden = cands.length < 2;
      }
      return { data: data, cands: cands };
    }).then(function (r) {
      if (!r) return;
      var idx = 0;
      var sel = $("playerSel");
      if (sel) idx = r.cands.findIndex(function(c) { return c.sk === sel.value; });
      buildModel(r.cands[idx] || r.cands[0]);
    }).catch(function (err) {
      status("Não deu para ler o player: " + esc(String((err && err.message) || err).slice(0, 200)));
    });
  }

  function buildModel(c) {
    var N = T();
    pBytes = c.kv.value.slice ? c.kv.value.slice() : new Uint8Array(c.kv.value);
    pKey = c.sk;
    var pr = N.parse(pBytes);
    tree = pr.root;
    playerDirty = false;
    model = { inv: [], armor: [], ender: [], off: null, selected: 0, level: 0, gameMode: null };
    orig = { inv: null, armor: null, ender: null, off: null, mainhand: null };
    var g;
    g = N.get(tree, "Inventory");
    orig.inv = g;
    for (var s = 0; s < 36; s++) model.inv.push({ name: "", count: 0, damage: 0, slot: s, picked: 0, ench: [], display: "", unbr: 0, keep: 0, dura: null, repair: null, _node: null });
    if (g && g.t === 9) {
      g.v.items.forEach(function (it) {
        var m = (it.v && it.v.map) || {};
        var sl = m.Slot !== undefined ? (m.Slot.v < 0 ? m.Slot.v + 256 : m.Slot.v) : -1;
        if (sl >= 0 && sl < 36) { model.inv[sl] = nodeToItem(it, sl, true); model.inv[sl]._node = it; }
      });
    }
    g = N.get(tree, "Armor");
    orig.armor = g;
    var an = (g && g.t === 9) ? g.v.items.length : 4;
    for (var a = 0; a < Math.max(4, an); a++) {
      var it2 = { name: "", count: 0, damage: 0, slot: -1, picked: 0, ench: [], display: "", unbr: 0, keep: 0, dura: null, repair: null, _node: null };
      if (g && g.v.items[a]) { it2 = nodeToItem(g.v.items[a], -1, false); it2.slot = -1; it2._node = g.v.items[a]; }
      it2._locked = a >= 4;
      model.armor.push(it2);
    }
    g = N.get(tree, "EnderChestInventory");
    orig.ender = g;
    for (var e = 0; e < 27; e++) model.ender.push({ name: "", count: 0, damage: 0, slot: e, picked: 0, ench: [], display: "", unbr: 0, keep: 0, dura: null, repair: null, _node: null });
    if (g && g.t === 9) {
      g.v.items.forEach(function (it) {
        var m2 = (it.v && it.v.map) || {};
        var sl2 = m2.Slot !== undefined ? (m2.Slot.v < 0 ? m2.Slot.v + 256 : m2.Slot.v) : -1;
        if (sl2 >= 0 && sl2 < 27) { model.ender[sl2] = nodeToItem(it, sl2, true); model.ender[sl2]._node = it; }
      });
    }
    g = N.get(tree, "OffHand");
    orig.off = g;
    if (g && g.t === 9 && g.v.items.length) {
      model.off = [nodeToItem(g.v.items[0], -1, false)];
      model.off[0]._node = g.v.items[0];
    }
    g = N.get(tree, "SelectedInventorySlot");
    if (g) model.selected = (+g.v) || 0;
    g = N.get(tree, "PlayerLevel");
    if (g) model.level = (+g.v) || 0;
    orig.level = model.level;
    g = N.get(tree, "PlayerGameMode");
    if (g) model.gameMode = +g.v;
    g = N.get(tree, "Mainhand");
    orig.mainhand = g;
    orig.armorState = model.armor.map(itemState);
    orig.enderState = model.ender.map(itemState);
    orig.invState = model.inv.map(itemState);
    orig.offState = (model.off || []).map(itemState);
    var pg = $("playerGrids");
    if (pg) pg.hidden = false;
    paintAll();
    var filled = model.inv.filter(function (x) { return x.name; }).length;
    status("Player lido: <b>" + filled + "/36</b> slots ocupados · armadura " +
      (model.armor.slice(0, 4).some(function (x) { return x.name; }) ? "equipada" : "vazia") +
      " · ender chest com <b>" + model.ender.filter(function (x) { return x.name; }).length + "/27</b>" +
      " · nível <b>" + model.level + "</b>. Clique num slot para editar (ícones do próprio Minecraft).");
  }

  /* ---------- grids ---------- */
  function slotBtn(area, idx, it, opts) {
    opts = opts || {};
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pslot" + (isEmpty(it) ? " empty" : "") + ((it.ench && it.ench.length) ? " ench" : "") + (opts.sel ? " cursel" : "");
    b.dataset.area = area; b.dataset.idx = idx;
    var short = (it.name || "").replace(/^minecraft:/, "");
    function face() {
      var s = document.createElement("span");
      s.className = "pface"; s.textContent = short.slice(0, 2).toUpperCase();
      b.insertBefore(s, b.firstChild);
    }
    function dispName() {
      if (!it.name) return "";
      var id = String(it.name).replace(/^minecraft:/, "");
      if (itemDB && itemDB.byId[id]) return itemDB.byId[id].name;
      return short;
    }
    if (it.name && opts.icon !== false) {
      var src = iconFor(it.name);
      if (src) {
        var img = document.createElement("img");
        img.loading = "lazy"; img.alt = short;
        img.draggable = false;
        img.src = src;
        img.onerror = function () { img.remove(); face(); };
        b.appendChild(img);
      } else face();
    } else if (!it.name && area === "armor" && idx < 4) {
      // silhueta original do jogo no slot vazio
      var sil = document.createElement("img");
      sil.className = "sil"; sil.alt = ARMOR_LBL[idx];
      sil.draggable = false;
      sil.src = "mc/gui/slot-" + ARMOR_SIL[idx] + ".png";
      sil.onerror = function () { sil.remove(); };
      b.appendChild(sil);
    } else if (!it.name && opts.label) {
      var lb = document.createElement("span");
      lb.className = "plab"; lb.textContent = opts.label;
      b.appendChild(lb);
    }
    if (it.name && it.count > 1) {
      var c = document.createElement("i");
      c.className = "pcount"; c.textContent = it.count;
      b.appendChild(c);
    }
    b.title = it.name ? (dispName() + (it.count > 1 ? " ×" + it.count : "") + (it.ench.length ? " ✦" + it.ench.length : "")) : ((area === "armor" && idx < 4 ? ARMOR_LBL[idx] : (opts.label || "slot vazio")) + " — toque para equipar");
    if (opts.locked) { b.disabled = true; b.title = "Slot reserva do jogo (preservado)"; }
    else b.addEventListener("click", function () { openEditor(area, idx); });
    return b;
  }

  function iconFor(fullName) {
    var id = String(fullName || "").replace(/^minecraft:/, "");
    if (!itemDB || !itemDB.byId[id] || itemDB.byId[id].file === "__none__.png") return null;
    return "mc/item/" + itemDB.byId[id].file;
  }

  // Layout igual ao inventário do jogo (coords do inventory.png 176×166, escala 2)
  var MC_S = 2;
  function mcPos(area, idx) {
    if (area === "armor") return { x: 8 * MC_S, y: (8 + 18 * idx) * MC_S };
    if (area === "off") return { x: 77 * MC_S, y: 62 * MC_S };
    if (area === "inv" && idx < 9) return { x: (8 + 18 * idx) * MC_S, y: 142 * MC_S };
    if (area === "inv") { var r = ((idx - 9) / 9) | 0, c = (idx - 9) % 9; return { x: (8 + 18 * c) * MC_S, y: (84 + 18 * r) * MC_S }; }
    if (area === "ender") { var r2 = (idx / 9) | 0, c2 = idx % 9; return { x: (8 + 18 * c2) * MC_S, y: (18 + 18 * r2) * MC_S }; }
    return { x: 0, y: 0 };
  }
  var ARMOR_SIL = ["helmet", "chestplate", "leggings", "boots"];
  function paintAll() {
    var inv = $("mcInv");
    if (inv) {
      inv.innerHTML = "";
      var a;
      for (a = 0; a < 4; a++) {
        var ab = slotBtn("armor", a, model.armor[a], {});
        var ap = mcPos("armor", a);
        ab.style.left = ap.x + "px"; ab.style.top = ap.y + "px";
        inv.appendChild(ab);
      }
      var i;
      for (i = 0; i < 36; i++) {
        var sb = slotBtn("inv", i, model.inv[i], { sel: i === model.selected && i < 9 });
        var sp = mcPos("inv", i);
        sb.style.left = sp.x + "px"; sb.style.top = sp.y + "px";
        inv.appendChild(sb);
      }
      if (model.off) {
        var ob = slotBtn("off", 0, model.off[0], {});
        var op = mcPos("off", 0);
        ob.style.left = op.x + "px"; ob.style.top = op.y + "px";
        inv.appendChild(ob);
      }
    }
    var en = $("mcEnder");
    if (en) {
      en.innerHTML = "";
      for (var e = 0; e < 27; e++) {
        var eb = slotBtn("ender", e, model.ender[e], {});
        var ep = mcPos("ender", e);
        eb.style.left = ep.x + "px"; eb.style.top = ep.y + "px";
        en.appendChild(eb);
      }
    }
    var ss = $("selSlot");
    if (ss) ss.value = String(model.selected);
    var lv = $("xpLevel");
    if (lv && document.activeElement !== lv) lv.value = String(model.level);
  }

  function getSlot(area, idx) {
    if (area === "inv") return model.inv[idx];
    if (area === "armor") return model.armor[idx];
    if (area === "ender") return model.ender[idx];
    if (area === "off") return model.off[0];
    return null;
  }
  function setSlot(area, idx, it) {
    if (area === "inv") model.inv[idx] = it;
    else if (area === "armor") model.armor[idx] = it;
    else if (area === "ender") model.ender[idx] = it;
    else if (area === "off") model.off[0] = it;
    it._node = null; // recodificar do zero
    playerDirty = true;
    paintAll();
  }

  /* ---------- editor de item ---------- */
  function openEditor(area, idx) {
    editSlot = { area: area, idx: idx };
    var it = getSlot(area, idx);
    var t = $("ieTitle");
    var names = { inv: idx < 9 ? "Hotbar " + (idx + 1) : "Inventário " + (idx - 8), armor: ARMOR_LBL[idx] || "Armadura", ender: "Ender " + (idx + 1), off: "Mão secundária" };
    if (t) t.textContent = "Editando: " + (names[area] || (area + idx));
    if ($("ieSearch")) $("ieSearch").value = "";
    if ($("ieCount")) $("ieCount").value = it.name ? it.count : 1;
    if ($("ieMeta")) $("ieMeta").value = it.damage || 0;
    if ($("ieDura")) $("ieDura").value = (it.dura === null || it.dura === undefined) ? "" : it.dura;
    if ($("ieName")) $("ieName").value = it.display || "";
    if ($("ieCustomId")) $("ieCustomId").value = it.name ? it.name.replace(/^minecraft:/, "") : "";
    if ($("ieUnbr")) $("ieUnbr").checked = !!it.unbr;
    if ($("ieKeep")) $("ieKeep").checked = !!it.keep;
    paintEnch(it);
    renderItemGrid("");
    var p = $("itemEditor");
    if (p) { p.hidden = false; try { p.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {} }
  }
  function paintEnch(it) {
    var el = $("ieEnchList");
    if (!el) return;
    el.innerHTML = "";
    (it.ench || []).forEach(function (e, i) {
      var nm = "enc#" + e.id;
      ENCH.forEach(function (r) { if (r[0] === e.id) nm = r[1]; });
      var row = document.createElement("div");
      row.className = "ench-row";
      row.innerHTML = "<b>" + esc(nm) + "</b> <span>nv " + e.lvl + "</span>";
      var x = document.createElement("button");
      x.type = "button"; x.className = "btn-ghost btn-mini"; x.textContent = "×";
      x.addEventListener("click", function () { it.ench.splice(i, 1); it._node = null; playerDirty = true; paintEnch(it); });
      row.appendChild(x);
      el.appendChild(row);
    });
    if (!it.ench.length) el.innerHTML = "<span style='color:var(--muted);font-size:12px'>sem encantamentos</span>";
  }
  function curEditItem() {
    var id = (($("ieCustomId") && $("ieCustomId").value) || "").trim().toLowerCase().replace(/[^a-z0-9_:.\/-]/g, "");
    if (id && id.indexOf(":") < 0) id = "minecraft:" + id;
    var it = getSlot(editSlot.area, editSlot.idx);
    return {
      name: id, count: Math.max(1, Math.min(64, +($("ieCount").value || 1) | 0)),
      damage: Math.max(0, +($("ieMeta").value || 0) | 0),
      slot: (editSlot.area === "armor" || editSlot.area === "off") ? -1 : editSlot.idx,
      picked: it.picked || 0,
      dura: ($("ieDura").value === "" ? null : Math.max(0, +$("ieDura").value | 0)),
      display: (($("ieName").value) || "").slice(0, 60),
      unbr: $("ieUnbr").checked ? 1 : 0, keep: $("ieKeep").checked ? 1 : 0,
      repair: it.repair !== undefined ? it.repair : null,
      ench: it.ench || [], _original: id === it.name ? (it._original || it._node) : null, _node: null
    };
  }

  function renderItemGrid(q) {
    var g = $("ieGrid");
    if (!g || !itemDB) return;
    q = (q || "").trim().toLowerCase();
    var al = ALIAS[q];
    g.innerHTML = "";
    var frag = document.createDocumentFragment(), n = 0;
    var list = itemDB.list;
    for (var i = 0; i < list.length && n < 400; i++) {
      var it = list[i];
      var hay = (it.name + " " + it.id).toLowerCase();
      if (q && hay.indexOf(q) < 0 && (!al || hay.indexOf(al) < 0)) continue;
      (function (def) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "item-cell"; c.title = def.name;
        c.dataset.pid = def.id;
        if (def.file && def.file !== "__none__.png") {
          var img = document.createElement("img");
          img.loading = "lazy"; img.alt = def.name;
          img.draggable = false;
          img.src = "mc/item/" + def.file;
          img.onerror = function () { img.remove(); var s = document.createElement("span"); s.className = "pface"; s.textContent = def.name.slice(0, 2).toUpperCase(); c.insertBefore(s, c.firstChild); };
          c.appendChild(img);
        } else {
          var s0 = document.createElement("span");
          s0.className = "pface"; s0.textContent = def.name.slice(0, 2).toUpperCase();
          c.appendChild(s0);
        }
        c.addEventListener("click", function () {
          if ($("ieCustomId")) $("ieCustomId").value = def.id;
          g.querySelectorAll(".item-cell").forEach(function (x) { x.classList.remove("pick"); });
          c.classList.add("pick");
        });
        if ($("ieCustomId") && $("ieCustomId").value.replace(/^minecraft:/, "") === def.id) c.classList.add("pick");
        frag.appendChild(c);
      })(it);
      n++;
    }
    if (!n) frag.appendChild(Object.assign(document.createElement("span"), { textContent: "Nada achado — digite o ID exato abaixo (vale p/ addons).", style: "font-size:12px;color:var(--muted)" }));
    g.appendChild(frag);
  }

  /* ---------- kits ---------- */
  function kitItem(name, count, ench, extra) {
    var it = { name: name, count: count || 1, damage: 0, slot: -1, picked: 0, ench: ench || [], display: "", unbr: 0, keep: 0, dura: null, repair: null, _node: null };
    if (extra) for (var k in extra) it[k] = extra[k];
    return it;
  }
  var KITS = {
    netherite: [
      ["inv", 0, kitItem("minecraft:netherite_sword", 1, [{ id: 9, lvl: 5 }, { id: 13, lvl: 2 }, { id: 14, lvl: 3 }, { id: 17, lvl: 3 }], { unbr: 1 })],
      ["inv", 1, kitItem("minecraft:netherite_pickaxe", 1, [{ id: 15, lvl: 5 }, { id: 18, lvl: 3 }, { id: 17, lvl: 3 }], { unbr: 1 })],
      ["inv", 2, kitItem("minecraft:netherite_axe", 1, [{ id: 15, lvl: 5 }, { id: 9, lvl: 5 }, { id: 17, lvl: 3 }], { unbr: 1 })],
      ["inv", 3, kitItem("minecraft:bow", 1, [{ id: 19, lvl: 5 }, { id: 21, lvl: 1 }, { id: 22, lvl: 1 }, { id: 17, lvl: 3 }], { unbr: 1 })],
      ["inv", 4, kitItem("minecraft:arrow", 64, [])],
      ["inv", 5, kitItem("minecraft:cooked_beef", 64, [])],
      ["inv", 6, kitItem("minecraft:golden_apple", 16, [])],
      ["inv", 7, kitItem("minecraft:totem_of_undying", 1, [])],
      ["inv", 8, kitItem("minecraft:ender_pearl", 16, [])],
      ["armor", 0, kitItem("minecraft:netherite_helmet", 1, [{ id: 0, lvl: 4 }, { id: 17, lvl: 3 }], { unbr: 1 })],
      ["armor", 1, kitItem("minecraft:netherite_chestplate", 1, [{ id: 0, lvl: 4 }, { id: 17, lvl: 3 }], { unbr: 1 })],
      ["armor", 2, kitItem("minecraft:netherite_leggings", 1, [{ id: 0, lvl: 4 }, { id: 17, lvl: 3 }], { unbr: 1 })],
      ["armor", 3, kitItem("minecraft:netherite_boots", 1, [{ id: 0, lvl: 4 }, { id: 2, lvl: 4 }, { id: 17, lvl: 3 }], { unbr: 1 })]
    ],
    diamond: [
      ["inv", 0, kitItem("minecraft:diamond_sword", 1, [{ id: 9, lvl: 5 }, { id: 14, lvl: 3 }])],
      ["inv", 1, kitItem("minecraft:diamond_pickaxe", 1, [{ id: 15, lvl: 5 }, { id: 18, lvl: 3 }])],
      ["inv", 2, kitItem("minecraft:diamond_axe", 1, [{ id: 15, lvl: 5 }])],
      ["inv", 5, kitItem("minecraft:cooked_beef", 32, [])],
      ["inv", 6, kitItem("minecraft:golden_apple", 8, [])],
      ["inv", 8, kitItem("minecraft:shield", 1, [])],
      ["armor", 0, kitItem("minecraft:diamond_helmet", 1, [{ id: 0, lvl: 4 }])],
      ["armor", 1, kitItem("minecraft:diamond_chestplate", 1, [{ id: 0, lvl: 4 }])],
      ["armor", 2, kitItem("minecraft:diamond_leggings", 1, [{ id: 0, lvl: 4 }])],
      ["armor", 3, kitItem("minecraft:diamond_boots", 1, [{ id: 0, lvl: 4 }])]
    ],
    start: [
      ["inv", 0, kitItem("minecraft:stone_sword", 1, [])],
      ["inv", 1, kitItem("minecraft:stone_pickaxe", 1, [])],
      ["inv", 2, kitItem("minecraft:stone_axe", 1, [])],
      ["inv", 3, kitItem("minecraft:torch", 32, [])],
      ["inv", 5, kitItem("minecraft:cooked_beef", 16, [])],
      ["inv", 8, kitItem("minecraft:shield", 1, [])],
      ["armor", 0, kitItem("minecraft:leather_helmet", 1, [])],
      ["armor", 1, kitItem("minecraft:leather_chestplate", 1, [])],
      ["armor", 2, kitItem("minecraft:leather_leggings", 1, [])],
      ["armor", 3, kitItem("minecraft:leather_boots", 1, [])]
    ]
  };
  function applyKit(k) {
    if (!model) return;
    var vip = window.RC_dbx.vipOk(), skipped = 0;
    KITS[k].forEach(function (e) {
      if (e[0] === "armor" && !vip) { skipped++; return; }
      var it = JSON.parse(JSON.stringify(e[2]));
      it.slot = (e[0] === "armor") ? -1 : e[1];
      setSlotRaw(e[0], e[1], it);
    });
    paintAll();
    status("Kit aplicado no rascunho" + (skipped ? " (hotbar grátis; <b>armadura do kit é VIP</b>)" : "") + ". Confira os slots e aperte <b>Gerar e baixar meu mundo</b> para gravar no mundo.");
  }
  function setSlotRaw(area, idx, it) {
    playerDirty = true;
    it._node = null;
    if (area === "inv") model.inv[idx] = it;
    else if (area === "armor") model.armor[idx] = it;
    else if (area === "ender") model.ender[idx] = it;
  }

  /* ---------- salvar ---------- */
  function buildNewPlayerBytes() {
    var N = T(), data = { inv: null, armor: null, ender: null, off: null, mainhand: null };
    // Inventory (36, com Slot)
    var invItems = [];
    for (var s = 0; s < 36; s++) {
      var it = model.inv[s];
      if (!it.name) {
        invItems.push(it._node || { t: 10, n: "", v: N.compound({ Count: N.N(1, "Count", 0), Damage: N.N(2, "Damage", 0), Name: N.N(8, "Name", ""), Slot: N.N(1, "Slot", s), WasPickedUp: N.N(1, "WasPickedUp", 0) }) });
      } else if (it._node) invItems.push(it._node);
      else { it.slot = s; invItems.push(itemToNode(it, true)); }
    }
    data.inv = N.encodeNamed({ t: 9, n: "Inventory", v: N.listOf(10, invItems) });
    // Armor (mesmo tamanho do original, sem Slot)
    var aLen = (orig.armor && orig.armor.v) ? orig.armor.v.items.length : 4;
    var aItems = [];
    for (var a = 0; a < aLen; a++) {
      var at = model.armor[a] || { name: "", count: 0, damage: 0, picked: 0, ench: [] };
      if (!at.name) {
        aItems.push(at._node || { t: 10, n: "", v: N.compound({ Count: N.N(1, "Count", 0), Damage: N.N(2, "Damage", 0), Name: N.N(8, "Name", ""), WasPickedUp: N.N(1, "WasPickedUp", 0) }) });
      } else if (at._node) aItems.push(at._node);
      else aItems.push(itemToNode(at, false));
    }
    data.armor = N.encodeNamed({ t: 9, n: "Armor", v: N.listOf(10, aItems) });
    // Ender (27, com Slot)
    var eItems = [];
    for (var e2 = 0; e2 < 27; e2++) {
      var et = model.ender[e2];
      if (!et.name) {
        eItems.push(et._node || { t: 10, n: "", v: N.compound({ Count: N.N(1, "Count", 0), Damage: N.N(2, "Damage", 0), Name: N.N(8, "Name", ""), Slot: N.N(1, "Slot", e2), WasPickedUp: N.N(1, "WasPickedUp", 0) }) });
      } else if (et._node) eItems.push(et._node);
      else { et.slot = e2; eItems.push(itemToNode(et, true)); }
    }
    data.ender = N.encodeNamed({ t: 9, n: "EnderChestInventory", v: N.listOf(10, eItems) });
    // OffHand (só se existia)
    if (orig.off) {
      var ot = (model.off && model.off[0]) || { name: "" };
      var oItems = (!ot.name) ? [ot._node || { t: 10, n: "", v: N.compound({ Count: N.N(1, "Count", 0), Damage: N.N(2, "Damage", 0), Name: N.N(8, "Name", ""), WasPickedUp: N.N(1, "WasPickedUp", 0) }) }] : (ot._node ? [ot._node] : [itemToNode(ot, false)]);
      data.off = N.encodeNamed({ t: 9, n: "OffHand", v: N.listOf(10, oItems) });
    }
    // Mainhand = espelho do slot selecionado (sem Slot)
    var mh = model.inv[Math.max(0, Math.min(8, model.selected))];
    var mhNode = (!mh.name) ? { t: 10, n: "", v: N.compound({ Count: N.N(1, "Count", 0), Damage: N.N(2, "Damage", 0), Name: N.N(8, "Name", ""), WasPickedUp: N.N(1, "WasPickedUp", 0) }) } : itemToNode(mh, false);
    data.mainhand = N.encodeNamed({ t: 9, n: "Mainhand", v: N.listOf(10, [mhNode]) });
    return data;
  }

  function spliceOrInsert(bytes, rootNode, listName, newListBytes) {
    var N = T();
    var g = N.get(rootNode, listName);
    if (g) return N.splice(bytes, g, newListBytes);
    // insere antes do END do compound raiz
    var body = rootNode.v;
    var at = body.o + body.l - 1;
    var out = new Uint8Array(bytes.length + newListBytes.length);
    out.set(bytes.subarray(0, at), 0);
    out.set(newListBytes, at);
    out.set(bytes.subarray(at), at + newListBytes.length);
    return out;
  }

  function doSave() {
    if (!curFile || !model) { status("Escolha o <b>.mcworld</b> e aguarde o player carregar."); return; }
    if (!window.RC_ldbw) { status("Módulos ainda carregando. Aguarde 5s e tente de novo."); return; }
    var vip = window.RC_dbx.vipOk();
    if (!vip) {
      // GRÁTIS: só hotbar, encantos até o máximo vanilla, 2 saves/dia
      var armorUsed = areaChanged("armor");
      var enderUsed = areaChanged("ender");
      var lvlChanged = model.level !== (orig.level || 0);
      if (armorUsed || enderUsed || lvlChanged) {
        var need = window.RC_dbx.vipNeed("Grátis: edição do inventário. Armadura, ender chest e nível de XP são VIP.");
        status(need.html);
        try { document.getElementById("planos").scrollIntoView({ behavior: "smooth" }); } catch (e) {}
        return;
      }
      var bad = null, badSlot = "";
      for (var s = 0; s < 36 && !bad; s++) {
        if (model.inv[s].name && itemState(model.inv[s]) !== orig.invState[s]) {
          var oe = overEnchant(model.inv[s]);
          if (oe) { bad = oe; badSlot = "hotbar " + (s + 1); }
        }
      }
      if (bad) {
        var need2 = window.RC_dbx.vipNeed("Grátis: encantos até o máximo vanilla (" + esc(enchName(bad.id)) + " " + bad.mx + "). Nv " + bad.lvl + " em " + esc(badSlot) + " é VIP (até 255).");
        status(need2.html);
        try { document.getElementById("planos").scrollIntoView({ behavior: "smooth" }); } catch (e2) {}
        return;
      }
      if (window.RC_dbx.freePlayerLeft() <= 0) {
        var need3 = window.RC_dbx.vipNeed("Você usou seus 2 saves grátis de player hoje. O VIP salva sem limite.");
        status(need3.html);
        try { document.getElementById("planos").scrollIntoView({ behavior: "smooth" }); } catch (e3) {}
        return;
      }
    }
    var ack = $("playerAck");
    if (ack && !ack.checked) { status("Marque <b>“Fiz backup e entendo que é irreversível”</b> para continuar."); return; }
    status('<span class="spin"></span> Gravando player <b>no seu navegador</b>… (original intacto)');
    var btn = $("playerSaveBtn");
    if (btn) btn.disabled = true;
    tick().then(function () {
      var N = T(), nb;
      try {
        nb = buildNewPlayerBytes();
      } catch (e) { throw new Error("montagem: " + e.message); }
      var out = pBytes;
      var pr = N.parse(out).root;
      out = spliceOrInsert(out, pr, "Inventory", nb.inv); pr = N.parse(out).root;
      out = spliceOrInsert(out, pr, "Armor", nb.armor); pr = N.parse(out).root;
      out = spliceOrInsert(out, pr, "EnderChestInventory", nb.ender); pr = N.parse(out).root;
      if (nb.off) { out = spliceOrInsert(out, pr, "OffHand", nb.off); pr = N.parse(out).root; }
      if (orig.mainhand) { out = spliceOrInsert(out, pr, "Mainhand", nb.mainhand); pr = N.parse(out).root; }
      // nível de XP
      out = spliceOrInsert(out, pr, "SelectedInventorySlot", N.encodeNamed(N.N(3, "SelectedInventorySlot", model.selected)));
    pr = N.parse(out).root;
    var lv = N.get(pr, "PlayerLevel");
      if (!lv || lv.v !== model.level) {
        var lvB = N.encodeNamed({ t: 3, n: "PlayerLevel", v: model.level | 0 });
        out = spliceOrInsert(out, pr, "PlayerLevel", lvB); pr = N.parse(out).root;
      }
      // verifica parse final
      N.parse(out);
      // diferencia: conta slots ocupados
      var chk = N.parse(out).root;
      var invN = N.get(chk, "Inventory");
      var occ = invN.v.items.filter(function (it) { return it.v.map.Name && it.v.map.Name.v; }).length;
      var ops = [{ t: "put", k: dbDataKeyBytes(), v: out }];
      var upd = window.RC_ldbw.buildDbUpdate({
        manifestBytes: dbData.manifestBytes, manifestName: dbData.manifestName,
        nextFile: dbData.nextFile, lastSeq: dbData.lastSeq, logNumber: dbData.logNumber, ops: ops
      });
      return window.RC_dbx.assemble(dbData, upd.newManifestBytes, upd.logName, upd.logBytes).then(function (blob) {
        return { blob: blob, occ: occ, out: out };
      });
    }).then(function (r) {
      status('<span class="spin"></span> Validando o arquivo novo (releitura de segurança)…');
      return r.blob.arrayBuffer().then(function (ab) {
        return window.RC_dbx.openFromBlob(new Blob([ab])).then(function (db2) {
            var found = null;
            for (var e of db2.keys) { if (e[0] === pKey) { found = e[1]; break; } }
            if (!found || found === false) throw new Error("validação: player sumiu. Nada foi baixado.");
            var N2 = T(), chk = N2.parse(found.value).root;
            var invN = N2.get(chk, "Inventory");
            var occ = invN.v.items.filter(function (it) { return it.v.map.Name && it.v.map.Name.v; }).length;
            var live1 = 0, live2 = 0;
            dbData.db.keys.forEach(function (v) { if (v) live1++; });
            db2.keys.forEach(function (v) { if (v) live2++; });
            if (live2 !== live1) throw new Error("validação: contagem de chaves mudou (" + live1 + "→" + live2 + "). Nada foi baixado.");
            return occ;
        }).then(function (occ2) {
          var base = String(curFile.name || "mundo.mcworld").replace(/\.(mcworld|zip)$/i, "");
          window.RC_dbx.downloadBlob(r.blob, base + "-player.mcworld");
          window.RC_dbx.dropCache();
          var wasVip = window.RC_dbx.vipOk();
          if (!wasVip) window.RC_dbx.useFreePlayer();
          var tail = wasVip ? "" : "<br>Save grátis usado (" + window.RC_dbx.freePlayerLeft() + " restantes hoje). <a href='#planos'><b>VIP salva sem limite</b></a> + armadura, ender e encantos até 255.";
          status("Pronto! Download iniciado: <b>" + esc(base) + "-player.mcworld</b> — inventário com <b>" + occ2 + " item(ns)</b>, armadura e ender chest aplicados. " +
            "Chunks: <b>0 alterados</b> (só o player mudou) ✓. <b>Guarde o original.</b> Para continuar editando, reenvie o arquivo novo no passo 1." + tail);
        });
      });
    }).catch(function (err) {
      status("Não deu certo: " + esc(String((err && err.message) || err).slice(0, 260)) + " <b>Nada foi baixado; seu original está intacto.</b>");
    }).then(function () {
      var b2 = $("playerSaveBtn");
      if (b2) b2.disabled = false;
    });
  }

  /* ---------- núcleo reutilizável (botão único) ---------- */
  function hasEdits() { return !!(model && playerDirty); }
  function preflightPlayer() {
    if (!curFile || !model) return "Escolha o <b>.mcworld</b> e monte o player.";
    if (!window.RC_ldbw || !window.RC_dbx) return "Módulos ainda carregando. Aguarde e toque de novo.";
    var vip = window.RC_dbx.vipOk();
    if (!vip) {
      var armorUsed = areaChanged("armor");
      var enderUsed = areaChanged("ender");
      var lvlChanged = model.level !== (orig.level || 0);
      if (armorUsed || enderUsed || lvlChanged) {
        return window.RC_dbx.vipNeed("Grátis: edição do inventário. Armadura, ender chest e nível de XP são VIP.").html;
      }
      for (var s = 0; s < 36; s++) {
        if (model.inv[s].name && itemState(model.inv[s]) !== orig.invState[s]) {
          var oe = overEnchant(model.inv[s]);
          if (oe) return window.RC_dbx.vipNeed("Grátis: encantos até o máximo vanilla (" + esc(enchName(oe.id)) + " " + oe.mx + "). Nv " + oe.lvl + " é VIP (até 255).").html;
        }
      }
      if (window.RC_dbx.freePlayerLeft() <= 0) {
        return window.RC_dbx.vipNeed("Você usou seus 2 saves grátis de player hoje. O VIP salva sem limite.").html;
      }
    }
    var ack = $("playerAck");
    if (ack && !ack.checked) return "Confirme no inventário que guardou uma cópia do mundo original.";
    return null;
  }
  function playerKeyBytesIn(data) {
    for (var e of data.db.keys) {
      if (e[0] === pKey) {
        try { return e[1].keyBytes.slice(); } catch (x) { break; }
      }
    }
    var b = new Uint8Array(pKey.length);
    for (var i = 0; i < pKey.length; i++) b[i] = pKey.charCodeAt(i);
    return b;
  }
  // monta o put do player a partir do rascunho (mesma lógica do salvar avulso)
  function buildPlayerPut() {
    var N = T(), nb;
    try { nb = buildNewPlayerBytes(); }
    catch (e) { throw new Error("montagem: " + e.message); }
    var out = pBytes;
    var pr = N.parse(out).root;
    out = spliceOrInsert(out, pr, "Inventory", nb.inv); pr = N.parse(out).root;
    out = spliceOrInsert(out, pr, "Armor", nb.armor); pr = N.parse(out).root;
    out = spliceOrInsert(out, pr, "EnderChestInventory", nb.ender); pr = N.parse(out).root;
    if (nb.off) { out = spliceOrInsert(out, pr, "OffHand", nb.off); pr = N.parse(out).root; }
    if (orig.mainhand) { out = spliceOrInsert(out, pr, "Mainhand", nb.mainhand); pr = N.parse(out).root; }
    out = spliceOrInsert(out, pr, "SelectedInventorySlot", N.encodeNamed(N.N(3, "SelectedInventorySlot", model.selected)));
    pr = N.parse(out).root;
    var lv = N.get(pr, "PlayerLevel");
    if (!lv || lv.v !== model.level) {
      var lvB = N.encodeNamed({ t: 3, n: "PlayerLevel", v: model.level | 0 });
      out = spliceOrInsert(out, pr, "PlayerLevel", lvB); pr = N.parse(out).root;
    }
    N.parse(out);
    var chk = N.parse(out).root;
    var invN = N.get(chk, "Inventory");
    var occ = invN.v.items.filter(function (it) { return it.v.map.Name && it.v.map.Name.v; }).length;
    return { bytes: out, occ: occ };
  }
  // aplica o rascunho em cima de um blob (pós-conversor/pós-chunks) — sem baixar.
  // Usa openWorld (retorna {db, zip, manifest...}); openFromBlob retorna
  // só o LevelDb e quebrava com "reading 'keys'".
  function applyToBlob(blob) {
    var data;
    return window.RC_dbx.openWorld(blob).then(function (d) {
      data = d;
      var put = buildPlayerPut();
      var ops = [{ t: "put", k: playerKeyBytesIn(data), v: put.bytes }];
      var upd = window.RC_ldbw.buildDbUpdate({
        manifestBytes: data.manifestBytes, manifestName: data.manifestName,
        nextFile: data.nextFile, lastSeq: data.lastSeq, logNumber: data.logNumber, ops: ops
      });
      return window.RC_dbx.assemble(data, upd.newManifestBytes, upd.logName, upd.logBytes).then(function (b2) {
        return { blob: b2, occ: put.occ, expected: put.bytes };
      });
    }).then(function (r) {
      return r.blob.arrayBuffer().then(function (ab) {
        return window.RC_dbx.openFromBlob(new Blob([ab])).then(function (db2) {
          var found = null;
          for (var e of db2.keys) { if (e[0] === pKey) { found = e[1]; break; } }
          if (!found || found === false) throw new Error("player sumiu na validação.");
          var expected = r.expected;
          if (found.value.length !== expected.length || expected.some(function(b,i){return found.value[i] !== b;})) throw new Error("O inventário gravado não corresponde ao rascunho.");
          var live1 = 0, live2 = 0;
          data.db.keys.forEach(function (v) { if (v) live1++; });
          db2.keys.forEach(function (v) { if (v) live2++; });
          if (live2 !== live1) throw new Error("contagem mudou na validação.");
          return { blob: r.blob, occ: r.occ };
        });
      });
    });
  }
  window.RC_player = { preflight: preflightPlayer, applyToBlob: applyToBlob, hasEdits: hasEdits };

  function dbDataKeyBytes() {
    // chave exata do player (bytes originais do banco)
    for (var e of dbData.db.keys) {
      if (e[0] === pKey) {
        try { return e[1].keyBytes.slice(); } catch (x) { break; }
      }
    }
    // fallback: reconstrói ASCII
    var b = new Uint8Array(pKey.length);
    for (var i = 0; i < pKey.length; i++) b[i] = pKey.charCodeAt(i);
    return b;
  }

  function loadItemDB() {
    if (itemDB) return Promise.resolve(itemDB);
    return fetch("mc/itens.json").then(function (r) {
      if (!r.ok) throw new Error("mc/itens.json");
      return r.json();
    }).then(function (list) {
      var byId = {};
      list.forEach(function (it) { byId[it.id] = it; });
      // escudo não tem sprite estático no Java — fallback de texto
      if (!byId.shield) {
        var e = { id: "shield", name: "Escudo", file: "__none__.png" };
        list.push(e); byId.shield = e;
      }
      itemDB = { list: list, byId: byId };
      return itemDB;
    }).catch(function () {
      itemDB = { list: [], byId: {} };
      return itemDB;
    });
  }

  function bind() {
    var input = $("file"), drop = $("drop");
    if (input) input.addEventListener("change", function () {
      var f = (input.files && input.files[0]) || null;
      if (f && !/\.dat$/i.test(f.name || "")) { curFile = f; loadItemDB().then(loadPlayer); }
      else { curFile = null; model = null; var g = $("playerGrids"); if (g) g.hidden = true; status(null); }
    });
    if (drop) drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && !/\.dat$/i.test(f.name || "")) { curFile = f; setTimeout(function () { loadItemDB().then(loadPlayer); }, 60); }
    });
    var ps = $("playerSel");
    if (ps) ps.addEventListener("change", function () { loadPlayer(); });
    var q = $("ieSearch");
    if (q) q.addEventListener("input", function () { renderItemGrid(q.value); });
    var ec = $("ieCustomId");
    if (ec) ec.addEventListener("input", function () {
      var g = $("ieGrid");
      if (g) g.querySelectorAll(".item-cell").forEach(function (x) { x.classList.remove("pick"); });
    });
    var ea = $("ieEnchAdd");
    if (ea) ea.addEventListener("click", function () {
      if (!editSlot) return;
      var it = getSlot(editSlot.area, editSlot.idx);
      var id = +($("ieEnchSel").value || 0), lv = Math.max(1, Math.min(255, +($("ieEnchLvl").value || 1) | 0));
      var ex = it.ench.find(function (e) { return e.id === id; });
      if (ex) ex.lvl = lv; else it.ench.push({ id: id, lvl: lv });
      it._node = null; playerDirty = true;
      paintEnch(it);
    });
    var ap = $("ieApply");
    if (ap) ap.addEventListener("click", function () {
      if (!editSlot) return;
      var it = curEditItem();
      if (!it.name) { status("Escolha um item (clique no ícone ou digite o ID). Para esvaziar, use <b>Limpar slot</b>."); return; }
      clearPending();
      setSlot(editSlot.area, editSlot.idx, it);
      status("Slot atualizado no rascunho. Aperte <b>Gerar e baixar meu mundo</b> para gravar.");
    });
    var cl = $("ieClear");
    if (cl) cl.addEventListener("click", function () {
      if (!editSlot) return;
      var withSlot = !(editSlot.area === "armor" || editSlot.area === "off");
      var idx = editSlot.area === "off" ? -1 : editSlot.idx;
      var it = emptyItem(withSlot ? idx : -1, withSlot);
      it.ench = []; it.display = ""; it.unbr = 0; it.keep = 0; it.dura = null; it.repair = null;
      if (editSlot.area === "armor" && editSlot.idx >= 4) return;
      setSlot(editSlot.area, editSlot.idx, it);
      openEditor(editSlot.area, editSlot.idx);
    });
    var xx = $("ieClose");
    if (xx) xx.addEventListener("click", function () { var p = $("itemEditor"); if (p) p.hidden = true; editSlot = null; });
    document.querySelectorAll("[data-kit]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!model) { status("Aguarde o player carregar."); return; }
        applyKit(b.getAttribute("data-kit"));
      });
    });
    var ck = $("kitClear");
    if (ck) ck.addEventListener("click", function () {
      if (!model) return;
      for (var i = 0; i < 36; i++) { var it = emptyItem(i, true); it.ench = []; setSlotRaw("inv", i, it); }
      for (var a = 0; a < 4; a++) { var at = emptyItem(-1, false); at.ench = []; setSlotRaw("armor", a, at); }
      for (var e = 0; e < 27; e++) { var et = emptyItem(e, true); et.ench = []; setSlotRaw("ender", e, et); }
      paintAll();
    });
    var ss = $("selSlot");
    if (ss) ss.addEventListener("change", function () {
      if (!model) return;
      model.selected = Math.max(0, Math.min(8, +ss.value || 0));
      playerDirty = true;
      paintAll();
    });
    var lv = $("xpLevel");
    if (lv) lv.addEventListener("change", function () {
      if (!model) return;
      model.level = Math.max(0, Math.min(10000, +lv.value || 0));
      playerDirty = true;
    });
    var sv = $("playerSaveBtn");
    if (sv) sv.addEventListener("click", doSave);
    bindDragDrop();
    // enchant select
    var es = $("ieEnchSel");
    if (es && !es.options.length) {
      ENCH.forEach(function (r) {
        var o = document.createElement("option");
        o.value = r[0]; o.textContent = r[1] + " (#" + r[0] + ")";
        es.appendChild(o);
      });
      es.value = "9";
    }
  }

  /* ---------- arrastar-e-soltar (mouse + touch) + toque-toque ---------- */
  var dragSt = null, pendingId = null, suppressClick = false;
  function clearPending() {
    pendingId = null;
    document.querySelectorAll(".item-cell.pick-pend").forEach(function (x) { x.classList.remove("pick-pend"); });
  }
  // hit-test manual por retângulos (não depende de elementFromPoint/overlays)
  function slotFromPoint(x, y) {
    var els = document.querySelectorAll(".pslot");
    var n = 0;
    for (var i = 0; i < els.length; i++) {
      var s = els[i];
      if (s.disabled || s.style.display === "none") continue;
      var r = s.getBoundingClientRect();
      if (!r || !r.width) continue;
      n++;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { area: s.dataset.area, idx: +s.dataset.idx };
      }
    }
    return null;
  }
  function ghostFor(name, x, y) {
    clearPending();
    var g = document.createElement("div");
    g.className = "pghost";
    var src = name ? iconFor(name) : null;
    if (src) {
      var img = document.createElement("img");
      img.src = src; img.alt = "";
      img.draggable = false;
      img.onerror = function () { img.remove(); };
      g.appendChild(img);
    } else {
      var s = document.createElement("span");
      s.className = "pface";
      s.textContent = String(name || "").replace(/^minecraft:/, "").slice(0, 2).toUpperCase();
      g.appendChild(s);
    }
    g.style.left = (x - 22) + "px"; g.style.top = (y - 22) + "px";
    document.body.appendChild(g);
    return g;
  }
  function quickAssign(area, idx, fullId) {
    // BUGFIX: toque na paleta chegava sem "minecraft:" e o jogo ignorava o item.
    // Normaliza aqui (cobre arrasto, toque e qualquer chamador futuro).
    if (fullId && fullId.indexOf(":") < 0) fullId = "minecraft:" + fullId;
    var withSlot = !(area === "armor" || area === "off");
    var it = {
      name: fullId, count: 1, damage: 0, slot: withSlot ? idx : -1, picked: 0,
      ench: [], display: "", unbr: 0, keep: 0, dura: null, repair: null, _node: null
    };
    setSlot(area, idx, it);
    status("No rascunho ✓. Toque no slot p/ ajustar, depois <b>Gerar e baixar</b>.");
  }
  function moveSlot(fa, fi, ta, ti) {
    var a = getSlot(fa, fi), b = getSlot(ta, ti);
    if (!a || !b) return;
    var fWith = !(fa === "armor" || fa === "off"), tWith = !(ta === "armor" || ta === "off");
    if (a._node && fWith === tWith) {
      if (tWith && a._node.v && a._node.v.map && a._node.v.map.Slot) a._node.v.map.Slot.v = ti;
    } else a._node = null;
    if (b._node && fWith === tWith) {
      if (fWith && b._node.v && b._node.v.map && b._node.v.map.Slot) b._node.v.map.Slot.v = fi;
    } else b._node = null;
    a.slot = tWith ? ti : -1; b.slot = fWith ? fi : -1;
    setSlotRaw(ta, ti, a); setSlotRaw(fa, fi, b);
    paintAll();
    status("Movido ✓. Vai junto no <b>Gerar e baixar</b>.");
  }
  function bindDragDrop() {
    document.addEventListener("dragstart", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(".pslot,.item-cell,.pghost") : null;
      if (t) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    function samePointer(e) {
      if (!dragSt) return false;
      // mouse/pen: pid pode variar entre down/move em alguns drivers — aceita pelo tipo
      if ((e.pointerType === "mouse" || e.pointerType === "pen") && (dragSt.ptype === "mouse" || dragSt.ptype === "pen" || !dragSt.ptype)) return true;
      return e.pointerId === dragSt.pid;
    }
    document.addEventListener("pointerdown", function (e) {
      if (!model) return;
      var cell = e.target && e.target.closest ? e.target.closest("#ieGrid .item-cell") : null;
      var slot = e.target && e.target.closest ? e.target.closest(".pslot") : null;
      if (cell && e.pointerType === "touch") return;
      if (cell) {
        dragSt = { kind: "pal", id: cell.dataset.pid || null, x0: e.clientX, y0: e.clientY, ghost: null, pid: e.pointerId, ptype: e.pointerType };
      } else if (slot && !slot.disabled) {
        var it = getSlot(slot.dataset.area, +slot.dataset.idx);
        dragSt = { kind: "slot", area: slot.dataset.area, idx: +slot.dataset.idx, name: it && it.name, x0: e.clientX, y0: e.clientY, ghost: null, pid: e.pointerId, ptype: e.pointerType };
      }
    }, { passive: true });
    document.addEventListener("pointermove", function (e) {
      if (!samePointer(e)) return;
      if (!dragSt.ghost && Math.hypot(e.clientX - dragSt.x0, e.clientY - dragSt.y0) > 10) {
        var nm = dragSt.kind === "pal" ? (dragSt.id ? "minecraft:" + dragSt.id : null) : dragSt.name;
        if (!nm && dragSt.kind === "pal") {
          var cid = (($("ieCustomId") && $("ieCustomId").value) || "").trim().toLowerCase();
          if (cid) nm = cid.indexOf(":") < 0 ? "minecraft:" + cid : cid;
        }
        if (!nm) { dragSt = null; return; }
        dragSt.name = nm;
        dragSt.ghost = ghostFor(nm, e.clientX, e.clientY);
      }
      if (dragSt && dragSt.ghost) {
        dragSt.ghost.style.left = (e.clientX - 22) + "px";
        dragSt.ghost.style.top = (e.clientY - 22) + "px";
      }
    }, { passive: true });
    document.addEventListener("pointerup", function (e) {
      if (!samePointer(e)) return;
      var d = dragSt; dragSt = null;
      if (d.ghost) {
        d.ghost.remove();
        var s = slotFromPoint(e.clientX, e.clientY);
        if (s && d.name) {
          var area = s.area, idx = s.idx;
          if (d.kind === "slot" && area === d.area && idx === d.idx) {
            // soltou no mesmo: vira toque (o click abre o editor)
          } else if (d.kind === "slot") {
            moveSlot(d.area, d.idx, area, idx);
            suppressClick = true;
          } else {
            quickAssign(area, idx, d.name);
            suppressClick = true;
          }
        }
      }
    });
    document.addEventListener("pointercancel", function (e) {
      if (dragSt && samePointer(e)) {
        if (dragSt.ghost) dragSt.ghost.remove();
        dragSt = null;
      }
    });
    // toque em slot com item pendente = coloca (sem abrir o editor)
    document.addEventListener("click", function (e) {
      var slot = e.target && e.target.closest ? e.target.closest(".pslot") : null;
      if (slot && pendingId && !slot.disabled && model) {
        quickAssign(slot.dataset.area, +slot.dataset.idx, pendingId);
        clearPending();
        e.stopPropagation(); e.preventDefault();
        return;
      }
      if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
