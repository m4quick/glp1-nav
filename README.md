# glp1-nav.com

Static site on Cloudflare Pages. No build step for the pages themselves —
what is in the repository is what ships, apart from the generated meal pages.

Push to Gitea, which is meant to sync to GitHub, which deploys. **The Gitea
sync workflow has failed on every run since 11 July 2026**, so pushes have to
go to GitHub directly until it is fixed:

```sh
git push origin main    # Gitea
git push github main    # GitHub — this is the one that deploys
```

## Tests

```sh
node --test tests/protein-math.test.js tests/dishes.test.js \
            tests/shell.test.js tests/site.test.js
```

Four suites, all reading files off disk, all run by CI before deploy:

| Suite | Guards |
|---|---|
| `protein-math` | The arithmetic. Golden values with hand-worked comments. |
| `dishes` | The meal model, the link map, the product shelf. |
| `shell` | The mobile app shell — every page reachable from a phone. |
| `site` | Links, assets, affiliate hygiene, canonicals, markup. |

### The smoke test is separate, and deliberately so

```sh
SMOKE_BASE_URL=https://glp1-nav.com node --test tests/smoke.test.js
```

It skips entirely without that variable, so a plain `node --test` never
touches the network. CI runs it **after** deploy.

It exists because the four suites above are structurally blind to anything
that happens between the repository and the browser. `site.test.js` asserts
contact.html carries a `mailto:` on a domain we own, and passes — while the
live page served `[email protected]`, because Cloudflare's Email Address
Obfuscation had rewritten it at the edge.

So the smoke test only checks things a file test cannot: what the CDN serves,
what survives the edge, whether a missing page really 404s.

## Generated pages

`dishes.json` is the source of truth. Meal pages, the index and the sitemap
are generated from it:

```sh
python3 ops/build-dishes.py            # write
python3 ops/build-dishes.py --check    # fail if stale (CI runs this)
```

The mobile shell — tab bar, `viewport-fit`, footer index — is applied by a
second script that both hand-written and generated pages pass through, so
there is one definition of the navigation:

```sh
python3 ops/apply-shell.py
python3 ops/apply-shell.py --check
```

Run `build-dishes.py` first; it calls into `apply-shell.py` itself, so the two
agree.

## Adding a meal

A meal is one idea obtainable up to three ways — `delivered`, `prepared`,
`made` — and each route is nullable and reviewed separately. Add an entry to
`dishes.json` with at least one route, a `slot`, and `tags` drawn from
`_vocabulary`, then rebuild.

Two rules the tests enforce, both learned the hard way:

- **Never invent an ASIN.** Every one in `js/amazon-links.js` was fetched and
  its product title read back. Three invented ones once shipped and returned
  404 to every click.
- **Unknown is `null`, never `0`.** A zero renders as a fact. If a calorie or
  sodium figure is not on a label or in a sourced composition table, leave it
  null and it renders as nothing.

## The review gate

`reviewed` on a route holds a date the dietitian actually gave, or `null`.
A meal publishes as soon as any one route is reviewed; the banner names what
is still a draft. Nothing with no reviewed route enters `sitemap.xml`.

Do not set a review date to make a page go live.

## Switching on a delivery partner

`js/partners.js` ships empty — no affiliate programme has approved this site.
Applications are with Factor (CJ Affiliate) and Trifecta (Impact).

To switch one on, fill in its entry with the tracking link the network issues
and set `approved` to the date they confirmed. Until then `dish.js` removes
the delivered pane and its tab outright, so an unapproved link never renders.

## Local preview

```sh
python3 ops/devserve.py 8123
```

Plain `http.server` with caching off — a CSS edit shows on the next reload
instead of two reloads later.
