#!/usr/bin/env python3
"""Generate a dish photograph locally and put it where the site expects it.

FLUX.1-schnell running on this machine, via the com.nabu.flux sidecar. Apache
2.0, so the output is ours to use commercially -- which matters, because
Amazon removed image links from SiteStripe and scraping product photographs is
not an option.

Photographs of food, never of a branded product. A generated picture of a real
packet would misrepresent something somebody is about to buy.

    python3 ops/make-dish-image.py <slug> "<prompt>"
"""
import json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images", "dishes")
STYLE = ("overhead food photograph, natural window light, plain ceramic plate, "
         "matte linen background, shallow depth of field, appetising, no text, "
         "no packaging, no branding")


def generate(slug, subject):
    body = json.dumps({"prompt": f"{subject}, {STYLE}",
                       "width": 640, "height": 480, "steps": 4}).encode()
    req = urllib.request.Request("http://127.0.0.1:8802/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        res = json.loads(r.read())
    if not res.get("ok"):
        raise SystemExit(f"generation failed: {res}")

    src = res["path"]
    if not os.path.exists(src):
        src = src + ".png"
    dst = os.path.join(OUT, f"{slug}.webp")
    os.makedirs(OUT, exist_ok=True)
    # 520x390 is what the <img> declares; matching it avoids shipping pixels
    # nobody sees, and q=72 lands the existing dishes at 20-25 KB.
    subprocess.run(["magick", src, "-resize", "520x390^", "-gravity", "center",
                    "-extent", "520x390", "-quality", "72", dst], check=True)
    return dst, res["seconds"], res["seed"]


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    p, secs, seed = generate(sys.argv[1], sys.argv[2])
    print(f"  {os.path.basename(p):<34} {os.path.getsize(p)/1024:>5.1f} KB  "
          f"{secs:.1f}s  seed {seed}")
