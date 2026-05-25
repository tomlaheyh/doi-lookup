// citationBuilder.js - Citation formatting for Awesome DOI-Ref-Lookup
// Supports APA 7th, AMA 11th, MLA 9th, Vancouver/ICMJE, and RIS export
// Ver 1.0 Apr-2026

const CitationBuilder = {

  /**
   * Extract a structured data object from the result for citation formatting.
   * Gathers authors, title, journal, date, volume, issue, pages, DOI from all sources.
   */
  extractCiteData(result) {
    const data = {};

    data.doi = result.doiOrgDoi || null;
    data.title = result.doiOrgTitle || result.raTitle || result.pubmedTitle || '';
    data.journal = result.doiOrgJournal || result.raJournal || result.pubmedJournalFull || result.pubmedJournal || '';
    data.journalAbbrev = result.pubmedJournal || result.raShortJournal || data.journal || '';
    data.publisher = result.doiOrgPublisher || result.raPublisher || '';
    data.volume = result.doiOrgVolume || result.raVolume || result.pubmedVolume || '';
    data.issue = result.doiOrgIssue || result.raIssue || result.pubmedIssue || '';
    data.type = result.doiOrgType || result.raType || '';

    // Pages — from RA or PubMed
    const rawPages = result.doiOrgPages || result.raPage || result.pubmedPages || '';
    data.pages = rawPages;
    data.startPage = '';
    data.endPage = '';
    if (rawPages && rawPages.includes('-')) {
      const parts = rawPages.split('-');
      data.startPage = parts[0].trim();
      data.endPage = parts[parts.length - 1].trim();
    } else if (rawPages) {
      data.startPage = rawPages.trim();
    }

    // Article number (e-locator) — CrossRef sometimes has this instead of pages
    data.articleNumber = result.raArticleNumber || '';

    // Date
    const dateStr = result.doiOrgPublishedDate || result.raPublishedOnline || result.raPublishedPrint || result.raIssued || result.pubmedPublishDate || '';
    data.dateRaw = dateStr;
    data.year = '';
    data.month = '';
    data.day = '';
    if (dateStr) {
      const parts = dateStr.split('-');
      data.year = parts[0] || '';
      if (parts[1]) data.month = parts[1];
      if (parts[2]) data.day = parts[2];
    }
    if (!data.year && result.pubmedYear) {
      data.year = result.pubmedYear;
    }

    // PMID
    data.pmid = result.pubmedPMID || '';

    // Authors — parse from RA JSON (CrossRef/DataCite format)
    // Shape: [{ given, family, name, ORCID }, ...]
    data.authors = [];
    const authRaw = result.raAuthors || result.doiOrgAuthors || null;
    if (authRaw) {
      try {
        const arr = typeof authRaw === 'string' ? JSON.parse(authRaw) : authRaw;
        if (Array.isArray(arr)) {
          data.authors = arr.map(a => ({
            given: a.given || '',
            family: a.family || '',
            name: a.name || '',  // organizational author
          }));
        }
      } catch (e) { /* skip */ }
    }

    // Fallback to PubMed authors if RA had none
    if (data.authors.length === 0 && result.pubmedAuthorsAll && result.pubmedAuthorsAll.length > 0) {
      data.authors = result.pubmedAuthorsAll.map(a => ({
        given: a.foreName || a.initials || '',
        family: a.lastName || '',
        name: '',
      }));
    }

    // ISSN
    data.issn = '';
    const issnRaw = result.doiOrgIssn || result.raIssn || '';
    if (issnRaw) {
      try {
        const arr = typeof issnRaw === 'string' && issnRaw.startsWith('[') ? JSON.parse(issnRaw) : [issnRaw];
        data.issn = arr[0] || '';
      } catch (e) { data.issn = issnRaw; }
    }

    return data;
  },

  // ========================================================================
  // AUTHOR FORMATTING HELPERS
  // ========================================================================

  /** Get display name for an author — handles organizational authors */
  _authorDisplay(a) {
    if (a.family || a.given) return { given: a.given, family: a.family };
    if (a.name) return { given: '', family: a.name };
    return { given: '', family: '' };
  },

  /** Get initials from a given name: "Timothy J." → "T. J." */
  _initials(given) {
    if (!given) return '';
    return given.trim().split(/[\s-]+/).map(p => {
      if (!p) return '';
      // Already an initial like "J." or "J"
      if (p.length <= 2) return p.endsWith('.') ? p : p + '.';
      return p[0].toUpperCase() + '.';
    }).join(' ');
  },

  /** Get first initial only: "Timothy J." → "T." */
  _firstInitial(given) {
    if (!given) return '';
    const first = given.trim().split(/[\s-]+/)[0];
    if (!first) return '';
    if (first.length <= 2) return first.endsWith('.') ? first : first + '.';
    return first[0].toUpperCase() + '.';
  },

  // ========================================================================
  // APA 7th Edition
  // ========================================================================
  // Author, A. A., & Author, B. B. (Year). Title of article. Journal Name, Volume(Issue), pages. https://doi.org/xx
  // - Up to 20 authors listed; 21+ use first 19 ... last author
  // - Journal name italicised, volume italicised

  formatAPA(data, overridePages) {
    const pages = overridePages || data.pages;
    let parts = [];

    // Authors
    const auths = data.authors.map(a => {
      const d = this._authorDisplay(a);
      if (!d.family) return '';
      const init = this._initials(d.given);
      return init ? `${d.family}, ${init}` : d.family;
    }).filter(Boolean);

    if (auths.length === 0) {
      parts.push(data.title ? data.title + '.' : '');
    } else if (auths.length === 1) {
      parts.push(auths[0] + '.');
    } else if (auths.length <= 20) {
      const last = auths.pop();
      parts.push(auths.join(', ') + ', & ' + last + '.');
    } else {
      // 21+ authors: first 19 ... last
      const first19 = auths.slice(0, 19);
      const last = auths[auths.length - 1];
      parts.push(first19.join(', ') + ', . . . ' + last + '.');
    }

    // Year
    parts.push(`(${data.year || 'n.d.'}).`);

    // Title (sentence case, no italics)
    if (data.title) {
      let title = data.title;
      // Ensure ends with period
      if (!title.endsWith('.') && !title.endsWith('?') && !title.endsWith('!')) title += '.';
      parts.push(title);
    }

    // Journal (italic), Volume(Issue), pages
    let journalPart = '';
    if (data.journal) {
      journalPart = `<i>${this._escHtml(data.journal)}</i>`;
      if (data.volume) {
        journalPart += `, <i>${this._escHtml(data.volume)}</i>`;
        if (data.issue) journalPart += `(${this._escHtml(data.issue)})`;
      }
      if (pages) {
        journalPart += `, ${pages}`;
      } else if (data.articleNumber) {
        journalPart += `, Article ${data.articleNumber}`;
      }
      journalPart += '.';
    }
    if (journalPart) parts.push(journalPart);

    // DOI
    if (data.doi) {
      parts.push(`https://doi.org/${data.doi}`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // AMA 11th Edition
  // ========================================================================
  // Author AA, Author BB. Title. Journal Abbrev. Year;Volume(Issue):pages. doi:xx
  // - Up to 6 authors; 7+ use first 3 et al
  // - Journal abbreviated, not italicised

  formatAMA(data, overridePages) {
    const pages = overridePages || data.pages;
    let parts = [];

    // Authors — initials without periods/spaces: "Timothy J." → "TJ"
    const amaInitials = (given) => {
      if (!given) return '';
      return given.trim().split(/[\s-]+/).map(p => {
        if (!p) return '';
        return p[0].toUpperCase();
      }).join('');
    };

    const auths = data.authors.map(a => {
      const d = this._authorDisplay(a);
      if (!d.family) return '';
      const init = amaInitials(d.given);
      return init ? `${d.family} ${init}` : d.family;
    }).filter(Boolean);

    if (auths.length === 0) {
      // no authors
    } else if (auths.length <= 6) {
      parts.push(auths.join(', ') + '.');
    } else {
      parts.push(auths.slice(0, 3).join(', ') + ', et al.');
    }

    // Title
    if (data.title) {
      let title = data.title;
      if (!title.endsWith('.') && !title.endsWith('?') && !title.endsWith('!')) title += '.';
      parts.push(title);
    }

    // Journal (abbreviated), year, volume, issue, pages
    let journalPart = '';
    if (data.journalAbbrev || data.journal) {
      journalPart = `<i>${this._escHtml(data.journalAbbrev || data.journal)}</i>.`;
      if (data.year) {
        journalPart += ` ${data.year}`;
      }
      if (data.volume) {
        journalPart += `;${data.volume}`;
        if (data.issue) journalPart += `(${this._escHtml(data.issue)})`;
      }
      if (pages) {
        journalPart += `:${pages}`;
      } else if (data.articleNumber) {
        journalPart += `:${data.articleNumber}`;
      }
      journalPart += '.';
    }
    if (journalPart) parts.push(journalPart);

    // DOI
    if (data.doi) {
      parts.push(`doi:${data.doi}`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // MLA 9th Edition
  // ========================================================================
  // Author. "Title." Journal, vol. V, no. I, Year, pp. X–Y. DOI link.
  // - 1 author: Last, First.
  // - 2 authors: Last, First, and First Last.
  // - 3+: Last, First, et al.

  formatMLA(data, overridePages) {
    const pages = overridePages || data.pages;
    let parts = [];

    // Authors
    const auths = data.authors.map(a => this._authorDisplay(a)).filter(a => a.family);

    if (auths.length === 0) {
      // no authors
    } else if (auths.length === 1) {
      const a = auths[0];
      parts.push((a.given ? `${a.family}, ${a.given}.` : `${a.family}.`));
    } else if (auths.length === 2) {
      const first = auths[0];
      const second = auths[1];
      parts.push(`${first.family}, ${first.given || ''}, and ${second.given || ''} ${second.family}.`);
    } else {
      const first = auths[0];
      parts.push(`${first.family}, ${first.given || ''}, et al.`);
    }

    // Title in quotes
    if (data.title) {
      let title = data.title;
      // Remove trailing period for quoting
      if (title.endsWith('.')) title = title.slice(0, -1);
      parts.push(`\u201c${title}.\u201d`);
    }

    // Journal (italic), vol., no., year, pp.
    let journalParts = [];
    if (data.journal) {
      journalParts.push(`<i>${this._escHtml(data.journal)}</i>`);
    }
    if (data.volume) journalParts.push(`vol. ${data.volume}`);
    if (data.issue) journalParts.push(`no. ${data.issue}`);
    if (data.year) journalParts.push(data.year);
    if (pages) {
      journalParts.push(`pp. ${pages}`);
    } else if (data.articleNumber) {
      journalParts.push(`${data.articleNumber}`);
    }
    if (journalParts.length > 0) {
      parts.push(journalParts.join(', ') + '.');
    }

    // DOI as URL
    if (data.doi) {
      parts.push(`https://doi.org/${data.doi}`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // Vancouver / ICMJE
  // ========================================================================
  // Author AA, Author BB. Title. Journal Abbrev. Year;Vol(Issue):pages. doi:xx
  // - Up to 6 authors; 7+ use first 6 et al
  // - Very similar to AMA but slightly different author cutoff

  formatVancouver(data, overridePages) {
    const pages = overridePages || data.pages;
    let parts = [];

    // Authors — initials without periods: "Timothy J." → "TJ"
    const vanInitials = (given) => {
      if (!given) return '';
      return given.trim().split(/[\s-]+/).map(p => {
        if (!p) return '';
        return p[0].toUpperCase();
      }).join('');
    };

    const auths = data.authors.map(a => {
      const d = this._authorDisplay(a);
      if (!d.family) return '';
      const init = vanInitials(d.given);
      return init ? `${d.family} ${init}` : d.family;
    }).filter(Boolean);

    if (auths.length === 0) {
      // no authors
    } else if (auths.length <= 6) {
      parts.push(auths.join(', ') + '.');
    } else {
      parts.push(auths.slice(0, 6).join(', ') + ', et al.');
    }

    // Title
    if (data.title) {
      let title = data.title;
      if (!title.endsWith('.') && !title.endsWith('?') && !title.endsWith('!')) title += '.';
      parts.push(title);
    }

    // Journal (abbreviated)
    let journalPart = '';
    if (data.journalAbbrev || data.journal) {
      journalPart = (data.journalAbbrev || data.journal) + '.';
      if (data.year) {
        journalPart += ` ${data.year}`;
      }
      if (data.volume) {
        journalPart += `;${data.volume}`;
        if (data.issue) journalPart += `(${this._escHtml(data.issue)})`;
      }
      if (pages) {
        journalPart += `:${pages}`;
      } else if (data.articleNumber) {
        journalPart += `:${data.articleNumber}`;
      }
      journalPart += '.';
    }
    if (journalPart) parts.push(journalPart);

    // DOI
    if (data.doi) {
      parts.push(`doi:${data.doi}`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // RIS Export
  // ========================================================================

  generateRIS(data, overridePages) {
    const pages = overridePages || data.pages;
    const lines = [];

    // Type
    const typeMap = {
      'journal-article': 'JOUR',
      'book-chapter': 'CHAP',
      'book': 'BOOK',
      'proceedings-article': 'CPAPER',
      'dataset': 'DATA',
      'dissertation': 'THES',
      'preprint': 'JOUR',
    };
    lines.push(`TY  - ${typeMap[data.type] || 'JOUR'}`);

    // Authors
    data.authors.forEach(a => {
      const d = this._authorDisplay(a);
      if (d.family) {
        lines.push(`AU  - ${d.family}, ${d.given || ''}`);
      }
    });

    // Title
    if (data.title) lines.push(`TI  - ${data.title}`);

    // Journal
    if (data.journal) lines.push(`JO  - ${data.journal}`);
    if (data.journalAbbrev && data.journalAbbrev !== data.journal) {
      lines.push(`JA  - ${data.journalAbbrev}`);
    }

    // Year / Date
    if (data.year) lines.push(`PY  - ${data.year}`);
    if (data.dateRaw) lines.push(`DA  - ${data.dateRaw}`);

    // Volume, Issue
    if (data.volume) lines.push(`VL  - ${data.volume}`);
    if (data.issue) lines.push(`IS  - ${data.issue}`);

    // Pages
    const sp = overridePages ? (overridePages.includes('-') ? overridePages.split('-')[0].trim() : overridePages.trim()) : data.startPage;
    const ep = overridePages ? (overridePages.includes('-') ? overridePages.split('-').pop().trim() : '') : data.endPage;
    if (sp) lines.push(`SP  - ${sp}`);
    if (ep) lines.push(`EP  - ${ep}`);

    // DOI
    if (data.doi) lines.push(`DO  - ${data.doi}`);

    // PMID
    if (data.pmid) lines.push(`AN  - ${data.pmid}`);

    // Publisher
    if (data.publisher) lines.push(`PB  - ${data.publisher}`);

    // ISSN
    if (data.issn) lines.push(`SN  - ${data.issn}`);

    // URL
    if (data.doi) lines.push(`UR  - https://doi.org/${data.doi}`);

    lines.push('ER  - ');
    return lines.join('\r\n');
  },

  // ========================================================================
  // MODAL
  // ========================================================================

  /**
   * Show the citation modal for a given result object.
   * Called from the "Cite" link on the DOI line.
   */
  showCiteModal(result) {
    // Remove existing modal
    const existing = document.getElementById('cite-modal');
    if (existing) existing.remove();

    const data = this.extractCiteData(result);

    // Pre-fill pages from data
    const currentPages = data.pages || '';

    // Build inline panel (no dark overlay — renders in-page)
    const overlay = document.createElement('div');
    overlay.id = 'cite-modal';
    overlay.style.cssText = 'margin:0 auto 16px; max-width:720px;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:#fff; width:100%; border:1.5px solid #005a8c; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 2px 10px rgba(0,0,0,0.10);';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding:14px 20px; border-bottom:2px solid #1a1a18; display:flex; justify-content:space-between; align-items:center; background:#f4f3ef; flex-shrink:0;';
    header.innerHTML = `<div>
      <span style="font-family:'IBM Plex Mono',monospace; font-size:16px; font-weight:600; color:#1a1a18; letter-spacing:-0.3px;">Cite</span>
      <span style="font-family:'IBM Plex Sans',sans-serif; font-size:12px; color:#888880; margin-left:10px; font-weight:300;">${this._escHtml(data.doi || '')}</span>
    </div>`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.style.cssText = 'font-size:24px; font-weight:600; cursor:pointer; color:#888880; background:none; border:none; width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-family:"IBM Plex Mono",monospace;';
    closeBtn.onmouseover = () => { closeBtn.style.color = '#1a1a18'; closeBtn.style.background = '#e8e6e0'; };
    closeBtn.onmouseout = () => { closeBtn.style.color = '#888880'; closeBtn.style.background = 'none'; };
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:20px 24px; overflow-y:auto; flex:1; font-family:"IBM Plex Sans",sans-serif; font-weight:300; color:#1a1a18;';

    // Page input
    const pageInputId = 'cite-page-input';
    let bodyHtml = `<div style="margin-bottom:16px;">
      <label style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:600; color:#005a8c; letter-spacing:0.5px;">PAGES <span style="font-weight:400; color:#999;">(optional — updates citations below)</span></label>
      <input id="${pageInputId}" type="text" value="${this._escHtml(currentPages)}" placeholder="e.g. 221-230"
        style="display:block; margin-top:4px; width:160px; font-family:'IBM Plex Mono',monospace; font-size:13px; padding:6px 10px; border:1.5px solid #d8d5cc; background:#fff; color:#1a1a18; outline:none;"
        onfocus="this.style.borderColor='#005a8c'" onblur="this.style.borderColor='#d8d5cc'" />
    </div>`;

    // Citation formats container
    bodyHtml += '<div id="cite-formats-container"></div>';

    // Actions row: RIS + ZBib
    bodyHtml += `<div style="margin-top:16px; padding-top:14px; border-top:1px solid #eee; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
      <button id="cite-ris-btn" style="font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:600; padding:8px 18px; background:#005a8c; color:#fff; border:none; cursor:pointer; letter-spacing:0.5px;">Download RIS</button>
      <a href="https://zbib.org/?q=${encodeURIComponent(data.doi ? 'https://doi.org/' + data.doi : '')}" target="_blank" style="font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:600; color:#005a8c; text-decoration:none; padding:8px 0;">ZoteroBib (more styles) \u2192</a>
      <span style="font-size:11px; color:#999; margin-left:auto;">Import RIS into Zotero, Mendeley, EndNote</span>
    </div>`;

    body.innerHTML = bodyHtml;

    // Assemble
    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    // Escape key closes the panel
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Insert inline at the top of the results area (no overlay, page never dims)
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) {
      resultsDiv.insertBefore(overlay, resultsDiv.firstChild);
    } else {
      document.body.appendChild(overlay);
    }
    overlay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Render citations initially
    this._renderCitations(data, currentPages);

    // Wire up page input to re-render on change
    const pageInput = document.getElementById(pageInputId);
    if (pageInput) {
      const rerender = () => this._renderCitations(data, pageInput.value.trim());
      pageInput.addEventListener('input', rerender);
    }

    // Wire up RIS download
    const risBtn = document.getElementById('cite-ris-btn');
    if (risBtn) {
      risBtn.addEventListener('click', () => {
        const pg = document.getElementById(pageInputId)?.value.trim() || '';
        const ris = this.generateRIS(data, pg || null);
        const blob = new Blob([ris], { type: 'application/x-research-info-systems' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = (data.title || 'citation').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
        a.download = `${safeTitle}.ris`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  },

  /**
   * Render all four citation formats into the container.
   */
  _renderCitations(data, overridePages) {
    const container = document.getElementById('cite-formats-container');
    if (!container) return;

    const pg = overridePages || null;
    const styles = [
      { label: 'APA (7th)', result: this.formatAPA(data, pg) },
      { label: 'AMA (11th)', result: this.formatAMA(data, pg) },
      { label: 'Vancouver / ICMJE', result: this.formatVancouver(data, pg) },
      { label: 'MLA (9th)', result: this.formatMLA(data, pg) },
    ];

    let html = '';
    styles.forEach((s, i) => {
      const copyId = `cite-copy-${i}`;
      html += `<div style="margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:600; color:#005a8c; letter-spacing:0.5px;">${s.label}</span>
          <button id="${copyId}"
            style="font-family:'IBM Plex Mono',monospace; font-size:11px; padding:2px 10px; background:#f0f4f8; color:#005a8c; border:1px solid #d8d5cc; cursor:pointer; font-weight:600;">Copy</button>
        </div>
        <div style="font-size:13px; line-height:1.6; color:#333; padding:10px 12px; background:#fafaf8; border:1px solid #eee;">${s.result.html}</div>
      </div>`;
    });

    container.innerHTML = html;

    // Wire up copy buttons after DOM insertion
    styles.forEach((s, i) => {
      const btn = document.getElementById(`cite-copy-${i}`);
      if (btn) {
        btn.addEventListener('click', () => CitationBuilder._copyText(`cite-copy-${i}`, s.result.plain));
      }
    });
  },

  /**
   * Copy citation text to clipboard and flash the button.
   */
  _copyText(btnId, text) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById(btnId);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#d4edda';
        btn.style.color = '#2d6a2d';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = '#f0f4f8';
          btn.style.color = '#005a8c';
        }, 1500);
      }
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  },

  // ========================================================================
  // UTILITY
  // ========================================================================

  _escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _stripHtml(s) {
    return s.replace(/<[^>]*>/g, '');
  },
};

// Export for use
window.CitationBuilder = CitationBuilder;
