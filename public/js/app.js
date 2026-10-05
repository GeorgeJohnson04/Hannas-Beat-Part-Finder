// everything on the page

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  name: 'Hanna',
  mods: [],
  shops: [],
  themes: [],
  listings: [],
  news: [],
  updated: null,
  ebayReady: false,
  ebayStatus: null, // what the last refresh said: ok / no-keys / bad-keys
  build: [],
  group: 'All',
  source: 'all',
  partMod: 'all',
  sort: 'default',
  partsShown: 24,
  newsShown: 8,
  refreshing: false,
  setupOpen: false
};

const STORES = {
  ebay: { name: 'eBay', link: 'View on eBay' },
  pp1beat: { name: 'PP1 Beat', link: 'View on PP1 Beat' }
};

const CAT_LINES = ['meow', 'mrrp', 'meow?', 'purr', 'mew', 'mrow'];

// ---------- little helpers ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// round rough prices so they don't look fake-precise. $217.43 -> $220
function nice(n) {
  if (n < 20) return Math.round(n);
  if (n < 100) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}

const wholeFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const centsFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const usd = n => wholeFmt.format(n);
// real listing prices keep their cents ($195.80), but $40.00 shows as $40
const money = n => (n % 1 ? centsFmt : wholeFmt).format(n);

function usdRange(lo, hi) {
  return nice(lo) === nice(hi) ? usd(nice(lo)) : `${usd(nice(lo))} – ${usd(nice(hi))}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => fetch(url).then(r => r.json());

const pawSvg = on => `<svg class="${on ? 'on' : ''}"><use href="#paw"/></svg>`;

function shopUrl(shopId, q) {
  const shop = state.shops.find(s => s.id === shopId);
  if (!shop) return null;
  return q && shop.search ? shop.search.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+')) : shop.home;
}

// eBay (US sellers) first, then PP1 Beat if they carry it, then whatever else the mod lists
function modLinks(mod) {
  const links = [];
  if (mod.q) links.push(['eBay (US)', shopUrl('ebay', mod.q)]);
  if (mod.pp1) links.push(['PP1 Beat', shopUrl('pp1beat', mod.pp1)]);
  for (const l of mod.links || []) {
    const shop = state.shops.find(s => s.id === l.shop);
    if (shop) links.push([shop.name, shopUrl(l.shop, l.q)]);
  }
  if (mod.maps) links.push(['Shops near you', 'https://www.google.com/maps/search/' + encodeURIComponent(mod.maps)]);
  return links.filter(([, href]) => href)
    .map(([label, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`).join('');
}

function shippingText(l) {
  if (l.shipping === 0) return 'free shipping';
  if (l.shipping > 0) return `+ ${money(l.shipping)} shipping`;
  return 'shipping at checkout' + (l.shipNote ? ` (${l.shipNote})` : '');
}

// ---------- mods ----------

function renderModFilters() {
  const groups = ['All', ...new Set(state.mods.map(m => m.group))];
  $('#mod-filters').innerHTML = groups.map(g =>
    `<button type="button" class="chip ${g === state.group ? 'on' : ''}" data-group="${esc(g)}">${esc(g)}</button>`
  ).join('');
}

function renderMods() {
  // how many are for sale per mod, and the cheapest one
  const forSale = {};
  for (const l of state.listings) {
    const s = forSale[l.mod] || (forSale[l.mod] = { count: 0, min: Infinity });
    s.count++;
    if (l.price) s.min = Math.min(s.min, l.price);
  }

  const mods = state.mods.filter(m => state.group === 'All' || m.group === state.group);

  $('#mod-grid').innerHTML = mods.map(mod => {
    const inBuild = state.build.some(b => b.key === 'mod:' + mod.id);
    const paws = [1, 2, 3].map(i => pawSvg(i <= mod.paws)).join('');
    const sale = forSale[mod.id];

    return `
      <article class="mod" data-id="${esc(mod.id)}">
        ${mod.photo ? `
        <div class="photo">
          <img src="${esc(mod.photo.src)}" alt="${esc(mod.name)}" loading="lazy" referrerpolicy="no-referrer" data-zoom${mod.photo.pos ? ` style="object-position:${esc(mod.photo.pos)}"` : ''}>
        </div>` : '<div class="photo none"><svg><use href="#paw"/></svg></div>'}
        <div class="mod-top">
          <span class="group">${esc(mod.group)}</span>
          <span class="paws" title="difficulty ${mod.paws} of 3">${paws}</span>
        </div>
        <h3>${esc(mod.name)}</h3>
        <div class="price"><strong>${usdRange(mod.usd[0], mod.usd[1])}</strong><small>rough cost</small></div>
        <p>${esc(mod.why)}</p>
        <div class="tip"><svg><use href="#paw"/></svg><span>${esc(mod.tip)}</span></div>
        <div class="tags">${mod.brands.map(b => `<span class="tag">${esc(b)}</span>`).join('')}</div>
        <div class="mod-actions">
          <button type="button" class="small-btn add ${inBuild ? 'added' : ''}" data-add-mod="${esc(mod.id)}">${inBuild ? '✓ On your list' : '+ Add to list'}</button>
          ${sale ? `<button type="button" class="small-btn" data-show-parts="${esc(mod.id)}">${sale.count} for sale${sale.min < Infinity ? `, from ${money(sale.min)}` : ''}</button>` : ''}
          <div class="search-links">Find it: ${modLinks(mod)}</div>
        </div>
      </article>`;
  }).join('');
}

// ---------- listings ----------

function renderPartsToolbar() {
  $('#mod-select').innerHTML = '<option value="all">All parts</option>' +
    state.mods.filter(m => m.q).map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  $('#mod-select').value = state.partMod;
}

function listingKey(l) {
  return `${l.source}:${l.id || l.url}`;
}

const total = l => (l.price || 0) + (l.shipping || 0);

function filteredListings() {
  let list = state.listings.filter(l =>
    (state.source === 'all' || l.source === state.source) &&
    (state.partMod === 'all' || l.mod === state.partMod)
  );
  if (state.sort === 'low') list = [...list].sort((a, b) => total(a) - total(b));
  if (state.sort === 'high') list = [...list].sort((a, b) => total(b) - total(a));
  return list;
}

function renderSetup() {
  const badKeys = state.ebayReady && state.ebayStatus === 'bad-keys';
  $('#ebay-banner').hidden = state.ebayReady || state.setupOpen;
  $('#ebay-setup').hidden = !(state.setupOpen || badKeys);
  $('#change-keys').hidden = !state.ebayReady;
  if (badKeys) showSetupMsg('eBay stopped accepting the saved keys. Paste them in again.', 'bad');
}

function renderListings() {
  const grid = $('#listing-grid');
  const more = $('#parts-more');
  renderSetup();

  if (!state.listings.length) {
    grid.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 96 56"><use href="#cat-sleep"/></svg>
        <p>Nothing loaded yet. Hit <b>Refresh</b>, it takes a few seconds.</p>
      </div>`;
    more.hidden = true;
    return;
  }

  const list = filteredListings();
  const modName = id => state.mods.find(m => m.id === id)?.name || id;

  if (!list.length) {
    grid.innerHTML = `<div class="empty"><p>Nothing for that right now. Check back later or try another store.</p></div>`;
    more.hidden = true;
    return;
  }

  grid.innerHTML = list.slice(0, state.partsShown).map(l => {
    const key = listingKey(l);
    const inBuild = state.build.some(b => b.key === key);
    const store = STORES[l.source] || { name: l.source, link: 'View' };
    const meta = [store.name, l.condition, `ships from ${l.from || 'the US'}`].filter(Boolean).join(' · ');
    const badge = l.source === 'ebay' ? (l.auction ? 'Auction' : 'Buy It Now') : store.name;
    const badgeClass = l.source === 'ebay' ? (l.auction ? 'auction' : '') : l.source;
    const bids = l.auction ? ` · ${l.bids} bid${l.bids === 1 ? '' : 's'}` : '';

    return `
      <article class="listing">
        <a class="pic" href="${esc(l.url)}" target="_blank" rel="noopener">
          ${l.img ? `<img src="${esc(l.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : ''}
          <span class="src ${badgeClass}">${esc(badge)}</span>
        </a>
        <div class="body">
          <span class="mod-tag">${esc(modName(l.mod))}</span>
          <h4 title="${esc(l.title)}">${esc(l.title)}</h4>
          <p class="meta">${esc(meta)}</p>
          <div class="cost">
            <strong>${l.price ? money(l.price) : '?'}</strong>
            <small>${shippingText(l)}${bids}</small>
          </div>
          <div class="links">
            <a href="${esc(l.url)}" target="_blank" rel="noopener">${store.link}</a>
            <button type="button" class="small-btn ${inBuild ? 'add added' : ''}" data-add-listing="${esc(key)}" title="add to your list">${inBuild ? '✓' : '+'}</button>
          </div>
        </div>
      </article>`;
  }).join('');

  more.hidden = list.length <= state.partsShown;
  more.textContent = `Show more (${list.length - state.partsShown} left)`;
}

function renderUpdated() {
  $('#updated-note').textContent = state.updated ? `Updated ${timeAgo(state.updated)}.` : '';
}

// ---------- looks ----------

function renderThemes() {
  $('#theme-grid').innerHTML = state.themes.map(theme => {
    const mods = theme.mods.map(id => state.mods.find(m => m.id === id)).filter(Boolean);
    const lo = mods.reduce((sum, m) => sum + m.usd[0], 0);
    const hi = mods.reduce((sum, m) => sum + m.usd[1], 0);
    const allIn = mods.every(m => state.build.some(b => b.key === 'mod:' + m.id));

    return `
      <article class="theme">
        <div class="theme-photo">
          ${theme.photo ? `<img src="${esc(theme.photo.src)}" alt="${esc(theme.name)}" loading="lazy" referrerpolicy="no-referrer"${theme.photo.pos ? ` style="object-position:${esc(theme.photo.pos)}"` : ''}>` : ''}
          <div class="swatches">${theme.colors.map(c => `<span style="background:${esc(c)}"></span>`).join('')}</div>
        </div>
        <div class="theme-body">
          <h3>${esc(theme.name)}</h3>
          <p>${esc(theme.about)}</p>
          <div class="theme-mods">
            ${mods.map(m => `<a href="#mods" data-goto="${esc(m.id)}">${m.photo ? `<img src="${esc(m.photo.src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(m.name)}</a>`).join('')}
          </div>
          <div class="theme-foot">
            <span class="cost">${usdRange(lo, hi)}<small>rough cost for everything</small></span>
            <button type="button" class="small-btn add ${allIn ? 'added' : ''}" data-add-theme="${esc(theme.id)}">${allIn ? '✓ All on your list' : '+ Add all to list'}</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

// jump to a mod card from a look and make it blink so it's easy to spot
function gotoMod(id) {
  state.group = 'All';
  renderModFilters();
  renderMods();
  const card = $(`.mod[data-id="${id}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
}

// the commons photos need credit, so they're listed in the footer instead of on the pictures
function renderCredits() {
  const seen = new Set();
  const rows = [];
  for (const item of [...state.mods, ...state.themes]) {
    const p = item.photo;
    if (!p?.page || seen.has(p.page)) continue;
    seen.add(p.page);
    rows.push(`<li><a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(item.name)}</a>: ${esc(p.credit)}</li>`);
  }
  $('#credits-list').innerHTML = rows.join('');
}

// ---------- shops ----------

function renderShops() {
  $('#shop-grid').innerHTML = state.shops.map(shop => `
    <article class="shop">
      <h3>${esc(shop.name)}</h3>
      <div class="where">${esc(shop.where)}</div>
      <p>${esc(shop.about)}</p>
      <div class="tags">${shop.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="shop-actions">
        <a class="small-btn add" href="${esc(shop.home)}" target="_blank" rel="noopener">Go to ${esc(shop.name)}</a>
      </div>
    </article>`).join('');
}

// ---------- ebay setup ----------

function showSetupMsg(text, kind = '') {
  const msg = $('#setup-msg');
  msg.textContent = text;
  msg.className = 'setup-msg ' + kind;
}

async function saveKeys(e) {
  e.preventDefault();
  const form = e.target;
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  showSetupMsg('Checking with eBay...');

  try {
    const res = await fetch('/api/ebay', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const j = await res.json();
    if (!res.ok) {
      showSetupMsg(j.error || "That didn't work.", 'bad');
      return;
    }
    form.reset();
    showSetupMsg('');
    state.setupOpen = false;
    state.ebayReady = true;
    state.ebayStatus = 'ok';
    toast('eBay connected');
    renderListings();
    refresh();
  } catch {
    showSetupMsg("Can't reach the server. Is the Start.bat window still open?", 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ---------- news ----------

function renderNews() {
  const box = $('#news-list');
  if (!state.news.length) {
    box.innerHTML = `<p class="hint">Nothing yet. Hit refresh.</p>`;
    $('#news-more').hidden = true;
    return;
  }
  box.innerHTML = state.news.slice(0, state.newsShown).map(n => `
    <a class="news-item" href="${esc(n.url)}" target="_blank" rel="noopener">
      <h4>${esc(n.title)}</h4>
      <small><b>${esc(n.source)}</b> &middot; ${esc(timeAgo(n.date))}</small>
    </a>`).join('');
  $('#news-more').hidden = state.news.length <= state.newsShown;
}

// ---------- your list ----------

function buildCost(item) {
  if (item.kind === 'mod') {
    const mod = state.mods.find(m => m.id === item.id);
    return mod ? { lo: mod.usd[0], hi: mod.usd[1], exact: false } : { lo: 0, hi: 0 };
  }
  const v = total(item);
  return { lo: v, hi: v, exact: true };
}

function renderBuild() {
  const list = $('#build-list');
  $('#build-count').textContent = state.build.length;

  if (!state.build.length) {
    list.innerHTML = `
      <li class="empty">
        <svg viewBox="0 0 96 56"><use href="#cat-sleep"/></svg>
        <p>Nothing here yet.</p>
      </li>`;
    $('#build-total').textContent = '$0';
    return;
  }

  let lo = 0, hi = 0;
  list.innerHTML = state.build.map((item, i) => {
    const c = buildCost(item);
    lo += c.lo;
    hi += c.hi;
    const pic = item.kind === 'mod'
      ? '<svg class="icon"><use href="#paw"/></svg>'
      : `<img src="${esc(item.img)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
    const sub = item.kind === 'mod'
      ? 'mod, rough cost'
      : `<a href="${esc(item.url)}" target="_blank" rel="noopener">${(STORES[item.source] || STORES.ebay).name}</a> · ${shippingText(item)}`;

    return `
      <li class="build-item ${item.done ? 'done' : ''}">
        <button type="button" class="check" data-check="${i}" title="mark as done"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        ${pic}
        <div class="what"><b title="${esc(item.title)}">${esc(item.title)}</b><small>${sub}</small></div>
        <span class="cost">${c.exact ? money(c.lo) : usdRange(c.lo, c.hi)}</span>
        <button type="button" class="remove" data-remove="${i}" title="remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
      </li>`;
  }).join('');

  $('#build-total').textContent = usdRange(lo, hi);
}

function saveBuild() {
  fetch('/api/build', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.build)
  }).catch(() => toast("Couldn't save. Is the Start.bat window still open?"));
  renderBuild();
  renderMods();
  renderListings();
  renderThemes();
}

function toggleBuild(item) {
  const i = state.build.findIndex(b => b.key === item.key);
  if (i >= 0) {
    state.build.splice(i, 1);
    toast('Removed from your list');
  } else {
    state.build.push(item);
    toast('Added to your list');
  }
  saveBuild();
}

// ---------- refresh ----------

function setRefreshing(on) {
  state.refreshing = on;
  for (const b of $$('[data-refresh]')) {
    b.disabled = on;
    b.classList.toggle('spinning', on);
  }
  $('#progress').hidden = !on;
}

function showProgress({ done, total, label }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-cat').style.left = pct + '%';
  $('#progress-label').textContent = label && label !== 'starting'
    ? `Checking ${label.toLowerCase()}... ${done}/${total}`
    : 'Starting...';
}

async function watchRefresh() {
  setRefreshing(true);
  let status;
  for (;;) {
    status = await getJson('/api/status').catch(() => ({ running: false, error: 'lost the server' }));
    showProgress(status);
    if (!status.running) break;
    await sleep(700);
  }
  setRefreshing(false);

  if (status.error) {
    toast("Couldn't refresh: " + status.error);
    return;
  }
  await loadListings();
  toast(`Updated: ${state.listings.length} parts, ${state.news.length} articles`);
}

async function refresh() {
  if (state.refreshing) return;
  $('#parts').scrollIntoView({ behavior: 'smooth' });
  try {
    await fetch('/api/refresh', { method: 'POST' });
  } catch {
    toast("Can't reach the server. Is the Start.bat window still open?");
    return;
  }
  watchRefresh();
}

async function loadListings() {
  const data = await getJson('/api/listings');
  state.listings = data.listings || [];
  state.news = data.news || [];
  state.updated = data.updated;
  state.ebayStatus = data.ebay || null;
  renderUpdated();
  renderMods();
  renderListings();
  renderNews();
  renderBuild();
}

// ---------- decoration ----------

function makeStars() {
  const box = $('#stars');
  let html = '';
  for (let i = 0; i < 150; i++) {
    const big = Math.random() < 0.12;
    html += `<span class="${big ? 'big' : ''}" style="top:${(Math.random() * 80).toFixed(2)}%;left:${(Math.random() * 100).toFixed(2)}%;animation-delay:${(Math.random() * 4).toFixed(2)}s;animation-duration:${(3 + Math.random() * 4).toFixed(2)}s"></span>`;
  }
  box.innerHTML = html;
}

function say(bubble, text, ms = 1600) {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubble._t);
  bubble._t = setTimeout(() => bubble.classList.remove('show'), ms);
}

const randomLine = () => CAT_LINES[Math.floor(Math.random() * CAT_LINES.length)];

function setupWalker() {
  const cat = $('#walker');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let siamese = false;
  const walk = () => {
    $('use', cat).setAttribute('href', siamese ? '#cat-walk-siamese' : '#cat-walk');
    siamese = !siamese;
    cat.classList.remove('paused');
    cat.classList.add('go');
  };

  cat.addEventListener('animationend', e => {
    if (e.animationName !== 'walk') return;
    cat.classList.remove('go');
    setTimeout(walk, 45000 + Math.random() * 45000);
  });

  cat.addEventListener('click', () => {
    cat.classList.add('paused');
    say($('.bubble', cat), randomLine());
    setTimeout(() => cat.classList.remove('paused'), 1600);
  });

  setTimeout(walk, 9000);
}

function openLightbox(src, alt) {
  const img = $('#lightbox img');
  img.src = src;
  img.alt = alt;
  $('#lightbox').hidden = false;
}

function setupGallery() {
  const box = $('#lightbox');
  for (const img of $$('.snap, .side-snap')) {
    img.addEventListener('click', () => openLightbox(img.src, img.alt));
  }
  box.addEventListener('click', () => { box.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') box.hidden = true; });
}

// ---------- events ----------

function wireEvents() {
  for (const b of $$('[data-refresh]')) b.addEventListener('click', refresh);

  $('#ebay-setup').addEventListener('submit', saveKeys);
  const openSetup = () => {
    state.setupOpen = true;
    renderSetup();
    $('#ebay-setup').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('#change-keys').addEventListener('click', openSetup);
  $('#show-setup').addEventListener('click', openSetup);

  $('#theme-grid').addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) {
      e.preventDefault();
      gotoMod(go.dataset.goto);
      return;
    }
    const add = e.target.closest('[data-add-theme]');
    if (!add) return;
    const theme = state.themes.find(t => t.id === add.dataset.addTheme);
    const missing = theme.mods
      .map(id => state.mods.find(m => m.id === id))
      .filter(m => m && !state.build.some(b => b.key === 'mod:' + m.id));
    if (!missing.length) {
      toast('Those are all on your list already');
      return;
    }
    for (const m of missing) state.build.push({ key: 'mod:' + m.id, kind: 'mod', id: m.id, title: m.name });
    toast(`Added ${missing.length} thing${missing.length === 1 ? '' : 's'} to your list`);
    saveBuild();
  });

  $('#mod-filters').addEventListener('click', e => {
    const chip = e.target.closest('[data-group]');
    if (!chip) return;
    state.group = chip.dataset.group;
    renderModFilters();
    renderMods();
  });

  $('#mod-grid').addEventListener('click', e => {
    // commons thumbnails come in standard widths, 960 is the next one up from 500
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) {
      openLightbox(zoom.src.replace('/500px-', '/960px-'), zoom.alt);
      return;
    }
    const add = e.target.closest('[data-add-mod]');
    if (add) {
      const mod = state.mods.find(m => m.id === add.dataset.addMod);
      toggleBuild({ key: 'mod:' + mod.id, kind: 'mod', id: mod.id, title: mod.name });
      return;
    }
    const show = e.target.closest('[data-show-parts]');
    if (show) {
      state.partMod = show.dataset.showParts;
      state.partsShown = 24;
      $('#mod-select').value = state.partMod;
      renderListings();
      $('#parts').scrollIntoView({ behavior: 'smooth' });
    }
  });

  $('#source-select').addEventListener('change', e => {
    state.source = e.target.value;
    state.partsShown = 24;
    renderListings();
  });

  $('#mod-select').addEventListener('change', e => {
    state.partMod = e.target.value;
    state.partsShown = 24;
    renderListings();
  });

  $('#sort-select').addEventListener('change', e => {
    state.sort = e.target.value;
    renderListings();
  });

  $('#parts-more').addEventListener('click', () => {
    state.partsShown += 24;
    renderListings();
  });

  $('#listing-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-add-listing]');
    if (!btn) return;
    const l = state.listings.find(x => listingKey(x) === btn.dataset.addListing);
    if (!l) return;
    toggleBuild({
      key: listingKey(l), kind: 'listing', title: l.title, price: l.price, shipping: l.shipping,
      shipNote: l.shipNote, url: l.url, img: l.img, mod: l.mod, source: l.source
    });
  });

  $('#news-more').addEventListener('click', () => {
    state.newsShown += 8;
    renderNews();
  });

  $('#build-list').addEventListener('click', e => {
    const check = e.target.closest('[data-check]');
    if (check) {
      const item = state.build[Number(check.dataset.check)];
      item.done = !item.done;
      saveBuild();
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      state.build.splice(Number(rm.dataset.remove), 1);
      saveBuild();
    }
  });

  $('.sit-cat').addEventListener('click', e => say($('.bubble', e.currentTarget), randomLine()));
}

// ---------- go ----------

async function init() {
  makeStars();
  wireEvents();
  setupGallery();
  setupWalker();

  const [config, mods, shops, themes, build, ebay] = await Promise.all([
    getJson('/api/config').catch(() => ({})),
    getJson('/api/mods'),
    getJson('/api/shops').catch(() => []),
    getJson('/api/themes').catch(() => []),
    getJson('/api/build').catch(() => []),
    getJson('/api/ebay').catch(() => ({}))
  ]);

  state.name = config.name || state.name;
  state.mods = mods;
  state.shops = shops;
  state.themes = themes;
  state.build = build;
  state.ebayReady = !!ebay.configured;

  document.title = `${state.name}'s Beat`;
  for (const el of $$('[data-name]')) el.textContent = state.name;

  renderModFilters();
  renderPartsToolbar();
  renderShops();
  renderThemes();
  renderCredits();
  await loadListings();

  // the server kicks off a refresh by itself on startup if the data's old
  const status = await getJson('/api/status').catch(() => ({}));
  if (status.running) watchRefresh();

  // keep "updated x ago" honest if the tab stays open all day
  setInterval(renderUpdated, 60000);
}

init();
