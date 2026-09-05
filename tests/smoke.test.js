/* Post-deploy smoke test: what a visitor actually receives.
 *
 * The other suites read files off disk. That is the right place for almost
 * everything, and it is structurally blind to one class of fault: anything
 * that happens between the repository and the browser.
 *
 * It was written after exactly such a fault. tests/site.test.js asserts that
 * contact.html carries a mailto: on a domain we own, and it passes. The live
 * page served no mailto: at all — Cloudflare's Email Address Obfuscation had
 * rewritten it to "[email protected]" plus a decoder script. The address was
 * correct underneath, but nothing reading the page without JavaScript could
 * find it, and that page is what an affiliate network checks.
 *
 * So: only checks here that a file test cannot make.
 *
 *   SMOKE_BASE_URL=https://glp1-nav.com node --test tests/smoke.test.js
 *
 * Without SMOKE_BASE_URL every test skips, so a plain `node --test` never
 * reaches for the network.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
const skip = BASE ? false : 'set SMOKE_BASE_URL to run the smoke test';

const ROOT = path.join(__dirname, '..');
const local = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && f !== 'googleed6289f13060e549.html')
  .sort();
const ASSETS = [
  ['/styles.css', /text\/css/],
  ['/dishes.css', /text\/css/],
  ['/js/protein-math.js', /javascript/],
  ['/js/amazon-links.js', /javascript/],
  ['/js/shopping-list.js', /javascript/],
  ['/js/partners.js', /javascript/],
  ['/js/dish.js', /javascript/],
  ['/js/mobile.js', /javascript/],
];

const cache = new Map();
async function get(p, opts = {}) {
  const key = p + JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(BASE + p, { redirect: 'follow', ...opts });
  const out = { status: res.status, url: res.url, headers: res.headers,
                body: opts.method === 'HEAD' ? '' : await res.text() };
  cache.set(key, out);
  return out;
}

/* The CDN needs a moment after a deploy. Rather than sleep a fixed amount,
   wait until the stylesheet the edge serves is the one in this commit — which
   is both the readiness signal and a real assertion that the deploy landed. */
test('the edge is serving this commit', { skip, timeout: 180000 }, async () => {
  const want = local('styles.css');
  for (let i = 1; i <= 18; i++) {
    cache.clear();
    const got = await fetch(`${BASE}/styles.css?smoke=${Date.now()}`).then((r) => r.text());
    if (got === want) return;
    if (i === 18) {
      assert.fail(`after ${i} attempts the edge still serves a different styles.css `
                + `(${got.length} bytes vs ${want.length} local)`);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
});

test('every page is reachable', { skip }, async () => {
  const bad = [];
  for (const p of PAGES) {
    const r = await get('/' + p);
    if (r.status !== 200) bad.push(`${p} -> ${r.status}`);
  }
  assert.deepEqual(bad, [], `unreachable:\n  ${bad.join('\n  ')}`);
});

test('every asset is served with a usable content type', { skip }, async () => {
  const bad = [];
  for (const [p, type] of ASSETS) {
    const r = await get(p);
    if (r.status !== 200) { bad.push(`${p} -> ${r.status}`); continue; }
    const ct = r.headers.get('content-type') || '';
    if (!type.test(ct)) bad.push(`${p} -> ${ct}`);
    // A CDN that 200s an HTML error page in place of a script is the classic
    // silent failure: the page loads, the feature is simply gone.
    if (/<!DOCTYPE html/i.test(r.body.slice(0, 200))) bad.push(`${p} -> served HTML`);
  }
  assert.deepEqual(bad, [], `asset problems:\n  ${bad.join('\n  ')}`);
});

test('the contact address survives the edge', { skip }, async () => {
  // The originating case. Cloudflare's Email Address Obfuscation rewrites
  // mailto: links into an encoded span plus a decoder script, so the address
  // exists only for visitors running JavaScript.
  const r = await get('/contact.html');
  assert.equal(r.status, 200);

  assert.ok(!/__cf_email__|\/cdn-cgi\/l\/email-protection/.test(r.body),
    'Cloudflare is obfuscating the contact address. It is unreadable without '
    + 'JavaScript and invisible to anything that reads the page rather than '
    + 'renders it. Turn it off: Cloudflare dashboard -> Security -> Settings '
    + '-> Email Address Obfuscation.');

  const m = r.body.match(/mailto:([^"'?\s>]+)/);
  assert.ok(m, 'no mailto: in the served contact page');
  assert.match(m[1], /@(m4quickstudios\.com|glp1-nav\.com)$/,
    `served contact address is ${m[1]}`);
});

test('no page ships a Cloudflare email placeholder', { skip }, async () => {
  const bad = [];
  for (const p of PAGES) {
    const r = await get('/' + p);
    if (/\[email(&#160;| |&nbsp;)protected\]/i.test(r.body)) bad.push(p);
  }
  assert.deepEqual(bad, [], `pages showing "[email protected]": ${bad.join(', ')}`);
});

test('affiliate links reach the visitor with their tag intact', { skip }, async () => {
  // A rewrite, a proxy or a stripped query string between here and the
  // browser costs every commission on the page and nothing looks wrong.
  const TAG = require('../js/amazon-links.js').TAG;
  const r = await get('/protein-foods.html');
  const links = [...r.body.matchAll(/https:\/\/www\.amazon\.com\/(?:dp\/|s\?)[^"']*/g)]
    .map((m) => m[0]);
  assert.ok(links.length > 0, 'no Amazon links in the served page at all');
  for (const l of links) {
    assert.ok(l.includes(`tag=${TAG}`), `served link lost its tag: ${l.slice(0, 80)}`);
  }
});

test('the mobile shell reaches the visitor', { skip }, async () => {
  const bad = [];
  for (const p of PAGES) {
    if (p === '404.html') continue;
    const r = await get('/' + p);
    if (!r.body.includes('<nav class="tabbar"')) bad.push(`${p}: no tab bar`);
    if (!r.body.includes('viewport-fit=cover')) bad.push(`${p}: no viewport-fit`);
    if (!r.body.includes('/js/mobile.js')) bad.push(`${p}: no mobile.js`);
  }
  assert.deepEqual(bad, [], `shell missing live:\n  ${bad.join('\n  ')}`);
});

test('nothing live is telling Google to go away', { skip }, async () => {
  // A stray noindex is invisible on the page and fatal to a site that is
  // trying to get indexed for the first time.
  const bad = [];
  for (const p of PAGES) {
    const r = await get('/' + p);
    if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(r.body)) bad.push(`${p}: meta noindex`);
    const h = r.headers.get('x-robots-tag');
    if (h && /noindex/i.test(h)) bad.push(`${p}: X-Robots-Tag ${h}`);
  }
  assert.deepEqual(bad, [], `noindex found:\n  ${bad.join('\n  ')}`);
});

test('every URL in the live sitemap resolves, and no draft is in it', { skip }, async () => {
  const r = await get('/sitemap.xml');
  assert.equal(r.status, 200, 'sitemap.xml is not being served');
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)/g)].map((m) => m[1]);
  assert.ok(locs.length > 0, 'the live sitemap is empty');

  for (const u of locs) {
    const res = await fetch(u, { method: 'HEAD', redirect: 'follow' });
    assert.equal(res.status, 200, `sitemap lists ${u}, which returns ${res.status}`);
  }
  const drafts = JSON.parse(local('dishes.json')).dishes
    .filter((m) => !['delivered', 'prepared', 'made']
      .filter((k) => m[k]).some((k) => m[k].reviewed))
    .map((m) => `dish-${m.slug}.html`);
  for (const d of drafts) {
    assert.ok(!locs.some((u) => u.endsWith(d)), `unreviewed ${d} is in the live sitemap`);
  }
});

test('robots.txt points at the sitemap', { skip }, async () => {
  const r = await get('/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.body, /Sitemap:\s*https:\/\/\S+sitemap\.xml/i,
    'robots.txt does not name the sitemap');
  assert.ok(!/^Disallow:\s*\/\s*$/mi.test(r.body), 'robots.txt disallows the whole site');
});

test('a missing page returns 404, not 200', { skip }, async () => {
  // Cloudflare Pages will happily serve 200 for anything if 404.html is not
  // wired up, which turns every typo'd link into a soft 404 Google indexes.
  const r = await fetch(`${BASE}/definitely-not-a-page-${Date.now()}`, { redirect: 'follow' });
  assert.equal(r.status, 404, `expected 404, got ${r.status}`);
});

test('nothing on a live page loads over plain http', { skip }, async () => {
  const bad = [];
  for (const p of PAGES) {
    const r = await get('/' + p);
    for (const m of r.body.matchAll(/(?:src|href)="(http:\/\/[^"]+)"/g)) {
      bad.push(`${p} -> ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `mixed content:\n  ${bad.join('\n  ')}`);
});
