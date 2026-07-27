// src/components/CallTimer.jsx
//
// Renders a live "MM:SS" (or "H:MM:SS" past an hour) counting up from
// `answeredAt`, ticking once a second. Used by both GlobalCallOverlay.jsx
// (direct calls) and ChatPanel.jsx (in-thread calls) — the actual recorded
// duration shown afterward in the call log is computed separately, in
// lib/callLog.js, from the same answeredAt timestamp; this is purely the
// live on-screen counter while the call is still going.
import React, { useEffect, useState } from "react";

function format(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function CallTimer({ answeredAt, className }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!answeredAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [answeredAt]);

  if (!answeredAt) return null;
  const elapsed = Math.max(0, Math.round((now - new Date(answeredAt).getTime()) / 1000));
  return <span className={className}>{format(elapsed)}</span>;
}
