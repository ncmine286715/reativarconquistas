const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'analytics.js'), 'utf8');
const memory = new Map();
const scripts = [];
const banner = { remove() {}, setAttribute() {}, addEventListener() {} };
const document = {
  readyState: 'complete', referrer: '',
  head: { appendChild(node) { scripts.push(node.src); } },
  body: { appendChild() {} },
  createElement() { return { ...banner }; },
  getElementById() { return null; },
  addEventListener() {}
};
const context = {
  window: { RC_CONFIG: { GOOGLE_ANALYTICS_ID: 'G-NK8ZN0XFJM', GOOGLE_TAG_MANAGER_ID: '' }, IntersectionObserver: undefined },
  document, URL, URLSearchParams, Date, console,
  location: { origin: 'https://example.test', pathname: '/sucesso', search: '?id=private&email=person%40example.com&utm_source=youtube', hostname: 'example.test' },
  localStorage: { getItem(k) { return memory.get(k) || null; }, setItem(k, v) { memory.set(k, v); } },
  sessionStorage: { getItem(k) { return memory.get('session:' + k) || null; }, setItem(k, v) { memory.set('session:' + k, v); } }
};
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: 'analytics.js' });
assert.equal(scripts.length, 0, 'no Google tag before consent');
context.window.RC_analytics.track('page_view');
assert.equal(scripts.length, 0, 'events do not bypass consent');
context.window.RC_analytics.consent('accepted');
assert.equal(scripts.length, 1, 'one Google tag loaded after consent');
context.window.RC_analytics.track('page_view');
let events = context.window.dataLayer.filter(x => x[0] === 'event');
assert.equal(events.filter(x => x[1] === 'page_view').length, 1, 'page view is unique');
assert.ok(!events[0][2].page_location.includes('email='), 'page URL excludes personal query parameters');
context.window.RC_analytics.purchase({ id: 'chk_paid', paid: false, plan: 'vip7', amount_cents: 799 });
assert.equal(events.filter(x => x[1] === 'purchase').length, 0, 'unpaid checkout is not a purchase');
context.window.RC_analytics.purchase({ id: 'chk_paid', paid: true, plan: 'vip7', amount_cents: 799 });
context.window.RC_analytics.purchase({ id: 'chk_paid', paid: true, plan: 'vip7', amount_cents: 799 });
events = context.window.dataLayer.filter(x => x[0] === 'event');
const purchases = events.filter(x => x[1] === 'purchase');
assert.equal(purchases.length, 1, 'same transaction is sent once');
assert.equal(purchases[0][2].transaction_id, 'chk_paid');
assert.equal(purchases[0][2].value, 7.99);
assert.equal(purchases[0][2].currency, 'BRL');
context.window.RC_analytics.track('tool_started', { source: 'person@example.com', tool: 'chunks' });
events = context.window.dataLayer.filter(x => x[0] === 'event');
assert.equal(events.at(-1)[2].source, undefined, 'email is removed from event parameters');
const count = events.length;
context.window.RC_analytics.consent('denied');
context.window.RC_analytics.track('tool_started', { tool: 'chunks' });
assert.equal(context.window.dataLayer.filter(x => x[0] === 'event').length, count, 'revoked consent stops events');
memory.set('rc_analytics_consent_v1', 'accepted');
const reloaded = { ...context, window: { RC_CONFIG: context.window.RC_CONFIG }, document };
vm.runInNewContext(source, reloaded, { filename: 'analytics.js#reload' });
reloaded.window.RC_analytics.purchase({ id: 'chk_paid', paid: true, plan: 'vip7', amount_cents: 799 });
assert.equal(reloaded.window.dataLayer.filter(x => x[0] === 'event' && x[1] === 'purchase').length, 0, 'reload does not resend purchase');
const beforeDisabled = scripts.length;
const disabled = { ...context, window: { RC_CONFIG: { GOOGLE_ANALYTICS_ID: '', GOOGLE_TAG_MANAGER_ID: '' } }, document };
vm.runInNewContext(source, disabled, { filename: 'analytics.js#disabled' });
disabled.window.RC_analytics.track('page_view');
assert.equal(scripts.length, beforeDisabled, 'empty IDs never load a Google tag');
console.log('PASS: consent gates Google tag, page URL is sanitized, and confirmed purchase is deduplicated.');
