# Maps Lead Hunter — Chrome Extension

## Quick Setup (5 steps)

### Step 1 — Download SheetJS
1. Go to: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.min.js
2. Right-click → Save As → save it as **xlsx.min.js** inside this folder

### Step 2 — Create Icons (optional)
Create four PNG icon files in the `icons/` folder:
- icon16.png  (16×16)
- icon32.png  (32×32)
- icon48.png  (48×48)
- icon128.png (128×128)

You can use any image editor or generate them with an online tool.
If you skip this, Chrome will use a default icon but still work fine.

### Step 3 — Load in Chrome
1. Open Chrome and go to: chrome://extensions
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder: `gmaps-lead-extension/`
5. The extension icon appears in your toolbar ✓

### Step 4 — Use It
1. Click the Maps Lead Hunter icon in your Chrome toolbar
2. Enter a business name (e.g. "dental clinic", "restaurant", "gym")
3. Select your country and city
4. Choose how many results (10–200)
5. Toggle which fields to extract
6. Click **Start Scraping**
7. Chrome will open Google Maps and automatically scrape results
8. When done, click **Download Excel**

### Step 5 — Excel File
The file saves to your Downloads folder as:
`{BusinessName}_{Country}_{Date}.xlsx`

---

## Extracted Fields

| Field           | Description                        |
|-----------------|------------------------------------|
| Business Name   | Full name of the business          |
| Category        | Business type (e.g. Restaurant)    |
| Phone / WhatsApp| Phone number as listed on Maps     |
| Email           | Scraped from their website         |
| Website URL     | Business website                   |
| Address         | Full street address                |
| Rating          | Google star rating                 |
| Reviews         | Number of reviews                  |
| Opening Hours   | Current hours status               |
| Plus Code       | Google Plus Code location          |
| Google Maps URL | Direct link to their Maps listing  |
| Country         | Country you searched               |
| City            | City you searched                  |
| Search Query    | The query that was used            |

---

## File Structure

```
gmaps-lead-extension/
├── manifest.json     — Extension config (Manifest V3)
├── popup.html        — Extension popup UI
├── popup.js          — UI logic & state
├── content.js        — Google Maps scraper (injected into Maps tab)
├── background.js     — Service worker: relay messages + Excel export
├── xlsx.min.js       — SheetJS library (you must download this)
├── icons/            — Extension icons (optional)
└── README.md         — This file
```

---

## Tips

- **Best results**: Search specific terms like "dentist in Karachi" not just "doctor"
- **Email extraction**: Works best when businesses have their own website
- **Rate limiting**: The scraper adds delays between requests to avoid being blocked
- **Stopping**: You can stop mid-scrape and still download whatever was collected
- **Re-running**: Each new scrape replaces the previous data — export first!

---

## Troubleshooting

**"No results found"**
→ Maps may have changed its layout. Try refreshing the Maps tab and retrying.

**Emails not found**
→ Many businesses don't post emails publicly. Phone numbers are more reliable.

**Extension won't load**
→ Make sure xlsx.min.js is in the folder and Developer mode is ON in Chrome.

**Scraping stops early**
→ Google may have shown a CAPTCHA in the Maps tab. Complete it and retry.

![Visitors](https://visitor-badge.laobi.icu/badge?page_id=MaliAhmd.maps-lead-generator)
