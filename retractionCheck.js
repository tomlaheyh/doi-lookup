// retractionCheck.js — Focused retraction-status check for Connections.
// Crossref-only (Crossref ingests Retraction Watch), batch-friendly, returns
// a simple {doi: bool} map. Intentionally duplicated logic (not shared with
// lookup.js) to keep this module independent and easy to reason about.
//
// "Retracted" for our purposes = Crossref `update-to` contains an entry whose
// `update-type` is 'retraction' OR 'expression-of-concern'. Corrections and
// other update types do NOT count as retracted.
//
// Public API:
//   window.RetractionCheck.checkBatch(doisArray)
//     → Promise<{ "10.x/y": true, "10.x/z": false, ... }>
// ============================================================================

(function () {
  'use strict';

  var CROSSREF = 'https://api.crossref.org/works/';
  var BLOCKED_TYPES = ['retraction', 'expression-of-concern'];
  var TIMEOUT_MS = 6000;            // per-DOI timeout, generous
  var CONCURRENCY = 8;              // parallel requests cap
  var CACHE = {};                   // in-memory cache: doi → bool

  // Fetch with timeout, returning null on failure (we treat "couldn't check" as not-retracted)
  function fetchWithTimeout(url, ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(null); }, ms);
      fetch(url).then(function (r) {
        clearTimeout(t);
        resolve(r && r.ok ? r.json() : null);
      }).catch(function () { clearTimeout(t); resolve(null); });
    });
  }

  // Decide retraction status from a Crossref work response.
  // Must check BOTH update-to (this DOI was updated by a notice) AND
  // updated-by (this DOI has a notice pointing AT it). Older papers' retractions
  // often only appear in updated-by — matching lookup.js's combined-source logic.
  function isRetractedFromCrossref(data) {
    var msg = data && data.message;
    if (!msg) return false;
    var lists = [];
    if (Array.isArray(msg['update-to'])) lists.push(msg['update-to']);
    if (Array.isArray(msg['updated-by'])) lists.push(msg['updated-by']);
    for (var L = 0; L < lists.length; L++) {
      var arr = lists[L];
      for (var i = 0; i < arr.length; i++) {
        var t = String(arr[i]['update-type'] || arr[i].type || '').toLowerCase();
        if (BLOCKED_TYPES.indexOf(t) !== -1) return true;
      }
    }
    return false;
  }

  // Check one DOI (with caching). Resolves true/false.
  function checkOne(doi) {
    if (!doi) return Promise.resolve(false);
    var key = String(doi).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CACHE, key)) return Promise.resolve(CACHE[key]);
    return fetchWithTimeout(CROSSREF + encodeURIComponent(key), TIMEOUT_MS).then(function (data) {
      var retracted = data ? isRetractedFromCrossref(data) : false;
      CACHE[key] = retracted;
      return retracted;
    });
  }

  // Run an array of DOIs through checkOne with a concurrency cap.
  // Returns {doi: bool} map keyed by ORIGINAL (un-lowercased) DOI input.
  function checkBatch(dois) {
    if (!Array.isArray(dois) || !dois.length) return Promise.resolve({});
    var out = {};
    var queue = dois.slice();      // copy
    var inflight = 0;
    return new Promise(function (resolve) {
      function next() {
        if (queue.length === 0 && inflight === 0) { resolve(out); return; }
        while (inflight < CONCURRENCY && queue.length > 0) {
          var doi = queue.shift();
          inflight++;
          checkOne(doi).then(function (originalDoi, res) {
            out[originalDoi] = res;
            inflight--;
            next();
          }.bind(null, doi));
        }
      }
      next();
    });
  }

  window.RetractionCheck = { checkBatch: checkBatch, _cache: CACHE };
})();
