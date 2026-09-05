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
const toFile = (href) => (href === '/' ? 'index.html' : href.replace(/^\//, ''));

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
      assert.match(bar, /<a href="\/dishes\.html" class="on" aria-current="page">/,
        `${p} should light the Dishes tab, not none`);
    }
  }
});

test('every page is reachable from a phone', () => {
  // The header nav is display:none below 768px. If a page is in neither the
  // tab bar, the More sheet nor the footer index, it exists only for people
  // on a laptop. Dish detail pages are reached from dishes.html.
  const home = read('index.html');
  const bar = home.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
  const foot = home.match(/<footer[\s\S]*?<\/footer>/)[0];
  const sheet = [...MOBILE_JS.matchAll(/href: '(\/[^']+)'/g)].map((m) => m[1]);

  const reachable = new Set([...hrefs(bar), ...hrefs(foot), ...sheet].map(toFile));
  const orphans = pages.filter((p) => !p.startsWith('dish-') && !reachable.has(p));
  assert.deepEqual(orphans, [], `unreachable on mobile: ${orphans.join(', ')}`);
});

test('the footer alone reaches every page, for visitors without JavaScript', () => {
  // The More sheet is built in JS. The footer is the fallback, so it has to
  // stand on its own.
  const foot = read('index.html').match(/<footer[\s\S]*?<\/footer>/)[0];
  const linked = new Set(hrefs(foot).map(toFile));
  const missing = pages.filter((p) => !p.startsWith('dish-') && !linked.has(p));
  assert.deepEqual(missing, [], `not in the footer index: ${missing.join(', ')}`);
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
