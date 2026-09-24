// Cloudflare Pages otherwise redirects .html files to extensionless URLs.
// Search Console requests this exact path for file verification.
const verification = "google-site-verification: googlee400a800a1425492.html";

export function onRequestGet() {
  return new Response(verification, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" }
  });
}

export function onRequestHead() {
  return new Response(null, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" }
  });
}
