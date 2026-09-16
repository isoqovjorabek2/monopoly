/* Who runs Party Hall. Fill in these values once; every legal page reads
 * them. Paddle's domain review looks for the operator's name in the terms. */
window.PARTY_HALL = {
  operator: 'ARC (AI Routing Control)',
  country: 'Uzbekistan',
  email: 'support@partyhall.io',
  updated: '15 September 2026',
};

(function fill() {
  var site = window.PARTY_HALL;
  var nodes = document.querySelectorAll('[data-site]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var key = el.getAttribute('data-site');
    if (!site[key]) continue;
    el.textContent = site[key];
    if (el.tagName === 'A' && key === 'email') el.setAttribute('href', 'mailto:' + site[key]);
  }
})();
