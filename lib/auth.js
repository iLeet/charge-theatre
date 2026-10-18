'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ensureDir } = require('./util');

ensureDir(config.DATA_DIR);

function getOrCreate(file, make) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  const v = make();
  fs.writeFileSync(file, v + '\n', { mode: 0o600 });
  return v;
}

const secret = getOrCreate(path.join(config.DATA_DIR, 'secret.key'), () => crypto.randomBytes(32).toString('hex'));

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alike characters
let password = config.PASSWORD;
let passwordGenerated = false;
if (!password) {
  password = getOrCreate(path.join(config.DATA_DIR, 'password.txt'), () =>
    Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join(''));
  passwordGenerated = true;
}

// Changing the password changes the signing key, which signs everyone out.
const signingKey = crypto.createHash('sha256').update(secret + '\0' + password).digest();
const sign = (payload) => crypto.createHmac('sha256', signingKey).update(payload).digest('base64url');

function makeToken() {
  const exp = String(Date.now() + config.SESSION_DAYS * 86400e3);
  return `${exp}.${sign(exp)}`;
}

function validToken(token) {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(exp));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;
  return Number(exp) > Date.now();
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const COOKIE = 'ct_session';
const isAuthed = (req) => validToken(parseCookies(req)[COOKIE]);

function checkPassword(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

function clientIp(req) {
  if (config.TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return xf.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function isHttps(req) {
  return !!req.socket.encrypted || (config.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
}

function sessionCookie(req, token, maxAgeSec) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

// Very small brute-force guard: 8 failures per 10 minutes per IP.
const failures = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < 600e3);
  failures.set(ip, list);
  return list.length >= 8;
}
function recordFailure(ip) {
  const list = failures.get(ip) || [];
  list.push(Date.now());
  failures.set(ip, list);
}
function clearFailures(ip) { failures.delete(ip); }
setInterval(() => { for (const ip of failures.keys()) rateLimited(ip); }, 600e3).unref();

module.exports = {
  isAuthed, makeToken, checkPassword, clientIp, sessionCookie, rateLimited, recordFailure, clearFailures,
  passwordGenerated, password: () => password, COOKIE,
};
