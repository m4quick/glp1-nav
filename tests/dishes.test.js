/* Tests for the dish pages and the shared Amazon link map.
 *
 * The failure these guard against is silent: a mistyped ingredient name loses
 * its affiliate link and nothing looks broken — the row just quietly renders
 * plain, and a click that would have earned a commission never exists. That
 * is the same class of fault as the three invented ASINs, which also looked
 * completely fine on the page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const A = require('../js/amazon-links.js');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'dishes.json'), 'utf8'));
const DISHES = DATA.dishes;
const ALLOW_PLAIN = new Set(DATA.unlinkedByDesign || []);

const ROUTES = ['delivered', 'prepared', 'made'];
const routesOf = m => ROUTES.filter(r => m[r]);
const isLive = m => routesOf(m).some(r => m[r].reviewed);

/* Every buyable line on a meal page, whichever route it came from. */
const ingredientsOf = m => [
  ...(m.made ? m.made.ingredients : []),
  ...(m.prepared ? m.prepared.products : []),
];

/* Several tests below iterate a collection. If a rename empties that
   collection they would pass by checking nothing, which is how a model change
   silently removes coverage — so each one counts what it checked. */
function counted(n, what) {
  assert.ok(n > 0, `checked nothing: ${what}. A shape change has emptied the collection.`);
}

/* ------------------------------------------------------------ link map */

test('every ASIN in the map is a plausible Amazon identifier', () => {
  for (const [name, e] of Object.entries(A.MAP)) {
    if (!e.asin) continue;
    assert.match(e.asin, /^[A-Z0-9]{10}$/, `${name} has a malformed ASIN: ${e.asin}`);
  }
});

test('every entry offers either an ASIN or a search, never neither', () => {
  for (const [name, e] of Object.entries(A.MAP)) {
    assert.ok(e.asin || e.q, `${name} is in the map but points nowhere`);
  }
});

test('every generated URL carries the affiliate tag', () => {
  for (const name of Object.keys(A.MAP)) {
    const u = A.url(name);
    assert.ok(u.includes('tag=' + A.TAG), `${name} lost the tag: ${u}`);
  }
});

test('a cart URL is built only from ASINs, and numbers them from 1', () => {
  const u = A.cartUrl(['Quest Protein Bars', 'Chicken Breast', 'Premier Protein Shake']);
  assert.match(u, /ASIN\.1=B00DLDH1N2/);
  assert.match(u, /ASIN\.2=B008JGIZGS/);
  assert.ok(!u.includes('ASIN.3'), 'a search-only food must not enter the cart');
});

test('a list with no ASINs yields no cart URL rather than an empty one', () => {
  assert.equal(A.cartUrl(['Chicken Breast', 'Salmon']), null);
  assert.equal(A.cartUrl([]), null);
});

test('lookup is case-insensitive so a stray capital does not drop a link', () => {
  assert.equal(A.url('chicken breast'), A.url('Chicken Breast'));
});

/* --------------------------------------------------------- dish content */

test('every ingredient is either linked or a recorded deliberate omission', () => {
  const orphans = [];
  for (const d of DISHES) {
    for (const i of ingredientsOf(d)) {
      if (!A.url(i.name) && !ALLOW_PLAIN.has(i.name)) {
        orphans.push(`${d.slug} → "${i.name}"`);
      }
    }
  }
  assert.deepEqual(orphans, [],
    'unlinked and unaccounted for — a typo, or add it to unlinkedByDesign:\n  ' + orphans.join('\n  '));
});

test('a recipe\'s stated protein matches the sum of its ingredients', () => {
  let n = 0;
  for (const m of DISHES) {
    if (!m.made) continue;
    const sum = m.made.ingredients.reduce((a, i) => a + (i.protein || 0), 0);
    assert.ok(Math.abs(m.made.protein - sum) <= 2,
      `${m.slug}: made.protein ${m.made.protein} vs ingredients ${sum}`);
    n++;
  }
  counted(n, 'recipe protein sums');
});

test('a route never states a protein figure it cannot support', () => {
  // The migration originally summed the two alternatives on the yogurt bowl
  // and produced 51 g — a number nobody could eat, because you pick one.
  // Alternatives carry no route total; a single named product may.
  let n = 0;
  for (const m of DISHES) {
    const p = m.prepared;
    if (!p) continue;
    assert.ok(['substitutes', 'entree'].includes(p.kind), `${m.slug}: unknown prepared.kind`);
    if (p.kind === 'substitutes' && p.products.length > 1) {
      assert.equal(p.protein, null,
        `${m.slug}: alternatives must not be summed into one protein figure`);
    }
    n++;
  }
  counted(n, 'prepared routes');
});

test('macros are either real numbers or null, never zero standing in for unknown', () => {
  // A zero renders as a fact. Unknown renders as nothing.
  let n = 0;
  for (const m of DISHES) {
    for (const r of routesOf(m)) {
      for (const k of ['protein', 'calories', 'carbs', 'fat', 'fiber', 'sodium']) {
        const v = m[r][k];
        if (v === undefined || v === null) continue;
        assert.ok(typeof v === 'number' && v > 0,
          `${m.slug}.${r}.${k} is ${JSON.stringify(v)} — use null for unknown`);
        n++;
      }
    }
  }
  counted(n, 'macro values');
});

test('every dish has its photograph on disk', () => {
  for (const d of DISHES) {
    const f = path.join(ROOT, 'images', 'dishes', d.image + '.webp');
    assert.ok(fs.existsSync(f), `${d.slug} is missing images/dishes/${d.image}.webp`);
  }
});

test('every dish has a generated page', () => {
  for (const d of DISHES) {
    assert.ok(fs.existsSync(path.join(ROOT, `dish-${d.slug}.html`)),
      `dish-${d.slug}.html has not been generated — run ops/build-dishes.py`);
  }
});

test('slugs are unique and URL-safe', () => {
  const seen = new Set();
  for (const d of DISHES) {
    assert.match(d.slug, /^[a-z0-9-]+$/, `${d.slug} is not URL-safe`);
    assert.ok(!seen.has(d.slug), `duplicate slug ${d.slug}`);
    seen.add(d.slug);
  }
});

test('every meal offers at least one route, and names its slots', () => {
  for (const m of DISHES) {
    assert.ok(routesOf(m).length > 0, `${m.slug}: no delivered, prepared or made route`);
    assert.ok(Array.isArray(m.slot) && m.slot.length,
      `${m.slug}: no meal slot, so nothing can schedule it`);
    for (const sl of m.slot) {
      assert.ok(['breakfast', 'lunch', 'dinner', 'snack'].includes(sl),
        `${m.slug}: unknown slot "${sl}"`);
    }
  }
  counted(DISHES.length, 'meals');
});

test('every preference tag is in the vocabulary', () => {
  // A typo'd tag stops matching silently and the meal quietly vanishes from
  // every plan — the same shape of fault as a mistyped ingredient losing its
  // affiliate link, and just as invisible on the page.
  const V = DATA._vocabulary;
  const SINGLE = new Set(['temperature', 'aroma']);
  let n = 0;
  for (const m of DISHES) {
    assert.ok(m.tags, `${m.slug}: no tags`);
    for (const [axis, val] of Object.entries(m.tags)) {
      assert.ok(V[axis], `${m.slug}: unknown preference axis "${axis}"`);
      const vals = SINGLE.has(axis) ? [val] : val;
      assert.ok(SINGLE.has(axis) ? typeof val === 'string' : Array.isArray(val),
        `${m.slug}.${axis}: ${SINGLE.has(axis) ? 'expected one value' : 'expected a list'}`);
      for (const v of vals) {
        assert.ok(V[axis].includes(v), `${m.slug}.${axis}: "${v}" is not in the vocabulary`);
        n++;
      }
    }
    for (const axis of Object.keys(V)) {
      assert.ok(axis in m.tags, `${m.slug}: missing the "${axis}" axis`);
    }
  }
  counted(n, 'preference tags');
});

test('an unreviewed route says so, and a reviewed one carries a real date', () => {
  let n = 0;
  for (const m of DISHES) {
    const page = fs.readFileSync(path.join(ROOT, `dish-${m.slug}.html`), 'utf8');
    for (const r of routesOf(m)) {
      const d = m[r].reviewed;
      assert.ok(d === null || typeof d === 'string',
        `${m.slug}.${r}: reviewed must be a date string or null`);
      if (d) assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `${m.slug}.${r}: not a date`);
      n++;
    }
    if (isLive(m)) {
      assert.ok(!/review-banner unreviewed/.test(page) || routesOf(m).some(r => !m[r].reviewed),
        `${m.slug}: has a reviewed route but the page warns about everything`);
    } else {
      assert.match(page, /review-banner unreviewed/,
        `${m.slug}: nothing on it is reviewed, so it must say so`);
      assert.ok(!/review-banner reviewed/.test(page),
        `${m.slug}: claims a review that has not happened`);
    }
  }
  counted(n, 'routes');
});

test('the sitemap follows the reviews, in both directions', () => {
  // Originally this only checked that drafts stay out, guarded by a counter so
  // it could not pass by checking nothing. Once every meal was reviewed there
  // were no drafts left and the guard fired on a perfectly correct state.
  // Asserting both directions is non-vacuous whichever way the data goes.
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const inMap = (m) => xml.includes(`/dish-${m.slug}`);

  for (const m of DISHES) {
    if (isLive(m)) {
      assert.ok(inMap(m), `${m.slug} is reviewed but missing from the sitemap`);
    } else {
      assert.ok(!inMap(m), `${m.slug} has no reviewed route but is in the sitemap`);
    }
  }
  counted(DISHES.length, 'meals');
});

test('the delivered route stays dark until a programme approves', () => {
  const P = require('../js/partners.js');
  for (const m of DISHES) {
    if (!m.delivered) continue;
    assert.ok(P.isApproved(m.delivered.service),
      `${m.slug} offers delivery from "${m.delivered.service}", which is not approved`);
  }
  // And the gate itself has to work, whether or not any meal uses it yet.
  assert.equal(P.link('not-a-real-service'), null);
  assert.equal(P.anchor('not-a-real-service'), '');
});

test('generated pages are not stale', () => {
  const { execFileSync } = require('node:child_process');
  try {
    execFileSync('python3', [path.join(ROOT, 'ops', 'build-dishes.py'), '--check'],
                 { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    assert.fail('dishes.json changed without rebuilding. Run: python3 ops/build-dishes.py\n'
                + String(err.stdout || ''));
  }
});

/* -------------------------------------------------- the ready-made shelf */

/* The calculator's product panel used to carry its own array with a second
 * copy of all four ASINs. Three invented ASINs once shipped and 404'd on
 * every click; a second copy of the list is how a fourth gets in. These
 * tests exist to keep there being exactly one list.
 */

const CALC = fs.readFileSync(path.join(ROOT, 'protein-calculator.html'), 'utf8');

test('the shelf is not empty and every product resolves to a real ASIN', () => {
  assert.ok(A.PRODUCTS.length >= 4, 'expected the shelf to have products');
  for (const p of A.PRODUCTS) {
    assert.ok(A.MAP[p.key], `${p.brand}: "${p.key}" is not a key in MAP`);
    assert.ok(A.hasAsin(p.key), `${p.brand}: no ASIN — a shelf product must be a specific product`);
    assert.match(A.url(p.key), /^https:\/\/www\.amazon\.com\/dp\/B[A-Z0-9]{9}\?tag=/,
      `${p.brand}: link is not a tagged product URL`);
  }
});

test('the calculator holds no second copy of the product list', () => {
  assert.ok(!/PROTEIN_PRODUCTS/.test(CALC), 'the old duplicate array is back');
  assert.ok(CALC.includes('AmazonLinks.PRODUCTS'), 'the panel must render from the shared list');
});

test('every ASIN written into the page agrees with the shared map', () => {
  // The reference grid keeps its links in the HTML on purpose, so they work
  // with JavaScript off and a crawler can see them. That is fine — what is
  // not fine is one of them drifting away from the verified map, which is
  // precisely how a dead link would reappear without anything looking wrong.
  const known = new Set(Object.values(A.MAP).map((e) => e.asin).filter(Boolean));
  for (const m of CALC.matchAll(/B[A-Z0-9]{9}/g)) {
    assert.ok(known.has(m[0]), `${m[0]} is in the page but not in the verified map`);
  }

  // And each one must be the ASIN its own card's product name resolves to.
  const cards = CALC.matchAll(
    /<div class="food-name">([^<]+)<\/div>[\s\S]{0,400}?amazon\.com\/dp\/(B[A-Z0-9]{9})\?tag=([^"]+)"/g);
  let checked = 0;
  for (const [, name, asin, tag] of cards) {
    const want = A.url(name.trim());
    assert.ok(want, `"${name.trim()}" has a hard-coded link but is not in the map`);
    assert.equal(want, `https://www.amazon.com/dp/${asin}?tag=${tag}`,
      `"${name.trim()}" links to ${asin}, the map says ${want}`);
    checked++;
  }
  assert.ok(checked >= 4, `expected to check the branded cards, checked ${checked}`);
});

test('every product carries what the panel needs to draw a row', () => {
  for (const p of A.PRODUCTS) {
    assert.ok(p.brand && p.kind && p.serving, `${p.key}: missing brand/kind/serving`);
    assert.ok(Number.isFinite(p.g) && p.g > 0, `${p.key}: protein must be a positive number`);
    assert.ok(A.SHAPES[p.shape], `${p.key}: no silhouette for shape "${p.shape}"`);
  }
});

test('a declared brand logo must actually be on disk', () => {
  // mark() falls back to the silhouette when logo is null, so a null is fine.
  // A filename that does not exist is a broken image on a page about to ask
  // someone for money.
  for (const p of A.PRODUCTS) {
    if (!p.logo) continue;
    const f = path.join(ROOT, 'images', 'brands', p.logo);
    assert.ok(fs.existsSync(f), `${p.brand}: logo declared but ${f} is missing`);
  }
});

test('mark() renders a logo when there is one and a silhouette when there is not', () => {
  const withLogo = { brand: 'X', shape: 'bar', logo: 'x.webp' };
  assert.match(A.mark(withLogo), /<img src="\/images\/brands\/x\.webp"/);
  const without = { brand: 'X', shape: 'bar', logo: null };
  assert.match(A.mark(without), /<svg viewBox="0 0 24 24"/);
  assert.ok(!A.mark(without).includes('<img'), 'no logo means no image tag');
});

test('every shelf row offers the list, not only the exit to Amazon', () => {
  // The panel's whole point is that a tap no longer ejects you and loses
  // every other option you were weighing up.
  assert.ok(CALC.includes('data-pick="\' + p.key'), 'rows must render a picker');
  assert.ok(CALC.includes('rel="sponsored nofollow noopener"'), 'affiliate links need rel');
  assert.match(CALC, /Affiliate disclosure/, 'the panel must disclose');
});
