// lookup.js - Core DOI lookup logic for ref-lookup website
// Adapted from popup.js - no chrome extension dependencies
// Requires: doiLookup.js (window.DOILookup) and pubmedLookup-nonmodule.js (window.PubMedLookup)

// ============================================================================
// SJR CSV CACHE
// Loaded once on first lookup, then reused as an in-memory Map keyed by ISSN.
// ============================================================================
let _sjrCache = null;         // Map<issn, { sjr, sourceid, web }> once loaded
let _sjrCacheLoading = null;  // Promise while loading, to prevent parallel fetches

async function _loadSJRCache() {
  if (_sjrCache) return _sjrCache;
  if (_sjrCacheLoading) return _sjrCacheLoading;

  _sjrCacheLoading = (async () => {
    try {
      const response = await fetch('./SJR.csv');
      if (!response.ok) { _sjrCache = new Map(); return _sjrCache; }
      const csvText = await response.text();
      const lines = csvText.split('\n');
      const startIndex = lines[0].includes('Sourceid') || lines[0].includes('ISSN') ? 1 : 0;
      const map = new Map();
      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = _parseSJRCsvLine(line);
        if (cols.length < 4) continue;
        const issn1    = cols[0].trim();
        const issn2    = cols[1].trim();
        const sourceid = cols[2].trim();
        const sjrValue = parseFloat(cols[3].trim().replace(',', '.'));
        const entry = {
          sjr: isNaN(sjrValue) ? null : sjrValue.toFixed(2),
          sourceid,
          web: `https://www.scimagojr.com/journalsearch.php?q=${sourceid}&tip=sid&clean=0#:~:text=External%20Cites%20per%20Doc`,
        };
        if (issn1) map.set(issn1, entry);
        if (issn2) map.set(issn2, entry);
      }
      _sjrCache = map;
      console.log(`[SJR] Cache loaded: ${map.size} ISSN entries`);
      return _sjrCache;
    } catch (e) {
      console.warn('[SJR] Cache load failed:', e);
      _sjrCache = new Map();
      return _sjrCache;
    }
  })();

  return _sjrCacheLoading;
}

function _parseSJRCsvLine(line) {
  const res = [];
  let inQuotes = false;
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { res.push(current); current = ''; }
    else { current += ch; }
  }
  res.push(current);
  return res;
}

// Escape untrusted API strings before injecting into innerHTML
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayError(message) {
  const resultsDiv = document.getElementById('results');
  if (resultsDiv) {
    // Append error as a card instead of wiping existing results
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'background:#fff0f0; padding:20px; border:1.5px solid #cc0000; margin-bottom:16px; color:#cc0000; font-family:var(--mono,"IBM Plex Mono",monospace); font-size:13px;';
    errDiv.textContent = `Error: ${message}`;
    resultsDiv.insertAdjacentElement('afterbegin', errDiv);
  } else {
    console.error(`Error: ${message}`);
  }
}

// ============================================================================
// DOI LOOKUP FUNCTIONS
// ============================================================================

// Helper function to detect if input is a DOI
function isDOI(text) {
  // DOI patterns:
  // - Standard: 10.1234/xyz
  // - URL: https://doi.org/10.1234/xyz
  // - URL: https://dx.doi.org/10.1234/xyz
  
  const doiPatterns = [
    /^10\.\d{4,}\/\S+$/i,                                    // Standard DOI
    /^https?:\/\/doi\.org\/(10\.\d{4,}\/\S+)$/i,           // doi.org URL
    /^https?:\/\/dx\.doi\.org\/(10\.\d{4,}\/\S+)$/i        // dx.doi.org URL
  ];
  
  return doiPatterns.some(pattern => pattern.test(text));
}

// Extract clean DOI from various formats
function extractDOI(text) {
  // If it's a URL, extract the DOI part
  const urlMatch = text.match(/doi\.org\/(10\.\d{4,}\/\S+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  
  // Otherwise assume it's already a clean DOI
  return text.trim();
}

// ============================================================================
// SESSION CACHE — lives only while the tab is open, clears on tab close
// ============================================================================
const SCACHE_PREFIX = 'doi_sc_';

function _sessionCacheGet(doi) {
  try {
    const raw = sessionStorage.getItem(SCACHE_PREFIX + doi.toLowerCase());
    if (!raw) return null;
    const { data, linksHtml } = JSON.parse(raw);
    console.log(`[Session Cache] HIT for ${doi}`);
    return { data, linksHtml };
  } catch (e) { return null; }
}

function _sessionCacheSet(doi, data, linksHtml) {
  try {
    const serialisable = JSON.parse(JSON.stringify(data));
    sessionStorage.setItem(SCACHE_PREFIX + doi.toLowerCase(), JSON.stringify({
      data: serialisable,
      linksHtml
    }));
    console.log(`[Session Cache] SET for ${doi}`);
  } catch (e) {
    console.warn('[Session Cache] Failed to write:', e);
  }
}

// Handler for DOI lookup
async function handleDOILookup(doiInput) {
  const doi = extractDOI(doiInput);

  // Check session cache first — avoids re-fetching on page reload from extension
  const cached = _sessionCacheGet(doi);
  if (cached) {
    showDOIModal(cached.data, cached.linksHtml);
    return;
  }

  try {
    console.log(`[DOI Lookup] Starting lookup for: ${doi}`);

    // ── Fast pre-flight: validate DOI exists via doi.org/doiRA (1-2 seconds) ──
    // This gives the user immediate feedback and avoids a 16+ second wait on bad DOIs.
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerHTML = `<span class="spinner"></span>Validating DOI: ${doi}`;

    let raData = null;
    try {
      const raResp = await Promise.race([
        fetch(`https://doi.org/doiRA/${doi}`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
      ]);
      if (raResp.ok) raData = await raResp.json();
    } catch (e) {
      console.warn('[DOI Pre-check] RA fetch failed:', e.message);
    }

    const ra = raData?.[0]?.RA || null;
    const raError = raData?.[0]?.status === 'DOI does not exist' || raData?.[0]?.status === 'Invalid DOI';

    if (raError || (!ra && raData)) {
      // DOI definitively not found — abort immediately, no card rendered
      throw new Error(`DOI not found — please check and try again: ${doi}`);
    }

    if (!ra) {
      // doi.org unreachable (timeout/network) — warn but continue, RA fetch in performLookup will retry
      console.warn('[DOI Pre-check] Could not reach doi.org, continuing with lookup...');
    }

    // ── DOI confirmed — update status and proceed ──
    if (statusEl) statusEl.innerHTML = `<span class="spinner"></span>DOI found (${ra || 'unknown RA'}), fetching data: ${doi}`;
    console.log(`[DOI Lookup] Pre-check passed: RA = ${ra}`);
    
    // Step 1: Get DOI RA data (CrossRef, DataCite, JaLC, mEDRA, etc.)
    // Pass pre-fetched raData so performLookup can skip the duplicate RA fetch
    const doiResult = await window.DOILookup.performLookup(doi, raData);
    
    if (doiResult.error) {
      throw new Error(`Failed to fetch DOI information: ${doiResult.message}`);
    }
    
    console.log('[DOI Lookup] DOI RA data fetched successfully');
    
    // Step 2: Get PubMed data (if available)
    let pubmedResult = {};
    try {
      console.log('[DOI Lookup] Checking PubMed...');
      pubmedResult = await window.PubMedLookup.fetchPubMedData(doi);
      
      if (pubmedResult.pubmedFound) {
        console.log(`[DOI Lookup] Found in PubMed: PMID ${pubmedResult.pubmedPMID}`);
      } else {
        console.log('[DOI Lookup] Not found in PubMed');
      }
    } catch (pubmedError) {
      console.error('[DOI Lookup] PubMed fetch error (non-fatal):', pubmedError);
    }
    
    // Step 3: Merge all data
    const allData = {
      ...doiResult,
      ...pubmedResult
    };
    
    console.log('[DOI Lookup] All data fetched, checking external services...');
    if (statusEl) statusEl.innerHTML = `<span class="spinner"></span>Enriching metadata: ${doi}`;
    
    // Step 4: Check all external services BEFORE showing modal
    let linksData = null;
    try {
      linksData = await checkAllDOILinks(allData.doiOrgDoi, allData);
    } catch (linksError) {
      console.error('[DOI Lookup] Links check error (non-fatal):', linksError);
    }
    
    console.log('[DOI Lookup] All data ready, displaying modal');

    // ORCID source comparison log - remove once merge logic is finalised
    console.log('[ORCID Sources] First author:', {
      crossref:  allData.raFirstAuthorOrcid        || allData.doiOrgFirstAuthorOrcid || null,
      pubmed:    allData.pubmedAuthorFirstORCID     || null,
      openalex:  allData._oaFirstAuthorOrcid        || null,
    });
    console.log('[ORCID Sources] Last author:', {
      crossref:  allData.raLastAuthorOrcid         || allData.doiOrgLastAuthorOrcid  || null,
      pubmed:    allData.pubmedAuthorLastORCID      || null,
      openalex:  allData._oaLastAuthorOrcid         || null,
    });

    // Cache in session before displaying
    _sessionCacheSet(doi, allData, linksData);

    // Display results in modal - all data complete
    showDOIModal(allData, linksData);
    
  } catch (error) {
    console.error('[DOI Lookup] Fatal error:', error);
    throw error;
  }
}

// Show DOI results in a modal
function showDOIModal(result, linksHtml) {
  // Remove existing modal if present
  const existingModal = document.getElementById('doi-lookup-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'doi-lookup-modal';
  modal.style.cssText = `
    position: fixed;
    z-index: 10000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  // Create modal content
  const content = document.createElement('div');
  content.style.cssText = `
    background-color: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 800px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  `;
  
  // Helper function to format timestamps in human-readable format
  const formatTimestampHuman = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    try {
      const date = new Date(timestamp);
      
      // Check if valid date
      if (isNaN(date.getTime())) {
        return timestamp; // Return original if can't parse
      }
      
      // Format: "January 15, 2020 at 10:30 AM UTC"
      const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      };
      
      return date.toLocaleString('en-US', options);
    } catch (error) {
      return timestamp; // Return original if error
    }
  };
  
  // Build content HTML
  let html = '';

  // ========================================
  // SUMMARY HEADER BLOCK (no title)
  // ========================================
  const summaryTitle  = result.doiOrgTitle   || result.raTitle   || null;
  const summaryDate   = result.doiOrgPublishedDate || result.raPublishedDate || result.doiOrgEarliestTimestamp || result.pubmedPublishDate || result.pubmedYear || null;
  const summaryPublisher = result.doiOrgPublisher || result.raPublisher || null;
  const summaryJournal   = result.doiOrgJournal   || result.raJournal   || result.pubmedJournalFull || result.pubmedJournal || null;
  const summaryDoi    = result.doiOrgDoi || null;
  const summaryRa     = result.doiOrgRa  || null;
  const summaryRaDataUrl = summaryRa === 'Crossref'  ? `https://api.crossref.org/works/${summaryDoi}`  :
                           summaryRa === 'DataCite'  ? `https://api.datacite.org/dois/${summaryDoi}`   :
                           summaryRa === 'JaLC'      ? `https://api.japanlinkcenter.org/dois/${summaryDoi}` :
                           summaryRa === 'mEDRA'     ? `https://api.medra.org/metadata/${summaryDoi}`  : null;

  // Parse all ISSNs for summary — include PubMed ISSNs as fallback
  const summaryIssnRaw = result.doiOrgIssn || result.raIssn;
  let summaryIssns = [];
  if (summaryIssnRaw) {
    try {
      const arr = typeof summaryIssnRaw === 'string' && summaryIssnRaw.startsWith('[') ? JSON.parse(summaryIssnRaw) : [summaryIssnRaw];
      summaryIssns = arr.map(i => i.trim()).filter(Boolean);
    } catch (e) { summaryIssns = []; }
  }
  // Fallback: append PubMed ISSNs if RA data didn't provide any
  if (result.pubmedISSN && !summaryIssns.includes(result.pubmedISSN)) {
    summaryIssns.push(result.pubmedISSN);
  }
  if (result.pubmedESSN && !summaryIssns.includes(result.pubmedESSN)) {
    summaryIssns.push(result.pubmedESSN);
  }

  // Quality from SJR (will be computed after SJR lookup below, placeholder for now)
  // We attach it to result._sjrScore in checkAllDOILinks
  const sjrScore = result._sjrScore ? parseFloat(result._sjrScore) : null;
  const quality = sjrScore === null ? 'Quality Unknown (no SJR data)'
                : sjrScore >= 3    ? 'High Quality'
                : sjrScore >= 0.8  ? 'Good Quality'
                : 'Low Quality';
  const qualityBg     = sjrScore >= 3   ? '#d4edda' : sjrScore >= 0.8 ? '#d4edda' : '#f0f0f0';
  const qualityBorder = sjrScore >= 3   ? '#82c882' : sjrScore >= 0.8 ? '#82c882' : '#ccc';
  const qualityText   = sjrScore >= 3   ? '#2d6a2d' : sjrScore >= 0.8 ? '#2d6a2d' : '#666';

  // Source selection: pick set with most ORCIDs — RA wins ties, OpenAlex included
  const isValidTop = v => v && v !== 'N/A';
  const raFirstOrcidTop  = result.raFirstAuthorOrcid  || null;
  const raLastOrcidTop   = result.raLastAuthorOrcid   || null;
  const pmFirstOrcidTop  = result.pubmedAuthorFirstORCID || null;
  const pmLastOrcidTop   = result.pubmedAuthorLastORCID  || null;
  const oaFirstOrcidTop  = result._oaFirstAuthorOrcid || null;
  const oaLastOrcidTop   = result._oaLastAuthorOrcid  || null;
  const raScoreTop = (isValidTop(raFirstOrcidTop) ? 1 : 0) + (isValidTop(raLastOrcidTop) ? 1 : 0);
  const pmScoreTop = (isValidTop(pmFirstOrcidTop) ? 1 : 0) + (isValidTop(pmLastOrcidTop) ? 1 : 0);
  const oaScoreTop = (isValidTop(oaFirstOrcidTop) ? 1 : 0) + (isValidTop(oaLastOrcidTop) ? 1 : 0);
  // Pick source: RA wins ties with PubMed; OpenAlex wins only if it has strictly more ORCIDs
  const bestScore = Math.max(raScoreTop, pmScoreTop, oaScoreTop);
  const useOATop = oaScoreTop === bestScore && oaScoreTop > raScoreTop && oaScoreTop > pmScoreTop;
  const useRATop = !useOATop && raScoreTop >= pmScoreTop;
  const authorSourceTop = useOATop ? 'OpenAlex' : useRATop ? (result.doiOrgRa || 'RA') : 'PubMed';

  // Resolve fields from chosen source
  const topFirstFamily  = useOATop ? null : useRATop ? (result.raFirstAuthorFamily || result.doiOrgFirstAuthorFamily) : null;
  const topFirstGiven   = useOATop ? (result._oaFirstAuthorName || null) : useRATop ? (result.raFirstAuthorGiven  || result.doiOrgFirstAuthorGiven)  : (result.pubmedAuthorFirst || null);
  let   topFirstOrcid   = useOATop ? oaFirstOrcidTop : useRATop ? (result.raFirstAuthorOrcid  || result.doiOrgFirstAuthorOrcid)  : (result.pubmedAuthorFirstORCID || null);
  let   topFirstOrcidUrl= null;

  const topLastFamily   = useOATop ? null : useRATop ? (result.raLastAuthorFamily  || result.doiOrgLastAuthorFamily)  : null;
  const topLastGiven    = useOATop ? (result._oaLastAuthorName || null) : useRATop ? (result.raLastAuthorGiven   || result.doiOrgLastAuthorGiven)   : (result.pubmedAuthorLast || null);
  let   topLastOrcid    = useOATop ? oaLastOrcidTop : useRATop ? (result.raLastAuthorOrcid   || result.doiOrgLastAuthorOrcid)   : (result.pubmedAuthorLastORCID || null);
  let   topLastOrcidUrl = null;

  const topFirstAffRaw  = useOATop ? null : useRATop ? (result.raFirstAuthorAffiliation || result.doiOrgFirstAuthorAffiliation) : null;
  const topLastAffRaw   = useOATop ? null : useRATop ? (result.raLastAuthorAffiliation || result.doiOrgLastAuthorAffiliation) : null;

  // Fall back to OpenAlex ORCIDs when the chosen source doesn't have them
  if (!isValidTop(topFirstOrcid) && isValidTop(oaFirstOrcidTop)) topFirstOrcid = oaFirstOrcidTop;
  if (!isValidTop(topLastOrcid)  && isValidTop(oaLastOrcidTop))  topLastOrcid  = oaLastOrcidTop;

  // Build ORCID URLs from resolved IDs
  topFirstOrcidUrl = isValidTop(topFirstOrcid) ? `https://orcid.org/${topFirstOrcid}` : null;
  topLastOrcidUrl  = isValidTop(topLastOrcid)  ? `https://orcid.org/${topLastOrcid}`  : null;

  // Author count
  let authorCountTop = 0;
  if (result.doiOrgAuthors || result.raAuthors) {
    try {
      const arr = result.doiOrgAuthors || result.raAuthors;
      const parsed = typeof arr === 'string' ? JSON.parse(arr) : arr;
      if (Array.isArray(parsed)) authorCountTop = parsed.length;
    } catch (e) { /* leave at 0 */ }
  }
  if (authorCountTop === 0 && result.pubmedAuthorCount) {
    authorCountTop = parseInt(result.pubmedAuthorCount, 10) || 0;
  }

  // Helper to parse affiliation text
  const parseAffiliation = (raw) => {
    if (!raw || raw === 'N/A') return null;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const text = arr.map(a => typeof a === 'string' ? a : a.name || '').filter(Boolean).join(', ');
        return text || null; // Return null if array was empty or all entries were empty
      }
    } catch (e) { /* not JSON */ }
    return raw || null;
  };

  // Helper to render one author block with scores
  const authorBlockTop = (label, family, given, orcidId, orcidUrl, affiliation, metrics) => {
    const hasName  = family || given;
    const hasOrcid = isValidTop(orcidId);

    // Name
    html += '<div style="margin-bottom: 2px;">';
    html += `<span style="color: #666; font-weight: bold;">${label}:</span> `;
    html += hasName
      ? `<span style="color: #333;">${escapeHtml(given)} ${escapeHtml(family)}</span>`
      : '<span style="color: #ccc;">none</span>';
    html += '</div>';

    // ORCID
    html += '<div style="margin-bottom: 2px; margin-left: 15px;">';
    html += '<span style="color: #666;">ORCID:</span> ';
    html += hasOrcid
      ? `<span style="color: #333; font-family: monospace;">${escapeHtml(orcidId)}</span>`
      : '<span style="color: #ccc;">not available</span>';
    html += '</div>';

    // Scores
    html += '<div style="margin-bottom: 2px; margin-left: 15px;">';
    if (metrics) {
      html += `<span style="color: #333;">h-index: ${metrics.hIndex ?? 'N/A'}, i10-index: ${metrics.i10Index ?? 'N/A'}, 2yr cites: ${metrics.twoYrCites ?? 'N/A'} <span style="color: #999; font-size: 11px;">(OpenAlex via ORCID)</span></span>`;
    } else {
      html += '<span style="color: #ccc;">h-index: N/A, i10-index: N/A, 2yr cites: N/A</span>';
    }
    html += '</div>';

    // Affiliation
    html += '<div style="margin-bottom: 2px; margin-left: 15px;">';
    const affText = parseAffiliation(affiliation);
    html += affText
      ? `<span style="color: #333;">${escapeHtml(affText)}</span>`
      : '<span style="color: #ccc;">No affiliation data available</span>';
    html += '</div>';

    // PubMed | ORCID | OpenAlex links
    html += '<div style="margin-bottom: 10px; margin-left: 15px;">';
    if (hasOrcid) {
      const pubmedOrcidUrl   = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(orcidId)}[auid]`;
      const openAlexOrcidUrl = `https://openalex.org/authors/orcid:${orcidId}`;
      html += `<a href="${pubmedOrcidUrl}" target="_blank" style="color: #005a8c;">PubMed</a>`;
      html += ' | ';
      html += `<a href="${orcidUrl}" target="_blank" style="color: #005a8c;">ORCID</a>`;
      html += ' | ';
      html += `<a href="${openAlexOrcidUrl}" target="_blank" style="color: #005a8c;">OpenAlex</a>`;
    } else {
      html += '<span style="color: #ccc;">PubMed | ORCID | OpenAlex</span>';
    }
    html += '</div>';
  };

  // Use pre-fetched metrics from result._authorMetrics
  const firstMetrics = result._authorMetrics?.first || null;
  const lastMetrics  = result._authorMetrics?.last  || null;

  // Resolve affiliations - use RA first, fall back to PubMed eFetch, then PubMed XML refetch
  const pmAff = result._pubmedAffiliations || null;
  const pmEfetchFirstAff = (result.pubmedAuthorFirstAffiliations && result.pubmedAuthorFirstAffiliations.length > 0)
    ? result.pubmedAuthorFirstAffiliations.join('; ') : null;
  const pmEfetchLastAff = (result.pubmedAuthorLastAffiliations && result.pubmedAuthorLastAffiliations.length > 0)
    ? result.pubmedAuthorLastAffiliations.join('; ') : null;
  const resolvedFirstAff = parseAffiliation(topFirstAffRaw) ? topFirstAffRaw : (pmAff?.first || pmEfetchFirstAff || null);
  const resolvedLastAff  = parseAffiliation(topLastAffRaw)  ? topLastAffRaw  : (pmAff?.last  || pmEfetchLastAff  || null);

  // Update source label if PubMed affiliation fallback was used
  const usedPubMedAff = !parseAffiliation(topFirstAffRaw) || !parseAffiliation(topLastAffRaw);
  const displaySource = (usedPubMedAff && (resolvedFirstAff || resolvedLastAff)) ? `${authorSourceTop}/PubMed` : authorSourceTop;

    html += '<div style="margin-bottom: 24px; padding: 20px; background: #f8f7f3; border-left: 4px solid #005a8c;">';
  html += '<div style="font-weight: bold; color: #005a8c; font-size: 17px; margin-bottom: 14px; letter-spacing: 0.5px;">Summary</div>';

  // DOI
  if (summaryDoi) {
    let doiLine = `${summaryDoi} (<a href="https://doi.org/${summaryDoi}" target="_blank" style="color: #005a8c;">Link</a>)`;
    if (result._oaFreePdf) {
      const label = result._oaLabel || 'Free PDF';
      doiLine += ` (<a href="${result._oaFreePdf}" target="_blank" style="color: #1a7a1a;">${label}</a>)`;
    }
    html += `<div style="font-family: monospace; font-size: 17px; font-weight: bold; color: #666; margin-bottom: 8px;">${doiLine}</div>`;
  }

  // Retraction / correction banner — shown above title when update-to entries exist
  // Collect ALL distinct update entries (a retraction may appear from both publisher + retraction-watch)
  // We dedupe by DOI+type so duplicates from two sources collapse into one entry showing both sources.
  const _updateEntries = (() => {
    if (result.doiOrgRa !== 'Crossref') return [];
    const UPDATE_TYPES = ['retraction', 'correction', 'expression-of-concern', 'reinstatement', 'withdrawal'];
    const map = new Map();
    const ingest = (raw) => {
      if (!raw) return;
      try {
        const arr = JSON.parse(raw);
        for (const u of arr) {
          const t = (u['update-type'] || u.type || '').toLowerCase();
          if (!UPDATE_TYPES.includes(t)) continue;
          const key = `${(u.DOI || '').toLowerCase()}|${t}`;
          if (!map.has(key)) {
            map.set(key, { type: t, DOI: u.DOI || null, sources: [], recordIds: [], label: u.label || null, date: u.updated?.['date-time'] || null });
          }
          const entry = map.get(key);
          if (u.source && !entry.sources.includes(u.source)) entry.sources.push(u.source);
          if (u['record-id'] && !entry.recordIds.includes(String(u['record-id']))) entry.recordIds.push(String(u['record-id']));
        }
      } catch (e) { /* skip */ }
    };
    ingest(result.raUpdateTo);
    ingest(result.raUpdatedBy);
    return [...map.values()];
  })();

  // Title — strip any existing "RETRACTED: " prefix from the title itself to avoid doubling
  if (summaryTitle) {
    const cleanTitle = escapeHtml(summaryTitle.replace(/^RETRACTED:\s*/i, ''));
    const hasRetraction = _updateEntries.some(e => e.type === 'retraction');
    const titlePrefix = hasRetraction ? '<span style="color:#cc0000;">RETRACTED: </span>' : '';
    html += `<div style="font-size: 17px; font-weight: bold; color: #1a1a18; margin-bottom: 10px; line-height: 1.4;">${titlePrefix}${cleanTitle}</div>`;
  }

  // Abstract snippet — PubMed first, fall back to CrossRef, stop if neither
  {
    const rawAbstract = result.pubmedAbstract || result.raAbstract || null;
    if (rawAbstract) {
      // Strip HTML tags (CrossRef can include <jats:p> etc.) and normalise whitespace
      const plain = rawAbstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // Truncate to ~310 chars (roughly 2 lines at this font size), break at a word boundary
      const MAX = 310;
      const needsTruncation = plain.length > MAX;
      const truncated = needsTruncation
        ? plain.slice(0, MAX).replace(/\s+\S*$/, '') + '…'
        : plain;

      // Escape for use in onclick attribute
      const escaped = plain.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const moreBtn = needsTruncation
        ? ` <button onclick="(function(){const d=document.createElement('div');d.style.cssText='position:fixed;z-index:99999;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';const b=document.createElement('div');b.style.cssText='position:relative;background:#fff;padding:28px;max-width:680px;width:90%;max-height:75vh;overflow-y:auto;border:1.5px solid #d8d5cc;font-size:14px;color:#333;line-height:1.7;font-family:IBM Plex Sans,sans-serif;font-weight:300;';const c=document.createElement('button');c.textContent='\u00D7';c.style.cssText='position:absolute;top:8px;right:12px;font-size:20px;font-weight:bold;background:none;border:none;color:#999;cursor:pointer;padding:0;line-height:1;';c.onmouseover=function(){c.style.color='#333';};c.onmouseout=function(){c.style.color='#999';};c.onclick=function(){d.remove();};b.appendChild(c);const t=document.createElement('div');t.style.cssText='margin-top:8px;';t.textContent='${escaped}';b.appendChild(t);d.appendChild(b);d.onclick=function(e){if(e.target===d)d.remove();};document.body.appendChild(d);})()" style="font-family:IBM Plex Mono,monospace;font-size:11px;padding:2px 8px;background:#005a8c;color:#fff;border:none;cursor:pointer;vertical-align:middle;margin-left:4px;">full abstract</button>`
        : '';

      html += `<div style="font-size: 14px; color: #555; font-weight: 300; margin-bottom: 10px; line-height: 1.5;">${truncated}${moreBtn}</div>`;
    }
  }

  // BoB line — priority order: Retracted, Reinstated, Expression of Concern, Withdrawal, Correction
  // Retraction knocks out EOC and Correction. Reinstatement only shown if also retracted.
  // Withdrawal and Correction are independent of each other.
  {
    const has = (type) => _updateEntries.some(e => e.type === type);
    const hasRetraction = has('retraction');
    const parts = [];
    if (hasRetraction)                      parts.push('Retracted');
    if (hasRetraction && has('reinstatement')) parts.push('Reinstated');
    if (!hasRetraction && has('expression-of-concern')) parts.push('Expression of Concern');
    if (has('withdrawal'))                  parts.push('Withdrawal');
    if (!hasRetraction && has('correction')) parts.push('Correction');

    // PubMed retraction/correction status
    const pmParts = [];
    if (result.pubmedIsRetractedPublication)                         pmParts.push('Retracted Publication');
    if (result.pubmedHasRetraction && result.pubmedRetractionPMID)   pmParts.push(`Retraction in PMID:${result.pubmedRetractionPMID}`);
    else if (result.pubmedHasRetraction)                             pmParts.push('Retraction in');
    if (result.pubmedPublicationTypes?.includes('Retraction of Publication')) pmParts.push('Retraction Notice');
    if (result.pubmedHasCorrection && result.pubmedCorrectionPMID)   pmParts.push(`Erratum PMID:${result.pubmedCorrectionPMID}`);
    else if (result.pubmedHasCorrection)                             pmParts.push('Erratum');

    const formatCrossrefParts = parts.map(p =>
      p === 'Retracted' ? `<span style="color:#cc0000;">Retracted</span>` : p
    );
    const crossrefLabel = parts.length > 0 ? ` ${formatCrossrefParts.join(' | ')} (Crossref)` : ' None';

    const formatPmParts = pmParts.map(p =>
      p === 'Retracted Publication' ? `<span style="color:#cc0000;">Retraction</span>` : p
    );
    const pmStatus = formatPmParts.length > 0 ? formatPmParts.join(' | ') : (result.pubmedFound ? 'None' : 'N/A');
    html += `<div style="font-size: 17px; font-weight: bold; color: #333; margin-bottom: 6px;">Retractions/Updates:${crossrefLabel} &nbsp;|&nbsp; PubMed: ${pmStatus}</div>`;
  }

  // Quality on its own highlighted line
  {
    const _hasRetraction = _updateEntries.some(e => e.type === 'retraction') || result.pubmedIsRetractedPublication;
    const _hasEOC        = _updateEntries.some(e => e.type === 'expression-of-concern');
    result._isRetracted = _hasRetraction;
    result._hasEOC = _hasEOC;
    if (_hasRetraction) {
      html += `<div style="display: inline-block; margin-bottom: 10px; padding: 3px 12px; background: #fff0f0; border: 1px solid #cc0000; font-size: 17px; font-weight: bold; color: #cc0000;">Quality: Retracted</div>`;
    } else if (_hasEOC) {
      html += `<div style="display: inline-block; margin-bottom: 10px; padding: 3px 12px; background: #fff8e1; border: 1px solid #e07000; font-size: 17px; font-weight: bold; color: #e07000;">Quality: Expression of Concern</div>`;
    } else {
      html += `<div style="display: inline-block; margin-bottom: 10px; padding: 3px 12px; background: ${qualityBg}; border: 1px solid ${qualityBorder}; font-size: 17px; font-weight: bold; color: ${qualityText};">Quality: ${quality}</div>`;
    }
  }

  // Publish date — always show
  {
    const displayDate = summaryDate
      ? (summaryDate.length > 10 ? summaryDate.substring(0, 10) : summaryDate)
      : 'N/A';
    html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">Publish Date: ${displayDate}</div>`;
  }

  const raHomePage = summaryRa === 'Crossref'  ? `https://search.crossref.org/search/works?q=${encodeURIComponent(summaryDoi)}&from_ui=yes`
                   : summaryRa === 'DataCite'  ? `https://search.datacite.org/works/${summaryDoi}`
                   : summaryRa === 'JaLC'      ? 'https://japanlinkcenter.org/'
                   : summaryRa === 'mEDRA'     ? 'https://www.medra.org/'
                   : null;

  // RA Site | API links
  if (summaryRa) {
    html += '<div style="font-size: 17px; font-weight: bold; margin-bottom: 6px;">';
    html += `<span style="color: #555;">${summaryRa}:</span> `;
    if (raHomePage) {
      html += `<a href="${raHomePage}" target="_blank" style="color: #005a8c;">Site</a>`;
    }
    if (raHomePage && summaryRaDataUrl) html += ' | ';
    if (summaryRaDataUrl) {
      html += `<a href="${summaryRaDataUrl}" target="_blank" style="color: #005a8c;">API Data</a>`;
    }
    html += '</div>';
  }

  // Citations from all sources on one line — always show all five items
  {
    const crossRefCites = result.doiOrgCitationCount ?? result.raCitationCount ?? null;
    const oaCites       = result._openAlexCitations ?? null;
    const ssCites       = result._semSchCitations ?? null;
    const ssInfluential = result._semSchInfluential ?? null;
    const iciteCites    = result._iciteCitations ?? null;
    const rcr           = result._iciteRcr ?? null;
    const ssUrl         = result._semSchUrl || null;
    const iciteUrl      = result._iciteUrl || null;

    let semSchLabel = ssCites !== null ? String(ssCites) : 'N/A';
    if (ssCites !== null && ssInfluential !== null) semSchLabel += ` (${ssInfluential} influential)`;
    const semSchHtml = ssUrl
      ? `<a href="${ssUrl}" target="_blank" style="color: #005a8c;">Sem Sch: ${semSchLabel}</a>`
      : `Sem Sch: ${semSchLabel}`;

    const iciteLabel = iciteCites !== null ? String(iciteCites) : 'N/A';
    const iciteHtml = iciteUrl
      ? `<a href="${iciteUrl}" target="_blank" style="color: #005a8c;">iCite: ${iciteLabel}</a>`
      : `iCite: ${iciteLabel}`;

    const rcrLabel = rcr !== null ? String(rcr) : 'N/A';
    const rcrHtml = iciteUrl
      ? `<a href="${iciteUrl}" target="_blank" style="color: #005a8c;">RCR: ${rcrLabel}</a>`
      : `RCR: ${rcrLabel}`;

    const parts = [
      `CrossRef: ${crossRefCites !== null ? crossRefCites : 'N/A'}`,
      `OpenAlex: ${oaCites !== null ? oaCites : 'N/A'}`,
      semSchHtml,
      iciteHtml,
      rcrHtml,
    ];

    html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">Citations &mdash; ${parts.join(' &nbsp;|&nbsp; ')}</div>`;
  }

  // ---- Grants: PubMed first, fall back to OpenAlex ----
  // PubMed grant shape: [{ grantId, agency, country }]
  // OpenAlex grant shape: [{ agency, grantId, funderOa }]
  {
    const pmGrants  = result.pubmedGrants  || [];
    const oaGrants  = result._oaGrants     || [];

    // Prefer PubMed when available; fall back to OpenAlex
    const rawGrants  = pmGrants.length > 0 ? pmGrants : oaGrants;
    const grantSource = pmGrants.length > 0 ? 'PubMed' : (oaGrants.length > 0 ? 'OpenAlex' : null);

    // Store resolved grants on result for CSV export
    result._resolvedGrants       = rawGrants;
    result._resolvedGrantsSource = grantSource;

    if (rawGrants.length > 0) {
      // Dedupe by agency+grantId so CrossRef duplicates don't inflate the list
      const seen = new Set();
      const deduped = rawGrants.filter(g => {
        const key = `${(g.agency || '').toLowerCase()}|${(g.grantId || '').toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Group by agency for compact display
      const byAgency = new Map();
      deduped.forEach(g => {
        const agency = g.agency || 'Unknown Agency';
        if (!byAgency.has(agency)) byAgency.set(agency, []);
        if (g.grantId) byAgency.get(agency).push(g.grantId);
      });

      const parts = [];
      byAgency.forEach((ids, agency) => {
        // Link agency to its OpenAlex funder page if we have one
        const funderOaUrl = rawGrants.find(g => g.agency === agency && g.funderOa)?.funderOa || null;
        const agencyLabel = funderOaUrl
          ? `<a href="${funderOaUrl}" target="_blank" style="color:#005a8c;">${escapeHtml(agency)}</a>`
          : escapeHtml(agency);
        const idStr = ids.length > 0 ? ` <span style="font-family:monospace;font-size:13px;color:#666;">(${ids.slice(0,3).map(escapeHtml).join(', ')}${ids.length > 3 ? ` +${ids.length - 3} more` : ''})</span>` : '';
        parts.push(`${agencyLabel}${idStr}`);
      });

      html += `<div style="color:#555; font-size:17px; font-weight:bold; margin-bottom:6px;">Grants &mdash; ${parts.join(' &nbsp;|&nbsp; ')} <span style="font-size:12px;font-weight:normal;color:#999;">(${grantSource})</span></div>`;
    } else if (result.pubmedFound) {
      // In PubMed but no grants reported — show explicitly so user knows it was checked
      html += `<div style="color:#555; font-size:17px; font-weight:bold; margin-bottom:6px;">Grants &mdash; None reported <span style="font-size:12px;font-weight:normal;color:#999;">(PubMed)</span></div>`;
    }
  }

  // OpenAIRE BIP metrics line - always show, link when data is present
  {
    const pop = result._oaPopularity || 'N/A';
    const inf = result._oaInfluence  || 'N/A';
    const imp = result._oaImpulse    || 'N/A';
    const hasOpenAireData = result._oaPopularity || result._oaInfluence || result._oaImpulse;
    const openAireUrl = `https://explore.openaire.eu/search/publication?pid=${encodeURIComponent(summaryDoi)}`;
    const openAireLabel = hasOpenAireData
      ? `<a href="${openAireUrl}" target="_blank" style="color: #005a8c;">OpenAIRE</a>`
      : `OpenAIRE`;
    html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">${openAireLabel} &mdash; Popularity: ${pop} &nbsp;|&nbsp; Influence: ${inf} &nbsp;|&nbsp; Impulse: ${imp}</div>`;
  }

  // SJR + DOAJ on one line
  {
    const sjrUrl = result._sjrUrl || null;
    const sjrPart = sjrScore !== null
      ? (sjrUrl
          ? `SJR: <a href="${sjrUrl}" target="_blank" style="color: #005a8c;">${sjrScore}</a>`
          : `SJR: ${sjrScore}`)
      : `SJR: N/A`;

    let doajPart = result._doajFound === true ? `DOAJ: Yes` : `DOAJ: No`;
    if (result._doajFound === true) {
      if (result._doajApc)     doajPart += ` &nbsp;|&nbsp; APC: ${result._doajApc}`;
      if (result._doajLicence) doajPart += ` &nbsp;|&nbsp; Licence: ${result._doajLicence}`;
    }

    html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">${sjrPart} &nbsp;|&nbsp; ${doajPart}</div>`;
  }

  // Altmetric | CORE | Dimensions | Google Scholar links line - always show
  {
    const altUrl     = `https://www.altmetric.com/details/doi/${summaryDoi}`;
    const coreUrl    = `https://core.ac.uk`;
    const dimUrl     = `https://app.dimensions.ai/discover/publication?search_text=${encodeURIComponent(summaryDoi)}`;
    const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(summaryDoi)}`;
    html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">`;
    html += `<a href="${altUrl}" target="_blank" style="color: #005a8c;">Altmetric</a>`;
    html += ` &nbsp;|&nbsp; <a href="${coreUrl}" target="_blank" style="color: #005a8c;">CORE</a>`;
    html += ` &nbsp;|&nbsp; <a href="${dimUrl}" target="_blank" style="color: #005a8c;">Dimensions</a>`;
    html += ` &nbsp;|&nbsp; <a href="${scholarUrl}" target="_blank" style="color: #005a8c;">Google Scholar</a>`;
    html += `</div>`;
  }

  // PubMed summary line - always show if we have pubmed data
  if (result.pubmedFound !== undefined) {
    if (!result.pubmedFound) {
      html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">PubMed: No</div>`;
    } else {
      let pmLine = `PubMed: Yes`;
      pmLine += ` &nbsp;|&nbsp; Medline: ${result.pubmedIsMedline ? 'Yes' : 'No'}`;
      pmLine += ` &nbsp;|&nbsp; Preprint: ${result.pubmedIsPreprint ? 'Yes' : 'No'}`;
      pmLine += ` &nbsp;|&nbsp; Erratum: ${result.pubmedHasCorrection 
        ? (result.pubmedCorrectionPMID 
          ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${result.pubmedCorrectionPMID}/" target="_blank" style="color: #005a8c;">Yes (PMID:${result.pubmedCorrectionPMID})</a>` 
          : 'Yes') 
        : 'No'}`;
      pmLine += ` &nbsp;|&nbsp; Retraction: ${result.pubmedIsRetractedPublication || result.pubmedHasRetraction 
        ? (result.pubmedRetractionPMID 
          ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${result.pubmedRetractionPMID}/" target="_blank" style="color: #cc0000;">Yes (PMID:${result.pubmedRetractionPMID})</a>` 
          : '<span style="color: #cc0000;">Yes</span>') 
        : 'No'}`;
      if (result._iciteCitations !== null && result._iciteCitations !== undefined) {
        pmLine += result._iciteUrl
          ? ` &nbsp;|&nbsp; <a href="${result._iciteUrl}" target="_blank" style="color: #005a8c;">iCite Citations: ${result._iciteCitations}</a>`
          : ` &nbsp;|&nbsp; iCite Citations: ${result._iciteCitations}`;
      }
      if (result._iciteRcr !== null && result._iciteRcr !== undefined) {
        pmLine += result._iciteUrl
          ? ` &nbsp;|&nbsp; <a href="${result._iciteUrl}" target="_blank" style="color: #005a8c;">RCR: ${result._iciteRcr}</a>`
          : ` &nbsp;|&nbsp; RCR: ${result._iciteRcr}`;
      }
      html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">${pmLine}</div>`;
    }
  }

  // Authors in summary - blank line separator then first/last author blocks
  html += '<div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #d8d5cc;">';
  html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 4px;">Number of Authors: ${authorCountTop > 0 ? authorCountTop : 'unknown'} &nbsp;|&nbsp; Source: ${displaySource}</div>`;
  html += '<div style="color: #888880; font-size: 12px; font-weight: 300; margin-bottom: 10px; font-style: italic;">In academic convention, first author typically led the work, last author typically supervised.</div>';
  authorBlockTop('First Author', topFirstFamily, topFirstGiven, topFirstOrcid, topFirstOrcidUrl, resolvedFirstAff, firstMetrics);
  if (authorCountTop > 1) {
    authorBlockTop('Last Author', topLastFamily, topLastGiven, topLastOrcid, topLastOrcidUrl, resolvedLastAff, lastMetrics);
  } else {
    authorBlockTop('Last Author', null, null, null, null, null, null);
  }
  html += '</div>';

  // Publisher + Country (from ISSN portal)
  // Publisher + Country — always show
  {
    const pubLabel = summaryPublisher ? escapeHtml(summaryPublisher) : 'N/A';
    const countryLabel = result._issnCountry ? escapeHtml(result._issnCountry) : 'N/A';
    html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">Publisher: ${pubLabel} &nbsp;|&nbsp; Country: ${countryLabel}</div>`;
  }

  // Journal — always show
  {
    const journalLabel = summaryJournal ? escapeHtml(summaryJournal) : 'N/A';
    html += `<div style="color: #555; font-size: 17px; font-weight: bold; margin-bottom: 6px;">Journal: <span style="color: #1a1a18;">${journalLabel}</span></div>`;
  }

  // ISSNs with links — always show, label as print/electronic when type data is available
  {
    if (summaryIssns.length > 0) {
      // Build type lookup: ISSN -> "print" or "electronic"
      const issnTypeMap = {};
      // Source 1: CrossRef issn-type array
      if (result.raIssnType) {
        try {
          const typed = JSON.parse(result.raIssnType);
          typed.forEach(t => { if (t.value && t.type) issnTypeMap[t.value.trim()] = t.type; });
        } catch (e) { /* skip */ }
      }
      // Source 2: PubMed separate fields (fallback)
      if (result.pubmedISSN && !issnTypeMap[result.pubmedISSN]) issnTypeMap[result.pubmedISSN] = 'print';
      if (result.pubmedESSN && !issnTypeMap[result.pubmedESSN]) issnTypeMap[result.pubmedESSN] = 'electronic';

      const issnLinks = summaryIssns.map(i => {
        const typeLabel = issnTypeMap[i] ? ` (${issnTypeMap[i]})` : '';
        return `<a href="https://portal.issn.org/resource/ISSN/${i}" target="_blank" style="color: #005a8c;">${i}</a>${typeLabel}`;
      }).join(', ');
      html += `<div style="color: #555; font-size: 17px; font-weight: bold;">ISSN: ${issnLinks}</div>`;
    } else {
      html += `<div style="color: #555; font-size: 17px; font-weight: bold;">ISSN: N/A</div>`;
    }
  }

  // ---- ORCID source comparison (testing) ----
  {
    const na = '<span style="color:#ccc;">—</span>';
    const fmt = (name, orcid) => {
      const n = name ? escapeHtml(name) : na;
      const o = orcid ? `<span style="font-family:monospace;font-size:12px;color:#444;">${escapeHtml(orcid)}</span>` : na;
      return `${n} &nbsp; ${o}`;
    };

    html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #d8d5cc;">';
    html += '<div style="font-family:monospace;font-size:11px;color:#888;font-weight:normal;margin-bottom:6px;">ORCID source comparison</div>';

    // Table header
    html += '<table style="font-size:12px;border-collapse:collapse;width:100%;">';
    html += '<tr style="color:#888;">';
    html += '<td style="padding:2px 8px 4px 0;width:90px;">Source</td>';
    html += '<td style="padding:2px 8px 4px 0;">First Author &nbsp; ORCID</td>';
    html += '<td style="padding:2px 0 4px 0;">Last Author &nbsp; ORCID</td>';
    html += '</tr>';

    const rows = [
      {
        label: 'CrossRef',
        firstName: result.raFirstAuthorGiven  ? `${result.raFirstAuthorGiven} ${result.raFirstAuthorFamily||''}`.trim() : (result.doiOrgFirstAuthorGiven||null),
        firstOrcid: result.raFirstAuthorOrcid  || result.doiOrgFirstAuthorOrcid  || null,
        lastName:  result.raLastAuthorGiven   ? `${result.raLastAuthorGiven} ${result.raLastAuthorFamily||''}`.trim()  : (result.doiOrgLastAuthorGiven||null),
        lastOrcid:  result.raLastAuthorOrcid   || result.doiOrgLastAuthorOrcid   || null,
      },
      {
        label: 'PubMed',
        firstName: result.pubmedAuthorFirst  || null,
        firstOrcid: result.pubmedAuthorFirstORCID || null,
        lastName:  result.pubmedAuthorLast   || null,
        lastOrcid:  result.pubmedAuthorLastORCID  || null,
      },
      {
        label: 'OpenAlex',
        firstName: result._oaFirstAuthorName  || null,
        firstOrcid: result._oaFirstAuthorOrcid  || null,
        lastName:  result._oaLastAuthorName   || null,
        lastOrcid:  result._oaLastAuthorOrcid   || null,
      },

    ];

    rows.forEach(r => {
      html += '<tr style="vertical-align:top;border-top:1px solid #eee;">';
      html += `<td style="padding:3px 8px 3px 0;color:#666;font-weight:bold;">${r.label}</td>`;
      html += `<td style="padding:3px 8px 3px 0;">${fmt(r.firstName, r.firstOrcid)}</td>`;
      html += `<td style="padding:3px 0;">${fmt(r.lastName, r.lastOrcid)}</td>`;
      html += '</tr>';
    });

    html += '</table>';
    html += '</div>';
  }

  html += '</div>'; // Close summary block

  // ========================================
  // DETAILS SECTION - collapsed by default
  // ========================================
  html += '<details style="margin-top: 16px;">';
  html += '<summary style="font-weight: bold; color: #005a8c; font-size: 15px; cursor: pointer; user-select: none; margin-bottom: 12px;">Details</summary>';
  html += '<div style="background: #e8f4f8; padding: 20px; border-radius: 8px; margin-bottom: 25px; border: 2px solid #0066cc;">';
  
  // International DOI Foundation Section
  html += '<div style="margin-bottom: 20px;">';
  html += '<div style="font-weight: bold; color: #005a8c; margin-bottom: 8px; font-size: 15px;">International DOI Foundation (IDF)</div>';
  html += '<div style="margin-left: 15px; line-height: 1.8;">';
  
  // IDF URL
  html += '<div style="margin-bottom: 6px;">';
  html += '<span style="color: #666;">URL:</span> ';
  html += '<a href="https://www.doi.org/" target="_blank" style="color: #0066cc;">https://www.doi.org/</a>';
  html += '</div>';
  
  // DOI being looked up
  if (result.doiOrgDoi) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">DOI:</span> ';
    html += `<span style="color: #333; font-family: monospace;">${escapeHtml(result.doiOrgDoi)}</span>`;
    html += '</div>';
  }
  
  // Earliest timestamp
  if (result.doiOrgEarliestTimestamp) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Earliest Timestamp:</span> ';
    html += `<span style="color: #333;">${formatTimestampHuman(result.doiOrgEarliestTimestamp)}</span>`;
    html += '</div>';
  }
  
  // Latest timestamp
  if (result.doiOrgLatestTimestamp) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Latest Timestamp:</span> ';
    html += `<span style="color: #333;">${formatTimestampHuman(result.doiOrgLatestTimestamp)}</span>`;
    html += '</div>';
  }
  
  // Registration Agency name
  if (result.doiOrgRa) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Registration Agency:</span> ';
    html += `<span style="color: #333; font-weight: bold;">${escapeHtml(result.doiOrgRa)}</span>`;
    html += '</div>';
  }
  
  // Resolves to (URL)
  if (result.doiOrgUrl) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Resolves to:</span> ';
    html += `<a href="${result.doiOrgUrl}" target="_blank" style="color: #0066cc; word-break: break-all;">${result.doiOrgUrl}</a>`;
    html += '</div>';
  }
  
  html += '</div>'; // Close left margin div
  html += '</div>'; // Close IDF section
  
  // Article Details Section
  html += '<div style="margin-bottom: 20px;">';
  html += '<div style="font-weight: bold; color: #005a8c; margin-bottom: 8px; font-size: 15px;">Article Details</div>';
  html += '<div style="margin-left: 15px; line-height: 1.8;">';

  // RA limitation message (CNKI, ISTIC, KISTI, etc.)
  if (result.raDisplayMessage && result.raMessage) {
    html += '<div style="margin-bottom: 10px; padding: 10px 14px; background: #fff8e1; border-left: 4px solid #f5a623; color: #7a5c00;">';
    html += `<strong>Note:</strong> ${escapeHtml(result.raMessage)}`;
    if (result.raMessageUrl) {
      html += ` <a href="${result.raMessageUrl}" target="_blank" style="color: #7a5c00; text-decoration: underline;">Learn more</a>`;
    }
    if (result.raWebUrl) {
      html += ` &nbsp;|&nbsp; <a href="${result.raWebUrl}" target="_blank" style="color: #005a8c;">View on ${result.doiOrgRa} site</a>`;
    }
    html += '</div>';
  }

  // Title
  if (result.doiOrgTitle || result.raTitle) {
    const title = result.doiOrgTitle || result.raTitle;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Title:</span> ';
    html += `<span style="color: #333;">${escapeHtml(title)}</span>`;
    html += '</div>';
  }
  
  // Article Type
  if (result.doiOrgType || result.raType) {
    const type = result.doiOrgType || result.raType;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Article Type:</span> ';
    html += `<span style="color: #333;">${escapeHtml(type)}</span>`;
    html += '</div>';
  }
  
  // Journal Name
  if (result.doiOrgJournal || result.raJournal) {
    const journal = result.doiOrgJournal || result.raJournal;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Journal:</span> ';
    html += `<span style="color: #333;">${escapeHtml(journal)}</span>`;
    html += '</div>';
  }
  
  // ISSN (moved to be right after Journal)
  if (result.doiOrgIssn || result.raIssn) {
    const issnData = result.doiOrgIssn || result.raIssn;
    let issnArray = [];
    
    // Parse ISSN (could be JSON array string or plain string)
    try {
      if (typeof issnData === 'string' && issnData.startsWith('[')) {
        issnArray = JSON.parse(issnData);
      } else if (typeof issnData === 'string') {
        issnArray = [issnData];
      } else if (Array.isArray(issnData)) {
        issnArray = issnData;
      }
    } catch (e) {
      issnArray = [issnData];
    }
    
    if (issnArray.length > 0) {
      html += '<div style="margin-bottom: 6px;">';
      html += '<span style="color: #666;">ISSN:</span> ';
      
      // Display each ISSN with link to ISSN.org portal and type label
      // Reuse issnTypeMap built from CrossRef issn-type + PubMed fields
      const _detailIssnTypeMap = {};
      if (result.raIssnType) {
        try {
          const typed = JSON.parse(result.raIssnType);
          typed.forEach(t => { if (t.value && t.type) _detailIssnTypeMap[t.value.trim()] = t.type; });
        } catch (e) { /* skip */ }
      }
      if (result.pubmedISSN && !_detailIssnTypeMap[result.pubmedISSN]) _detailIssnTypeMap[result.pubmedISSN] = 'print';
      if (result.pubmedESSN && !_detailIssnTypeMap[result.pubmedESSN]) _detailIssnTypeMap[result.pubmedESSN] = 'electronic';

      const issnLinks = issnArray.map(issn => {
        const cleanIssn = issn.trim();
        const typeLabel = _detailIssnTypeMap[cleanIssn] ? ` (${_detailIssnTypeMap[cleanIssn]})` : '';
        return `<a href="https://portal.issn.org/resource/ISSN/${cleanIssn}" target="_blank" style="color: #0066cc;">${cleanIssn}</a>${typeLabel}`;
      }).join(', ');
      
      html += `<span style="color: #333;">${issnLinks}</span>`;
      
      html += '</div>';
    }
  }
  
  // Publisher
  if (result.doiOrgPublisher || result.raPublisher) {
    const publisher = result.doiOrgPublisher || result.raPublisher;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Publisher:</span> ';
    html += `<span style="color: #333;">${escapeHtml(publisher)}</span>`;
    html += '</div>';
  }
  
  // Publish Date
  if (result.doiOrgPublishedDate || result.raPublishedOnline || result.raPublishedPrint || result.raIssued) {
    const publishDate = result.doiOrgPublishedDate || result.raPublishedOnline || result.raPublishedPrint || result.raIssued;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Publish Date:</span> ';
    html += `<span style="color: #333;">${escapeHtml(publishDate)}</span>`;
    html += '</div>';
  }
  
  // Volume
  if (result.doiOrgVolume || result.raVolume) {
    const volume = result.doiOrgVolume || result.raVolume;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Volume:</span> ';
    html += `<span style="color: #333;">${escapeHtml(volume)}</span>`;
    html += '</div>';
  }
  
  // Issue
  if (result.doiOrgIssue || result.raIssue) {
    const issue = result.doiOrgIssue || result.raIssue;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Issue:</span> ';
    html += `<span style="color: #333;">${escapeHtml(issue)}</span>`;
    html += '</div>';
  }
  
  // Pages
  if (result.doiOrgPages || result.raPage) {
    const pages = result.doiOrgPages || result.raPage;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Pages:</span> ';
    html += `<span style="color: #333;">${escapeHtml(pages)}</span>`;
    html += '</div>';
  }
  
  // Citation Count
  if (result.doiOrgCitationCount || result.raCitationCount) {
    const citationCount = result.doiOrgCitationCount || result.raCitationCount;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Citation Count:</span> ';
    html += `<span style="color: #333;">${escapeHtml(citationCount)}</span>`;
    html += '</div>';
  }
  
  // Reference Count
  if (result.doiOrgReferenceCount || result.raReferencesCount) {
    const refCount = result.doiOrgReferenceCount || result.raReferencesCount;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Reference Count:</span> ';
    html += `<span style="color: #333;">${escapeHtml(refCount)}</span>`;
    html += '</div>';
  }
  
  // Language
  if (result.doiOrgLanguage || result.raLanguage) {
    const language = result.doiOrgLanguage || result.raLanguage;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Language:</span> ';
    html += `<span style="color: #333;">${escapeHtml(language)}</span>`;
    html += '</div>';
  }
  
  // Copyright
  if (result.doiOrgCopyright) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Copyright:</span> ';
    html += `<span style="color: #333;">${escapeHtml(result.doiOrgCopyright)}</span>`;
    html += '</div>';
  }
  
  html += '</div>'; // Close left margin div
  html += '</div>'; // Close Article Details section

  // Links Section
  html += '<div style="margin-bottom: 20px;">';
  html += '<div style="font-weight: bold; color: #005a8c; margin-bottom: 8px; font-size: 15px;">Links</div>';
  html += '<div style="margin-left: 15px; line-height: 1.8;">';

  if (linksHtml) {
    html += `<div id="linksContent">${linksHtml}</div>`;
  } else {
    html += '<div style="color: #999; font-style: italic;">Links unavailable</div>';
  }

  html += '</div>'; // Close left margin div
  html += '</div>'; // Close Links section
  
  html += '</div>'; // Close draft report section
  html += '</details>'; // Close Details section

  html += '</div>'; // Close Close button wrapper (removed for inline display)

  // Stamp resolved author display values onto result for CSV export
  result._displayFirstAuthorName  = [topFirstGiven, topFirstFamily].filter(Boolean).join(' ') || null;
  result._displayFirstAuthorOrcid = topFirstOrcid || null;
  result._displayLastAuthorName   = [topLastGiven,  topLastFamily ].filter(Boolean).join(' ') || null;
  result._displayLastAuthorOrcid  = topLastOrcid  || null;
  result._displayAuthorCount      = authorCountTop || 0;

  // Render inline into #results div - append card for each DOI (multi-DOI support)
  const resultsDiv = document.getElementById('results');
  if (resultsDiv) {
    const doi = result.doiOrgDoi || summaryDoi || '';

    // Register result in _allResults for CSV export (index.html scope)
    if (typeof _allResults !== 'undefined') {
      result._doi     = doi;
      _allResults.unshift(result);
    }

    // Card wrapper with stable id
    const cardId = `card-${doi.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const checkboxHtml = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:13px; color:#666;">
        <span class="card-number" style="font-family:var(--mono,'IBM Plex Mono',monospace); font-size:12px; color:#aaa;"></span>
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" checked
            onchange="onCardCheckChange('${doi.replace(/'/g, "\'")}')"
            style="width:15px; height:15px; cursor:pointer;" />
          <span>Include in group</span>
        </label>
      </div>`;

    const cardHtml = `<div id="${cardId}" style="background:white; padding:25px; border:1.5px solid #d8d5cc; margin-bottom:16px; transition: opacity 0.2s;">${checkboxHtml}${html}</div>`;
    resultsDiv.insertAdjacentHTML('afterbegin', cardHtml);
    if (typeof updateCardNumbers === 'function') updateCardNumbers();
  } else {
    // Fallback: modal for extension context
    content.innerHTML = html;
    modal.appendChild(content);
    document.body.appendChild(modal);
    document.getElementById('closeDOIModal')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }
}

/**
 * Check all external services for DOI availability
 * Returns built HTML string - all checks run before modal is shown
 */
async function checkAllDOILinks(doi, result) {
  if (!doi) return null;
  
  const fallback = { web: null, data: null };
  
  // Wrap each check so it can never reject or hang longer than 4 seconds
  const safeCheck = (fn, customFallback) => {
    const fb = customFallback !== undefined ? customFallback : fallback;
    return Promise.race([
      fn().catch(() => fb),
      new Promise(resolve => setTimeout(() => resolve(fb), 4000))
    ]);
  };
  
  // Pre-compute allIssns here so it's available for checkDOAJJournal in Promise.all below
  const issnDataEarly = result.doiOrgIssn || result.raIssn;
  let allIssnsPre = [];
  if (issnDataEarly) {
    try {
      const arr = typeof issnDataEarly === 'string' && issnDataEarly.startsWith('[') ? JSON.parse(issnDataEarly) : [issnDataEarly];
      allIssnsPre = arr.map(i => i.trim()).filter(Boolean);
    } catch (e) { allIssnsPre = []; }
  }
  // Fallback: append PubMed ISSNs if RA data didn't provide any (or to broaden matching)
  if (result.pubmedISSN && !allIssnsPre.includes(result.pubmedISSN)) {
    allIssnsPre.push(result.pubmedISSN);
  }
  if (result.pubmedESSN && !allIssnsPre.includes(result.pubmedESSN)) {
    allIssnsPre.push(result.pubmedESSN);
  }
  const firstIssnPre = allIssnsPre[0] || null;

  // SJR lookup - uses in-memory cache (loaded once, reused on subsequent lookups)
  const lookupSJR = async (issns) => {
    if (!issns || issns.length === 0) return null;
    const map = await _loadSJRCache();
    for (const issn of issns) {
      const entry = map.get(issn.trim());
      if (entry) return entry;
    }
    return null;
  };

  // PMC PDF takes priority over Unpaywall - construct directly from PMC ID if available.
  // PMC IDs are stored as "PMC12328201" - strip the prefix to get the numeric ID.
  // We use "Free PDF" as the label — users don't need to know it's from PMC.
  // Note: PMC hosts both published versions and author manuscripts; we can't easily
  // distinguish here, so we default to "Free PDF" (covers the majority of cases).
  const pmcNumeric = result.pubmedPMCID ? String(result.pubmedPMCID).replace(/^PMC/i, '') : null;
  if (pmcNumeric) {
    result._oaFreePdf = `https://pmc.ncbi.nlm.nih.gov/articles/PMC${pmcNumeric}/pdf/`;
    result._oaLabel   = 'Free PDF';
    console.log('[FreePDF] Using PMC PDF:', result._oaFreePdf);
  }

  // Run all checks in parallel - each individually capped at 4 seconds
  // NOTE: iCite data is already fetched during PubMed lookup (getICiteForSinglePMID).
  // We only call checkICite here for the web URL (store-search), but reuse existing
  // _iciteCitations and _iciteRcr from PubMed data if already present.
  const [
    crossref, datacite, openalex, semanticscholar,
    unpaywall, doaj, core, openaire, doajJournal, icite,
    oaCountry, sjrResult
  ] = await Promise.all([
    // Skip CrossRef re-fetch if RA is already CrossRef (data already fetched in DOILookup)
    result.doiOrgRa === 'Crossref'
      ? Promise.resolve({ web: null, data: `https://api.crossref.org/works/${doi}` })
      : safeCheck(() => checkCrossRef(doi)),
    safeCheck(() => checkDataCite(doi)),
    safeCheck(() => checkOpenAlex(doi, result)),
    safeCheck(() => checkSemanticScholar(doi, result)),
    safeCheck(() => checkUnpaywall(doi, result)),
    safeCheck(() => checkDOAJByDOI(doi)),
    safeCheck(() => checkCORE(doi)),
    safeCheck(() => checkOpenAIRE(doi, result)),
    safeCheck(() => checkDOAJJournal(allIssnsPre, result)),
    // iCite: only fetch web URL via store-search if PMID exists; skip data re-fetch
    safeCheck(async () => {
      if (!result.pubmedPMID) return fallback;
      const pmid = result.pubmedPMID;
      const dataUrl = `https://icite.od.nih.gov/api/pubs?pmids=${pmid}`;
      let webUrl = `https://icite.od.nih.gov/analysis?pmids=${pmid}`;
      // Only do store-search for the web URL — skip re-fetching data (already have it from PubMed step)
      try {
        const searchResp = await fetch('https://icite.od.nih.gov/iciterest/store-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userType: 'app',
            searchType: 'List of PMIDs input',
            searchRequest: {
              pubmedQueryStr: '',
              uploadedFileName: '',
              pmids: [pmid],
              activeTab: 'infl',
              papersSearch: '',
              filters: []
            }
          })
        });
        if (searchResp.ok) {
          const searchData = await searchResp.json();
          if (searchData.id) {
            webUrl = `https://icite.od.nih.gov/results?searchId=${searchData.id}`;
          }
        }
      } catch (e) { /* non-fatal */ }
      result._iciteUrl = webUrl;
      return { web: webUrl, data: dataUrl };
    }),
    // OpenAlex country lookup
    safeCheck(async () => {
      if (!firstIssnPre) return null;
      const resp = await fetch(`https://api.openalex.org/sources?filter=issn:${firstIssnPre}`);
      if (!resp.ok) return null;
      const json = await resp.json();
      return json.results?.[0]?.country_code || null;
    }),
    // SJR CSV lookup
    safeCheck(() => lookupSJR(allIssnsPre)),
  ]);
  
  // --- Static entries (no fetch needed) ---
  
  // Determine which RA owns this DOI
  const ra = result.doiOrgRa || 'Unknown';
  
  // Format DOI created date as "Jan 2022"
  let doiDateStr = '';
  const doiTimestamp = result.doiOrgEarliestTimestamp || result.doiOrgCreatedDate;
  if (doiTimestamp) {
    try {
      const d = new Date(typeof doiTimestamp === 'number' ? doiTimestamp * 1000 : doiTimestamp);
      if (!isNaN(d.getTime())) {
        doiDateStr = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }
    } catch (e) { /* skip */ }
  }
  
  // RA data URLs - only the owning RA gets a blue data link
  const raDataUrls = {
    'Crossref':  `https://api.crossref.org/works/${doi}`,
    'DataCite':  `https://api.datacite.org/dois/${doi}`,
    'JaLC':      `https://api.japanlinkcenter.org/dois/${doi}`,
    'mEDRA':     `https://api.medra.org/metadata/${doi}`
  };
  const raHomePages = {
    'Crossref':  'https://www.crossref.org/',
    'DataCite':  'https://datacite.org/',
    'JaLC':      'https://japanlinkcenter.org/top/english.html',
    'mEDRA':     'https://www.medra.org/'
  };
  const knownRAs = ['Crossref', 'DataCite', 'JaLC', 'mEDRA'];
  
  // Other RAs with no public API - name and homepage
  const otherRAs = [
    { name: 'CNKI', url: 'https://www.cnki.net/' },
    { name: 'ISTIC', url: 'http://www.chinadoi.cn/' },
    { name: 'KISTI', url: 'https://www.doi.or.kr/' },
    { name: 'Airiti', url: 'https://www.airitilibrary.com/' },
    { name: 'OP', url: 'https://op.europa.eu/' },
    { name: 'Public', url: 'https://public.resource.org/' },
    { name: 'EIDR', url: 'https://www.eidr.org/' }
  ];

  const dimensions = {
    web: 'https://app.dimensions.ai/',
    data: null,
    note: '(Free Acct for some features)',
  };
  // Test (PubMed Web): https://pubmed.ncbi.nlm.nih.gov/?term=10.1038/s41586-025-09227-0
  // Test (PubMed Data): https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=40670798&retmode=xml
  const pubmed = {
    web: result.pubmedPMID ? `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(doi)}` : null,
    data: result.pubmedPMID ? `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${result.pubmedPMID}&retmode=xml` : null,
  };
  const pmcNumericId = result.pubmedPMCID ? String(result.pubmedPMCID).replace(/^PMC/i, '') : null;
  const pmc = {
    web: pmcNumericId ? `https://pmc.ncbi.nlm.nih.gov/search/?term=${encodeURIComponent(doi)}` : null,
    data: pmcNumericId ? `https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:${pmcNumericId}&metadataPrefix=oai_dc` : null,
  };
  // ISSN for journal metrics - use pre-computed allIssnsPre/firstIssnPre from above
  const allIssns  = allIssnsPre;
  const firstIssn = firstIssnPre;

  // Test (ISSN Web): https://portal.issn.org/resource/ISSN/0028-0836
  // Data is content-negotiation only (needs Accept: application/json header) - not clickable in browser
  const issn = {
    web: firstIssn ? `https://portal.issn.org/resource/ISSN/${firstIssn}` : null,
    data: null,
  };

  // Publisher country and SJR resolved in parallel above — wire up results here
  if (oaCountry) {
    const isoCountryMap = {
      'US': 'United States', 'GB': 'United Kingdom', 'DE': 'Germany',
      'FR': 'France', 'NL': 'Netherlands', 'CH': 'Switzerland',
      'IT': 'Italy', 'ES': 'Spain', 'SE': 'Sweden', 'DK': 'Denmark',
      'NO': 'Norway', 'FI': 'Finland', 'BE': 'Belgium', 'AT': 'Austria',
      'PL': 'Poland', 'CZ': 'Czech Republic', 'HU': 'Hungary',
      'AU': 'Australia', 'NZ': 'New Zealand', 'CA': 'Canada',
      'JP': 'Japan', 'CN': 'China', 'KR': 'South Korea', 'IN': 'India',
      'BR': 'Brazil', 'MX': 'Mexico', 'AR': 'Argentina', 'CL': 'Chile',
      'RU': 'Russia', 'TR': 'Turkey', 'IL': 'Israel', 'ZA': 'South Africa',
      'SG': 'Singapore', 'MY': 'Malaysia', 'PH': 'Philippines',
      'IE': 'Ireland', 'PT': 'Portugal', 'GR': 'Greece', 'HR': 'Croatia',
    };
    result._issnCountry = isoCountryMap[oaCountry] || oaCountry;
  }
  const sjr = {
    web: sjrResult ? sjrResult.web : null,
    data: sjrResult ? sjrResult.sjr : 'N/A',
  };
  // Attach SJR score and URL to result for summary header
  result._sjrScore = sjrResult ? sjrResult.sjr : null;
  result._sjrUrl   = sjrResult ? sjrResult.web : null;
  // Attach Semantic Scholar web URL to result for citation link
  result._semSchUrl = semanticscholar.web || null;
  
  // Author ORCIDs - use same source-selection logic (RA wins ties, OpenAlex fallback)
  const raFirstOrcidLinks = result.raFirstAuthorOrcid || null;
  const raLastOrcidLinks  = result.raLastAuthorOrcid  || null;
  const pmFirstOrcidLinks = result.pubmedAuthorFirstORCID || null;
  const pmLastOrcidLinks  = result.pubmedAuthorLastORCID  || null;
  const oaFirstOrcidLinks = result._oaFirstAuthorOrcid || null;
  const oaLastOrcidLinks  = result._oaLastAuthorOrcid  || null;
  const isValidOrcid = v => v && v !== 'N/A';
  const raOrcidScoreLinks = (isValidOrcid(raFirstOrcidLinks) ? 1 : 0) + (isValidOrcid(raLastOrcidLinks) ? 1 : 0);
  const pmOrcidScoreLinks = (isValidOrcid(pmFirstOrcidLinks) ? 1 : 0) + (isValidOrcid(pmLastOrcidLinks) ? 1 : 0);
  const useRALinks = raOrcidScoreLinks >= pmOrcidScoreLinks;
  let firstOrcid = useRALinks ? raFirstOrcidLinks : pmFirstOrcidLinks;
  let lastOrcid  = useRALinks ? raLastOrcidLinks  : pmLastOrcidLinks;
  // Fall back to OpenAlex ORCIDs when the chosen source doesn't have them
  if (!isValidOrcid(firstOrcid) && isValidOrcid(oaFirstOrcidLinks)) firstOrcid = oaFirstOrcidLinks;
  if (!isValidOrcid(lastOrcid)  && isValidOrcid(oaLastOrcidLinks))  lastOrcid  = oaLastOrcidLinks;

  // Fetch OpenAlex author metrics for each author independently
  // Test: https://api.openalex.org/authors/orcid:0000-0001-5485-7727
  const fetchOpenAlexAuthorMetrics = async (orcidId) => {
    if (!orcidId || orcidId === 'N/A') return null;
    try {
      const response = await fetch(`https://api.openalex.org/authors/orcid:${orcidId}`);
      if (!response.ok) return null;
      const data = await response.json();
      return {
        hIndex:     data.summary_stats?.h_index     ?? null,
        i10Index:   data.summary_stats?.i10_index   ?? null,
        twoYrCites: data.summary_stats?.['2yr_mean_citedness'] != null
          ? parseFloat(data.summary_stats['2yr_mean_citedness']).toFixed(2)
          : null,
      };
    } catch (e) { return null; }
  };

  const [firstAuthorMetrics, lastAuthorMetrics] = await Promise.all([
    safeCheck(() => fetchOpenAlexAuthorMetrics(firstOrcid), null),
    safeCheck(() => fetchOpenAlexAuthorMetrics(lastOrcid), null)
  ]);

  // Attach metrics to result so showDOIModal can use them
  result._authorMetrics = {
    first: firstAuthorMetrics,
    last:  lastAuthorMetrics
  };

  // Fetch PubMed affiliations as fallback when RA affiliation is empty and article is in PubMed
  // REUSE data already fetched in PubMed lookup (pubmedAuthorsAll) — no duplicate eFetch call needed
  const raFirstAff = result.raFirstAuthorAffiliation || result.doiOrgFirstAuthorAffiliation || null;
  const raLastAff  = result.raLastAuthorAffiliation  || result.doiOrgLastAuthorAffiliation  || null;
  const parseAffCheck = (raw) => {
    if (!raw || raw === 'N/A') return null;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(a => typeof a === 'string' ? a : a.name || '').filter(Boolean).join(', ') || null;
    } catch (e) { /* not JSON */ }
    return raw || null;
  };
  const firstAffEmpty = !parseAffCheck(raFirstAff);
  const lastAffEmpty  = !parseAffCheck(raLastAff);

  // Reuse pubmedAuthorsAll from the PubMed eFetch step — already contains affiliations
  if (result.pubmedFound && (firstAffEmpty || lastAffEmpty) && result.pubmedAuthorsAll && result.pubmedAuthorsAll.length > 0) {
    const pmFirst = result.pubmedAuthorsAll[0];
    const pmLast  = result.pubmedAuthorsAll[result.pubmedAuthorsAll.length - 1];
    result._pubmedAffiliations = {
      first: firstAffEmpty && pmFirst.affiliations?.length > 0 ? pmFirst.affiliations.join(' ') : null,
      last:  lastAffEmpty  && pmLast.affiliations?.length  > 0 ? pmLast.affiliations.join(' ')  : null,
      usedFallback: true
    };
  }
  
  const bestOrcid = (firstOrcid && firstOrcid !== 'N/A') ? firstOrcid : ((lastOrcid && lastOrcid !== 'N/A') ? lastOrcid : null);

  const orcid = {
    web: bestOrcid ? `https://orcid.org/${bestOrcid}` : null,
    data: null,
  };
  const authorOpenAlex = {
    web: bestOrcid ? `https://api.openalex.org/authors/orcid:${bestOrcid}` : null,
    data: bestOrcid ? `https://api.openalex.org/authors/orcid:${bestOrcid}` : null,
  };
  const authorPubmed = {
    web: bestOrcid ? `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(bestOrcid)}[auid]` : null,
    data: null,
  };
  const authorSemScholar = {
    web: null,
    data: null,
  };
  
  // --- Build HTML ---
  let html = '';
  
  const row = (name, webUrl, dataUrl, suffix = '') => {
    html += '<div style="margin-bottom: 4px; white-space: nowrap;">';
    html += `<span style="color: #666; display: inline-block; width: 160px;">${name}:</span>`;
    html += webUrl ? `<a href="${webUrl}" target="_blank" style="color: #0066cc;">Web</a>` : '<span style="color: #ccc;">Web</span>';
    html += ' | ';
    html += dataUrl ? `<a href="${dataUrl}" target="_blank" style="color: #0066cc;">Data</a>` : '<span style="color: #ccc;">Data</span>';
    if (suffix) html += ` <span style="font-size: 10px; color: #999; font-style: italic;">${suffix}</span>`;
    html += '</div>';
  };
  
  const groupLabel = (title) => {
    html += `<div style="margin: 12px 0 6px 0; font-weight: bold; color: #005a8c; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 3px;">${title}</div>`;
  };
  
  // =====================
  // Group 1: DOI Resolution
  // =====================
  groupLabel('DOI Resolution');
  
  // DOI identifier + date
  html += '<div style="margin-bottom: 6px;">';
  html += `<span style="color: #333; font-family: monospace; font-size: 12px;">${doi}</span>`;
  if (doiDateStr) {
    html += ` <span style="color: #666; font-size: 11px;">(${doiDateStr})</span>`;
  }
  html += '</div>';
  
  // DOI resolves-to URL
  if (result.doiOrgUrl) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">doi.org URL:</span> ';
    html += `<a href="${result.doiOrgUrl}" target="_blank" style="color: #0066cc; word-break: break-all; font-size: 11px;">Link</a>`;
    html += '</div>';
  }
  
  // Registration Agency
  html += '<div style="margin-bottom: 8px;">';
  html += `<span style="color: #666;">Registration Agency:</span> <span style="color: #333; font-weight: bold;">${ra}</span>`;
  html += '</div>';
  
  // DOI.org - always blue
  row('DOI.org', 'https://www.doi.org/', `https://doi.org/api/handles/${doi}`);
  
  // 4 known RAs - Web links to homepage, Data blue only for owning RA
  knownRAs.forEach(raName => {
    row(raName, raHomePages[raName], ra === raName ? raDataUrls[raName] : null);
  });
  
  // Other RAs - no public API
  html += '<div style="margin-top: 8px; margin-bottom: 4px; color: #999; font-size: 11px; font-style: italic;">No API/Data available:</div>';
  html += '<div style="margin-bottom: 4px; font-size: 11px; line-height: 1.6;">';
  html += otherRAs.map(r => {
    const isCurrent = r.name === ra;
    const style = isCurrent ? 'color: #333; font-weight: bold;' : 'color: #0066cc;';
    return `<a href="${r.url}" target="_blank" style="${style} text-decoration: none;">${r.name}</a>${isCurrent ? ' ◄' : ''}`;
  }).join(', ');
  html += '</div>';
  
  // Educational context about DOI ecosystem
  html += '<div style="margin-top: 8px; padding: 6px 8px; background: #f0f4f8; border-left: 3px solid #005a8c; font-size: 10px; color: #555; line-height: 1.5;">';
  html += 'A DOI can identify any digital object — journal articles, datasets, charts, software, or reports. ';
  html += 'Crossref and DataCite together represent over 95% of all research DOIs.';
  html += '</div>';
  
  // =====================
  // Group 2: Article Metrics
  // =====================
  groupLabel('Article Metrics');
  row('Semantic Scholar', semanticscholar.web, semanticscholar.data);
  row('OpenAlex', openalex.web, openalex.data);
  row('Unpaywall', unpaywall.web, unpaywall.data);

  // Altmetric - web link only (public API discontinued, badge discontinued)
  const altmetricWeb = `https://www.altmetric.com/details/doi/${doi}`;
  row('Altmetric', altmetricWeb, null);
  row('DOAJ', doaj.web, doaj.data);
  row('CORE', core.web, core.data);
  row('OpenAIRE', openaire.web, openaire.data);
  row('Dimensions', dimensions.web, dimensions.data, '(Free Acct Required)');

  // Retraction / correction status - parsed from CrossRef update-to and updated-by fields
  // update-to:   this DOI has been retracted/corrected (a notice DOI is listed)
  // updated-by:  this DOI IS the notice (retraction/correction) for another article
  // Test DOI (retracted article): 10.1016/S0140-6736(97)11096-0
  // Test DOI (retraction notice): look up the update-to DOI of the above
  {
    const isCrossRef = result.doiOrgRa === 'Crossref';
    const UPDATE_TYPES = ['retraction', 'correction', 'expression-of-concern', 'reinstatement', 'withdrawal'];

    // Parse update-to (this article was updated/retracted)
    const parseUpdates = (raw, isNotice = false) => {
      if (!raw) return [];
      try {
        const arr = JSON.parse(raw);
        const map = new Map();
        for (const u of arr) {
          const t = (u['update-type'] || u.type || '').toLowerCase();
          if (!UPDATE_TYPES.includes(t)) continue;
          const key = `${(u.DOI || '').toLowerCase()}|${t}`;
          if (!map.has(key)) {
            map.set(key, { type: t, DOI: u.DOI || null, sources: [], recordIds: [], label: u.label || null, isNotice });
          }
          const entry = map.get(key);
          if (u.source && !entry.sources.includes(u.source)) entry.sources.push(u.source);
          if (u['record-id'] && !entry.recordIds.includes(u['record-id'])) entry.recordIds.push(u['record-id']);
        }
        return [...map.values()];
      } catch (e) { return []; }
    };

    const allUpdates = [
      ...parseUpdates(result.raUpdateTo,  false),
      ...parseUpdates(result.raUpdatedBy, true),
    ];

    html += '<div style="margin-bottom: 4px;">';
    html += '<span style="color: #666; display: inline-block; width: 160px;">Retraction Watch:</span>';

    if (!isCrossRef) {
      html += '<span style="color: #999;">Not available (non-CrossRef DOI)</span>';
    } else if (allUpdates.length === 0) {
      html += '<span style="color: #333;">None found</span> <span style="color:#999; font-size:11px;">(Source: CrossRef)</span>';
    } else {
      html += '<span>';
      allUpdates.forEach((entry, i) => {
        if (i > 0) html += ' &nbsp;';
        const isRetract  = entry.type === 'retraction';
        const rwColor    = isRetract ? '#cc0000' : '#e07000';
        const typeLabel  = (entry.label || entry.type).charAt(0).toUpperCase() + (entry.label || entry.type).slice(1).replace(/-/g, ' ');
        const srcLabel   = entry.sources.length > 0
          ? entry.sources.map(s => s === 'retraction-watch' ? 'RW' : s.charAt(0).toUpperCase() + s.slice(1)).join('+')
          : 'CrossRef';
        const rwRecordId = entry.recordIds[0] || null;
        const rwCsvUrl   = rwRecordId ? `https://api.labs.crossref.org/data/retractionwatch?${rwRecordId}` : null;
        const prefix     = entry.isNotice ? 'This DOI is a ' : '';

        const linkText = `⚠ ${prefix}${typeLabel}`;
        html += entry.DOI
          ? `<a href="https://doi.org/${entry.DOI}" target="_blank" style="color:${rwColor}; font-weight:bold;">${linkText}</a>`
          : `<span style="color:${rwColor}; font-weight:bold;">${linkText}</span>`;
        html += ` <span style="color:#999; font-size:11px;">(${srcLabel}`;
        if (rwCsvUrl) html += ` <a href="${rwCsvUrl}" target="_blank" style="color:#999;">#${rwRecordId}</a>`;
        html += ')</span>';
      });
      html += '</span>';
    }
    html += '</div>';
  }

  row('PubMed', pubmed.web, pubmed.data);
  
  // PubMed attribute rows - Yes/No value, Data always greyed out
  const attrRow = (name, value) => {
    html += '<div style="margin-bottom: 4px;">';
    html += `<span style="color: #666; display: inline-block; width: 160px;">${name}:</span>`;
    html += `<span style="color: #333;">${value}</span>`;
    html += ' | ';
    html += '<span style="color: #ccc;">Data</span>';
    html += '</div>';
  };
  attrRow('PubMed: Full Text Free', result.pubmedFullTextFree === true || result.pubmedFullTextFree === 'true' ? 'Yes' : 'No');
  attrRow('PubMed: Medline', result.pubmedIsMedline === true || result.pubmedIsMedline === 'true' ? 'Yes' : 'No');
  attrRow('PubMed: Preprint', result.pubmedIsPreprint === true || result.pubmedIsPreprint === 'true' ? 'Yes' : 'No');
  
  row('PMC', pmc.web, pmc.data);
  row('iCite', icite.web, icite.data);
  
  // =====================
  // Group 3: Journal Metrics
  // =====================
  groupLabel('Journal Metrics');
  row('ISSN', issn.web, issn.data);
  row('DOAJ', doaj.web, doaj.data);
  // SJR - web links to charts page, data shows score as plain value (not a link)
  html += '<div style="margin-bottom: 4px;">';
  html += '<span style="color: #666; display: inline-block; width: 160px;">SJR:</span>';
  html += sjr.web
    ? `<a href="${sjr.web}" target="_blank" style="color: #0066cc;">Web</a>`
    : '<span style="color: #ccc;">Web</span>';
  html += ' | ';
  html += sjr.data && sjr.data !== 'N/A'
    ? `<span style="color: #333;">${sjr.data}</span>`
    : '<span style="color: #ccc;">N/A</span>';
  html += '</div>';
  row('OpenAlex', openalex.web, openalex.data);
  
  return html;
}

// Test: https://api.crossref.org/works/10.1038/s41586-025-09227-0
async function checkCrossRef(doi) {
  const url = `https://api.crossref.org/works/${doi}`;
  try {
    const response = await fetch(url);
    return { web: null, data: response.ok ? url : null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://api.datacite.org/dois/10.5438/0012
async function checkDataCite(doi) {
  const apiUrl = `https://api.datacite.org/dois/${doi}`;
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      return { web: `https://search.datacite.org/works/${doi}`, data: apiUrl };
    }
    return { web: null, data: null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test (article in OpenAlex): https://api.openalex.org/works/https://doi.org/10.3390/children12050616
// Test (article in OpenAlex): https://api.openalex.org/works/https://doi.org/10.1038/s41586-025-09227-0
async function checkOpenAlex(doi, result) {
  const apiUrl = `https://api.openalex.org/works/https://doi.org/${doi}`;
  const webUrl = `https://openalex.org/works?filter=doi:https://doi.org/${encodeURIComponent(doi)}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return { web: null, data: null };
    const data = await response.json();
    if (result) {
      result._openAlexCitations = data.cited_by_count ?? null;

      // Extract first/last author ORCIDs from authorships array
      // Each authorship: { author: { id, display_name, orcid }, author_position, ... }
      const authorships = data.authorships || [];
      if (authorships.length > 0) {
        const first = authorships[0].author;
        const last  = authorships[authorships.length - 1].author;
        // OpenAlex returns full ORCID URL e.g. "https://orcid.org/0000-0001-5485-7727"
        result._oaFirstAuthorOrcid = first?.orcid ? first.orcid.replace('https://orcid.org/', '') : null;
        result._oaLastAuthorOrcid  = last?.orcid  ? last.orcid.replace('https://orcid.org/', '')  : null;
        result._oaFirstAuthorName  = first?.display_name || null;
        result._oaLastAuthorName   = last?.display_name  || null;
      }

      // Extract grants from OpenAlex
      // Shape: [{ funder, funder_display_name, award_id }]
      // Test: https://api.openalex.org/works/https://doi.org/10.1038/s41586-025-09227-0
      const oaGrants = data.grants || [];
      if (oaGrants.length > 0) {
        result._oaGrants = oaGrants.map(g => ({
          agency:   g.funder_display_name || g.funder || null,
          grantId:  g.award_id            || null,
          funderOa: g.funder              || null,   // OpenAlex funder entity URL for linking
        }));
      }
    }
    return { web: webUrl, data: apiUrl };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://api.semanticscholar.org/graph/v1/paper/DOI:10.1016/S0140-6736(24)02679-5?fields=citationCount,influentialCitationCount,url
async function checkSemanticScholar(doi, result) {
  const fields = 'citationCount,influentialCitationCount,url';
  const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=${fields}`;
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      const data = await response.json();
      if (result) {
        result._semSchCitations   = data.citationCount ?? null;
        result._semSchInfluential = data.influentialCitationCount ?? null;
      }
      const webUrl = data.url || null;
      return { web: webUrl, data: apiUrl };
    }
    return { web: null, data: null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://api.unpaywall.org/v2/10.1016/S0140-6736(24)02679-5?email=pubmedcitationbar@gmail.com
async function checkUnpaywall(doi, result) {
  const UNPAYWALL_EMAIL = 'pubmedcitationbar@gmail.com'; // TODO: replace with dedicated app email
  const apiUrl = `https://api.unpaywall.org/v2/${doi}?email=${UNPAYWALL_EMAIL}`;
  const webUrl = 'https://unpaywall.org/products/simple-query-tool';
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return { web: null, data: null };
    const data = await response.json();

    // PMC is set before this runs and takes priority - only fill in if not already set
    if (data.is_oa && result && !result._oaFreePdf) {
      const loc = data.best_oa_location || null;
      if (loc) {
        if (loc.url_for_pdf) {
          result._oaFreePdf = loc.url_for_pdf;
          result._oaLabel   = (loc.version === 'publishedVersion') ? 'Free PDF' : 'Free Manuscript';
        } else if (loc.host_type === 'repository' && loc.url) {
          // Repository landing page with no direct PDF link
          result._oaFreePdf = loc.url;
          result._oaLabel   = (loc.version === 'publishedVersion') ? 'Free PDF' : 'Free Manuscript';
        }
      }
      console.log('[Unpaywall] is_oa:', data.is_oa, '| host_type:', loc?.host_type,
        '| url_for_pdf:', loc?.url_for_pdf || 'none', '| label:', result._oaLabel || 'none');
    }
    return { web: webUrl, data: apiUrl };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test (article in DOAJ): https://doaj.org/api/v2/search/articles/doi:10.3390/children12050616
// Test (article NOT in DOAJ): https://doaj.org/api/v2/search/articles/doi:10.1016/S0140-6736(24)02679-5
async function checkDOAJByDOI(doi) {
  const apiUrl = `https://doaj.org/api/v2/search/articles/doi:${doi}`;
  const searchQuery = `{"query":{"query_string":{"query":"${doi}","default_operator":"AND"}}}`;
  const webUrl = `https://doaj.org/search/articles?source=${encodeURIComponent(searchQuery)}`;
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      const data = await response.json();
      const found = data && data.total && data.total > 0;
      return { web: found ? webUrl : null, data: found ? apiUrl : null };
    }
    return { web: null, data: null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://api.core.ac.uk/v3/search/outputs/?q=doi:%2210.1016/S0140-6736(24)02679-5%22
async function checkCORE(doi) {
  const apiUrl = `https://api.core.ac.uk/v3/search/outputs/?q=doi:%22${encodeURIComponent(doi)}%22`;
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      const data = await response.json();
      if (data && data.totalHits && data.totalHits > 0) {
        // Use first result's display link for direct paper page
        const firstResult = data.results[0];
        const displayLink = firstResult.links && firstResult.links.find(l => l.type === 'display');
        const webUrl = displayLink ? displayLink.url : `https://core.ac.uk/outputs/${firstResult.id}`;
        return { web: webUrl, data: apiUrl };
      }
    }
    return { web: null, data: null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://api.openaire.eu/search/publications?doi=10.1016/S0140-6736(24)02679-5&format=json
async function checkDOAJJournal(issns, result) {
  if (!issns || issns.length === 0) return;
  try {
    // Try each ISSN until we get a hit
    for (const issn of issns) {
      const clean = issn.replace(/-/g, '');
      const hyphenated = clean.length === 8 ? `${clean.slice(0,4)}-${clean.slice(4)}` : issn;
      const response = await fetch(`https://doaj.org/api/v2/search/journals/issn:${hyphenated}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.total > 0 && data.results?.[0]) {
        const j = data.results[0].bibjson;
        // APC
        const apcAllowed = j?.apc?.has_apc;
        const apcAmount  = j?.apc?.max?.[0];
        const apcStr = apcAllowed === false ? 'None'
                     : apcAmount  ? `${apcAmount.currency} ${apcAmount.price?.toLocaleString()}`
                     : 'Unknown';
        // Licence
        const lic = j?.license?.[0]?.type || j?.license?.[0]?.title || null;
        if (result) {
          result._doajFound   = true;
          result._doajApc     = apcStr;
          result._doajLicence = lic;
        }
        return;
      }
    }
    // No ISSN matched
    if (result) result._doajFound = false;
  } catch (e) {
    console.warn('[DOAJ Journal] fetch failed:', e);
    if (result) result._doajFound = false;
  }
}

// Test: https://api.openaire.eu/search/publications?doi=10.1016/S0140-6736(24)02679-5&format=json
async function checkOpenAIRE(doi, result) {
  const apiUrl = `https://api.openaire.eu/search/publications?doi=${encodeURIComponent(doi)}&format=json`;
  const webUrl = `https://explore.openaire.eu/search/publication?pid=${encodeURIComponent(doi)}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return { web: null, data: null };
    const data = await response.json();

    // Navigate to measure array
    const oafResult = data?.response?.results?.result?.[0]?.metadata?.['oaf:entity']?.['oaf:result'];
    const measures  = oafResult?.measure || [];

    if (result && measures.length > 0) {
      const classMap = { C1: 'Top 1%', C2: 'Top 10%', C3: 'Top 25%', C4: 'Top 50%', C5: 'Bottom 50%' };
      const get = (id) => {
        const m = measures.find(m => m['@id'] === id);
        return m ? (classMap[m['@class']] || m['@class']) : null;
      };
      result._oaPopularity = get('popularity');
      result._oaInfluence  = get('influence');
      result._oaImpulse    = get('impulse');
    }

    return { web: webUrl, data: apiUrl };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://icite.od.nih.gov/api/pubs?pmids=29303484
async function checkICite(pmid, result) {
  if (!pmid) return { web: null, data: null };
  const dataUrl = `https://icite.od.nih.gov/api/pubs?pmids=${pmid}`;
  const fallbackWebUrl = `https://icite.od.nih.gov/analysis?pmids=${pmid}`;
  try {
    const dataResp = await fetch(dataUrl);
    if (dataResp.ok && result) {
      const data = await dataResp.json();
      const pub = data.data?.[0] || null;
      if (pub) {
        result._iciteCitations = pub.citation_count ?? null;
        result._iciteRcr       = pub.relative_citation_ratio != null
          ? parseFloat(pub.relative_citation_ratio).toFixed(2)
          : null;
      }
    }

    // Get the real results URL via store-search POST
    let webUrl = fallbackWebUrl;
    try {
      const searchResp = await fetch('https://icite.od.nih.gov/iciterest/store-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userType: 'app',
          searchType: 'List of PMIDs input',
          searchRequest: {
            pubmedQueryStr: '',
            uploadedFileName: '',
            pmids: [pmid],
            activeTab: 'infl',
            papersSearch: '',
            filters: []
          }
        })
      });
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        if (searchData.id) {
          webUrl = `https://icite.od.nih.gov/results?searchId=${searchData.id}`;
        }
      }
    } catch (e) {
      console.warn('[iCite] store-search failed (non-fatal):', e.message);
    }

    if (result) result._iciteUrl = webUrl;
    return { web: webUrl, data: dataUrl };
  } catch (error) {
    return { web: fallbackWebUrl, data: dataUrl };
  }
}



