// lookup.js - Core DOI lookup logic for doi-lookup website
// Adapted from popup.js - no chrome extension dependencies
// Requires: doiLookup.js (window.DOILookup) and pubmedLookup-nonmodule.js (window.PubMedLookup)

function displayError(message) {
  const resultsDiv = document.getElementById('results');
  if (resultsDiv) {
    resultsDiv.style.color = 'red';
    resultsDiv.textContent = `Error: ${message}`;
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

// Handler for DOI lookup
async function handleDOILookup(doiInput) {
  const doi = extractDOI(doiInput);
  
  try {
    console.log(`[DOI Lookup] Starting lookup for: ${doi}`);
    
    // Step 1: Get DOI RA data (CrossRef, DataCite, JaLC, mEDRA, etc.)
    const doiResult = await window.DOILookup.performLookup(doi);
    
    if (doiResult.error) {
      displayError(`Failed to fetch DOI information: ${doiResult.message}`);
      return;
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
      // Non-fatal - continue with just DOI data
    }
    
    // Step 3: Merge all data
    const allData = {
      ...doiResult,
      ...pubmedResult
    };
    
    console.log('[DOI Lookup] All data fetched, checking external services...');
    
    // Step 4: Check all external services BEFORE showing modal
    let linksData = null;
    try {
      linksData = await checkAllDOILinks(allData.doiOrgDoi, allData);
    } catch (linksError) {
      console.error('[DOI Lookup] Links check error (non-fatal):', linksError);
    }
    
    console.log('[DOI Lookup] All data ready, displaying modal');
    
    // Display results in modal - all data complete
    showDOIModal(allData, linksData);
    
  } catch (error) {
    console.error('[DOI Lookup] Fatal error:', error);
    displayError(`Failed to fetch DOI information: ${error.message}`);
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
  let html = '<h2 style="margin-top: 0; color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">DOI Lookup Results</h2>';
  
  // ========================================
  // DRAFT REPORT SECTION (User-Facing)
  // ========================================
  html += '<div style="background: #e8f4f8; padding: 20px; border-radius: 8px; margin-bottom: 25px; border: 2px solid #0066cc;">';
  html += '<div style="font-weight: bold; color: #0066cc; margin-bottom: 15px; font-size: 18px; border-bottom: 1px solid #0066cc; padding-bottom: 8px;">📋 Draft Report (User-Facing)</div>';
  
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
    html += `<span style="color: #333; font-family: monospace;">${result.doiOrgDoi}</span>`;
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
    html += `<span style="color: #333; font-weight: bold;">${result.doiOrgRa}</span>`;
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
  
  // Title
  if (result.doiOrgTitle || result.raTitle) {
    const title = result.doiOrgTitle || result.raTitle;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Title:</span> ';
    html += `<span style="color: #333;">${title}</span>`;
    html += '</div>';
  }
  
  // Article Type
  if (result.doiOrgType || result.raType) {
    const type = result.doiOrgType || result.raType;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Article Type:</span> ';
    html += `<span style="color: #333;">${type}</span>`;
    html += '</div>';
  }
  
  // Journal Name
  if (result.doiOrgJournal || result.raJournal) {
    const journal = result.doiOrgJournal || result.raJournal;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Journal:</span> ';
    html += `<span style="color: #333;">${journal}</span>`;
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
      
      // Display each ISSN with link to ISSN.org portal
      const issnLinks = issnArray.map(issn => {
        const cleanIssn = issn.trim();
        return `<a href="https://portal.issn.org/resource/ISSN/${cleanIssn}" target="_blank" style="color: #0066cc;">${cleanIssn}</a>`;
      }).join(', ');
      
      html += `<span style="color: #333;">${issnLinks}</span>`;
      
      // Add DOAJ check indicator (will check automatically using public API)
      html += ' <span id="doajCheck" style="color: #999; font-size: 11px;">(checking DOAJ...)</span>';
      
      html += '</div>';
      
      // Store ISSN for DOAJ check
      window.currentDOILookupISSN = issnArray[0];
    }
  }
  
  // Publisher
  if (result.doiOrgPublisher || result.raPublisher) {
    const publisher = result.doiOrgPublisher || result.raPublisher;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Publisher:</span> ';
    html += `<span style="color: #333;">${publisher}</span>`;
    html += '</div>';
  }
  
  // Publish Date
  if (result.doiOrgPublishedDate || result.raPublishedOnline || result.raPublishedPrint || result.raIssued) {
    const publishDate = result.doiOrgPublishedDate || result.raPublishedOnline || result.raPublishedPrint || result.raIssued;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Publish Date:</span> ';
    html += `<span style="color: #333;">${publishDate}</span>`;
    html += '</div>';
  }
  
  // Volume
  if (result.doiOrgVolume || result.raVolume) {
    const volume = result.doiOrgVolume || result.raVolume;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Volume:</span> ';
    html += `<span style="color: #333;">${volume}</span>`;
    html += '</div>';
  }
  
  // Issue
  if (result.doiOrgIssue || result.raIssue) {
    const issue = result.doiOrgIssue || result.raIssue;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Issue:</span> ';
    html += `<span style="color: #333;">${issue}</span>`;
    html += '</div>';
  }
  
  // Pages
  if (result.doiOrgPages || result.raPage) {
    const pages = result.doiOrgPages || result.raPage;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Pages:</span> ';
    html += `<span style="color: #333;">${pages}</span>`;
    html += '</div>';
  }
  
  // Citation Count
  if (result.doiOrgCitationCount || result.raCitationCount) {
    const citationCount = result.doiOrgCitationCount || result.raCitationCount;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Citation Count:</span> ';
    html += `<span style="color: #333;">${citationCount}</span>`;
    html += '</div>';
  }
  
  // Reference Count
  if (result.doiOrgReferenceCount || result.raReferencesCount) {
    const refCount = result.doiOrgReferenceCount || result.raReferencesCount;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Reference Count:</span> ';
    html += `<span style="color: #333;">${refCount}</span>`;
    html += '</div>';
  }
  
  // Language
  if (result.doiOrgLanguage || result.raLanguage) {
    const language = result.doiOrgLanguage || result.raLanguage;
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Language:</span> ';
    html += `<span style="color: #333;">${language}</span>`;
    html += '</div>';
  }
  
  // Copyright
  if (result.doiOrgCopyright) {
    html += '<div style="margin-bottom: 6px;">';
    html += '<span style="color: #666;">Copyright:</span> ';
    html += `<span style="color: #333;">${result.doiOrgCopyright}</span>`;
    html += '</div>';
  }
  
  html += '</div>'; // Close left margin div
  html += '</div>'; // Close Article Details section

  // ========================================
  // AUTHORS SECTION (middle - full detail with scores)
  // ========================================
  html += '<div style="margin-bottom: 20px;">';
  html += '<div style="font-weight: bold; color: #005a8c; margin-bottom: 8px; font-size: 15px;">Authors</div>';
  html += '<div style="margin-left: 15px; line-height: 1.8;">';

  // Source selection: pick set with most ORCIDs, RA wins ties
  const isValidTop = v => v && v !== 'N/A';
  const raFirstOrcidTop  = result.raFirstAuthorOrcid  || null;
  const raLastOrcidTop   = result.raLastAuthorOrcid   || null;
  const pmFirstOrcidTop  = result.pubmedAuthorFirstORCID || null;
  const pmLastOrcidTop   = result.pubmedAuthorLastORCID  || null;
  const raScoreTop = (isValidTop(raFirstOrcidTop) ? 1 : 0) + (isValidTop(raLastOrcidTop) ? 1 : 0);
  const pmScoreTop = (isValidTop(pmFirstOrcidTop) ? 1 : 0) + (isValidTop(pmLastOrcidTop) ? 1 : 0);
  const useRATop = raScoreTop >= pmScoreTop;
  const authorSourceTop = useRATop ? (result.doiOrgRa || 'RA') : 'PubMed';

  // Resolve fields from chosen source
  const topFirstFamily  = useRATop ? (result.raFirstAuthorFamily || result.doiOrgFirstAuthorFamily) : null;
  const topFirstGiven   = useRATop ? (result.raFirstAuthorGiven  || result.doiOrgFirstAuthorGiven)  : (result.pubmedAuthorFirst || null);
  const topFirstOrcid   = useRATop ? (result.raFirstAuthorOrcid  || result.doiOrgFirstAuthorOrcid)  : (result.pubmedAuthorFirstORCID || null);
  const topFirstOrcidUrl= useRATop ? (result.raFirstAuthorOrcidUrl || result.doiOrgFirstAuthorOrcidUrl) : (topFirstOrcid ? `https://orcid.org/${topFirstOrcid}` : null);
  const topFirstAffRaw  = useRATop ? (result.raFirstAuthorAffiliation || result.doiOrgFirstAuthorAffiliation) : null;

  const topLastFamily   = useRATop ? (result.raLastAuthorFamily  || result.doiOrgLastAuthorFamily)  : null;
  const topLastGiven    = useRATop ? (result.raLastAuthorGiven   || result.doiOrgLastAuthorGiven)   : (result.pubmedAuthorLast || null);
  const topLastOrcid    = useRATop ? (result.raLastAuthorOrcid   || result.doiOrgLastAuthorOrcid)   : (result.pubmedAuthorLastORCID || null);
  const topLastOrcidUrl = useRATop ? (result.raLastAuthorOrcidUrl || result.doiOrgLastAuthorOrcidUrl) : (topLastOrcid ? `https://orcid.org/${topLastOrcid}` : null);
  const topLastAffRaw   = useRATop ? (result.raLastAuthorAffiliation || result.doiOrgLastAuthorAffiliation) : null;

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
      ? `<span style="color: #333;">${given || ''} ${family || ''}</span>`
      : '<span style="color: #ccc;">none</span>';
    html += '</div>';

    // ORCID
    html += '<div style="margin-bottom: 2px; margin-left: 15px;">';
    html += '<span style="color: #666;">ORCID:</span> ';
    html += hasOrcid
      ? `<span style="color: #333; font-family: monospace;">${orcidId}</span>`
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
    html += '<div style="margin-bottom: 10px; margin-left: 15px;">';
    const affText = parseAffiliation(affiliation);
    html += affText
      ? `<span style="color: #333;">${affText}</span>`
      : '<span style="color: #ccc;">No affiliation data available</span>';
    html += '</div>';
  };

  // Use pre-fetched metrics from result._authorMetrics
  const firstMetrics = result._authorMetrics?.first || null;
  const lastMetrics  = result._authorMetrics?.last  || null;

  // Resolve affiliations - use RA first, fall back to PubMed if empty
  const pmAff = result._pubmedAffiliations || null;
  const resolvedFirstAff = parseAffiliation(topFirstAffRaw) ? topFirstAffRaw : (pmAff?.first || null);
  const resolvedLastAff  = parseAffiliation(topLastAffRaw)  ? topLastAffRaw  : (pmAff?.last  || null);

  // Update source label if PubMed affiliation fallback was used
  const usedPubMedAff = pmAff?.usedFallback &&
    (!parseAffiliation(topFirstAffRaw) || !parseAffiliation(topLastAffRaw));
  const displaySource = usedPubMedAff ? `${authorSourceTop}\\PubMed` : authorSourceTop;

  html += '<div style="margin-bottom: 6px;">';
  html += `<span style="color: #666;">Number of Authors:</span> <span style="color: #333;">${authorCountTop > 0 ? authorCountTop : 'unknown'}</span>`;
  html += '</div>';
  html += '<div style="margin-bottom: 10px;">';
  html += `<span style="color: #666;">Author Data Source:</span> <span style="color: #333;">${displaySource}</span>`;
  html += '</div>';

  authorBlockTop('First Author', topFirstFamily, topFirstGiven, topFirstOrcid, topFirstOrcidUrl, resolvedFirstAff, firstMetrics);
  if (authorCountTop > 1) {
    authorBlockTop('Last Author', topLastFamily, topLastGiven, topLastOrcid, topLastOrcidUrl, resolvedLastAff, lastMetrics);
  } else {
    authorBlockTop('Last Author', null, null, null, null, null, null);
  }

  html += '</div>'; // Close left margin div
  html += '</div>'; // Close Authors section

  // Links Section
  html += '<div style="margin-bottom: 20px;">';
  html += '<div style="font-weight: bold; color: #005a8c; margin-bottom: 8px; font-size: 15px;">Links</div>';
  html += '<div style="margin-left: 15px; line-height: 1.8;">';
  
  // Checking message (replaced with pre-built links data)
  if (linksHtml) {
    html += `<div id="linksContent">${linksHtml}</div>`;
  } else {
    html += '<div style="color: #999; font-style: italic;">Links unavailable</div>';
  }
  
  html += '</div>'; // Close left margin div
  html += '</div>'; // Close Links section
  
  html += '</div>'; // Close draft report section
  
  // ========================================
  // STRUCTURED DATA SECTION (for development/tracking)
  // ========================================
  html += '<div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 20px; font-family: monospace; font-size: 12px; line-height: 1.8;">';
  html += '<div style="font-weight: bold; color: #666; margin-bottom: 10px; font-size: 14px;">🔧 Structured Data (Development)</div>';
  
  // Helper function to add field
  const addField = (label, value) => {
    html += '<div style="margin-bottom: 8px; word-break: break-all;">';
    html += `<span style="color: #0066cc; font-weight: bold;">${label}:</span> `;
    html += `<span style="color: #333;">${value !== null && value !== undefined ? value : 'null'}</span>`;
    html += '</div>';
  };
  
  // Display all doiOrg fields
  addField('doiOrgDoi', result.doiOrgDoi);
  addField('doiOrgRa', result.doiOrgRa);
  addField('doiOrgUrl', result.doiOrgUrl);
  addField('doiOrgEarliestTimestamp', result.doiOrgEarliestTimestamp);
  addField('doiOrgLatestTimestamp', result.doiOrgLatestTimestamp);
  addField('doiOrgAgeYears', result.doiOrgAgeYears);
  addField('doiOrgTitle', result.doiOrgTitle);
  addField('doiOrgAuthors', result.doiOrgAuthors);
  addField('doiOrgFirstAuthorGiven', result.doiOrgFirstAuthorGiven);
  addField('doiOrgFirstAuthorFamily', result.doiOrgFirstAuthorFamily);
  addField('doiOrgFirstAuthorOrcid', result.doiOrgFirstAuthorOrcid);
  addField('doiOrgFirstAuthorOrcidUrl', result.doiOrgFirstAuthorOrcidUrl);
  addField('doiOrgFirstAuthorAffiliation', result.doiOrgFirstAuthorAffiliation);
  addField('doiOrgLastAuthorGiven', result.doiOrgLastAuthorGiven);
  addField('doiOrgLastAuthorFamily', result.doiOrgLastAuthorFamily);
  addField('doiOrgLastAuthorOrcid', result.doiOrgLastAuthorOrcid);
  addField('doiOrgLastAuthorOrcidUrl', result.doiOrgLastAuthorOrcidUrl);
  addField('doiOrgLastAuthorAffiliation', result.doiOrgLastAuthorAffiliation);
  addField('doiOrgJournal', result.doiOrgJournal);
  addField('doiOrgPublishedDate', result.doiOrgPublishedDate);
  addField('doiOrgType', result.doiOrgType);
  addField('doiOrgPublisher', result.doiOrgPublisher);
  addField('doiOrgVolume', result.doiOrgVolume);
  addField('doiOrgIssue', result.doiOrgIssue);
  addField('doiOrgPages', result.doiOrgPages);
  addField('doiOrgCitationCount', result.doiOrgCitationCount);
  addField('doiOrgReferenceCount', result.doiOrgReferenceCount);
  addField('doiOrgIssn', result.doiOrgIssn);
  addField('doiOrgLanguage', result.doiOrgLanguage);
  addField('doiOrgCreatedDate', result.doiOrgCreatedDate);
  addField('doiOrgDepositedDate', result.doiOrgDepositedDate);
  addField('doiOrgCopyright', result.doiOrgCopyright);
  
  // Display all RA fields (if present)
  if (result.raTitle !== undefined) {
    html += '</div>';
    html += '<div style="background: #fff3e6; padding: 15px; border-radius: 6px; margin-bottom: 20px; font-family: monospace; font-size: 12px; line-height: 1.8;">';
    html += '<div style="font-weight: bold; color: #ff8c00; margin-bottom: 10px; font-size: 14px;">Registration Agency Data (CrossRef)</div>';
    
    addField('raTitle', result.raTitle);
    addField('raSubtitle', result.raSubtitle);
    addField('raShortTitle', result.raShortTitle);
    addField('raOriginalTitle', result.raOriginalTitle);
    addField('raType', result.raType);
    addField('raPublisher', result.raPublisher);
    addField('raMember', result.raMember);
    addField('raAuthors', result.raAuthors);
    addField('raEditor', result.raEditor);
    addField('raChair', result.raChair);
    addField('raTranslator', result.raTranslator);
    addField('raJournal', result.raJournal);
    addField('raShortJournal', result.raShortJournal);
    addField('raVolume', result.raVolume);
    addField('raIssue', result.raIssue);
    addField('raPage', result.raPage);
    addField('raArticleNumber', result.raArticleNumber);
    addField('raPublishedPrint', result.raPublishedPrint);
    addField('raPublishedOnline', result.raPublishedOnline);
    addField('raIssued', result.raIssued);
    addField('raIndexed', result.raIndexed);
    addField('raCreated', result.raCreated);
    addField('raAbstract', result.raAbstract);
    addField('raSubject', result.raSubject);
    addField('raLanguage', result.raLanguage);
    addField('raResource', result.raResource);
    addField('raLink', result.raLink);
    addField('raReference', result.raReference);
    addField('raReferencesCount', result.raReferencesCount);
    addField('raCitationCount', result.raCitationCount);
    addField('raRelation', result.raRelation);
    addField('raFunder', result.raFunder);
    addField('raClinicalTrialNumber', result.raClinicalTrialNumber);
    addField('raLicense', result.raLicense);
    addField('raAssertion', result.raAssertion);
    addField('raUpdateTo', result.raUpdateTo);
    addField('raUpdatedBy', result.raUpdatedBy);
    addField('raUpdatePolicy', result.raUpdatePolicy);
    addField('raArchive', result.raArchive);
    addField('raIssn', result.raIssn);
    addField('raIsbn', result.raIsbn);
    addField('raDoi', result.raDoi);
    addField('raUrl', result.raUrl);
  }
  
  html += '</div>';
  
  // PubMed Data Section (if available)
  if (result.pubmedFound) {
    html += '<div style="margin-bottom: 20px; padding-top: 20px; border-top: 2px solid #ddd;">';
    html += '<div style="font-weight: bold; color: #28a745; margin-bottom: 10px; font-size: 16px;">PubMed Data</div>';
    html += '<div style="background: #f0f8f4; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 12px; line-height: 1.8;">';
    
    // Basic PubMed Info
    addField('pubmedPMID', result.pubmedPMID);
    addField('pubmedUrl', result.pubmedUrl);
    addField('pubmedTitle', result.pubmedTitle);
    addField('pubmedJournal', result.pubmedJournal);
    addField('pubmedPublishDate', result.pubmedPublishDate);
    addField('pubmedYear', result.pubmedYear);
    
    // Status Flags
    addField('pubmedIsMedline', result.pubmedIsMedline);
    addField('pubmedIsPreprint', result.pubmedIsPreprint);
    addField('pubmedFullTextFree', result.pubmedFullTextFree);
    
    // Warnings
    if (result.pubmedHasCorrection) {
      html += '<div style="margin-bottom: 8px; padding: 8px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">';
      html += '<span style="color: #856404; font-weight: bold;">⚠️ HAS CORRECTION</span>';
      if (result.pubmedCorrectionPMID) {
        html += ` <span style="color: #856404;">PMID: ${result.pubmedCorrectionPMID}</span>`;
      }
      html += '</div>';
    }
    if (result.pubmedHasRetraction) {
      html += '<div style="margin-bottom: 8px; padding: 8px; background: #f8d7da; border-left: 4px solid #dc3545; border-radius: 4px;">';
      html += '<span style="color: #721c24; font-weight: bold;">🚨 HAS RETRACTION</span>';
      if (result.pubmedRetractionPMID) {
        html += ` <span style="color: #721c24;">PMID: ${result.pubmedRetractionPMID}</span>`;
      }
      html += '</div>';
    }
    
    // PMC Info
    if (result.pubmedPMCID) {
      addField('pubmedPMCID', result.pubmedPMCID);
      addField('pubmedPMCUrl', result.pubmedPMCUrl);
    }
    
    // ISSNs
    addField('pubmedISSN', result.pubmedISSN);
    addField('pubmedESSN', result.pubmedESSN);
    
    // Authors
    addField('pubmedAuthorFirst', result.pubmedAuthorFirst);
    addField('pubmedAuthorFirstORCID', result.pubmedAuthorFirstORCID);
    addField('pubmedAuthorLast', result.pubmedAuthorLast);
    addField('pubmedAuthorLastORCID', result.pubmedAuthorLastORCID);
    addField('pubmedAuthorCount', result.pubmedAuthorCount);
    
    // Citation Metrics
    addField('pubmedCitationCount', result.pubmedCitationCount);
    addField('pubmedCitationCountSource', result.pubmedCitationCountSource);
    addField('pubmedRCR', result.pubmedRCR);
    addField('pubmedNIHPercentile', result.pubmedNIHPercentile);
    
    if (result.pubmedCitationCountFallback) {
      html += '<div style="margin-bottom: 8px; padding: 6px; background: #d1ecf1; border-left: 3px solid #17a2b8; border-radius: 4px;">';
      html += '<span style="color: #0c5460; font-size: 11px;">ℹ️ Citation data from Europe PMC fallback (iCite unavailable)</span>';
      html += '</div>';
    }
    
    // MeSH Terms
    if (result.pubmedMeSHTerms && result.pubmedMeSHTerms.length > 0) {
      addField('pubmedMeSHTerms', result.pubmedMeSHTerms.join('; '));
    }
    
    // Keywords
    if (result.pubmedKeywords && result.pubmedKeywords.length > 0) {
      addField('pubmedKeywords', result.pubmedKeywords.join('; '));
    }
    
    // Publication Types
    if (result.pubmedPublicationTypes && result.pubmedPublicationTypes.length > 0) {
      addField('pubmedPublicationTypes', result.pubmedPublicationTypes.join('; '));
    }
    
    // Grants
    if (result.pubmedGrants && result.pubmedGrants.length > 0) {
      const grantsStr = result.pubmedGrants.map(g => `${g.agency} ${g.grantId}`).join('; ');
      addField('pubmedGrants', grantsStr);
    }
    
    // Databanks
    if (result.pubmedDatabanks && result.pubmedDatabanks.length > 0) {
      const databanksStr = result.pubmedDatabanks.map(d => `${d.name}: ${d.accession}`).join('; ');
      addField('pubmedDatabanks', databanksStr);
    }
    
    // Abstract
    if (result.pubmedAbstract) {
      html += '<div style="margin-bottom: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #d4edda;">';
      html += '<span style="color: #28a745; font-weight: bold;">Abstract:</span>';
      html += `<div style="margin-top: 6px; color: #333; white-space: pre-wrap; font-family: inherit;">${result.pubmedAbstract}</div>`;
      html += '</div>';
    }
    
    // Links
    html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #d4edda;">';
    html += '<div style="color: #28a745; font-weight: bold; margin-bottom: 6px;">Quick Links:</div>';
    if (result.pubmedUrl) {
      html += `<div><a href="${result.pubmedUrl}" target="_blank" style="color: #007bff; text-decoration: none;">→ View in PubMed</a></div>`;
    }
    if (result.pubmedPMCUrl) {
      html += `<div><a href="${result.pubmedPMCUrl}" target="_blank" style="color: #007bff; text-decoration: none;">→ View Full Text (PMC)</a></div>`;
    }
    if (result.pubmedSimilarArticlesUrl) {
      html += `<div><a href="${result.pubmedSimilarArticlesUrl}" target="_blank" style="color: #007bff; text-decoration: none;">→ Similar Articles</a></div>`;
    }
    if (result.pubmedCitedByUrl) {
      html += `<div><a href="${result.pubmedCitedByUrl}" target="_blank" style="color: #007bff; text-decoration: none;">→ Cited By</a></div>`;
    }
    html += '</div>';
    
    html += '</div>';
    html += '</div>';
  } else {
    // Not in PubMed
    html += '<div style="margin-bottom: 20px; padding: 12px; background: #f8f9fa; border-left: 4px solid #6c757d; border-radius: 4px;">';
    html += '<span style="color: #495057; font-style: italic;">ℹ️ This DOI was not found in PubMed</span>';
    html += '</div>';
  }
  
  html += '</div>';
  
  // Raw data sections (if available)
  if (result._raw) {
    // RA Data section
    html += '<div style="margin-bottom: 20px; padding-top: 20px; border-top: 2px solid #ddd;">';
    html += '<div style="font-weight: bold; color: #0066cc; margin-bottom: 10px; font-size: 16px;">Registration Agency Data (Raw)</div>';
    if (result._raw.raData) {
      html += `<pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 11px; max-height: 200px;">${JSON.stringify(result._raw.raData, null, 2)}</pre>`;
    } else {
      html += '<div style="color: #999; font-style: italic;">Failed to fetch RA data</div>';
    }
    html += '</div>';
    
    // Handle Data section
    html += '<div style="margin-bottom: 20px; padding-top: 20px; border-top: 2px solid #ddd;">';
    html += '<div style="font-weight: bold; color: #0066cc; margin-bottom: 10px; font-size: 16px;">Handle System Data (Raw)</div>';
    if (result._raw.handleData) {
      html += `<pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 11px; max-height: 300px;">${JSON.stringify(result._raw.handleData, null, 2)}</pre>`;
    } else {
      html += '<div style="color: #999; font-style: italic;">Failed to fetch Handle data</div>';
    }
    html += '</div>';
    
    // Content Negotiation Data section
    html += '<div style="margin-bottom: 20px; padding-top: 20px; border-top: 2px solid #ddd;">';
    html += '<div style="font-weight: bold; color: #0066cc; margin-bottom: 10px; font-size: 16px;">Content Negotiation Data (Raw)</div>';
    if (result._raw.contentNegData) {
      html += `<pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 11px; max-height: 400px;">${JSON.stringify(result._raw.contentNegData, null, 2)}</pre>`;
    } else {
      html += '<div style="color: #999; font-style: italic;">Failed to fetch Content Negotiation data</div>';
    }
    html += '</div>';
    
    // CrossRef Data section (if present)
    if (result._raw.crossRefData) {
      html += '<div style="margin-bottom: 20px; padding-top: 20px; border-top: 2px solid #ddd;">';
      html += '<div style="font-weight: bold; color: #ff8c00; margin-bottom: 10px; font-size: 16px;">CrossRef API Data (Raw)</div>';
      html += `<pre style="background: #fff3e6; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 11px; max-height: 400px;">${JSON.stringify(result._raw.crossRefData, null, 2)}</pre>`;
      html += '</div>';
    }
  }
  
  html += '</div>'; // Close Close button wrapper (removed for inline display)

  // Render inline into #results div instead of a modal popup
  const resultsDiv = document.getElementById('results');
  if (resultsDiv) {
    resultsDiv.innerHTML = `<div style="background:white; padding:25px; border:1.5px solid #d8d5cc;">${html}</div>`;
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
  const safeCheck = (fn) => Promise.race([
    fn().catch(() => fallback),
    new Promise(resolve => setTimeout(() => resolve(fallback), 4000))
  ]);
  
  // Run all checks in parallel - each individually capped at 4 seconds
  const [
    crossref, datacite, openalex, semanticscholar,
    unpaywall, doaj, core, openaire, icite
  ] = await Promise.all([
    safeCheck(() => checkCrossRef(doi)),
    safeCheck(() => checkDataCite(doi)),
    safeCheck(() => checkOpenAlex(doi)),
    safeCheck(() => checkSemanticScholar(doi)),
    safeCheck(() => checkUnpaywall(doi)),
    safeCheck(() => checkDOAJByDOI(doi)),
    safeCheck(() => checkCORE(doi)),
    safeCheck(() => checkOpenAIRE(doi)),
    safeCheck(() => checkICite(result.pubmedPMID))
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
  // ISSN for journal metrics - parse all ISSNs
  const issnData = result.doiOrgIssn || result.raIssn;
  let allIssns = [];
  if (issnData) {
    try {
      const arr = typeof issnData === 'string' && issnData.startsWith('[') ? JSON.parse(issnData) : [issnData];
      allIssns = arr.map(i => i.trim()).filter(Boolean);
    } catch (e) { allIssns = []; }
  }
  const firstIssn = allIssns[0] || null;

  // Test (ISSN Web): https://portal.issn.org/resource/ISSN/0028-0836
  // Test (ISSN Data): https://portal.issn.org/resource/ISSN/0028-0836?format=json
  const issn = {
    web: firstIssn ? `https://portal.issn.org/resource/ISSN/${firstIssn}` : null,
    data: firstIssn ? `https://portal.issn.org/resource/ISSN/${firstIssn}?format=json` : null,
  };

  // SJR lookup from local CSV - standalone, no chrome.storage dependency
  // Test (Nature): ISSN 0028-0836 or 1476-4687 → Sourceid 22981
  // Web: https://www.scimagojr.com/journalsearch.php?q=22981&tip=sid&clean=0#:~:text=External%20Cites%20per%20Doc
  const lookupSJR = async (issns) => {
    if (!issns || issns.length === 0) return null;
    try {
      const url = './SJR.csv';
      const response = await fetch(url);
      if (!response.ok) return null;
      const csvText = await response.text();
      const lines = csvText.split('\n');
      const startIndex = lines[0].includes('Sourceid') || lines[0].includes('ISSN') ? 1 : 0;
      const issnSet = new Set(issns);

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseSJRCsvLine(line);
        if (cols.length < 4) continue;
        const issn1 = cols[0].trim();
        const issn2 = cols[1].trim();
        const sourceid = cols[2].trim();
        const sjrValue = parseFloat(cols[3].trim().replace(',', '.'));
        if (issnSet.has(issn1) || issnSet.has(issn2)) {
          return {
            sjr: isNaN(sjrValue) ? null : sjrValue.toFixed(2),
            sourceid,
            web: `https://www.scimagojr.com/journalsearch.php?q=${sourceid}&tip=sid&clean=0#:~:text=External%20Cites%20per%20Doc`,
          };
        }
      }
      return null;
    } catch (e) {
      console.warn('[SJR] CSV lookup failed:', e);
      return null;
    }
  };

  const parseSJRCsvLine = (line) => {
    const result = [];
    let inQuotes = false;
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
      else { current += ch; }
    }
    result.push(current);
    return result;
  };

  const sjrResult = await lookupSJR(allIssns);
  const sjr = {
    web: sjrResult ? sjrResult.web : null,
    data: sjrResult ? sjrResult.sjr : 'N/A', // Score as plain value, not a link
  };
  
  // Author ORCIDs - use same source-selection logic (RA wins ties)
  const raFirstOrcidLinks = result.raFirstAuthorOrcid || null;
  const raLastOrcidLinks  = result.raLastAuthorOrcid  || null;
  const pmFirstOrcidLinks = result.pubmedAuthorFirstORCID || null;
  const pmLastOrcidLinks  = result.pubmedAuthorLastORCID  || null;
  const raOrcidScoreLinks = (raFirstOrcidLinks && raFirstOrcidLinks !== 'N/A' ? 1 : 0) + (raLastOrcidLinks && raLastOrcidLinks !== 'N/A' ? 1 : 0);
  const pmOrcidScoreLinks = (pmFirstOrcidLinks && pmFirstOrcidLinks !== 'N/A' ? 1 : 0) + (pmLastOrcidLinks && pmLastOrcidLinks !== 'N/A' ? 1 : 0);
  const useRALinks = raOrcidScoreLinks >= pmOrcidScoreLinks;
  const firstOrcid = useRALinks ? raFirstOrcidLinks : pmFirstOrcidLinks;
  const lastOrcid  = useRALinks ? raLastOrcidLinks  : pmLastOrcidLinks;

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
    fetchOpenAlexAuthorMetrics(firstOrcid),
    fetchOpenAlexAuthorMetrics(lastOrcid)
  ]);

  // Attach metrics to result so showDOIModal can use them
  result._authorMetrics = {
    first: firstAuthorMetrics,
    last:  lastAuthorMetrics
  };

  // Fetch PubMed affiliations as fallback when RA affiliation is empty and article is in PubMed
  // Only fetch if needed - check if RA affiliation is missing for either author
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

  // Test: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=40670798&retmode=xml
  if (result.pubmedFound && result.pubmedPMID && (firstAffEmpty || lastAffEmpty)) {
    try {
      const eutilesUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${result.pubmedPMID}&retmode=xml`;
      const xmlResponse = await fetch(eutilesUrl);
      if (xmlResponse.ok) {
        const xmlText = await xmlResponse.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // Extract authors with affiliations from PubMed XML
        const authorEls = xmlDoc.querySelectorAll('Author');
        const pubmedAuthors = [];
        authorEls.forEach(authorEl => {
          const lastName  = authorEl.querySelector('LastName')?.textContent  || '';
          const foreName  = authorEl.querySelector('ForeName')?.textContent  || '';
          const initials  = authorEl.querySelector('Initials')?.textContent  || '';

          // Extract ORCID - may be full URL format
          let orcidRaw = '';
          authorEl.querySelectorAll('Identifier').forEach(id => {
            if (id.getAttribute('Source') === 'ORCID') orcidRaw = id.textContent.trim();
          });
          // Strip to bare ID if full URL
          const orcidClean = orcidRaw.replace('https://orcid.org/', '').trim();

          // Extract affiliations
          const affs = [];
          authorEl.querySelectorAll('AffiliationInfo Affiliation').forEach(affEl => {
            const t = affEl.textContent.trim();
            if (t) affs.push(t);
          });

          if (lastName) {
            pubmedAuthors.push({
              fullName: `${foreName || initials} ${lastName}`.trim(),
              orcid: orcidClean,
              affiliations: affs
            });
          }
        });

        if (pubmedAuthors.length > 0) {
          const pmFirst = pubmedAuthors[0];
          const pmLast  = pubmedAuthors[pubmedAuthors.length - 1];
          result._pubmedAffiliations = {
            first: firstAffEmpty ? pmFirst.affiliations.join(' ') || null : null,
            last:  lastAffEmpty  ? pmLast.affiliations.join(' ')  || null : null,
            usedFallback: true
          };
        }
      }
    } catch (e) {
      console.warn('[DOI Lookup] PubMed affiliation fallback failed:', e);
    }
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
  
  const row = (name, webUrl, dataUrl) => {
    html += '<div style="margin-bottom: 4px;">';
    html += `<span style="color: #666; display: inline-block; width: 160px;">${name}:</span>`;
    html += webUrl ? `<a href="${webUrl}" target="_blank" style="color: #0066cc;">Web</a>` : '<span style="color: #ccc;">Web</span>';
    html += ' | ';
    html += dataUrl ? `<a href="${dataUrl}" target="_blank" style="color: #0066cc;">Data</a>` : '<span style="color: #ccc;">Data</span>';
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
  html += 'In 2025, Crossref (xx,xxx,xxx) and DataCite (xx,xxx,xxx) represented over 95% of all research DOIs.';
  html += '</div>';
  
  // =====================
  // Group 2: Article Metrics
  // =====================
  groupLabel('Article Metrics');
  row('Semantic Scholar', semanticscholar.web, semanticscholar.data);
  row('OpenAlex', openalex.web, openalex.data);
  row('Unpaywall', unpaywall.web, unpaywall.data);
  row('DOAJ', doaj.web, doaj.data);
  row('CORE', core.web, core.data);
  row('OpenAIRE', openaire.web, openaire.data);
  row('Dimensions', dimensions.web, dimensions.data);
  // Append note after Dimensions row
  html += '<div style="margin-top: -2px; margin-bottom: 4px; margin-left: 165px; font-size: 10px; color: #999; font-style: italic;">(Free Acct for some features)</div>';
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
  
  // =====================
  // Group 4: Author Metrics
  // =====================
  groupLabel('Author Metrics');

  // Helper to build one author block
  const authorBlock = (label, family, given, orcidId, orcidUrl) => {
    const hasName = family || given;
    const hasOrcid = orcidId && orcidId !== 'N/A';

    // Line 1: Author name or none
    html += '<div style="margin-bottom: 2px;">';
    html += `<span style="color: #666; font-weight: bold;">${label}:</span> `;
    html += hasName
      ? `<span style="color: #333;">${given || ''} ${family || ''}</span>`
      : '<span style="color: #ccc;">none</span>';
    html += '</div>';

    // Line 2: ORCID
    html += '<div style="margin-bottom: 2px; margin-left: 15px;">';
    html += '<span style="color: #666;">ORCID:</span> ';
    if (hasOrcid) {
      html += `<span style="color: #333; font-family: monospace;">${orcidId}</span>`;
    } else {
      html += '<span style="color: #ccc;">not available</span>';
    }
    html += '</div>';

    // Line 3: PubMed | ORCID | OpenAlex links
    html += '<div style="margin-bottom: 10px; margin-left: 15px;">';
    if (hasOrcid) {
      const pubmedOrcidUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(orcidId)}[auid]`;
      const openAlexOrcidUrl = `https://api.openalex.org/authors/orcid:${orcidId}`;
      html += `<a href="${pubmedOrcidUrl}" target="_blank" style="color: #0066cc;">PubMed</a>`;
      html += ' | ';
      html += `<a href="${orcidUrl}" target="_blank" style="color: #0066cc;">ORCID</a>`;
      html += ' | ';
      html += `<a href="${openAlexOrcidUrl}" target="_blank" style="color: #0066cc;">OpenAlex</a>`;
    } else {
      html += '<span style="color: #ccc;">PubMed | ORCID | OpenAlex</span>';
    }
    html += '</div>';
  };

  // --- Source selection: pick the set with the most ORCIDs, RA wins ties ---
  const isValid = v => v && v !== 'N/A';

  // RA ORCID score
  const raFirstOrcid  = result.raFirstAuthorOrcid    || null;
  const raLastOrcid   = result.raLastAuthorOrcid     || null;
  const raOrcidScore  = (isValid(raFirstOrcid) ? 1 : 0) + (isValid(raLastOrcid) ? 1 : 0);

  // PubMed ORCID score
  const pmFirstOrcid  = result.pubmedAuthorFirstORCID || null;
  const pmLastOrcid   = result.pubmedAuthorLastORCID  || null;
  const pmOrcidScore  = (isValid(pmFirstOrcid) ? 1 : 0) + (isValid(pmLastOrcid) ? 1 : 0);

  // RA wins ties (richer name format)
  const useRA = raOrcidScore >= pmOrcidScore;
  const authorSource = useRA ? (result.doiOrgRa || 'RA') : 'PubMed';

  // Author count
  let authorCountMetrics = 0;
  if (result.doiOrgAuthors || result.raAuthors) {
    try {
      const authorsData = result.doiOrgAuthors || result.raAuthors;
      const authorsArray = typeof authorsData === 'string' ? JSON.parse(authorsData) : authorsData;
      if (Array.isArray(authorsArray)) authorCountMetrics = authorsArray.length;
    } catch (e) { /* leave at 0 */ }
  }
  // Fall back to PubMed count if RA had none
  if (authorCountMetrics === 0 && result.pubmedAuthorCount) {
    authorCountMetrics = parseInt(result.pubmedAuthorCount, 10) || 0;
  }

  html += '<div style="margin-bottom: 6px;">';
  html += `<span style="color: #666;">Number of Authors:</span> <span style="color: #333;">${authorCountMetrics > 0 ? authorCountMetrics : 'unknown'}</span>`;
  html += '</div>';

  // Source label
  html += '<div style="margin-bottom: 10px;">';
  html += `<span style="color: #666;">Author Data Source:</span> <span style="color: #333;">${authorSource}</span>`;
  html += '</div>';

  // Resolve author fields from chosen source
  let firstFamily, firstGiven, firstOrcidId, firstOrcidUrl;
  let lastFamily,  lastGiven,  lastOrcidId,  lastOrcidUrl;

  if (useRA) {
    firstFamily  = result.raFirstAuthorFamily    || result.doiOrgFirstAuthorFamily || null;
    firstGiven   = result.raFirstAuthorGiven     || result.doiOrgFirstAuthorGiven  || null;
    firstOrcidId = result.raFirstAuthorOrcid     || result.doiOrgFirstAuthorOrcid  || null;
    firstOrcidUrl= result.raFirstAuthorOrcidUrl  || result.doiOrgFirstAuthorOrcidUrl || null;
    lastFamily   = result.raLastAuthorFamily     || result.doiOrgLastAuthorFamily  || null;
    lastGiven    = result.raLastAuthorGiven      || result.doiOrgLastAuthorGiven   || null;
    lastOrcidId  = result.raLastAuthorOrcid      || result.doiOrgLastAuthorOrcid   || null;
    lastOrcidUrl = result.raLastAuthorOrcidUrl   || result.doiOrgLastAuthorOrcidUrl || null;
  } else {
    // PubMed names are in "Family GI" format - use as-is for given, null for family
    firstFamily  = null;
    firstGiven   = result.pubmedAuthorFirst      || null;
    firstOrcidId = result.pubmedAuthorFirstORCID || null;
    firstOrcidUrl= firstOrcidId ? `https://orcid.org/${firstOrcidId}` : null;
    lastFamily   = null;
    lastGiven    = result.pubmedAuthorLast       || null;
    lastOrcidId  = result.pubmedAuthorLastORCID  || null;
    lastOrcidUrl = lastOrcidId ? `https://orcid.org/${lastOrcidId}` : null;
  }

  // First Author block - always shown
  authorBlock('First Author', firstFamily, firstGiven, firstOrcidId, firstOrcidUrl);

  // Last Author block - always shown, "none" if single author
  if (authorCountMetrics > 1) {
    authorBlock('Last Author', lastFamily, lastGiven, lastOrcidId, lastOrcidUrl);
  } else {
    authorBlock('Last Author', null, null, null, null);
  }
  
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
async function checkOpenAlex(doi) {
  const apiUrl = `https://api.openalex.org/works/https://doi.org/${doi}`;
  const webUrl = `https://openalex.org/works?filter=doi:https://doi.org/${encodeURIComponent(doi)}`;
  try {
    const response = await fetch(apiUrl);
    const found = response.ok;
    return { web: found ? webUrl : null, data: found ? apiUrl : null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://api.semanticscholar.org/graph/v1/paper/DOI:10.1016/S0140-6736(24)02679-5?fields=title,citationCount
async function checkSemanticScholar(doi) {
  const fields = 'title,abstract,year,publicationDate,url,citationCount,referenceCount,influentialCitationCount,authors.name,authors.affiliations,authors.hIndex,authors.externalIds,venue,journal,openAccessPdf';
  const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=${fields}`;
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      const data = await response.json();
      const webUrl = data.url || null; // Direct paper URL from API response
      return { web: webUrl, data: apiUrl };
    }
    return { web: null, data: null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: https://api.unpaywall.org/v2/10.1016/S0140-6736(24)02679-5?email=tomlaheyh@gmail.com
async function checkUnpaywall(doi) {
  const apiUrl = `https://api.unpaywall.org/v2/${doi}?email=tomlaheyh@gmail.com`;
  const webUrl = 'https://unpaywall.org/products/simple-query-tool';
  try {
    const response = await fetch(apiUrl);
    const found = response.ok;
    return { web: found ? webUrl : null, data: found ? apiUrl : null };
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
async function checkOpenAIRE(doi) {
  const apiUrl = `https://api.openaire.eu/search/publications?doi=${encodeURIComponent(doi)}&format=json`;
  const webUrl = `https://explore.openaire.eu/search/publication?pid=${encodeURIComponent(doi)}`;
  try {
    const response = await fetch(apiUrl);
    const found = response.ok;
    return { web: found ? webUrl : null, data: found ? apiUrl : null };
  } catch (error) {
    return { web: null, data: null };
  }
}

// Test: POST to https://icite.od.nih.gov/iciterest/store-search with PMID 29303484
async function checkICite(pmid) {
  if (!pmid) return { web: null, data: null };
  const dataUrl = `https://icite.od.nih.gov/api/pubs?pmids=${pmid}`;
  try {
    const response = await fetch('https://icite.od.nih.gov/iciterest/store-search', {
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
    if (response.ok) {
      const data = await response.json();
      if (data.id) {
        return { web: `https://icite.od.nih.gov/results?searchId=${data.id}`, data: dataUrl };
      }
    }
    return { web: null, data: dataUrl };
  } catch (error) {
    return { web: null, data: dataUrl };
  }
}

// Test: https://app.dimensions.ai/discover/publication?search_text=10.1038/s41586-025-09227-0
async function checkDimensions(doi) {
  return {
    web: `https://app.dimensions.ai/discover/publication?search_text=${encodeURIComponent(doi)}`,
    data: null,
  };
}

/**
 * Check if ISSN is in DOAJ (Directory of Open Access Journals)
 * Uses DOAJ Public Search API v2 - NO AUTHENTICATION REQUIRED
 * API Documentation: https://doaj.org/api/docs
 */
async function checkDOAJ(issn) {
  const doajCheckElement = document.getElementById('doajCheck');
  if (!doajCheckElement) return;
  
  try {
    // Clean ISSN (DOAJ accepts both formats, but hyphenated is standard)
    const cleanIssn = issn.replace(/-/g, '');
    const hyphenatedIssn = cleanIssn.length === 8 
      ? cleanIssn.substring(0, 4) + '-' + cleanIssn.substring(4)
      : issn;
    
    // DOAJ Public Search API v2 (no authentication required!)
    const doajUrl = `https://doaj.org/api/v2/search/journals/issn:${hyphenatedIssn}`;
    
    const response = await fetch(doajUrl);
    
    if (response.ok) {
      const data = await response.json();
      
      // If total === 1, the journal IS in DOAJ (verified Open Access)
      if (data && data.total === 1) {
        const journal = data.results && data.results[0];
        const journalTitle = journal?.bibjson?.title || 'Unknown';
        
        doajCheckElement.innerHTML = '<span style="color: #28a745; font-weight: bold;">✓ Open Access (in DOAJ)</span>';
        doajCheckElement.title = `This journal is listed in the Directory of Open Access Journals (DOAJ)\nTitle: ${journalTitle}`;
      } else if (data && data.total === 0) {
        // Not in DOAJ - provide manual check link as fallback
        const doajSearchUrl = `https://doaj.org/search/journals?ref=homepage-box&source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22issn%3A${hyphenatedIssn}%22%2C%22default_operator%22%3A%22AND%22%7D%7D%7D`;
        doajCheckElement.innerHTML = `<span style="color: #666;">Not in DOAJ (check article access)</span> <a href="${doajSearchUrl}" target="_blank" style="color: #0066cc; font-size: 10px;">(verify)</a>`;
        doajCheckElement.title = 'This journal is not listed in DOAJ. It may still offer open access articles. Check individual article access.';
      } else {
        // Unexpected response
        doajCheckElement.innerHTML = '<span style="color: #999;">DOAJ check inconclusive</span>';
        doajCheckElement.title = `Unexpected response: total=${data?.total}`;
      }
    } else if (response.status === 404) {
      // 404 likely means not found in DOAJ
      const doajSearchUrl = `https://doaj.org/search/journals?ref=homepage-box&source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22issn%3A${hyphenatedIssn}%22%2C%22default_operator%22%3A%22AND%22%7D%7D%7D`;
      doajCheckElement.innerHTML = `<span style="color: #666;">Not in DOAJ (check article access)</span> <a href="${doajSearchUrl}" target="_blank" style="color: #0066cc; font-size: 10px;">(verify)</a>`;
      doajCheckElement.title = 'This journal is not listed in DOAJ. It may still offer open access articles. Check individual article access.';
    } else {
      // Other error - provide manual check link
      const doajSearchUrl = `https://doaj.org/search/journals?ref=homepage-box&source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22issn%3A${hyphenatedIssn}%22%2C%22default_operator%22%3A%22AND%22%7D%7D%7D`;
      doajCheckElement.innerHTML = `<span style="color: #999;">DOAJ check unavailable</span> <a href="${doajSearchUrl}" target="_blank" style="color: #0066cc; font-size: 10px;">(check manually)</a>`;
      doajCheckElement.title = `HTTP ${response.status}`;
    }
  } catch (error) {
    console.log('DOAJ check failed:', error);
    // Provide manual check link
    const cleanIssn = issn.replace(/-/g, '');
    const hyphenatedIssn = cleanIssn.length === 8 
      ? cleanIssn.substring(0, 4) + '-' + cleanIssn.substring(4)
      : issn;
    const doajSearchUrl = `https://doaj.org/search/journals?ref=homepage-box&source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22issn%3A${hyphenatedIssn}%22%2C%22default_operator%22%3A%22AND%22%7D%7D%7D`;
    doajCheckElement.innerHTML = `<span style="color: #999;">DOAJ check failed</span> <a href="${doajSearchUrl}" target="_blank" style="color: #0066cc; font-size: 10px;">(check manually)</a>`;
    doajCheckElement.title = error.message;
  }
}
