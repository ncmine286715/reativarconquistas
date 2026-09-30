const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const accountHtml = fs.readFileSync(path.join(__dirname, "..", "minha-conta.html"), "utf8");
const { JSDOM } = require("jsdom");
const accountDom = new JSDOM(accountHtml);
assert.equal(accountDom.window.document.compatMode, "CSS1Compat", "account keeps its valid HTML doctype");
assert.ok(accountDom.window.document.querySelector(".card .wf-account-help[href='suporte.html']"), "ticket shortcut is a real link inside the account card");
accountDom.window.close();
const inlineScripts = Array.from(accountHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(inlineScripts.length > 0, "account page contains its inline controller");
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `minha-conta.html#script-${index + 1}` }));
assert.match(accountHtml, /Abrir pagamento existente/, "the account page can reopen a pending checkout");
assert.match(accountHtml, /Retomar a criação do Pix/, "the account page can safely resume an uncertain Pix creation");
assert.match(accountHtml, /RC_entitlements\.refresh\(\)/, "manual benefit refresh reads the backend entitlement endpoint");

console.log("PASS: account page scripts parse and pending payment actions are available.");
