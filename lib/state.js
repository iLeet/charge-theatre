'use strict';
const path = require('path');
const config = require('./config');
const { persisted } = require('./util');

// Server-side so the car, your phone and your laptop all share one "continue watching".
const store = persisted(path.join(config.DATA_DIR, 'state.json'), { progress: {}, pinned: [] });
const state = store.data;
state.progress = state.progress || {};
state.pinned = state.pinned || [];

function setProgress(id, pos, dur) {
  if (!(dur > 0) || !(pos >= 0)) return;
  const done = pos / dur > 0.93 || dur - pos < 60;
  state.progress[id] = { pos: done ? 0 : Math.floor(pos), dur: Math.floor(dur), done, at: Date.now() };
  store.save();
}

function setWatched(id, watched, dur) {
  const cur = state.progress[id] || { pos: 0, dur: dur || 0 };
  state.progress[id] = { ...cur, pos: 0, done: !!watched, at: Date.now() };
  store.save();
}

function setPinned(showId, on) {
  const i = state.pinned.indexOf(showId);
  if (on && i < 0) state.pinned.unshift(showId);
  if (!on && i >= 0) state.pinned.splice(i, 1);
  store.save();
}

module.exports = { state, setProgress, setWatched, setPinned, flush: store.flush };
