// src/lib/pinLock.js
//
// A device-local "PIN to unlock" layer, sitting on top of the normal
// Supabase session — NOT a replacement for it. This never talks to
// Supabase; it purely gates whether the already-logged-in app is shown on
// THIS device. Someone without the PIN but with access to this browser's
// storage could still technically pull the session token directly — same
// caveat every "PIN to unlock" app (banking apps included) has, since the
// PIN's job is convenience/quick-glance protection, not cryptographic
// security equivalent to the login itself.
//
// Storage: one hash per user id, in localStorage, so multiple
// staff/dealers using the same shared computer don't collide or leak
// each other's PIN.

const KEY_PREFIX = "sjo-pin-hash:";
const PROMPTED_PREFIX = "sjo-pin-prompted:";

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hasPinSetUp(userId) {
  return !!localStorage.getItem(KEY_PREFIX + userId);
}

export async function setPin(userId, pin) {
  const hash = await sha256(`${userId}:${pin}`);
  localStorage.setItem(KEY_PREFIX + userId, hash);
}

export async function verifyPin(userId, pin) {
  const stored = localStorage.getItem(KEY_PREFIX + userId);
  if (!stored) return false;
  const hash = await sha256(`${userId}:${pin}`);
  return hash === stored;
}

export function clearPin(userId) {
  localStorage.removeItem(KEY_PREFIX + userId);
}

// "Have we already offered to set up a PIN for this user, so we don't nag
// them every single login if they dismissed it once."
export function hasBeenPromptedForPin(userId) {
  return !!localStorage.getItem(PROMPTED_PREFIX + userId);
}

export function markPinPrompted(userId) {
  localStorage.setItem(PROMPTED_PREFIX + userId, "1");
}
