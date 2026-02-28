// pubmedLookup.js - PubMed/NIH data integration for DOI extension
// Fetches comprehensive PubMed data including citations, metrics, authors, and metadata

const PubMedLookup = {
  /**
   * Main entry point - fetches all PubMed data for a given DOI
   * @param {string} doi - The DOI to lookup in PubMed
   * @returns {Promise<Object>} - Object with all pubmed* prefixed fields
   */
  async fetchPubMedData(doi) {
    const pubmedData = {
      pubmedFound: false,
      pubmedFetchDate: new Date().toISOString()
    };

    try {
      console.log(`[PubMed] Starting lookup for DOI: ${doi}`);

      // Step 1: Search for PMID by DOI
      const pmid = await this.searchPubMedByDOI(doi);
      if (!pmid) {
        console.log('[PubMed] DOI not found in PubMed');
        return pubmedData;
      }

      console.log(`[PubMed] Found PMID: ${pmid}`);
      pubmedData.pubmedFound = true;
      pubmedData.pubmedPMID = pmid;

      // Step 2: Build standard URLs (no API call needed)
      pubmedData.pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
      pubmedData.pubmedSimilarArticlesUrl = `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed&from_uid=${pmid}`;
      pubmedData.pubmedCitedByUrl = `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed_citedin&from_uid=${pmid}`;

      // Step 3: Get eSummary data (fast summary info)
      console.log('[PubMed] Fetching eSummary data...');
      const eSummaryData = await this.getESummaryForPMID(pmid);
      Object.assign(pubmedData, eSummaryData);

      // Step 4: Get citation metrics from iCite (with fallback to Europe PMC)
      console.log('[PubMed] Fetching citation metrics from iCite...');
      const iCiteData = await this.getICiteForSinglePMID(pmid);
      Object.assign(pubmedData, iCiteData);

      // Step 5: Get detailed metadata with eFetch (authors, abstract, MeSH)
      console.log('[PubMed] Fetching detailed metadata with eFetch...');
      const eFetchData = await this.fetchPubMedDetails(pmid);
      Object.assign(pubmedData, eFetchData);

      console.log('[PubMed] Lookup complete');
      return pubmedData;

    } catch (error) {
      console.error('[PubMed] Error in fetchPubMedData:', error);
      return pubmedData;
    }
  },

  /**
   * Search PubMed for a PMID using a DOI
   * @param {string} doi - The DOI to search for
   * @returns {Promise<string|null>} - PMID if found, null otherwise
   */
  async searchPubMedByDOI(doi) {
    try {
      const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
      const params = new URLSearchParams({
        db: 'pubmed',
        term: `${doi}[DOI]`,
        retmode: 'json',
        retmax: 1
      });

      const response = await fetch(`${baseUrl}?${params}`);
      if (!response.ok) {
        console.error(`[PubMed] Search failed: HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      const idList = data.esearchresult?.idlist || [];
      
      if (idList.length === 0) {
        return null;
      }

      return idList[0];

    } catch (error) {
      console.error('[PubMed] Error in searchPubMedByDOI:', error);
      return null;
    }
  },

  /**
   * Get eSummary data for a PMID (fast summary info)
   * Includes: ISSN, PMC ID, corrections, retractions, preprint status
   * @param {string} pmid - The PMID to fetch
   * @returns {Promise<Object>} - Object with pubmed* fields
   */
  async getESummaryForPMID(pmid) {
    const data = {};

    try {
      const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
      const params = new URLSearchParams({
        db: 'pubmed',
        id: pmid,
        retmode: 'json'
      });

      const response = await fetch(`${baseUrl}?${params}`);
      if (!response.ok) {
        console.error(`[PubMed] eSummary failed: HTTP ${response.status}`);
        return data;
      }

      const json = await response.json();
      const result = json.result?.[pmid];
      
      if (!result) {
        console.error('[PubMed] No eSummary result for PMID');
        return data;
      }

      // Extract ISSNs
      data.pubmedISSN = result.issn || '';
      data.pubmedESSN = result.essn || '';
      data.pubmedDefaultISSN = result.issn || result.essn || '';

      // Extract PMC information
      let pmcId = '';
      let pmcUrl = '';
      if (result.articleids && Array.isArray(result.articleids)) {
        const pmcArticleId = result.articleids.find(id => id.idtype === 'pmc');
        if (pmcArticleId) {
          pmcId = pmcArticleId.value;
          pmcUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/`;
        }
      }
      data.pubmedPMCID = pmcId;
      data.pubmedPMCUrl = pmcUrl;
      data.pubmedFullTextFree = !!pmcUrl;
      data.pubmedFullTextUrl = pmcUrl || '';

      // Publication status
      data.pubmedRecordStatus = result.recordstatus || '';
      data.pubmedPubStatus = result.pubstatus || '';
      data.pubmedIsMedline = result.recordstatus === 'PubMed - indexed for MEDLINE';

      // Publication types
      data.pubmedPublicationTypes = (result.pubtype && Array.isArray(result.pubtype)) ? result.pubtype : [];

      // Check for corrections and retractions
      let hasCorrection = false;
      let hasRetraction = false;
      let correctionPmid = '';
      let retractionPmid = '';
      let originalPmid = '';

      if (result.references && Array.isArray(result.references)) {
        result.references.forEach(ref => {
          if (ref.reftype === 'Erratum in') {
            hasCorrection = true;
            correctionPmid = ref.pmid ? ref.pmid.toString() : '';
          }
          if (ref.reftype === 'Retraction in') {
            hasRetraction = true;
            retractionPmid = ref.pmid ? ref.pmid.toString() : '';
          }
          // For notices themselves - capture the original article
          if (ref.reftype === 'Erratum for') {
            originalPmid = ref.pmid ? ref.pmid.toString() : '';
          }
          if (ref.reftype === 'Retraction of') {
            originalPmid = ref.pmid ? ref.pmid.toString() : '';
          }
        });
      }

      // Check pubtype for correction/retraction notices
      if (data.pubmedPublicationTypes.includes('Published Erratum')) {
        hasCorrection = true;
      }
      if (data.pubmedPublicationTypes.includes('Retraction of Publication')) {
        hasRetraction = true;
      }
      // "Retracted Publication" = this article itself has been retracted
      data.pubmedIsRetractedPublication = data.pubmedPublicationTypes.includes('Retracted Publication');

      data.pubmedHasCorrection = hasCorrection;
      data.pubmedCorrectionPMID = correctionPmid;
      data.pubmedHasRetraction = hasRetraction;
      data.pubmedRetractionPMID = retractionPmid;
      data.pubmedOriginalPMID = originalPmid;

      // Check if preprint
      let isPreprint = false;

      // Primary check: pubstatus field
      if (result.pubstatus === 'preprint' || result.pubstatus === '3') {
        isPreprint = true;
      }

      // Secondary check: pubtype array
      if (data.pubmedPublicationTypes.includes('Preprint')) {
        isPreprint = true;
      }

      // Tertiary check: journal name for known preprint servers
      if (!isPreprint) {
        const journalName = (result.fulljournalname || result.source || '').toLowerCase();
        const preprintServers = ['biorxiv', 'medrxiv', 'research square', 'ssrn', 'arxiv', 'preprint'];
        if (preprintServers.some(server => journalName.includes(server))) {
          isPreprint = true;
        }
      }

      data.pubmedIsPreprint = isPreprint;

      // Get MedLine date if available
      const medlineDate = result.history?.find(h => h.pubstatus === 'medline')?.date || '';
      data.pubmedMedlineDate = medlineDate;

      // Store NLM unique ID
      data.pubmedNlmUniqueId = result.nlmuniqueid || '';

      return data;

    } catch (error) {
      console.error('[PubMed] Error in getESummaryForPMID:', error);
      return data;
    }
  },

  /**
   * Get citation metrics from iCite (NIH's preferred citation source)
   * Includes health check and automatic fallback to Europe PMC
   * @param {string} pmid - The PMID to fetch citations for
   * @returns {Promise<Object>} - Object with citation metrics
   */
  async getICiteForSinglePMID(pmid) {
    const data = {
      pubmedCitationCount: 0,
      pubmedCitationCountSource: 'none',
      pubmedRCR: '-',
      pubmedNIHPercentile: 'N/A',
      pubmedCitationCountFallback: false,
      pubmedCitationCountUnavailable: false
    };

    try {
      // Try iCite first
      const iCiteUrl = `https://icite.od.nih.gov/api/pubs?pmids=${pmid}`;
      const response = await fetch(iCiteUrl);

      if (!response.ok) {
        console.log(`[PubMed] iCite failed (HTTP ${response.status}), using Europe PMC fallback`);
        return await this.getEuropePMCCitationSingle(pmid);
      }

      const json = await response.json();
      if (!json.data || json.data.length === 0) {
        console.log('[PubMed] iCite returned no data, using Europe PMC fallback');
        return await this.getEuropePMCCitationSingle(pmid);
      }

      const item = json.data[0];

      data.pubmedCitationCount = item.citation_count || 0;
      data.pubmedCitationCountSource = 'iCite';
      data.pubmedRCR = item.relative_citation_ratio 
        ? item.relative_citation_ratio.toFixed(2) 
        : '-';
      data.pubmedNIHPercentile = item.nih_percentile || 'N/A';
      data.pubmedCitationCountFallback = false;
      data.pubmedCitationCountUnavailable = false;

      console.log(`[PubMed] iCite: ${data.pubmedCitationCount} citations, RCR: ${data.pubmedRCR}`);
      return data;

    } catch (error) {
      console.error('[PubMed] iCite error, using Europe PMC fallback:', error);
      return await this.getEuropePMCCitationSingle(pmid);
    }
  },

  /**
   * Fallback citation source when iCite is unavailable
   * Note: Europe PMC doesn't provide RCR or NIH percentile
   * @param {string} pmid - The PMID to fetch citations for
   * @returns {Promise<Object>} - Object with citation count only
   */
  async getEuropePMCCitationSingle(pmid) {
    const data = {
      pubmedCitationCount: -9,
      pubmedCitationCountSource: 'none',
      pubmedRCR: '-9',
      pubmedNIHPercentile: -9,
      pubmedCitationCountFallback: true,
      pubmedCitationCountUnavailable: false
    };

    try {
      const baseUrl = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
      const params = new URLSearchParams({
        query: `EXT_ID:${pmid}`,
        format: 'json'
      });

      const response = await fetch(`${baseUrl}?${params}`);
      if (!response.ok) {
        console.error(`[PubMed] Europe PMC failed: HTTP ${response.status}`);
        data.pubmedCitationCountUnavailable = true;
        return data;
      }

      const json = await response.json();
      const result = json.resultList?.result?.[0];

      if (result) {
        data.pubmedCitationCount = result.citedByCount || 0;
        data.pubmedCitationCountSource = 'Europe PMC';
        console.log(`[PubMed] Europe PMC fallback: ${data.pubmedCitationCount} citations`);
      } else {
        data.pubmedCitationCount = 0;
        data.pubmedCitationCountSource = 'Europe PMC';
        console.log('[PubMed] Europe PMC fallback: 0 citations (not found)');
      }

      return data;

    } catch (error) {
      console.error('[PubMed] Europe PMC fallback error:', error);
      data.pubmedCitationCountUnavailable = true;
      return data;
    }
  },

  /**
   * Get detailed metadata with eFetch (authors, abstract, MeSH terms, grants)
   * @param {string} pmid - The PMID to fetch
   * @returns {Promise<Object>} - Object with detailed metadata
   */
  async fetchPubMedDetails(pmid) {
    const data = {
      pubmedTitle: '',
      pubmedAbstract: '',
      pubmedJournal: '',
      pubmedJournalFull: '',
      pubmedVolume: '',
      pubmedIssue: '',
      pubmedPages: '',
      pubmedPublishDate: '',
      pubmedYear: '',
      pubmedDOI: '',
      pubmedAuthorFirst: '',
      pubmedAuthorFirstORCID: '',
      pubmedAuthorFirstAffiliations: [],
      pubmedAuthorFirstEmail: '',
      pubmedAuthorLast: '',
      pubmedAuthorLastORCID: '',
      pubmedAuthorLastAffiliations: [],
      pubmedAuthorLastEmail: '',
      pubmedAuthorCount: 0,
      pubmedAuthorsAll: [],
      pubmedMeSHTerms: [],
      pubmedKeywords: [],
      pubmedGrants: [],
      pubmedDatabanks: [],
      pubmedConflictOfInterest: ''
    };

    try {
      const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
      const params = new URLSearchParams({
        db: 'pubmed',
        id: pmid,
        retmode: 'xml',
        rettype: 'full'
      });

      const response = await fetch(`${baseUrl}?${params}`);
      if (!response.ok) {
        console.error(`[PubMed] eFetch failed: HTTP ${response.status}`);
        return data;
      }

      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      // Check for XML parsing errors
      if (xmlDoc.querySelector('parsererror')) {
        console.error('[PubMed] XML parsing error');
        return data;
      }

      const article = xmlDoc.querySelector('PubmedArticle');
      if (!article) {
        console.error('[PubMed] No PubmedArticle element found');
        return data;
      }

      // Extract title
      const titleEl = article.querySelector('ArticleTitle');
      if (titleEl) {
        data.pubmedTitle = titleEl.textContent.trim();
      }

      // Extract abstract
      const abstractTexts = article.querySelectorAll('AbstractText');
      if (abstractTexts.length > 0) {
        const abstractParts = [];
        abstractTexts.forEach(absText => {
          const label = absText.getAttribute('Label');
          const text = absText.textContent.trim();
          if (label && label !== 'UNLABELLED') {
            abstractParts.push(`${label}: ${text}`);
          } else {
            abstractParts.push(text);
          }
        });
        data.pubmedAbstract = abstractParts.join('\n\n');
      }

      // Extract journal info
      const journalEl = article.querySelector('Journal');
      if (journalEl) {
        const titleEl = journalEl.querySelector('Title');
        const isoAbbrEl = journalEl.querySelector('ISOAbbreviation');
        data.pubmedJournalFull = titleEl ? titleEl.textContent.trim() : '';
        data.pubmedJournal = isoAbbrEl ? isoAbbrEl.textContent.trim() : data.pubmedJournalFull;
      }

      // Extract volume, issue, pages
      const volumeEl = article.querySelector('Volume');
      if (volumeEl) data.pubmedVolume = volumeEl.textContent.trim();

      const issueEl = article.querySelector('Issue');
      if (issueEl) data.pubmedIssue = issueEl.textContent.trim();

      const paginationEl = article.querySelector('MedlinePgn');
      if (paginationEl) data.pubmedPages = paginationEl.textContent.trim();

      // Extract publication date
      const pubDateEl = article.querySelector('PubDate');
      if (pubDateEl) {
        const year = pubDateEl.querySelector('Year')?.textContent || '';
        const month = pubDateEl.querySelector('Month')?.textContent || '';
        const day = pubDateEl.querySelector('Day')?.textContent || '';
        
        data.pubmedYear = year;
        
        if (year && month && day) {
          // Convert month name to number if needed
          const monthNum = this.getMonthNumber(month);
          data.pubmedPublishDate = `${year}-${monthNum.padStart(2, '0')}-${day.padStart(2, '0')}`;
        } else if (year && month) {
          const monthNum = this.getMonthNumber(month);
          data.pubmedPublishDate = `${year}-${monthNum.padStart(2, '0')}`;
        } else if (year) {
          data.pubmedPublishDate = year;
        }
      }

      // Extract DOI from ArticleIdList
      const articleIds = article.querySelectorAll('ArticleId');
      articleIds.forEach(idEl => {
        if (idEl.getAttribute('IdType') === 'doi') {
          data.pubmedDOI = idEl.textContent.trim();
        }
      });

      // Extract authors
      const authorList = article.querySelectorAll('Author');
      const authors = [];

      authorList.forEach(authorEl => {
        const lastName = authorEl.querySelector('LastName')?.textContent.trim() || '';
        const foreName = authorEl.querySelector('ForeName')?.textContent.trim() || '';
        const initials = authorEl.querySelector('Initials')?.textContent.trim() || '';
        
        const author = {
          lastName: lastName,
          foreName: foreName,
          initials: initials,
          fullName: foreName && lastName ? `${foreName} ${lastName}` : (lastName || foreName || ''),
          orcid: '',
          affiliations: [],
          email: ''
        };

        // Extract ORCID
        const identifiers = authorEl.querySelectorAll('Identifier');
        identifiers.forEach(idEl => {
          if (idEl.getAttribute('Source') === 'ORCID') {
            let orcid = idEl.textContent.trim();
            // Clean up ORCID - remove URL if present
            orcid = orcid.replace('https://orcid.org/', '').replace('http://orcid.org/', '');
            author.orcid = orcid;
          }
        });

        // Extract affiliations
        const affils = authorEl.querySelectorAll('Affiliation');
        affils.forEach(affilEl => {
          const affText = affilEl.textContent.trim();
          if (affText) {
            author.affiliations.push(affText);
            // Try to extract email from affiliation text
            const emailMatch = affText.match(/[\w.-]+@[\w.-]+\.\w+/);
            if (emailMatch && !author.email) {
              author.email = emailMatch[0];
            }
          }
        });

        authors.push(author);
      });

      data.pubmedAuthorsAll = authors;
      data.pubmedAuthorCount = authors.length;

      // Extract first and last author
      if (authors.length > 0) {
        const firstAuthor = authors[0];
        data.pubmedAuthorFirst = firstAuthor.fullName;
        data.pubmedAuthorFirstORCID = firstAuthor.orcid;
        data.pubmedAuthorFirstAffiliations = firstAuthor.affiliations;
        data.pubmedAuthorFirstEmail = firstAuthor.email;

        const lastAuthor = authors[authors.length - 1];
        data.pubmedAuthorLast = lastAuthor.fullName;
        data.pubmedAuthorLastORCID = lastAuthor.orcid;
        data.pubmedAuthorLastAffiliations = lastAuthor.affiliations;
        data.pubmedAuthorLastEmail = lastAuthor.email;
      }

      // Extract MeSH terms
      const meshHeadings = article.querySelectorAll('MeshHeading');
      const meshTerms = [];
      meshHeadings.forEach(meshEl => {
        const descriptorEl = meshEl.querySelector('DescriptorName');
        if (descriptorEl) {
          meshTerms.push(descriptorEl.textContent.trim());
        }
      });
      data.pubmedMeSHTerms = meshTerms;

      // Extract keywords
      const keywordList = article.querySelectorAll('Keyword');
      const keywords = [];
      keywordList.forEach(kwEl => {
        keywords.push(kwEl.textContent.trim());
      });
      data.pubmedKeywords = keywords;

      // Extract grants
      const grantList = article.querySelectorAll('Grant');
      const grants = [];
      grantList.forEach(grantEl => {
        const grantId = grantEl.querySelector('GrantID')?.textContent.trim() || '';
        const agency = grantEl.querySelector('Agency')?.textContent.trim() || '';
        const country = grantEl.querySelector('Country')?.textContent.trim() || '';
        
        if (grantId || agency) {
          grants.push({
            grantId: grantId,
            agency: agency,
            country: country
          });
        }
      });
      data.pubmedGrants = grants;

      // Extract databanks (GenBank, ClinicalTrials.gov, etc.)
      const databankList = article.querySelectorAll('DataBank');
      const databanks = [];
      databankList.forEach(dbEl => {
        const name = dbEl.querySelector('DataBankName')?.textContent.trim() || '';
        const accessions = dbEl.querySelectorAll('AccessionNumber');
        
        accessions.forEach(accEl => {
          databanks.push({
            name: name,
            accession: accEl.textContent.trim()
          });
        });
      });
      data.pubmedDatabanks = databanks;

      // Extract conflict of interest statement
      const coiStatements = article.querySelectorAll('CoiStatement');
      if (coiStatements.length > 0) {
        data.pubmedConflictOfInterest = coiStatements[0].textContent.trim();
      }

      console.log(`[PubMed] eFetch: ${data.pubmedAuthorCount} authors, ${data.pubmedMeSHTerms.length} MeSH terms`);
      return data;

    } catch (error) {
      console.error('[PubMed] Error in fetchPubMedDetails:', error);
      return data;
    }
  },

  /**
   * Helper function to convert month name to number
   * @param {string} month - Month name or number
   * @returns {string} - Month number as string (01-12)
   */
  getMonthNumber(month) {
    const monthMap = {
      'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
      'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
      'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
      'January': '01', 'February': '02', 'March': '03', 'April': '04',
      'May': '05', 'June': '06', 'July': '07', 'August': '08',
      'September': '09', 'October': '10', 'November': '11', 'December': '12'
    };

    // If already a number, return it
    if (/^\d+$/.test(month)) {
      return month.padStart(2, '0');
    }

    return monthMap[month] || '01';
  }
};

// Export for use in popup.js
window.PubMedLookup = PubMedLookup;
