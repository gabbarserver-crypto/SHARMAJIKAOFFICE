// src/components/PastelAvatar.jsx
//
// Flat pastel-circle initials avatar (light background, bold colored
// initials) — matches the reference mobile design for CommsWindow's chat
// lists. Deliberately separate from Avatar.jsx (gradient style), which is
// still used everywhere else in the app; this keeps that look unchanged.
import React from "react";

const PALETTE = [
  { bg: "bg-violet-100 dark:bg-violet-500/15", text: "text-violet-700 dark:text-violet-300" },
  { bg: "bg-sky-100 dark:bg-sky-500/15", text: "text-sky-700 dark:text-sky-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-rose-100 dark:bg-rose-500/15", text: "text-rose-700 dark:text-rose-300" },
  { bg: "bg-orange-100 dark:bg-orange-500/15", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-amber-100 dark:bg-amber-500/15", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-500/15", text: "text-cyan-700 dark:text-cyan-300" },
];

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export default function PastelAvatar({ name = "?", size = 40 }) {
  const { bg, text } = PALETTE[hashOf(name) % PALETTE.length];
  const initials = name.split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center font-bold ${bg} ${text}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
