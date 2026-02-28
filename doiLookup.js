// doiLookup.js
// Handles all DOI lookup operations and field extraction

/**
 * VALID DOI SAMPLES FOR TESTING
 * 
 * CrossRef (journals/articles - ~90% of all DOIs):
 * https://api.crossref.org/works/10.1161/CIR.0000000000001209
 * https://api.crossref.org/works/10.1093/evlett/qraf044
 * Status: ✅ WORKING - Full API access
 * 
 * DataCite (datasets/software/grey literature - ~8% of DOIs):
 * https://api.datacite.org/dois/10.5281/zenodo.10579124
 * Status: ✅ WORKING - Full API access
 * 
 * JaLC (Japanese publications):
 * https://api.japanlinkcenter.org/dois/10.1241/johokanri.55.42
 * Status: ✅ WORKING - Full API access, bilingual (English/Japanese)
 * 
 * mEDRA (European publications):
 * https://api.medra.org/metadata/10.1400/145060
 * Status: ✅ WORKING - XML/ONIX format
 * 
 * CNKI (China National Knowledge Infrastructure):
 * Sample DOI: 10.13336/j.1003-6520.hve.20160308018
 * Status: 🚫 BLOCKED - Paid API only, restricted outside mainland China
 * Note: Cannot implement - metadata behind paywall
 * 
 * ISTIC (Chinese publications via Wanfang Data):
 * Sample DOI: 10.3969/j.issn.1002-0829.2013.02.002
 * Status: 🚫 BLOCKED - No public API available
 * Note: Handles ~90% of Chinese journal DOIs but no programmatic access
 * 
 * KISTI (Korean publications):
 * Sample DOI: Unknown - most Korean journals use CrossRef instead
 * Status: ⚠️ RARE - Very few DOIs registered with KISTI vs CrossRef
 * Note: API exists but DOIs are extremely rare in practice
 * 
 * Airiti (Taiwan/Chinese publications):
 * Sample DOI: 10.6220/joq.2012.19(1).01
 * Status: ✅ CONFIRMED RA (via doi.org/doiRA) - Website scraping approach needed (similar to JaLC)
 * Notes: Zotero uses MetaExport endpoint + BibTeX parsing. Covers Taiwan academic publishing.
 * Implementation: Would require scraping Airiti Library website (https://www.airitilibrary.com/)
 * 
 * OP (Publications Office of the EU):
 * Sample DOI: Unknown - government documents only
 * Status: 🔍 NOT IMPLEMENTED
 * 
 * Public (Public.Resource.Org - US government documents):
 * Sample DOI: Unknown
 * Status: 🔍 NOT IMPLEMENTED
 * 
 * EIDR (Entertainment identifiers):
 * Sample DOI: Unknown - movies/TV, not research
 * Status: 🔍 NOT IMPLEMENTED - Low priority (entertainment content)
 */

const DOILookup = {
  /**
   * Main lookup function - fetches data from all sources and extracts fields
   * @param {string} doi - Clean DOI string
   * @returns {object} Complete data object with all extracted fields
   */
  async performLookup(doi) {
    try {
      // Fetch all data sources in parallel
      const [raData, handleData, contentNegData] = await this.fetchAllSources(doi);
      
      // Extract all fields
      const extractedData = this.extractAllFields(doi, raData, handleData, contentNegData);
      
      // Initialize _raw object early
      extractedData._raw = {
        raData,
        handleData,
        contentNegData
      };
      
      // If RA is CrossRef, fetch CrossRef-specific data
      if (extractedData.doiOrgRa === 'Crossref') {
        const crossRefData = await this.fetchCrossRefData(doi);
        this.extractCrossRefFields(extractedData, crossRefData);
        extractedData._raw.crossRefData = crossRefData;
      }
      
      // If RA is DataCite, fetch DataCite-specific data
      if (extractedData.doiOrgRa === 'DataCite') {
        const dataCiteData = await this.fetchDataCiteData(doi);
        this.extractDataCiteFields(extractedData, dataCiteData);
        extractedData._raw.dataCiteData = dataCiteData;
      }
      
      // If RA is JaLC, fetch JaLC-specific data
      if (extractedData.doiOrgRa === 'JaLC') {
        const jalcData = await this.fetchJaLCData(doi);
        this.extractJaLCFields(extractedData, jalcData);
        extractedData._raw.jalcData = jalcData;
      }
      
      // If RA is mEDRA, fetch mEDRA-specific data
      if (extractedData.doiOrgRa === 'mEDRA') {
        const medraData = await this.fetchMedraData(doi);
        this.extractMedraFields(extractedData, medraData);
        extractedData._raw.medraData = medraData;
      }
      
      // If RA is CNKI, set message (no public API available)
      if (extractedData.doiOrgRa === 'CNKI') {
        extractedData.raDisplayMessage = true;
        extractedData.raMessage = "CNKI metadata requires paid API access and has restricted access outside mainland China. We cannot retrieve metadata for this DOI.";
        extractedData.raMessageUrl = "https://forums.zotero.org/discussion/75025/can-not-resolve-a-doi-of-a-chinese-database-cnki";
        // Provide web URL so users can manually view the DOI
        extractedData.raWebUrl = `http://www.cnki.net/kcms/doi/${doi}.html`;
        extractedData.raSearchUrl = "http://www.cnki.net/";
      }
      
      // If RA is ISTIC, set message (no public API available)
      if (extractedData.doiOrgRa === 'ISTIC') {
        extractedData.raDisplayMessage = true;
        extractedData.raMessage = "ISTIC (via Wanfang Data) does not provide a public metadata API. We cannot retrieve metadata for this DOI.";
        extractedData.raMessageUrl = "https://forums.zotero.org/discussion/75244/fail-to-add-reference-on-wangfangdata-com";
        // Provide web URL so users can manually view the DOI
        extractedData.raWebUrl = `http://www.chinadoi.cn/portal/mr.action?doi=${doi}`;
        extractedData.raSearchUrl = "http://www.chinadoi.cn/";
      }
      
      // If RA is KISTI, set informational message
      if (extractedData.doiOrgRa === 'KISTI') {
        extractedData.raDisplayMessage = true;
        extractedData.raMessage = "KISTI DOI detected. Most Korean journals use CrossRef instead of KISTI for DOI registration, so these DOIs are relatively rare.";
        extractedData.raMessageUrl = "https://www.doi.or.kr/";
        // Provide web URL so users can manually view the DOI (if it resolves)
        extractedData.raWebUrl = `https://www.doi.or.kr/`;
        extractedData.raSearchUrl = "https://www.doi.or.kr/";
      }
      
      return extractedData;
      
    } catch (error) {
      console.error('DOI lookup error:', error);
      return {
        error: true,
        message: error.message
      };
    }
  },
  
  /**
   * Fetch data from all doi.org sources
   * For CrossRef and DataCite, skip handle and content negotiation —
   * their APIs provide richer data directly.
   * For all other RAs, fall back to handle + content negotiation.
   */
  async fetchAllSources(doi) {
    const raUrl = `https://doi.org/doiRA/${doi}`;

    // Step 1: Always fetch RA first — needed to route everything else
    let raData = null;
    try {
      const raResponse = await fetch(raUrl);
      if (raResponse.ok) {
        raData = await raResponse.json();
      } else {
        console.warn('RA fetch failed:', raResponse.status);
      }
    } catch (e) {
      console.warn('RA fetch error:', e.message);
    }

    const ra = raData?.[0]?.RA || null;
    console.log(`[DOI Lookup] RA identified as: ${ra}`);

    // Step 2: For CrossRef and DataCite, skip handle + content negotiation entirely
    // Their own APIs provide URL, dates, and all metadata directly
    if (ra === 'Crossref' || ra === 'DataCite') {
      console.log(`[DOI Lookup] Skipping handle + content negotiation for ${ra}`);
      return [raData, null, null];
    }

    // Step 3: For all other RAs (JaLC, mEDRA, CNKI, etc.), fetch handle + content negotiation
    const handleUrl = `https://doi.org/api/handles/${doi}`;
    const contentNegUrl = `https://doi.org/${doi}`;

    const [handleResponse] = await Promise.all([
      fetch(handleUrl)
    ]);

    let handleData = null;
    if (handleResponse.ok) {
      handleData = await handleResponse.json();
    } else {
      console.warn('Handle fetch failed:', handleResponse.status);
    }

    let contentNegData = null;
    try {
      const contentNegResponse = await fetch(contentNegUrl, {
        headers: { 'Accept': 'application/citeproc+json' }
      });
      if (contentNegResponse.ok) {
        contentNegData = await contentNegResponse.json();
      } else {
        console.warn('Content Negotiation fetch failed:', contentNegResponse.status);
      }
    } catch (error) {
      // CORS or network error - expected for some RAs like JaLC
      console.warn('Content Negotiation fetch error (likely CORS):', error.message);
    }

    return [raData, handleData, contentNegData];
  },
  
  /**
   * Fetch data from CrossRef API
   */
  async fetchCrossRefData(doi) {
    const crossRefUrl = `https://api.crossref.org/works/${doi}`;
    
    try {
      const response = await fetch(crossRefUrl);
      
      if (!response.ok) {
        console.warn('CrossRef fetch failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      return data.message || null; // CrossRef wraps data in "message" field
      
    } catch (error) {
      console.warn('CrossRef fetch error:', error);
      return null;
    }
  },
  
  /**
   * Fetch data from DataCite API
   */
  async fetchDataCiteData(doi) {
    const dataCiteUrl = `https://api.datacite.org/dois/${doi}`;
    
    try {
      const response = await fetch(dataCiteUrl);
      
      if (!response.ok) {
        console.warn('DataCite fetch failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      return data.data || null; // DataCite wraps data in "data" field
      
    } catch (error) {
      console.warn('DataCite fetch error:', error);
      return null;
    }
  },
  
  /**
   * Fetch data from JaLC API
   */
  async fetchJaLCData(doi) {
    const jalcUrl = `https://api.japanlinkcenter.org/dois/${doi}`;
    
    try {
      const response = await fetch(jalcUrl);
      
      if (!response.ok) {
        console.warn('JaLC fetch failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      return data.data || null; // JaLC wraps data in "data" field
      
    } catch (error) {
      console.warn('JaLC fetch error:', error);
      return null;
    }
  },
  
  /**
   * Fetch data from mEDRA API (returns XML)
   */
  async fetchMedraData(doi) {
    const medraUrl = `https://api.medra.org/metadata/${doi}`;
    
    try {
      const response = await fetch(medraUrl);
      
      if (!response.ok) {
        console.warn('mEDRA fetch failed:', response.status);
        return null;
      }
      
      const xmlText = await response.text();
      
      // Parse XML to DOM
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      
      // Check for parse errors
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        console.warn('mEDRA XML parse error:', parserError.textContent);
        return null;
      }
      
      return xmlDoc; // Return parsed XML document
      
    } catch (error) {
      console.warn('mEDRA fetch error:', error);
      return null;
    }
  },
  
  /**
   * Extract all fields from fetched data
   */
  extractAllFields(doi, raData, handleData, contentNegData) {
    const data = {};
    
    // Basic DOI fields
    data.doiOrgDoi = doi;
    data.doiOrgRa = raData?.[0]?.RA || null;
    
    // Extract from Handle data
    this.extractHandleFields(data, handleData);
    
    // Extract from Content Negotiation data
    this.extractContentNegotiationFields(data, contentNegData);
    
    // Calculate age
    this.calculateAge(data);
    
    return data;
  },
  
  /**
   * Extract fields from Handle data
   */
  extractHandleFields(data, handleData) {
    data.doiOrgUrl = null;
    data.doiOrgEarliestTimestamp = null;
    data.doiOrgLatestTimestamp = null;
    
    if (handleData && handleData.values) {
      // Find URL
      const urlValue = handleData.values.find(v => v.type === 'URL');
      if (urlValue) {
        data.doiOrgUrl = urlValue.data.value;
      }
      
      // Find earliest and latest timestamps
      const timestamps = handleData.values
        .map(v => v.timestamp)
        .filter(t => t);
      
      if (timestamps.length > 0) {
        const sortedTimestamps = timestamps.sort();
        data.doiOrgEarliestTimestamp = sortedTimestamps[0];
        data.doiOrgLatestTimestamp = sortedTimestamps[sortedTimestamps.length - 1];
      }
    }
  },
  
  /**
   * Extract fields from Content Negotiation data
   */
  extractContentNegotiationFields(data, contentNegData) {
    // Initialize all fields
    data.doiOrgTitle = null;
    data.doiOrgAuthors = null;
    data.doiOrgJournal = null;
    data.doiOrgPublishedDate = null;
    data.doiOrgType = null;
    data.doiOrgPublisher = null;
    data.doiOrgVolume = null;
    data.doiOrgIssue = null;
    data.doiOrgPages = null;
    data.doiOrgCitationCount = null;
    data.doiOrgReferenceCount = null;
    data.doiOrgIssn = null;
    data.doiOrgLanguage = null;
    data.doiOrgCreatedDate = null;
    data.doiOrgDepositedDate = null;
    data.doiOrgCopyright = null;
    
    // First author fields
    data.doiOrgFirstAuthorGiven = null;
    data.doiOrgFirstAuthorFamily = null;
    data.doiOrgFirstAuthorOrcid = null;
    data.doiOrgFirstAuthorOrcidUrl = null;
    data.doiOrgFirstAuthorAffiliation = null;
    
    // Last author fields
    data.doiOrgLastAuthorGiven = null;
    data.doiOrgLastAuthorFamily = null;
    data.doiOrgLastAuthorOrcid = null;
    data.doiOrgLastAuthorOrcidUrl = null;
    data.doiOrgLastAuthorAffiliation = null;
    
    if (!contentNegData) return;
    
    // Extract basic fields
    data.doiOrgTitle = contentNegData.title || null;
    data.doiOrgJournal = contentNegData['container-title'] || null;
    data.doiOrgType = contentNegData.type || null;
    data.doiOrgPublisher = contentNegData.publisher || null;
    data.doiOrgVolume = contentNegData.volume || null;
    data.doiOrgIssue = contentNegData.issue || null;
    data.doiOrgPages = contentNegData.page || null;
    data.doiOrgCitationCount = contentNegData['is-referenced-by-count'] !== undefined ? contentNegData['is-referenced-by-count'] : null;
    data.doiOrgReferenceCount = contentNegData['reference-count'] !== undefined ? contentNegData['reference-count'] : null;
    data.doiOrgLanguage = contentNegData.language || null;
    
    // Authors
    if (contentNegData.author) {
      data.doiOrgAuthors = JSON.stringify(contentNegData.author);
      this.extractAuthorFields(data, contentNegData.author);
    }
    
    // Published date
    if (contentNegData.published && contentNegData.published['date-parts'] && contentNegData.published['date-parts'][0]) {
      const dateParts = contentNegData.published['date-parts'][0];
      if (dateParts.length === 3) {
        data.doiOrgPublishedDate = `${dateParts[0]}-${String(dateParts[1]).padStart(2, '0')}-${String(dateParts[2]).padStart(2, '0')}`;
      } else if (dateParts.length === 2) {
        data.doiOrgPublishedDate = `${dateParts[0]}-${String(dateParts[1]).padStart(2, '0')}`;
      } else if (dateParts.length === 1) {
        data.doiOrgPublishedDate = `${dateParts[0]}`;
      }
    }
    
    // ISSN
    if (contentNegData.ISSN) {
      data.doiOrgIssn = JSON.stringify(contentNegData.ISSN);
    }
    
    // Created date
    if (contentNegData.created && contentNegData.created['date-time']) {
      data.doiOrgCreatedDate = contentNegData.created['date-time'];
    }
    
    // Deposited date
    if (contentNegData.deposited && contentNegData.deposited['date-time']) {
      data.doiOrgDepositedDate = contentNegData.deposited['date-time'];
    }
    
    // Copyright
    if (contentNegData.assertion) {
      const copyrightAssertion = contentNegData.assertion.find(a => a.name === 'copyright');
      if (copyrightAssertion) {
        data.doiOrgCopyright = copyrightAssertion.value;
      }
    }
  },
  
  /**
   * Extract first and last author fields
   */
  extractAuthorFields(data, authors) {
    if (authors.length === 0) return;
    
    // First author
    const firstAuthor = authors[0];
    data.doiOrgFirstAuthorGiven = firstAuthor.given || "N/A";
    data.doiOrgFirstAuthorFamily = firstAuthor.family || "N/A";
    
    if (firstAuthor.ORCID) {
      data.doiOrgFirstAuthorOrcidUrl = firstAuthor.ORCID;
      data.doiOrgFirstAuthorOrcid = firstAuthor.ORCID.split('/').pop();
    } else {
      data.doiOrgFirstAuthorOrcid = "N/A";
      data.doiOrgFirstAuthorOrcidUrl = "N/A";
    }
    
    if (firstAuthor.affiliation) {
      data.doiOrgFirstAuthorAffiliation = JSON.stringify(firstAuthor.affiliation);
    } else {
      data.doiOrgFirstAuthorAffiliation = "N/A";
    }
    
    // Last author
    if (authors.length > 1) {
      const lastAuthor = authors[authors.length - 1];
      data.doiOrgLastAuthorGiven = lastAuthor.given || "N/A";
      data.doiOrgLastAuthorFamily = lastAuthor.family || "N/A";
      
      if (lastAuthor.ORCID) {
        data.doiOrgLastAuthorOrcidUrl = lastAuthor.ORCID;
        data.doiOrgLastAuthorOrcid = lastAuthor.ORCID.split('/').pop();
      } else {
        data.doiOrgLastAuthorOrcid = "N/A";
        data.doiOrgLastAuthorOrcidUrl = "N/A";
      }
      
      if (lastAuthor.affiliation) {
        data.doiOrgLastAuthorAffiliation = JSON.stringify(lastAuthor.affiliation);
      } else {
        data.doiOrgLastAuthorAffiliation = "N/A";
      }
    } else {
      // Single author - they are both first and last
      data.doiOrgLastAuthorGiven = data.doiOrgFirstAuthorGiven;
      data.doiOrgLastAuthorFamily = data.doiOrgFirstAuthorFamily;
      data.doiOrgLastAuthorOrcid = data.doiOrgFirstAuthorOrcid;
      data.doiOrgLastAuthorOrcidUrl = data.doiOrgFirstAuthorOrcidUrl;
      data.doiOrgLastAuthorAffiliation = data.doiOrgFirstAuthorAffiliation;
    }
  },
  
  /**
   * Calculate age in years
   */
  calculateAge(data) {
    data.doiOrgAgeYears = null;
    
    const dates = [];
    if (data.doiOrgCreatedDate) {
      dates.push(new Date(data.doiOrgCreatedDate));
    }
    if (data.doiOrgEarliestTimestamp) {
      dates.push(new Date(data.doiOrgEarliestTimestamp));
    }
    
    if (dates.length > 0) {
      const oldestDate = new Date(Math.min(...dates));
      const oldestYear = oldestDate.getFullYear();
      const currentYear = new Date().getFullYear();
      
      // Current year = 1, prior year = 2, etc.
      data.doiOrgAgeYears = currentYear - oldestYear + 1;
    }
  },
  
  /**
   * Extract fields from CrossRef API data
   */
  extractCrossRefFields(data, crossRefData) {
    // Get DOI from data object
    const doi = data.doiOrgDoi;
    // Initialize all RA fields
    data.raTitle = null;
    data.raSubtitle = null;
    data.raShortTitle = null;
    data.raOriginalTitle = null;
    data.raType = null;
    data.raPublisher = null;
    data.raMember = null;
    data.raAuthors = null;
    data.raEditor = null;
    data.raChair = null;
    data.raTranslator = null;
    data.raJournal = null;
    data.raShortJournal = null;
    data.raVolume = null;
    data.raIssue = null;
    data.raPage = null;
    data.raArticleNumber = null;
    data.raPublishedPrint = null;
    data.raPublishedOnline = null;
    data.raIssued = null;
    data.raIndexed = null;
    data.raCreated = null;
    data.raAbstract = null;
    data.raSubject = null;
    data.raLanguage = null;
    data.raResource = null;
    data.raLink = null;
    data.raReference = null;
    data.raReferencesCount = null;
    data.raCitationCount = null;
    data.raRelation = null;
    data.raFunder = null;
    data.raClinicalTrialNumber = null;
    data.raLicense = null;
    data.raAssertion = null;
    data.raUpdateTo = null;
    data.raUpdatedBy = null;
    data.raUpdatePolicy = null;
    data.raArchive = null;
    data.raIssn = null;
    data.raIsbn = null;
    data.raDoi = null;
    data.raUrl = null;
    data.raApiUrl = null;
    data.raWebUrl = null;
    data.raSearchUrl = null;
    
    // Message fields for RA limitations/notes
    data.raDisplayMessage = false;
    data.raMessage = null;
    data.raMessageUrl = null;
    
    // First author fields
    data.raFirstAuthorGiven = null;
    data.raFirstAuthorFamily = null;
    data.raFirstAuthorOrcid = null;
    data.raFirstAuthorOrcidUrl = null;
    data.raFirstAuthorAffiliation = null;
    
    // Last author fields
    data.raLastAuthorGiven = null;
    data.raLastAuthorFamily = null;
    data.raLastAuthorOrcid = null;
    data.raLastAuthorOrcidUrl = null;
    data.raLastAuthorAffiliation = null;
    
    if (!crossRefData) return;
    
    // Extract basic fields
    data.raTitle = crossRefData.title?.[0] || null; // Title is an array in CrossRef
    data.raSubtitle = crossRefData.subtitle?.[0] || null;
    data.raShortTitle = crossRefData['short-title']?.[0] || null;
    data.raOriginalTitle = crossRefData['original-title']?.[0] || null;
    data.raType = crossRefData.type || null;
    data.raPublisher = crossRefData.publisher || null;
    data.raMember = crossRefData.member || null;
    data.raAbstract = crossRefData.abstract || null;
    data.raLanguage = crossRefData.language || null;
    
    // Container (journal/book) info
    data.raJournal = crossRefData['container-title']?.[0] || null;
    data.raShortJournal = crossRefData['short-container-title']?.[0] || null;
    
    // Volume/Issue/Page
    data.raVolume = crossRefData.volume || null;
    data.raIssue = crossRefData.issue || null;
    data.raPage = crossRefData.page || null;
    data.raArticleNumber = crossRefData['article-number'] || null;
    
    // People - store as JSON strings
    if (crossRefData.author) {
      data.raAuthors = JSON.stringify(crossRefData.author);
      
      // Extract first author
      if (crossRefData.author.length > 0) {
        const firstAuthor = crossRefData.author[0];
        data.raFirstAuthorGiven = firstAuthor.given || null;
        data.raFirstAuthorFamily = firstAuthor.family || null;
        
        if (firstAuthor.ORCID) {
          data.raFirstAuthorOrcidUrl = firstAuthor.ORCID;
          data.raFirstAuthorOrcid = firstAuthor.ORCID.split('/').pop();
        }
        
        if (firstAuthor.affiliation && firstAuthor.affiliation.length > 0) {
          data.raFirstAuthorAffiliation = JSON.stringify(firstAuthor.affiliation);
        }
      }
      
      // Extract last author
      if (crossRefData.author.length > 1) {
        const lastAuthor = crossRefData.author[crossRefData.author.length - 1];
        data.raLastAuthorGiven = lastAuthor.given || null;
        data.raLastAuthorFamily = lastAuthor.family || null;
        
        if (lastAuthor.ORCID) {
          data.raLastAuthorOrcidUrl = lastAuthor.ORCID;
          data.raLastAuthorOrcid = lastAuthor.ORCID.split('/').pop();
        }
        
        if (lastAuthor.affiliation && lastAuthor.affiliation.length > 0) {
          data.raLastAuthorAffiliation = JSON.stringify(lastAuthor.affiliation);
        }
      } else if (crossRefData.author.length === 1) {
        // Single author - they are both first and last
        data.raLastAuthorGiven = data.raFirstAuthorGiven;
        data.raLastAuthorFamily = data.raFirstAuthorFamily;
        data.raLastAuthorOrcid = data.raFirstAuthorOrcid;
        data.raLastAuthorOrcidUrl = data.raFirstAuthorOrcidUrl;
        data.raLastAuthorAffiliation = data.raFirstAuthorAffiliation;
      }
    }
    if (crossRefData.editor) {
      data.raEditor = JSON.stringify(crossRefData.editor);
    }
    if (crossRefData.chair) {
      data.raChair = JSON.stringify(crossRefData.chair);
    }
    if (crossRefData.translator) {
      data.raTranslator = JSON.stringify(crossRefData.translator);
    }
    
    // Dates - convert date-parts to ISO strings
    if (crossRefData['published-print'] && crossRefData['published-print']['date-parts']?.[0]) {
      data.raPublishedPrint = this.formatDateParts(crossRefData['published-print']['date-parts'][0]);
    }
    if (crossRefData['published-online'] && crossRefData['published-online']['date-parts']?.[0]) {
      data.raPublishedOnline = this.formatDateParts(crossRefData['published-online']['date-parts'][0]);
    }
    if (crossRefData.issued && crossRefData.issued['date-parts']?.[0]) {
      data.raIssued = this.formatDateParts(crossRefData.issued['date-parts'][0]);
    }
    if (crossRefData.indexed && crossRefData.indexed['date-time']) {
      data.raIndexed = crossRefData.indexed['date-time'];
    }
    if (crossRefData.created && crossRefData.created['date-time']) {
      data.raCreated = crossRefData.created['date-time'];
    }
    
    // Subject categories
    if (crossRefData.subject) {
      data.raSubject = JSON.stringify(crossRefData.subject);
    }
    
    // Links and resources
    if (crossRefData.resource && crossRefData.resource.primary) {
      data.raResource = crossRefData.resource.primary.URL || null;
    }
    if (crossRefData.link) {
      data.raLink = JSON.stringify(crossRefData.link);
    }
    
    // References and citations
    if (crossRefData.reference) {
      data.raReference = JSON.stringify(crossRefData.reference);
    }
    data.raReferencesCount = crossRefData['references-count'] !== undefined ? crossRefData['references-count'] : null;
    data.raCitationCount = crossRefData['is-referenced-by-count'] !== undefined ? crossRefData['is-referenced-by-count'] : null;
    
    // Relations
    if (crossRefData.relation) {
      data.raRelation = JSON.stringify(crossRefData.relation);
    }
    
    // Funding
    if (crossRefData.funder) {
      data.raFunder = JSON.stringify(crossRefData.funder);
    }
    
    // Clinical trials
    if (crossRefData['clinical-trial-number']) {
      data.raClinicalTrialNumber = JSON.stringify(crossRefData['clinical-trial-number']);
    }
    
    // License
    if (crossRefData.license) {
      data.raLicense = JSON.stringify(crossRefData.license);
    }
    
    // Assertions (Crossmark data)
    if (crossRefData.assertion) {
      data.raAssertion = JSON.stringify(crossRefData.assertion);
    }
    
    // Updates
    if (crossRefData['update-to']) {
      data.raUpdateTo = JSON.stringify(crossRefData['update-to']);
    }
    if (crossRefData['updated-by']) {
      data.raUpdatedBy = JSON.stringify(crossRefData['updated-by']);
    }
    data.raUpdatePolicy = crossRefData['update-policy'] || null;
    
    // Archive
    if (crossRefData.archive) {
      data.raArchive = JSON.stringify(crossRefData.archive);
    }
    
    // ISSN and ISBN
    if (crossRefData.ISSN) {
      data.raIssn = JSON.stringify(crossRefData.ISSN);
    }
    if (crossRefData.ISBN) {
      data.raIsbn = JSON.stringify(crossRefData.ISBN);
    }
    
    // DOI and URL
    data.raDoi = crossRefData.DOI || null;
    data.raUrl = crossRefData.URL || null;
    
    // Construct API and web interface URLs
    data.raApiUrl = `https://api.crossref.org/works/${doi}`;
    data.raWebUrl = `https://search.crossref.org/search/works?q=${doi}&from_ui=yes`;
    data.raSearchUrl = `https://search.crossref.org/`;
  },
  
  /**
   * Extract fields from DataCite API data
   */
  extractDataCiteFields(data, dataCiteData) {
    // Get DOI from data object
    const doi = data.doiOrgDoi;
    
    // Initialize all RA fields (same as CrossRef for consistency)
    data.raTitle = null;
    data.raSubtitle = null;
    data.raShortTitle = null;
    data.raOriginalTitle = null;
    data.raType = null;
    data.raPublisher = null;
    data.raMember = null;
    data.raAuthors = null;
    data.raEditor = null;
    data.raChair = null;
    data.raTranslator = null;
    data.raJournal = null;
    data.raShortJournal = null;
    data.raVolume = null;
    data.raIssue = null;
    data.raPage = null;
    data.raArticleNumber = null;
    data.raPublishedPrint = null;
    data.raPublishedOnline = null;
    data.raIssued = null;
    data.raIndexed = null;
    data.raCreated = null;
    data.raAbstract = null;
    data.raSubject = null;
    data.raLanguage = null;
    data.raResource = null;
    data.raLink = null;
    data.raReference = null;
    data.raReferencesCount = null;
    data.raCitationCount = null;
    data.raRelation = null;
    data.raFunder = null;
    data.raClinicalTrialNumber = null;
    data.raLicense = null;
    data.raAssertion = null;
    data.raUpdateTo = null;
    data.raUpdatedBy = null;
    data.raUpdatePolicy = null;
    data.raArchive = null;
    data.raIssn = null;
    data.raIsbn = null;
    data.raDoi = null;
    data.raUrl = null;
    data.raApiUrl = null;
    data.raWebUrl = null;
    data.raSearchUrl = null;
    
    // Message fields for RA limitations/notes
    data.raDisplayMessage = false;
    data.raMessage = null;
    data.raMessageUrl = null;
    
    // First author fields
    data.raFirstAuthorGiven = null;
    data.raFirstAuthorFamily = null;
    data.raFirstAuthorOrcid = null;
    data.raFirstAuthorOrcidUrl = null;
    data.raFirstAuthorAffiliation = null;
    
    // Last author fields
    data.raLastAuthorGiven = null;
    data.raLastAuthorFamily = null;
    data.raLastAuthorOrcid = null;
    data.raLastAuthorOrcidUrl = null;
    data.raLastAuthorAffiliation = null;
    
    if (!dataCiteData) return;
    
    // DataCite has a different structure - data is in "attributes"
    const attrs = dataCiteData.attributes || {};
    
    // Extract basic fields
    // Title - DataCite can have multiple titles
    if (attrs.titles && attrs.titles.length > 0) {
      data.raTitle = attrs.titles[0].title || null;
      // Look for subtitle
      const subtitleObj = attrs.titles.find(t => t.titleType === 'Subtitle');
      if (subtitleObj) {
        data.raSubtitle = subtitleObj.title;
      }
    }
    
    // Type - DataCite uses "types" object
    if (attrs.types) {
      data.raType = attrs.types.resourceTypeGeneral || attrs.types.resourceType || null;
    }
    
    // Publisher
    data.raPublisher = attrs.publisher || null;
    
    // Authors - DataCite calls them "creators"
    if (attrs.creators && attrs.creators.length > 0) {
      data.raAuthors = JSON.stringify(attrs.creators);
      
      // Extract first author/creator
      const firstCreator = attrs.creators[0];
      data.raFirstAuthorGiven = firstCreator.givenName || null;
      data.raFirstAuthorFamily = firstCreator.familyName || null;
      
      // DataCite has name as fallback if givenName/familyName not present
      if (!data.raFirstAuthorGiven && !data.raFirstAuthorFamily && firstCreator.name) {
        data.raFirstAuthorFamily = firstCreator.name;
      }
      
      // ORCID in DataCite creators
      if (firstCreator.nameIdentifiers && firstCreator.nameIdentifiers.length > 0) {
        const orcidId = firstCreator.nameIdentifiers.find(ni => 
          ni.nameIdentifierScheme === 'ORCID' || ni.nameIdentifier.includes('orcid.org')
        );
        if (orcidId) {
          data.raFirstAuthorOrcidUrl = orcidId.nameIdentifier;
          data.raFirstAuthorOrcid = orcidId.nameIdentifier.split('/').pop();
        }
      }
      
      // Affiliation
      if (firstCreator.affiliation && firstCreator.affiliation.length > 0) {
        data.raFirstAuthorAffiliation = JSON.stringify(firstCreator.affiliation);
      }
      
      // Extract last author/creator
      if (attrs.creators.length > 1) {
        const lastCreator = attrs.creators[attrs.creators.length - 1];
        data.raLastAuthorGiven = lastCreator.givenName || null;
        data.raLastAuthorFamily = lastCreator.familyName || null;
        
        // DataCite has name as fallback
        if (!data.raLastAuthorGiven && !data.raLastAuthorFamily && lastCreator.name) {
          data.raLastAuthorFamily = lastCreator.name;
        }
        
        // ORCID
        if (lastCreator.nameIdentifiers && lastCreator.nameIdentifiers.length > 0) {
          const orcidId = lastCreator.nameIdentifiers.find(ni => 
            ni.nameIdentifierScheme === 'ORCID' || ni.nameIdentifier.includes('orcid.org')
          );
          if (orcidId) {
            data.raLastAuthorOrcidUrl = orcidId.nameIdentifier;
            data.raLastAuthorOrcid = orcidId.nameIdentifier.split('/').pop();
          }
        }
        
        // Affiliation
        if (lastCreator.affiliation && lastCreator.affiliation.length > 0) {
          data.raLastAuthorAffiliation = JSON.stringify(lastCreator.affiliation);
        }
      } else {
        // Single creator - they are both first and last
        data.raLastAuthorGiven = data.raFirstAuthorGiven;
        data.raLastAuthorFamily = data.raFirstAuthorFamily;
        data.raLastAuthorOrcid = data.raFirstAuthorOrcid;
        data.raLastAuthorOrcidUrl = data.raFirstAuthorOrcidUrl;
        data.raLastAuthorAffiliation = data.raFirstAuthorAffiliation;
      }
    }
    
    // Contributors (can include editors, etc.)
    if (attrs.contributors && attrs.contributors.length > 0) {
      // Separate by contributor type
      const editors = attrs.contributors.filter(c => c.contributorType === 'Editor');
      if (editors.length > 0) {
        data.raEditor = JSON.stringify(editors);
      }
    }
    
    // Container (journal/book) info - DataCite uses "container"
    if (attrs.container) {
      data.raJournal = attrs.container.title || null;
      data.raVolume = attrs.container.volume || null;
      data.raIssue = attrs.container.issue || null;
    }
    
    // Publication year/date
    data.raIssued = attrs.publicationYear ? `${attrs.publicationYear}` : null;
    
    // Dates
    if (attrs.dates && attrs.dates.length > 0) {
      const published = attrs.dates.find(d => d.dateType === 'Issued' || d.dateType === 'Published');
      if (published) {
        data.raPublishedOnline = published.date;
      }
      const created = attrs.dates.find(d => d.dateType === 'Created');
      if (created) {
        data.raCreated = created.date;
      }
    }
    
    // Indexed date
    if (attrs.registered) {
      data.raIndexed = attrs.registered;
    }
    if (attrs.created) {
      data.raCreated = attrs.created;
    }
    
    // Description (abstract)
    if (attrs.descriptions && attrs.descriptions.length > 0) {
      const abstract = attrs.descriptions.find(d => d.descriptionType === 'Abstract');
      if (abstract) {
        data.raAbstract = abstract.description;
      }
    }
    
    // Subjects
    if (attrs.subjects && attrs.subjects.length > 0) {
      data.raSubject = JSON.stringify(attrs.subjects);
    }
    
    // Language
    data.raLanguage = attrs.language || null;
    
    // URL
    data.raUrl = attrs.url || null;
    
    // Citation and reference counts (DataCite has these at top level)
    data.raCitationCount = attrs.citationCount !== undefined ? attrs.citationCount : null;
    data.raReferencesCount = attrs.referenceCount !== undefined ? attrs.referenceCount : null;
    
    // Related identifiers (references, relations)
    if (attrs.relatedIdentifiers && attrs.relatedIdentifiers.length > 0) {
      data.raRelation = JSON.stringify(attrs.relatedIdentifiers);
      
      // Extract ISSN from relatedIdentifiers
      const issnIdentifier = attrs.relatedIdentifiers.find(r => r.relatedIdentifierType === 'ISSN');
      if (issnIdentifier) {
        data.raIssn = JSON.stringify([issnIdentifier.relatedIdentifier]);
      }
      
      // Override raReferencesCount if we have relatedIdentifiers with References/Cites
      // Only override if the count from relatedIdentifiers is higher
      const references = attrs.relatedIdentifiers.filter(r => 
        r.relationType === 'References' || r.relationType === 'Cites'
      );
      if (references.length > 0 && (!data.raReferencesCount || references.length > data.raReferencesCount)) {
        data.raReferencesCount = references.length;
      }
    }
    
    // Funding
    if (attrs.fundingReferences && attrs.fundingReferences.length > 0) {
      data.raFunder = JSON.stringify(attrs.fundingReferences);
    }
    
    // Rights/License
    if (attrs.rightsList && attrs.rightsList.length > 0) {
      data.raLicense = JSON.stringify(attrs.rightsList);
    }
    
    // Version
    data.raUpdatePolicy = attrs.version || null;
    
    // DOI
    data.raDoi = attrs.doi || dataCiteData.id || null;
    
    // Construct API and web interface URLs
    data.raApiUrl = `https://api.datacite.org/dois/${doi}`;
    data.raWebUrl = `https://commons.datacite.org/doi.org/${doi}`;
    data.raSearchUrl = `https://commons.datacite.org/`;
  },
  
  /**
   * Extract fields from JaLC API data
   */
  extractJaLCFields(data, jalcData) {
    // Get DOI from data object
    const doi = data.doiOrgDoi;
    
    // Initialize all RA fields (same as CrossRef/DataCite for consistency)
    data.raTitle = null;
    data.raTitleJa = null;
    data.raSubtitle = null;
    data.raShortTitle = null;
    data.raOriginalTitle = null;
    data.raType = null;
    data.raPublisher = null;
    data.raPublisherJa = null;
    data.raMember = null;
    data.raAuthors = null;
    data.raEditor = null;
    data.raChair = null;
    data.raTranslator = null;
    data.raJournal = null;
    data.raJournalJa = null;
    data.raShortJournal = null;
    data.raVolume = null;
    data.raIssue = null;
    data.raPage = null;
    data.raArticleNumber = null;
    data.raPublishedPrint = null;
    data.raPublishedOnline = null;
    data.raIssued = null;
    data.raIndexed = null;
    data.raCreated = null;
    data.raAbstract = null;
    data.raSubject = null;
    data.raLanguage = null;
    data.raResource = null;
    data.raLink = null;
    data.raReference = null;
    data.raReferencesCount = null;
    data.raCitationCount = null;
    data.raRelation = null;
    data.raFunder = null;
    data.raClinicalTrialNumber = null;
    data.raLicense = null;
    data.raAssertion = null;
    data.raUpdateTo = null;
    data.raUpdatedBy = null;
    data.raUpdatePolicy = null;
    data.raArchive = null;
    data.raIssn = null;
    data.raIsbn = null;
    data.raDoi = null;
    data.raUrl = null;
    data.raApiUrl = null;
    data.raWebUrl = null;
    data.raSearchUrl = null;
    
    // Message fields for RA limitations/notes
    data.raDisplayMessage = false;
    data.raMessage = null;
    data.raMessageUrl = null;
    
    // First author fields
    data.raFirstAuthorGiven = null;
    data.raFirstAuthorGivenJa = null;
    data.raFirstAuthorFamily = null;
    data.raFirstAuthorFamilyJa = null;
    data.raFirstAuthorOrcid = null;
    data.raFirstAuthorOrcidUrl = null;
    data.raFirstAuthorAffiliation = null;
    data.raFirstAuthorAffiliationJa = null;
    
    // Last author fields
    data.raLastAuthorGiven = null;
    data.raLastAuthorGivenJa = null;
    data.raLastAuthorFamily = null;
    data.raLastAuthorFamilyJa = null;
    data.raLastAuthorOrcid = null;
    data.raLastAuthorOrcidUrl = null;
    data.raLastAuthorAffiliation = null;
    data.raLastAuthorAffiliationJa = null;
    
    if (!jalcData) return;
    
    // Extract titles - prioritize English, keep Japanese
    if (jalcData.title_list && jalcData.title_list.length > 0) {
      const enTitle = jalcData.title_list.find(t => t.lang === 'en');
      const jaTitle = jalcData.title_list.find(t => t.lang === 'ja');
      data.raTitle = enTitle?.title || jalcData.title_list[0]?.title || null;
      data.raTitleJa = jaTitle?.title || null;
    }
    
    // Type
    data.raType = jalcData.article_type || jalcData.content_type || null;
    
    // Publisher - bilingual
    if (jalcData.publisher_list && jalcData.publisher_list.length > 0) {
      const enPublisher = jalcData.publisher_list.find(p => p.lang === 'en');
      const jaPublisher = jalcData.publisher_list.find(p => p.lang === 'ja');
      data.raPublisher = enPublisher?.publisher_name || jalcData.publisher_list[0]?.publisher_name || null;
      data.raPublisherJa = jaPublisher?.publisher_name || null;
    }
    
    // Authors (creators) - store full array and extract first/last
    if (jalcData.creator_list && jalcData.creator_list.length > 0) {
      data.raAuthors = JSON.stringify(jalcData.creator_list);
      
      // Extract first creator
      const firstCreator = jalcData.creator_list[0];
      if (firstCreator.names && firstCreator.names.length > 0) {
        const enName = firstCreator.names.find(n => n.lang === 'en');
        const jaName = firstCreator.names.find(n => n.lang === 'ja');
        
        data.raFirstAuthorGiven = enName?.first_name || firstCreator.names[0]?.first_name || null;
        data.raFirstAuthorFamily = enName?.last_name || firstCreator.names[0]?.last_name || null;
        data.raFirstAuthorGivenJa = jaName?.first_name || null;
        data.raFirstAuthorFamilyJa = jaName?.last_name || null;
      }
      
      // Affiliation for first author
      if (firstCreator.affiliation_list && firstCreator.affiliation_list.length > 0) {
        const enAff = firstCreator.affiliation_list.find(a => a.lang === 'en');
        const jaAff = firstCreator.affiliation_list.find(a => a.lang === 'ja');
        data.raFirstAuthorAffiliation = enAff?.affiliation_name || firstCreator.affiliation_list[0]?.affiliation_name || null;
        data.raFirstAuthorAffiliationJa = jaAff?.affiliation_name || null;
      }
      
      // Extract last creator
      if (jalcData.creator_list.length > 1) {
        const lastCreator = jalcData.creator_list[jalcData.creator_list.length - 1];
        if (lastCreator.names && lastCreator.names.length > 0) {
          const enName = lastCreator.names.find(n => n.lang === 'en');
          const jaName = lastCreator.names.find(n => n.lang === 'ja');
          
          data.raLastAuthorGiven = enName?.first_name || lastCreator.names[0]?.first_name || null;
          data.raLastAuthorFamily = enName?.last_name || lastCreator.names[0]?.last_name || null;
          data.raLastAuthorGivenJa = jaName?.first_name || null;
          data.raLastAuthorFamilyJa = jaName?.last_name || null;
        }
        
        // Affiliation for last author
        if (lastCreator.affiliation_list && lastCreator.affiliation_list.length > 0) {
          const enAff = lastCreator.affiliation_list.find(a => a.lang === 'en');
          const jaAff = lastCreator.affiliation_list.find(a => a.lang === 'ja');
          data.raLastAuthorAffiliation = enAff?.affiliation_name || lastCreator.affiliation_list[0]?.affiliation_name || null;
          data.raLastAuthorAffiliationJa = jaAff?.affiliation_name || null;
        }
      } else {
        // Single author - they are both first and last
        data.raLastAuthorGiven = data.raFirstAuthorGiven;
        data.raLastAuthorGivenJa = data.raFirstAuthorGivenJa;
        data.raLastAuthorFamily = data.raFirstAuthorFamily;
        data.raLastAuthorFamilyJa = data.raFirstAuthorFamilyJa;
        data.raLastAuthorAffiliation = data.raFirstAuthorAffiliation;
        data.raLastAuthorAffiliationJa = data.raFirstAuthorAffiliationJa;
      }
    }
    
    // Journal - bilingual
    if (jalcData.journal_title_name_list && jalcData.journal_title_name_list.length > 0) {
      const enJournal = jalcData.journal_title_name_list.find(j => j.lang === 'en' && j.type === 'full');
      const jaJournal = jalcData.journal_title_name_list.find(j => j.lang === 'ja' && j.type === 'full');
      const enAbbrev = jalcData.journal_title_name_list.find(j => j.lang === 'en' && j.type === 'abbreviation');
      
      data.raJournal = enJournal?.journal_title_name || jalcData.journal_title_name_list[0]?.journal_title_name || null;
      data.raJournalJa = jaJournal?.journal_title_name || null;
      data.raShortJournal = enAbbrev?.journal_title_name || null;
    }
    
    // Volume/Issue/Pages
    data.raVolume = jalcData.volume || null;
    data.raIssue = jalcData.issue || null;
    if (jalcData.first_page && jalcData.last_page) {
      data.raPage = `${jalcData.first_page}-${jalcData.last_page}`;
    } else if (jalcData.first_page) {
      data.raPage = jalcData.first_page;
    }
    data.raArticleNumber = jalcData.article_number || null;
    
    // Publication date
    if (jalcData.publication_date) {
      data.raIssued = jalcData.publication_date.publication_year ? `${jalcData.publication_date.publication_year}` : null;
    }
    if (jalcData.date) {
      data.raPublishedOnline = jalcData.date;
    }
    
    // Updated date
    if (jalcData.updated_date) {
      data.raIndexed = jalcData.updated_date;
    }
    
    // Language
    data.raLanguage = jalcData.content_language || jalcData.journal_txt_lang || null;
    
    // URL from relation_list
    if (jalcData.relation_list && jalcData.relation_list.length > 0) {
      data.raRelation = JSON.stringify(jalcData.relation_list);
      const urlRelation = jalcData.relation_list.find(r => r.type === 'URL');
      if (urlRelation) {
        data.raUrl = urlRelation.content;
      }
    }
    if (!data.raUrl) {
      data.raUrl = jalcData.url || null;
    }
    
    // References (citation_list)
    if (jalcData.citation_list && jalcData.citation_list.length > 0) {
      data.raReference = JSON.stringify(jalcData.citation_list);
      data.raReferencesCount = jalcData.citation_list.length;
    }
    
    // Note: JaLC doesn't provide citation count in this API
    
    // Keywords/Subjects - bilingual
    if (jalcData.keyword_list && jalcData.keyword_list.length > 0) {
      data.raSubject = JSON.stringify(jalcData.keyword_list);
    }
    
    // ISSN
    if (jalcData.journal_id_list && jalcData.journal_id_list.length > 0) {
      const issnList = jalcData.journal_id_list
        .filter(j => j.type === 'ISSN')
        .map(j => j.journal_id);
      if (issnList.length > 0) {
        data.raIssn = JSON.stringify(issnList);
      }
    }
    
    // DOI
    data.raDoi = jalcData.doi || null;
    
    // Construct API and web interface URLs
    data.raApiUrl = `https://api.japanlinkcenter.org/dois/${doi}`;
    data.raSearchUrl = `https://japanlinkcenter.org/app/pub/search`;
    
    // JaLC doesn't have a DOI-specific web viewer, so raWebUrl is null
    // It will fall back to raSearchUrl in the UI
    data.raWebUrl = null;
    
    // If raWebUrl is null, copy raSearchUrl to raWebUrl as fallback
    if (!data.raWebUrl && data.raSearchUrl) {
      data.raWebUrl = data.raSearchUrl;
    }
  },
  
  /**
   * Extract fields from mEDRA API data (XML/ONIX format)
   */
  extractMedraFields(data, medraXml) {
    // Get DOI from data object
    const doi = data.doiOrgDoi;
    
    // Initialize all RA fields
    data.raTitle = null;
    data.raTitleJa = null;
    data.raSubtitle = null;
    data.raShortTitle = null;
    data.raOriginalTitle = null;
    data.raType = null;
    data.raPublisher = null;
    data.raPublisherJa = null;
    data.raMember = null;
    data.raAuthors = null;
    data.raEditor = null;
    data.raChair = null;
    data.raTranslator = null;
    data.raJournal = null;
    data.raJournalJa = null;
    data.raShortJournal = null;
    data.raVolume = null;
    data.raIssue = null;
    data.raPage = null;
    data.raArticleNumber = null;
    data.raPublishedPrint = null;
    data.raPublishedOnline = null;
    data.raIssued = null;
    data.raIndexed = null;
    data.raCreated = null;
    data.raAbstract = null;
    data.raSubject = null;
    data.raLanguage = null;
    data.raResource = null;
    data.raLink = null;
    data.raReference = null;
    data.raReferencesCount = null;
    data.raCitationCount = null;
    data.raRelation = null;
    data.raFunder = null;
    data.raClinicalTrialNumber = null;
    data.raLicense = null;
    data.raAssertion = null;
    data.raUpdateTo = null;
    data.raUpdatedBy = null;
    data.raUpdatePolicy = null;
    data.raArchive = null;
    data.raIssn = null;
    data.raIsbn = null;
    data.raDoi = null;
    data.raUrl = null;
    data.raApiUrl = null;
    data.raWebUrl = null;
    data.raSearchUrl = null;
    
    // Message fields for RA limitations/notes
    data.raDisplayMessage = false;
    data.raMessage = null;
    data.raMessageUrl = null;
    
    // First author fields
    data.raFirstAuthorGiven = null;
    data.raFirstAuthorGivenJa = null;
    data.raFirstAuthorFamily = null;
    data.raFirstAuthorFamilyJa = null;
    data.raFirstAuthorOrcid = null;
    data.raFirstAuthorOrcidUrl = null;
    data.raFirstAuthorAffiliation = null;
    data.raFirstAuthorAffiliationJa = null;
    
    // Last author fields
    data.raLastAuthorGiven = null;
    data.raLastAuthorGivenJa = null;
    data.raLastAuthorFamily = null;
    data.raLastAuthorFamilyJa = null;
    data.raLastAuthorOrcid = null;
    data.raLastAuthorOrcidUrl = null;
    data.raLastAuthorAffiliation = null;
    data.raLastAuthorAffiliationJa = null;
    
    if (!medraXml) return;
    
    // Helper function to get text content from XML element
    const getTextContent = (element, selector) => {
      const el = element.querySelector(selector);
      return el ? el.textContent.trim() : null;
    };
    
    // Get the ContentItem element (contains article metadata)
    const contentItem = medraXml.querySelector('ContentItem');
    if (!contentItem) return;
    
    // Title
    const titleEl = contentItem.querySelector('Title TitleText');
    if (titleEl) {
      data.raTitle = titleEl.textContent.trim();
    }
    
    // Type - from TextItemType or NotificationType
    const typeEl = contentItem.querySelector('TextItem TextItemType');
    if (typeEl) {
      data.raType = typeEl.textContent.trim();
    } else {
      // Fallback to NotificationType
      const notifType = medraXml.querySelector('NotificationType');
      if (notifType) {
        data.raType = notifType.textContent.trim();
      }
    }
    
    // Publisher - from SerialWork
    const publisherEl = medraXml.querySelector('SerialWork Publisher PublisherName');
    if (publisherEl) {
      data.raPublisher = publisherEl.textContent.trim();
    }
    
    // Authors/Contributors
    const contributors = contentItem.querySelectorAll('Contributor');
    if (contributors.length > 0) {
      const authorArray = [];
      contributors.forEach(contrib => {
        const role = getTextContent(contrib, 'ContributorRole');
        
        if (role === 'A01') { // A01 = Author
          // Try PersonNameInverted format first (e.g., "Crismani, Andrea")
          const personNameInverted = getTextContent(contrib, 'PersonNameInverted');
          if (personNameInverted) {
            // Split on comma: "LastName, FirstName"
            const parts = personNameInverted.split(',').map(p => p.trim());
            authorArray.push({
              given: parts[1] || null,
              family: parts[0] || null,
              role: role
            });
          } else {
            // Fall back to NamesBeforeKey/KeyNames format
            const given = getTextContent(contrib, 'NamesBeforeKey');
            const family = getTextContent(contrib, 'KeyNames');
            authorArray.push({
              given: given,
              family: family,
              role: role
            });
          }
        }
      });
      
      if (authorArray.length > 0) {
        data.raAuthors = JSON.stringify(authorArray);
        
        // First author
        data.raFirstAuthorGiven = authorArray[0].given;
        data.raFirstAuthorFamily = authorArray[0].family;
        
        // Last author
        if (authorArray.length > 1) {
          const lastAuthor = authorArray[authorArray.length - 1];
          data.raLastAuthorGiven = lastAuthor.given;
          data.raLastAuthorFamily = lastAuthor.family;
        } else {
          // Single author
          data.raLastAuthorGiven = data.raFirstAuthorGiven;
          data.raLastAuthorFamily = data.raFirstAuthorFamily;
        }
      }
    }
    
    // Journal name
    const journalEl = medraXml.querySelector('SerialWork Title TitleText');
    if (journalEl) {
      data.raJournal = journalEl.textContent.trim();
    }
    
    // ISSN
    const issnElements = medraXml.querySelectorAll('SerialVersion ProductIdentifier');
    const issnArray = [];
    issnElements.forEach(el => {
      const idType = getTextContent(el, 'ProductIDType');
      const idValue = getTextContent(el, 'IDValue');
      if (idType === '07' && idValue) { // 07 = ISSN
        issnArray.push(idValue);
      }
    });
    if (issnArray.length > 0) {
      data.raIssn = JSON.stringify(issnArray);
    }
    
    // Volume/Issue
    const journalIssue = medraXml.querySelector('JournalIssue');
    if (journalIssue) {
      const issueNum = getTextContent(journalIssue, 'JournalIssueNumber');
      const issueDesig = getTextContent(journalIssue, 'JournalIssueDesignation');
      data.raIssue = issueNum || issueDesig;
    }
    
    // Pages
    const firstPage = getTextContent(contentItem, 'PageRun FirstPageNumber');
    const lastPage = getTextContent(contentItem, 'PageRun LastPageNumber');
    if (firstPage && lastPage) {
      data.raPage = `${firstPage}-${lastPage}`;
    } else if (firstPage) {
      data.raPage = firstPage;
    } else {
      // Some mEDRA records only have NumberOfPages
      const numPages = getTextContent(contentItem, 'NumberOfPages');
      if (numPages) {
        data.raPage = `${numPages} pages`;
      }
    }
    
    // Publication date
    const pubDate = getTextContent(contentItem, 'PublicationDate');
    if (pubDate) {
      data.raIssued = pubDate;
      data.raPublishedOnline = pubDate;
    }
    
    // Language
    const langEl = contentItem.querySelector('Language[LanguageRole="01"] LanguageCode');
    if (langEl) {
      data.raLanguage = langEl.textContent.trim();
    }
    
    // Abstract
    const abstractEl = contentItem.querySelector('OtherText[TextTypeCode="33"] Text');
    if (abstractEl) {
      data.raAbstract = abstractEl.textContent.trim();
    }
    
    // URL - from DOIWebsiteLink or TargetResource
    const urlEl = medraXml.querySelector('DOIWebsiteLink');
    if (urlEl) {
      data.raUrl = urlEl.textContent.trim();
    } else {
      // Try TargetResource as fallback
      const targetResource = medraXml.querySelector('TargetResource TargetResourceValue');
      if (targetResource) {
        data.raUrl = targetResource.textContent.trim();
      }
    }
    
    // DOI
    const doiEl = medraXml.querySelector('DOI');
    if (doiEl) {
      data.raDoi = doiEl.textContent.trim();
    }
    
    // Construct API and web interface URLs
    data.raApiUrl = `https://api.medra.org/metadata/${doi}`;
    data.raWebUrl = `https://www.medra.org/servlet/view?doi=${doi}`;
    data.raSearchUrl = `https://www.medra.org/`;
  },
  
  /**
   * Helper to format date-parts array to ISO string
   */
  formatDateParts(dateParts) {
    if (!dateParts || dateParts.length === 0) return null;
    
    if (dateParts.length === 3) {
      return `${dateParts[0]}-${String(dateParts[1]).padStart(2, '0')}-${String(dateParts[2]).padStart(2, '0')}`;
    } else if (dateParts.length === 2) {
      return `${dateParts[0]}-${String(dateParts[1]).padStart(2, '0')}`;
    } else if (dateParts.length === 1) {
      return `${dateParts[0]}`;
    }
    return null;
  }
};

// Export for use in popup.js
window.DOILookup = DOILookup;
