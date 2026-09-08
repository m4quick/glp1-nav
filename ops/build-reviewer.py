#!/usr/bin/env python3
"""Generate the dietitian's own page from reviewer.json.

Two things make this worth having. A reader deciding whether to trust a
nutrition claim wants to know who checked it, and Google, in a category it
treats as Your Money or Your Life, weighs an anonymous "reviewed by our staff
dietitian" at close to nothing. A named professional with a registration
number and a visible record of what she has said is the strongest signal this
site can produce, and the one a competitor without a dietitian cannot copy.

The page refuses to exist until she has agreed in writing to be named. Being
the named reviewer on a health site is a liability she carries personally, not
a marketing decision made for her.

    python3 ops/build-reviewer.py            write the page
    python3 ops/build-reviewer.py --check    fail if stale
    python3 ops/build-reviewer.py --status   what is blocking it
"""

import html
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(ROOT, "our-dietitian.html")

_spec = importlib.util.spec_from_file_location(
    "apply_shell", os.path.join(HERE, "apply-shell.py"))
shell = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shell)


def e(s):
    return html.escape(str(s), quote=True)


def load():
    with open(os.path.join(ROOT, "reviewer.json"), encoding="utf-8") as f:
        return json.load(f)


def blockers(rv):
    r = rv["reviewer"]
    out = []
    if not r.get("consented"):
        out.append("she has not agreed in writing to be named")
    if not r.get("name"):
        out.append("no name")
    if not r.get("credentials"):
        out.append("no credentials")
    if not r.get("registration"):
        out.append("no registration number — the thing a reader can actually check")
    if not r.get("bio"):
        out.append("no bio")
    if not rv.get("comments"):
        out.append("no comments yet — a reviewer page with nothing on it is worse than none")
    return out


def title_for(page):
    """A readable title for the page a comment is about."""
    if page.startswith("dish-"):
        return page[5:].replace("-", " ").capitalize()
    if page.startswith("symptom-"):
        return page[8:].replace("-", " ").capitalize()
    return page.replace("-", " ").capitalize()


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="description" content="{desc}">
    <title>{name} &mdash; who reviews the nutrition on this site | GLP-1 Navigator</title>
    <link rel="canonical" href="https://glp1-nav.com/our-dietitian">
    <link rel="stylesheet" href="/styles.css">
    <link rel="stylesheet" href="/dishes.css">
    <script type="application/ld+json">{schema}</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8510922003408038"
     crossorigin="anonymous"></script>
</head>
<body>
    <header>
        <div class="container">
            <h1><a href="/">&#129517; GLP-1 Navigator</a></h1>
            <p>Who checks the nutrition here</p>
            <div class="nav-links">
{navlinks}
            </div>
        </div>
    </header>

    <div class="container">
        <article class="tool-box reviewer-page">
            <h2>{name}{cred}</h2>
            <p class="reg">{registration_body} registration {registration}</p>

            <div class="bio">{bio}</div>

            <section class="scope">
                <h3>What she reviews, and what she does not</h3>
                <p>She reads the recipes, the nutrition figures and the advice, and
                says whether they are sound for somebody whose appetite has collapsed.</p>
                <p><strong>She does not review products.</strong> Where this site points at
                something you can buy, the nutrition shown is the manufacturer's claim from
                the packet. She can say whether that claim is plausible and whether the food
                suits you. She is not vouching for the manufacturer, and she has no
                relationship with any brand named here.</p>
                <p>She does not review the medication pages. Those describe what these
                medicines do to a body, which is a prescriber's territory, and they are
                compiled from FDA labelling rather than reviewed by a clinician.</p>
            </section>

            <section class="record">
                <h3>What she has said</h3>
                <p class="lead">Every comment, on the page she made it about. Nothing here is
                edited for tone.</p>
{record}
            </section>
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


def render(rv):
    r = rv["reviewer"]
    by_page = {}
    for c in rv["comments"]:
        by_page.setdefault(c["page"], []).append(c)

    blocks = []
    for page, cs in sorted(by_page.items()):
        items = "\n".join(
            f'                        <li><p>{e(c["text"])}</p>'
            f'<p class="by">{e(c.get("on", ""))}'
            f'<time>{e(c.get("date", ""))}</time></p></li>' for c in cs)
        blocks.append(
            f'                <div class="rec">\n'
            f'                    <h4><a href="/{e(page)}">{e(title_for(page))}</a></h4>\n'
            f'                    <ul>\n{items}\n                    </ul>\n'
            f'                </div>')

    schema = json.dumps({
        "@context": "https://schema.org", "@type": "Person",
        "name": r["name"], "jobTitle": "Registered Dietitian",
        "hasCredential": r.get("credentials"),
        "identifier": r.get("registration"),
        "description": r.get("bio"),
        "url": "https://glp1-nav.com/our-dietitian",
    }, indent=2)

    return shell.apply(TEMPLATE.format(
        name=e(r["name"]),
        cred=f', {e(r["credentials"])}' if r.get("credentials") else "",
        registration=e(r.get("registration", "")),
        registration_body=e(r.get("registrationBody", "")),
        bio=e(r["bio"]), schema=schema,
        desc=e(f'{r["name"]} reviews the nutrition content on GLP-1 Navigator. '
               f'What she checks, what she does not, and every comment she has made.'),
        navlinks=shell.nav(""),
        record="\n".join(blocks) or
        '                <p>No comments recorded yet.</p>',
    ), "our-dietitian.html")


def main():
    rv = load()
    block = blockers(rv)

    if "--status" in sys.argv:
        print("our-dietitian.html")
        if block:
            for b in block:
                print(f"  BLOCKED: {b}")
        else:
            print(f"  ready — {len(rv['comments'])} comment(s)")
        return 0

    if block:
        if os.path.exists(PAGE):
            os.remove(PAGE)
            print("  - our-dietitian.html removed (no longer publishable)")
        print(f"  · not publishable: {'; '.join(block)}")
        return 0

    out = render(rv)
    old = open(PAGE, encoding="utf-8").read() if os.path.exists(PAGE) else None
    if old == out:
        print("  = our-dietitian.html")
    elif "--check" in sys.argv:
        print("  ~ our-dietitian.html STALE")
        return 1
    else:
        open(PAGE, "w", encoding="utf-8").write(out)
        print(f"  {'+' if old is None else '~'} our-dietitian.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
