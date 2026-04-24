// content.js — injected into Google Maps tab

if (!window.__leadHunterInjected) {
  window.__leadHunterInjected = true;

  let stopFlag = false;
  let config = {};

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function sendLog(text, type = '') {
    try { chrome.runtime.sendMessage({ action: 'LOG', text, type }); } catch { }
  }
  function sendProgress(current, total, text) {
    try { chrome.runtime.sendMessage({ action: 'PROGRESS', current, total, text, ok: true }); } catch { }
  }
  function sendLeadFound(name, count) {
    try { chrome.runtime.sendMessage({ action: 'LEAD_FOUND', name, count }); } catch { }
  }

  function waitForElement(selector, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout);
    });
  }

  function getText(root, selector) {
    const el = selector ? root.querySelector(selector) : root;
    return el ? el.textContent.trim() : '';
  }

  // ── Wait for results feed ─────────────────────────────────────────────────
  async function waitForFeed() {
    sendLog('Waiting for results feed…');
    try {
      await waitForElement('[role="feed"]', 20000);
      await sleep(1000);
      sendLog('Results feed ready.', 'ok');
    } catch {
      sendLog('Feed timeout — continuing anyway.', 'err');
    }
  }

  // ── Scroll feed to load more cards ────────────────────────────────────────
  async function scrollFeed(targetCount) {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return;
    let stable = 0, last = 0;
    while (stable < 5) {
      if (stopFlag) break;
      const count = feed.querySelectorAll('.Nv2PK').length;
      if (count >= targetCount) break;
      if (count === last) stable++;
      else { stable = 0; last = count; }
      feed.scrollBy(0, 600);
      await sleep(1000);
    }
    sendLog(`Feed has ${feed.querySelectorAll('.Nv2PK').length} cards.`);
  }

  function isPanelOpen() {
    return !!(
      document.querySelector('h1.DUwDvf') ||
      document.querySelector('.fontHeadlineLarge')
    );
  }

  async function waitForPanel(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (isPanelOpen()) return true;
      await sleep(300);
    }
    return false;
  }

  // ── Click a card and wait for detail panel ────────────────────────────────
  async function openCard(card) {
    const link =
      card.querySelector('a.hfpxzc') ||
      card.querySelector('a[href*="/maps/place/"]') ||
      Array.from(card.querySelectorAll('a')).find(a => !a.href || a.href.includes('google.com/maps'));

    if (link) link.click();
    else card.click();

    await sleep(800);
    const opened = await waitForPanel(10000);
    if (opened) await sleep(800);
    return opened;
  }

  // ── Go back to results list ───────────────────────────────────────────────
  async function goBack() {
    const backBtn =
      document.querySelector('button[aria-label="Back"]') ||
      document.querySelector('button[aria-label="Назад"]') ||
      document.querySelector('button[aria-label="Zurück"]') ||
      document.querySelector('button[aria-label="Retour"]') ||
      document.querySelector('button[aria-label^="Back"]') ||
      document.querySelector('button[data-value="back"]') ||
      document.querySelector('[jsaction*="pane.place.back"]') ||
      document.querySelector('[jsaction*="back"]') ||
      Array.from(document.querySelectorAll('button[aria-label]'))
        .find(b => /back|retour|zurück|назад/i.test(b.getAttribute('aria-label')));

    if (backBtn) {
      backBtn.click();
      await sleep(2500);
      try { await waitForElement('[role="feed"]', 8000); } catch { }
      await sleep(500);
    } else {
      await sleep(500);
    }
  }

  // ── Extract data from open detail panel ──────────────────────────────────
  function extractPanel() {
    const h1 = document.querySelector('h1.DUwDvf') ||
      document.querySelector('.fontHeadlineLarge') ||
      document.querySelector('[data-attrid="title"]');
    if (!h1) return null;

    const panel = h1.closest('[role="main"]') || document.body;
    const lead = {};

    lead.name = h1.textContent.trim();
    if (!lead.name || lead.name.length < 2 || lead.name.toLowerCase().includes('result')) return null;

    lead.category =
      getText(panel, '.DkEaL') ||
      getText(panel, '.skqShb') ||
      getText(panel, 'button[jsaction*="category"]') || '';

    function safelyExtract(idSubstring) {
      const container = panel.querySelector(`[data-item-id*="${idSubstring}"]`);
      if (!container) return '';
      const aria = container.getAttribute('aria-label');
      if (aria) {
        const clean = aria.replace(/^[^:]+:\s*/, '').trim();
        if (clean.length > 0 && clean.length < 300 && !clean.includes('Hide open hours')) return clean;
      }
      const iconText = container.querySelector('.Io6YTe, .fontBodyMedium');
      return iconText ? iconText.textContent.trim() : container.textContent.trim();
    }

    if (config.extract?.address) lead.address = safelyExtract('address');
    if (config.extract?.phone)   lead.phone   = safelyExtract('phone');

    if (config.extract?.website) {
      const webA =
        panel.querySelector('[data-item-id*="authority"] a') ||
        panel.querySelector('a[data-item-id*="authority"]') ||
        [...panel.querySelectorAll('a[href]')].find(a =>
          !a.href.includes('google.com') &&
          !a.href.includes('javascript') &&
          a.href.startsWith('http')
        );
      lead.website = webA ? webA.href : '';

      if (!lead.website) {
        const domain = safelyExtract('authority');
        if (domain && domain.includes('.')) lead.website = 'http://' + domain;
      }

      if (lead.website.includes('google.com/url')) {
        try { lead.website = new URL(lead.website).searchParams.get('q') || lead.website; } catch { }
      }
    }

    if (config.extract?.rating) {
      const ratingEl =
        panel.querySelector('.F7nice span[aria-hidden="true"]') ||
        panel.querySelector('span[role="img"][aria-label*="star" i]');
      if (ratingEl) {
        const aria = ratingEl.getAttribute('aria-label');
        lead.rating = (aria && aria.toLowerCase().includes('star'))
          ? aria.split(' ')[0]
          : ratingEl.textContent.trim();
      } else lead.rating = '';

      const reviewEl =
        panel.querySelector('.F7nice span[aria-label*="review" i]') ||
        panel.querySelector('button[aria-label*="review" i]');
      if (reviewEl) {
        const ariaInfo = reviewEl.getAttribute('aria-label') || reviewEl.textContent || '';
        const m = ariaInfo.match(/[\d,]+/);
        lead.reviews = m ? m[0].replace(/,/g, '') : '';
      } else lead.reviews = '';
    }

    if (config.extract?.hours) lead.hours = safelyExtract('oh');

    lead.mapsUrl = window.location.href.split('?')[0];
    lead.email   = '';

    // Initialize all social fields empty — will be filled by website scrape below
    lead.facebook = lead.instagram = lead.twitter =
      lead.linkedin = lead.youtube = lead.tiktok = lead.whatsapp = '';

    // ── Fallback: try to pick up any social links directly in Maps panel ────
    // (some businesses do link socials from their Maps listing)
    if (config.extract?.social) {
      const quickPatterns = {
        facebook:  /facebook\.com\/(?!sharer|share|dialog|login|photo|video)([^/?#&"'\s]+)/i,
        instagram: /instagram\.com\/([^/?#&"'\s]+)/i,
        twitter:   /(?:twitter|x)\.com\/([^/?#&"'\s]+)/i,
        linkedin:  /linkedin\.com\/(?:company|in)\/([^/?#&"'\s]+)/i,
        youtube:   /youtube\.com\/(?:@|channel\/|c\/)?([^/?#&"'\s]+)/i,
        tiktok:    /tiktok\.com\/@([^/?#&"'\s]+)/i,
        whatsapp:  /(?:wa\.me|whatsapp\.com\/send\??phone=)([^/?#&"'\s]+)/i,
      };
      const panelLinks = Array.from(panel.querySelectorAll('a[href]')).map(a => a.href);
      for (const [platform, pattern] of Object.entries(quickPatterns)) {
        for (const href of panelLinks) {
          const m = href.match(pattern);
          if (m) { lead[platform] = m[0].startsWith('http') ? m[0] : 'https://' + m[0]; break; }
        }
      }
    }

    return lead;
  }

  // ── Fetch social links from the lead's website ────────────────────────────
  async function enrichSocialsFromWebsite(lead) {
    if (!config.extract?.social) return lead;
    if (!lead.website) return lead;

    sendLog(`→ Scraping social links from: ${lead.website}`);
    try {
      const res = await chrome.runtime.sendMessage({ action: 'FETCH_SOCIALS', url: lead.website });
      const socials = res?.socials || {};

      // Only overwrite if the website gave us a better (non-empty) result
      const platforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'whatsapp'];
      let found = 0;
      for (const p of platforms) {
        if (socials[p]) { lead[p] = socials[p]; found++; }
      }
      if (found > 0) sendLog(`  Found ${found} social link(s) from website.`, 'ok');
      else           sendLog(`  No social links found on website.`);
    } catch (err) {
      sendLog(`  Social fetch error: ${err.message}`, 'err');
    }
    return lead;
  }

  // ── Main scrape loop ──────────────────────────────────────────────────────
  async function runScrape() {
    sendLog('Script active. Starting scrape…', 'info');

    await waitForFeed();
    if (stopFlag) return;

    await scrollFeed(config.limit);
    if (stopFlag) return;

    const feed = document.querySelector('[role="feed"]');
    const allCards = feed ? Array.from(feed.querySelectorAll('.Nv2PK')) : [];

    if (allCards.length === 0) {
      sendLog('No cards found — trying single result mode…');
      let lead = extractPanel();
      if (lead) {
        if (lead.website && config.extract?.email) {
          try {
            const res = await chrome.runtime.sendMessage({ action: 'FETCH_EMAIL', url: lead.website });
            lead.email = res?.email || '';
          } catch { }
        }
        // ── Enrich socials from website ──────────────────────────────────────
        lead = await enrichSocialsFromWebsite(lead);

        lead.country = config.country;
        lead.city    = config.city || '';
        lead.searchQuery = config.query;
        await chrome.storage.local.set({ leads: [lead], scrapeStatus: 'done' });
        sendLeadFound(lead.name, 1);
        chrome.runtime.sendMessage({ action: 'SCRAPE_DONE', count: 1 });
      } else {
        chrome.runtime.sendMessage({ action: 'SCRAPE_ERROR', error: 'No results found.' });
      }
      return;
    }

    const total = Math.min(allCards.length, config.limit);
    sendLog(`Processing ${total} of ${allCards.length} cards…`, 'ok');

    const leads = [];

    for (let i = 0; i < total; i++) {
      if (stopFlag) break;

      const currentFeed = document.querySelector('[role="feed"]');
      const cards = currentFeed ? Array.from(currentFeed.querySelectorAll('.Nv2PK')) : [];
      const card  = cards[i];

      if (!card) { sendLog(`Card ${i + 1}: not found, skipping.`); continue; }

      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(600);

      sendLog(`Opening card ${i + 1}/${total}…`);
      const opened = await openCard(card);

      if (!opened) {
        sendLog(`Card ${i + 1}: panel did not open, skipping.`);
        await goBack();
        continue;
      }

      let lead = extractPanel();
      if (!lead) {
        sendLog(`Card ${i + 1}: no data extracted, skipping.`);
        await goBack();
        continue;
      }

      sendProgress(i + 1, total, `(${i + 1}/${total}) ${lead.name}`);
      sendLog(`✓ ${lead.name}`, 'ok');

      // ── Email from website ─────────────────────────────────────────────────
      if (lead.website && config.extract?.email) {
        sendLog(`→ Hunting email on: ${lead.website}`);
        try {
          const res = await chrome.runtime.sendMessage({ action: 'FETCH_EMAIL', url: lead.website });
          lead.email = res?.email || '';
          if (lead.email) sendLog(`  email: ${lead.email}`, 'ok');
        } catch { }
      }

      // ── Social links from website footer (main new feature) ───────────────
      lead = await enrichSocialsFromWebsite(lead);

      lead.country     = config.country;
      lead.city        = config.city || '';
      lead.searchQuery = config.query;
      leads.push(lead);

      await chrome.storage.local.set({ leads });
      sendLeadFound(lead.name, leads.length);

      await goBack();
      await sleep(500);
    }

    await chrome.storage.local.set({ leads, scrapeStatus: 'done' });
    chrome.runtime.sendMessage({ action: 'SCRAPE_DONE', count: leads.length });
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_SCRAPE') {
      config    = msg.config;
      stopFlag  = false;
      runScrape();
      sendResponse({ status: 'started' });
    }
    if (msg.action === 'STOP_SCRAPE') {
      stopFlag = true;
      sendResponse({ status: 'stopped' });
    }
    return true;
  });

  sendLog('Content script ready.', 'ok');
}