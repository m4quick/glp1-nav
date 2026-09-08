/* The dietitian: what may be said in her name, and what may not.
 *
 * She is the most valuable thing on this site and the easiest to misuse.
 * These tests stop three specific overreaches, one of which already happened:
 * signing her name to product recommendations she cannot make, publishing her
 * name before she agreed to carry it, and letting a green tick stand in for
 * an opinion she never gave.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const RV = JSON.parse(fs.readFileSync(path.join(ROOT, 'reviewer.json'), 'utf8'));
const DISHES = JSON.parse(fs.readFileSync(path.join(ROOT, 'dishes.json'), 'utf8')).dishes;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const named = () => !!(RV.reviewer.consented && RV.reviewer.name);

test('she is not named anywhere until she has agreed to be', () => {
  if (named()) return;                       // consent recorded; nothing to guard
  const nm = RV.reviewer.name;
  assert.equal(nm, null, 'a name is set without a consent date beside it');
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html'))) {
    assert.ok(!/class="dietitian"[\s\S]{0,200}From (?!our staff dietitian)/.test(read(f)),
      `${f} attributes a comment to someone other than "our staff dietitian"`);
  }
});

test('her page does not exist until every gate is met', () => {
  const exists = fs.existsSync(path.join(ROOT, 'our-dietitian.html'));
  const r = RV.reviewer;
  const ready = !!(r.consented && r.name && r.credentials && r.registration
                   && r.bio && RV.comments.length);
  assert.equal(exists, ready,
    exists ? 'our-dietitian.html exists but the data does not support it'
           : 'the data is complete but the page has not been built');
});

test('a registration number is required before she is named', () => {
  // A name with letters after it that a reader cannot check is worth less than
  // no name, and invites the reader to trust something unverifiable.
  if (!named()) return;
  assert.ok(RV.reviewer.registration, 'named without a registration number');
  assert.ok(RV.reviewer.registrationBody, 'a registration number with no issuing body');
});

test('she has not signed off any product', () => {
  // She reviewed the dish pages, and I recorded that as her signing the
  // ready-made options too. She cannot: a dietitian can say whether a packet's
  // claimed nutrition is plausible, not vouch for what is in the tin.
  for (const m of DISHES) {
    if (!m.prepared) continue;
    assert.equal(m.prepared.reviewed, null,
      `${m.slug}: the prepared route carries a dietitian sign-off she cannot give`);
    assert.ok(m.prepared.figuresFrom,
      `${m.slug}: prepared route must say where its figures come from`);
  }
});

test('a page with a manufacturer route says so in its banner', () => {
  for (const m of DISHES) {
    if (!m.prepared || !m.made || !m.made.reviewed) continue;
    const html = read(`dish-${m.slug}.html`);
    assert.match(html, /Recipe reviewed by/,
      `${m.slug}: banner must say the recipe was reviewed, not the page`);
    assert.match(html, /manufacturer/i,
      `${m.slug}: banner must say the ready-made figures are not hers`);
  }
});

test('every comment points at a page that exists', () => {
  for (const c of RV.comments) {
    assert.ok(c.page && c.text && c.date, 'a comment is missing page, text or date');
    const f = path.join(ROOT, `${c.page}.html`);
    assert.ok(fs.existsSync(f), `comment on "${c.page}", which is not a page`);
  }
});

test('a comment appears on the page it is about', () => {
  const byPage = {};
  for (const c of RV.comments) (byPage[c.page] ||= []).push(c);
  for (const [page, cs] of Object.entries(byPage)) {
    const html = read(`${page}.html`);
    assert.match(html, /class="dietitian"/, `${page}: has comments but renders none`);
    for (const c of cs) {
      assert.ok(html.includes(c.text.slice(0, 40)),
        `${page}: a comment was recorded but dropped from the page`);
    }
  }
});

test('the generators agree with what is checked in', () => {
  execFileSync('python3', [path.join(ROOT, 'ops', 'build-reviewer.py'), '--check'],
    { cwd: ROOT });
  execFileSync('python3', [path.join(ROOT, 'ops', 'build-dishes.py'), '--check'],
    { cwd: ROOT });
});
