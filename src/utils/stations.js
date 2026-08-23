import crypto from 'crypto';
import { Setting } from '../models/Setting.js';

// The fixed set of volunteer counters. Each gets its own secret access token
// embedded in a QR/link the organizer hands to a volunteer — no login needed.
export const STATIONS = [
  // A single all-in-one counter: scanning a guest shows all four actions to
  // tap. Handy when one volunteer handles everything at one desk.
  { key: 'all', label: 'All counters', emoji: '🎫', multi: true },
  { key: 'checkin', label: 'Check-in', emoji: '✅' },
  { key: 'tshirt', label: 'T-shirt', emoji: '👕' },
  { key: 'souvenir', label: 'Souvenir', emoji: '🎁' },
  { key: 'drinks', label: 'Drinks', emoji: '🥤' },
];

const SETTING_KEY = 'stationTokens';

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Return { checkin: token, tshirt: token, ... }, minting any missing tokens
// and persisting them so links stay stable across restarts/deploys.
export async function getStationTokens() {
  const current = (await Setting.get(SETTING_KEY, {})) || {};
  let changed = false;
  for (const s of STATIONS) {
    if (!current[s.key]) {
      current[s.key] = newToken();
      changed = true;
    }
  }
  if (changed) await Setting.set(SETTING_KEY, current);
  return current;
}

// Regenerate every station token (invalidates all old links). Use if a link
// leaks or the event is over.
export async function rotateStationTokens() {
  const next = {};
  for (const s of STATIONS) next[s.key] = newToken();
  await Setting.set(SETTING_KEY, next);
  return next;
}

// Given a scanned/opened token, return the matching station def or null.
export async function resolveStationToken(token) {
  if (!token) return null;
  const tokens = (await Setting.get(SETTING_KEY, {})) || {};
  const key = Object.keys(tokens).find((k) => tokens[k] === token);
  if (!key) return null;
  return STATIONS.find((s) => s.key === key) || null;
}
