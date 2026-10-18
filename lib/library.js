'use strict';
const fsp = require('fs/promises');
const path = require('path');
const config = require('./config');
const { sha, naturalCompare } = require('./util');
const probe = require('./probe');

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mkv', '.mov', '.webm', '.avi', '.ts', '.m2ts', '.wmv', '.flv', '.mpg', '.mpeg']);
const SKIP_DIRS = new Set(['@eaDir', '#recycle', 'lost+found', '$recycle.bin', 'extras', 'featurettes', 'samples', 'sample', 'trailers']);
const POSTER_NAMES = ['poster', 'folder', 'cover', 'show', 'thumb'];
const POSTER_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

// Everything after the first of these in a release name is noise.
const RELEASE_TAGS = /[\s._\-[(](2160p|1080p|1080i|720p|576p|480p|4k|uhd|web[ ._-]?dl|web[ ._-]?rip|webrip|blu[ ._-]?ray|bdrip|brrip|dvdrip|hdtv|hdrip|x26[45]|h[ ._]?26[45]|hevc|avc|xvid|aac|ac3|eac3|dd[p+]?[ ._]?[257]|atmos|dts|flac|10bit|hdr10?|dv|remux|proper|repack|amzn|nf|dsnp|hmax|atvp|hulu|max)([\s._\-\])]|$).*$/i;

function tidy(s) {
  if (!/\s/.test(s)) s = s.replace(/[._]+/g, ' ');
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–._]+|[\s\-–._]+$/g, '');
}

function cleanTitle(name) {
  return tidy(name.replace(RELEASE_TAGS, ''));
}

function parseEpisode(base, dirParts) {
  let m = base.match(/[sS](\d{1,2})[ ._-]*[eE](\d{1,3})(?:[ ._-]*[eE-]\d{1,3})?/);
  if (m) return { season: +m[1], episode: +m[2], rest: base.slice(m.index + m[0].length) };
  m = base.match(/season[ ._-]*(\d+)[ ._-]*episode[ ._-]*(\d+)/i);
  if (m) return { season: +m[1], episode: +m[2], rest: base.slice(m.index + m[0].length) };
  m = base.match(/(?:^|[^\d])(\d{1,2})x(\d{2,3})(?![\dp])/);
  if (m) return { season: +m[1], episode: +m[2], rest: base.slice(m.index + m[0].length) };

  let season = null;
  for (const d of dirParts) {
    const sm = d.match(/^(?:season|series|s)[ ._-]*(\d{1,2})$/i);
    if (sm) season = +sm[1];
    else if (/^specials?$/i.test(d)) season = 0;
  }
  // "Show - 05 - Title", "[Group] Show - 05 [1080p]", "E05", "Ep 05"
  m = base.match(/(?:\s-\s|[ ._]E(?:p|pisode)?[ ._]?)(\d{1,3})(?:v\d)?(?=[\s._\-[(]|$)/i);
  if (m) return { season, episode: +m[1], rest: base.slice(m.index + m[0].length) };
  return { season, episode: null, rest: base };
}

async function walk(root) {
  const files = [];
  async function rec(dir, rel, depth) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try { const st = await fsp.stat(abs); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
      }
      if (isDir) {
        if (depth < 6) await rec(abs, r, depth + 1);
      } else if (isFile && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
        try {
          const st = await fsp.stat(abs);
          if (/(^|[\W_])sample([\W_]|$)/i.test(e.name) && st.size < 150e6) continue;
          files.push({ abs, rel: r, size: st.size, mtimeMs: st.mtimeMs });
        } catch { /* vanished */ }
      }
    }
  }
  await rec(root, '', 0);
  return files;
}

async function findPoster(dir) {
  try {
    const names = await fsp.readdir(dir);
    for (const base of POSTER_NAMES) {
      for (const ext of POSTER_EXT) {
        const hit = names.find((n) => n.toLowerCase() === base + ext);
        if (hit) return path.join(dir, hit);
      }
    }
  } catch { /* ignore */ }
  return null;
}

const sortKey = (name) => name.replace(/^(the|a|an)\s+/i, '');

async function build() {
  const files = await walk(config.MEDIA_DIR);
  const showsByKey = new Map();
  const items = new Map();

  for (const f of files) {
    const parts = f.rel.split('/');
    const filename = parts[parts.length - 1];
    const base = filename.slice(0, filename.length - path.extname(filename).length);
    const isLoose = parts.length === 1;
    const showKey = isLoose ? f.rel : parts[0];
    const showId = sha('show:' + showKey);

    let show = showsByKey.get(showKey);
    if (!show) {
      show = {
        id: showId,
        name: cleanTitle(isLoose ? base : parts[0]) || (isLoose ? base : parts[0]),
        dir: isLoose ? null : path.join(config.MEDIA_DIR, parts[0]),
        itemIds: [],
        newest: 0,
        poster: null,
      };
      showsByKey.set(showKey, show);
    }

    const dirParts = parts.slice(1, -1);
    const ep = isLoose ? { season: null, episode: null, rest: base } : parseEpisode(base, dirParts);
    const item = {
      id: sha('item:' + f.rel),
      showId,
      rel: f.rel,
      abs: f.abs,
      size: f.size,
      mtimeMs: f.mtimeMs,
      ext: path.extname(filename).toLowerCase(),
      season: ep.season,
      episode: ep.episode,
      hasEp: ep.episode != null,
      fileTitle: cleanTitle(ep.rest),
      base,
    };
    items.set(item.id, item);
    show.itemIds.push(item.id);
    show.newest = Math.max(show.newest, f.mtimeMs);
  }

  const shows = [...showsByKey.values()];
  for (const show of shows) {
    const list = show.itemIds.map((id) => items.get(id));
    list.sort((a, b) =>
      ((a.season ?? 1) - (b.season ?? 1)) ||
      ((a.episode ?? 1e6) - (b.episode ?? 1e6)) ||
      naturalCompare(a.rel, b.rel));
    // Fill in numbering/titles for files that had no S01E02 marker.
    let n = 0;
    for (const it of list) {
      it.season = it.season ?? 1;
      n++;
      if (it.episode == null) it.episode = n;
      it.label = list.length === 1 && !it.hasEp ? '' : `S${String(it.season).padStart(2, '0')}E${String(it.episode).padStart(2, '0')}`;
      it.title = it.fileTitle && it.fileTitle.toLowerCase() !== show.name.toLowerCase() ? it.fileTitle : `Episode ${it.episode}`;
      if (list.length === 1 && !it.hasEp) it.title = show.name;
    }
    show.itemIds = list.map((i) => i.id);
    show.kind = list.length === 1 && !list[0].label ? 'movie' : 'show';
    if (show.dir) show.poster = await findPoster(show.dir);
  }
  shows.sort((a, b) => naturalCompare(sortKey(a.name), sortKey(b.name)));

  return { at: Date.now(), shows, showMap: new Map(shows.map((s) => [s.id, s])), items };
}

let current = null;
let building = null;
const MAX_AGE_MS = 20e3;

async function refresh() {
  if (!building) {
    building = build().then((lib) => {
      current = lib;
      probe.forget(new Set(lib.items.keys()));
      queueBackgroundProbe(lib);
      return lib;
    }).finally(() => { building = null; });
  }
  return building;
}

async function get({ force = false } = {}) {
  if (!current) return refresh();
  if (force || Date.now() - current.at > MAX_AGE_MS) {
    const p = refresh();
    if (force) return p;
  }
  return current;
}

// Fill in durations/codecs slowly in the background so lists can show runtimes.
let bgRunning = false;
async function queueBackgroundProbe(lib) {
  if (bgRunning) return;
  bgRunning = true;
  try {
    for (const item of lib.items.values()) {
      if (probe.peek(item)) continue;
      try { await probe.probe(item); } catch { /* unreadable file; ignore */ }
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally { bgRunning = false; }
}

const showItems = (lib, show) => show.itemIds.map((id) => lib.items.get(id));

module.exports = { get, refresh, showItems };
