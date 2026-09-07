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


# NAV and nav() live in apply-shell.py, with the tab bar and footer index.
NAV = shell.NAV
nav = shell.nav


def e(s):
    return html.escape(str(s), quote=True)


def nav(here):
    rows = []
    for href, text in NAV:
        cls = ' class="here"' if href == here else ""
        rows.append(f'                <a href="{href}"{cls}>{text}</a>')
    return "\n".join(rows)


ROUTES = ("delivered", "prepared", "made")

ROUTE_LABEL = {"delivered": "delivered", "prepared": "buy-it", "made": "recipe"}


def routes_of(m):
    """The routes this meal actually has, in display order."""
    return [r for r in ROUTES if m.get(r)]


def primary(m):
    """The route the page opens on.

    Display order is delivered, prepared, made — most convenience first, which
    is the order people choose in. But the page should open on a route that can
    actually tell you something: the four migrated meals carry only substitute
    shakes under `prepared`, with no protein figure, so opening there would show
    an empty macro strip. Primary is therefore the first route in display order
    that has a protein figure, falling back to the first route present.

    Once a real prepared entree is sourced with label nutrition, that meal opens
    on `prepared` without any change here — which is the intended behaviour.
    """
    live = routes_of(m)
    for r in live:
        if m[r].get("protein"):
            return r
    return live[0]


def is_live(m):
    """Whether a meal is listed in sitemap.xml.

    Two independent things used to be one. A route being *reviewed* is a
    clinical judgement; a page being *published* is an editorial one. Coupling
    them meant the only way to list a page was to assert a dietitian had signed
    it off, which is a claim the About page makes explicitly and which has to
    stay true. `publish` lists the page; the banner still reports, accurately,
    what has and has not been reviewed.
    """
    return m.get("publish") or any(m[r].get("reviewed") for r in routes_of(m))


def banner(m):
    live = routes_of(m)
    unreviewed = [r for r in live if not m[r].get("reviewed")]

    if not unreviewed:
        dates = sorted({m[r]["reviewed"] for r in live})
        return ('BOTTOM'
                '    <div class="review-banner reviewed">\n'
                '        <span class="rb-icon">&#9989;</span>\n'
                f'        <span><strong>Reviewed by our staff dietitian on {e(dates[-1])}.</strong>'
                'General nutrition information, not personalised dietetic advice. '
                '<a href="/about">Our editorial policy</a></span>\n'
                '    </div>')

    # Name what is unreviewed rather than damning the whole page. A meal whose
    # product choice she has signed off but whose recipe she has not should say
    # so, not carry a blanket warning that makes the reviewed half look unsafe.
    what = " and ".join(ROUTE_LABEL[r] for r in unreviewed)
    if len(unreviewed) == len(live):
        lead = "Not yet reviewed by our dietitian."
    else:
        lead = f"The {what} on this page has not been reviewed yet."
    return ('    <div class="review-banner unreviewed">\n'
            '        <span class="rb-icon">&#9888;&#65039;</span>\n'
            f'        <span><strong>{e(lead)}</strong>'
            'Published as a draft while it waits for review. Protein and calorie figures are '
            'estimates from standard food composition values and may change. '
            '<a href="/about">How we source this</a></span>\n'
            '    </div>')


def banner_slots(m):
    """Where the banner goes.

    An amber banner is a warning about the content below it, so it sits above
    that content. A green banner is a credential, and reads better at the end
    of the page it vouches for -- which is also where the owner asked for it.
    """
    b = banner(m)
    if b.startswith("BOTTOM"):
        return {"banner": "", "banner_bottom": b[len("BOTTOM"):]}
    return {"banner": b, "banner_bottom": ""}


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
    <link rel="canonical" href="https://glp1-nav.com/dish-{slug}">
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

{toggle}
{panes}
            <p class="dish-foot">Protein and calorie figures are estimates from standard food composition
            values for the quantities listed. They are not a nutrition prescription and your own portions
            will vary. Work out your daily target with the <a href="/protein-calculator">protein calculator</a>.</p>
            <p class="dish-foot"><strong>Affiliate disclosure:</strong> product links are Amazon affiliate
            links and we may earn a small commission at no extra cost to you. It never changes what we list.</p>
        </article>
    </div>

    <div class="ad-slot">
        <span class="ad-label">Advertisement</span>
        <ins class="adsbygoogle"
             style="display:block"
             data-ad-client="ca-pub-8510922003408038"
             data-ad-slot="3320436470"
             data-ad-format="auto"
             data-full-width-responsive="true"></ins>
        <script>(adsbygoogle = window.adsbygoogle || []).push({{}});</script>
    </div>
{banner_bottom}
    <footer>
        <div class="container">
            <p>&copy; 2026 GLP-1 Navigator</p>
            <p style="margin-top:15px;">
                <a href="/about">About</a>
                <a href="/contact">Contact</a>
                <a href="/privacy">Privacy Policy</a>
                <a href="/terms">Terms of Service</a>
            </p>
        </div>
    </footer>
    <script src="/js/partners.js"></script>
    <script src="/js/dish.js"></script>
</body>
</html>
"""


def macros(m, route):
    """The macro strip for one route, rendered inside that route's pane.

    It used to sit above the toggle and describe whichever route the page
    opened on, which meant switching to "Buy it" left the recipe's protein
    figure on screen above a completely different product. Per-pane is both
    correct and free of JavaScript.

    Only figures that exist are printed. A null carbs value renders as nothing
    at all rather than a dash or a zero, because a zero is a claim.
    """
    r = m[route]
    cells = []
    if r.get("protein"):
        cells.append(("%s g" % r["protein"], "protein"))
    if r.get("calories"):
        cells.append((str(r["calories"]), "calories"))
    if r.get("handsOn"):
        cells.append((r["handsOn"], "hands on"))
    if r.get("serves"):
        cells.append((str(r["serves"]), "serves"))
    for key, label in (("carbs", "carbs"), ("fat", "fat"), ("fiber", "fibre")):
        if r.get(key):
            cells.append(("%s g" % r[key], label))
    if not cells:
        return ""
    rows = "\n".join(f'                <div><b>{e(v)}</b><span>{label}</span></div>'
                     for v, label in cells)
    return '            <div class="dish-macros">\n' + rows + '\n            </div>\n'



TAB_LABEL = {"delivered": "Have it delivered", "prepared": "Buy it", "made": "Make it"}


def toggle(m):
    live = routes_of(m)
    if len(live) < 2:
        return ""                      # one route is not a choice
    first = primary(m)
    out = ['            <div class="dish-toggle">']
    for r in live:
        on = ' class="on"' if r == first else ""
        out.append(f'                <button type="button" data-tab="{r}"{on}>{TAB_LABEL[r]}</button>')
    out.append("            </div>")
    return "\n".join(out)


PANE_INTRO = {
    "prepared": "Shortcuts for the days cooking is not going to happen. No pan, no washing up.",
    "delivered": "Cooked and sent to you. No shopping either.",
}


def pane(m, route, first):
    r = m[route]
    hidden = "" if first else " hidden"
    out = [f'            <section class="pane" data-pane="{route}"{hidden}>']
    strip = macros(m, route)
    if strip:
        out.append(strip.rstrip("\n"))

    if route == "made":
        out.append('                <ul class="ings">')
        out.append(ingredient_rows(r["ingredients"]))
        out.append('                </ul>')
        out.append('                <button type="button" class="dish-cta" '
                   'data-add-all="made">Add these to my list</button>')
        out.append('                <h3>How</h3>')
        out.append('                <ol class="steps">')
        out.extend(f'                    <li>{e(step)}</li>' for step in r["steps"])
        out.append('                </ol>')
        if r.get("tip"):
            out.append('                <div class="tip-box"><h4>&#128161; Worth knowing</h4>'
                       f'<p>{e(r["tip"])}</p></div>')

    elif route == "prepared":
        out.append(f'                <p class="pane-intro">{PANE_INTRO["prepared"]}</p>')
        if r.get("kind") == "substitutes" and len(r["products"]) > 1:
            out.append('                <p class="pane-intro">Pick one — these are '
                       'alternatives, not a shopping list.</p>')
        out.append('                <ul class="ings">')
        out.append(ingredient_rows(r["products"]))
        out.append('                </ul>')
        out.append('                <button type="button" class="dish-cta" '
                   'data-add-all="prepared">Add these to my list</button>')

    elif route == "delivered":
        # Rendered but inert until Partners says the service is approved.
        # dish.js removes it otherwise, so an unapproved link never appears.
        out.append(f'                <p class="pane-intro">{PANE_INTRO["delivered"]}</p>')
        out.append(f'                <div class="deliver" data-service="{e(r["service"])}" '
                   f'data-plan="{e(r.get("plan", ""))}" hidden></div>')

    out.append('            </section>')
    return "\n".join(out)


def panes(m):
    first = primary(m)
    return "\n\n".join(pane(m, r, r == first) for r in routes_of(m))


def render(d):
    return shell.apply(_render(d), f'dish-{d["slug"]}.html')


def _render(m):
    first = m[primary(m)]
    bits = [f'{first["protein"]} g protein' if first.get("protein") else None,
            f'{first["calories"]} calories' if first.get("calories") else None,
            f'{first["handsOn"]} hands on' if first.get("handsOn") else None]
    summary = ", ".join(b for b in bits if b)
    return TEMPLATE.format(
        slug=m["slug"], title=e(m["title"]), short=e(m["short"]),
        desc=e(f'{m["title"]} — {summary}. '
               f'Buy the shortcut or make it from fresh, for GLP-1 appetites.'),
        blurb=e(m["blurb"]), image=e(m["image"]),
        navlinks=nav("/dishes.html"), **banner_slots(m),
        toggle=toggle(m), panes=panes(m))


INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="description" content="High-protein meals for GLP-1 appetites. Every dish can be made from fresh ingredients or swapped for a no-cooking shortcut, with the protein counted either way.">
    <title>What to Eat on a GLP-1 &mdash; Dishes You Can Buy or Make</title>
    <link rel="canonical" href="https://glp1-nav.com/dishes">
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
        <a href="/about">How we source this</a></span>
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
            <a href="/protein-calculator">protein calculator</a> works it out from your height, weight
            and phase, and every dish here shows what it contributes.</p>
        </div>
    </div>

    <footer>
        <div class="container">
            <p>&copy; 2026 GLP-1 Navigator</p>
            <p style="margin-top:15px;">
                <a href="/about">About</a>
                <a href="/contact">Contact</a>
                <a href="/privacy">Privacy Policy</a>
                <a href="/terms">Terms of Service</a>
            </p>
            <p class="legal"><strong>Affiliate disclosure:</strong> some links on this site are Amazon
            affiliate links. If you buy through one we may earn a small commission at no additional cost
            to you. This never affects which foods or dishes we describe.</p>
        </div>
    </footer>
</body>
</html>
"""


def card(m):
    draft = ' <span class="draft">draft</span>' if not is_live(m) else ""
    r = m[primary(m)]
    meta = " &middot; ".join(x for x in (
        f'{r["protein"]} g protein' if r.get("protein") else "",
        f'{r["calories"]} cal' if r.get("calories") else "",
        e(r["handsOn"]) if r.get("handsOn") else "",
    ) if x)
    ways = len(routes_of(m))
    if ways > 1:
        meta += f' &middot; {ways} ways'
    return (f'                <a class="dish-card" href="/dish-{m["slug"]}">\n'
            f'                    <img src="/images/dishes/{e(m["image"])}.webp" alt="" '
            f'loading="lazy" width="520" height="390">\n'
            f'                    <span class="c">\n'
            f'                        <b>{e(m["title"])}{draft}</b>\n'
            f'                        <small>{e(m["blurb"])}</small>\n'
            f'                        <span class="meta">{meta}</span>\n'
            f'                    </span>\n'
            f'                </a>')


def render_index(dishes):
    body = INDEX_TEMPLATE.format(navlinks=nav("/dishes.html"),
                                 cards="\n".join(card(d) for d in dishes))
    return shell.apply(body, "dishes.html")


def update_sitemap(dishes):
    """A meal enters once any one of its routes is reviewed.

    A page whose product choice she has signed off is worth indexing even if
    its recipe is still a draft — the page says which is which. A page with
    nothing reviewed on it stays out.
    """
    path = os.path.join(ROOT, "sitemap.xml")
    xml = open(path, encoding="utf-8").read()
    wanted = ["https://glp1-nav.com/dishes"] + [
        f'https://glp1-nav.com/dish-{d["slug"]}' for d in dishes if is_live(d)]
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
        draft = "  (draft, awaiting review)" if not is_live(d) else ""
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
        drafts = [d["slug"] for d in data if not is_live(d)]
        if drafts:
            print(f"  · {len(drafts)} draft(s) held back from sitemap.xml: {', '.join(drafts)}")

    if check and stale:
        print("\nPages do not match dishes.json. Run: python3 ops/build-dishes.py")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
