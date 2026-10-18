'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader so the project needs no dependencies.
function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

module.exports = {
  ROOT,
  PORT: int(process.env.PORT, 8080),
  HOST: process.env.HOST || '0.0.0.0',
  MEDIA_DIR: path.resolve(process.env.MEDIA_DIR || path.join(ROOT, 'media')),
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  PASSWORD: process.env.PASSWORD || '',
  SITE_NAME: process.env.SITE_NAME || 'Charge Theatre',
  FFMPEG: process.env.FFMPEG_PATH || 'ffmpeg',
  FFPROBE: process.env.FFPROBE_PATH || 'ffprobe',
  // libx264 (CPU, works everywhere) | h264_videotoolbox (Mac) | h264_nvenc (NVIDIA) | h264_qsv (Intel)
  ENCODER: process.env.ENCODER || 'libx264',
  X264_PRESET: process.env.X264_PRESET || 'veryfast',
  MAX_TRANSCODES: Math.max(1, int(process.env.MAX_TRANSCODES, 2)),
  SEGMENT_SECONDS: 6,
  SESSION_DAYS: int(process.env.SESSION_DAYS, 90),
  // Set to 1 when running behind a reverse proxy / tunnel (Caddy, nginx, Cloudflare Tunnel...).
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
};
