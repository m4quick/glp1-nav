/* Meal page behaviour: the route toggle, the delivered-route gate, and putting
 * ingredients on the shared shopping list.
 *
 * A meal can be obtained up to three ways — delivered, bought prepared, or
 * made — and each is a pane with its own macros. Ingredients live in the HTML
 * as <li class="ing" data-name data-protein>, so a crawler sees the full
 * recipe without running any of this.
 */
(function () {
  'use strict';
  var A = window.AmazonLinks, S = window.ShoppingList;
  if (!A || !S) return;

  /* Decorate each ingredient with a picker, but only when we can actually
     send someone somewhere. Nobody needs an affiliate link for a lemon, and
     a dead "+" would be worse than none. */
  document.querySelectorAll('li.ing').forEach(function (li) {
    var name = li.dataset.name;
    var grams = li.dataset.protein || 0;
    if (!A.isLinked(name)) {
      li.classList.add('ing-plain');
      return;
    }
    var pic = A.photo(name, 'ing-photo') || A.tile(name, grams);
    if (pic) li.insertAdjacentHTML('afterbegin', pic);
    li.insertAdjacentHTML('beforeend',
      '<button type="button" class="pick" data-pick="' + name.replace(/"/g, '&quot;') +
      '" data-protein="' + grams + '" aria-pressed="false">+</button>');
  });

  /* The delivered route is rendered but inert until an affiliate programme
     has actually approved us. An unapproved service is removed outright —
     pane and tab both — rather than shown disabled, because "coming soon" on
     a commercial link is a promise nobody asked us to make. */
  (function gateDelivery() {
    var P = window.Partners;
    document.querySelectorAll('.pane[data-pane="delivered"]').forEach(function (pane) {
      var slot = pane.querySelector('.deliver');
      var id = slot && slot.dataset.service;
      var link = P && id ? P.link(id) : null;

      if (!link) {
        var tab = document.querySelector('.dish-toggle [data-tab="delivered"]');
        if (tab) tab.remove();
        pane.remove();
        return;
      }
      var plan = slot.dataset.plan;
      slot.innerHTML = '<a class="dish-cta" href="' + link.href + '" target="_blank" rel="'
        + link.rel + '">Order ' + (plan ? plan + ' from ' : 'from ') + link.name + ' &rarr;</a>';
      slot.hidden = false;
    });

    /* Removing a tab can leave one route wearing a toggle it does not need,
       or leave no tab marked current if the removed one was it. */
    var left = document.querySelectorAll('.dish-toggle button');
    var bar = document.querySelector('.dish-toggle');
    if (bar && left.length < 2) { bar.remove(); }
    if (bar && left.length && !document.querySelector('.dish-toggle button.on')) {
      left[0].classList.add('on');
      document.querySelectorAll('.pane').forEach(function (p) {
        p.hidden = p.dataset.pane !== left[0].dataset.tab;
      });
    }
  }());

  /* Route toggle */
  var tabs = document.querySelectorAll('.dish-toggle button');
  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      var want = b.dataset.tab;
      tabs.forEach(function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.pane').forEach(function (p) {
        p.hidden = p.dataset.pane !== want;
      });
    });
  });

  /* Add everything in the visible pane at once. */
  document.querySelectorAll('[data-add-all]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pane = document.querySelector('.pane[data-pane="' + btn.dataset.addAll + '"]');
      if (!pane) return;
      var added = 0;
      pane.querySelectorAll('li.ing').forEach(function (li) {
        if (S.add(li.dataset.name, li.dataset.protein)) added++;
      });
      btn.textContent = added ? 'Added ' + added + ' to your list' : 'Already on your list';
      setTimeout(function () { btn.textContent = 'Add these to my list'; }, 2200);
    });
  });

  S.mount();
})();
