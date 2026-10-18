'use strict';
/* Small ffmpeg helpers: episode thumbnails and subtitle extraction (cached on disk). */
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('./config');
const { Semaphore, ensureDir } = require('./util');
const probe = require('./probe');

const THUMB_DIR = ensureDir(path.join(config.DATA_DIR, 'cache', 'thumbs'));
const SUB_DIR = ensureDir(path.join(config.DATA_DIR, 'cache', 'subs'));
const gate = new Semaphore(2);
const pending = new Map();

function ffmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(config.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer', ...opts },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const fileOk = async (p) => { try { return (await fsp.stat(p)).size > 0; } catch { return false; } };

function once(key, fn) {
  if (!pending.has(key)) pending.set(key, gate.run(fn).finally(() => pending.delete(key)));
  return pending.get(key);
}

async function thumbnail(item) {
  const sig = `${item.id}-${Math.floor(item.mtimeMs)}`;
  const out = path.join(THUMB_DIR, `${sig}.jpg`);
  if (await fileOk(out)) return out;
  return once(out, async () => {
    let dur = 0;
    try { dur = (await probe.probe(item)).duration; } catch { /* try anyway */ }
    const spots = [dur ? Math.min(Math.max(dur * 0.12, 5), 420) : 120, 5, 0];
    for (const t of spots) {
      try {
        await ffmpeg(['-ss', String(t), '-i', item.abs, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', '-y', out]);
        if (await fileOk(out)) return out;
      } catch { /* next spot */ }
    }
    return null;
  });
}

// ---- subtitles -------------------------------------------------------------------------------

const EXT_SUB = ['.srt', '.vtt', '.ass', '.ssa'];

// External subtitle files sitting next to the video: "Name.srt", "Name.en.srt", "Name.English.srt"
async function externalSubs(item) {
  const dir = path.dirname(item.abs);
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const base = path.basename(item.abs, item.ext).toLowerCase();
  const out = [];
  for (const n of names.sort()) {
    const ext = path.extname(n).toLowerCase();
    if (!EXT_SUB.includes(ext)) continue;
    const stem = n.slice(0, n.length - ext.length).toLowerCase();
    if (stem !== base && !stem.startsWith(base + '.')) continue;
    const tag = stem.slice(base.length).replace(/^\./, '');
    out.push({ kind: 'file', file: path.join(dir, n), lang: tag.split('.')[0] || 'und', title: tag });
  }
  return out;
}

// Deterministic list used both for the item API and for serving /subs/:id/:n.vtt
async function subtitleList(item, info) {
  const list = [];
  for (const s of info.subs) {
    if (!s.text) continue;
    list.push({ kind: 'stream', index: s.index, lang: s.lang, title: s.title, forced: s.forced });
  }
  list.push(...(await externalSubs(item)));
  return list;
}

async function subtitleVtt(item, entry, n) {
  const out = path.join(SUB_DIR, `${item.id}-${Math.floor(item.mtimeMs)}-${n}.vtt`);
  if (await fileOk(out)) return out;
  return once(out, async () => {
    const input = entry.kind === 'file' ? ['-i', entry.file] : ['-i', item.abs, '-map', `0:s:${entry.index}`];
    await ffmpeg([...input, '-f', 'webvtt', '-y', out]);
    return (await fileOk(out)) ? out : null;
  });
}

module.exports = { thumbnail, subtitleList, subtitleVtt };
