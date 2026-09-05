/* The shopping list that follows the visitor around the site.
 *
 * Shared by the calculator and every dish page. Clicking a product used to
 * eject people to Amazon and lose everything else they were considering;
 * now they collect a list and make one trip.
 *
 * Depends on AmazonLinks (js/amazon-links.js), loaded first.
 * Exposes ShoppingList.{add, remove, toggle, has, items, render, mount}.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.AmazonLinks);
  else root.ShoppingList = factory(root.AmazonLinks);
}(typeof self !== 'undefined' ? self : this, function (A) {
  'use strict';

  var KEY = 'glp1nav.list.v1';
  var items = [];
  var expanded = false;
  var SHOW = 5;

  try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { items = []; }
  if (!Array.isArray(items)) items = [];

  function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {} }
  function has(name) { return items.some(function (i) { return i.name === name; }); }
  function indexOf(name) { return items.findIndex(function (i) { return i.name === name; }); }

  function add(name, grams) {
    if (!A.isLinked(name) || has(name)) return false;
    items.push({ name: name, g: Number(grams) || 0 });
    save(); render(); return true;
  }
  function remove(name) {
    var i = indexOf(name);
    if (i < 0) return false;
    items.splice(i, 1); save(); render(); return true;
  }
  function toggle(name, grams) { return has(name) ? (remove(name), false) : (add(name, grams), true); }
  function clear() { items = []; save(); render(); }

  function total() { return items.reduce(function (a, i) { return a + i.g; }, 0); }
  function withAsin() { return items.filter(function (i) { return A.hasAsin(i.name); }); }
  function searchOnly() { return items.filter(function (i) { return !A.hasAsin(i.name); }); }

  function tray() {
    var t = document.getElementById('shop-tray');
    if (!t) {
      t = document.createElement('div');
      t.id = 'shop-tray'; t.className = 'tray';
      document.body.appendChild(t);
    }
    return t;
  }

  function render() {
    var t = tray();
    if (!items.length) {
      t.hidden = true;
      document.body.classList.remove('has-tray');
      document.body.style.paddingBottom = '';
      syncButtons();
      return;
    }
    t.hidden = false;
    document.body.classList.add('has-tray');

    var sum = total();
    // Guarded so the module can be exercised headlessly in a test.
    var target = (typeof window !== 'undefined' && window.__proteinTarget) || 0;
    var goal = target
      ? (sum >= target ? ' ✓ covers your ' + target + 'g target'
                       : ' — ' + (target - sum) + 'g short of ' + target + 'g')
      : '';
    var cart = A.cartUrl(items.map(function (i) { return i.name; }));
    var searches = searchOnly();
    var n = expanded ? items.length : SHOW;

    var h = '<div class="tray-top"><b>Your list · ' + items.length + ' item'
          + (items.length === 1 ? '' : 's') + ' · ' + sum + 'g protein</b>'
          + '<span class="goal">' + goal + '</span>'
          + '<button class="clear" type="button" data-clear>Clear</button></div>';

    h += '<div class="tray-items">';
    items.slice(0, n).forEach(function (i) {
      h += '<span class="chip">' + i.name + ' <button type="button" data-drop="'
         + i.name.replace(/"/g, '&quot;') + '" aria-label="Remove ' + i.name + '">×</button></span>';
    });
    if (items.length > n) {
      h += '<button type="button" class="chip" data-expand>and ' + (items.length - n) + ' more</button>';
    } else if (expanded && items.length > SHOW) {
      h += '<button type="button" class="chip" data-expand>show fewer</button>';
    }
    h += '</div>';

    if (searches.length) {
      h += '<div class="tray-searches"><span>Fresh food, open when ready:</span>';
      searches.forEach(function (i) {
        h += '<a href="' + A.url(i.name) + '" target="_blank" rel="sponsored nofollow noopener">'
           + i.name + '</a>';
      });
      h += '</div>';
    }

    h += '<div class="tray-actions">';
    if (cart) {
      var k = withAsin().length;
      h += '<button type="button" class="cart" data-cart>Add ' + k + ' product'
         + (k === 1 ? '' : 's') + ' to Amazon cart</button>';
    }
    h += '</div>';
    h += '<p class="tray-note">Your list stays on this device. Links are Amazon affiliate links '
       + '— we may earn a small commission at no extra cost to you.</p>';

    t.innerHTML = h;
    // Reserve exactly the space the tray occupies, measured after paint.
    requestAnimationFrame(function () {
      document.body.style.paddingBottom = (t.offsetHeight + 16) + 'px';
    });
    syncButtons();
  }

  /* Any element with data-pick="Name" becomes a toggle for that item. */
  function syncButtons() {
    document.querySelectorAll('[data-pick]').forEach(function (b) {
      var on = has(b.dataset.pick);
      b.setAttribute('aria-pressed', String(on));
      if (b.classList.contains('pick')) b.textContent = on ? '✓' : '+';
      b.title = (on ? 'Remove ' : 'Add ') + b.dataset.pick;
    });
  }

  function mount() {
    document.addEventListener('click', function (ev) {
      var p = ev.target.closest('[data-pick]');
      if (p) { toggle(p.dataset.pick, p.dataset.protein); return; }
      var d = ev.target.closest('[data-drop]');
      if (d) { remove(d.dataset.drop); return; }
      if (ev.target.closest('[data-clear]')) { clear(); return; }
      if (ev.target.closest('[data-expand]')) { expanded = !expanded; render(); return; }
      if (ev.target.closest('[data-cart]')) {
        var u = A.cartUrl(items.map(function (i) { return i.name; }));
        if (u) window.open(u, '_blank', 'noopener');
      }
    });
    render();
  }

  return { add: add, remove: remove, toggle: toggle, clear: clear, has: has,
           items: function () { return items.slice(); }, total: total,
           render: render, sync: syncButtons, mount: mount };
}));
