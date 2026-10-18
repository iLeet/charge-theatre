'use strict';
/* Charge Theatre front end: library, show pages and the player. No build step, no framework. */

const $ = (s, el = document) => el.querySelector(s);
const appEl = $('#app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- icons ---------------------------------------------------------------------------------------
const ICON_PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  back: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  cc: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM11 11H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z',
  audio: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 13.9 2h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 0 0-.6.22L2.69 8.47a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.48.48 0 0 0-.12-.64l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  full: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  bolt: 'M13 2 4 14h6l-2 8 10-13h-6z',
};
const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true">${extra}<path d="${ICON_PATHS[name]}"/></svg>`;
const ICON_HTML = {
  ...Object.fromEntries(Object.keys(ICON_PATHS).map((k) => [k, svg(k)])),
  rew: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.5" font-size="7.5" text-anchor="middle" font-weight="700" fill="currentColor">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.5" font-size="7.5" text-anchor="middle" font-weight="700" fill="currentColor">10</text></svg>',
};
function paintIcons(root = document) {
  root.querySelectorAll('[data-i]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', ICON_HTML[el.dataset.i] || '');
    el.removeAttribute('data-i');
  });
}

// ---- helpers -------------------------------------------------------------------------------------
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
async function api(path, opts) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts });
  if (r.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json();
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Broken thumbnails just fall back to the gradient background.
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);

// Opening the player from a tap is the best chance we get to go fullscreen.
document.addEventListener('click', (e) => {
  if (e.target.closest('a[href^="#/play/"]')) tryFullscreen();
});

// ---- router --------------------------------------------------------------------------------------
let currentRoute = '';
let cameFromApp = false;

function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  const [page, arg] = parts;
  if (page === 'play') {
    cameFromApp = cameFromApp || !!currentRoute;
    openPlayer(arg);
    return;
  }
  const wasPlaying = !$('#player').hidden;
  if (wasPlaying) closePlayer({ navigate: false });
  cameFromApp = false;
  currentRoute = location.hash;
  window.scrollTo(0, 0);
  if (page === 'show') return renderShow(arg);
  if (page === 'diag') return renderDiag();
  return renderHome();
}
window.addEventListener('hashchange', route);

// ---- home ----------------------------------------------------------------------------------------
let homeData = null;
let homeFilter = '';

const showCard = (s, cls = 'tall') => `
  <a class="card ${cls}" href="${s.playId ? `#/play/${s.playId}` : `#/show/${s.id}`}">
    <div class="art"><img loading="lazy" src="${esc(s.poster)}" alt="">
      ${s.pinned ? `<span class="pin-dot">${ICON_HTML.star}</span>` : ''}
      ${s.kind === 'show' ? `<span class="badge">${s.count} ep</span>` : ''}
      <div class="title-over">${esc(s.name)}</div>
    </div>
  </a>`;

const itemCard = (c) => {
  const pct = c.duration ? Math.min(100, (c.pos / c.duration) * 100) : 0;
  const left = c.duration && c.pos ? `${fmtDur(c.duration - c.pos)} left` : fmtDur(c.duration);
  return `
  <a class="card wide" href="#/play/${c.id}">
    <div class="art"><img loading="lazy" src="${esc(c.thumb)}" alt="">
      <div class="play-over">${ICON_HTML.play}</div>
      ${pct ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <div class="cap">${esc(c.showName)}</div>
    <div class="sub">${c.upNext ? 'Up next · ' : ''}${esc([c.label, c.title !== c.showName ? c.title : ''].filter(Boolean).join(' · '))}${left ? ` · ${left}` : ''}</div>
  </a>`;
};

async function renderHome() {
  if (!homeData) appEl.innerHTML = '<div class="loading">Loading library…</div>';
  try { homeData = await api('/api/library'); } catch (e) { appEl.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
  drawHome();
}

function drawHome() {
  const d = homeData;
  document.title = d.name;
  const byId = new Map(d.shows.map((s) => [s.id, s]));
  const q = homeFilter.trim().toLowerCase();
  const filtered = q ? d.shows.filter((s) => s.name.toLowerCase().includes(q)) : d.shows;
  const pinned = d.pinned.map((id) => byId.get(id)).filter(Boolean);
  const recent = d.recent.map((id) => byId.get(id)).filter(Boolean);

  let html = `
    <div class="topbar">
      <div class="brand">${ICON_HTML.bolt}<span>${esc(d.name)}</span></div>
      <label class="search">${ICON_HTML.search}<input id="q" type="search" placeholder="Search" value="${esc(homeFilter)}" autocomplete="off"></label>
      <button class="iconbtn" id="rescan" aria-label="Rescan library">${ICON_HTML.refresh}</button>
    </div><main>`;

  if (!d.shows.length) {
    html += `<div class="empty"><h2>Your library is empty</h2><p>Put your shows and movies in the <code>media</code> folder on the server, then tap the refresh button.</p></div>`;
  } else if (!q) {
    if (d.continue.length) html += `<h2 class="row-title">Continue watching</h2><div class="rail">${d.continue.map(itemCard).join('')}</div>`;
    html += `<h2 class="row-title">Now watching <small>pin shows from their page</small></h2>`;
    html += pinned.length ? `<div class="rail">${pinned.map((s) => showCard(s)).join('')}</div>`
      : `<div class="empty">Open a show and tap “Now watching” to keep it here.</div>`;
    if (recent.length) html += `<h2 class="row-title">Recently added</h2><div class="rail">${recent.map((s) => showCard(s)).join('')}</div>`;
    html += `<h2 class="row-title">All titles <small>${d.shows.length}</small></h2><div class="grid" id="grid">${d.shows.map((s) => showCard(s)).join('')}</div>`;
  } else {
    html += `<h2 class="row-title">Results <small>${filtered.length}</small></h2><div class="grid" id="grid">${filtered.map((s) => showCard(s)).join('') || '<div class="empty">Nothing found.</div>'}</div>`;
  }
  html += `<p class="empty" style="margin-top:3rem"><a href="#/diag">Device check</a> · <a href="/logout">Sign out</a></p></main>`;

  const hadFocus = document.activeElement && document.activeElement.id === 'q';
  appEl.innerHTML = html;
  const input = $('#q');
  input.addEventListener('input', () => { homeFilter = input.value; drawHome(); });
  if (hadFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  $('#rescan').addEventListener('click', async () => {
    toast('Scanning library…', 1500);
    try { homeData = await api('/api/library?rescan=1'); drawHome(); toast(`${homeData.shows.length} titles`); } catch (e) { toast(e.message); }
  });
}

// ---- show page -----------------------------------------------------------------------------------
let showSeason = null;

async function renderShow(id) {
  appEl.innerHTML = '<div class="loading">Loading…</div>';
  let d;
  try { d = await api('/api/show/' + id); } catch (e) { appEl.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
  document.title = d.name;
  if (!d.seasons.some((s) => s.season === showSeason && d._id === id)) {
    const resumeSeason = d.seasons.find((s) => s.episodes.some((e) => e.id === d.resume.id));
    showSeason = (resumeSeason || d.seasons[0]).season;
  }
  drawShow(d);
}

function drawShow(d) {
  const season = d.seasons.find((s) => s.season === showSeason) || d.seasons[0];
  const nEps = d.count;
  const meta = d.kind === 'movie' ? '' : `${d.seasons.length > 1 ? `${d.seasons.length} seasons · ` : ''}${nEps} episode${nEps === 1 ? '' : 's'}`;
  const r = d.resume;
  const playLabel = d.kind === 'movie' ? (r.pos ? 'Resume' : 'Play') : r.started ? `Resume ${r.label}` : `Play ${r.label}`;
  appEl.innerHTML = `
    <div class="hero" style="--bg-img:url('${esc(d.backdrop)}')">
      <button class="btn" id="home">${ICON_HTML.back}<span>Library</span></button>
      <div class="hero-in">
        <div class="hero-poster"><img src="${esc(d.poster)}" alt=""></div>
        <div>
          <h1>${esc(d.name)}</h1>
          <p class="meta">${esc(meta)}</p>
          <div class="actions">
            <a class="btn primary" href="#/play/${r.id}">${ICON_HTML.play}<span>${esc(playLabel)}</span></a>
            <button class="btn ${d.pinned ? 'on' : ''}" id="pin">${ICON_HTML.star}<span>${d.pinned ? 'Now watching' : 'Add to Now watching'}</span></button>
          </div>
        </div>
      </div>
    </div>
    ${d.seasons.length > 1 ? `<div class="chips">${d.seasons.map((s) => `<button class="chip ${s === season ? 'on' : ''}" data-season="${s.season}">${esc(s.name)}</button>`).join('')}</div>` : ''}
    <div class="eps">${season.episodes.map(epRow).join('')}</div>`;
  $('#home').addEventListener('click', () => { location.hash = '#/'; });
  $('#pin').addEventListener('click', async () => {
    d.pinned = !d.pinned;
    try { await post('/api/pin', { showId: d.id, on: d.pinned }); homeData = null; } catch (e) { d.pinned = !d.pinned; toast(e.message); }
    drawShow(d);
  });
  appEl.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    showSeason = Number(b.dataset.season);
    drawShow(d);
  }));
  appEl.querySelectorAll('.chk').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const ep = d.seasons.flatMap((s) => s.episodes).find((x) => x.id === b.dataset.id);
    ep.done = !ep.done;
    if (ep.done) ep.pos = 0;
    try { await post('/api/watched', { id: ep.id, watched: ep.done }); homeData = null; } catch (err) { toast(err.message); }
    drawShow(d);
  }));
}

function epRow(e) {
  const pct = e.duration && e.pos ? Math.min(100, (e.pos / e.duration) * 100) : 0;
  let status = fmtDur(e.duration);
  if (e.done) status = `<span class="done">Watched</span>${status ? ' · ' + status : ''}`;
  else if (e.pos && e.duration) status = `${fmtDur(e.duration - e.pos)} left`;
  return `
  <a class="ep ${e.done ? 'watched' : ''}" href="#/play/${e.id}">
    <div class="th"><img loading="lazy" src="${esc(e.thumb)}" alt="">${pct ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}</div>
    <div class="tx"><div class="t1">${esc([e.label, e.title].filter(Boolean).join(' · '))}</div><div class="t2">${status}</div></div>
    <button class="chk ${e.done ? 'on' : ''}" data-id="${e.id}" aria-label="Toggle watched">${ICON_HTML.check}</button>
  </a>`;
}

// ---- device check --------------------------------------------------------------------------------
function renderDiag() {
  const v = document.createElement('video');
  const tests = [
    ['H.264 + AAC in MP4', 'video/mp4; codecs="avc1.640028, mp4a.40.2"'],
    ['H.264 + AAC in MKV', 'video/x-matroska; codecs="avc1.640028, mp4a.40.2"'],
    ['HEVC (H.265) 8-bit in MP4', 'video/mp4; codecs="hvc1.1.6.L120.B0, mp4a.40.2"'],
    ['HEVC (H.265) 10-bit in MP4', 'video/mp4; codecs="hvc1.2.4.L120.B0, mp4a.40.2"'],
    ['AV1 in MP4', 'video/mp4; codecs="av01.0.08M.08, mp4a.40.2"'],
    ['VP9 + Opus in WebM', 'video/webm; codecs="vp9, opus"'],
    ['H.264 + AC-3 in MP4', 'video/mp4; codecs="avc1.640028, ac-3"'],
    ['H.264 + E-AC-3 in MP4', 'video/mp4; codecs="avc1.640028, ec-3"'],
  ];
  const rows = tests.map(([n, m]) => { const r = v.canPlayType(m); return `<tr><td>${n}</td><td class="${r ? 'yes' : 'no'}">${r || 'no'}</td></tr>`; }).join('');
  const hlsMode = window.Hls && Hls.isSupported() ? 'hls.js (Media Source Extensions)' : v.canPlayType('application/vnd.apple.mpegurl') ? 'native HLS' : 'not available';
  appEl.innerHTML = `
    <div class="topbar"><button class="btn" id="home">${ICON_HTML.back}<span>Library</span></button></div>
    <div class="diag"><h2>Device check</h2>
      <p>Files that match a “yes/maybe/probably” row play straight from the server with no quality loss. Everything else is transcoded on the fly.</p>
      <table>${rows}
        <tr><td>HLS playback</td><td>${hlsMode}</td></tr>
        <tr><td>Fullscreen API</td><td>${document.fullscreenEnabled || document.webkitFullscreenEnabled ? 'yes' : 'no'}</td></tr>
        <tr><td>Screen</td><td>${screen.width}×${screen.height} @${devicePixelRatio}x, viewport ${innerWidth}×${innerHeight}</td></tr>
        <tr><td>Browser</td><td>${esc(navigator.userAgent)}</td></tr>
      </table></div>`;
  $('#home').addEventListener('click', () => { location.hash = '#/'; });
}

// ====================================================================================================
//  Player
// ====================================================================================================
const playerEl = $('#player');
const V = $('#video');
const ui = $('#ui');
const P = { item: null, hls: null, mode: 'hls', q: 'source', audio: 0, sub: -1, noDirect: false, hlsRetries: 0, lastSave: 0, uiTimer: null, upTimer: null, token: 0 };

paintIcons(playerEl);

const getDur = () => (P.item && P.item.duration) || (isFinite(V.duration) ? V.duration : 0);

function tryFullscreen() {
  const fn = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
  if (fn && !document.fullscreenElement) { try { const p = fn.call(playerEl); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
}
function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else tryFullscreen();
}

function canDirect(item, audioIdx) {
  if (P.noDirect || !item.directMime || audioIdx !== item.audioDefault) return false;
  const r = V.canPlayType(item.directMime);
  return item.ext === '.mkv' ? r === 'probably' : !!r;
}

function chosenQualityPref() { return store.get('ct.quality', 'auto'); }

function planPlayback() {
  const item = P.item;
  const pref = chosenQualityPref();
  const direct = canDirect(item, P.audio);
  if ((pref === 'auto' || pref === 'direct') && direct) { P.mode = 'direct'; return; }
  P.mode = 'hls';
  P.q = pref !== 'auto' && pref !== 'direct' && item.qualities.some((x) => x.id === pref) ? pref : 'source';
}

function setSpinner(msg) {
  const sp = $('#spinner');
  sp.hidden = !msg;
  $('#spinMsg').textContent = msg || '';
}

function updateBadge() {
  const item = P.item;
  if (!item) return;
  const h = item.video ? item.video.height : 0;
  let txt;
  if (P.mode === 'direct') txt = `Direct${h ? ` · ${h}p` : ''}`;
  else {
    const q = item.qualities.find((x) => x.id === P.q);
    txt = `${q ? q.label : P.q} · transcoding`;
  }
  $('#pBadge').textContent = txt;
}

async function openPlayer(id) {
  if (P.item && P.item.id === id && !playerEl.hidden) return;
  const token = ++P.token;
  teardown();
  playerEl.hidden = false;
  document.body.classList.add('playing');
  setSpinner('Loading…');
  showUi();
  let item;
  try { item = await api('/api/item/' + id); } catch (e) {
    if (token !== P.token) return;
    toast(e.message, 5000);
    closePlayer({});
    return;
  }
  if (token !== P.token) return;
  P.item = item;
  P.audio = item.audioDefault;
  P.sub = -1;
  P.noDirect = false;
  P.hlsRetries = 0;
  $('#pShow').textContent = item.showName;
  $('#pEp').textContent = [item.label, item.title !== item.showName ? item.title : ''].filter(Boolean).join(' · ');
  document.title = `${item.showName} ${item.label}`.trim();
  $('#pPrev').disabled = !item.prev;
  $('#pNext').disabled = !item.next;
  $('#pAudio').hidden = item.audio.length < 2;
  $('#pSubs').hidden = !item.subs.length;
  $('#pSpeed span').textContent = `${V.playbackRate = 1}×`;
  buildTracks(item);
  planPlayback();
  load(item.resume);
  setMediaSession(item);
}

function buildTracks(item) {
  V.querySelectorAll('track').forEach((t) => t.remove());
  const names = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();
  item.subs.forEach((s) => {
    const t = document.createElement('track');
    t.kind = 'subtitles';
    let lang = s.lang;
    try { if (names && lang !== 'und') lang = names.of(lang) || lang; } catch { /* keep code */ }
    s.name = [lang === 'und' ? 'Subtitles' : lang, s.forced ? 'forced' : '', s.title && s.title.toLowerCase() !== s.lang ? s.title : ''].filter(Boolean).join(' · ');
    t.label = s.name;
    t.src = s.url;
    t.default = false;
    V.appendChild(t);
  });
  // Re-enable the last used subtitle language automatically.
  const want = store.get('ct.sublang', '');
  if (want) {
    const i = item.subs.findIndex((s) => s.lang === want);
    if (i >= 0) selectSub(i, false);
  }
}

function selectSub(i, remember = true) {
  P.sub = i;
  [...V.textTracks].forEach((t, n) => { t.mode = n === i ? 'showing' : 'disabled'; });
  $('#pSubs').classList.toggle('on', i >= 0);
  if (remember) store.set('ct.sublang', i >= 0 ? P.item.subs[i].lang : '');
}

function destroyHls() {
  if (P.hls) { try { P.hls.destroy(); } catch { /* ignore */ } P.hls = null; }
}

function load(startAt) {
  const item = P.item;
  destroyHls();
  V.pause();
  V.removeAttribute('src');
  V.load();
  setSpinner(P.mode === 'hls' ? 'Starting stream…' : 'Loading…');
  updateBadge();
  const resumeAt = startAt > 3 ? startAt : 0;

  const startPlayback = () => {
    if (resumeAt) { try { V.currentTime = resumeAt; } catch { /* ignore */ } }
    V.play().catch(() => { setSpinner(''); });
  };

  if (P.mode === 'direct') {
    V.src = item.directUrl;
    V.addEventListener('loadedmetadata', startPlayback, { once: true });
    return;
  }
  const url = `/hls/${item.id}/${P.q}/${P.audio}/index.m3u8`;
  if (window.Hls && Hls.isSupported()) {
    const slow = { maxTimeToFirstByteMs: 120000, maxLoadTimeMs: 180000, timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 } };
    const hls = new Hls({
      startPosition: resumeAt || -1,
      maxBufferLength: 40,
      maxMaxBufferLength: 90,
      backBufferLength: 30,
      fragLoadPolicy: { default: slow },
      manifestLoadPolicy: { default: { ...slow, maxTimeToFirstByteMs: 30000, maxLoadTimeMs: 30000 } },
    });
    P.hls = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => V.play().catch(() => setSpinner('')));
    hls.on(Hls.Events.ERROR, (_e, data) => onHlsError(hls, data));
    hls.loadSource(url);
    hls.attachMedia(V);
  } else if (V.canPlayType('application/vnd.apple.mpegurl')) {
    V.src = url;
    V.addEventListener('loadedmetadata', startPlayback, { once: true });
  } else {
    toast('This browser cannot play streamed video.', 6000);
  }
}

function onHlsError(hls, data) {
  if (hls !== P.hls || !data.fatal) return;
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR && P.hlsRetries++ < 4) {
    setSpinner('Reconnecting…');
    setTimeout(() => { if (hls === P.hls) hls.startLoad(); }, 1500);
  } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && P.hlsRetries++ < 4) {
    hls.recoverMediaError();
  } else {
    setSpinner('');
    toast('Playback failed. Try a different quality.', 6000);
  }
}

function reloadHere() {
  const t = V.currentTime || 0;
  load(t);
}

// Direct play failed (codec the car can't decode, etc.) -> fall back to transcoding automatically.
V.addEventListener('error', () => {
  if (!P.item || P.mode !== 'direct') return;
  P.noDirect = true;
  toast('Switching to compatible mode…');
  planPlayback();
  reloadHere();
});

// Some decoders claim support but show nothing (audio only, frozen frame). Catch that and transcode instead.
let directWatch = 0;
function watchDirect() {
  clearTimeout(directWatch);
  if (P.mode !== 'direct') return;
  const t0 = V.currentTime;
  directWatch = setTimeout(() => {
    if (P.mode !== 'direct' || V.paused || V.ended) return;
    if (V.videoWidth === 0 || V.currentTime - t0 < 0.5) {
      P.noDirect = true;
      toast('Switching to compatible mode…');
      planPlayback();
      reloadHere();
    }
  }, 4000);
}

V.addEventListener('playing', () => { setSpinner(''); P.hlsRetries = 0; syncPlayIcon(); scheduleHide(); watchDirect(); });
V.addEventListener('waiting', () => { setTimeout(() => { if (V.readyState < 3 && !V.paused) setSpinner(P.mode === 'hls' ? 'Buffering…' : ''); }, 500); });
V.addEventListener('canplay', () => { if (!V.paused || V.readyState >= 3) setSpinner(''); });
V.addEventListener('pause', () => { syncPlayIcon(); saveProgress(); showUi(); });
V.addEventListener('play', syncPlayIcon);
V.addEventListener('seeked', () => { saveProgress(); });
V.addEventListener('ended', onEnded);
V.addEventListener('timeupdate', () => {
  if (!seekState.dragging) paintSeek(V.currentTime);
  if (Date.now() - P.lastSave > 10000) saveProgress();
});
V.addEventListener('progress', paintBuffer);
V.addEventListener('durationchange', () => paintSeek(V.currentTime));

function syncPlayIcon() {
  const b = $('#pPlay');
  b.innerHTML = V.paused ? ICON_HTML.play : ICON_HTML.pause;
}

// ---- progress saving
function saveProgress(beacon) {
  if (!P.item || !(V.currentTime > 0)) return;
  const dur = getDur();
  if (!dur) return;
  P.lastSave = Date.now();
  const body = JSON.stringify({ id: P.item.id, pos: V.currentTime, dur });
  if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' })); return; }
  fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
}
window.addEventListener('pagehide', () => saveProgress(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(true); });

// ---- seek bar
const seekEl = $('#seek');
const seekState = { dragging: false, t: 0 };
function paintSeek(t) {
  const dur = getDur();
  const pct = dur ? Math.min(100, (t / dur) * 100) : 0;
  $('#seekPlayed').style.width = pct + '%';
  $('#seekKnob').style.left = pct + '%';
  $('#pTime').textContent = `${fmtClock(t)} / ${fmtClock(dur)}`;
}
function paintBuffer() {
  const dur = getDur();
  let end = 0;
  for (let i = 0; i < V.buffered.length; i++) {
    if (V.buffered.start(i) <= V.currentTime + 0.5 && V.buffered.end(i) >= V.currentTime) end = V.buffered.end(i);
  }
  $('#seekBuf').style.width = dur ? Math.min(100, (end / dur) * 100) + '%' : '0';
}
function seekFromEvent(e) {
  const r = seekEl.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  return f * getDur();
}
function showTip(t, e) {
  const tip = $('#seekTip');
  const r = seekEl.getBoundingClientRect();
  tip.hidden = false;
  tip.textContent = fmtClock(t);
  tip.style.left = Math.min(r.width - 30, Math.max(30, e.clientX - r.left)) + 'px';
}
seekEl.addEventListener('pointerdown', (e) => {
  seekState.dragging = true;
  seekEl.classList.add('drag');
  seekEl.setPointerCapture(e.pointerId);
  seekState.t = seekFromEvent(e);
  paintSeek(seekState.t);
  showTip(seekState.t, e);
});
seekEl.addEventListener('pointermove', (e) => {
  if (!seekState.dragging) return;
  seekState.t = seekFromEvent(e);
  paintSeek(seekState.t);
  showTip(seekState.t, e);
});
const endDrag = (commit) => (e) => {
  if (!seekState.dragging) return;
  seekState.dragging = false;
  seekEl.classList.remove('drag');
  $('#seekTip').hidden = true;
  if (commit) seekTo(seekState.t);
};
seekEl.addEventListener('pointerup', endDrag(true));
seekEl.addEventListener('pointercancel', endDrag(false));

function seekTo(t) {
  const dur = getDur();
  V.currentTime = Math.max(0, Math.min(dur ? dur - 0.5 : t, t));
  if (V.paused === false) setSpinner(P.mode === 'hls' ? 'Seeking…' : '');
  paintSeek(V.currentTime);
}
const skip = (d) => { seekTo((seekState.dragging ? seekState.t : V.currentTime) + d); showUi(); };
const togglePlay = () => { if (V.paused) V.play().catch(() => {}); else V.pause(); };

// ---- controls visibility
function showUi() {
  ui.classList.remove('hide');
  playerEl.classList.remove('idle');
  scheduleHide();
}
function scheduleHide() {
  clearTimeout(P.uiTimer);
  P.uiTimer = setTimeout(() => {
    if (V.paused || !$('#menu').hidden || seekState.dragging) return;
    ui.classList.add('hide');
    playerEl.classList.add('idle');
  }, 4500);
}
playerEl.addEventListener('pointermove', () => { if (ui.classList.contains('hide')) showUi(); else scheduleHide(); });
// A tap on the picture toggles the controls; a tap on a control is handled by the control.
$('#video').addEventListener('click', () => {
  if (!$('#menu').hidden) { closeMenu(); return; }
  if (ui.classList.contains('hide')) showUi(); else { ui.classList.add('hide'); }
});
ui.addEventListener('click', (e) => {
  if (e.target === ui || e.target.classList.contains('p-mid')) {
    if (!$('#menu').hidden) closeMenu(); else ui.classList.add('hide');
  } else showUi();
});

$('#pPlay').addEventListener('click', togglePlay);
$('#pRew').addEventListener('click', () => skip(-10));
$('#pFwd').addEventListener('click', () => skip(10));
$('#pBack').addEventListener('click', () => closePlayer({}));
$('#pFull').addEventListener('click', toggleFullscreen);
$('#pPrev').addEventListener('click', () => P.item.prev && goTo(P.item.prev.id));
$('#pNext').addEventListener('click', () => P.item.next && goTo(P.item.next.id));

function goTo(id) {
  saveProgress();
  location.replace('#/play/' + id);
}

// ---- menus
function closeMenu() { $('#menu').hidden = true; scheduleHide(); }
function openMenu(title, options, onPick) {
  const menu = $('#menu');
  menu.innerHTML = `<h3>${esc(title)}</h3>` + options.map((o, i) => `
    <button class="opt ${o.on ? 'on' : ''}" data-i="${i}"><span class="c">${o.on ? ICON_HTML.check : ''}</span><span class="l">${esc(o.label)}</span>${o.note ? `<span class="n">${esc(o.note)}</span>` : ''}</button>`).join('');
  menu.hidden = false;
  menu.onclick = (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    closeMenu();
    onPick(options[Number(b.dataset.i)], Number(b.dataset.i));
  };
  showUi();
}
$('#pQuality').addEventListener('click', () => {
  if (!$('#menu').hidden) return closeMenu();
  const item = P.item;
  const pref = chosenQualityPref();
  const opts = [{ id: 'auto', label: 'Auto', note: 'Original file if possible' }];
  if (canDirect(item, item.audioDefault)) opts.push({ id: 'direct', label: 'Original file', note: 'No transcoding' });
  item.qualities.forEach((q) => opts.push({ id: q.id, label: q.label, note: q.note }));
  opts.forEach((o) => { o.on = o.id === pref; });
  openMenu('Quality', opts, (o) => {
    store.set('ct.quality', o.id);
    P.noDirect = false;
    planPlayback();
    reloadHere();
  });
});
$('#pAudio').addEventListener('click', () => {
  if (!$('#menu').hidden) return closeMenu();
  const item = P.item;
  const opts = item.audio.map((a) => ({
    n: a.index,
    label: [a.lang !== 'und' ? a.lang.toUpperCase() : `Track ${a.index + 1}`, a.title].filter(Boolean).join(' · '),
    note: `${a.codec.toUpperCase()} ${a.channels > 2 ? (a.channels === 6 ? '5.1' : a.channels + 'ch') : ''}`.trim(),
    on: a.index === P.audio,
  }));
  openMenu('Audio', opts, (o) => {
    if (o.n === P.audio) return;
    P.audio = o.n;
    planPlayback();
    reloadHere();
  });
});
$('#pSubs').addEventListener('click', () => {
  if (!$('#menu').hidden) return closeMenu();
  const opts = [{ label: 'Off', on: P.sub < 0, n: -1 }, ...P.item.subs.map((s, i) => ({ label: s.name, on: P.sub === i, n: i }))];
  openMenu('Subtitles', opts, (o) => selectSub(o.n));
});
$('#pSpeed').addEventListener('click', () => {
  if (!$('#menu').hidden) return closeMenu();
  const opts = [0.75, 1, 1.25, 1.5, 2].map((r) => ({ label: `${r}×`, on: V.playbackRate === r, r }));
  openMenu('Speed', opts, (o) => { V.playbackRate = o.r; $('#pSpeed span').textContent = `${o.r}×`; });
});

// ---- up next / end of episode
function onEnded() {
  saveProgress();
  const next = P.item && P.item.next;
  if (!next) { closePlayer({}); return; }
  const box = $('#upnext');
  $('#upName').textContent = [next.label, next.title].filter(Boolean).join(' · ');
  let n = 10;
  $('#upCount').textContent = n;
  box.hidden = false;
  showUi();
  clearInterval(P.upTimer);
  P.upTimer = setInterval(() => {
    n--;
    $('#upCount').textContent = n;
    if (n <= 0) { hideUpNext(); goTo(next.id); }
  }, 1000);
}
function hideUpNext() { clearInterval(P.upTimer); $('#upnext').hidden = true; }
$('#upPlay').addEventListener('click', () => { hideUpNext(); goTo(P.item.next.id); });
$('#upCancel').addEventListener('click', hideUpNext);

// ---- lifecycle
function teardown() {
  saveProgress();
  clearTimeout(P.uiTimer);
  hideUpNext();
  closeMenu();
  destroyHls();
  V.pause();
  V.removeAttribute('src');
  V.querySelectorAll('track').forEach((t) => t.remove());
  V.load();
  P.item = null;
  $('#pSubs').classList.remove('on');
}

function closePlayer({ navigate = true } = {}) {
  const showId = P.item && P.item.showId;
  P.token++;
  teardown();
  playerEl.hidden = true;
  document.body.classList.remove('playing');
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { /* ignore */ } }
  homeData = homeData && null;
  if (!navigate) return;
  if (cameFromApp) history.back();
  else location.replace(showId ? `#/show/${showId}` : '#/');
}

function setMediaSession(item) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.showName });
    navigator.mediaSession.setActionHandler('play', () => V.play());
    navigator.mediaSession.setActionHandler('pause', () => V.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
    navigator.mediaSession.setActionHandler('nexttrack', item.next ? () => goTo(item.next.id) : null);
    navigator.mediaSession.setActionHandler('previoustrack', item.prev ? () => goTo(item.prev.id) : null);
  } catch { /* unsupported action */ }
}

document.addEventListener('keydown', (e) => {
  if (playerEl.hidden || e.target.tagName === 'INPUT') return;
  const k = e.key;
  if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); showUi(); }
  else if (k === 'ArrowLeft') skip(-10);
  else if (k === 'ArrowRight') skip(10);
  else if (k === 'f') toggleFullscreen();
  else if (k === 'm') V.muted = !V.muted;
  else if (k === 'n' && P.item && P.item.next) goTo(P.item.next.id);
  else if (k === 'Escape') { if (!$('#menu').hidden) closeMenu(); else if (!document.fullscreenElement) closePlayer({}); }
});

syncPlayIcon();
route();
