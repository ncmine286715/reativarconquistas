const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = path.resolve(__dirname, '..');
const routes = {
  'index.html': '/', 'chunks.html': '/chunks', 'builder-lab.html': '/builder-lab',
  'importar.html': '/importar', 'objetivos.html': '/objetivos', 'ferramentas.html': '/ferramentas',
  'privacidade.html': '/privacidade', 'termos.html': '/termos', 'reembolso.html': '/reembolso'
};
const base = 'https://worldify.com.br';
const sitemap = fs.readFileSync(path.join(site, 'sitemap.xml'), 'utf8');
for (const [file, route] of Object.entries(routes)) {
  const html = fs.readFileSync(path.join(site, file), 'utf8');
  assert.match(html, /<meta name="description" content="[^"]+">/, `${file} has a description`);
  assert.ok(html.includes(`<link rel="canonical" href="${base}${route}">`), `${file} has the right canonical`);
  assert.ok(html.includes(`<meta property="og:url" content="${base}${route}">`), `${file} has the right social URL`);
  assert.ok(sitemap.includes(`<loc>${base}${route}</loc>`), `${file} appears in sitemap`);
  assert.equal((html.match(/analytics\.js\?v=1/g) || []).length, 1, `${file} loads analytics once`);
}
{
  const file = 'world-studio.html', route = '/world-studio';
  const html = fs.readFileSync(path.join(site, file), 'utf8');
  assert.match(html, /<meta name="description" content="[^"]+">/, `${file} has a description`);
  assert.ok(html.includes(`<link rel="canonical" href="${base}${route}">`), `${file} has the right canonical`);
  assert.ok(html.includes(`<meta property="og:url" content="${base}${route}">`), `${file} has the right social URL`);
  assert.ok(sitemap.includes(`<loc>${base}${route}</loc>`), `${file} appears in sitemap`);
  assert.equal((html.match(/analytics\.js\?v=studio1/g) || []).length, 1, `${file} loads analytics once`);
}
for (const file of ['admin.html', 'minha-conta.html', 'sucesso.html', '404.html']) {  const html = fs.readFileSync(path.join(site, file), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/, `${file} is not indexable`);
  assert.ok(!sitemap.includes('/' + file.replace(/\.html$/, '')), `${file} is omitted from sitemap`);
}
assert.equal(fs.readFileSync(path.join(site, 'googlee400a800a1425492.html'), 'utf8').trim(), 'google-site-verification: googlee400a800a1425492.html');
console.log('PASS: public metadata and sitemap align; private pages are noindex; verification file is exact.');
