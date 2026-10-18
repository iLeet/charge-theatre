'use strict';
const { execFile } = require('child_process');
const path = require('path');
const config = require('./config');
const { persisted, Semaphore } = require('./util');

const store = persisted(path.join(config.DATA_DIR, 'probe-cache.json'), {});
const cache = store.data;
const inflight = new Map();
const gate = new Semaphore(2);

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const sigOf = (item) => `${item.size}-${Math.floor(item.mtimeMs)}`;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(config.FFPROBE, args, { maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

function parse(json) {
  const streams = json.streams || [];
  const fmt = json.format || {};
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({
    index: i,
    codec: s.codec_name,
    channels: s.channels || 2,
    lang: (s.tags && s.tags.language) || 'und',
    title: (s.tags && s.tags.title) || '',
    default: !!(s.disposition && s.disposition.default),
  }));
  const subs = streams.filter((s) => s.codec_type === 'subtitle').map((s, i) => ({
    index: i,
    codec: s.codec_name,
    text: TEXT_SUBS.has(s.codec_name),
    lang: (s.tags && s.tags.language) || 'und',
    title: (s.tags && s.tags.title) || '',
    forced: !!(s.disposition && s.disposition.forced),
  }));
  let fps = 0;
  if (v && v.avg_frame_rate && v.avg_frame_rate.includes('/')) {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    if (d) fps = n / d;
  }
  const bitDepth = v ? parseInt(v.bits_per_raw_sample, 10) || (/10/.test(v.pix_fmt || '') ? 10 : 8) : 8;
  const duration = parseFloat(fmt.duration) || (v && parseFloat(v.duration)) || 0;
  return {
    duration,
    bitrate: parseInt(fmt.bit_rate, 10) || 0,
    video: v ? {
      codec: v.codec_name,
      profile: v.profile || '',
      level: v.level || 0,
      width: v.width,
      height: v.height,
      fps,
      pixFmt: v.pix_fmt || '',
      bitDepth,
      hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer),
    } : null,
    audio,
    subs,
  };
}

async function probe(item) {
  const sig = sigOf(item);
  const hit = cache[item.id];
  if (hit && hit.sig === sig) return hit.info;
  if (inflight.has(item.id)) return inflight.get(item.id);
  const p = gate.run(async () => {
    const out = await run(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', item.abs]);
    const info = parse(JSON.parse(out));
    cache[item.id] = { sig, info };
    store.save();
    return info;
  }).finally(() => inflight.delete(item.id));
  inflight.set(item.id, p);
  return p;
}

// Cached info without touching disk (undefined if not probed yet).
function peek(item) {
  const hit = cache[item.id];
  return hit && hit.sig === sigOf(item) ? hit.info : undefined;
}

function forget(validIds) {
  let changed = false;
  for (const id of Object.keys(cache)) {
    if (!validIds.has(id)) { delete cache[id]; changed = true; }
  }
  if (changed) store.save();
}

module.exports = { probe, peek, forget, flush: store.flush };
