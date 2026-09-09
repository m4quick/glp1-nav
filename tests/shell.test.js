/* Tests for the mobile app shell.
 *
 * The failures these guard against are all silent — the page still looks
 * fine in a desktop browser and nothing throws:
 *
 *   - a new page added without a route from the phone, because the header
 *     nav it was copied from is display:none at that width;
 *   - a missing viewport-fit=cover, which makes env(safe-area-inset-bottom)
 *     read 0 and drops the tab bar under the iPhone home indicator;
 *   - a shared component styled inline on one page only, which is exactly
 *     how the shopping tray came to render unstyled on every dish page.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const MOBILE_JS = fs.readFileSync(path.join(ROOT, 'js', 'mobile.js'), 'utf8');

// 404 has its own stylesheet and no navigation; the Google token file is a
// bare verification page. Neither takes the shell.
const SKIP = new Set(['404.html', 'googleed6289f13060e549.html']);

const pages = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !SKIP.has(f))
  .filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('/styles.css'))
  .sort();

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const hrefs = (html) => [...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]);
/* Cloudflare Pages serves /foo.html at /foo and 308-redirects the .html form,
   so internal links name the extensionless URL. Resolve either shape to the
   file that backs it, or a legitimate link looks like a dead one. */
const toFile = (href) => {
  const clean = href.split(/[?#]/)[0].replace(/^\//, '');
  if (clean === '') return 'index.html';
  return clean.endsWith('.html') ? clean : `${clean}.html`;
};

test('there are pages to check at all', () => {
  assert.ok(pages.length >= 13, `only found ${pages.length} pages`);
});

test('every page opts into the safe area', () => {
  // Without viewport-fit=cover, env(safe-area-inset-bottom) is 0 on iOS and
  // the tab bar sits under the home indicator with its taps swallowed.
  for (const p of pages) {
    assert.match(read(p), /content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/,
      `${p} is missing viewport-fit=cover`);
  }
});

test('every page has exactly one tab bar and loads the shell script', () => {
  for (const p of pages) {
    const html = read(p);
    assert.equal((html.match(/<nav class="tabbar"/g) || []).length, 1, `${p} tab bar count`);
    assert.ok(html.includes('<script defer src="/js/mobile.js"></script>'), `${p} mobile.js`);
  }
});

test('every tab points at a page that exists', () => {
  for (const p of pages) {
    const bar = read(p).match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
    for (const h of hrefs(bar)) {
      assert.ok(fs.existsSync(path.join(ROOT, toFile(h))), `${p}: tab -> missing ${h}`);
    }
  }
});

test('at most one tab is marked current, and a dish marks Dishes', () => {
  for (const p of pages) {
    const bar = read(p).match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
    const on = (bar.match(/aria-current="page"/g) || []).length;
    assert.ok(on <= 1, `${p} has ${on} current tabs`);
    if (p.startsWith('dish-')) {
      assert.match(bar, /<a href="\/dishes(\.html)?" class="on" aria-current="page">/,
        `${p} should light the Dishes tab, not none`);
    }
  }
});

/* Walk outward from the phone's entry points instead of demanding every page
   sit directly in one of them. A page linked from a page that is in the nav is
   reachable; requiring direct membership flagged four legitimate articles that
   hang off nutrition.html. A real orphan still fails, because nothing links to
   it from anywhere the walk can start. */
function walk(starts) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f) || !fs.existsSync(path.join(ROOT, f))) continue;
    seen.add(f);
    for (const h of hrefs(read(f))) queue.push(toFile(h));
  }
  return seen;
}

function phoneEntryPoints() {
  const home = read('index.html');
  const bar = home.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
  const foot = home.match(/<footer[\s\S]*?<\/footer>/)[0];
  const sheet = [...MOBILE_JS.matchAll(/href: '(\/[^']+)'/g)].map((m) => m[1]);
  return [...hrefs(bar), ...hrefs(foot), ...sheet].map(toFile);
}

test('every page is reachable from a phone', () => {
  // Below 768px the header nav is display:none. A page reachable from none of
  // the tab bar, the More sheet or the footer -- directly or through a page
  // that is -- exists only for people on a laptop.
  const seen = walk(phoneEntryPoints());
  const orphans = pages.filter((p) => !p.startsWith('dish-') && !seen.has(p));
  assert.deepEqual(orphans, [], `unreachable on mobile: ${orphans.join(', ')}`);
});

test('the footer reaches every page without JavaScript', () => {
  // The More sheet is built in JS. Without it the footer is the only mobile
  // route, so the walk has to work from the footer alone.
  const foot = read('index.html').match(/<footer[\s\S]*?<\/footer>/)[0];
  const seen = walk(hrefs(foot).map(toFile));
  const missing = pages.filter((p) => !p.startsWith('dish-') && !seen.has(p));
  assert.deepEqual(missing, [], `not reachable without JS: ${missing.join(', ')}`);
});

test('a genuinely orphaned page would still be caught', () => {
  // The walk is only worth having if it fails for a page nothing links to.
  // Proving that here is what makes a pass above meaningful.
  const seen = walk(phoneEntryPoints());
  assert.ok(!seen.has('no-such-orphan.html'), 'the walk invented a page');
  assert.ok(seen.has('index.html') && seen.size > 5,
    'the walk should reach the whole site, not stall at the entry points');
});

test('the More sheet only lists pages that exist', () => {
  for (const m of MOBILE_JS.matchAll(/href: '(\/[^']+)'/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, toFile(m[1]))), `More sheet -> missing ${m[1]}`);
  }
});

test('the shopping tray is styled in the shared stylesheet, not inline', () => {
  // This is the bug this work found: .tray, .pick and .food-tile lived only
  // inside protein-calculator.html, so the tray that shopping-list.js builds
  // rendered position:static and transparent, below the footer, on every
  // dish page. Adding an ingredient looked like nothing happened.
  for (const sel of ['.tray {', '.tray-items', '.chip {', '.pick {', '.food-tile {']) {
    assert.ok(CSS.includes(sel), `styles.css is missing ${sel}`);
  }
  for (const p of pages) {
    const style = (read(p).match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    assert.ok(!/^\s*\.tray\s*\{/m.test(style), `${p} re-declares .tray inline`);
  }
});

test('the picker is positioned by its container, not by itself', () => {
  // Moving .pick into the shared sheet carried `position: absolute` with it.
  // On a dish page nothing above the row is positioned, so all five pickers
  // stacked at the top-left of the document — pointing at nothing, over the
  // hero image. The rule has to be scoped to the card that anchors it.
  const bare = CSS.match(/(^|\n)\.pick \{[^}]*\}/);
  assert.ok(bare, 'styles.css should define a bare .pick');
  assert.ok(!/position:\s*absolute/.test(bare[0]),
    '.pick must not position itself — scope it to .food-item .pick');
  assert.match(CSS, /\.food-item \.pick \{[^}]*position:\s*absolute/,
    'the product card still needs its corner picker');
});

test('the tray sits on top of the tab bar rather than under it', () => {
  assert.match(CSS, /\.tray\s*\{[^}]*bottom:\s*var\(--tabbar-h\)/,
    '.tray must be offset by the tab bar height');
  assert.match(CSS, /body\s*\{\s*padding-bottom:\s*calc\(var\(--tray-h\) \+ var\(--tabbar-h\)\)/,
    'body must reserve room for both');
  const sl = fs.readFileSync(path.join(ROOT, 'js', 'shopping-list.js'), 'utf8');
  assert.ok(sl.includes("setProperty('--tray-h'"), 'shopping-list.js must publish --tray-h');
  assert.ok(!sl.includes('body.style.paddingBottom'),
    'shopping-list.js must not write body padding directly any more');
});

test('the header nav is hidden on phones but still served to every client', () => {
  assert.match(CSS, /header p, \.nav-links \{ display: none; \}/);
  for (const p of pages) {
    assert.ok(read(p).includes('class="nav-links"'), `${p} lost its header nav`);
  }
});

test('pages are not stale against ops/apply-shell.py', () => {
  execFileSync('python3', [path.join(ROOT, 'ops', 'apply-shell.py'), '--check'], { cwd: ROOT });
});

/* ------------------------------------------------------------------
 * The tray folds
 *
 * Reported from a phone: the list covered most of the page and moved
 * around while typing. Measured at 375x812 before the fix: tray 265px
 * + tab bar 56px = 321px, 40% of the viewport, held there permanently
 * (48% on an SE). With the keyboard up, iOS pins both to the shrinking
 * visual viewport, so together they covered the field being typed into.
 * ------------------------------------------------------------------ */

const SL = fs.readFileSync(path.join(ROOT, 'js', 'shopping-list.js'), 'utf8');

test('the tray is a handle plus a body that folds away', () => {
  assert.match(CSS, /\.tray-handle\s*\{/, 'styles.css must define the always-visible handle');
  assert.match(CSS, /\.tray-body\s*\{/, 'styles.css must define the foldable body');
  assert.match(CSS, /\.tray-body\[hidden\]\s*\{\s*display:\s*none/,
    'the folded body must take no height');

  assert.ok(SL.includes('class="tray-handle"'), 'render() must emit a handle');
  assert.ok(SL.includes('class="tray-body"'), 'render() must emit a body');

  // The old rule capped the whole tray and scrolled it, which meant the
  // handle scrolled away with everything else.
  const tray = CSS.match(/(^|\n)\.tray \{[^}]*\}/);
  assert.ok(tray, 'styles.css should define a bare .tray');
  assert.ok(!/overflow-y/.test(tray[0]),
    '.tray must not scroll as a whole — only .tray-body scrolls, so the handle stays put');
  assert.match(CSS, /\.tray-body\s*\{[^}]*overflow-y:\s*auto/,
    '.tray-body must scroll so a long list cannot push the handle off screen');
});

test('the handle is a real touch target and says which way it goes', () => {
  const h = CSS.match(/\.tray-handle \{[^}]*\}/)[0];
  const min = h.match(/min-height:\s*(\d+)px/);
  assert.ok(min && Number(min[1]) >= 44,
    `.tray-handle needs min-height >= 44px for a thumb, got ${min && min[1]}`);
  assert.ok(SL.includes('aria-expanded'), 'the handle must report its state to a screen reader');
  assert.ok(SL.includes('aria-controls="tray-body"'), 'the handle must name what it folds');
});

test('Clear lives inside the body, not over the handle', () => {
  // It used to be position:absolute against the tray, which is now the
  // handle's corner — a mis-tap reaching for "expand" would wipe the list.
  const clear = CSS.match(/\.tray-top \.clear \{[^}]*\}/)[0];
  assert.ok(!/position:\s*absolute/.test(clear),
    'Clear must not be pinned to the tray corner any more');
  const body = SL.slice(SL.indexOf('class="tray-body"'));
  assert.ok(body.includes('data-clear'), 'Clear must be rendered inside the folding body');
});

test('the keyboard fold is a reaction, not a preference', () => {
  // Folding for the keyboard must never be written to localStorage: if it
  // were, typing your weight once would leave the tray shut for good and
  // the visitor would have no idea why.
  const fold = SL.slice(SL.indexOf("addEventListener('focusin'"),
                        SL.indexOf("addEventListener('click'"));
  assert.ok(fold.length > 0, 'the focus handlers must exist');
  assert.ok(/applyOpen\(/.test(fold), 'the fold must go through applyOpen');
  assert.ok(!/setOpen\(/.test(fold),
    'the fold must not persist — setOpen would make a keyboard tap permanent');
  assert.ok(/isField\(document\.activeElement\)/.test(fold),
    'moving between two fields must not flap the tray open and shut');
});
