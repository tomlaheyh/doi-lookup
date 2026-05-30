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

  // Heart icon — outline (empty) or filled. 14px. Inline SVG, no font dep.
  function heartSvg(filled, size) {
    size = size || 14;
    var fill = filled ? '#005a8c' : 'none';
    var stroke = filled ? '#005a8c' : '#9a978d';
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="vertical-align:-2px;" aria-hidden="true">' +
      '<path d="M12 21s-7-4.35-9.5-9C1 8.5 3 5 6.5 5c1.74 0 3.41 1 4.5 2.5C12.09 6 13.76 5 15.5 5 19 5 21 8.5 21.5 12c-2.5 4.65-9.5 9-9.5 9z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }

  var SCACHE = 'connGraph5:';

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
    var refs = (w.referenced_works || []).map(function (u) { return String(u).replace('https://openalex.org/', ''); });
    var authors = (w.authorships || []).map(function (a) {
      return a && a.author && a.author.display_name ? a.author.display_name : null;
    }).filter(Boolean);
    return {
      oaId: w.id ? String(w.id).replace('https://openalex.org/', '') : null,
      doi: doi, title: w.display_name || '(untitled)', year: w.publication_year || null,
      cites: w.cited_by_count || 0, journal: (src && src.display_name) || '',
      tier: qualityTier(sjrForIssns(issns)), direction: direction,
      abstract: rebuildAbstract(w.abstract_inverted_index),
      refs: refs, authors: authors
    };
  }

  var SELECT = 'id,doi,display_name,publication_year,cited_by_count,primary_location,abstract_inverted_index,referenced_works,authorships';

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
        if (!refs.length) return { total: 0, nodes: [], centerRefs: [] };
        var batch = refs.slice(0, 100);
        var url = OPENALEX + '?filter=openalex_id:' + batch.join('|') + '&sort=cited_by_count:desc&per-page=' + n + '&select=' + SELECT;
        return fetch(url).then(function (r2) { if (!r2.ok) throw new Error('ref-resolve ' + r2.status); return r2.json(); })
          .then(function (d2) { return { total: refs.length, nodes: (d2.results || []).map(function (w) { return workToNode(w, 'in'); }), centerRefs: refs }; });
      });
  }

  function buildData(workId) {
    var key = SCACHE + String(workId).toLowerCase().replace(/^https?:\/\/openalex\.org\//, '');
    try { var c = sessionStorage.getItem(key); if (c) return Promise.resolve(JSON.parse(c)); } catch (e) {}
    return Promise.all([fetchCiters(workId, N_SINGLE), fetchRefs(workId, N_SINGLE)]).then(function (res) {
      var citers = res[0], refs = res[1];

      // Collect unique DOIs from both sides for the retraction batch check
      var dois = [];
      var seen = {};
      function add(arr) { arr.forEach(function (n) { if (n.doi && !seen[n.doi.toLowerCase()]) { seen[n.doi.toLowerCase()] = 1; dois.push(n.doi); } }); }
      add(citers.nodes); add(refs.nodes);

      var rcPromise = (window.RetractionCheck && window.RetractionCheck.checkBatch)
        ? window.RetractionCheck.checkBatch(dois)
        : Promise.resolve({});

      return rcPromise.then(function (rmap) {
        function mark(n) { n.retracted = !!(n.doi && rmap[n.doi]); return n; }
        citers.nodes.forEach(mark);
        refs.nodes.forEach(mark);

        // Bibliographic coupling: shared refs between each outer node and the
        // CENTER article. Computed once here so all views share the same value.
        var centerRefSet = {};
        (refs.centerRefs || []).forEach(function (r) { centerRefSet[r] = 1; });
        function countShared(node) {
          var c = 0, list = node.refs || [];
          for (var i = 0; i < list.length; i++) if (centerRefSet[list[i]]) c++;
          node.shared = c;
          // We do NOT keep `refs` on the cached node: it can be huge and we
          // only needed it for this computation.
          delete node.refs;
          return node;
        }
        citers.nodes.forEach(countShared);
        refs.nodes.forEach(countShared);

        // Mix built AFTER marking — same node objects, so retraction status carries over
        var mix = refs.nodes.slice(0, N_MIX_EACH).concat(citers.nodes.slice(0, N_MIX_EACH));
        var out = { outside: { total: citers.total, nodes: citers.nodes }, inside: { total: refs.total, nodes: refs.nodes }, mix: { nodes: mix } };
        try { sessionStorage.setItem(key, JSON.stringify(out)); } catch (e) {}
        return out;
      });
    });
  }

  function radiusFor(cites, maxCites) {
    var min = 9, max = 22;
    if (!maxCites || maxCites <= 0) return min;
    return Math.round(min + (Math.sqrt(cites) / Math.sqrt(maxCites)) * (max - min));
  }

  function renderGraph(nodes, centerStatus) {
    centerStatus = centerStatus || { retracted: false, concern: false };
    var hubFill, hubStroke, hubText, line1, line2;
    if (centerStatus.retracted) {
      hubFill = '#fbe9e9'; hubStroke = '#cc0000'; hubText = '#cc0000';
      line1 = 'RETRACTED'; line2 = '';
    } else if (centerStatus.concern) {
      hubFill = '#fff3d6'; hubStroke = '#b25c00'; hubText = '#a04a00';
      line1 = 'EXPRESSION'; line2 = 'OF CONCERN';
    } else {
      hubFill = '#B5D4F4'; hubStroke = '#185FA5'; hubText = '#0C447C';
      line1 = 'This'; line2 = 'article';
    }
    var W = 560, H = 560, cx = W / 2, cy = H / 2, ringR = 215, hubR = 44;
    var maxCites = nodes.reduce(function (m, n) { return Math.max(m, n.cites); }, 0);
    var p = [];
    p.push('<svg id="conn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block; max-width:' + W + 'px; margin:0 auto; font-family:Arial,sans-serif;">');
    p.push('<defs>' +
      '<marker id="arrOut" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#9a978d"/></marker>' +
      '<marker id="arrIn" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#185FA5"/></marker>' +
      '<marker id="arrCoup" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#005a8c"/></marker>' +
      '</defs>');

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
      // Coupling-aware styling: any shared refs at all switches the spoke to
      // accent blue (#005a8c) so it "jumps out"; thickness gradient communicates
      // strength among coupled spokes. Uncoupled spokes stay at original colors.
      var shared = n.shared || 0;
      var coupled = shared >= 1;
      var sw, strokeColor, markerSuffix;
      if (coupled) {
        if (shared >= 6)      sw = 3.0;
        else if (shared >= 3) sw = 2.3;
        else                  sw = 1.7;
        strokeColor = '#005a8c';
        markerSuffix = 'Coup';
      } else {
        sw = 1;
        strokeColor = (n.direction === 'in') ? '#c9c6bc' : '#bcd2ea';
        markerSuffix = (n.direction === 'in') ? 'Out' : 'In';
      }
      if (n.direction === 'in')
        // reference: center → node
        p.push('<line class="conn-spoke" data-idx="' + a + '" data-shared="' + shared + '" data-natural-sw="' + sw + '" x1="' + hx.toFixed(1) + '" y1="' + hy.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + strokeColor + '" stroke-width="' + sw + '" marker-end="url(#arr' + markerSuffix + ')"/>');
      else
        // citer: node → center
        p.push('<line class="conn-spoke" data-idx="' + a + '" data-shared="' + shared + '" data-natural-sw="' + sw + '" x1="' + nx.toFixed(1) + '" y1="' + ny.toFixed(1) + '" x2="' + hx.toFixed(1) + '" y2="' + hy.toFixed(1) + '" stroke="' + strokeColor + '" stroke-width="' + sw + '" marker-end="url(#arr' + markerSuffix + ')"/>');
    }
    p.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + hubR + '" fill="' + hubFill + '" stroke="' + hubStroke + '" stroke-width="1.4"/>');
    if (line2) {
      p.push('<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="11" font-weight="bold" fill="' + hubText + '">' + line1 + '</text>');
      p.push('<text x="' + cx + '" y="' + (cy + 11) + '" text-anchor="middle" font-size="11" font-weight="bold" fill="' + hubText + '">' + line2 + '</text>');
    } else {
      p.push('<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="12" font-weight="bold" fill="' + hubText + '">' + line1 + '</text>');
    }
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

  function showDetail(node, favCtx, numLabel) {
    var el = document.getElementById('conn-detail');
    if (!el) return;
    var dirLabel = node.direction === 'in' ? 'Referenced by this article' : 'Cites this article';
    var numPrefix = numLabel ? '<span style="font-family:\'IBM Plex Mono\',monospace; margin-right:8px;">' + esc(numLabel) + '</span>' : '';
    var links = [];
    if (node.doi) links.push('<a href="https://doi.org/' + esc(node.doi) + '" target="_blank" rel="noopener" style="color:#005a8c;">View article (DOI) \u2192</a>');
    if (node.oaId) links.push('<a href="https://openalex.org/' + esc(node.oaId) + '" target="_blank" rel="noopener" style="color:#005a8c;">OpenAlex \u2192</a>');
    var retractedBadge = node.retracted
      ? '<span style="display:inline-block; background:#cc0000; color:#fff; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:2px 7px; border-radius:3px; margin-right:8px; vertical-align:2px;">RETRACTED</span>'
      : '';
    var canFavorite = !!(favCtx && node.doi);
    var isFav = canFavorite && favCtx.isFav(node.doi);
    var heart = canFavorite
      ? '<button class="conn-fav-btn" data-doi="' + esc(node.doi) + '" title="' + (isFav ? 'Remove favorite' : 'Mark as favorite') + '" style="border:none; background:none; padding:0; margin-right:8px; cursor:pointer; vertical-align:-1px;">' + heartSvg(isFav, 18) + '</button>'
      : '';
    el.innerHTML =
      '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d; margin-bottom:6px;">' + numPrefix + dirLabel + '</div>' +
      '<div style="font-size:15px; font-weight:600; line-height:1.35; color:#1a1a18; margin-bottom:8px;">' + retractedBadge + heart + esc(node.title) + '</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:4px;">' + esc(node.journal || '') + (node.year ? (node.journal ? ', ' : '') + node.year : '') + '</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:10px;">' + node.cites.toLocaleString() + ' citations &#183; <span style="color:' + node.tier.text + ';">' + node.tier.label + ' quality</span> &#183; ' + ((node.shared && node.shared > 0) ? '<span style="color:#005a8c; font-weight:600;">' + node.shared + ' shared reference' + (node.shared === 1 ? '' : 's') + '</span>' : '<span>0 shared references</span>') + '</div>' +
      (links.length ? '<div style="font-size:12px; margin-bottom:12px; display:flex; gap:14px;">' + links.join('') + '</div>' : '') +
      '<div style="border-top:1px solid #e5e2d9; padding-top:10px;"><div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d; margin-bottom:6px;">Abstract</div>' +
      '<div id="conn-abstract" style="font-size:13px; line-height:1.5; color:#333;">Loading\u2026</div></div>';
    // Wire the heart button to the favorites context (if applicable)
    if (canFavorite) {
      var btn = el.querySelector('.conn-fav-btn');
      if (btn) btn.addEventListener('click', function () { favCtx.toggle(node); });
    }
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
          '<div id="conn-graphpane-inner" style="position:relative;">' +
            '<div id="conn-graphholder"></div>' +
            '<div id="conn-tip" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:5; display:none; width:230px; background:#ffffff; color:#1a1a18; font-family:\'IBM Plex Sans\',sans-serif; font-size:12px; line-height:1.4; padding:9px 12px; border:1px solid #d8d5cc; border-radius:6px; pointer-events:none; box-shadow:0 3px 12px rgba(0,0,0,0.15); -webkit-font-smoothing:antialiased; text-align:left;"></div>' +
          '</div>' +
          '<div id="conn-legend" style="display:none; font-size:11px; color:#777; margin-top:6px; text-align:center;">Size = citations &#183; color = quality &#183; <span style="color:#185FA5;">\u2192 in</span> = cites this &#183; <span style="color:#9a978d;">\u2192 out</span> = referenced by this &#183; <span style="color:#005a8c; font-weight:600;">blue spoke = shares references with this article</span></div></div>' +
        '<div id="conn-detail" style="flex:1 1 360px; min-width:300px; padding:18px; border-left:1px solid #f0eee7; min-height:300px;">' +
          '<div style="color:#999; font-size:13px; font-style:italic; padding-top:40px; text-align:center;">Click any bubble to see its details and abstract.</div></div></div>' +
      '<div id="conn-list-section" style="border-top:1px solid #f0eee7; padding:14px 18px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:14px; flex-wrap:wrap;">' +
          '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d;">Articles in this view</div>' +
          '<div style="display:flex; align-items:center; gap:14px; margin-left:auto;">' +
            '<label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#555; cursor:pointer; user-select:none;">' +
              '<input type="checkbox" id="conn-fav-toggle" style="margin:0; cursor:pointer;"> Show favorites only' +
            '</label>' +
            '<button id="conn-export-csv" style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; padding:5px 11px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;">Export CSV</button>' +
            '<button id="conn-export-ris" style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; padding:5px 11px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;" title="For Zotero, Mendeley, EndNote, RefWorks">Export RIS</button>' +
            '<button id="conn-copy-link" style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; padding:5px 11px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;">Copy link</button>' +
            '<span id="conn-export-msg" style="font-size:11px; color:#9a978d; font-style:italic; display:none;"></span>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:11px; color:#9a978d; font-style:italic; margin-bottom:8px;">Favorites are temporary — they\'ll be cleared when this panel closes.</div>' +
        '<div id="conn-list" style="max-height:360px; overflow-y:auto; border:1px solid #ececec; border-radius:4px;"></div>' +
      '</div>';

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
    var retractedRevealed = false;   // toggled by the "X retracted" link
    var currentSelected = null;       // the node currently shown in the right panel
    var visibleRows = [];             // populated by paint() — what export sees: [{node, num, isRetracted}, ...]
    // Favorites — in-memory, panel-scoped. favSet: quick membership lookup.
    // favRecords: full snapshot per fav for the eventual export.
    var favSet = {};
    var favRecords = {};
    var favoritesOnly = false;

    function isFav(doi) { return doi && !!favSet[doi.toLowerCase()]; }
    function favRecord(node) {
      return {
        doi: node.doi, oaId: node.oaId, title: node.title, journal: node.journal,
        year: node.year, citations: node.cites, qualityLabel: node.tier.label,
        direction: node.direction, retracted: !!node.retracted,
        centerDoi: doi, favoritedAt: new Date().toISOString()
      };
    }
    function toggleFav(node) {
      if (!node.doi) return;
      var key = node.doi.toLowerCase();
      if (favSet[key]) { delete favSet[key]; delete favRecords[key]; }
      else { favSet[key] = true; favRecords[key] = favRecord(node); }
      paint(currentView);  // re-render list + right panel with new heart states
    }
    var favCtx = { isFav: isFav, toggle: toggleFav };
    var currentView = 'outside';

    // ── Share link: one place that builds the URL so export and Copy-link agree ──
    // Uses the current page origin so it works on doilookup.com, github.io mirror,
    // and local previews without hard-coding the host.
    function buildShareLink() {
      // Prefer the canonical doilookup.com URL when on github.io / preview hosts;
      // on the real site, location.origin === 'https://doilookup.com' anyway.
      var origin = 'https://doilookup.com';
      try {
        var host = window.location.hostname.toLowerCase();
        if (host === 'doilookup.com' || host === 'www.doilookup.com' || host === 'localhost' || host === '127.0.0.1')
          origin = window.location.origin;
      } catch (e) { /* fallback */ }
      return origin + '/?doi=' + encodeURIComponent(doi) + '&connections=1';
    }

    // ── CSV export: rows = what's currently visible, columns include favorite flag ──
    function csvEscape(v) {
      if (v == null) return '';
      var s = String(v);
      // Quote if contains comma, quote, newline, or carriage return
      if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function buildCsv() {
      var headers = ['#', 'Title', 'Authors', 'Journal', 'Year', 'Citations', 'Shared references', 'Quality', 'Direction', 'DOI', 'Article URL', 'Retracted', 'Favorite', 'Center DOI', 'Connections link', 'Export date'];
      var lines = [headers.join(',')];
      // Single human-readable date for all rows in this export — text month avoids
      // US (MM/DD) vs EU (DD/MM) ambiguity when merging exports later.
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var d = new Date();
      var pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
      var exportDate = months[d.getMonth()] + '-' + pad2(d.getDate()) + '-' + d.getFullYear();
      var shareLink = buildShareLink();
      for (var i = 0; i < visibleRows.length; i++) {
        var r = visibleRows[i], n = r.node;
        var numLabel = r.isRetracted ? 'R' + r.num : String(r.num);
        var dirLabel = n.direction === 'in' ? 'Referenced by this article' : 'Cites this article';
        var url = n.doi ? 'https://doi.org/' + n.doi : '';
        var favKey = n.doi ? n.doi.toLowerCase() : '';
        var fav = favKey && favSet[favKey] ? 'Favorite' : '';
        var authors = (n.authors || []).join('; ');
        lines.push([
          numLabel, n.title || '', authors, n.journal || '', n.year || '',
          n.cites != null ? n.cites : '', n.shared != null ? n.shared : 0,
          n.tier ? n.tier.label : '',
          dirLabel, n.doi || '', url,
          n.retracted ? 'Yes' : 'No', fav, doi, shareLink, exportDate
        ].map(csvEscape).join(','));
      }
      return lines.join('\r\n');
    }
    function safeSlug(s) {
      return String(s || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'article';
    }
    function exportCsv() {
      var msg = document.getElementById('conn-export-msg');
      function flash(text) {
        if (!msg) return;
        msg.textContent = text; msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 2400);
      }
      if (!visibleRows.length) { flash('Nothing to export.'); return; }
      var titleForName = result.doiOrgTitle || result.raTitle || result.pubmedTitle || 'article';
      var dateStr = new Date().toISOString().slice(0, 10);
      var filename = 'connections-' + safeSlug(titleForName) + '-' + dateStr + '.csv';
      var csv = buildCsv();
      // BOM helps Excel detect UTF-8 properly
      var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flash('Exported ' + visibleRows.length + ' row' + (visibleRows.length === 1 ? '' : 's') + '.');
    }

    // ── RIS export for reference managers (Zotero, Mendeley, EndNote, RefWorks) ──
    // RIS is line-based: `TAG  - value`, with a blank line between records and ER
    // closing each one. Most fields map cleanly; we put extra context (retraction
    // status, shared-ref count, favorite flag) into N1 notes so they import as
    // a "Notes" field rather than being silently dropped.
    function buildRis() {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var d = new Date();
      var pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
      var exportDate = months[d.getMonth()] + '-' + pad2(d.getDate()) + '-' + d.getFullYear();
      function tag(t, v) {
        if (v == null || v === '') return '';
        // RIS values shouldn't contain bare line breaks; collapse whitespace.
        var s = String(v).replace(/[\r\n]+/g, ' ').trim();
        return t + '  - ' + s + '\r\n';
      }
      var records = [];
      for (var i = 0; i < visibleRows.length; i++) {
        var r = visibleRows[i], n = r.node;
        var rec = '';
        rec += tag('TY', 'JOUR');
        rec += tag('TI', n.title);
        var authors = n.authors || [];
        for (var a = 0; a < authors.length; a++) rec += tag('AU', authors[a]);
        rec += tag('JF', n.journal);  // JF = journal name (full)
        rec += tag('PY', n.year);
        rec += tag('DO', n.doi);
        if (n.doi) rec += tag('UR', 'https://doi.org/' + n.doi);
        // Compact note bundling our extra context so it survives import.
        var noteParts = [];
        var numLabel = r.isRetracted ? 'R' + r.num : '#' + r.num;
        noteParts.push(numLabel + ' in Connections for ' + doi);
        noteParts.push(n.direction === 'in' ? 'Referenced by center article' : 'Cites center article');
        if (n.cites != null) noteParts.push(n.cites + ' citations');
        if (n.tier && n.tier.label) noteParts.push(n.tier.label + ' quality');
        if (n.shared != null) noteParts.push(n.shared + ' shared refs with center');
        if (n.retracted) noteParts.push('RETRACTED');
        var favKey = n.doi ? n.doi.toLowerCase() : '';
        if (favKey && favSet[favKey]) noteParts.push('Favorite');
        noteParts.push('Exported ' + exportDate);
        rec += tag('N1', noteParts.join(' | '));
        rec += 'ER  - \r\n';
        records.push(rec);
      }
      return records.join('\r\n');
    }
    function exportRis() {
      var msg = document.getElementById('conn-export-msg');
      function flash(text) {
        if (!msg) return;
        msg.textContent = text; msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 2400);
      }
      if (!visibleRows.length) { flash('Nothing to export.'); return; }
      var titleForName = result.doiOrgTitle || result.raTitle || result.pubmedTitle || 'article';
      var dateStr = new Date().toISOString().slice(0, 10);
      var filename = 'connections-' + safeSlug(titleForName) + '-' + dateStr + '.ris';
      var ris = buildRis();
      var blob = new Blob([ris], { type: 'application/x-research-info-systems;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flash('Exported ' + visibleRows.length + ' row' + (visibleRows.length === 1 ? '' : 's') + ' to RIS.');
    }

    // ── Copy share link: writes a doilookup.com URL to the clipboard ──
    function copyLink() {
      var msg = document.getElementById('conn-export-msg');
      function flash(text) {
        if (!msg) return;
        msg.textContent = text; msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 2400);
      }
      var link = buildShareLink();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(
          function () { flash('Link copied.'); },
          function () { fallback(); }
        );
      } else {
        fallback();
      }
      function fallback() {
        // Older browsers: select a hidden textarea, execCommand('copy')
        var ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash('Link copied.'); }
        catch (e) { flash('Copy failed — long-press to copy: ' + link); }
        document.body.removeChild(ta);
      }
    }

    function renderListRow(node, num, isRetracted, isFavorited) {
      var dir = node.direction === 'in' ? 'Referenced by this article' : 'Cites this article';
      var dirColor = node.direction === 'in' ? '#7a7a73' : '#185FA5';
      var titleHref = node.doi ? 'https://doi.org/' + encodeURI(node.doi) : (node.oaId ? 'https://openalex.org/' + node.oaId : '#');
      var journalYear = node.journal && node.year ? node.journal + ', ' + node.year : (node.journal || (node.year ? String(node.year) : ''));
      var metaParts = [];
      if (journalYear) metaParts.push(esc(journalYear));
      metaParts.push(node.cites.toLocaleString() + ' citations');
      if (node.shared && node.shared > 0) {
        metaParts.push('<span style="color:#005a8c; font-weight:600;">' + node.shared + ' shared reference' + (node.shared === 1 ? '' : 's') + '</span>');
      } else {
        metaParts.push('0 shared references');
      }
      var metaHtml = metaParts.join(' \u00b7 ');
      var retractedBadge = isRetracted
        ? '<span style="display:inline-block; background:#cc0000; color:#fff; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:1px 6px; border-radius:3px; margin-right:8px; vertical-align:1px;">RETRACTED</span>'
        : '';
      var numLabel = isRetracted ? 'R' + num : String(num);
      var canFav = !!node.doi;
      var heartBtn = canFav
        ? '<button class="conn-fav-btn" data-doi="' + esc(node.doi) + '" title="' + (isFavorited ? 'Remove favorite' : 'Mark as favorite') + '" style="border:none; background:none; padding:0; margin:0 2px 0 0; cursor:pointer; line-height:1;">' + heartSvg(isFavorited, 15) + '</button>'
        : '<span style="display:inline-block; width:17px;"></span>';
      return '<div class="conn-row" data-idx="' + (isRetracted ? 'r' + num : num) + '" data-retracted="' + (isRetracted ? '1' : '0') + '" style="padding:10px 12px; border-bottom:1px solid #f0eee7; cursor:pointer; transition:background 0.12s;">' +
        '<div style="display:flex; align-items:baseline; gap:8px; line-height:1.35;">' +
          heartBtn +
          '<span style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; color:#9a978d; min-width:22px;">' + numLabel + '</span>' +
          retractedBadge +
          '<span style="font-size:11px; color:' + dirColor + '; white-space:nowrap; font-weight:500;">' + dir + '</span>' +
          '<a href="' + esc(titleHref) + '" target="_blank" rel="noopener" class="conn-row-title" style="font-size:13px; color:#005a8c; text-decoration:none; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(node.title) + '</a>' +
        '</div>' +
        '<div style="font-size:11px; color:#888780; margin-top:3px; padding-left:30px;">' + metaHtml + '</div>' +
      '</div>';
    }

    function paint(view) {
      currentView = view;
      var info = document.getElementById('conn-viewinfo'), holder = document.getElementById('conn-graphholder');
      var rawNodes, label;
      if (view === 'inside') { rawNodes = DATA.inside.nodes; label = DATA.inside.total.toLocaleString() + ' references in this article \u2014 showing top ' + rawNodes.length + ' by citations'; }
      else if (view === 'mix') { rawNodes = DATA.mix.nodes; label = 'Top references + top citing articles, combined'; }
      else { rawNodes = DATA.outside.nodes; label = DATA.outside.total.toLocaleString() + ' articles cite this \u2014 showing top ' + rawNodes.length + ' by citations'; }

      // Split raw into visible (non-retracted) and retracted
      var nodes = [], retractedNodes = [];
      for (var i = 0; i < rawNodes.length; i++) {
        if (rawNodes[i].retracted) retractedNodes.push(rawNodes[i]);
        else nodes.push(rawNodes[i]);
      }
      var retractedCount = retractedNodes.length;

      var retractedNoun;
      if (view === 'inside')      retractedNoun = 'retracted reference' + (retractedCount === 1 ? '' : 's');
      else if (view === 'mix')    retractedNoun = 'retracted in the graph';
      else                        retractedNoun = 'retracted citing article' + (retractedCount === 1 ? '' : 's');

      var retractLabelHTML;
      if (retractedCount > 0) {
        var linkText = retractedRevealed ? 'hide' : 'show';
        retractLabelHTML = '<a href="#" id="conn-retract-toggle" style="color:#005a8c; text-decoration:underline; cursor:pointer;">' + retractedCount + ' ' + esc(retractedNoun) + '</a> <span style="color:#9a978d;">(' + linkText + ')</span>';
      } else {
        retractLabelHTML = '<span style="color:#9a978d;">0 ' + esc(retractedNoun) + '</span>';
      }

      var leader = '';
      if (result._isRetracted)      leader = '<span style="color:#cc0000; font-weight:600;">This article is retracted.</span> ';
      else if (result._hasEOC)      leader = '<span style="color:#a04a00; font-weight:600;">This article has an Expression of Concern.</span> ';

      info.innerHTML = leader + esc(label) + ' \u00b7 ' + retractLabelHTML;

      var toggleEl = document.getElementById('conn-retract-toggle');
      if (toggleEl) toggleEl.addEventListener('click', function (e) {
        e.preventDefault(); retractedRevealed = !retractedRevealed; paint(view);
      });

      if (!nodes.length) {
        holder.innerHTML = '<div style="padding:30px; text-align:center; color:#999; font-style:italic;">No data for this view.</div>';
      } else {
        holder.innerHTML = renderGraph(nodes, { retracted: !!result._isRetracted, concern: !!result._hasEOC });
        document.getElementById('conn-legend').style.display = 'block';
      }

      // Build the list. Numbering is fixed per node (1..N for visible; R1..Rk
      // for retracted) — favorites-only just filters which rows are displayed,
      // it doesn't renumber.
      var listEl = document.getElementById('conn-list');
      var rows = '';
      var anyShown = false;
      visibleRows = [];                  // reset for this paint
      for (var j = 0; j < nodes.length; j++) {
        if (favoritesOnly && !isFav(nodes[j].doi)) continue;
        rows += renderListRow(nodes[j], j + 1, false, isFav(nodes[j].doi));
        visibleRows.push({ node: nodes[j], num: j + 1, isRetracted: false });
        anyShown = true;
      }
      if (retractedRevealed) for (var k = 0; k < retractedNodes.length; k++) {
        if (favoritesOnly && !isFav(retractedNodes[k].doi)) continue;
        rows += renderListRow(retractedNodes[k], k + 1, true, isFav(retractedNodes[k].doi));
        visibleRows.push({ node: retractedNodes[k], num: k + 1, isRetracted: true });
        anyShown = true;
      }
      if (!anyShown) {
        listEl.innerHTML = favoritesOnly
          ? '<div style="padding:20px; text-align:center; color:#999; font-style:italic; font-size:12px;">No favorites yet — click a <span style="color:#005a8c;">\u2665</span> to add one.</div>'
          : '<div style="padding:20px; text-align:center; color:#999; font-style:italic; font-size:12px;">No items.</div>';
      } else {
        listEl.innerHTML = rows;
      }

      // Unified selection: highlight bubble + spoke + row, show detail, auto-scroll right panel
      function select(node, listIdAttr, fromList) {
        currentSelected = node;
        holder.querySelectorAll('.conn-node circle').forEach(function (c) { c.setAttribute('stroke-width', '0.9'); });
        holder.querySelectorAll('.conn-spoke').forEach(function (s) { s.setAttribute('stroke-width', s.getAttribute('data-natural-sw') || '1'); });
        listEl.querySelectorAll('.conn-row').forEach(function (r) { r.style.background = ''; });

        if (!node.retracted) {
          var graphIdx = nodes.indexOf(node);
          var g = holder.querySelector('.conn-node[data-idx="' + graphIdx + '"]');
          if (g) {
            var c = g.querySelector('circle'); if (c) c.setAttribute('stroke-width', '3');
            var sp = holder.querySelector('.conn-spoke[data-idx="' + graphIdx + '"]'); if (sp) sp.setAttribute('stroke-width', '3.6');
          }
        }
        var row = listIdAttr ? listEl.querySelector('.conn-row[data-idx="' + listIdAttr + '"]') : null;
        if (row) row.style.background = '#eaf3fb';

        // listIdAttr is either "14" (normal) or "r3" (retracted) — format for display
        var displayNum = listIdAttr ? (listIdAttr.charAt(0) === 'r' ? 'R' + listIdAttr.slice(1) : '#' + listIdAttr) : '';
        showDetail(node, favCtx, displayNum);

        if (fromList) {
          var detail = document.getElementById('conn-detail');
          if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      // Re-show currently selected article in the right panel after a re-paint
      // (e.g., after toggling a favorite), so the heart there updates too.
      if (currentSelected) {
        // Find the selected node in the *current* nodes/retracted arrays by DOI
        // (the references could be the same object, but matching by DOI is safer)
        var match = null, listId = null;
        for (var m = 0; m < nodes.length; m++) {
          if (nodes[m].doi && currentSelected.doi && nodes[m].doi.toLowerCase() === currentSelected.doi.toLowerCase()) { match = nodes[m]; listId = String(m + 1); break; }
        }
        if (!match) for (var rm = 0; rm < retractedNodes.length; rm++) {
          if (retractedNodes[rm].doi && currentSelected.doi && retractedNodes[rm].doi.toLowerCase() === currentSelected.doi.toLowerCase()) { match = retractedNodes[rm]; listId = 'r' + (rm + 1); break; }
        }
        if (match) {
          var displayNum2 = listId ? (listId.charAt(0) === 'r' ? 'R' + listId.slice(1) : '#' + listId) : '';
          showDetail(match, favCtx, displayNum2);
          var sRow = listEl.querySelector('.conn-row[data-idx="' + listId + '"]');
          if (sRow) sRow.style.background = '#eaf3fb';
          // Re-apply graph highlight too
          if (!match.retracted) {
            var gIdx = nodes.indexOf(match);
            var gEl = holder.querySelector('.conn-node[data-idx="' + gIdx + '"]');
            if (gEl) {
              var gC = gEl.querySelector('circle'); if (gC) gC.setAttribute('stroke-width', '3');
              var gSp = holder.querySelector('.conn-spoke[data-idx="' + gIdx + '"]'); if (gSp) gSp.setAttribute('stroke-width', '3.6');
            }
          }
        }
      }

      // Wire list rows
      listEl.querySelectorAll('.conn-row').forEach(function (row) {
        row.addEventListener('click', function (e) {
          // Heart buttons handle themselves; title link too
          if (e.target.closest('.conn-fav-btn') || e.target.closest('.conn-row-title')) return;
          var idAttr = row.getAttribute('data-idx');
          var isRetracted = row.getAttribute('data-retracted') === '1';
          var nodeRef;
          if (isRetracted) {
            var rIdx = parseInt(idAttr.slice(1), 10) - 1;
            nodeRef = retractedNodes[rIdx];
          } else {
            nodeRef = nodes[parseInt(idAttr, 10) - 1];
          }
          if (nodeRef) select(nodeRef, idAttr, true);
        });
        // subtle hover background
        row.addEventListener('mouseenter', function () { if (row.style.background !== 'rgb(234, 243, 251)') row.style.background = '#f7f6f2'; });
        row.addEventListener('mouseleave', function () { if (row.style.background === 'rgb(247, 246, 242)') row.style.background = ''; });
      });

      // Wire heart buttons (rows) — find by class, look up node by DOI, toggle.
      listEl.querySelectorAll('.conn-fav-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var btnDoi = btn.getAttribute('data-doi');
          if (!btnDoi) return;
          var key = btnDoi.toLowerCase();
          // Locate the node by DOI in either nodes or retractedNodes
          var n = null;
          for (var x = 0; x < nodes.length; x++) if (nodes[x].doi && nodes[x].doi.toLowerCase() === key) { n = nodes[x]; break; }
          if (!n) for (var rx = 0; rx < retractedNodes.length; rx++) if (retractedNodes[rx].doi && retractedNodes[rx].doi.toLowerCase() === key) { n = retractedNodes[rx]; break; }
          if (n) toggleFav(n);
        });
      });

      var tip = document.getElementById('conn-tip');
      var hoverTimer = null, tipShowing = false, activeIdx = null;
      function fillTip(node) {
        var journalYear = node.journal && node.year ? truncate(node.journal, 50) + ', ' + node.year
          : (node.journal ? truncate(node.journal, 50) : (node.year ? String(node.year) : ''));
        var jyLine = journalYear ? '<div style="font-size:11px; color:#888780; margin-top:3px;">' + esc(journalYear) + '</div>' : '';
        var sharedHtml = (node.shared && node.shared > 0)
          ? '<span style="color:#005a8c; font-weight:600;">' + node.shared + ' shared reference' + (node.shared === 1 ? '' : 's') + '</span>'
          : '0 shared references';
        var citesShared = '<div style="font-size:11px; color:#888780; margin-top:3px;">' + node.cites.toLocaleString() + ' citations \u00b7 ' + sharedHtml + '</div>';
        tip.innerHTML = '<div style="font-weight:500; color:#1a1a18;">' + esc(truncate(node.title, 90)) + '</div>' + jyLine + citesShared;
      }
      function showTip() { tip.style.display = 'block'; tipShowing = true; }
      function hideTip() { tip.style.display = 'none'; tipShowing = false; }

      holder.querySelectorAll('.conn-node').forEach(function (g) {
        var idx = parseInt(g.getAttribute('data-idx'), 10);
        var circle = g.querySelector('circle');
        var baseStroke = circle.getAttribute('stroke');
        g.addEventListener('click', function () { select(nodes[idx], String(idx + 1), false); });
        g.addEventListener('mouseover', function () {
          activeIdx = idx;
          // bubble hover state: light ring (distinct from click's thick stroke)
          if (circle.getAttribute('stroke-width') !== '3') circle.setAttribute('stroke-width', '1.8');
          if (tipShowing) { fillTip(nodes[idx]); return; }
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(function () {
            if (activeIdx !== idx) return;
            fillTip(nodes[idx]); showTip();
          }, 300);
        });
        g.addEventListener('mouseout', function () {
          clearTimeout(hoverTimer);
          if (circle.getAttribute('stroke-width') !== '3') circle.setAttribute('stroke-width', '0.9');
          if (activeIdx === idx) activeIdx = null;
          setTimeout(function () { if (activeIdx === null) hideTip(); }, 10);
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
      var favChk = document.getElementById('conn-fav-toggle');
      if (favChk) favChk.addEventListener('change', function () { favoritesOnly = favChk.checked; paint(currentView); });
      var exportBtn = document.getElementById('conn-export-csv');
      if (exportBtn) exportBtn.addEventListener('click', exportCsv);
      var risBtn = document.getElementById('conn-export-ris');
      if (risBtn) risBtn.addEventListener('click', exportRis);
      var copyBtn = document.getElementById('conn-copy-link');
      if (copyBtn) copyBtn.addEventListener('click', copyLink);
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
