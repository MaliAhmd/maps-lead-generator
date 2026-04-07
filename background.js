// background.js — service worker
// Handles: message routing, Excel generation, file download

importScripts('xlsx.min.js');

// ── Relay messages from content script → popup ────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Forward these events from content → popup
  const forwardEvents = ['PROGRESS', 'LEAD_FOUND', 'SCRAPE_DONE', 'SCRAPE_ERROR', 'LOG'];
  if (forwardEvents.includes(msg.action)) {
    chrome.runtime.sendMessage(msg).catch(() => {}); // popup may be closed
  }

  // ── Email extraction via CORS-bypassed Service Worker ────────────────────────
  if (msg.action === 'FETCH_EMAIL') {
    findEmail(msg.url).then(email => sendResponse({ email })).catch(() => sendResponse({ email: '' }));
    return true; // Keep message channel open for async response
  }

  // ── Excel export ────────────────────────────────────────────────────────────
  if (msg.action === 'EXPORT_EXCEL') {
    exportToExcel(msg.leads, msg.config);
    sendResponse({ ok: true });
  }

  return true;
});

// ── Email Extraction Logic ───────────────────────────────────────────────────
async function findEmail(url) {
  if (!url) return '';
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const skip = ['example.com','sentry.io','schema.org','google.com',
                'facebook.com','twitter.com','instagram.com','wixpress.com'];
  const clean = html => [...new Set(html.match(re) || [])].filter(e => {
    const d = e.split('@')[1] || '';
    return !skip.some(s => d.includes(s)) && e.length < 80 &&
           !e.includes('.png') && !e.includes('.jpg');
  });

  const pages = [url];
  try {
    const base = new URL(url).origin;
    pages.push(base + '/contact', base + '/contact-us', base + '/about');
  } catch {}

  for (const page of pages) {
    try {
      const r = await fetch(page, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const emails = clean(await r.text());
      if (emails.length) return emails[0];
    } catch {}
  }
  return '';
}

// ── Excel generation ──────────────────────────────────────────────────────────
function exportToExcel(leads, config) {
  try {
    // Column order and display names
    const columns = [
      { key: 'name',        header: 'Business Name'   },
      { key: 'category',    header: 'Category'        },
      { key: 'phone',       header: 'Phone / WhatsApp'},
      { key: 'email',       header: 'Email'           },
      { key: 'website',     header: 'Website URL'     },
      { key: 'address',     header: 'Address'         },
      { key: 'rating',      header: 'Rating'          },
      { key: 'reviews',     header: 'Reviews'         },
      { key: 'hours',       header: 'Opening Hours'   },
      { key: 'plusCode',    header: 'Plus Code'       },
      { key: 'mapsUrl',     header: 'Google Maps URL' },
      { key: 'country',     header: 'Country'         },
      { key: 'city',        header: 'City'            },
      { key: 'searchQuery', header: 'Search Query'    },
    ];

    // Build row array
    const header = columns.map(c => c.header);
    const rows = leads.map(lead =>
      columns.map(c => lead[c.key] || '')
    );

    const wsData = [header, ...rows];

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws['!cols'] = [
      { wch: 30 }, // Business Name
      { wch: 20 }, // Category
      { wch: 18 }, // Phone
      { wch: 28 }, // Email
      { wch: 35 }, // Website
      { wch: 35 }, // Address
      { wch: 8  }, // Rating
      { wch: 10 }, // Reviews
      { wch: 25 }, // Hours
      { wch: 14 }, // Plus Code
      { wch: 45 }, // Maps URL
      { wch: 16 }, // Country
      { wch: 16 }, // City
      { wch: 35 }, // Query
    ];

    // Freeze header row
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(wb, ws, 'Leads');

    // File name: BusinessName_Country_YYYYMMDD.xlsx
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeName = (config.business || 'leads').replace(/[^a-zA-Z0-9]/g, '_');
    const safeCountry = (config.country || 'country').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${safeName}_${safeCountry}_${date}.xlsx`;

    // Write to base64
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const dataUrl = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout;

    // Trigger download
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError);
      } else {
        chrome.runtime.sendMessage({ action: 'EXPORT_DONE', filename, downloadId }).catch(() => {});
      }
    });

  } catch (err) {
    console.error('Excel export error:', err);
    chrome.runtime.sendMessage({ action: 'LOG', text: 'Export error: ' + err.message, type: 'err' }).catch(() => {});
  }
}
