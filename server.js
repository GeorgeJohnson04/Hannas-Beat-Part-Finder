// Hanna's Beat - tiny local server
// no npm install needed, just `node server.js` (or double click Start.bat)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { refreshAll, ebayToken } = require('./lib/sources');

if (typeof fetch !== 'function') {
  console.log('\n  This needs Node 18 or newer. Grab the LTS from https://nodejs.org and try again.\n');
  process.exit(1);
}

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const CACHE_FILE = path.join(DATA, 'cache.json');
const BUILD_FILE = path.join(DATA, 'build.json');
const EBAY_FILE = path.join(DATA, 'ebay.json'); // gitignored, the keys never leave this computer

const config = readJson(path.join(ROOT, 'config.json'), {});
const PORT = Number(process.env.PORT) || config.port || 1991;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// refresh state, the page polls /api/status while this runs
let job = { running: false, done: 0, total: 0, label: '', error: null };

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy(); // nobody's wishlist is a megabyte
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

// stops ../../ tricks, everything has to stay inside public/
function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(urlPath)));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function serveFile(res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, { error: 'not found' });
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  });
}

// keys can come from data/ebay.json (what the setup box on the page saves)
// or from env vars if you'd rather do it that way
function ebayKeys() {
  const saved = readJson(EBAY_FILE, {});
  const clientId = process.env.EBAY_CLIENT_ID || saved.clientId;
  const clientSecret = process.env.EBAY_CLIENT_SECRET || saved.clientSecret;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, zip: process.env.EBAY_ZIP || saved.zip || '' };
}

function cacheAgeHours() {
  const cache = readJson(CACHE_FILE, null);
  if (!cache?.updated) return Infinity;
  return (Date.now() - new Date(cache.updated)) / 36e5;
}

function startRefresh() {
  if (job.running) return false;

  const mods = readJson(path.join(DATA, 'mods.json'), []);
  job = { running: true, done: 0, total: 0, label: 'starting', error: null };
  console.log('  refreshing...');

  refreshAll(mods, {
    keys: ebayKeys(),
    limit: config.listingsPerSearch || 20,
    onProgress: (done, total, label) => Object.assign(job, { done, total, label })
  })
    .then(data => {
      // if everything failed (wifi off?) keep the old cache instead of wiping it
      if (!data.listings.length && !data.news.length) {
        throw new Error(data.errors[0] || 'nothing came back, is the internet on?');
      }
      writeJson(CACHE_FILE, data);
      console.log(`  got ${data.listings.length} parts + ${data.news.length} news posts`);
      for (const e of data.errors) console.log('  ! ' + e);
      job.running = false;
    })
    .catch(err => {
      console.log('  refresh failed:', err.message);
      job = { ...job, running: false, error: err.message };
    });

  return true;
}

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;

  try {
    if (p === '/api/ping') return send(res, 200, { app: 'beat-garage' });

    if (p === '/api/config') return send(res, 200, { name: config.name || 'Hanna' });

    // photos live in their own file so mods.json stays readable
    if (p === '/api/mods') {
      const photos = readJson(path.join(DATA, 'photos.json'), {});
      const mods = readJson(path.join(DATA, 'mods.json'), []);
      return send(res, 200, mods.map(m => ({ ...m, photo: photos[m.id] || null })));
    }

    if (p === '/api/shops') return send(res, 200, readJson(path.join(DATA, 'shops.json'), []));

    if (p === '/api/themes') {
      const photos = readJson(path.join(DATA, 'photos.json'), {});
      const themes = readJson(path.join(DATA, 'themes.json'), []);
      return send(res, 200, themes.map(t => ({ ...t, photo: photos[t.photo] || null })));
    }

    if (p === '/api/listings') {
      return send(res, 200, readJson(CACHE_FILE, { updated: null, listings: [], news: [] }));
    }

    if (p === '/api/refresh' && req.method === 'POST') {
      const started = startRefresh();
      return send(res, 202, { started, ...job });
    }

    if (p === '/api/status') return send(res, 200, job);

    if (p === '/api/ebay') {
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req) || '{}');
        const keys = {
          clientId: String(body.clientId || '').trim(),
          clientSecret: String(body.clientSecret || '').trim(),
          zip: String(body.zip || '').trim().slice(0, 5)
        };
        if (!keys.clientId || !keys.clientSecret) return send(res, 400, { error: 'Need both the App ID and the Cert ID.' });

        // try logging in before saving so typos get caught right away
        try {
          await ebayToken(keys);
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
        writeJson(EBAY_FILE, keys);
        return send(res, 200, { ok: true });
      }
      return send(res, 200, { configured: !!ebayKeys() });
    }

    if (p === '/api/build') {
      if (req.method === 'PUT') {
        const items = JSON.parse(await readBody(req) || '[]');
        if (!Array.isArray(items)) return send(res, 400, { error: 'expected a list' });
        writeJson(BUILD_FILE, items);
        return send(res, 200, items);
      }
      return send(res, 200, readJson(BUILD_FILE, []));
    }

    const file = safeJoin(PUBLIC, p === '/' ? 'index.html' : p);
    if (!file) return send(res, 403, { error: 'nope' });
    return serveFile(res, file);
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: err.message });
  }
});

function openBrowser(link) {
  if (config.openBrowser === false || process.argv.includes('--no-open')) return;
  const cmd = process.platform === 'win32' ? `start "" "${link}"`
    : process.platform === 'darwin' ? `open "${link}"`
    : `xdg-open "${link}"`;
  exec(cmd, () => {});
}

// if it's already running (double clicked twice) just open the tab again
async function alreadyRunning(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/ping`, { signal: AbortSignal.timeout(800) });
    return (await r.json()).app === 'beat-garage';
  } catch {
    return false;
  }
}

async function start(port, triesLeft = 10) {
  if (await alreadyRunning(port)) {
    console.log(`\n  Already running at http://localhost:${port}, opening it.\n`);
    openBrowser(`http://localhost:${port}`);
    setTimeout(() => process.exit(0), 500);
    return;
  }

  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) return start(port + 1, triesLeft - 1);
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    const link = `http://localhost:${port}`;
    console.log(`\n  ${config.name || 'Hanna'}'s Beat is running at ${link}`);
    console.log('  (leave this window open, close it to stop the site)\n');
    if (!ebayKeys()) console.log('  no eBay key yet, the site will walk you through it\n');
    openBrowser(link);

    if (cacheAgeHours() > (config.autoRefreshHours || 24)) startRefresh();
  });
}

start(PORT);
