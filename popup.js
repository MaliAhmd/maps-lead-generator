// popup.js — UI controller
const $ = id => document.getElementById(id);
let isRunning = false;

document.getElementById('limitRange').addEventListener('input', function () {
  document.getElementById('limitVal').textContent = this.value;
});

document.querySelectorAll('.toggle-item').forEach(label => {
  const cb = label.querySelector('input[type=checkbox]');
  cb.addEventListener('change', () => label.classList.toggle('on', cb.checked));
});

function log(msg, type = '') {
  const el = $('log');
  el.style.display = 'block';
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.textContent = `[${time}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function setProgress(current, total, text) {
  $('progressWrap').style.display = 'block';
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = text || 'Scraping…';
  $('progressCount').textContent = `${current} / ${total}`;
}

function setCounter(n) {
  $('counter').style.display = 'block';
  $('counterNum').textContent = n;
}

function setStatus(state) {
  const dot = $('statusDot');
  dot.className = 'status-dot';
  if (state) dot.classList.add(state);
}

function setRunning(running) {
  isRunning = running;
  $('btnStart').style.display = running ? 'none' : 'block';
  $('btnStop').style.display = running ? 'block' : 'none';
  $('btnStart').disabled = running;
  setStatus(running ? 'active' : '');
}

function showExportButton() {
  $('btnExport').style.display = 'block';
}

function getConfig() {
  const business = $('business').value.trim();
  const country = $('country').value;
  const city = $('city').value.trim();
  const limit = parseInt($('limitRange').value, 10);
  const query = city ? `${business} in ${city}, ${country}` : `${business} in ${country}`;
  return {
    business, country, city, limit, query,
    extract: {
      phone: $('extractPhone').checked,
      email: $('extractEmail').checked,
      website: $('extractWebsite').checked,
      address: $('extractAddress').checked,
      rating: $('extractRating').checked,
      hours: $('extractHours').checked,
      social: $('extractSocial').checked,
    }
  };
}

// ── Inject script with retries ────────────────────────────────────────────────
// FIX: Inject content.js ONCE before the retry loop.
// Previously it was injected on every retry attempt, causing the script
// to run multiple times (bypassing the __leadHunterInjected guard because
// each injection created a new execution context on a fresh page load).
async function injectAndStart(tabId, config, retries = 5) {
  // Inject once — the guard flag in content.js prevents double-execution
  // if the script was already present, but injecting multiple times was
  // causing duplicate runScrape() calls when the page was freshly loaded.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 1000));
  } catch (err) {
    log('Injection failed: ' + err.message, 'err');
    return false;
  }

  // Retry only the message-send, not the injection
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: 'START_SCRAPE', config }, (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
      });

      log('Scrape started on Maps tab.', 'ok');
      return true;

    } catch (err) {
      log(`Attempt ${attempt}/${retries} failed: ${err.message} — retrying…`, 'err');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return false;
}

// ── Start scraping ────────────────────────────────────────────────────────────
$('btnStart').addEventListener('click', async () => {
  const config = getConfig();
  if (!config.business) { log('Please enter a business name or keyword.', 'err'); return; }

  await chrome.storage.local.set({ leads: [], config, scrapeStatus: 'running' });
  log(`Starting: "${config.query}" — max ${config.limit} results`, 'info');
  setRunning(true);
  setProgress(0, config.limit, 'Opening Google Maps…');

  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(config.query)}/`;

  // Open or navigate existing Maps tab
  const tabs = await chrome.tabs.query({ url: 'https://www.google.com/maps/*' });
  let tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: searchUrl, active: true });
  } else {
    tab = await chrome.tabs.create({ url: searchUrl });
  }

  log('Waiting for Maps to load…');

  // Wait for tab status = complete
  await new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  // Wait extra time for Maps JS to fully render
  log('Maps loaded — waiting for page to render…');
  await new Promise(r => setTimeout(r, 4000));

  // Inject once and start with message retries
  const ok = await injectAndStart(tab.id, config);
  if (!ok) {
    log('Could not connect after 5 attempts. Try reloading the Maps tab manually.', 'err');
    setRunning(false);
    setStatus('error');
  }
});

// ── Stop ──────────────────────────────────────────────────────────────────────
$('btnStop').addEventListener('click', async () => {
  await chrome.storage.local.set({ scrapeStatus: 'stopped' });
  const tabs = await chrome.tabs.query({ url: 'https://www.google.com/maps/*' });
  if (tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, { action: 'STOP_SCRAPE' });
  log('Stopped by user.', 'err');
  setRunning(false);
  const { leads } = await chrome.storage.local.get('leads');
  if (leads && leads.length > 0) showExportButton();
});

// ── Export Excel ──────────────────────────────────────────────────────────────
$('btnExport').addEventListener('click', async () => {
  const { leads, config } = await chrome.storage.local.get(['leads', 'config']);
  if (!leads || leads.length === 0) { log('No leads to export.', 'err'); return; }
  log(`Preparing Excel with ${leads.length} records…`, 'info');
  chrome.runtime.sendMessage({ action: 'EXPORT_EXCEL', leads, config });
});

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.action) {
    case 'PROGRESS':
      setProgress(msg.current, msg.total, msg.text);
      setCounter(msg.current);
      log(msg.text, msg.ok ? 'ok' : '');
      break;
    case 'LEAD_FOUND':
      setCounter(msg.count);
      log(`✓ ${msg.name}`, 'ok');
      break;
    case 'SCRAPE_DONE':
      setRunning(false);
      setStatus('');
      log(`Done! ${msg.count} leads collected.`, 'ok');
      setProgress(msg.count, msg.count, 'Complete');
      if (msg.count > 0) showExportButton();
      break;
    case 'SCRAPE_ERROR':
      log('Error: ' + msg.error, 'err');
      setStatus('error');
      setRunning(false);
      break;
    case 'LOG':
      log(msg.text, msg.type || '');
      break;
    case 'EXPORT_DONE':
      log('Excel file downloaded!', 'ok');
      break;
  }
});

// ── Restore state on popup open ───────────────────────────────────────────────
(async () => {
  const { leads, scrapeStatus, config } = await chrome.storage.local.get(['leads', 'scrapeStatus', 'config']);
  if (config) {
    if (config.business) $('business').value = config.business;
    if (config.country) $('country').value = config.country;
    if (config.city) $('city').value = config.city;
  }
  if (scrapeStatus === 'running') { setRunning(true); log('Scraping in progress…', 'info'); }
  if (leads && leads.length > 0) {
    setCounter(leads.length);
    if (scrapeStatus !== 'running') showExportButton();
  }
})();