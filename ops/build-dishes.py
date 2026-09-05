#!/usr/bin/env python3
"""Generate the dish pages from dishes.json.

Static HTML on purpose. These pages exist to be found — the site was only
submitted to Google this week — and a JavaScript-rendered dish list is
invisible to a crawler. One file per dish, each with its own title, meta
description and canonical.

    python3 ops/build-dishes.py            write the pages
    python3 ops/build-dishes.py --check    fail if the pages are stale

A dish with "reviewed": null renders an amber banner saying so and is left
out of sitemap.xml. Nothing here claims a review that has not happened.
"""
import html, importlib.util, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "dishes.json")

# The mobile app shell (viewport-fit, tab bar, mobile.js, footer index) is
# owned by apply-shell.py. Generated pages run through the same function the
# hand-written pages do, so `--check` compares like with like and there is
# exactly one definition of the tab bar.
_shell_spec = importlib.util.spec_from_file_location(
    "apply_shell", os.path.join(os.path.dirname(os.path.abspath(__file__)), "apply-shell.py"))
shell = importlib.util.module_from_spec(_shell_spec)
_shell_spec.loader.exec_module(shell)


NAV = [("/", "Home"), ("/dishes.html", "Dishes"), ("/medications.html", "Medications"),
       ("/nutrition.html", "Nutrition"), ("/protein-foods.html", "Protein Foods"),
       ("/protein-calculator.html", "Calculator"), ("/faq.html", "FAQ"), ("/about.html", "About")]


def e(s):
    return html.escape(str(s), quote=True)


def nav(here):
    rows = []
    for href, text in NAV:
        cls = ' class="here"' if href == here else ""
        rows.append(f'                <a href="{href}"{cls}>{text}</a>')
    return "\n".join(rows)


def banner(dish):
    if dish.get("reviewed"):
        return ('    <div class="review-banner reviewed">\n'
                '        <span class="rb-icon">&#9989;</span>\n'
                f'        <span><strong>Reviewed by our staff dietitian on {e(dish["reviewed"])}.</strong>'
                'General nutrition information, not personalised dietetic advice. '
                '<a href="/about.html">Our editorial policy</a></span>\n'
                '    </div>')
    return ('    <div class="review-banner unreviewed">\n'
            '        <span class="rb-icon">&#9888;&#65039;</span>\n'
            '        <span><strong>Not yet reviewed by our dietitian.</strong>'
            'Published as a draft while it waits for review. Protein and calorie figures are '
            'estimates from standard food composition values and may change. '
            '<a href="/about.html">How we source this</a></span>\n'
            '    </div>')


def ingredient_rows(items):
    out = []
    for i in items:
        name = e(i["name"])
        sub = i.get("note") or i.get("qty") or ""
        g = i.get("protein") or 0
        grams = f'<span class="ing-g">{g} g</span>' if g else '<span class="ing-g none">&mdash;</span>'
        out.append(
            f'                    <li class="ing" data-name="{name}" data-protein="{g}">\n'
            f'                        <span class="ing-tx"><b>{name}</b><small>{e(sub)}</small></span>\n'
            f'                        {grams}\n'
            f'                    </li>')
    return "\n".join(out)


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="description" content="{desc}">
    <title>{title} | GLP-1 Navigator</title>
    <link rel="canonical" href="https://glp1-nav.com/dish-{slug}.html">
    <link rel="stylesheet" href="/styles.css">
    <link rel="stylesheet" href="/dishes.css">
    <script src="/js/amazon-links.js"></script>
    <script src="/js/shopping-list.js"></script>
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
        <article class="tool-box dish">
            <img class="dish-hero" src="/images/dishes/{image}.webp" alt="{title}" width="520" height="390">
            <h2>{title}</h2>
            <p class="dish-blurb">{blurb}</p>

            <div class="dish-macros">
                <div><b>{protein} g</b><span>protein</span></div>
                <div><b>{calories}</b><span>calories</span></div>
                <div><b>{hands_on}</b><span>hands on</span></div>
                <div><b>{serves}</b><span>serves</span></div>
            </div>

            <div class="dish-toggle">
                <button type="button" data-tab="make" class="on">Make it</button>
                <button type="button" data-tab="buy">Buy it</button>
            </div>

            <section class="pane" data-pane="make">
                <ul class="ings">
{make_rows}
                </ul>
                <button type="button" class="dish-cta" data-add-all="make">Add these to my list</button>
                <h3>How</h3>
                <ol class="steps">
{steps}
                </ol>
            </section>

            <section class="pane" data-pane="buy" hidden>
                <p class="pane-intro">Shortcuts for the days cooking is not going to happen. Similar protein, no pan.</p>
                <ul class="ings">
{buy_rows}
                </ul>
                <button type="button" class="dish-cta" data-add-all="buy">Add these to my list</button>
            </section>

            <div class="tip-box"><h4>&#128161; Worth knowing</h4><p>{tip}</p></div>

            <p class="dish-foot">Protein and calorie figures are estimates from standard food composition
            values for the quantities listed. They are not a nutrition prescription and your own portions
            will vary. Work out your daily target with the <a href="/protein-calculator.html">protein calculator</a>.</p>
            <p class="dish-foot"><strong>Affiliate disclosure:</strong> product links are Amazon affiliate
            links and we may earn a small commission at no extra cost to you. It never changes what we list.</p>
        </article>
    </div>

    <footer>
        <div class="container">
            <p>&copy; 2026 GLP-1 Navigator</p>
            <p style="margin-top:15px;">
                <a href="/about.html">About</a>
                <a href="/contact.html">Contact</a>
                <a href="/privacy.html">Privacy Policy</a>
                <a href="/terms.html">Terms of Service</a>
            </p>
        </div>
    </footer>
    <script src="/js/dish.js"></script>
</body>
</html>
"""


def render(d):
    return shell.apply(_render(d), f'dish-{d["slug"]}.html')


def _render(d):
    return TEMPLATE.format(
        slug=d["slug"], title=e(d["title"]), short=e(d["short"]),
        desc=e(f'{d["title"]} — {d["protein"]} g protein, {d["calories"]} calories, '
               f'{d["handsOn"]} hands on. Buy the shortcut or make it from fresh, for GLP-1 appetites.'),
        blurb=e(d["blurb"]), protein=d["protein"], calories=d["calories"],
        hands_on=e(d["handsOn"]), serves=d["serves"], image=e(d["image"]),
        navlinks=nav("/dishes.html"), banner=banner(d),
        make_rows=ingredient_rows(d["make"]),
        buy_rows=ingredient_rows(d["buy"]),
        steps="\n".join(f"                    <li>{e(s)}</li>" for s in d["steps"]),
        tip=e(d["tip"]))



INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="description" content="High-protein meals for GLP-1 appetites. Every dish can be made from fresh ingredients or swapped for a no-cooking shortcut, with the protein counted either way.">
    <title>What to Eat on a GLP-1 &mdash; Dishes You Can Buy or Make</title>
    <link rel="canonical" href="https://glp1-nav.com/dishes.html">
    <link rel="stylesheet" href="/styles.css">
    <link rel="stylesheet" href="/dishes.css">
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8510922003408038"
     crossorigin="anonymous"></script>
</head>
<body>
    <header>
        <div class="container">
            <h1><a href="/">&#129517; GLP-1 Navigator</a></h1>
            <p>Meals for the days when eating is the hard part</p>
            <div class="nav-links">
{navlinks}
            </div>
        </div>
    </header>

    <div class="review-banner unreviewed">
        <span class="rb-icon">&#9888;&#65039;</span>
        <span><strong>These recipes are drafts.</strong>They are published while they wait for review by our
        staff dietitian. Protein and calorie figures are estimates from standard food composition values.
        <a href="/about.html">How we source this</a></span>
    </div>

    <div class="container">
        <div class="tool-box content-section">
            <h2>Buy it or make it</h2>
            <p>Knowing you need 130&nbsp;g of protein is not the same as knowing what to have for dinner.
            Each of these is a whole meal with the protein counted, and each one comes two ways: made from
            fresh ingredients, or swapped for something that needs no cooking at all. Pick whichever the day
            allows.</p>
            <p>Add what you want as you go &mdash; the list follows you between pages, and you make one trip
            to the shop at the end rather than one per ingredient.</p>

            <div class="dish-grid">
{cards}
            </div>

            <p style="margin-top:26px">Not sure how much protein you are aiming for? The
            <a href="/protein-calculator.html">protein calculator</a> works it out from your height, weight
            and phase, and every dish here shows what it contributes.</p>
        </div>
    </div>

    <footer>
        <div class="container">
            <p>&copy; 2026 GLP-1 Navigator</p>
            <p style="margin-top:15px;">
                <a href="/about.html">About</a>
                <a href="/contact.html">Contact</a>
                <a href="/privacy.html">Privacy Policy</a>
                <a href="/terms.html">Terms of Service</a>
            </p>
            <p class="legal"><strong>Affiliate disclosure:</strong> some links on this site are Amazon
            affiliate links. If you buy through one we may earn a small commission at no additional cost
            to you. This never affects which foods or dishes we describe.</p>
        </div>
    </footer>
</body>
</html>
"""


def card(d):
    draft = ' <span class="draft">draft</span>' if not d.get("reviewed") else ""
    return (f'                <a class="dish-card" href="/dish-{d["slug"]}.html">\n'
            f'                    <img src="/images/dishes/{e(d["image"])}.webp" alt="" '
            f'loading="lazy" width="520" height="390">\n'
            f'                    <span class="c">\n'
            f'                        <b>{e(d["title"])}{draft}</b>\n'
            f'                        <small>{e(d["blurb"])}</small>\n'
            f'                        <span class="meta">{d["protein"]} g protein &middot; '
            f'{d["calories"]} cal &middot; {e(d["handsOn"])}</span>\n'
            f'                    </span>\n'
            f'                </a>')


def render_index(dishes):
    body = INDEX_TEMPLATE.format(navlinks=nav("/dishes.html"),
                                 cards="\n".join(card(d) for d in dishes))
    return shell.apply(body, "dishes.html")


def update_sitemap(dishes):
    """Only reviewed dishes go in. A draft should not be advertised to Google."""
    path = os.path.join(ROOT, "sitemap.xml")
    xml = open(path, encoding="utf-8").read()
    wanted = ["https://glp1-nav.com/dishes.html"] + [
        f'https://glp1-nav.com/dish-{d["slug"]}.html' for d in dishes if d.get("reviewed")]
    existing = set(re.findall(r"<loc>\s*([^<\s]+)", xml))
    added = [u for u in wanted if u not in existing]
    if not added:
        return []
    entries = "".join(f"    <url>\n        <loc>{u}</loc>\n    </url>\n" for u in added)
    xml = xml.replace("</urlset>", entries + "</urlset>")
    open(path, "w", encoding="utf-8").write(xml)
    return added


def main():
    check = "--check" in sys.argv
    data = json.load(open(DATA, encoding="utf-8"))["dishes"]
    stale = []
    for d in data:
        path = os.path.join(ROOT, f'dish-{d["slug"]}.html')
        out = render(d)
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old == out:
            print(f"  = dish-{d['slug']}.html")
            continue
        if check:
            stale.append(path)
            print(f"  ~ dish-{d['slug']}.html STALE")
            continue
        open(path, "w", encoding="utf-8").write(out)
        draft = "  (draft, awaiting review)" if not d.get("reviewed") else ""
        print(f"  {'+' if old is None else '~'} dish-{d['slug']}.html{draft}")
    idx = os.path.join(ROOT, "dishes.html")
    out = render_index(data)
    old = open(idx, encoding="utf-8").read() if os.path.exists(idx) else None
    if old == out:
        print("  = dishes.html")
    elif check:
        stale.append(idx); print("  ~ dishes.html STALE")
    else:
        open(idx, "w", encoding="utf-8").write(out)
        print(f"  {'+' if old is None else '~'} dishes.html")

    if not check:
        added = update_sitemap(data)
        for u in added:
            print(f"  + sitemap: {u}")
        drafts = [d["slug"] for d in data if not d.get("reviewed")]
        if drafts:
            print(f"  · {len(drafts)} draft(s) held back from sitemap.xml: {', '.join(drafts)}")

    if check and stale:
        print("\nPages do not match dishes.json. Run: python3 ops/build-dishes.py")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
