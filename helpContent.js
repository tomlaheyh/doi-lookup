// helpContent.js - Help text and styles for Awesome DOI Lookup
// Ver 1.0 Feb-2026

const DOIHelp = {

  version: '1.0 — Feb 2026',

  helpItems: [
    // =====================
    // GETTING STARTED
    // =====================
    {
      section: 'Getting Started',
      label: 'What is this tool?',
      description: 'Awesome DOI Lookup retrieves article metadata, metrics, author information, and external links for any DOI (Digital Object Identifier). It queries over a dozen data sources in real time and presents a consolidated summary.',
      ref: 'https://www.doi.org/'
    },
    {
      label: 'Entering DOIs',
      description: 'Enter a DOI in standard format (e.g. <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">10.1038/s41586-025-09227-0</code>) or as a full URL (e.g. <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">https://doi.org/10.1038/...</code>). The URL prefix is stripped automatically. Press <strong>Enter</strong> to submit, or <strong>Shift+Enter</strong> for a new line.',
      ref: null
    },
    {
      label: 'Batch lookup (up to 10 DOIs)',
      description: 'Separate multiple DOIs with commas. Duplicates are removed automatically, and the list is capped at 10. Each DOI is looked up sequentially, and errors on one DOI will not stop the rest.',
      ref: null
    },
    {
      label: 'ISBN → WorldCat',
      description: 'Enter an ISBN-10 or ISBN-13 (with or without hyphens) to open the book\'s page on WorldCat. Prefixes like <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">ISBN:</code> or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">ISBN-13:</code> are stripped automatically.',
      ref: 'https://search.worldcat.org/'
    },
    {
      label: 'Text search → WorldCat',
      description: 'Any input that doesn\'t match a DOI, ISSN, ISBN, ORCID, or PMID pattern is sent as a general search to WorldCat. This works for titles, authors, keywords, or any combination — for example <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">Brief History of Time</code> or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">Jane Goodall</code>.',
      ref: 'https://search.worldcat.org/'
    },
    {
      label: 'Shareable URLs',
      description: 'After a lookup, the browser URL updates to include a <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">?doi=</code> query parameter. You can copy and share this URL — anyone opening it will automatically run the same lookup. Comma-separated DOIs are supported in the URL as well.',
      ref: null
    },
    {
      label: 'Caching',
      description: 'Results are cached in your browser\'s localStorage for 24 hours. Cached lookups are nearly instant and show <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">[Cache] HIT</code> in the console. To force a fresh lookup, clear your browser\'s localStorage or wait 24 hours.',
      ref: null
    },
    // =====================
    // SUMMARY SECTION
    // =====================
    {
      section: 'Summary Card',
      label: 'DOI + Free PDF link',
      description: 'The DOI is shown at the top with a link to <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">doi.org</code>. If a free full-text version is available (from PMC via PubMed, or from Unpaywall), a green "Free PDF" or "Free Manuscript" link appears next to it.',
      ref: 'https://unpaywall.org/'
    },
    {
      label: 'Title + Abstract',
      description: 'The article title is shown in bold. If the article has been retracted, "RETRACTED:" is prepended in red. A truncated abstract is shown below (from PubMed when available, otherwise from CrossRef). Click "full abstract" to see the complete text in a popup.',
      ref: null
    },
    {
      label: 'Retractions / Updates',
      description: `Shows retraction and correction status from two independent sources:

<strong>CrossRef:</strong> Uses the <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">update-to</code> and <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">updated-by</code> fields. Detects: retraction, correction, expression of concern, reinstatement, and withdrawal. Sources include publishers and Retraction Watch.

<strong>PubMed:</strong> Uses eSummary references (Erratum in, Retraction in, Retraction of) and publication types (Retracted Publication, Published Erratum, Retraction of Publication).

Retractions and Expressions of Concern override the quality badge. "None" means the source was checked and nothing was found; "N/A" means the source was not available (e.g. article not in PubMed).`,
      ref: 'https://www.crossref.org/blog/linking-corrections-and-retractions/'
    },
    {
      label: 'Quality badge',
      description: `Quality is determined by the journal's SJR (SCImago Journal Rank) score:

<strong>High Quality</strong> (green) — SJR ≥ 3
<strong>Good Quality</strong> (yellow) — SJR ≥ 0.8
<strong>Low Quality</strong> (grey) — SJR < 0.8
<strong>Quality Unknown</strong> — no SJR data available

This is overridden by <span style="color:#cc0000;font-weight:bold;">Retracted</span> or <span style="color:#e07000;font-weight:bold;">Expression of Concern</span> when applicable.

Note: SJR measures journal-level visibility, not individual article quality. It is one signal among many.`,
      ref: 'https://www.scimagojr.com/aboutus.php'
    },
    // =====================
    // CITATIONS & METRICS
    // =====================
    {
      section: 'Citations & Metrics',
      label: 'Citations — CrossRef, OpenAlex, Semantic Scholar, iCite',
      description: `Citation counts are shown from up to four sources. Counts may differ because each source has a different corpus and update cadence:

<strong>CrossRef:</strong> Publisher-deposited citation links. Broadest coverage.
<strong>OpenAlex:</strong> Open bibliometric database built from multiple sources including CrossRef and MAG.
<strong>Semantic Scholar:</strong> AI-powered academic search. Also reports "influential citations" — citations where the citing paper meaningfully builds on this work, detected via machine learning.
<strong>iCite:</strong> NIH's citation analysis tool. Only available for articles with a PubMed ID (PMID).`,
      ref: 'https://icite.od.nih.gov/'
    },
    {
      label: 'RCR = Relative Citation Ratio',
      description: 'From NIH iCite. Defined as "the citations per year of each paper, normalized to citations per year received by NIH-funded papers in the same field and year." An RCR of 1.0 means average for its field. Only available for PubMed-indexed articles. Displays "N/A" otherwise.',
      ref: 'https://support.icite.nih.gov/hc/en-us/articles/9062490125083-Metrics'
    },
    {
      label: 'Grants / Funders',
      description: 'Funding information is shown from PubMed (preferred) or OpenAlex (fallback). Grants are grouped by agency and deduplicated. Grant IDs are shown in monospace. If the article is in PubMed but no grants are reported, "None reported" is shown explicitly so you know it was checked.',
      ref: null
    },
    {
      label: 'OpenAIRE — Popularity, Influence, Impulse',
      description: `OpenAIRE BIP (Bibliometric Impact Profile) metrics rank articles relative to their field:

<strong>Popularity:</strong> Recent attention / citation momentum (Top 1%, 10%, 25%, 50%, or Bottom 50%)
<strong>Influence:</strong> Overall citation-based prestige
<strong>Impulse:</strong> Early citation rate (how fast it gained attention)

These are percentile-based classes, not raw counts.`,
      ref: 'https://graph.openaire.eu/docs/data-model/pids/bipfinder'
    },
    // =====================
    // JOURNAL-LEVEL DATA
    // =====================
    {
      section: 'Journal-Level Data',
      label: 'SJR = SCImago Journal Rank',
      description: 'A widely respected, free journal ranking. SJR measures journal visibility using an algorithm similar to Google\'s PageRank™, analyzing citation networks across Scopus-indexed journals. The score is looked up from a bundled CSV file matched by ISSN. The link goes to the journal\'s SCImago charts page.',
      ref: 'https://www.scimagojr.com/aboutus.php'
    },
    {
      label: 'DOAJ = Directory of Open Access Journals',
      description: 'Indicates whether the journal is listed in DOAJ, a curated index of reputable open access journals. When found, also shows the journal\'s APC (Article Processing Charge) and licence type (e.g. CC BY). "No" means the journal was looked up but not found in DOAJ.',
      ref: 'https://doaj.org/'
    },
    {
      label: 'ISSN links',
      description: 'ISSNs (International Standard Serial Numbers) are shown with links to the ISSN Portal, which provides authoritative journal identity data including publisher, country, and linked ISSNs.',
      ref: 'https://portal.issn.org/'
    },
    // =====================
    // PUBMED
    // =====================
    {
      section: 'PubMed Data',
      label: 'PubMed: Yes / No',
      description: 'Shows whether the article was found in PubMed (searched by DOI). Many biomedical articles are in PubMed; datasets, software, and non-biomedical articles typically are not.',
      ref: 'https://pubmed.ncbi.nlm.nih.gov/'
    },
    {
      label: 'Medline',
      description: 'Indicates whether the article has been indexed for MEDLINE, the NLM\'s premier bibliographic database. MEDLINE indexing means the article has been reviewed and assigned MeSH terms by NLM indexers. Not all PubMed articles are MEDLINE-indexed.',
      ref: 'https://www.nlm.nih.gov/medline/medline_overview.html'
    },
    {
      label: 'Preprint',
      description: 'Detected via PubMed\'s pubstatus field, publication types, and journal name matching against known preprint servers (bioRxiv, medRxiv, Research Square, SSRN, arXiv). Preprints have not undergone formal peer review.',
      ref: 'https://pmc.ncbi.nlm.nih.gov/about/nihpreprints/'
    },
    {
      label: 'PMC (PubMed Central)',
      description: 'If the article is available in PMC, a free full-text link is provided. PMC is the NIH\'s free full-text archive. This is checked via PubMed eSummary article IDs and takes priority over Unpaywall for the "Free PDF" link.',
      ref: 'https://www.ncbi.nlm.nih.gov/pmc/'
    },
    // =====================
    // AUTHORS
    // =====================
    {
      section: 'Authors',
      label: 'First and last authors',
      description: `In academic convention, first author typically led the work, last author typically supervised. This convention is widely followed across disciplines, though the majority of users — including many librarians — may not be aware of it. Articles often have many authors, but the first and last positions carry the most significance.

Author information is merged from up to three sources: the Registration Agency (CrossRef, DataCite, etc.), PubMed, and OpenAlex. The tool picks the source with the most ORCID coverage — RA wins ties. When the chosen source lacks ORCIDs but OpenAlex has them, the OpenAlex ORCIDs are used as a fallback.

An ORCID comparison table is shown at the bottom of the summary, displaying author names and ORCIDs from all three sources for transparency.`,
      ref: 'https://orcid.org/'
    },
    {
      label: 'Author metrics (from OpenAlex)',
      description: `When an ORCID is available, author-level metrics are fetched from OpenAlex:

<strong>h-index:</strong> Minimum number of citations across papers. Example: 12 papers all with ≥12 citations = h-index of 12.
<strong>i10-index:</strong> Number of papers with ≥10 citations.
<strong>2yr citation rate:</strong> Average citations per paper over 2 years.

Different sources (Google Scholar, Scopus, Web of Science) calculate these metrics slightly differently due to varying citation databases.`,
      ref: 'https://en.wikipedia.org/wiki/Author-level_metrics'
    },
    // =====================
    // EXTERNAL LINKS
    // =====================
    {
      section: 'External Links & Discovery',
      label: 'Altmetric',
      description: 'Links to the Altmetric details page for the DOI. The Altmetric Attention Score measures online attention including social media, news, policy documents, and blog mentions.',
      ref: 'https://help.altmetric.com/en/articles/9800513'
    },
    {
      label: 'CORE',
      description: 'CORE aggregates open access research outputs from repositories and journals worldwide. The link searches for the DOI in CORE\'s index.',
      ref: 'https://core.ac.uk/about'
    },
    {
      label: 'Dimensions',
      description: 'Dimensions is a research analytics platform. The link searches for the DOI. Note: a free account is required to access Dimensions.',
      ref: 'https://www.dimensions.ai/'
    },
    {
      label: 'Google Scholar',
      description: 'Links to a Google Scholar search for the DOI. Google Scholar provides its own citation counts and related articles.',
      ref: 'https://scholar.google.com/intl/en/scholar/about.html'
    },
    // =====================
    // REGISTRATION AGENCIES
    // =====================
    {
      section: 'Registration Agencies',
      label: 'What is a Registration Agency (RA)?',
      description: `Every DOI is registered with a specific Registration Agency. The tool auto-detects the RA and routes to the appropriate API:

<strong>CrossRef</strong> — journals and articles (~90% of research DOIs). Full API.
<strong>DataCite</strong> — datasets, software, grey literature (~8%). Full API.
<strong>JaLC</strong> — Japanese publications. Full API, bilingual (English/Japanese).
<strong>mEDRA</strong> — European publications. Full API, XML/ONIX format.
<strong>CNKI</strong> — Chinese publications. Paid API only, restricted outside mainland China.
<strong>ISTIC</strong> — Chinese publications via Wanfang Data. No public API.
<strong>KISTI</strong> — Korean publications. Very rare; most Korean journals use CrossRef.

CrossRef and DataCite together represent over 95% of all research DOIs.`,
      ref: 'https://www.doi.org/the-community/existing-registration-agencies/'
    },
    // =====================
    // DETAILS SECTION
    // =====================
    {
      section: 'Details Panel',
      label: 'Details (collapsed by default)',
      description: 'Click "Details" to expand the full metadata panel. This includes raw data from the International DOI Foundation (handle timestamps, resolves-to URL), full article details from the RA (title, journal, volume, issue, pages, type, language, abstract, copyright), and raw PubMed metadata (MeSH terms, keywords, databanks, conflict of interest statements).',
      ref: null
    },
    {
      label: 'Links section (in Details)',
      description: `The "Links" section shows every external service checked, with Web and Data (API) links for each. Services are grouped into:

<strong>DOI Resolution:</strong> doi.org, CrossRef, DataCite, JaLC, mEDRA, plus other RAs without APIs.
<strong>Article Metrics:</strong> Semantic Scholar, OpenAlex, Unpaywall, Altmetric, DOAJ, CORE, OpenAIRE, Dimensions, PubMed, PMC, iCite, and Retraction Watch status.
<strong>Journal Metrics:</strong> ISSN Portal, DOAJ (journal-level), SJR, OpenAlex.
<strong>Author:</strong> OpenAlex and PubMed author searches (when ORCID is available).

Blue links are available; greyed-out links mean the service did not have data for this DOI.`,
      ref: null
    },
    // =====================
    // CSV EXPORT
    // =====================
    {
      section: 'CSV Export',
      label: 'Export CSV',
      description: 'After looking up DOIs, click "Export CSV" to download a spreadsheet with one row per DOI. Each result card has a checkbox (enabled by default) — uncheck a card to exclude it from the export. Unchecked cards are greyed out. The CSV includes 25 columns covering DOI, title, journal, publisher, year, volume, issue, pages, type, ISSN, authors, ORCIDs, citation counts from multiple sources, RCR, SJR, DOAJ status, PubMed status, free PDF URL, funders, and grant numbers.',
      ref: null
    },
    // =====================
    // DATA SOURCES
    // =====================
    {
      section: 'Data Sources & Privacy',
      label: 'Data sources',
      description: `This tool queries the following public APIs in real time — no data is stored on any server:

CrossRef, DataCite, JaLC, mEDRA (Registration Agency APIs)
PubMed / NCBI (eSearch, eSummary, eFetch)
iCite (NIH citation metrics)
OpenAlex (bibliometrics, author metrics, grants)
Semantic Scholar (citations, influential citations)
Unpaywall (open access detection)
DOAJ (open access journal directory)
CORE (open access aggregator)
OpenAIRE (European research metrics)
ISSN Portal (journal identity)
SJR (journal ranking, from bundled CSV)

All API calls are made directly from your browser. There is no backend server, no tracking, and no user data collection.`,
      ref: 'https://github.com/tomlaheyh/doi-lookup'
    },
  ],

  // Generate HTML for help items
  generateHelpHTML() {
    let html = '';
    let currentSection = null;

    this.helpItems.forEach((item, index) => {
      // Section header
      if (item.section && item.section !== currentSection) {
        if (currentSection !== null) {
          html += '<hr style="border:none;border-top:2px solid #d8d5cc;margin:18px 0;">';
        }
        currentSection = item.section;
        html += `<div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#005a8c;margin:16px 0 10px;">${item.section}</div>`;
      }

      const refLink = item.ref
        ? ` <a href="${item.ref}" target="_blank" style="color:#005a8c;font-size:11px;font-weight:400;text-decoration:none;margin-left:6px;">Ref ↗</a>`
        : '';

      html += `<div style="margin-bottom:10px;">`;
      html += `<div style="margin-bottom:3px;"><strong style="color:#1a1a18;font-size:14px;">${item.label}</strong>${refLink}</div>`;
      html += `<div style="color:#555;font-size:13px;line-height:1.55;font-weight:300;white-space:pre-line;">${item.description}</div>`;
      html += `</div>`;

      // Separator between items within same section
      const nextItem = this.helpItems[index + 1];
      if (nextItem && !nextItem.section) {
        html += '<hr style="border:none;border-top:1px solid #eee;margin:10px 0;">';
      }
    });

    // Version footer
    html += `<div style="text-align:center;color:#888880;font-family:'IBM Plex Mono',monospace;font-size:11px;padding:14px 0 4px;border-top:1px solid #eee;margin-top:16px;">Awesome DOI Lookup — v${this.version}</div>`;

    return html;
  },

  // Create and show the help modal
  showHelpModal() {
    // Remove existing if present
    const existing = document.getElementById('doi-help-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'doi-help-modal';
    overlay.style.cssText = `
      position: fixed;
      z-index: 10001;
      left: 0; top: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #fff;
      width: 90%;
      max-width: 680px;
      max-height: 82vh;
      border: 1.5px solid #d8d5cc;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.25);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 14px 20px;
      border-bottom: 2px solid #1a1a18;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f4f3ef;
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <div>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:600;color:#1a1a18;letter-spacing:-0.3px;">Help</span>
        <span style="font-family:'IBM Plex Sans',sans-serif;font-size:12px;color:#888880;margin-left:10px;font-weight:300;">Awesome DOI Lookup</span>
      </div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      font-size: 24px;
      font-weight: 600;
      cursor: pointer;
      color: #888880;
      background: none;
      border: none;
      width: 32px; height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IBM Plex Mono', monospace;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.color = '#1a1a18'; closeBtn.style.background = '#e8e6e0'; };
    closeBtn.onmouseout  = () => { closeBtn.style.color = '#888880'; closeBtn.style.background = 'none'; };
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.style.cssText = `
      padding: 20px 24px;
      overflow-y: auto;
      flex: 1;
      font-family: 'IBM Plex Sans', sans-serif;
      font-weight: 300;
      color: #1a1a18;
    `;
    body.innerHTML = this.generateHelpHTML();

    // Assemble
    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    // Click overlay to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Escape key to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
  }
};

// Export for use
window.DOIHelp = DOIHelp;
