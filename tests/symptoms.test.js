/* Symptom pages: the filter, the gates, and the promises the page makes.
 *
 * These pages carry more risk than anything else on the site. They tell
 * someone what a medicine is doing to their body, and they are read by people
 * who are worried. The tests exist to make certain the page cannot overstate
 * what has been checked, cannot drop the red flags, and cannot publish a
 * filtered list so short it is useless.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const F = require('../js/meal-filter.js');
const SYM = JSON.parse(fs.readFileSync(path.join(ROOT, 'symptoms.json'), 'utf8'));
const MEALS = JSON.parse(fs.readFileSync(path.join(ROOT, 'dishes.json'), 'utf8')).dishes;
const VOCAB = JSON.parse(fs.readFileSync(path.join(ROOT, 'dishes.json'), 'utf8'))._vocabulary;

const symptoms = SYM.symptoms;
const page = (s) => path.join(ROOT, `symptom-${s.slug}.html`);
const published = (s) => fs.existsSync(page(s));

/* ---------------------------------------------------------------- filter */

test('the filter excludes on the axis it is asked to', () => {
  const r = F.select(MEALS, { protein: { exclude: ['chicken'] } }, { includeDrafts: true });
  for (const m of r.matched) {
    assert.ok(!m.tags.protein.includes('chicken'), `${m.slug} contains chicken`);
  }
  assert.ok(r.rejected.some((x) => x.why === 'contains chicken'),
    'a rejection should say what it found');
});

test('"either" temperature satisfies both hot and cold', () => {
  // The salmon dish is tagged either, on the strength of its own tip that cold
  // from the fridge is easier. Someone who can only face cold food should still
  // be offered it.
  const cold = F.select(MEALS, { temperature: { is: ['cold'] } }, { includeDrafts: true });
  const hot = F.select(MEALS, { temperature: { is: ['hot'] } }, { includeDrafts: true });
  const either = MEALS.filter((m) => m.tags.temperature === 'either').map((m) => m.slug);
  for (const slug of either) {
    assert.ok(cold.matched.some((m) => m.slug === slug), `${slug} missing from cold`);
    assert.ok(hot.matched.some((m) => m.slug === slug), `${slug} missing from hot`);
  }
});

test('aroma is a ceiling, not an equality test', () => {
  const r = F.select(MEALS, { aroma: { max: 'low' } }, { includeDrafts: true });
  for (const m of r.matched) {
    assert.ok(F.AROMA_RANK[m.tags.aroma] <= F.AROMA_RANK.low,
      `${m.slug} smells ${m.tags.aroma}`);
  }
});

test('a numeric floor rejects a meal with no figure rather than assuming zero', () => {
  // Every migrated meal has fiber null. Treating null as 0 would silently drop
  // them; treating it as "good enough" would invent a number. It has to reject
  // and say why.
  const r = F.select(MEALS, { minFiber: 6 }, { includeDrafts: true });
  assert.equal(r.matched.length, 0);
  assert.ok(r.rejected.every((x) => x.why === 'fibre not known'),
    'should say the figure is unknown, not that it is too low');
});

test('the review gate is on by default', () => {
  const open = F.select(MEALS, {}, { includeDrafts: true });
  const gated = F.select(MEALS, {});
  assert.ok(open.matched.length > 0, 'drafts should be visible when asked for');
  assert.equal(gated.matched.length, MEALS.filter(F.isLive).length);
});

/* ------------------------------------------------------------ definitions */

test('every symptom carries all six sections and a red-flag list', () => {
  assert.ok(symptoms.length > 0);
  for (const s of symptoms) {
    for (const k of ['asked', 'happening', 'why', 'timeline']) {
      assert.ok(s[k] && s[k].length > 40, `${s.slug}: ${k} is missing or too short`);
    }
    assert.ok(Array.isArray(s.helps) && s.helps.length >= 2, `${s.slug}: helps`);
    assert.ok(Array.isArray(s.redFlags) && s.redFlags.length >= 1,
      `${s.slug}: must tell people when to stop and call someone`);
  }
});

test('every filter uses the vocabulary the meals are actually tagged with', () => {
  // A filter naming an axis value that no meal can carry returns nothing
  // forever, and looks like a content shortage rather than a typo.
  const NUMERIC = new Set(['minProtein', 'minFiber', 'maxSodium', 'maxCalories']);
  for (const s of symptoms) {
    for (const [axis, spec] of Object.entries(s.filter)) {
      if (NUMERIC.has(axis)) {
        assert.equal(typeof spec, 'number', `${s.slug}: ${axis} must be a number`);
        continue;
      }
      assert.ok(VOCAB[axis], `${s.slug}: "${axis}" is not a tag axis`);
      const values = [].concat(spec.exclude || [], spec.include || [],
                               spec.includes || [], spec.is || [],
                               spec.max ? [spec.max] : []);
      for (const v of values) {
        assert.ok(VOCAB[axis].includes(v),
          `${s.slug}: "${v}" is not a valid ${axis} value`);
      }
    }
  }
});

test('slugs are unique and URL-safe', () => {
  const seen = new Set();
  for (const s of symptoms) {
    assert.match(s.slug, /^[a-z0-9-]+$/, `${s.slug} is not URL-safe`);
    assert.ok(!seen.has(s.slug), `duplicate slug ${s.slug}`);
    seen.add(s.slug);
  }
});

/* ------------------------------------------------------------------ gates */

test('nothing publishes without both reviews', () => {
  for (const s of symptoms) {
    if (!published(s)) continue;
    assert.ok(s.reviewed.nutrition,
      `symptom-${s.slug}.html exists but the food advice is unreviewed`);
    assert.ok(s.reviewed.clinical,
      `symptom-${s.slug}.html exists but the clinical content is unreviewed`);
  }
});

test('nothing publishes on unverified citations', () => {
  // The clinical sections describe what a medicine does to a body. This site
  // has no clinician, so those sections stand on their sources or not at all.
  for (const s of symptoms) {
    if (!published(s)) continue;
    for (const src of s.sources || []) {
      assert.ok(src.verified && src.url,
        `symptom-${s.slug}.html cites "${src.label}" without a checked URL`);
    }
  }
});

test('nothing publishes with a thin meal list', () => {
  for (const s of symptoms) {
    if (!published(s)) continue;
    const r = F.select(MEALS, s.filter);
    assert.ok(r.matched.length >= s.minMeals,
      `symptom-${s.slug}.html shows ${r.matched.length} meals, needs ${s.minMeals}`);
  }
});

test('a published page states the red flags in its own markup', () => {
  for (const s of symptoms) {
    if (!published(s)) continue;
    const html = fs.readFileSync(page(s), 'utf8');
    assert.match(html, /class="sx redflags"/, `${s.slug}: red flags section missing`);
    for (const f of s.redFlags) {
      assert.ok(html.includes(f.slice(0, 30)),
        `${s.slug}: red flag dropped from the page — "${f.slice(0, 40)}"`);
    }
  }
});

test('no published page claims a review it does not have', () => {
  for (const s of symptoms) {
    if (!published(s)) continue;
    const html = fs.readFileSync(page(s), 'utf8');
    const bothReviewed = s.reviewed.nutrition && s.reviewed.clinical;
    if (!bothReviewed) {
      assert.match(html, /review-banner unreviewed/, `${s.slug} must show the amber banner`);
      assert.ok(!/review-banner reviewed/.test(html),
        `${s.slug} claims a full review it does not have`);
    }
  }
});

test('no symptom page is in the sitemap before it is reviewed', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const s of symptoms) {
    if (s.reviewed.nutrition && s.reviewed.clinical) continue;
    assert.ok(!xml.includes(`symptom-${s.slug}.html`),
      `unreviewed symptom-${s.slug}.html is in the sitemap`);
  }
});

test('the builder agrees with the checked-in pages', () => {
  execFileSync('python3', [path.join(ROOT, 'ops', 'build-symptoms.py'), '--check'],
    { cwd: ROOT });
});
