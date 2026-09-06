#!/usr/bin/env python3
"""Generate the symptom pages from symptoms.json.

A symptom page explains a change the medicine is causing and then offers meals
that work around it. The explanation is written; the meals are a live query
against dishes.json, so adding a meal updates every page it qualifies for.

Three gates, and a page publishes only when all three pass:

  meals     the filter must return at least minMeals. A filtered list of two
            is thin content and would do more harm than good, so the builder
            says which meal to write next rather than shipping it.
  nutrition the dietitian has read the food advice and the meals.
  clinical  every source behind the mechanism and the red flags has been
            fetched and checked. This site has no clinician, so the clinical
            sections stand on their citations or they do not stand at all.

Filtering is done by js/meal-filter.js rather than reimplemented here. One
copy, exercised by the tests, reusable in the browser later.

    python3 ops/build-symptoms.py            write the pages
    python3 ops/build-symptoms.py --check    fail if any page is stale
    python3 ops/build-symptoms.py --status   what is blocking each page
"""

import html
import importlib.util
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))

_spec = importlib.util.spec_from_file_location(
    "apply_shell", os.path.join(HERE, "apply-shell.py"))
shell = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shell)


def e(s):
    return html.escape(str(s), quote=True)


def load(name):
    return json.load(open(os.path.join(ROOT, name), encoding="utf-8"))


def filter_meals(meals, spec, include_drafts):
    """Delegate to js/meal-filter.js. A second implementation in Python would
    disagree with the tested one inside a week."""
    script = """
      const F = require(process.argv[1]);
      let raw = ''; process.stdin.on('data', d => raw += d).on('end', () => {
        const { meals, filter, includeDrafts } = JSON.parse(raw);
        const r = F.select(meals, filter, { includeDrafts });
        process.stdout.write(JSON.stringify({
          matched: r.matched.map(m => m.slug), rejected: r.rejected }));
      });
    """
    p = subprocess.run(
        ["node", "-e", script, os.path.join(ROOT, "js", "meal-filter.js")],
        input=json.dumps({"meals": meals, "filter": spec,
                          "includeDrafts": include_drafts}),
        capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        raise SystemExit(f"meal-filter failed: {p.stderr[:400]}")
    return json.loads(p.stdout)


def blockers(sym, matched):
    """Everything standing between this page and publication."""
    out = []
    if len(matched) < sym["minMeals"]:
        out.append(f"only {len(matched)} of {sym['minMeals']} meals match")
    if not sym["reviewed"]["nutrition"]:
        out.append("nutrition not reviewed")
    if not sym["reviewed"]["clinical"]:
        out.append("clinical not reviewed")
    unver = [s["label"] for s in sym.get("sources", []) if not s.get("verified")]
    if unver:
        out.append(f"{len(unver)} source(s) unverified")
    return out


def banner(sym):
    n, c = sym["reviewed"]["nutrition"], sym["reviewed"]["clinical"]
    if n and c:
        return ('    <div class="review-banner reviewed">\n'
                '        <span class="rb-icon">&#9989;</span>\n'
                f'        <span><strong>Reviewed on {e(c)}.</strong>'
                'General information, not personalised advice. '
                '<a href="/about.html">Our editorial policy</a></span>\n'
                '    </div>')
    # Say which half is unreviewed. A page whose food advice she has checked
    # but whose physiology nobody has should not carry the same blanket
    # warning as one nobody has read at all.
    if n and not c:
        lead = ("The food advice here is dietitian-reviewed. The explanation of "
                "what the medicine is doing is not clinician-reviewed.")
    elif c and not n:
        lead = "The food advice on this page has not been reviewed yet."
    else:
        lead = "Not yet reviewed."
    return ('    <div class="review-banner unreviewed">\n'
            '        <span class="rb-icon">&#9888;&#65039;</span>\n'
            f'        <span><strong>{e(lead)}</strong>'
            'Compiled from FDA labelling and NIH guidance. It is general '
            'information and not medical advice, and it cannot tell you whether '
            'what you are experiencing is normal for you. '
            '<a href="/about.html">How we source this</a></span>\n'
            '    </div>')


def meal_rows(meals, by_slug):
    out = []
    for slug in meals:
        m = by_slug[slug]
        route = next((r for r in ("delivered", "prepared", "made") if m.get(r)
                      and m[r].get("protein")), None) \
            or next(r for r in ("delivered", "prepared", "made") if m.get(r))
        r = m[route]
        bits = []
        if r.get("protein"):
            bits.append(f'{r["protein"]} g protein')
        if r.get("calories"):
            bits.append(f'{r["calories"]} cal')
        if r.get("handsOn"):
            bits.append(e(r["handsOn"]))
        out.append(
            f'                <a class="dish-card" href="/dish-{m["slug"]}.html">\n'
            f'                    <img src="/images/dishes/{e(m["image"])}.webp" alt="" '
            f'loading="lazy" width="520" height="390">\n'
            f'                    <span class="c"><b>{e(m["title"])}</b>\n'
            f'                        <small>{e(m["blurb"])}</small>\n'
            f'                        <span class="meta">{" &middot; ".join(bits)}</span>\n'
            f'                    </span>\n'
            f'                </a>')
    return "\n".join(out)


def bullets(items, cls=""):
    c = f' class="{cls}"' if cls else ""
    return f"<ul{c}>\n" + "\n".join(
        f"                    <li>{e(x)}</li>" for x in items) + "\n                </ul>"


def sources_block(sym):
    """Each source states what it was checked as supporting, so a reader can
    tell which sentence rests on which document."""
    rows = []
    for s in sym.get("sources", []):
        mark = "" if s.get("verified") else ' <em>(citation not yet verified)</em>'
        link = (f'<a href="{e(s["url"])}" target="_blank" rel="noopener">{e(s["label"])}</a>'
                if s.get("url") else e(s["label"]))
        sup = s.get("supports") or []
        detail = (f'<br><span class="supports">Checked for: {e("; ".join(sup))}</span>'
                  if sup else "")
        rows.append(f"                    <li>{link}{mark}{detail}</li>")
    return "\n".join(rows)


def not_in_label(sym):
    """The parts of the explanation the labels do not cover.

    Every article currently outranking this site states these as though they
    were documented. Saying which half is patient experience rather than
    prescribing information is the one thing here nobody else does."""
    items = sym.get("notInLabel") or []
    if not items:
        return ""
    lis = "\n".join(f"                    <li>{e(x)}</li>" for x in items)
    return ('            <section class="sx caveat">\n'
            '                <h3>What the label does not say</h3>\n'
            '                <p>Some of this comes from what people taking these '
            'medicines describe, not from the prescribing information. It is '
            'worth knowing which is which.</p>\n'
            f'                <ul>\n{lis}\n                </ul>\n'
            '            </section>\n')


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="description" content="{desc}">
    <title>{title} | GLP-1 Navigator</title>
    <link rel="canonical" href="https://glp1-nav.com/symptom-{slug}.html">
    <link rel="stylesheet" href="/styles.css">
    <link rel="stylesheet" href="/dishes.css">
    <link rel="stylesheet" href="/symptoms.css">
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8510922003408038"
     crossorigin="anonymous"></script>
</head>
<body>
    <header>
        <div class="container">
            <h1><a href="/">&#129517; GLP-1 Navigator</a></h1>
            <p>{short}</p>
            <div class="nav-links">
{navlinks}
            </div>
        </div>
    </header>

{banner}

    <div class="container">
        <article class="tool-box symptom">
            <h2>{title}</h2>
            <p class="asked">&ldquo;{asked}&rdquo;</p>

            <section class="sx">
                <h3>What is happening</h3>
                <p>{happening}</p>
            </section>

            <section class="sx">
                <h3>Why it happens</h3>
                <p>{why}</p>
            </section>

            <section class="sx">
                <h3>How long it usually lasts</h3>
                <p>{timeline}</p>
            </section>

            <section class="sx">
                <h3>What helps</h3>
                {helps}
            </section>

            <section class="sx redflags">
                <h3>When to stop and call your prescriber</h3>
                <p>These are not things to eat your way around. If any of them apply,
                contact your prescriber or seek urgent care.</p>
                {red_flags}
            </section>

            <section class="sx meals">
                <h3>What you can eat tonight</h3>
                <p class="mealintro">{meal_intro}</p>
                <div class="dish-grid">
{meals}
                </div>
            </section>

{not_in_label}
            <div class="also">
                <h3>People often have more than one of these</h3>
                <div class="also-list">
{also}
                </div>
            </div>

            <section class="sx sources">
                <h3>Where this comes from</h3>
                <ul>
{sources}
                </ul>
            </section>

            <p class="dish-foot">This page describes what is commonly reported and cannot
            tell you whether what you are experiencing is normal for you. It is not medical
            advice. Your prescriber knows your history; we do not.</p>
        </article>
    </div>

    <footer>
        <div class="container">
            <p>&copy; 2026 GLP-1 Navigator</p>
        </div>
    </footer>
</body>
</html>
"""


def also_links(sym, siblings):
    """Cross-links. Nobody has exactly one symptom, and a page that acts as
    though they do is a dead end."""
    out = []
    for other in siblings:
        if other["slug"] == sym["slug"]:
            continue
        out.append(f'                    <a href="/symptom-{other["slug"]}.html">'
                   f'{e(other["short"])}</a>')
    return "\n".join(out)


def render(sym, matched, by_slug, siblings):
    n = len(matched)
    intro = (f"{n} meals that work around this, each with the protein counted. "
             "Every one can be bought ready-made or cooked from scratch.")
    return shell.apply(TEMPLATE.format(
        slug=sym["slug"], title=e(sym["title"]), short=e(sym["short"]),
        desc=e(f'{sym["short"]} on a GLP-1: what is happening, why, how long it '
               f'lasts, and {n} meals that work around it.'),
        asked=e(sym["asked"]), happening=e(sym["happening"]), why=e(sym["why"]),
        timeline=e(sym["timeline"]),
        helps=bullets(sym["helps"]), red_flags=bullets(sym["redFlags"], "flags"),
        meal_intro=intro, meals=meal_rows(matched, by_slug),
        sources=sources_block(sym), also=also_links(sym, siblings),
        not_in_label=not_in_label(sym),
        navlinks=shell.nav(""), banner=banner(sym),
    ), f'symptom-{sym["slug"]}.html')


def update_sitemap(slugs):
    """Only fully reviewed pages go in.

    build-symptoms.py did not touch the sitemap at all until this was added,
    which meant a page could pass every gate, generate correctly, and never be
    offered to Google. That failure is invisible: the page looks finished.
    """
    path = os.path.join(ROOT, "sitemap.xml")
    xml = open(path, encoding="utf-8").read()
    want = [f"https://glp1-nav.com/symptom-{s}.html" for s in slugs]
    have = set(re.findall(r"<loc>\s*([^<\s]+)", xml))
    add = [u for u in want if u not in have]

    # A page that loses its review must come back out again.
    stale = [u for u in have
             if "/symptom-" in u and u not in want]
    for u in stale:
        xml = re.sub(r"\s*<url>\s*<loc>\s*" + re.escape(u) + r"\s*</loc>\s*</url>", "", xml)

    if add:
        entries = "".join(f"    <url>\n        <loc>{u}</loc>\n    </url>\n" for u in add)
        xml = xml.replace("</urlset>", entries + "</urlset>")
    if add or stale:
        open(path, "w", encoding="utf-8").write(xml)
    return add, stale


def main():
    check = "--check" in sys.argv
    status = "--status" in sys.argv

    syms = load("symptoms.json")["symptoms"]
    meals = load("dishes.json")["dishes"]
    by_slug = {m["slug"]: m for m in meals}

    stale, publishable = [], []
    for s in syms:
        # Drafts are included so an author can see the page taking shape; the
        # blockers still refuse to publish it.
        res = filter_meals(meals, s["filter"], include_drafts=True)
        matched = res["matched"]
        block = blockers(s, matched)

        if status:
            print(f"\n{s['slug']}")
            print(f"  meals matched : {len(matched)}/{s['minMeals']}  "
                  f"{', '.join(matched) or '(none)'}")
            if block:
                print(f"  BLOCKED       : {'; '.join(block)}")
                near = [r for r in res["rejected"] if r["why"] != "not reviewed"][:3]
                if len(matched) < s["minMeals"] and near:
                    print("  closest misses: " + "; ".join(
                        f"{r['slug']} ({r['why']})" for r in near))
            else:
                print("  ready to publish")
            continue

        if block:
            stale.append((s["slug"], block))
            continue

        publishable.append(s["slug"])
        path = os.path.join(ROOT, f'symptom-{s["slug"]}.html')
        out = render(s, matched, by_slug, syms)
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old == out:
            print(f"  = symptom-{s['slug']}.html")
        elif check:
            print(f"  ~ symptom-{s['slug']}.html STALE")
            return 1
        else:
            open(path, "w", encoding="utf-8").write(out)
            print(f"  {'+' if old is None else '~'} symptom-{s['slug']}.html")

    if status:
        return 0

    if not check:
        added, removed = update_sitemap(publishable)
        for u in added:
            print(f"  + sitemap: {u}")
        for u in removed:
            print(f"  - sitemap: {u}  (review withdrawn)")

    if not publishable:
        print(f"  · nothing publishable yet — {len(stale)} page(s) blocked. "
              f"Run --status to see why.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
