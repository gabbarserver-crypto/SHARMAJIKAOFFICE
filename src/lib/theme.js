// src/lib/theme.js
// A tiny global theme store — no context provider needed since there's
// only ever one of these per tab. Sidebar's toggle used to just flip its
// own local state, which is why dark mode only ever affected the sidebar:
// nothing else in the app was listening. This makes it real: the .dark
// class goes on <html>, so every dark: utility class anywhere in the app
// (not just the sidebar) responds to it, and the choice persists across
// reloads.
import { useEffect, useState } from "react";

const STORAGE_KEY = "sjo-theme";
const listeners = new Set();

function getInitial() {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) return stored === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
}

let dark = getInitial();

function apply(value) {
  dark = value;
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", value);
  }
  window.localStorage.setItem(STORAGE_KEY, value ? "dark" : "light");
  listeners.forEach((cb) => cb(dark));
}

// Apply on load (module init), not just on first toggle.
if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("dark", dark);
}

export function setDarkMode(value) {
  apply(value);
}

export function toggleDarkMode() {
  apply(!dark);
}

// Hook for any component that needs to read/react to the current theme.
export function useDarkMode() {
  const [value, setValue] = useState(dark);
  useEffect(() => {
    const listener = (v) => setValue(v);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return [value, toggleDarkMode];
}
