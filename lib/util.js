'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const naturalCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Debounced JSON persistence.
function persisted(file, initial) {
  const data = readJson(file, initial);
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = null;
    try { atomicWrite(file, JSON.stringify(data)); } catch (e) { console.error('save failed', file, e.message); }
  };
  return {
    data,
    save: () => { if (!timer) timer = setTimeout(save, 800); },
    flush: () => { if (timer) save(); },
  };
}

class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n <= 0) await new Promise((r) => this.q.push(r));
    this.n--;
    try { return await fn(); } finally {
      this.n++;
      const next = this.q.shift();
      if (next) next();
    }
  }
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

module.exports = { sha, sleep, naturalCompare, atomicWrite, readJson, persisted, Semaphore, rmrf, ensureDir, path };
