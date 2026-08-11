// src/lib/threadSeen.js
//
// Tracks, per logged-in identity, the last time the user actually opened
// each chat thread — so unread badges reflect "have I looked at this"
// rather than just "has the other side replied". Persisted to
// localStorage, namespaced by identity so a shared browser/device doesn't
// mix up read-state between different staff/dealer logins.
//
// Shape stored under each key: { [threadId]: isoTimestampString }

const STORAGE_PREFIX = "sjo_thread_seen_map:";

function storageKey(identity) {
  const id = identity || "anon";
  return `${STORAGE_PREFIX}${id}`;
}

// Loads the saved seen-map for this identity. Always returns a plain
// object (never null/undefined), so callers can index into it safely.
export function loadSeenMap(identity) {
  try {
    const raw = localStorage.getItem(storageKey(identity));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Persists the full seen-map for this identity.
export function saveSeenMap(identity, map) {
  try {
    localStorage.setItem(storageKey(identity), JSON.stringify(map || {}));
  } catch {
    // Storage can fail (private browsing, quota, etc) — non-fatal, the
    // unread badge just won't persist across reloads in that case.
  }
}

// A thread counts as "seen" if the user opened it at or after the last
// message time. No recorded visit, or a visit that predates the latest
// message, means it's still unread.
export function isThreadSeen(seenMap, threadId, lastAt) {
  if (!threadId) return false;
  const seenAt = seenMap && seenMap[threadId];
  if (!seenAt) return false;
  if (!lastAt) return true;
  return new Date(seenAt).getTime() >= new Date(lastAt).getTime();
}
