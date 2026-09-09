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
  var OPEN_KEY = 'glp1nav.trayopen.v1';
  var MOBILE = '(max-width: 768px)';
  var items = [];
  var expanded = false;
  var SHOW = 5;

  /* Open/shut is remembered, because it is a preference. The keyboard fold
   * below is not remembered, because it is a reaction. */
  var open = null;
  var autoShut = false;

  try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { items = []; }
  if (!Array.isArray(items)) items = [];

  function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {} }
  function has(name) { return items.some(function (i) { return i.name === name; }); }
  function indexOf(name) { return items.findIndex(function (i) { return i.name === name; }); }

  function add(name, grams) {
    if (!A.isLinked(name) || has(name)) return false;
    items.push({ name: name, g: Number(grams) || 0 });
    save(); render(); pulse(); return true;
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

  function isPhone() {
    return typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(MOBILE).matches : false;
  }

  /* A phone cannot afford to hold the list open while you shop: the tray and
   * the tab bar together took 40% of a 812px viewport and 48% of an SE. So
   * the default is shut on a phone and open on a desktop, and after that it
   * is whatever the visitor last chose on this device. */
  function isOpen() {
    if (open === null) {
      var s = null;
      try { s = localStorage.getItem(OPEN_KEY); } catch (e) {}
      open = s === null ? !isPhone() : s === '1';
    }
    return open;
  }
  function applyOpen(v) { open = !!v; render(); }
  function setOpen(v) {
    applyOpen(v);
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}
  }

  /* Adding something while the tray is shut must still feel like it landed.
   * The count is the receipt, so the count is what moves. */
  function pulse() {
    if (typeof document === 'undefined' || isOpen()) return;
    var n = document.querySelector('.tray-n');
    if (!n) return;
    n.classList.remove('bump');
    void n.offsetWidth;
    n.classList.add('bump');
  }

  function setTrayHeight(px) {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--tray-h', px ? px + 'px' : '0px');
  }

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
      setTrayHeight(0);
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
    // The handle has one line, so the same fact has to fit in a few words.
    var goalShort = target
      ? (sum >= target ? ' · target met' : ' · ' + (target - sum) + 'g to go')
      : '';
    var cart = A.cartUrl(items.map(function (i) { return i.name; }));
    var searches = searchOnly();
    var n = expanded ? items.length : SHOW;
    var o = isOpen();
    t.setAttribute('data-open', o ? '1' : '0');

    /* The handle is the whole tray when shut: a count, a summary and a way
       back in. Everything that costs height or is destructive lives in the
       body, which is what folds away. */
    var h = '<button type="button" class="tray-handle" data-toggle'
          + ' aria-expanded="' + (o ? 'true' : 'false') + '" aria-controls="tray-body">'
          + '<span class="tray-n">' + items.length + '</span>'
          + '<span class="tray-sum"><b>Your list</b> · ' + sum + 'g protein' + goalShort + '</span>'
          + '<svg class="tray-chev" viewBox="0 0 24 24" aria-hidden="true">'
          + '<path d="m5 9 7 7 7-7"/></svg>'
          + '<span class="tray-hint">' + (o ? 'Hide' : 'Edit') + '</span>'
          + '</button>';

    h += '<div class="tray-body" id="tray-body"' + (o ? '' : ' hidden') + '>';

    h += '<div class="tray-top"><span class="goal">' + goal + '</span>'
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
    h += '</div>';

    t.innerHTML = h;
    // Reserve exactly the space the tray occupies, measured after paint.
    // On phones the tray is not the only fixed thing down there, so it
    // publishes its height and styles.css adds the tab bar to it.
    // Once synchronously so the page never reflows a frame late, and again
    // after paint in case wrapping changed the height. rAF is throttled in a
    // background tab; the synchronous call is what makes this correct there.
    setTrayHeight(t.offsetHeight + 16);
    requestAnimationFrame(function () { setTrayHeight(t.offsetHeight + 16); });
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

  /* A field means a keyboard (or, for a select, a picker) is about to eat the
   * bottom half of the screen. iOS keeps fixed elements pinned to the visual
   * viewport as it shrinks, so the tray and the tab bar ride up and together
   * cover almost everything left — you end up typing into a field you cannot
   * see. Fold the tray while a field has focus, put it back afterwards. */
  function isField(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  function mount() {
    document.addEventListener('focusin', function (ev) {
      if (!isField(ev.target) || !isOpen()) return;
      autoShut = true;
      applyOpen(false);
    });
    document.addEventListener('focusout', function () {
      if (!autoShut) return;
      // Late enough that tabbing between two fields does not flap the tray.
      setTimeout(function () {
        if (!autoShut || isField(document.activeElement)) return;
        autoShut = false;
        applyOpen(true);
      }, 150);
    });

    document.addEventListener('click', function (ev) {
      // Opening it by hand outranks the keyboard fold: do not reopen later.
      if (ev.target.closest('[data-toggle]')) { autoShut = false; setOpen(!isOpen()); return; }
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
           isOpen: isOpen, setOpen: setOpen,
           render: render, sync: syncButtons, mount: mount };
}));
