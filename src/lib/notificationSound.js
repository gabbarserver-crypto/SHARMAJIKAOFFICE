// src/lib/notificationSound.js
// Same tiny global-store pattern as theme.js / sidebarColor.js — persists
// across reloads, no context provider needed. Lets each user mute
// notification sound and/or pick which tone plays, without touching the
// actual WebAudio playback code in lib/notify.js (that just reads
// isSoundEnabled() / getSelectedTone() at play time).

import { useEffect, useState } from "react";

const ENABLED_KEY = "sjo-notif-sound-enabled";
const TONE_KEY = "sjo-notif-sound-tone";

// Each tone is a short sequence of notes for playTonePattern() in
// lib/notify.js: freq (Hz), start (seconds after the pattern begins),
// dur (seconds until the note is fully faded), peak (max gain, 0–1).
export const NOTIFICATION_TONES = {
  classic: {
    label: "Classic Ping",
    notes: [
      { freq: 880, start: 0, dur: 0.22, peak: 0.16 },
      { freq: 660, start: 0.12, dur: 0.22, peak: 0.16 },
    ],
  },
  chime: {
    label: "Chime",
    notes: [
      { freq: 523.25, start: 0, dur: 0.18, peak: 0.14 },
      { freq: 659.25, start: 0.1, dur: 0.18, peak: 0.14 },
      { freq: 783.99, start: 0.2, dur: 0.28, peak: 0.16 },
    ],
  },
  bell: {
    label: "Bell",
    notes: [
      { freq: 987.77, start: 0, dur: 0.5, peak: 0.14 },
    ],
  },
  soft: {
    label: "Soft",
    notes: [
      { freq: 440, start: 0, dur: 0.3, peak: 0.09 },
      { freq: 523.25, start: 0.14, dur: 0.34, peak: 0.09 },
    ],
  },
};

const DEFAULT_TONE = "classic";

const listeners = new Set();

function getInitialEnabled() {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(ENABLED_KEY);
  return stored === null ? true : stored === "1";
}

function getInitialTone() {
  if (typeof window === "undefined") return DEFAULT_TONE;
  const stored = window.localStorage.getItem(TONE_KEY);
  return stored && NOTIFICATION_TONES[stored] ? stored : DEFAULT_TONE;
}

let enabled = getInitialEnabled();
let tone = getInitialTone();

function notifyListeners() {
  listeners.forEach((cb) => cb({ enabled, tone }));
}

export function isSoundEnabled() {
  return enabled;
}

export function getSelectedTone() {
  return NOTIFICATION_TONES[tone] || NOTIFICATION_TONES[DEFAULT_TONE];
}

export function getSelectedToneKey() {
  return tone;
}

export function setSoundEnabled(value) {
  enabled = !!value;
  if (typeof window !== "undefined") window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  notifyListeners();
}

export function setNotificationTone(key) {
  if (!NOTIFICATION_TONES[key]) return;
  tone = key;
  if (typeof window !== "undefined") window.localStorage.setItem(TONE_KEY, key);
  notifyListeners();
}

// Hook for the Settings page — returns { enabled, tone, toneDef, setEnabled, setTone }.
export function useNotificationSound() {
  const [state, setState] = useState({ enabled, tone });
  useEffect(() => {
    const listener = (v) => setState(v);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return {
    enabled: state.enabled,
    tone: state.tone,
    toneDef: NOTIFICATION_TONES[state.tone] || NOTIFICATION_TONES[DEFAULT_TONE],
    setEnabled: setSoundEnabled,
    setTone: setNotificationTone,
  };
}
