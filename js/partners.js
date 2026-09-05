/* Delivery services — the third way to fill a meal slot.
 *
 * Deliberately empty. No affiliate programme has approved this site yet, and
 * a link to a service we are not a partner of earns nothing while implying a
 * relationship that does not exist.
 *
 * The registry ships empty rather than not shipping, because "the delivered
 * route is absent" has to be a state the tool renders correctly and a state
 * the tests exercise. If approval never comes, nothing here needs changing —
 * the route simply stays quiet.
 *
 * To switch a service on: fill in the entry, set approved to the date the
 * network confirmed it, and put the real tracking link in `url`. Nothing
 * renders until `approved` holds a date.
 *
 * Loads as a browser global (Partners) or a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Partners = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Shape of an entry, for whoever fills the first one in:
   *
   *   trifecta: {
   *     name:     'Trifecta',            // as the visitor should see it
   *     network:  'impact',              // impact | cj | direct
   *     url:      'https://...',         // the tracking link the network issues
   *     approved: '2026-09-20',          // date the network confirmed. null = off
   *     rel:      'sponsored nofollow noopener',
   *     note:     'High-protein plans, ships to all 50 states'
   *   }
   *
   * Applications are in with Factor (CJ) and Trifecta (Impact). Neither has
   * published a rate we have confirmed inside the network, so no commission
   * figure is recorded here — a number nobody verified is worse than none.
   */
  var SERVICES = {};

  function get(id) {
    var s = SERVICES[id];
    return s && s.approved ? s : null;
  }

  /* A service is usable only once a network has actually approved it. Every
     render path asks this rather than checking the map directly. */
  function isApproved(id) { return !!get(id); }

  function approved() {
    return Object.keys(SERVICES).filter(isApproved);
  }

  /* Any delivered route pointing at a service that is not approved is not a
     bug in the data — it is the normal state before approval — so this
     returns null quietly rather than throwing. */
  function link(id) {
    var s = get(id);
    if (!s || !s.url) return null;
    return { href: s.url, name: s.name, rel: s.rel || 'sponsored nofollow noopener' };
  }

  function anchor(id, label) {
    var l = link(id);
    if (!l) return '';
    return '<a href="' + l.href + '" target="_blank" rel="' + l.rel + '">'
         + (label || l.name) + '</a>';
  }

  return { SERVICES: SERVICES, get: get, isApproved: isApproved,
           approved: approved, link: link, anchor: anchor };
}));
