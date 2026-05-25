(function () {
  // ============================================================================
  // Canonical URL + selective noindex
  // ----------------------------------------------------------------------------
  // Goal: doilookup.com is the real, indexable site. Any copy served from
  // GitHub Pages (*.github.io) must NOT be indexed and must point search
  // engines back to doilookup.com to avoid duplicate-content penalties.
  //
  // Because both sites share identical files, this runs at load time and
  // decides behavior based on the hostname it is actually served from.
  // ============================================================================

  var PRIMARY_HOST   = 'doilookup.com';                 // the real site
  var PRIMARY_ORIGIN = 'https://doilookup.com';         // used to build canonical URLs

  var host = window.location.hostname.toLowerCase();

  // Is this the GitHub Pages copy (or any non-primary host)?
  // Treat doilookup.com and www.doilookup.com as primary; everything else
  // (github.io, localhost, preview hosts) is non-primary.
  var isPrimary = (host === PRIMARY_HOST || host === 'www.' + PRIMARY_HOST);

  var head = document.head || document.getElementsByTagName('head')[0];
  if (!head) return;

  // ── Canonical link: always point to the same path on the primary domain ──
  // e.g. /med/guidelines.html on github.io -> https://doilookup.com/med/guidelines.html
  // On GitHub project sites the path may be prefixed with the repo name
  // (/ref-lookup/...). Strip a leading /ref-lookup segment so the canonical
  // matches the real domain's structure.
  var path = window.location.pathname.replace(/^\/ref-lookup(?=\/|$)/, '');
  if (path === '' ) path = '/';
  var canonicalHref = PRIMARY_ORIGIN + path;

  if (!document.querySelector('link[rel="canonical"]')) {
    var canon = document.createElement('link');
    canon.rel = 'canonical';
    canon.href = canonicalHref;
    head.appendChild(canon);
  }

  // ── On any non-primary host, block indexing ──
  if (!isPrimary) {
    if (!document.querySelector('meta[name="robots"]')) {
      var robots = document.createElement('meta');
      robots.name = 'robots';
      robots.content = 'noindex, nofollow';
      head.appendChild(robots);
    }
  }
})();
