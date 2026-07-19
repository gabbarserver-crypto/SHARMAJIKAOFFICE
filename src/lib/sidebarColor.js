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

function getInitial() {
  if (typeof window === "undefined") return "purple";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && SIDEBAR_COLORS[stored] ? stored : "purple";
}

let current = getInitial();

function apply(key) {
  current = key;
  window.localStorage.setItem(STORAGE_KEY, key);
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
