/* Mobile app shell — the two bits of the phone layout that CSS alone
 * cannot do: the "More" sheet behind the fifth tab, and collapsing the
 * review banner to one line.
 *
 * Both are progressive. With JavaScript off, the banner stays fully
 * expanded (correct, just tall) and every page the sheet would have
 * listed is still reachable from the footer, which links the whole
 * site. Nothing here is required to read a page.
 *
 * Loaded with `defer` so it never blocks first paint.
 */
(function () {
  'use strict';

  var MOBILE = '(max-width: 768px)';

  /* Kept here rather than in the per-page HTML so the sheet is identical
     everywhere and there is one place to add a page. Order is deliberate:
     the two content pillars first, then reference, then legal. */
  var MORE = [
    { grp: 'Guides' },
    { href: '/protein-foods.html', text: 'Protein foods' },
    { href: '/nutrition.html', text: 'Nutrition guide' },
    { href: '/faq.html', text: 'Common questions' },
    { grp: 'The site' },
    { href: '/about.html', text: 'About & editorial policy' },
    { href: '/contact.html', text: 'Contact' },
    { href: '/privacy.html', text: 'Privacy policy' },
    { href: '/terms.html', text: 'Terms of service' }
  ];

  function here(href) {
    var path = location.pathname;
    if (path === '/' || path === '/index.html') return href === '/';
    return path === href;
  }

  /* ---------------- More sheet ---------------- */

  function buildSheet() {
    var btn = document.querySelector('.tabbar [data-more]');
    if (!btn) return;

    var sheet = document.createElement('div');
    sheet.className = 'more-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'More pages');
    sheet.hidden = false;

    var h = '<div class="panel"><div class="grab"></div>';
    MORE.forEach(function (it) {
      if (it.grp) { h += '<div class="grp">' + it.grp + '</div>'; return; }
      h += '<a href="' + it.href + '"' + (here(it.href) ? ' class="here" aria-current="page"' : '')
         + '>' + it.text + '</a>';
    });
    h += '</div>';
    sheet.innerHTML = h;
    document.body.appendChild(sheet);

    function open() {
      sheet.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      // The first link, not the panel, so a screen reader lands on something useful.
      var first = sheet.querySelector('a');
      if (first) first.focus();
    }
    function close() {
      sheet.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    // Light the More tab when the page you are on lives behind it, so the
    // bar never shows five unlit tabs on a page that is part of the site.
    if (MORE.some(function (it) { return it.href && here(it.href); })) {
      btn.classList.add('on');
    }

    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () {
      sheet.classList.contains('open') ? close() : open();
    });
    // Tapping the scrim closes; tapping the panel itself must not.
    sheet.addEventListener('click', function (ev) {
      if (!ev.target.closest('.panel')) close();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && sheet.classList.contains('open')) { close(); btn.focus(); }
    });
  }

  /* ---------------- Review banner ---------------- */

  /* The banner is the most valuable 188px on the page and the least
     valuable to re-read on every visit. Collapsed it still states the
     headline claim — "Not reviewed by a clinician" — in full; only the
     sourcing paragraph folds away. */
  function collapsibleBanner() {
    var b = document.querySelector('.review-banner');
    if (!b || b.dataset.rb) return;

    var body = b.querySelector('span:last-of-type');
    if (!body) return;
    var lead = body.querySelector('strong');
    if (!lead) return;

    // Wrap everything after the bold lead so CSS can hide just that part.
    var wrap = document.createElement('span');
    wrap.className = 'rb-body';
    while (lead.nextSibling) wrap.appendChild(lead.nextSibling);
    body.appendChild(wrap);

    var chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'rb-chev');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = '<path d="m5 9 7 7 7-7"/>';
    b.appendChild(chev);

    b.dataset.rb = '1';

    function shut(on) {
      b.classList.toggle('rb-shut', on);
      b.setAttribute('aria-expanded', String(!on));
      b.setAttribute('aria-label', (on ? 'Show' : 'Hide') + ' the full review notice');
    }
    function toggle(ev) {
      // Never swallow the "how we source this" link.
      if (ev.target.closest('a')) return;
      shut(!b.classList.contains('rb-shut'));
    }

    b.addEventListener('click', toggle);
    b.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); }
    });

    /* Desktop has the room, so the banner is plain prose there: no button
       role, no focus stop, no chevron. Only phones get the collapse. */
    var mq = window.matchMedia(MOBILE);
    function apply() {
      if (mq.matches) {
        b.setAttribute('role', 'button');
        b.setAttribute('tabindex', '0');
        chev.removeAttribute('hidden');
        shut(true);
      } else {
        b.removeAttribute('role');
        b.removeAttribute('tabindex');
        b.removeAttribute('aria-expanded');
        b.removeAttribute('aria-label');
        chev.setAttribute('hidden', '');
        b.classList.remove('rb-shut');
      }
    }
    apply();
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  }

  function init() { buildSheet(); collapsibleBanner(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
