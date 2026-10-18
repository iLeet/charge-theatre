'use strict';
/*
 * On-demand HLS transcoding.
 *
 * The playlist is generated up front from the file's duration (fixed 6s segments), so the player
 * sees the whole timeline and can seek anywhere. Segments are produced lazily by ffmpeg:
 *   - a request for a segment ffmpeg hasn't made yet starts (or restarts) ffmpeg at that point
 *   - ffmpeg is paused (SIGSTOP) once it is far enough ahead of the viewer, resumed as they catch up
 *   - idle jobs are killed, old cache is deleted
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { sleep, rmrf, ensureDir } = require('./util');

const SEG = config.SEGMENT_SECONDS;
const CACHE_DIR = path.join(config.DATA_DIR, 'cache', 'hls');
const PAUSE_AHEAD = 10;      // segments of lead before ffmpeg is paused
const RESUME_AHEAD = 5;      // ...and resumed when the lead shrinks to this
const JOIN_SLACK = 3;        // request this far past the job's output -> still wait for it
const IDLE_KILL_MS = 90e3;   // no requests for this long -> stop ffmpeg
const CACHE_TTL_MS = 30 * 60e3;

rmrf(CACHE_DIR);
ensureDir(CACHE_DIR);

const QUALITIES = {
  source: { height: null, crf: 18, maxrate: 30000, label: 'Source quality' },
  1080: { height: 1080, crf: 20, maxrate: 9000, label: '1080p' },
  720: { height: 720, crf: 22, maxrate: 4500, label: '720p' },
  480: { height: 480, crf: 24, maxrate: 1800, label: '480p' },
  360: { height: 360, crf: 27, maxrate: 900, label: '360p' },
};

// Optional capabilities of the local ffmpeg build.
const caps = { tonemap: false };
try {
  const filters = execFileSync(config.FFMPEG, ['-hide_banner', '-filters'], { encoding: 'utf8' });
  caps.tonemap = /\bzscale\b/.test(filters) && /\btonemap\b/.test(filters);
} catch (e) {
  console.error(`! Could not run "${config.FFMPEG}". Install ffmpeg (or set FFMPEG_PATH).`);
}

const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

function videoArgs(q, info) {
  const Q = QUALITIES[q];
  const filters = [];
  if (info.video && info.video.hdr && caps.tonemap) filters.push(TONEMAP);
  filters.push(Q.height ? `scale=-2:'min(${Q.height},ih)'` : 'scale=-2:ih');
  filters.push('format=yuv420p');
  const maxrate = `${Q.maxrate}k`;
  const bufsize = `${Q.maxrate * 2}k`;
  let enc;
  switch (config.ENCODER) {
    case 'h264_videotoolbox':
      enc = ['-c:v', 'h264_videotoolbox', '-profile:v', 'high', '-b:v', `${Math.round(Q.maxrate * 0.55)}k`, '-maxrate', maxrate];
      break;
    case 'h264_nvenc':
      enc = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-profile:v', 'high', '-rc', 'vbr', '-cq', String(Q.crf + 2), '-b:v', '0', '-maxrate', maxrate, '-bufsize', bufsize];
      break;
    case 'h264_qsv':
      enc = ['-c:v', 'h264_qsv', '-preset', 'faster', '-profile:v', 'high', '-global_quality', String(Q.crf + 2), '-maxrate', maxrate];
      break;
    default:
      enc = ['-c:v', 'libx264', '-preset', config.X264_PRESET, '-profile:v', 'high', '-crf', String(Q.crf), '-maxrate', maxrate, '-bufsize', bufsize];
  }
  return ['-vf', filters.join(','), ...enc, '-force_key_frames', `expr:gte(t,n_forced*${SEG})`];
}

const streams = new Map(); // key -> { key, item, info, q, a, dir, job, touched }

const segName = (i) => `seg_${String(i).padStart(5, '0')}.ts`;
const segCount = (info) => Math.max(1, Math.ceil(info.duration / SEG));
const segPath = (st, i) => path.join(st.dir, segName(i));
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function getStream(item, info, q, a) {
  const key = `${item.id}_${q}_${a}`;
  let st = streams.get(key);
  if (!st) {
    st = { key, item, info, q, a, dir: path.join(CACHE_DIR, key), job: null, touched: Date.now() };
    ensureDir(st.dir);
    streams.set(key, st);
  }
  st.touched = Date.now();
  return st;
}

function playlist(info) {
  const n = segCount(info);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEG + 1}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (let i = 0; i < n; i++) {
    const d = i === n - 1 ? info.duration - SEG * (n - 1) : SEG;
    lines.push(`#EXTINF:${Math.max(d, 0.1).toFixed(3)},`, segName(i));
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

function listSegs(dir) {
  try {
    return fs.readdirSync(dir).map((f) => /^seg_(\d+)\.ts$/.exec(f)).filter(Boolean).map((m) => +m[1]);
  } catch { return []; }
}

function killJob(st) {
  const job = st.job;
  if (!job) return;
  st.job = null;
  job.killed = true;
  try { if (job.paused) job.proc.kill('SIGCONT'); } catch { /* ignore */ }
  try { job.proc.kill('SIGKILL'); } catch { /* ignore */ }
}

function activeJobs() {
  return [...streams.values()].filter((s) => s.job && s.job.alive);
}

function startJob(st, idx) {
  killJob(st);
  // Keep total concurrent encodes bounded: evict the least recently used other stream.
  const others = activeJobs().filter((s) => s !== st).sort((a, b) => a.touched - b.touched);
  while (others.length >= config.MAX_TRANSCODES) killJob(others.shift());

  ensureDir(st.dir);
  const start = idx * SEG;
  const hasAudio = st.info.audio.length > 0;
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-ss', String(start), '-i', st.item.abs,
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', `0:a:${st.a}`] : []),
    '-sn', '-dn',
    ...videoArgs(st.q, st.info),
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0'] : ['-an']),
    '-output_ts_offset', String(start), '-muxdelay', '0',
    '-f', 'hls', '-hls_time', String(SEG), '-hls_list_size', '0',
    '-hls_flags', 'temp_file+independent_segments', '-hls_segment_type', 'mpegts',
    '-start_number', String(idx),
    '-hls_segment_filename', path.join(st.dir, 'seg_%05d.ts'),
    path.join(st.dir, `job_${idx}_${Date.now()}.m3u8`),
  ];
  const proc = spawn(config.FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const job = { proc, startIdx: idx, next: idx, lastReq: idx, pre: new Set(listSegs(st.dir)), paused: false, alive: true, killed: false, stderr: '' };
  proc.stderr.on('data', (d) => { job.stderr = (job.stderr + d).slice(-3000); });
  proc.on('error', (e) => { job.alive = false; job.stderr += String(e); });
  proc.on('exit', (code) => {
    job.alive = false;
    if (code && !job.killed) console.error(`[ffmpeg ${st.key} @${idx}] exited ${code}\n${job.stderr}`);
  });
  st.job = job;
  return job;
}

// Returns the path of segment `idx`, producing it first if necessary. null if the client went away.
async function getSegment(st, idx, aborted) {
  st.touched = Date.now();
  const file = segPath(st, idx);
  if (st.job) st.job.lastReq = idx;
  if (exists(file)) return file;

  const job = st.job;
  if (!job || !job.alive || idx < job.startIdx || idx > job.next + JOIN_SLACK) startJob(st, idx);

  const deadline = Date.now() + 180e3;
  let restarts = 0;
  while (Date.now() < deadline) {
    if (exists(file)) return file;
    if (aborted()) return null;
    const j = st.job;
    if (!j || !j.alive) {
      if (exists(file)) return file;
      if (restarts++ >= 1) throw new Error(`ffmpeg failed: ${(j && j.stderr) || 'no output'}`);
      startJob(st, idx);
    }
    await sleep(80);
  }
  throw new Error('timed out waiting for transcoder');
}

setInterval(() => {
  const now = Date.now();
  for (const st of streams.values()) {
    const job = st.job;
    if (job && job.alive) {
      while (!job.pre.has(job.next) && exists(segPath(st, job.next))) job.next++;
      if (job.pre.has(job.next) && exists(segPath(st, job.next))) {
        // Caught up with segments an earlier run already produced; no need to redo them.
        killJob(st);
      } else if (now - st.touched > IDLE_KILL_MS) {
        killJob(st);
      } else {
        const lead = job.next - job.lastReq;
        try {
          if (!job.paused && lead > PAUSE_AHEAD) { job.proc.kill('SIGSTOP'); job.paused = true; }
          else if (job.paused && lead <= RESUME_AHEAD) { job.proc.kill('SIGCONT'); job.paused = false; }
        } catch { /* platform without SIGSTOP */ }
      }
    }
    if (now - st.touched > CACHE_TTL_MS) {
      killJob(st);
      rmrf(st.dir);
      streams.delete(st.key);
    }
  }
}, 1000).unref();

function shutdown() {
  for (const st of streams.values()) killJob(st);
  rmrf(CACHE_DIR);
}
process.on('exit', shutdown);

module.exports = { QUALITIES, getStream, playlist, getSegment, shutdown, segCount };
