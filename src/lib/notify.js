// src/lib/notify.js
//
// Foreground notifications for new drafts, chats, and calls — fires while
// the app/tab is actually open and running (a background browser tab, a
// minimized window, or the Capacitor WebView while the app process is
// alive). No service worker, no Firebase project, no native setup needed,
// so it works the same on the web app and inside the Android app straight
// away.
//
// What this can't do: wake a fully-closed app or a locked phone — that
// needs real push infrastructure (FCM for Android, Web Push + VAPID for the
// browser), which needs its own Firebase project set up on your end first.
// This is the "app is open" half of notifications; the "app is closed"
// half is a separate, bigger piece of work once you've got that Firebase
// project.

import { isSoundEnabled, getSelectedTone } from "./notificationSound";

const hasBrowserNotifications = typeof window !== "undefined" && "Notification" in window;

// Browsers (and the Android WebView especially) refuse to let an
// AudioContext actually produce sound until it's been started/resumed as
// part of a real user gesture — a tap, click, or keypress. On the web app
// that requirement is usually satisfied incidentally (someone's already
// clicked into a page before any notification fires), but in the native
// app it's easy to receive a first notification before tapping anything
// at all, and the ping silently does nothing. This primes/resumes the
// context on the very first tap anywhere in the app, once, so it's ready
// by the time a real notification needs it.
let primed = false;
export function primeAudioOnFirstInteraction() {
  if (primed || typeof window === "undefined") return;
  primed = true;
  const unlock = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      // best-effort
    }
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("click", unlock);
  };
  window.addEventListener("touchstart", unlock, { once: true, passive: true });
  window.addEventListener("click", unlock, { once: true });
}

export async function requestNotificationPermission() {
  if (!hasBrowserNotifications) return "unsupported";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return "denied"; }
  }
  return Notification.permission;
}

// Plays a short sequence of notes via WebAudio — no external audio file to
// ship or for the Capacitor build to worry about bundling. `notes` is the
// same shape as NOTIFICATION_TONES entries in lib/notificationSound.js:
// [{ freq, start, dur, peak }, ...].
function playTonePattern(notes) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    notes.forEach(({ freq, start = 0, dur = 0.22, peak = 0.16 }) => {
      const noteStart = ctx.currentTime + start;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(peak, noteStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteStart);
      osc.stop(noteStart + dur);
    });
  } catch {
    // best-effort — a silent notification still isn't a broken one
  }
}
let audioCtx = null;

// Plays the user's currently-selected notification tone (Settings ->
// Notifications), unless they've muted notification sound entirely.
export function playPing() {
  if (!isSoundEnabled()) return;
  playTonePattern(getSelectedTone().notes);
}

// Plays a specific tone regardless of the mute setting — used by the
// Settings page's "preview" buttons so users can hear a tone before
// choosing it, even while sound is currently muted.
export function previewTone(toneDef) {
  playTonePattern(toneDef.notes);
}

// A repeating ringtone (reuses the same ping, looped) for incoming calls —
// GlobalCallOverlay's banner has no sound of its own (the call's `notify()`
// is fired with silent:true, since the banner + accept/decline UI is meant
// to *be* the notification), so without this an incoming call is silent
// unless you're already looking at the screen. Call stopRingtone() the
// moment the call leaves 'ringing-incoming' (answered, declined, timed out,
// or the caller hung up) — it does not stop itself.
let ringtoneTimer = null;
export function startRingtone() {
  if (ringtoneTimer) return; // already ringing
  playPing();
  ringtoneTimer = setInterval(playPing, 2000);
}
export function stopRingtone() {
  if (ringtoneTimer) { clearInterval(ringtoneTimer); ringtoneTimer = null; }
}

const listeners = new Set();
// Subscribe to in-app toast notifications — used by NotificationToaster.
export function onNotify(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// kind: 'draft' | 'chat' | 'call' — lets the toaster badge/style each
// differently. `silent` skips the sound (used for e.g. a call that already
// has its own ring UI).
export function notify({ kind = "chat", title, body, onClick, silent = false }) {
  if (!silent) playPing();
  listeners.forEach((fn) => fn({ kind, title, body, onClick, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }));

  // Also raise a real OS/browser notification once the tab isn't the
  // focused one — the in-app toast above already covers the focused case,
  // and duplicating it while focused would just be noisy.
  if (hasBrowserNotifications && Notification.permission === "granted" && document.visibilityState === "hidden") {
    try {
      const n = new Notification(title, { body, tag: kind });
      if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
    } catch {
      // Some WebViews (Capacitor included) don't support the Notification
      // constructor at all — the in-app toast still covers that case.
    }
  }
}
