/* Regenerate absolute SEO URLs from the public config after a domain change. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(site, 'config.js'), 'utf8'), sandbox);
const config = sandbox.window.RC_CONFIG || {};
const base = String(config.SITE_URL || '').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+$/.test(base)) throw new Error('Configure SITE_URL como origem HTTPS em site/config.js.');
const routes = {
  'index.html': '/', 'chunks.html': '/chunks', 'builder-lab.html': '/builder-lab',
  'importar.html': '/importar', 'objetivos.html': '/objetivos', 'ferramentas.html': '/ferramentas',
  'privacidade.html': '/privacidade', 'termos.html': '/termos', 'reembolso.html': '/reembolso',
  'guia-conquistas.html': '/guia-conquistas', 'guia-backup.html': '/guia-backup'
};
for (const [file, route] of Object.entries(routes)) {
  const full = path.join(site, file);
  let html = fs.readFileSync(full, 'utf8');
  const url = base + route;
  html = html.replace(/(<link rel="canonical" href=")[^"]+("\s*\/?>)/i, '$1' + url + '$2');
  html = html.replace(/(<meta property="og:url" content=")[^"]+("\s*\/?>)/i, '$1' + url + '$2');
  html = html.replace(/(<meta property="og:image" content=")[^"]+("\s*\/?>)/i, '$1' + base + config.SITE_OG_IMAGE + '$2');
  html = html.replace(/<meta name="google-site-verification" content="[^"]*">\s*/g, '');
  const verification = String(config.GOOGLE_SITE_VERIFICATION || '');
  if (verification) {
    if (!/^[A-Za-z0-9_-]+$/.test(verification)) throw new Error('Token de verificação inválido.');
    html = html.replace('</head>', `<meta name="google-site-verification" content="${verification}">\n</head>`);
  }
  if (file === 'index.html') {
    html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (whole, data) => {
      const schema = JSON.parse(data);
      for (const node of schema['@graph'] || []) {
        node.url = base + '/';
        if (node.logo) node.logo = base + config.SITE_LOGO;
      }
      return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
    });
  }
  fs.writeFileSync(full, html);
}
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  Object.values(routes).map(route => `  <url><loc>${base}${route}</loc></url>`).join('\n') + '\n</urlset>\n';
fs.writeFileSync(path.join(site, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(site, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`);
console.log(`SEO sincronizado com ${base}`);
