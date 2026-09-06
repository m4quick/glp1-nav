/* Selecting meals by what somebody cannot face today.
 *
 * The tag axes in dishes.json were built for a meal planner. They turn out to
 * be exactly what a symptom page needs: "meat tastes metallic" is
 * protein-source exclusion, "cooking smells turn my stomach" is an aroma
 * ceiling, "I cannot cook today" is an effort filter.
 *
 * One implementation, used three ways: ops/build-symptoms.py shells into it to
 * generate pages, the tests exercise it directly, and a future "what can you
 * not face today" picker can run it in the browser unchanged. A second copy in
 * Python would drift from this one within a week.
 *
 * Pure: no DOM, no I/O. Loads as a browser global (MealFilter) or a Node
 * module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MealFilter = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROUTES = ['delivered', 'prepared', 'made'];
  var AROMA_RANK = { none: 0, low: 1, strong: 2 };

  function routesOf(m) { return ROUTES.filter(function (r) { return m[r]; }); }

  /* A meal is only offered if something on it has been reviewed. The symptom
     pages inherit the dish pages' gate rather than inventing a softer one. */
  function isLive(m) {
    return routesOf(m).some(function (r) { return m[r].reviewed; });
  }

  /* Best figure across the routes that actually state one. A meal whose only
     route is a substitutes list carries no protein total by design, so it
     cannot satisfy a protein floor and should not pretend to. */
  function best(m, field) {
    var vals = routesOf(m)
      .map(function (r) { return m[r][field]; })
      .filter(function (v) { return typeof v === 'number' && v > 0; });
    return vals.length ? Math.max.apply(null, vals) : null;
  }

  function lowest(m, field) {
    var vals = routesOf(m)
      .map(function (r) { return m[r][field]; })
      .filter(function (v) { return typeof v === 'number' && v > 0; });
    return vals.length ? Math.min.apply(null, vals) : null;
  }

  function asList(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

  /* Every rule returns a reason when it rejects, so a page that comes up short
     can say which rule emptied it rather than silently rendering nothing. */
  var RULES = {
    protein: function (tags, spec) {
      var have = asList(tags.protein);
      var ex = asList(spec.exclude);
      var hit = have.filter(function (p) { return ex.indexOf(p) >= 0; });
      if (hit.length) return 'contains ' + hit.join(', ');
      var inc = asList(spec.include);
      if (inc.length && !have.some(function (p) { return inc.indexOf(p) >= 0; })) {
        return 'no ' + inc.join(' or ');
      }
      return null;
    },
    aroma: function (tags, spec) {
      if (spec.max == null) return null;
      var r = AROMA_RANK[tags.aroma];
      if (r == null) return 'aroma not tagged';
      return r <= AROMA_RANK[spec.max] ? null : 'smells ' + tags.aroma;
    },
    temperature: function (tags, spec) {
      var want = asList(spec.is);
      if (!want.length) return null;
      // "either" satisfies a request for hot or for cold.
      if (tags.temperature === 'either') return null;
      return want.indexOf(tags.temperature) >= 0 ? null : 'served ' + tags.temperature;
    },
    effort: function (tags, spec) {
      var want = asList(spec.includes);
      if (!want.length) return null;
      var have = asList(tags.effort);
      return want.some(function (e) { return have.indexOf(e) >= 0; })
        ? null : 'needs ' + have.join('/');
    },
    diet: function (tags, spec) {
      var need = asList(spec.includes);
      var have = asList(tags.diet);
      var missing = need.filter(function (d) { return have.indexOf(d) < 0; });
      return missing.length ? 'not ' + missing.join(', ') : null;
    },
    texture: function (tags, spec) {
      var want = asList(spec.includes);
      if (!want.length) return null;
      var have = asList(tags.texture);
      return want.some(function (t) { return have.indexOf(t) >= 0; })
        ? null : 'texture is ' + have.join('/');
    }
  };

  function reject(meal, filter) {
    var tags = meal.tags || {};
    for (var axis in RULES) {
      if (!Object.prototype.hasOwnProperty.call(filter, axis)) continue;
      var why = RULES[axis](tags, filter[axis]);
      if (why) return why;
    }
    if (filter.minProtein != null) {
      var p = best(meal, 'protein');
      if (p == null) return 'no protein figure';
      if (p < filter.minProtein) return p + ' g protein';
    }
    if (filter.minFiber != null) {
      var f = best(meal, 'fiber');
      if (f == null) return 'fibre not known';
      if (f < filter.minFiber) return f + ' g fibre';
    }
    if (filter.maxSodium != null) {
      var s = lowest(meal, 'sodium');
      if (s == null) return 'sodium not known';
      if (s > filter.maxSodium) return s + ' mg sodium';
    }
    if (filter.maxCalories != null) {
      var c = lowest(meal, 'calories');
      if (c == null) return 'calories not known';
      if (c > filter.maxCalories) return c + ' kcal';
    }
    return null;
  }

  /* Returns both halves. The rejected list is not decoration: it is what tells
     an author which meal to write next to make a thin page publishable. */
  function select(meals, filter, opts) {
    opts = opts || {};
    var matched = [], rejected = [];
    (meals || []).forEach(function (m) {
      if (!opts.includeDrafts && !isLive(m)) {
        rejected.push({ slug: m.slug, why: 'not reviewed' });
        return;
      }
      var why = reject(m, filter || {});
      if (why) rejected.push({ slug: m.slug, why: why });
      else matched.push(m);
    });
    matched.sort(function (a, b) {
      return (best(b, 'protein') || 0) - (best(a, 'protein') || 0);
    });
    return { matched: matched, rejected: rejected };
  }

  return { select: select, reject: reject, isLive: isLive, routesOf: routesOf,
           best: best, lowest: lowest, AROMA_RANK: AROMA_RANK };
}));
