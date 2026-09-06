/* Whole-site audit: links, assets, affiliate hygiene, markup sanity.
 *
 * Everything here is checkable without a browser, so it runs on every push.
 * The faults it looks for are the ones that do not throw and do not look
 * broken on the page you happened to be editing: a link to a file that was
 * renamed, an <img> whose photo never got generated, an affiliate URL that
 * lost its tag and now earns nothing, a canonical pointing at the wrong page.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TAG = require('../js/amazon-links.js').TAG;

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p.replace(/^\//, '').split(/[?#]/)[0]));

/* Cloudflare Pages serves /foo.html at /foo, so an extensionless internal
   link is valid when the .html twin is on disk. */
function resolves(href) {
  const clean = href.split(/[?#]/)[0];
  if (clean === '' || clean === '/') return exists('index.html');
  return exists(clean) || exists(clean + '.html');
}

test('every internal link points at something that exists', () => {
  const bad = [];
  for (const p of pages) {
    for (const m of read(p).matchAll(/href="(\/[^"]*)"/g)) {
      if (!resolves(m[1])) bad.push(`${p} -> ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `dead internal links:\n  ${bad.join('\n  ')}`);
});

test('every local asset referenced by a page is on disk', () => {
  const bad = [];
  for (const p of pages) {
    const html = read(p);
    for (const re of [/<img[^>]+src="(\/[^"]+)"/g, /<script[^>]+src="(\/[^"]+)"/g,
                      /<link[^>]+href="(\/[^"]+\.css)"/g]) {
      for (const m of html.matchAll(re)) if (!exists(m[1])) bad.push(`${p} -> ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `missing assets:\n  ${bad.join('\n  ')}`);
});

test('every image the JS can render is on disk', () => {
  // Food photos and dish photos are named in data, not in markup, so a typo
  // there produces a broken image that no HTML scan would catch.
  const A = require('../js/amazon-links.js');
  const bad = [];
  for (const [name, e] of Object.entries(A.MAP)) {
    if (e.img && !exists(`/images/foods/${e.img}.webp`)) bad.push(`${name} -> ${e.img}.webp`);
  }
  for (const d of JSON.parse(read('dishes.json')).dishes) {
    if (!exists(`/images/dishes/${d.image}.webp`)) bad.push(`dish ${d.slug} -> ${d.image}.webp`);
  }
  assert.deepEqual(bad, [], `missing images:\n  ${bad.join('\n  ')}`);
});

/* A monetised Amazon link is a product page, a search or a cart add. Amazon's
   own help pages are cited on privacy.html as a source and must stay clean:
   tagging a link to somebody's privacy policy would be both pointless and a
   misrepresentation. */
const MONETISED = /amazon\.com\/(dp\/|s\?|gp\/aws\/cart)/;

test('every Amazon product link is tagged and carries the right rel', () => {
  // An untagged link is a click that earns nothing. A missing rel is a link
  // Google can read as an unpaid editorial endorsement.
  const bad = [];
  for (const p of pages) {
    for (const m of read(p).matchAll(/<a\b[^>]*href="(https:\/\/www\.amazon\.com\/[^"]*)"[^>]*>/g)) {
      const [tagStr, href] = [m[0], m[1]];
      if (!MONETISED.test(href)) continue;
      if (!href.includes(`tag=${TAG}`)) bad.push(`${p}: untagged ${href.slice(0, 70)}`);
      for (const r of ['sponsored', 'nofollow', 'noopener']) {
        if (!tagStr.includes(r)) bad.push(`${p}: missing rel=${r} on ${href.slice(0, 55)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `affiliate link problems:\n  ${bad.join('\n  ')}`);
});

test('an Amazon link that is a citation is not dressed up as a paid one', () => {
  const bad = [];
  for (const p of pages) {
    for (const m of read(p).matchAll(/<a\b[^>]*href="(https:\/\/www\.amazon\.com\/[^"]*)"[^>]*>/g)) {
      if (MONETISED.test(m[1])) continue;
      if (m[1].includes('tag=')) bad.push(`${p}: citation carries an affiliate tag — ${m[1]}`);
      if (m[0].includes('sponsored')) bad.push(`${p}: citation marked rel=sponsored — ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `mislabelled links:\n  ${bad.join('\n  ')}`);
});

test('the affiliate tag is stated once and used everywhere', () => {
  const stray = [];
  for (const p of pages) {
    for (const m of read(p).matchAll(/tag=([A-Za-z0-9-]+)/g)) {
      if (m[1] !== TAG) stray.push(`${p}: tag=${m[1]}`);
    }
  }
  assert.deepEqual(stray, [], `wrong associate tag:\n  ${stray.join('\n  ')}`);
});

test('every image has an alt attribute', () => {
  const bad = [];
  for (const p of pages) {
    for (const m of read(p).matchAll(/<img\b[^>]*>/g)) {
      if (!/\salt="/.test(m[0])) bad.push(`${p}: ${m[0].slice(0, 70)}`);
    }
  }
  assert.deepEqual(bad, [], `images without alt:\n  ${bad.join('\n  ')}`);
});

test('no page repeats an id', () => {
  // Duplicate ids make getElementById return the wrong node, which is the
  // kind of fault that shows up as one widget silently not updating.
  const bad = [];
  for (const p of pages) {
    const seen = new Set();
    for (const m of read(p).matchAll(/\sid="([^"]+)"/g)) {
      if (seen.has(m[1])) bad.push(`${p}: #${m[1]}`);
      seen.add(m[1]);
    }
  }
  assert.deepEqual(bad, [], `duplicate ids:\n  ${bad.join('\n  ')}`);
});

test('every canonical points at its own page', () => {
  const bad = [];
  for (const p of pages) {
    const m = read(p).match(/<link rel="canonical" href="https:\/\/glp1-nav\.com(\/[^"]*)"/);
    if (!m) continue;
    const want = p === 'index.html' ? '/' : `/${p}`;
    if (m[1] !== want) bad.push(`${p}: canonical says ${m[1]}`);
  }
  assert.deepEqual(bad, [], `wrong canonicals:\n  ${bad.join('\n  ')}`);
});

test('every page in the sitemap exists, and no draft is in it', () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>\s*https:\/\/glp1-nav\.com([^<\s]*)/g)].map((m) => m[1] || '/');
  assert.ok(locs.length > 0, 'sitemap is empty');
  for (const l of locs) assert.ok(resolves(l), `sitemap lists ${l}, which does not exist`);

  const drafts = JSON.parse(read('dishes.json')).dishes
    .filter((d) => !d.reviewed).map((d) => `/dish-${d.slug}.html`);
  for (const d of drafts) {
    assert.ok(!locs.includes(d), `${d} is unreviewed but is in the sitemap`);
  }
});

test('the shared scripts parse and export what the pages call', () => {
  const A = require('../js/amazon-links.js');
  for (const fn of ['url', 'anchor', 'photo', 'tile', 'mark', 'cartUrl', 'hasAsin', 'isLinked']) {
    assert.equal(typeof A[fn], 'function', `AmazonLinks.${fn} is missing`);
  }
  const M = require('../js/protein-math.js');
  for (const fn of ['protein', 'energy', 'bmr', 'validate']) {
    assert.equal(typeof M[fn], 'function', `ProteinMath.${fn} is missing`);
  }
});

test('the small controls keep a finger-sized tap area', () => {
  // Measured in the browser: pickers were 26x26 and "Buy on Amazon" 19px
  // tall. WCAG 2.2 SC 2.5.8 asks for 24x24 CSS px at AA and Apple's guidance
  // is 44pt. The visuals stay small; the hit box does not.
  const css = read('styles.css');
  assert.match(css, /\.pick::after \{[^}]*width: 44px;\s*height: 44px/,
    'the picker needs its expanded hit area back');
  assert.match(css, /\.food-item a \{[^}]*padding: 9px/,
    'the product-card link needs vertical padding to be tappable');
  assert.match(read('protein-calculator.html'), /\.pp-buy \{[^}]*padding: 8px/,
    'the shelf Amazon link needs vertical padding to be tappable');
});

test('the published contact address is on a domain the business owns', () => {
  // Affiliate networks and AdSense both read the contact page as evidence
  // that a real business is behind the site. A free mail provider weakens
  // that for no reason, and the m4quickstudios.com mailbox already works.
  const FREE = /@(gmail|yahoo|hotmail|outlook|aol|icloud|proton(mail)?|gmx|mail)\./i;
  const OWNED = /@(m4quickstudios\.com|glp1-nav\.com)$/i;
  const found = [];
  for (const p of pages) {
    for (const m of read(p).matchAll(/mailto:([^"'?\s>]+)/g)) {
      found.push([p, m[1]]);
      assert.ok(!FREE.test(m[1]), `${p}: ${m[1]} is a free mail provider`);
      assert.match(m[1], OWNED, `${p}: ${m[1]} is not on a domain M4Quick owns`);
    }
  }
  assert.ok(found.length > 0, 'the site should publish a contact address somewhere');
});

test('every page carries the analytics beacon exactly once', () => {
  // A rebuild silently stripped this from nine generated pages, because it had
  // been hand-added to the HTML and the generators regenerate wholesale. It
  // now has one definition in apply-shell.py. Twice on a page would also
  // double-count every visit.
  // The Google Search Console verification file is a bare token, not a page.
  // Putting a script tag in it risks the verification itself.
  const bad = [];
  for (const p of pages.filter((f) => !f.startsWith('google'))) {
    const n = (read(p).match(/cloudflareinsights\.com\/beacon/g) || []).length;
    if (n !== 1) bad.push(`${p}: ${n} beacons`);
  }
  assert.deepEqual(bad, [], `beacon problems:\n  ${bad.join('\n  ')}`);
});
