// src/lib/sidebarColor.js
// Same tiny global-store pattern as theme.js — persists across reloads,
// no context provider needed. Sidebar colors are stored as light/dark
// gradient hex pairs rather than Tailwind classes, since Tailwind's JIT
// can't reliably generate classes from a name picked at runtime — inline
// CSS custom properties sidestep that entirely.
import { useEffect, useState } from "react";

const STORAGE_KEY = "sjo-sidebar-color";

export const SIDEBAR_COLORS = {
  purple: { label: "Purple", swatch: "#9333ea", light: ["#7c3aed", "#7e22ce"], dark: ["#2e1065", "#020617"] },
  blue:   { label: "Blue",   swatch: "#2563eb", light: ["#2563eb", "#1e40af"], dark: ["#172554", "#020617"] },
  green:  { label: "Green",  swatch: "#16a34a", light: ["#16a34a", "#15803d"], dark: ["#052e16", "#020617"] },
  red:    { label: "Red",    swatch: "#dc2626", light: ["#dc2626", "#991b1b"], dark: ["#450a0a", "#020617"] },
  yellow: { label: "Yellow", swatch: "#ca8a04", light: ["#d97706", "#b45309"], dark: ["#451a03", "#020617"] },
  black:  { label: "Black",  swatch: "#1e293b", light: ["#1e293b", "#0f172a"], dark: ["#0f172a", "#020617"] },
};

const listeners = new Set();

// Darkens a "#rrggbb" hex color by the given fraction (0–1), for the hover
// shade — the .light[] pair is already a 2-stop gradient, not a hover
// shade, so this derives one instead of hardcoding a 7th value per color.
function darken(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 255) * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function writeAccentVars(key) {
  if (typeof document === "undefined") return;
  const base = SIDEBAR_COLORS[key].light[0];
  document.documentElement.style.setProperty("--accent", base);
  document.documentElement.style.setProperty("--accent-hover", darken(base, 0.12));
  document.documentElement.style.setProperty("--accent-ring", base + "66"); // ~40% alpha
}

function getInitial() {
  if (typeof window === "undefined") return "purple";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && SIDEBAR_COLORS[stored] ? stored : "purple";
}

let current = getInitial();
writeAccentVars(current); // set immediately so buttons match on first paint

function apply(key) {
  current = key;
  window.localStorage.setItem(STORAGE_KEY, key);
  writeAccentVars(key);
  listeners.forEach((cb) => cb(key));
}

export function setSidebarColor(key) {
  if (SIDEBAR_COLORS[key]) apply(key);
}

// Returns [colorKey, colorDef, setSidebarColor] — colorDef has .light/.dark
// gradient hex pairs to build the inline gradient style from.
export function useSidebarColor() {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const listener = (v) => setValue(v);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return [value, SIDEBAR_COLORS[value], setSidebarColor];
}
