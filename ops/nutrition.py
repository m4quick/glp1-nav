#!/usr/bin/env python3
"""Compute a meal's nutrition from USDA composition data instead of typing it.

The four original dishes carry figures I worked out by hand, and a dietitian
then had to check the arithmetic. That is a poor use of her: the interesting
question is whether a meal is sensible for someone whose appetite has
collapsed, not whether 20 plus 4 plus 2 is 26.

So an ingredient names a USDA FoodData Central id and a weight in grams, and
the totals are derived. The id is pinned in ops/data/ingredients.json rather
than looked up by name at build time, because a search that silently returns a
different food next month would change a published number with nobody noticing.

    python3 ops/nutrition.py --find "chickpeas canned"   pin a new ingredient
    python3 ops/nutrition.py --show tuna-pouch           what one gram gives
    python3 ops/nutrition.py --meal '<json>'             totals for a meal
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PINS = os.path.join(ROOT, "ops", "data", "ingredients.json")

# USDA nutrient name -> our field. Everything USDA gives is per 100 g.
WANT = {
    "Protein": "protein",
    "Energy": "calories",
    "Carbohydrate, by difference": "carbs",
    "Total lipid (fat)": "fat",
    "Fiber, total dietary": "fiber",
    "Sodium, Na": "sodium",
}

# Foundation and SR Legacy are laboratory-analysed whole foods. Branded is
# manufacturer-submitted and far patchier; it is a fallback, not a default.
PREFERRED = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"]


def key():
    k = os.environ.get("USDA_API_KEY")
    if not k:
        sys.exit("USDA_API_KEY not set. Pipe it from OpenBao; do not paste it.")
    return k


def get(url):
    r = subprocess.run(["curl", "-sS", url], capture_output=True, text=True, timeout=60)
    try:
        return json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        return {}


def per100(food):
    out = {}
    for n in food.get("foodNutrients", []):
        name = n.get("nutrientName") or (n.get("nutrient") or {}).get("name")
        unit = (n.get("unitName") or (n.get("nutrient") or {}).get("unitName") or "").upper()
        val = n.get("value") if n.get("value") is not None else n.get("amount")
        if name == "Energy" and unit != "KCAL":
            continue
        if name in WANT and val is not None:
            out[WANT[name]] = val
    return out


def search(term):
    """Candidates, best dataset first, so a pin is a deliberate choice."""
    q = urllib.parse.urlencode({
        "api_key": key(), "query": term, "pageSize": 25,
        "dataType": ",".join(PREFERRED)})
    foods = get(f"https://api.nal.usda.gov/fdc/v1/foods/search?{q}").get("foods", [])
    foods.sort(key=lambda f: PREFERRED.index(f.get("dataType"))
               if f.get("dataType") in PREFERRED else 99)
    return foods


def fetch(fdc_id):
    q = urllib.parse.urlencode({"api_key": key()})
    return get(f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}?{q}")


def pins():
    return json.load(open(PINS)) if os.path.exists(PINS) else {}


def save_pins(p):
    os.makedirs(os.path.dirname(PINS), exist_ok=True)
    json.dump(p, open(PINS, "w"), indent=2, sort_keys=True)


def totals(ingredients):
    """Sum an ingredient list. Every ingredient must be pinned; an unpinned one
    is an error rather than a silent zero, because a zero would understate a
    meal's protein and nobody would notice."""
    p = pins()
    out = {f: 0.0 for f in WANT.values()}
    missing = []
    for ing in ingredients:
        pin = p.get(ing["ref"])
        if not pin:
            missing.append(ing["ref"])
            continue
        factor = ing["grams"] / 100.0
        for field, v in pin["per100g"].items():
            out[field] += v * factor
    if missing:
        raise SystemExit("unpinned ingredients: " + ", ".join(missing))
    return {k: round(v, 1) for k, v in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--find")
    ap.add_argument("--pin", nargs=2, metavar=("REF", "FDCID"))
    ap.add_argument("--show")
    ap.add_argument("--meal")
    args = ap.parse_args()

    if args.find:
        for f in search(args.find)[:12]:
            n = per100(f)
            print(f"  {f.get('fdcId'):>8}  {f.get('dataType','?'):<16} "
                  f"P{n.get('protein','-'):>6} kcal{n.get('calories','-'):>6} "
                  f"fib{n.get('fiber','-'):>5}  {f.get('description','')[:56]}")
        return 0

    if args.pin:
        ref, fdc = args.pin
        food = fetch(fdc)
        if not food.get("description"):
            sys.exit(f"fdcId {fdc} did not resolve")
        n = per100(food)
        if "protein" not in n:
            sys.exit(f"{fdc} carries no protein value")
        p = pins()
        p[ref] = {"fdcId": int(fdc), "description": food["description"],
                  "dataType": food.get("dataType"), "per100g": n}
        save_pins(p)
        print(f"pinned {ref} -> {fdc}  {food['description'][:56]}")
        print(f"  per 100 g: " + "  ".join(f"{k} {v}" for k, v in sorted(n.items())))
        return 0

    if args.show:
        p = pins().get(args.show)
        if not p:
            sys.exit(f"{args.show} is not pinned")
        print(json.dumps(p, indent=2))
        return 0

    if args.meal:
        print(json.dumps(totals(json.loads(args.meal)), indent=2))
        return 0

    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
