/* Google measurement is optional and never controls access, payment or editing. */
(function () {
  "use strict";
  var cfg = window.RC_CONFIG || {};
  var gaId = /^G-[A-Z0-9]+$/.test(cfg.GOOGLE_ANALYTICS_ID || "") ? cfg.GOOGLE_ANALYTICS_ID : "";
  var gtmId = /^GTM-[A-Z0-9]+$/.test(cfg.GOOGLE_TAG_MANAGER_ID || "") ? cfg.GOOGLE_TAG_MANAGER_ID : "";
  var key = "rc_analytics_consent_v1";
  var attributionKey = "rc_attribution_v1";
  var choice = "";
  var started = false;
  var pageSent = false;
  var pending = [];
  var debug = /(?:^|[?&])analytics_debug=1(?:&|$)/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var eventMap = {
    file_selected: "world_selected", world_analyzed: "world_analysis_completed",
    converter_view: "tool_view", operation_started: "tool_started",
    operation_completed: "tool_completed", paywall_shown: "paywall_view",
    buy_clicked: "plan_selected", plan_viewed: "plan_view",
    checkout_opened: "begin_checkout", kiwify_checkout_redirect: "begin_checkout",
    pix_create_clicked: "pix_requested", pix_checkout_redirect: "pix_created",
    pix_create_error: "payment_failed"
  };
  var permitted = /^(page_view|sign_up|login|world_selected|world_analysis_started|world_analysis_completed|tool_view|tool_opened|tool_started|tool_completed|paywall_view|pricing_view|plan_view|plan_selected|begin_checkout|pix_requested|pix_created|pix_copy|payment_pending|purchase|payment_failed|payment_expired|benefit_activated|download_started|download_completed)$/;
  function log() { if (debug && console && console.debug) console.debug.apply(console, arguments); }
  function safe(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value !== "string") return undefined;
    value = value.slice(0, 80);
    return /[@\r\n]|%40|(?:https?:\/\/)|(?:\d[.\s-]*){11}/i.test(value) ? undefined : value;
  }
  function attribution() {
    try { return JSON.parse(sessionStorage.getItem(attributionKey) || "{}"); } catch (e) { return {}; }
  }
  function captureAttribution() {
    try {
      var p = new URLSearchParams(location.search), saved = attribution(), fields = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
      var hasUtm = fields.some(function (field) { return p.has(field); });
      if (hasUtm) {
        saved = { landing_page: location.pathname };
        fields.forEach(function (field) { var value = safe(p.get(field) || ""); if (value) saved[field] = value; });
        if (document.referrer) saved.referrer_host = new URL(document.referrer).hostname.slice(0, 80);
        sessionStorage.setItem(attributionKey, JSON.stringify(saved));
      } else if (!saved.landing_page) {
        saved.landing_page = location.pathname;
        if (document.referrer) saved.referrer_host = new URL(document.referrer).hostname.slice(0, 80);
        sessionStorage.setItem(attributionKey, JSON.stringify(saved));
      }
    } catch (e) {}
  }
  function cleanParams(params) {
    var clean = {}, allow = ["plan", "tool", "source", "reason", "worlds", "world_size_mb", "price_cents", "transaction_id", "value", "currency", "item_id", "item_name", "plan_type", "tool_origin", "page_origin"];
    params = params || {};
    allow.forEach(function (field) { var value = safe(params[field]); if (value !== undefined) clean[field] = value; });
    var attr = attribution();
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_page", "referrer_host"].forEach(function (field) {
      var value = safe(attr[field]); if (value !== undefined) clean[field] = value;
    });
    return clean;
  }
  function measurementUrl() {
    var url = new URL(location.pathname, location.origin);
    var query = new URLSearchParams(location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (field) {
      var value = safe(query.get(field) || ""); if (value) url.searchParams.set(field, value);
    });
    return url.href;
  }
  function send(name, params) {
    if (!started) { pending.push([name, params]); return; }
    try {
      if (gtmId) window.dataLayer.push(Object.assign({ event: name }, params));
      else if (gaId && typeof window.gtag === "function") window.gtag("event", name, params);
      log("analytics", name, params);
    } catch (e) {}
  }
  function track(name, params) {
    name = eventMap[name] || name;
    if (!permitted.test(name) || choice !== "accepted") return;
    if (name === "page_view") { if (pageSent) return; pageSent = true; }
    var clean = cleanParams(params);
    if (name === "purchase" && params && Array.isArray(params.items)) clean.items = params.items;
    if (name === "page_view") clean.page_location = measurementUrl();
    if (debug) clean.debug_mode = true;
    send(name, clean);
  }
  function start() {
    if (started || choice !== "accepted" || (!gaId && !gtmId)) return;
    started = true;
    window.dataLayer = window.dataLayer || [];
    if (gtmId) {
      window.dataLayer.push({ event: "consent_granted" });
      var tag = document.createElement("script"); tag.async = true;
      tag.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(gtmId);
      document.head.appendChild(tag);
    } else {
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      window.gtag("consent", "update", { analytics_storage: "granted" });
      window.gtag("config", gaId, { send_page_view: false, page_location: measurementUrl(), page_referrer: document.referrer ? new URL(document.referrer).origin : "", allow_google_signals: false, allow_ad_personalization_signals: false });
      var script = document.createElement("script"); script.async = true;
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gaId);
      document.head.appendChild(script);
    }
    pending.splice(0).forEach(function (entry) { send(entry[0], entry[1]); });
    track("page_view");
  }
  function choose(value) {
    choice = value;
    try { localStorage.setItem(key, value); } catch (e) {}
    var banner = document.getElementById("rcAnalyticsConsent"); if (banner) banner.remove();
    if (value === "denied" && started && typeof window.gtag === "function") {
      window.gtag("consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    }
    if (value === "accepted") {
      if (started && typeof window.gtag === "function") window.gtag("consent", "update", { analytics_storage: "granted" });
      else start();
    }
  }
  function showChoice() {
    if (!gaId && !gtmId || choice || document.getElementById("rcAnalyticsConsent")) return;
    var box = document.createElement("aside"); box.id = "rcAnalyticsConsent"; box.className = "rc-consent";
    box.setAttribute("aria-label", "Preferências de medição");
    box.innerHTML = '<p><b>Ajude a melhorar o site</b><br>Com sua permissão, usamos Google Analytics para entender visitas e compras confirmadas. Você pode continuar sem essa medição. <a href="privacidade.html">Privacidade</a>.</p><div><button type="button" data-consent="denied">Só o necessário</button><button type="button" data-consent="accepted">Aceitar medição</button></div>';
    box.addEventListener("click", function (e) { var button = e.target.closest("[data-consent]"); if (button) choose(button.getAttribute("data-consent")); });
    document.body.appendChild(box);
  }
  function observeJourney() {
    var plans = document.getElementById("planos");
    if (plans && "IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        track("pricing_view"); observer.disconnect();
      }, { threshold: 0.25 });
      observer.observe(plans);
    }
    document.addEventListener("click", function (e) {
      var link = e.target.closest("a[href]"); if (!link) return;
      var href = link.getAttribute("href") || "";
      if (/^(chunks|builder-lab|objetivos)\.html(?:#|$)/.test(href)) track("tool_opened", { tool: href.split(".")[0] });
    });
  }
  function purchase(payment) {
    if (!payment || payment.paid !== true || !payment.id || !payment.plan || !Number.isInteger(payment.amount_cents) || payment.amount_cents <= 0) return;
    if (choice !== "accepted") return;
    var id = String(payment.id).slice(0, 80);
    var dedupeKey = "rc_ga4_purchase_" + id;
    try { if (localStorage.getItem(dedupeKey)) return; } catch (e) {}
    var plan = safe(payment.plan);
    if (!plan) return;
    var params = cleanParams({ transaction_id: id, value: payment.amount_cents / 100, currency: "BRL", item_id: plan, item_name: plan, plan_type: plan, tool_origin: payment.source || "", page_origin: attribution().landing_page || "" });
    params.items = [{ item_id: plan, item_name: plan, price: payment.amount_cents / 100, quantity: 1 }];
    track("purchase", params);
    track("benefit_activated", { plan: plan });
    try { localStorage.setItem(dedupeKey, "1"); } catch (e) {}
  }
  captureAttribution();
  try { choice = localStorage.getItem(key) || ""; } catch (e) {}
  window.RC_analytics = { track: track, purchase: purchase, attribution: attribution, consent: choose, get consentChoice() { return choice; } };
  document.addEventListener("click", function (e) {
    if (!e.target.closest("[data-analytics-settings]")) return;
    choice = ""; showChoice();
  });
  if (choice === "accepted") start();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { showChoice(); observeJourney(); });
  else { showChoice(); observeJourney(); }
})();
