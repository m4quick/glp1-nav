#!/usr/bin/env python3
"""Apply the mobile app shell to every content page.

Three edits per page, all idempotent:

  1. viewport-fit=cover on the viewport meta. Without it the fixed tab
     bar sits *under* the iPhone home indicator and its bottom row of
     taps is swallowed. env(safe-area-inset-bottom) reads 0 until this
     is set, so the CSS padding is inert on its own.
  2. js/mobile.js, deferred, in the head.
  3. The tab bar itself, immediately before </body>.

Plus one sitewide edit: the footer link row becomes a full site index,
because on phones the header nav is hidden and the fifth tab needs
JavaScript. With JS off the footer is how you reach Nutrition or FAQ.

  python3 ops/apply-shell.py           rewrite
  python3 ops/apply-shell.py --check   exit 1 if any page is stale
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Pages that use styles.css and the standard header. 404.html is excluded
# on purpose: it is a self-contained centred card with its own stylesheet
# and no navigation, and a tab bar on a dead end is noise.
SKIP = {"404.html", "googleed6289f13060e549.html"}

# The header nav, shared by every generator. It lives here with the tab bar
# and the footer index rather than in one generator, because three files each
# holding their own copy of the site's navigation is how they drift apart.
NAV = [("/", "Home"), ("/dishes", "Dishes"), ("/medications", "Medications"),
       ("/nutrition", "Nutrition"), ("/protein-foods", "Protein Foods"),
       ("/protein-calculator", "Calculator"), ("/faq", "FAQ"),
       ("/about", "About")]


def nav(here):
    rows = []
    for href, text in NAV:
        cls = ' class="here"' if href == here else ""
        rows.append(f'                <a href="{href}"{cls}>{text}</a>')
    return "\n".join(rows)


VIEWPORT_OLD = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
VIEWPORT_NEW = ('<meta name="viewport" '
                'content="width=device-width, initial-scale=1.0, viewport-fit=cover">')

# Cloudflare Web Analytics.
#
# Added to the hand-written pages by another session working on the
# monetisation question. It has to live here too, because build-dishes.py and
# build-symptoms.py regenerate their pages wholesale -- a rebuild silently
# stripped it from nine generated pages before this was added, and nothing
# about those pages looked wrong afterwards.
#
# NOTE: Cloudflare also injects this beacon at the edge for these zones, which
# is verified working. Carrying it in the HTML as well may mean two beacons on
# one page. Worth checking a live page after the next deploy and switching the
# zone setting to "Enable with JS Snippet installation" if it double-counts.
CF_BEACON = ('    <!-- Cloudflare Web Analytics -->\n'
             '    <script defer src="https://static.cloudflareinsights.com/beacon.min.js"'
             ' data-cf-beacon=\'{"token": "7357863b516646859f45fadbd7c656d4"}\'></script>\n')

MOBILE_JS = '    <script defer src="/js/mobile.js"></script>\n'

# Five tabs. Everything else lives one tap down, behind More.
#   Home        the site
#   Dishes      the buy-it-or-make-it pages — the only pages that earn
#   Calculate   the signature tool every CTA points at
#   Meds        the search-intent pillar (Ozempic, Wegovy, Mounjaro)
TABS = [
    ("/", "Home",
     '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'),
    ("/dishes", "Dishes",
     '<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z"/><path d="M6 20h12"/>'
     '<path d="M9.3 8.2c0-1.5 1.1-1.9 1.1-3.2M13.6 8.4c0-1.6 1.2-2 1.2-3.4"/>'),
    ("/protein-calculator", "Calculate",
     '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.3h7"/>'
     '<path d="M9 11.6h.01M12 11.6h.01M15 11.6h.01M9 15.6h.01M12 15.6h.01M15 15.6h.01"/>'),
    ("/medications", "Meds",
     '<rect x="1.9" y="8.9" width="20.2" height="6.2" rx="3.1" '
     'transform="rotate(-45 12 12)"/><path d="M12 7.6 16.4 12"/>'),
]
MORE_ICON = '<path d="M4 7.5h16M4 12h16M4 16.5h16"/>'


def tabbar(here: str) -> str:
    out = ['    <nav class="tabbar" aria-label="Sections">']
    for href, label, icon in TABS:
        on = ' class="on" aria-current="page"' if href == here else ""
        out.append(
            f'        <a href="{href}"{on}>'
            f'<svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>'
            f'<span class="lbl">{label}</span></a>')
    out.append(
        '        <button type="button" data-more aria-label="More pages">'
        f'<svg viewBox="0 0 24 24" aria-hidden="true">{MORE_ICON}</svg>'
        '<span class="lbl">More</span></button>')
    out.append('    </nav>')
    return "\n".join(out) + "\n"


# The footer carries every page. It is the no-JavaScript route to the
# pages behind the More tab, and on desktop it costs nothing.
FOOTER_LINKS = """            <p class="site-index">
                <a href="/">Home</a>
                <a href="/dishes">Dishes</a>
                <a href="/protein-calculator">Protein calculator</a>
                <a href="/protein-foods">Protein foods</a>
                <a href="/nutrition">Nutrition</a>
                <a href="/medications">Medications</a>
                <a href="/faq">FAQ</a>
            </p>
            <p style="margin-top:8px;">
                <a href="/about">About</a>
                <a href="/contact">Contact</a>
                <a href="/privacy">Privacy Policy</a>
                <a href="/terms">Terms of Service</a>
            </p>"""

FOOTER_OLD = re.compile(
    r'            <p style="margin-top:15px;">\s*'
    r'<a href="/about\.html">About</a>\s*'
    r'<a href="/contact\.html">Contact</a>\s*'
    r'<a href="/privacy\.html">Privacy Policy</a>\s*'
    r'<a href="/terms\.html">Terms of Service</a>\s*</p>')


def canonical_path(text: str, name: str) -> str:
    """Which tab should light up. Read off the canonical link so a dish
    page does not accidentally match a tab it merely links to."""
    m = re.search(r'<link rel="canonical" href="https://glp1-nav\.com(/[^"]*)?"', text)
    href = (m.group(1) or "/") if m else "/" + name
    if href in ("/", "/index.html"):
        return "/"
    # A single dish is a child of the Dishes tab, not a tab of its own.
    if href.startswith("/dish-"):
        return "/dishes"
    return href


def apply(text: str, name: str) -> str:
    # 1. viewport
    text = text.replace(VIEWPORT_OLD, VIEWPORT_NEW)

    # 2. mobile.js — last script in the head, after the page's own modules
    if "/js/mobile.js" not in text:
        text = text.replace("</head>", MOBILE_JS + "</head>", 1)

    # 2b. the analytics beacon, on every managed page
    if "cloudflareinsights" not in text:
        text = text.replace("</head>", CF_BEACON + "</head>", 1)

    # 3. tab bar
    bar = tabbar(canonical_path(text, name))
    text = re.sub(r'    <nav class="tabbar".*?</nav>\n', "", text, flags=re.S)
    text = text.replace("</body>", bar + "</body>", 1)

    # 4. footer index
    if 'class="site-index"' not in text:
        text = FOOTER_OLD.sub(FOOTER_LINKS, text)

    return text


def main() -> int:
    check = "--check" in sys.argv
    stale, changed = [], []

    for path in sorted(ROOT.glob("*.html")):
        if path.name in SKIP:
            continue
        before = path.read_text()
        if "/styles.css" not in before:
            continue
        after = apply(before, path.name)
        if after == before:
            continue
        if check:
            stale.append(path.name)
        else:
            path.write_text(after)
            changed.append(path.name)

    if check:
        if stale:
            print("STALE — run ops/apply-shell.py:", ", ".join(stale))
            return 1
        print("shell: all pages current")
        return 0

    print(f"shell applied to {len(changed)} page(s): {', '.join(changed) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
