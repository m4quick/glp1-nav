#!/usr/bin/env python3
"""Verify a prepared-meal ASIN and pull its nutrition from a citable source.

Two independent sources, deliberately:

  Amazon  is authoritative for the product's identity — that the ASIN exists,
          resolves to the product we think it does, is in stock, and what its
          UPC is. It is NOT a usable source for nutrition: the panel is an
          image, and the only figure in text is a marketing claim in the title.

  USDA FoodData Central is authoritative for nutrition. Its Branded Foods set
          is manufacturer-submitted label data, keyed by GTIN/UPC, in text.

The check that matters is that they agree. USDA reports per 100 g, so scaling
by the stated serving size should reproduce the protein figure the packet
advertises. Where it does not, something is wrong — most often a title
quoting protein per pack rather than per serving — and the product is flagged
rather than quietly recorded with whichever number was easier to get.

Nothing here invents a figure. A nutrient USDA does not carry comes out null.

    python3 ops/source-meals.py B0055UBGX0 B07N8DC6DT ...
    python3 ops/source-meals.py --file candidates.txt --out sourced.json
"""

import argparse
import html as _html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

def html_unescape(s):
    return _html.unescape(s)


UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")

# USDA nutrient names -> our field names. Everything is per 100 g.
WANT = {
    "Protein": "protein",
    "Energy": "calories",
    "Carbohydrate, by difference": "carbs",
    "Total lipid (fat)": "fat",
    "Fiber, total dietary": "fiber",
    "Sodium, Na": "sodium",
}


# Amazon throttles a burst of requests by returning a stripped page — around
# 400 KB with no productTitle rather than an error or a captcha. A first run
# at full speed reported 22 of 43 products as having no UPC; with a pause
# between requests the same pages came back complete. Silent degradation, so
# the check has to be on the content, not the status code.
PACE = float(os.environ.get("SOURCE_PACE", "8"))
_last = [0.0]


def fetch(url, tries=3, amazon=False):
    for i in range(tries):
        if amazon:
            wait = PACE - (time.time() - _last[0])
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
        r = subprocess.run(
            ["curl", "-sS", "-A", UA, "-H", "Accept-Language: en-US,en;q=0.9", url],
            capture_output=True, text=True, timeout=90)
        ok = r.returncode == 0 and len(r.stdout) > 2000
        if ok and amazon and 'id="productTitle"' not in r.stdout:
            ok = False          # stripped page: throttled, not a dead ASIN
        if ok:
            return r.stdout
        time.sleep(PACE * (i + 2))
    return ""


def amazon(asin):
    """Identity only. Returns None if the ASIN does not resolve to a product."""
    html = fetch(f"https://www.amazon.com/dp/{asin}", amazon=True)
    if not html:
        return None
    if re.search(r"captcha|Robot Check|automated access", html[:4000], re.I):
        return {"asin": asin, "error": "blocked"}

    t = re.search(r'id="productTitle"[^>]*>\s*(.*?)\s*<', html, re.S)
    if not t:
        return {"asin": asin, "error": "throttled or dead after retries"}
    title = html_unescape(re.sub(r"\s+", " ", t.group(1)).strip())

    upc = re.search(r"UPC.{0,200}?(\d{12,14})", html, re.S)
    brand = re.search(r'id="bylineInfo"[^>]*>\s*(?:Brand:\s*)?(.*?)\s*<', html, re.S)
    claim = re.search(r"(\d{1,3})\s*g\s*(?:of\s*)?protein", title, re.I)
    # Scoped to the availability block. Searching the whole page for
    # "Currently unavailable" matched a recommendations carousel and reported
    # every product, including in-stock ones, as dead.
    av = re.search(r'id="availability".*?<span[^>]*>\s*([^<]{3,60}?)\s*<', html, re.S)
    availability = re.sub(r"\s+", " ", av.group(1)).strip() if av else None
    unavailable = bool(availability and re.search(
        r"unavailable|out of stock|not available", availability, re.I))

    return {
        "asin": asin,
        "title": title,
        "upc": upc.group(1) if upc else None,
        "brand": re.sub(r"\s+", " ", brand.group(1)).strip() if brand else None,
        "claimedProtein": int(claim.group(1)) if claim else None,
        "availability": availability,
        "unavailable": unavailable,
    }


def usda(upc, key):
    """Nutrition per serving, scaled from USDA's per-100 g figures."""
    if not upc:
        return None
    url = ("https://api.nal.usda.gov/fdc/v1/foods/search?"
           + urllib.parse.urlencode({"api_key": key, "query": upc,
                                     "dataType": "Branded", "pageSize": 5}))
    try:
        data = json.loads(fetch(url) or "{}")
    except json.JSONDecodeError:
        return None

    food = next((f for f in data.get("foods", []) if f.get("gtinUpc", "").lstrip("0")
                 == upc.lstrip("0")), None)
    if not food:
        return None

    size, unit = food.get("servingSize"), (food.get("servingSizeUnit") or "").lower()
    # Scaling only makes sense from a mass; a serving given in ml or "1 cup"
    # cannot be converted without a density we do not have.
    factor = size / 100.0 if size and unit in ("g", "gram", "grams") else None

    per100, per_serving = {}, {}
    for n in food.get("foodNutrients", []):
        field = WANT.get(n.get("nutrientName"))
        if not field or n.get("value") is None:
            continue
        if field == "calories" and (n.get("unitName") or "").upper() != "KCAL":
            continue
        per100[field] = n["value"]
        if factor:
            per_serving[field] = round(n["value"] * factor,
                                       0 if field in ("calories", "sodium") else 1)

    return {
        "fdcId": food.get("fdcId"),
        "description": food.get("description"),
        "brandOwner": food.get("brandOwner"),
        "servingSize": size, "servingSizeUnit": unit,
        "per100g": per100,
        "perServing": {k: (int(v) if k in ("calories", "sodium") else v)
                       for k, v in per_serving.items()} or None,
    }


def reconcile(a, n):
    """Do the packet and the label agree on protein?"""
    if not (a and n and n.get("perServing") and a.get("claimedProtein")):
        return None
    got = n["perServing"].get("protein")
    if got is None:
        return None
    claim = a["claimedProtein"]
    # A whole gram of slack for rounding on the packet, plus 5% for a serving
    # size that is itself rounded.
    ok = abs(got - claim) <= max(1.0, claim * 0.05)
    return {"claimed": claim, "fromLabel": got, "agree": ok}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("asins", nargs="*")
    ap.add_argument("--file")
    ap.add_argument("--out")
    args = ap.parse_args()

    key = os.environ.get("USDA_API_KEY")
    if not key:
        sys.exit("USDA_API_KEY not set. Pipe it from OpenBao; do not paste it.")

    asins = list(args.asins)
    if args.file:
        asins += [l.split("#")[0].strip() for l in open(args.file)
                  if l.split("#")[0].strip()]
    seen, ordered = set(), []
    for a in asins:
        if a not in seen:
            seen.add(a); ordered.append(a)

    out = []
    for i, asin in enumerate(ordered, 1):
        a = amazon(asin)
        n = usda(a.get("upc") if a else None, key) if a and not a.get("error") else None
        rec = {"amazon": a, "usda": n, "protein_check": reconcile(a, n)}
        out.append(rec)

        chk = rec["protein_check"]
        if not a or a.get("error"):
            flag = "DEAD" if not a else a["error"].upper()
        elif a.get("unavailable"):
            flag = f"UNAVAILABLE ({a.get('availability')})"
        elif not a.get("upc"):
            flag = "no upc"
        elif not n:
            flag = "not in USDA"
        elif not n.get("perServing"):
            flag = f"serving in {n.get('servingSizeUnit') or '?'} — cannot scale"
        elif chk and not chk["agree"]:
            flag = f"MISMATCH claim {chk['claimed']}g vs label {chk['fromLabel']}g"
        else:
            p = n["perServing"]
            flag = (f"ok  {p.get('protein')}g protein  {p.get('calories')}kcal  "
                    f"{p.get('sodium')}mg sodium")
        title = (a or {}).get("title", "")[:52]
        print(f"[{i:>2}/{len(ordered)}] {asin}  {flag:<44} {title}", flush=True)

    if args.out:
        json.dump(out, open(args.out, "w"), indent=2)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
