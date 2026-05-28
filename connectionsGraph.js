// connectionsGraph.js — Interactive "Connections" citation report for ref-lookup
// Non-module, vanilla JS. Mirrors citationBuilder.js conventions.
//
// THREE VIEWS of the center article, toggled in one report:
//   • Inside  (25) — references WITHIN the article (what it cites)   arrows: center → node (out)
//   • Outside (25) — papers that CITE this article (what cites it)   arrows: node → center (in)
//   • Mix     (24) — 12 inside + 12 outside in one shared ring       arrows: mixed
//
// Layout: graph (left) + detail panel (right). Click a bubble → right panel shows
// title/journal/year/citations/quality/links + abstract.
//
// Abstract cascade on click: OpenAlex (instant) → _allResults cache (instant)
//                          → live PubMed → Crossref → "none available".
//
// Hook (lookup.js): window.ConnectionsGraph.attachButton(result, doi)
// SJR accessor (lookup.js): window.__getSjrByIssn(issn)
// ============================================================================

(function () {
  'use strict';

  var OPENALEX = 'https://api.openalex.org/works';
  var N_SINGLE = 25, N_MIX_EACH = 12;

  var esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) {
    return s == null ? '' : String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trim() + '\u2026' : s; }

  var SCACHE = 'connGraph2:';

  function qualityTier(sjr) {
    if (sjr === null || isNaN(sjr)) return { label: 'Unknown', fill: '#F1EFE8', stroke: '#888780', text: '#2C2C2A' };
    if (sjr >= 3)   return { label: 'High',  fill: '#C0DD97', stroke: '#3B6D11', text: '#173404' };
    if (sjr >= 0.8) return { label: 'Good',  fill: '#9FE1CB', stroke: '#0F6E56', text: '#04342C' };
    return { label: 'Low', fill: '#D3D1C7', stroke: '#5F5E5A', text: '#2C2C2A' };
  }

  function sjrForIssns(issns) {
    if (!issns || !issns.length || typeof window.__getSjrByIssn !== 'function') return null;
    for (var i = 0; i < issns.length; i++) {
      var e = window.__getSjrByIssn(issns[i]);
      if (e && e.sjr != null) return parseFloat(e.sjr);
    }
    return null;
  }

  function rebuildAbstract(inv) {
    if (!inv || typeof inv !== 'object') return null;
    var words = [];
    Object.keys(inv).forEach(function (w) { inv[w].forEach(function (pos) { words[pos] = w; }); });
    var t = words.join(' ').replace(/\s+/g, ' ').trim();
    return t || null;
  }

  function workToNode(w, direction) {
    var src = w.primary_location && w.primary_location.source;
    var issns = (src && src.issn) || [];
    var doi = w.doi ? String(w.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : null;
    return {
      oaId: w.id ? String(w.id).replace('https://openalex.org/', '') : null,
      doi: doi, title: w.display_name || '(untitled)', year: w.publication_year || null,
      cites: w.cited_by_count || 0, journal: (src && src.display_name) || '',
      tier: qualityTier(sjrForIssns(issns)), direction: direction,
      abstract: rebuildAbstract(w.abstract_inverted_index)
    };
  }

  var SELECT = 'id,doi,display_name,publication_year,cited_by_count,primary_location,abstract_inverted_index';

  function fetchCiters(workId, n) {
    var id = String(workId).toLowerCase().replace(/^https?:\/\/openalex\.org\//, '');
    var url = OPENALEX + '?filter=cites:' + encodeURIComponent(id) + '&sort=cited_by_count:desc&per-page=' + n + '&select=' + SELECT;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('citers ' + r.status); return r.json(); })
      .then(function (d) { return { total: (d.meta && d.meta.count) || (d.results || []).length, nodes: (d.results || []).map(function (w) { return workToNode(w, 'out'); }) }; });
  }

  function fetchRefs(workId, n) {
    var id = String(workId).replace(/^https?:\/\/openalex\.org\//, '');
    return fetch(OPENALEX + '/' + id + '?select=referenced_works').then(function (r) { if (!r.ok) throw new Error('refs ' + r.status); return r.json(); })
      .then(function (d) {
        var refs = (d.referenced_works || []).map(function (u) { return u.replace('https://openalex.org/', ''); });
        if (!refs.length) return { total: 0, nodes: [] };
        var batch = refs.slice(0, 100);
        var url = OPENALEX + '?filter=openalex_id:' + batch.join('|') + '&sort=cited_by_count:desc&per-page=' + n + '&select=' + SELECT;
        return fetch(url).then(function (r2) { if (!r2.ok) throw new Error('ref-resolve ' + r2.status); return r2.json(); })
          .then(function (d2) { return { total: refs.length, nodes: (d2.results || []).map(function (w) { return workToNode(w, 'in'); }) }; });
      });
  }

  function buildData(workId) {
    var key = SCACHE + String(workId).toLowerCase().replace(/^https?:\/\/openalex\.org\//, '');
    try { var c = sessionStorage.getItem(key); if (c) return Promise.resolve(JSON.parse(c)); } catch (e) {}
    return Promise.all([fetchCiters(workId, N_SINGLE), fetchRefs(workId, N_SINGLE)]).then(function (res) {
      var citers = res[0], refs = res[1];
      var mix = refs.nodes.slice(0, N_MIX_EACH).concat(citers.nodes.slice(0, N_MIX_EACH));
      var out = { outside: { total: citers.total, nodes: citers.nodes }, inside: { total: refs.total, nodes: refs.nodes }, mix: { nodes: mix } };
      try { sessionStorage.setItem(key, JSON.stringify(out)); } catch (e) {}
      return out;
    });
  }

  function radiusFor(cites, maxCites) {
    var min = 9, max = 22;
    if (!maxCites || maxCites <= 0) return min;
    return Math.round(min + (Math.sqrt(cites) / Math.sqrt(maxCites)) * (max - min));
  }

  function renderGraph(nodes) {
    var W = 560, H = 560, cx = W / 2, cy = H / 2, ringR = 215, hubR = 44;
    var maxCites = nodes.reduce(function (m, n) { return Math.max(m, n.cites); }, 0);
    var p = [];
    p.push('<svg id="conn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block; max-width:' + W + 'px; margin:0 auto; font-family:Arial,sans-serif;">');
    p.push('<defs>' +
      '<marker id="arrOut" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#9a978d"/></marker>' +
      '<marker id="arrIn" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#185FA5"/></marker></defs>');

    var pos = [];
    for (var i = 0; i < nodes.length; i++) {
      var ang = (-90 + (360 / nodes.length) * i) * Math.PI / 180;
      pos.push({ x: cx + ringR * Math.cos(ang), y: cy + ringR * Math.sin(ang) });
    }
    for (var a = 0; a < nodes.length; a++) {
      var n = nodes[a], pt = pos[a], r = radiusFor(n.cites, maxCites);
      var dx = pt.x - cx, dy = pt.y - cy, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
      var hx = cx + ux * (hubR + 2), hy = cy + uy * (hubR + 2);
      var nx = pt.x - ux * (r + 4), ny = pt.y - uy * (r + 4);
      if (n.direction === 'out')
        p.push('<line x1="' + hx.toFixed(1) + '" y1="' + hy.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="#c9c6bc" stroke-width="1" marker-end="url(#arrOut)"/>');
      else
        p.push('<line x1="' + nx.toFixed(1) + '" y1="' + ny.toFixed(1) + '" x2="' + hx.toFixed(1) + '" y2="' + hy.toFixed(1) + '" stroke="#bcd2ea" stroke-width="1" marker-end="url(#arrIn)"/>');
    }
    p.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + hubR + '" fill="#B5D4F4" stroke="#185FA5" stroke-width="1.4"/>');
    p.push('<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="12" font-weight="bold" fill="#0C447C">This</text>');
    p.push('<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" font-size="12" font-weight="bold" fill="#0C447C">article</text>');
    for (var j = 0; j < nodes.length; j++) {
      var nd = nodes[j], q = pos[j], rr = radiusFor(nd.cites, maxCites), fs = rr >= 14 ? 12 : 10;
      p.push('<g class="conn-node" data-idx="' + j + '" style="cursor:pointer;">');
      p.push('<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + rr + '" fill="' + nd.tier.fill + '" stroke="' + nd.tier.stroke + '" stroke-width="0.9"/>');
      p.push('<text x="' + q.x.toFixed(1) + '" y="' + (q.y + fs / 3).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '" font-weight="bold" fill="' + nd.tier.text + '" style="pointer-events:none;">' + (j + 1) + '</text></g>');
    }
    p.push('</svg>');
    return p.join('');
  }

  function getAbstract(node) {
    if (node.abstract) return Promise.resolve({ text: node.abstract, src: 'OpenAlex' });
    if (node.doi && typeof _allResults !== 'undefined' && _allResults.length) {
      var hit = _allResults.find(function (r) { return (r.doiOrgDoi || r._doi || '').toLowerCase() === node.doi.toLowerCase(); });
      if (hit && (hit.pubmedAbstract || hit.raAbstract)) {
        var raw = (hit.pubmedAbstract || hit.raAbstract).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (raw) return Promise.resolve({ text: raw, src: 'cached lookup' });
      }
    }
    if (!node.doi) return Promise.resolve({ text: null, src: null });
    return liveAbstract(node.doi);
  }

  function liveAbstract(doi) {
    var tryPM = Promise.resolve(null);
    if (window.PubMedLookup && typeof window.PubMedLookup.fetchPubMedData === 'function') {
      tryPM = window.PubMedLookup.fetchPubMedData(doi).then(function (d) { return d && d.pubmedAbstract ? d.pubmedAbstract : null; }).catch(function () { return null; });
    }
    return tryPM.then(function (pm) {
      if (pm) return { text: pm.replace(/\s+/g, ' ').trim(), src: 'PubMed' };
      return fetch('https://api.crossref.org/works/' + encodeURIComponent(doi)).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var ab = j && j.message && j.message.abstract;
          if (ab) return { text: ab.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), src: 'Crossref' };
          return { text: null, src: null };
        }).catch(function () { return { text: null, src: null }; });
    });
  }

  function showDetail(node) {
    var el = document.getElementById('conn-detail');
    if (!el) return;
    var dirLabel = node.direction === 'in' ? 'Referenced by this article' : 'Cites this article';
    var links = [];
    if (node.doi) links.push('<a href="https://doi.org/' + esc(node.doi) + '" target="_blank" rel="noopener" style="color:#005a8c;">View article (DOI) \u2192</a>');
    if (node.oaId) links.push('<a href="https://openalex.org/' + esc(node.oaId) + '" target="_blank" rel="noopener" style="color:#005a8c;">OpenAlex \u2192</a>');
    el.innerHTML =
      '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d; margin-bottom:6px;">' + dirLabel + '</div>' +
      '<div style="font-size:15px; font-weight:600; line-height:1.35; color:#1a1a18; margin-bottom:8px;">' + esc(node.title) + '</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:4px;">' + esc(node.journal || '') + (node.year ? ' &#183; ' + node.year : '') + '</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:10px;">' + node.cites.toLocaleString() + ' citations &#183; <span style="color:' + node.tier.text + ';">' + node.tier.label + ' quality</span></div>' +
      (links.length ? '<div style="font-size:12px; margin-bottom:12px; display:flex; gap:14px;">' + links.join('') + '</div>' : '') +
      '<div style="border-top:1px solid #e5e2d9; padding-top:10px;"><div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d; margin-bottom:6px;">Abstract</div>' +
      '<div id="conn-abstract" style="font-size:13px; line-height:1.5; color:#333;">Loading\u2026</div></div>';
    getAbstract(node).then(function (res) {
      var ab = document.getElementById('conn-abstract');
      if (!ab) return;
      ab.innerHTML = res.text
        ? esc(res.text) + '<div style="font-size:10px; color:#bbb; margin-top:8px;">source: ' + esc(res.src) + '</div>'
        : '<span style="color:#999; font-style:italic;">No abstract available for this article.</span>';
    });
  }

  function openPanel(result, doi) {
    var existing = document.getElementById('conn-graph-panel');
    if (existing) existing.remove();
    var hTitle = result.doiOrgTitle || result.raTitle || result.pubmedTitle || 'Article';
    var hJournal = result.doiOrgJournal || result.raJournal || result.pubmedJournalFull || result.pubmedJournal || '';
    var hDate = result.doiOrgPublishedDate || result.raPublishedDate || result.doiOrgEarliestTimestamp || result.pubmedPublishDate || result.pubmedYear || '';
    var hMeta = [hJournal, hDate].filter(Boolean).join(' \u00b7 ');

    var panel = document.createElement('div');
    panel.id = 'conn-graph-panel';
    panel.style.cssText = 'margin:0 auto 16px; max-width:1040px; background:#fff; border:1.5px solid #005a8c; box-shadow:0 2px 12px rgba(0,0,0,0.12);';
    panel.innerHTML =
      '<div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e5e2d9; background:#f7f6f2;">' +
        '<span style="font-family:\'IBM Plex Sans\',sans-serif; font-weight:600; color:#005a8c;">Connections</span>' +
        '<button id="conn-close" style="border:none; background:none; font-size:18px; cursor:pointer; color:#888; line-height:1;">\u2715</button></div>' +
      '<div style="padding:14px 18px; border-bottom:1px solid #f0eee7;">' +
        '<div style="font-weight:600; font-size:14px; line-height:1.35;">' + esc(hTitle) + '</div>' +
        '<div style="font-size:12px; color:#666; margin-top:3px;">DOI ' + esc(doi) + (hMeta ? '  &#183;  ' + esc(hMeta) : '') + '</div>' +
        '<div id="conn-toggle" style="margin-top:12px; display:inline-flex; border:1px solid #d8d5cc; border-radius:4px; overflow:hidden; font-family:\'IBM Plex Mono\',monospace; font-size:12px;">' +
          '<button data-view="inside" class="conn-tab" style="padding:7px 14px; border:none; background:#fff; cursor:pointer;">Inside (refs)</button>' +
          '<button data-view="outside" class="conn-tab" style="padding:7px 14px; border:none; background:#005a8c; color:#fff; cursor:pointer;">Outside (cited by)</button>' +
          '<button data-view="mix" class="conn-tab" style="padding:7px 14px; border:none; background:#fff; cursor:pointer;">Mix</button></div>' +
        '<div id="conn-viewinfo" style="font-size:12px; color:#888; margin-top:8px;"></div></div>' +
      '<div style="display:flex; flex-wrap:wrap; align-items:flex-start;">' +
        '<div id="conn-graphpane" style="flex:1 1 560px; min-width:320px; padding:14px;">' +
          '<div id="conn-status" style="font-size:13px; color:#666; padding:20px; text-align:center;">Loading citation data from OpenAlex\u2026</div>' +
          '<div id="conn-graphholder"></div>' +
          '<div id="conn-tip" style="position:fixed; z-index:10000; display:none; max-width:240px; background:#ffffff; color:#1a1a18; font-family:\'IBM Plex Sans\',sans-serif; font-size:12px; line-height:1.4; padding:8px 11px; border:1px solid #d8d5cc; border-radius:6px; pointer-events:none; box-shadow:0 3px 12px rgba(0,0,0,0.15); -webkit-font-smoothing:antialiased;"></div>' +
          '<div id="conn-legend" style="display:none; font-size:11px; color:#777; margin-top:6px; text-align:center;">Size = citations &#183; color = quality &#183; <span style="color:#185FA5;">\u2192 in</span> = cites this &#183; <span style="color:#9a978d;">\u2192 out</span> = referenced by this</div></div>' +
        '<div id="conn-detail" style="flex:1 1 360px; min-width:300px; padding:18px; border-left:1px solid #f0eee7; min-height:300px;">' +
          '<div style="color:#999; font-size:13px; font-style:italic; padding-top:40px; text-align:center;">Click any bubble to see its details and abstract.</div></div></div>';

    var resultsDiv = document.getElementById('results');
    if (resultsDiv && resultsDiv.firstChild) resultsDiv.insertBefore(panel, resultsDiv.firstChild);
    else if (resultsDiv) resultsDiv.appendChild(panel);
    else document.body.appendChild(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    function close() { panel.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.getElementById('conn-close').onclick = close;
    document.addEventListener('keydown', onKey);

    var workId = result._openAlexWorkId || result._oaWorkId || null;
    if (!workId) { document.getElementById('conn-status').textContent = 'No OpenAlex record for this DOI — cannot build the report.'; return; }

    var DATA = null;
    function paint(view) {
      var info = document.getElementById('conn-viewinfo'), holder = document.getElementById('conn-graphholder');
      var nodes, label;
      if (view === 'inside') { nodes = DATA.inside.nodes; label = DATA.inside.total.toLocaleString() + ' references in this article \u2014 showing top ' + nodes.length + ' by citations'; }
      else if (view === 'mix') { nodes = DATA.mix.nodes; label = 'Top references + top citing articles, combined'; }
      else { nodes = DATA.outside.nodes; label = DATA.outside.total.toLocaleString() + ' articles cite this \u2014 showing top ' + nodes.length + ' by citations'; }
      if (!nodes.length) { holder.innerHTML = '<div style="padding:30px; text-align:center; color:#999; font-style:italic;">No data for this view.</div>'; info.textContent = ''; return; }
      info.textContent = label;
      holder.innerHTML = renderGraph(nodes);
      document.getElementById('conn-legend').style.display = 'block';

      var tip = document.getElementById('conn-tip');
      var hoverTimer = null, tipShowing = false, activeIdx = null;
      function placeTip(e) {
        if (!tip) return;
        var pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
        var x = e.clientX + pad, y = e.clientY + pad;
        if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
        if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
        tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
      }
      function fillTip(node) {
        var meta = (node.year ? node.year + ' \u00b7 ' : '') + node.cites.toLocaleString() + ' cites';
        tip.innerHTML = '<div style="font-weight:500; margin-bottom:2px; color:#1a1a18;">' + esc(truncate(node.title, 60)) + '</div>' +
          '<div style="font-size:11px; color:#888780;">' + esc(meta) + '</div>';
      }

      holder.querySelectorAll('.conn-node').forEach(function (g) {
        var idx = parseInt(g.getAttribute('data-idx'), 10);
        g.addEventListener('click', function () {
          holder.querySelectorAll('.conn-node circle').forEach(function (c) { c.setAttribute('stroke-width', '0.9'); });
          var sel = g.querySelector('circle'); if (sel) sel.setAttribute('stroke-width', '3');
          showDetail(nodes[idx]);
        });
        g.addEventListener('mouseover', function (e) {
          activeIdx = idx;
          if (tipShowing) {                 // already browsing node-to-node: switch instantly
            fillTip(nodes[idx]); placeTip(e); return;
          }
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(function () {
            if (activeIdx !== idx) return;  // cursor moved on before delay elapsed
            fillTip(nodes[idx]); tip.style.display = 'block'; tipShowing = true; placeTip(e);
          }, 300);
        });
        g.addEventListener('mousemove', function (e) { if (tipShowing) placeTip(e); });
        g.addEventListener('mouseout', function () {
          clearTimeout(hoverTimer);
          if (activeIdx === idx) activeIdx = null;
          // Defer hide: if we've moved onto another node, its mouseover already
          // set activeIdx, so we keep the tooltip; only hide if truly off all nodes.
          setTimeout(function () {
            if (activeIdx === null) { tip.style.display = 'none'; tipShowing = false; }
          }, 10);
        });
      });
      document.querySelectorAll('.conn-tab').forEach(function (t) {
        var on = t.getAttribute('data-view') === view;
        t.style.background = on ? '#005a8c' : '#fff';
        t.style.color = on ? '#fff' : '#1a1a18';
      });
    }

    buildData(workId).then(function (data) {
      DATA = data;
      document.getElementById('conn-status').style.display = 'none';
      document.querySelectorAll('.conn-tab').forEach(function (t) { t.addEventListener('click', function () { paint(t.getAttribute('data-view')); }); });
      paint('outside');
    }).catch(function (err) { document.getElementById('conn-status').textContent = 'Could not load citation data: ' + err.message; });
  }

  function attachButton(result, doi) {
    setTimeout(function () {
      var cardId = 'card-' + String(doi).replace(/[^a-zA-Z0-9]/g, '-');
      var card = document.getElementById(cardId);
      if (!card || card.querySelector('.conn-graph-trigger')) return;
      var btn = document.createElement('button');
      btn.className = 'conn-graph-trigger';
      btn.textContent = 'View connections graph';
      btn.style.cssText = 'margin-top:12px; font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:600; padding:7px 14px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;';
      btn.addEventListener('click', function () { openPanel(result, doi); });
      card.appendChild(btn);
    }, 0);
  }

  window.ConnectionsGraph = { attachButton: attachButton, openPanel: openPanel };
})();
