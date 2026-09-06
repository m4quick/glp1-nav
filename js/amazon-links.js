/* Where every buyable thing on this site points, and how it is shown.
 *
 * One map, shared by the calculator and the dish pages. Duplicating it would
 * recreate the failure this file exists to prevent: three ASINs were once
 * invented, shipped, and returned 404 to every visitor who clicked them.
 *
 * Two kinds of entry, and the difference is deliberate:
 *   asin  a specific product, because the recommendation IS that product.
 *         Every ASIN here was fetched from Amazon and its title read back.
 *   q     a search, for whole foods. There is no canonical chicken breast,
 *         availability is regional, and a search cannot 404 when a product
 *         is delisted.
 * Items with neither are honest omissions: nobody needs an affiliate link
 * for a lemon.
 *
 * Loads as a browser global (AmazonLinks) or a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmazonLinks = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAG = 'm4quickquail-20';

  var MAP = {
    /* --- packaged goods: verified ASINs ------------------------------- */
    'Whey Protein Powder':      { asin: 'B000QSNYGI' },
    'Whey Protein Shake':       { asin: 'B000QSNYGI' },
    'Quest Protein Bars':       { asin: 'B00DLDH1N2' },
    'Quest Protein Bar':        { asin: 'B00DLDH1N2' },
    'Fairlife Core Power':      { asin: 'B01DDIRDZA' },
    'Premier Protein Shakes':   { asin: 'B008JGIZGS' },
    'Premier Protein Shake':    { asin: 'B008JGIZGS' },

    /* --- whole foods: searches, with a photograph --------------------- */
    'Greek Yogurt':             { q: 'greek yogurt plain nonfat high protein', img: 'greek-yogurt' },
    'Greek Yogurt (plain)':     { q: 'greek yogurt plain nonfat high protein', img: 'greek-yogurt' },
    'Cottage Cheese':           { q: 'cottage cheese low fat', img: 'cottage-cheese' },
    'Egg Whites':               { q: 'liquid egg whites carton', img: 'egg-whites' },
    'Whole Eggs':               { q: 'eggs grade a large', img: 'whole-eggs' },
    'Chicken Breast':           { q: 'boneless skinless chicken breast', img: 'chicken-breast' },
    'Salmon':                   { q: 'salmon fillet', img: 'salmon' },
    'Tuna (canned)':            { q: 'canned tuna in water', img: 'tuna-canned' },
    'Ground Turkey (93% lean)': { q: 'ground turkey 93 percent lean', img: 'ground-turkey' },
    'Firm Tofu':                { q: 'firm tofu', img: 'firm-tofu' },
    'Tempeh':                   { q: 'tempeh', img: 'tempeh' },
    'Lentils (cooked)':         { q: 'dried lentils', img: 'lentils' },
    'Chickpeas (cooked)':       { q: 'canned chickpeas garbanzo beans', img: 'chickpeas' },

    /* --- store-cupboard things the dishes call for -------------------- */
    'Lentils':                  { q: 'dried lentils', img: 'lentils' },
    'Chickpeas':                { q: 'canned chickpeas garbanzo beans', img: 'chickpeas' },
    'Rolled oats':              { q: 'rolled oats old fashioned' },
    'Almonds':                  { q: 'raw almonds unsalted' },
    'Chia seeds':               { q: 'chia seeds' },
    'Frozen berries':           { q: 'frozen mixed berries' },
    'Olive oil':                { q: 'extra virgin olive oil' },
    'Peanut butter':            { q: 'natural peanut butter no sugar added' },
    'Baby spinach':             { q: 'fresh baby spinach' },

    /* --- added for the cold, no-cook meals ---------------------------- */
    'White beans (tinned)':     { q: 'canned cannellini white beans' },
    'Edamame':                  { q: 'frozen shelled edamame' },
    'Cooked prawns':            { q: 'cooked peeled prawns shrimp' },
    'Smoked salmon':            { q: 'smoked salmon slices' },
    'Boiled eggs':              { q: 'eggs grade a large', img: 'whole-eggs' },
    'Tuna pouch':               { q: 'tuna pouch in water', img: 'tuna-canned' }
  };

  /* The ready-made shelf, in the order the calculator shows it.
   *
   * This list used to live inside protein-calculator.html as a second array
   * with its own copy of the four ASINs — the exact duplication this file was
   * created to end. Three invented ASINs once shipped and 404'd; a second
   * copy is how a fourth would.
   *
   * `brand` is the name a shopper recognises. `shape` picks the product
   * silhouette drawn on the tile. `logo` is a filename under /images/brands/,
   * left null until real brand assets are in hand — a manufacturer's logo is
   * their trademark, not ours to invent or scrape, and mark() falls back to
   * the silhouette for as long as it is missing.
   */
  var PRODUCTS = [
    { key: 'Premier Protein Shake', brand: 'Premier Protein', kind: 'Shake',
      serving: '11.5 oz bottle', g: 30, shape: 'bottle', logo: null },
    { key: 'Fairlife Core Power',   brand: 'Fairlife Core Power', kind: 'Shake',
      serving: '14 oz bottle', g: 26, shape: 'bottle', logo: null },
    { key: 'Whey Protein Powder',   brand: 'Optimum Nutrition', kind: 'Gold Standard whey',
      serving: '1 scoop', g: 25, shape: 'tub', logo: null },
    { key: 'Quest Protein Bar',     brand: 'Quest', kind: 'Protein bar',
      serving: '1 bar', g: 20, shape: 'bar', logo: null }
  ];

  /* Product silhouettes. Deliberately generic: a bottle is a bottle, and
     drawing one is not a claim about whose bottle it is. */
  var SHAPES = {
    bottle: '<path d="M10 2.6h4v2.1c0 .8.2 1.2.7 1.8l.6.7c.4.5.6 1 .6 1.7v10.3a2.4 2.4 0 0 1-2.4 2.4h-3a2.4 2.4 0 0 1-2.4-2.4V8.9c0-.7.2-1.2.6-1.7l.6-.7c.5-.6.7-1 .7-1.8z"/><path d="M8.7 12.6h6.6"/>',
    tub:    '<path d="M5.6 7.6h12.8v10.9a2.2 2.2 0 0 1-2.2 2.2H7.8a2.2 2.2 0 0 1-2.2-2.2z"/><rect x="4.4" y="3.5" width="15.2" height="4.1" rx="1.2"/>',
    bar:    '<rect x="2.9" y="8.7" width="18.2" height="6.6" rx="2"/><path d="M8.4 8.7v6.6M13.6 8.7v6.6"/>'
  };

  /* The brand mark for a shelf product: a real logo once one is supplied,
     otherwise the silhouette. Same box either way, so the row never jumps. */
  function mark(product) {
    if (product.logo) {
      return '<span class="pp-mark"><img src="/images/brands/' + product.logo
           + '" alt="' + product.brand + '" loading="lazy" width="96" height="96"></span>';
    }
    return '<span class="pp-mark" data-shape="' + product.shape + '">'
         + '<svg viewBox="0 0 24 24" aria-hidden="true">' + (SHAPES[product.shape] || '') + '</svg>'
         + '</span>';
  }

  var LC = {};
  Object.keys(MAP).forEach(function (k) { LC[k.toLowerCase()] = MAP[k]; });

  function entry(name) {
    return MAP[name] || LC[String(name || '').toLowerCase()] || null;
  }

  function url(name) {
    var e = entry(name);
    if (!e) return null;
    return e.asin
      ? 'https://www.amazon.com/dp/' + e.asin + '?tag=' + TAG
      : (e.q ? 'https://www.amazon.com/s?k=' + encodeURIComponent(e.q) + '&tag=' + TAG : null);
  }

  function anchor(name, style, label) {
    var u = url(name);
    if (!u) return '';
    return '<a href="' + u + '" target="_blank" rel="sponsored nofollow noopener"'
         + (style ? ' style="' + style + '"' : '') + '>' + (label || 'Buy on Amazon →') + '</a>';
  }

  function photo(name, cls) {
    var e = entry(name);
    if (!e || !e.img) return '';
    return '<img class="' + (cls || 'food-photo') + '" src="/images/foods/' + e.img
         + '.webp" alt="" loading="lazy" width="400" height="400">';
  }

  /* Branded goods carry no photograph — Amazon removed image links from
     SiteStripe, and inventing a picture of a real product would misrepresent
     something a visitor is about to buy. A tile keeps the grid deliberate. */
  function tile(name, grams) {
    var e = entry(name);
    if (!e || e.img) return '';
    var g = parseInt(grams, 10);
    if (!g) return '';
    return '<span class="food-tile"><b>' + g + '</b><i>g protein</i></span>';
  }

  /* Several ASINs go into one Amazon basket. Searches cannot: there is no
     ASIN for "chicken breast" to put in a cart. */
  function cartUrl(names) {
    var asins = (names || []).map(function (n) {
      var e = entry(n); return e && e.asin;
    }).filter(Boolean);
    if (!asins.length) return null;
    var u = 'https://www.amazon.com/gp/aws/cart/add.html?AssociateTag=' + TAG;
    asins.forEach(function (a, i) { u += '&ASIN.' + (i + 1) + '=' + a + '&Quantity.' + (i + 1) + '=1'; });
    return u;
  }

  function hasAsin(name) { var e = entry(name); return !!(e && e.asin); }
  function isLinked(name) { return !!url(name); }

  return { TAG: TAG, MAP: MAP, PRODUCTS: PRODUCTS, SHAPES: SHAPES,
           entry: entry, url: url, anchor: anchor, mark: mark,
           photo: photo, tile: tile, cartUrl: cartUrl,
           hasAsin: hasAsin, isLinked: isLinked };
}));
