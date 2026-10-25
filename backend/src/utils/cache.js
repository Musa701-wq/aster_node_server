"use strict";

const TTL_MS = 60 * 1000;

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

function set(key, data, ttlMs) {
  store.set(key, { data, expiresAt: Date.now() + (ttlMs || TTL_MS) });
}

function isFresh(key) {
  return get(key) !== null;
}

function clear(key) {
  if (key) {
    store.delete(key);
  } else {
    store.clear();
  }
}

module.exports = { get, set, isFresh, clear, TTL_MS };