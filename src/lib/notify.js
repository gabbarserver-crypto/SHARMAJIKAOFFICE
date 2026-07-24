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

const hasBrowserNotifications = typeof window !== "undefined" && "Notification" in window;

export async function requestNotificationPermission() {
  if (!hasBrowserNotifications) return "unsupported";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return "denied"; }
  }
  return Notification.permission;
}

// A short two-tone "ping" via WebAudio — no external audio file to ship or
// for the Capacitor build to worry about bundling.
let audioCtx = null;
export function playPing() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    [880, 660].forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  } catch {
    // best-effort — a silent notification still isn't a broken one
  }
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
