#!/usr/bin/env python3
"""Find shelf-stable meals that have complete nutrition, then see if Amazon sells them.

This inverts ops/source-meals.py, and the reason is measured rather than
assumed. Starting from Amazon and looking the nutrition up afterwards gave
complete figures for roughly one product in seven: Amazon puts the nutrition
panel in an image, and USDA's Branded set does not carry most of these UPCs.

Starting from USDA instead, every candidate has protein, calories and sodium
by construction — a sample of 50 found 38 complete — and the barcode it
carries can be searched on Amazon to recover the listing. A product Amazon
does not stock simply drops out, which is a clean filter rather than a gap.

    python3 ops/discover-meals.py --min-protein 12 --out ops/data/discovered.json

Amazon is not touched here. This step is free and fast; run
ops/source-meals.py over the UPCs it produces to do the paced lookups.
"""

import argparse
import json
import os
import re
import subprocess
import sys

SEARCHES = [
    "ready to eat entree", "microwave meal bowl", "chili with beans",
    "protein bowl rice", "hearty soup chicken", "lentil dal ready to eat",
    "tuna pouch ready to eat", "chicken salad pouch", "protein oatmeal cup",
    "beef stew ready to eat", "pasta bowl ready to eat", "turkey chili",
]

# Things that match a meal search but are not a meal.
NOT_A_MEAL = re.compile(
    r"\b(sauce|dressing|seasoning|marinade|broth|stock|syrup|spice|"
    r"tomatoes|paste|powder|mix\b|supplement|vitamin|water|juice|soda|"
    r"candy|cookie|ice cream|creamer|butter|oil|vinegar|salsa|dip)\b", re.I)

NEED = ("Protein", "Energy", "Sodium, Na")
FIELDS = {"Protein": "protein", "Energy": "calories", "Sodium, Na": "sodium",
          "Carbohydrate, by difference": "carbs", "Total lipid (fat)": "fat",
          "Fiber, total dietary": "fiber"}


def search(key, term, page_size=200):
    payload = {"query": term, "dataType": ["Branded"], "pageSize": page_size}
    r = subprocess.run(
        ["curl", "-sS", "-X", "POST", "-H", "Content-Type: application/json",
         f"https://api.nal.usda.gov/fdc/v1/foods/search?api_key={key}",
         "-d", json.dumps(payload)],
        capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout or "{}").get("foods", [])
    except json.JSONDecodeError:
        return []


def usable(food, min_protein):
    """Complete nutrition, a gram serving size, and enough protein to matter."""
    size = food.get("servingSize")
    unit = (food.get("servingSizeUnit") or "").lower()
    if not size or unit not in ("g", "gram", "grams", "grm"):
        return None
    if not food.get("gtinUpc"):
        return None
    desc = food.get("description") or ""
    if NOT_A_MEAL.search(desc):
        return None

    by_name = {}
    for n in food.get("foodNutrients", []):
        name = n.get("nutrientName")
        if name == "Energy" and (n.get("unitName") or "").upper() != "KCAL":
            continue
        if name in FIELDS and n.get("value") is not None:
            by_name[name] = n["value"]
    if not all(k in by_name for k in NEED):
        return None

    f = size / 100.0
    per = {FIELDS[k]: round(v * f, 1) for k, v in by_name.items()}
    per["calories"] = int(round(per["calories"]))
    per["sodium"] = int(round(per["sodium"]))
    if per["protein"] < min_protein:
        return None

    return {
        "fdcId": food.get("fdcId"),
        "upc": food.get("gtinUpc"),
        "brand": food.get("brandOwner") or food.get("brandName"),
        "description": desc,
        "servingSize": size,
        "perServing": per,
        # The number that matters for this audience: protein per calorie.
        "proteinDensity": round(per["protein"] / per["calories"] * 100, 1)
        if per["calories"] else None,
        "sodiumPer10gProtein": int(per["sodium"] / per["protein"] * 10),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-protein", type=float, default=12)
    ap.add_argument("--max-sodium", type=int, default=0,
                    help="drop anything above this mg per serving (0 = keep all)")
    ap.add_argument("--out")
    args = ap.parse_args()

    key = os.environ.get("USDA_API_KEY")
    if not key:
        sys.exit("USDA_API_KEY not set.")

    found, seen = [], set()
    for term in SEARCHES:
        for food in search(key, term):
            rec = usable(food, args.min_protein)
            if not rec or rec["upc"] in seen:
                continue
            if args.max_sodium and rec["perServing"]["sodium"] > args.max_sodium:
                continue
            seen.add(rec["upc"])
            rec["foundBy"] = term
            found.append(rec)
        print(f"  {term:<28} running total {len(found)}", flush=True)

    found.sort(key=lambda r: -r["perServing"]["protein"])
    print(f"\n{len(found)} candidates with protein + calories + sodium\n")
    for r in found[:30]:
        p = r["perServing"]
        print(f"  {p['protein']:>5}g  {p['calories']:>4}kcal  {p['sodium']:>5}mg  "
              f"{str(r['brand'])[:22]:<22} {r['description'][:44]}")

    if args.out:
        json.dump(found, open(args.out, "w"), indent=2)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
