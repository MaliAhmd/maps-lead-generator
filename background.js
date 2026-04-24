// background.js — service worker
// Handles: message routing, Excel generation, file download, social scraping

importScripts('xlsx.min.js');

// ── Relay messages from content script → popup ────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Forward these events from content → popup
  const forwardEvents = ['PROGRESS', 'LEAD_FOUND', 'SCRAPE_DONE', 'SCRAPE_ERROR', 'LOG'];
  if (forwardEvents.includes(msg.action)) {
    chrome.runtime.sendMessage(msg).catch(() => { }); // popup may be closed
  }

  // ── Email extraction via CORS-bypassed Service Worker ────────────────────────
  if (msg.action === 'FETCH_EMAIL') {
    findEmail(msg.url).then(email => sendResponse({ email })).catch(() => sendResponse({ email: '' }));
    return true;
  }

  // ── Social media extraction from website ─────────────────────────────────────
  if (msg.action === 'FETCH_SOCIALS') {
    findSocials(msg.url).then(socials => sendResponse({ socials })).catch(() => sendResponse({ socials: {} }));
    return true;
  }

  // ── Excel export ────────────────────────────────────────────────────────────
  if (msg.action === 'EXPORT_EXCEL') {
    exportToExcel(msg.leads, msg.config);
    sendResponse({ ok: true });
  }

  return true;
});

// ── Social Media Extraction Logic ────────────────────────────────────────────
async function findSocials(url) {
  if (!url) return {};

  const socialPatterns = {
    facebook:  /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|login|photo|video|pages\/category|groups\/category|profile\.php)([A-Za-z0-9._%-]+)/i,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i,
    twitter:   /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i,
    linkedin:  /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([A-Za-z0-9_-]+)/i,
    youtube:   /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)?([A-Za-z0-9_@-]+)/i,
    tiktok:    /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]+)/i,
    whatsapp:  /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\??phone=|whatsapp\.com\/send\??phone=)([0-9+]+)/i,
  };

  // Noise domains to skip (social share widgets, CDN references, etc.)
  const noiseDomains = [
    'facebook.com/sharer', 'facebook.com/share', 'facebook.com/dialog',
    'twitter.com/intent', 'twitter.com/share',
    'linkedin.com/shareArticle', 'linkedin.com/sharing',
    'youtube.com/embed', 'youtube.com/watch',
  ];

  function extractFromHtml(html) {
    const result = {};

    // ── Strategy 1: Parse <a href> tags ──────────────────────────────────────
    // Regex to pull all href values from anchor tags
    const hrefRe = /href=["']([^"']+)["']/gi;
    const hrefs = [];
    let m;
    while ((m = hrefRe.exec(html)) !== null) {
      hrefs.push(m[1]);
    }

    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      if (result[platform]) continue;
      for (const href of hrefs) {
        if (noiseDomains.some(n => href.includes(n))) continue;
        const match = href.match(pattern);
        if (match) {
          result[platform] = match[0].startsWith('http') ? match[0] : 'https://' + match[0];
          break;
        }
      }
    }

    // ── Strategy 2: Raw HTML scan for any remaining platforms ────────────────
    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      if (result[platform]) continue;
      const match = html.match(pattern);
      if (match) {
        const raw = match[0];
        if (noiseDomains.some(n => raw.includes(n))) continue;
        result[platform] = raw.startsWith('http') ? raw : 'https://' + raw;
      }
    }

    return result;
  }

  // Pages to scan: homepage + /contact + /about (footer is usually on all pages)
  let origin = '';
  try { origin = new URL(url).origin; } catch { return {}; }

  const pagesToTry = [url, origin + '/contact', origin + '/about', origin + '/contact-us'];
  const socials = {};

  for (const page of pagesToTry) {
    // Stop early if we already have all platforms
    const found = Object.keys(socials).length;
    if (found >= Object.keys(socialPatterns).length) break;

    try {
      const r = await fetch(page, {
        signal: AbortSignal.timeout(7000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadHunter/1.0)' }
      });
      if (!r.ok) continue;

      const html = await r.text();

      // ── Strategy 3: Specifically look at the footer section ─────────────────
      // Extract footer HTML to reduce false positives from nav/header share buttons
      const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
      const footerHtml = footerMatch ? footerMatch[0] : '';

      // First try footer only (higher quality hits), then fall back to full page
      const fromFooter = footerHtml ? extractFromHtml(footerHtml) : {};
      const fromPage   = extractFromHtml(html);

      // Merge: footer results take priority, then full-page
      for (const platform of Object.keys(socialPatterns)) {
        if (!socials[platform]) {
          socials[platform] = fromFooter[platform] || fromPage[platform] || '';
        }
      }

    } catch { /* timeout or network error — try next page */ }
  }

  return socials;
}

// ── Email Extraction Logic ───────────────────────────────────────────────────
async function findEmail(url) {
  if (!url) return '';
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const skip = ['example.com', 'sentry.io', 'schema.org', 'google.com',
    'facebook.com', 'twitter.com', 'instagram.com', 'wixpress.com'];
  const clean = html => [...new Set(html.match(re) || [])].filter(e => {
    const d = e.split('@')[1] || '';
    return !skip.some(s => d.includes(s)) && e.length < 80 &&
      !e.includes('.png') && !e.includes('.jpg');
  });

  const pages = [url];
  try {
    const base = new URL(url).origin;
    pages.push(base + '/contact', base + '/contact-us', base + '/about');
  } catch { }

  for (const page of pages) {
    try {
      const r = await fetch(page, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const emails = clean(await r.text());
      if (emails.length) return emails[0];
    } catch { }
  }
  return '';
}

// ── Excel generation ──────────────────────────────────────────────────────────
function exportToExcel(leads, config) {
  try {
    const columns = [
      { key: 'name',        header: 'Business Name' },
      { key: 'category',    header: 'Category' },
      { key: 'phone',       header: 'Phone / WhatsApp' },
      { key: 'email',       header: 'Email' },
      { key: 'website',     header: 'Website URL' },
      { key: 'address',     header: 'Address' },
      { key: 'rating',      header: 'Rating' },
      { key: 'reviews',     header: 'Reviews' },
      { key: 'hours',       header: 'Opening Hours' },
      { key: 'plusCode',    header: 'Plus Code' },
      { key: 'mapsUrl',     header: 'Google Maps URL' },
      { key: 'country',     header: 'Country' },
      { key: 'city',        header: 'City' },
      { key: 'searchQuery', header: 'Search Query' },
      { key: 'facebook',    header: 'Facebook' },
      { key: 'instagram',   header: 'Instagram' },
      { key: 'twitter',     header: 'Twitter/X' },
      { key: 'linkedin',    header: 'LinkedIn' },
      { key: 'youtube',     header: 'YouTube' },
      { key: 'tiktok',      header: 'TikTok' },
      { key: 'whatsapp',    header: 'WhatsApp' },
    ];

    const header = columns.map(c => c.header);
    const rows = leads.map(lead => columns.map(c => lead[c.key] || ''));
    const wsData = [header, ...rows];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = [
      { wch: 30 }, { wch: 20 }, { wch: 18 }, { wch: 28 }, { wch: 35 },
      { wch: 35 }, { wch: 8  }, { wch: 10 }, { wch: 25 }, { wch: 14 },
      { wch: 45 }, { wch: 16 }, { wch: 16 }, { wch: 35 }, { wch: 35 },
      { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 30 },
      { wch: 25 },
    ];

    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeName    = (config.business || 'leads').replace(/[^a-zA-Z0-9]/g, '_');
    const safeCountry = (config.country  || 'country').replace(/[^a-zA-Z0-9]/g, '_');
    const filename    = `${safeName}_${safeCountry}_${date}.xlsx`;

    const wbout  = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const dataUrl = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout;

    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError);
      } else {
        chrome.runtime.sendMessage({ action: 'EXPORT_DONE', filename, downloadId }).catch(() => { });
      }
    });

  } catch (err) {
    console.error('Excel export error:', err);
    chrome.runtime.sendMessage({ action: 'LOG', text: 'Export error: ' + err.message, type: 'err' }).catch(() => { });
  }
}