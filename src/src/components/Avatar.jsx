import React from "react";

// Deterministic gradient per name, so the same dealer/applicant always gets
// the same colors (mirrors Messenger's per-contact gradient avatars).
const GRADIENTS = [
  "from-fuchsia-500 to-purple-600",
  "from-sky-400 to-blue-600",
  "from-amber-400 to-orange-600",
  "from-emerald-400 to-teal-600",
  "from-rose-400 to-pink-600",
  "from-indigo-400 to-violet-600",
];

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export default function Avatar({ name = "?", size = 36 }) {
  const gradient = GRADIENTS[hashOf(name) % GRADIENTS.length];
  const initials = name.split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <div
      className={`shrink-0 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
}
