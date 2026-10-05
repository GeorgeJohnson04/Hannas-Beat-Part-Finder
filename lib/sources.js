// Where the parts and news come from.
//
// Parts:
//  - eBay's official Browse API. Only listings where the seller is located in the
//    US and ships to the US (itemLocationCountry:US + deliveryCountry:US).
//    Needs a free key from developer.ebay.com, see the README.
//  - pp1beat.com, a Beat-only store in Toronto that ships to the US with no
//    duties. Their search page is plain html so we just read it.
//
// News: Google News RSS, no key needed.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// a listing has to mention the car somewhere in the title to count
const BEAT = /\bbeat\b|\bpp1\b|e07a/i;

// things that say "beat" but aren't parts for her car. the Honda BeAT scooter
// is the big one, plus model kits and t-shirts
const NOT_PARTS = /scooter|moped|motorcycle|nch50|beat\s*110|ruckus|helmet|shirt|hoodie|poster|model kit|1\/24|1:24|1\/64|diecast|die-cast|tomica|hot wheels|brochure/i;

let token = null; // { value, expires, id }

async function ebayToken(keys) {
  if (token && token.id === keys.clientId && token.expires > Date.now() + 60000) return token.value;

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${keys.clientId}:${keys.clientSecret}`).toString('base64')
    },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
    signal: AbortSignal.timeout(15000)
  });
  const j = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (j.error === 'invalid_client') throw new Error("eBay didn't accept those keys. Make sure they're the Production ones.");
    throw new Error(j.error_description || `eBay login failed (${res.status})`);
  }

  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000, id: keys.clientId };
  return token.value;
}

async function ebaySearch(mod, keys, limit) {
  const params = new URLSearchParams({
    q: mod.q,
    limit: '50',
    filter: 'itemLocationCountry:US,deliveryCountry:US'
  });

  const headers = {
    Authorization: 'Bearer ' + await ebayToken(keys),
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
  };
  // with a zip code eBay gives real shipping prices instead of "calculated"
  if (keys.zip) headers['X-EBAY-C-ENDUSERCTX'] = 'contextualLocation=' + encodeURIComponent(`country=US,zip=${keys.zip}`);

  const res = await fetch('https://api.ebay.com/buy/browse/v1/item_summary/search?' + params, {
    headers,
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`eBay search failed (${res.status})`);
  const j = await res.json();

  return (j.itemSummaries || [])
    .filter(it => !NOT_PARTS.test(it.title) && (mod.beatOnly === false || BEAT.test(it.title)))
    .slice(0, limit)
    .map(it => {
      const ship = it.shippingOptions?.[0];
      const shipCost = ship?.shippingCost?.value;
      const loc = it.itemLocation || {};
      const auction = it.buyingOptions?.includes('AUCTION') && !it.buyingOptions.includes('FIXED_PRICE');

      // only item info gets saved, nothing about the seller. that's what lets the
      // eBay keyset use the "I do not persist eBay data" exemption
      return {
        source: 'ebay',
        mod: mod.id,
        id: it.itemId,
        title: it.title,
        price: Number((auction && it.currentBidPrice?.value) || it.price?.value) || null,
        shipping: shipCost == null ? null : Number(shipCost),
        auction,
        bids: it.bidCount || 0,
        ends: it.itemEndDate || null,
        condition: it.condition || '',
        from: [loc.city, loc.stateOrProvince].filter(Boolean).join(', '),
        img: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
        url: it.itemWebUrl
      };
    });
}

// pp1beat.com runs on BigCommerce. Every result is an <li class="product"> with
// the name and price sitting in data- attributes on the <article>.
async function pp1beatSearch(mod, limit) {
  const url = 'https://pp1beat.com/search.php?search_query=' + encodeURIComponent(mod.pp1);
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`pp1beat.com ${res.status}`);
  const html = await res.text();

  // their search is loose ("air filter" also finds the AC belt), so every word
  // of the search has to be in the name
  const words = mod.pp1.toLowerCase().split(' ');

  return html.split('<li class="product">').slice(1)
    .map(card => {
      const attr = name => decode((card.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '').trim();
      const link = decode((card.match(/<a href="([^"]+)"/) || [])[1] || '');
      return {
        source: 'pp1beat',
        mod: mod.id,
        id: 'pp1-' + attr('data-product-id'),
        title: attr('data-name').replace(/\s*-\s*Honda Beat PP1 Model\s*-\s*1991-1996\s*/i, '').replace(/&#x27;/g, "'"),
        price: Number(attr('data-product-price').replace(/,/g, '')) || null,
        shipping: null,
        shipNote: 'free over $350',
        auction: false,
        condition: 'New',
        from: 'Toronto, Canada',
        img: (card.match(/<img src="([^"]+)"/) || [])[1] || null,
        url: link.replace(/&#x3D;/g, '=').split('?')[0]
      };
    })
    .filter(item => item.url && words.every(w => item.title.toLowerCase().includes(w)))
    .slice(0, limit);
}

function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

// -scooter matters here too, the BeAT scooter is huge in Southeast Asia
async function news() {
  const q = '"Honda Beat" (kei OR roadster OR PP1 OR convertible) -scooter -motorcycle -bike';
  const url = 'https://news.google.com/rss/search?' + new URLSearchParams({ q, hl: 'en-US', gl: 'US', ceid: 'US:en' });
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`google news ${res.status}`);
  const xml = await res.text();

  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = tag => decode((body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '').trim();
    const source = pick('source');
    let title = pick('title');
    // google adds " - Source Name" to the end of every title
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    items.push({ title, url: pick('link'), source, date: new Date(pick('pubDate')).toISOString() });
  }

  return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 24);
}

// runs async jobs a few at a time instead of all at once
async function pool(jobs, size) {
  const results = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

// onProgress(done, total, label) is what drives the progress bar on the page
async function refreshAll(mods, { keys, limit = 20, onProgress = () => {} } = {}) {
  const errors = [];
  let listings = [];
  let ebay = keys ? 'ok' : 'no-keys';

  // check the keys once up front, otherwise a bad key fails 18 times in a row
  if (keys) {
    try {
      await ebayToken(keys);
    } catch (err) {
      errors.push(err.message);
      ebay = 'bad-keys';
    }
  }

  const jobs = [];
  if (ebay === 'ok') {
    for (const mod of mods.filter(m => m.q)) jobs.push({ mod, label: mod.name, run: () => ebaySearch(mod, keys, limit) });
  }
  for (const mod of mods.filter(m => m.pp1)) {
    jobs.push({ mod, label: `${mod.name} (PP1 Beat)`, run: () => pp1beatSearch(mod, limit) });
  }

  const total = jobs.length + 1;
  let done = 0;
  onProgress(0, total, 'starting');

  const results = await pool(jobs.map(job => async () => {
    try {
      return await job.run();
    } catch (err) {
      errors.push(`${job.label}: ${err.message}`);
      return [];
    } finally {
      onProgress(++done, total, job.label);
    }
  }), 3);

  // the same listing can show up under two searches, keep the first one
  const seen = new Set();
  for (const item of results.flat()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    listings.push(item);
  }

  let articles = [];
  try {
    articles = await news();
  } catch (err) {
    errors.push('news: ' + err.message);
  }
  onProgress(++done, total, 'news');

  return { updated: new Date().toISOString(), ebay, listings, news: articles, errors };
}

module.exports = { refreshAll, ebayToken };
