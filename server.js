'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const config = require('./lib/config');
const auth = require('./lib/auth');
const library = require('./lib/library');
const probe = require('./lib/probe');
const stateStore = require('./lib/state');
const transcoder = require('./lib/transcoder');
const tools = require('./lib/tools');
const { ensureDir } = require('./lib/util');

const PUBLIC_DIR = path.join(__dirname, 'public');
ensureDir(config.MEDIA_DIR);
ensureDir(config.DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};

// ---- response helpers --------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(body);
}
const sendJson = (res, data, status = 200) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
const notFound = (res) => sendJson(res, { error: 'not found' }, 404);

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readParams(req) {
  const raw = await readBody(req);
  if ((req.headers['content-type'] || '').includes('json')) {
    try { return JSON.parse(raw || '{}'); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function serveFile(req, res, file, { mime, cache = 'no-cache' } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return notFound(res); }
  if (!st.isFile()) return notFound(res);
  const type = mime || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }

  let start = 0;
  let end = st.size - 1;
  let status = 200;
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    if (range[1] === '' && range[2] === '') { /* malformed: serve all */ }
    else {
      if (range[1] === '') { start = Math.max(0, st.size - parseInt(range[2], 10)); }
      else {
        start = parseInt(range[1], 10);
        if (range[2] !== '') end = Math.min(end, parseInt(range[2], 10));
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      status = 206;
      base['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
  }
  base['Content-Length'] = end - start + 1;
  res.writeHead(status, base);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function servePublic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);
  const immutable = rel.startsWith('/vendor/');
  serveFile(req, res, file, { cache: immutable ? 'public, max-age=86400' : 'no-cache' });
}

// ---- playback description ----------------------------------------------------------------------

function videoCodecString(v) {
  switch (v.codec) {
    case 'h264': {
      if (v.bitDepth > 8) return null;
      const idc = { Baseline: 66, 'Constrained Baseline': 66, Main: 77, Extended: 88, High: 100 }[v.profile] || 100;
      const lvl = (v.level || 41).toString(16).padStart(2, '0');
      return `avc1.${idc.toString(16)}00${lvl}`;
    }
    case 'hevc': return v.bitDepth > 8 ? `hvc1.2.4.L${v.level || 120}.B0` : `hvc1.1.6.L${v.level || 120}.B0`;
    case 'vp9': return 'vp09.00.10.08';
    case 'vp8': return 'vp8';
    case 'av1': return v.bitDepth > 8 ? 'av01.0.08M.10' : 'av01.0.08M.08';
    default: return null;
  }
}
const AUDIO_CODECS = { aac: 'mp4a.40.2', mp3: 'mp3', ac3: 'ac-3', eac3: 'ec-3', opus: 'opus', vorbis: 'vorbis', flac: 'flac' };
const CONTAINER_MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };

// The MIME + codecs string the browser is asked about (canPlayType) to decide on direct play.
function directMime(item, info, audioIdx) {
  const container = CONTAINER_MIME[item.ext];
  if (!container || !info.video) return null;
  const v = videoCodecString(info.video);
  if (!v) return null;
  const codecs = [v];
  if (info.audio.length) {
    const a = AUDIO_CODECS[info.audio[audioIdx].codec];
    if (!a) return null;
    codecs.push(a);
  }
  return `${container}; codecs="${codecs.join(', ')}"`;
}

function qualityOptions(info) {
  const h = info.video ? info.video.height : 0;
  const out = [{ id: 'source', label: h ? `Source (${h}p)` : 'Source', note: 'Best quality' }];
  const notes = { 1080: '~9 Mbps', 720: '~4.5 Mbps', 480: '~1.8 Mbps', 360: '~0.9 Mbps' };
  for (const q of [1080, 720, 480, 360]) {
    if (!h || q < h) out.push({ id: String(q), label: `${q}p`, note: notes[q] });
  }
  return out;
}

const thumbUrl = (id) => `/thumb/${id}`;
const durationOf = (item) => { const i = probe.peek(item); return i ? i.duration : 0; };

function itemCard(lib, item) {
  const show = lib.showMap.get(item.showId);
  const p = stateStore.state.progress[item.id];
  return {
    id: item.id,
    showId: item.showId,
    showName: show.name,
    label: item.label,
    title: item.title,
    thumb: thumbUrl(item.id),
    duration: durationOf(item) || (p && p.dur) || 0,
    pos: p && !p.done ? p.pos : 0,
    done: !!(p && p.done),
  };
}

function showPoster(lib, show) {
  return show.poster ? `/poster/${show.id}` : thumbUrl(show.itemIds[0]);
}

function neighbours(lib, item) {
  const show = lib.showMap.get(item.showId);
  const i = show.itemIds.indexOf(item.id);
  const at = (n) => (n >= 0 && n < show.itemIds.length ? lib.items.get(show.itemIds[n]) : null);
  return { prev: at(i - 1), next: at(i + 1) };
}

// The episode a "Resume"/"Play" button on a show should open.
function resumeTarget(lib, show) {
  const { progress } = stateStore.state;
  let latest = null;
  for (const id of show.itemIds) {
    const p = progress[id];
    if (p && (!latest || p.at > latest.p.at)) latest = { id, p };
  }
  if (!latest) return { id: show.itemIds[0], started: false };
  if (!latest.p.done) return { id: latest.id, started: true };
  const { next } = neighbours(lib, lib.items.get(latest.id));
  return next ? { id: next.id, started: true } : { id: latest.id, started: true };
}

function continueList(lib) {
  const { progress } = stateStore.state;
  const latestByShow = new Map();
  for (const [id, p] of Object.entries(progress)) {
    const it = lib.items.get(id);
    if (!it) continue;
    const cur = latestByShow.get(it.showId);
    if (!cur || p.at > cur.p.at) latestByShow.set(it.showId, { it, p });
  }
  const out = [];
  for (const { it, p } of latestByShow.values()) {
    let target = it;
    let upNext = false;
    if (p.done) {
      const { next } = neighbours(lib, it);
      if (!next) continue;
      target = next;
      upNext = true;
    }
    out.push({ ...itemCard(lib, target), upNext, at: p.at });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}

// ---- routes ------------------------------------------------------------------------------------

const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });

route('GET', /^\/healthz$/, async (req, res) => send(res, 200, 'ok'));

route('GET', /^\/api\/library$/, async (req, res, m, url) => {
  const lib = await library.get({ force: url.searchParams.has('rescan') });
  const { pinned } = stateStore.state;
  const shows = lib.shows.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    count: s.itemIds.length,
    playId: s.kind === 'movie' ? s.itemIds[0] : null,
    poster: showPoster(lib, s),
    newest: s.newest,
    pinned: pinned.includes(s.id),
  }));
  sendJson(res, {
    name: config.SITE_NAME,
    shows,
    pinned: pinned.filter((id) => lib.showMap.has(id)),
    continue: continueList(lib),
    recent: [...lib.shows].sort((a, b) => b.newest - a.newest).slice(0, 12).map((s) => s.id),
  });
});

route('GET', /^\/api\/show\/(\w+)$/, async (req, res, m) => {
  const lib = await library.get();
  const show = lib.showMap.get(m[1]);
  if (!show) return notFound(res);
  const seasons = new Map();
  for (const item of library.showItems(lib, show)) {
    if (!seasons.has(item.season)) seasons.set(item.season, []);
    seasons.get(item.season).push(itemCard(lib, item));
  }
  const target = resumeTarget(lib, show);
  const first = lib.items.get(show.itemIds[0]);
  sendJson(res, {
    id: show.id,
    name: show.name,
    kind: show.kind,
    pinned: stateStore.state.pinned.includes(show.id),
    poster: showPoster(lib, show),
    backdrop: thumbUrl(first.id),
    count: show.itemIds.length,
    seasons: [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([season, episodes]) => ({
      season, name: season === 0 ? 'Specials' : `Season ${season}`, episodes,
    })),
    resume: { ...itemCard(lib, lib.items.get(target.id)), started: target.started },
  });
});

route('GET', /^\/api\/item\/(\w+)$/, async (req, res, m) => {
  const lib = await library.get();
  const item = lib.items.get(m[1]);
  if (!item) return notFound(res);
  let info;
  try { info = await probe.probe(item); } catch (e) { return sendJson(res, { error: 'Could not read this file: ' + e.message }, 500); }
  const show = lib.showMap.get(item.showId);
  const audioDefault = Math.max(0, info.audio.findIndex((a) => a.default));
  const subs = await tools.subtitleList(item, info);
  const { prev, next } = neighbours(lib, item);
  const p = stateStore.state.progress[item.id];
  sendJson(res, {
    id: item.id,
    showId: show.id,
    showName: show.name,
    label: item.label,
    title: item.title,
    kind: show.kind,
    duration: info.duration,
    video: info.video,
    audio: info.audio,
    audioDefault,
    subs: subs.map((s, n) => ({ n, lang: s.lang, title: s.title, forced: !!s.forced, url: `/subs/${item.id}/${n}.vtt` })),
    directMime: directMime(item, info, audioDefault),
    directUrl: `/direct/${item.id}`,
    ext: item.ext,
    qualities: qualityOptions(info),
    resume: p && !p.done ? p.pos : 0,
    prev: prev && { id: prev.id, label: prev.label, title: prev.title },
    next: next && { id: next.id, label: next.label, title: next.title },
  });
});

route('POST', /^\/api\/progress$/, async (req, res) => {
  const b = await readParams(req);
  const lib = await library.get();
  if (!lib.items.has(b.id)) return notFound(res);
  stateStore.setProgress(b.id, Number(b.pos), Number(b.dur));
  sendJson(res, { ok: true });
});

route('POST', /^\/api\/watched$/, async (req, res) => {
  const b = await readParams(req);
  const lib = await library.get();
  const item = lib.items.get(b.id);
  if (!item) return notFound(res);
  stateStore.setWatched(item.id, !!b.watched, durationOf(item));
  sendJson(res, { ok: true });
});

route('POST', /^\/api\/pin$/, async (req, res) => {
  const b = await readParams(req);
  const lib = await library.get();
  if (!lib.showMap.has(b.showId)) return notFound(res);
  stateStore.setPinned(b.showId, !!b.on);
  sendJson(res, { ok: true });
});

route('GET', /^\/direct\/(\w+)$/, async (req, res, m) => {
  const lib = await library.get();
  const item = lib.items.get(m[1]);
  if (!item) return notFound(res);
  serveFile(req, res, item.abs, { mime: MIME[item.ext] || 'video/mp4', cache: 'private, max-age=0' });
});

route('GET', /^\/hls\/(\w+)\/(\w+)\/(\d+)\/(index\.m3u8|seg_(\d+)\.ts)$/, async (req, res, m) => {
  const lib = await library.get();
  const item = lib.items.get(m[1]);
  const q = m[2];
  const a = parseInt(m[3], 10);
  if (!item || !transcoder.QUALITIES[q]) return notFound(res);
  const info = await probe.probe(item);
  if (!info.video || !info.duration) return sendJson(res, { error: 'not a playable video' }, 422);
  if (info.audio.length && a >= info.audio.length) return notFound(res);
  const st = transcoder.getStream(item, info, q, a);

  if (m[4] === 'index.m3u8') {
    return send(res, 200, transcoder.playlist(info), {
      'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store',
    });
  }
  const idx = parseInt(m[5], 10);
  if (idx >= transcoder.segCount(info)) return notFound(res);
  let gone = false;
  res.on('close', () => { gone = true; });
  let file;
  try { file = await transcoder.getSegment(st, idx, () => gone); } catch (e) {
    console.error(e.message);
    return sendJson(res, { error: 'transcode failed' }, 500);
  }
  if (!file) return; // client left
  serveFile(req, res, file, { mime: 'video/mp2t', cache: 'private, max-age=3600' });
});

route('GET', /^\/thumb\/(\w+)$/, async (req, res, m) => {
  const lib = await library.get();
  const item = lib.items.get(m[1]);
  if (!item) return notFound(res);
  const file = await tools.thumbnail(item);
  if (!file) return notFound(res);
  serveFile(req, res, file, { mime: 'image/jpeg', cache: 'private, max-age=86400' });
});

route('GET', /^\/poster\/(\w+)$/, async (req, res, m) => {
  const lib = await library.get();
  const show = lib.showMap.get(m[1]);
  if (!show || !show.poster) return notFound(res);
  serveFile(req, res, show.poster, { cache: 'private, max-age=3600' });
});

route('GET', /^\/subs\/(\w+)\/(\d+)\.vtt$/, async (req, res, m) => {
  const lib = await library.get();
  const item = lib.items.get(m[1]);
  if (!item) return notFound(res);
  const info = await probe.probe(item);
  const list = await tools.subtitleList(item, info);
  const n = parseInt(m[2], 10);
  if (!list[n]) return notFound(res);
  let file;
  try { file = await tools.subtitleVtt(item, list[n], n); } catch { file = null; }
  if (!file) return notFound(res);
  serveFile(req, res, file, { mime: 'text/vtt; charset=utf-8', cache: 'private, max-age=3600' });
});

// ---- auth + dispatch ---------------------------------------------------------------------------

async function handleLogin(req, res, url) {
  const ip = auth.clientIp(req);
  if (req.method === 'GET') return serveFile(req, res, path.join(PUBLIC_DIR, 'login.html'));
  if (req.method !== 'POST') return send(res, 405, 'method not allowed');
  if (auth.rateLimited(ip)) return send(res, 302, '', { Location: '/login?e=2' });
  const body = await readParams(req);
  if (auth.checkPassword(body.password || '')) {
    auth.clearFailures(ip);
    const maxAge = config.SESSION_DAYS * 86400;
    return send(res, 303, '', { Location: '/', 'Set-Cookie': auth.sessionCookie(req, auth.makeToken(), maxAge) });
  }
  auth.recordFailure(ip);
  return send(res, 302, '', { Location: '/login?e=1' });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;

  if (pathname === '/login') return handleLogin(req, res, url);
  if (pathname === '/healthz') return send(res, 200, 'ok');
  if (pathname === '/logout') {
    return send(res, 303, '', { Location: '/login', 'Set-Cookie': auth.sessionCookie(req, '', 0) });
  }

  if (!auth.isAuthed(req)) {
    if (pathname.startsWith('/api/')) return sendJson(res, { error: 'unauthorized' }, 401);
    return send(res, 302, '', { Location: '/login' });
  }

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) return r.fn(req, res, m, url);
  }
  if (method === 'GET') return servePublic(req, res, pathname);
  return notFound(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(`${req.method} ${req.url}:`, e.message);
    if (!res.headersSent) sendJson(res, { error: 'server error' }, 500);
    else res.destroy();
  });
});
server.keepAliveTimeout = 65e3;

server.listen(config.PORT, config.HOST, () => {
  console.log(`\n  ${config.SITE_NAME} is running`);
  console.log(`  Media folder : ${config.MEDIA_DIR}`);
  console.log(`  Data folder  : ${config.DATA_DIR}`);
  console.log(`  Encoder      : ${config.ENCODER}`);
  const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
  console.log(`  Open         : http://localhost:${config.PORT}` + nets.map((n) => `  |  http://${n.address}:${config.PORT}`).join(''));
  if (auth.passwordGenerated) {
    console.log(`  Password     : ${auth.password()}   (generated - set PASSWORD in .env to choose your own)`);
  }
  try { execFileSync(config.FFPROBE, ['-version'], { stdio: 'ignore' }); } catch {
    console.log('\n  !! ffmpeg/ffprobe not found - install ffmpeg (or use the Docker image). Nothing will play without it.');
  }
  console.log('');
  library.get().then((lib) => console.log(`  Library: ${lib.shows.length} titles, ${lib.items.size} files`)).catch(() => {});
});

function quit() {
  stateStore.flush();
  probe.flush();
  transcoder.shutdown();
  process.exit(0);
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
