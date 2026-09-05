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

const ingredientsOf = d => [...(d.make || []), ...(d.buy || [])];

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

test('stated protein matches the sum of the ingredients', () => {
  for (const d of DISHES) {
    const sum = (d.make || []).reduce((a, i) => a + (i.protein || 0), 0);
    assert.ok(Math.abs(sum - d.protein) <= 2,
      `${d.slug}: page says ${d.protein} g, ingredients sum to ${sum} g`);
  }
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

test('a dish has at least one buy-it alternative', () => {
  for (const d of DISHES) {
    assert.ok((d.buy || []).length > 0,
      `${d.slug} has no Buy it option, so the toggle shows an empty pane`);
  }
});

/* ------------------------------------------------- review honesty */

test('an unreviewed dish says so, and a reviewed one carries a real date', () => {
  for (const d of DISHES) {
    const html = fs.readFileSync(path.join(ROOT, `dish-${d.slug}.html`), 'utf8');
    if (d.reviewed) {
      assert.match(d.reviewed, /^\d{4}-\d{2}-\d{2}$/, `${d.slug}: reviewed must be a date`);
      assert.ok(html.includes('review-banner reviewed'), `${d.slug} should show the reviewed banner`);
    } else {
      assert.ok(html.includes('review-banner unreviewed'),
        `${d.slug} is unreviewed but does not say so`);
      assert.ok(!html.includes('review-banner reviewed'),
        `${d.slug} claims a review it has not had`);
    }
  }
});

test('no unreviewed dish is advertised in the sitemap', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const d of DISHES) {
    const url = `https://glp1-nav.com/dish-${d.slug}.html`;
    if (d.reviewed) continue;
    assert.ok(!xml.includes(url),
      `${d.slug} is a draft but is in sitemap.xml — Google should not be sent an unreviewed recipe`);
  }
});

/* ------------------------------------------------------ generated pages */

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
