/* Dish page behaviour: the Make-it / Buy-it toggle, and putting ingredients
 * on the shared shopping list.
 *
 * Ingredients live in the HTML as <li class="ing" data-name data-protein>,
 * so a crawler sees the full recipe without running any of this.
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

  /* Make it / Buy it */
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
