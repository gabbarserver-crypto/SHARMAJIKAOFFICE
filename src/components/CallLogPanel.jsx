// src/components/CallLogPanel.jsx
//
// Compact call history strip for one Chats-page conversation — every
// thread call rung from this ChatPanel, plus any direct person-to-person
// call (lib/directCall.js) involving this dealer. Read-only: the actual
// ringing/calling UI lives in ChatPanel.jsx / GlobalCallOverlay.jsx, this
// just shows what already happened. See src/lib/callLog.js for the writes.
import React, { useEffect, useState } from "react";
import { PhoneMissed, PhoneOff, Phone, Video } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchCallLogs } from "../lib/callLog";

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// row.outcome is null while a call is still ringing/in progress — treat
// that (and anything unrecognized) as "missed" for icon purposes rather
// than showing nothing.
function rowMeta(row) {
  if (row.outcome === "answered") {
    return { Icon: row.call_type === "video" ? Video : Phone, color: "text-emerald-600 dark:text-emerald-400", label: "Answered" };
  }
  if (row.outcome === "declined") {
    return { Icon: PhoneOff, color: "text-amber-600 dark:text-amber-400", label: "Declined" };
  }
  return { Icon: PhoneMissed, color: "text-rose-600 dark:text-rose-400", label: "Missed" };
}

export default function CallLogPanel({ threadId, dealerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!threadId && !dealerId) { setRows([]); setLoading(false); return undefined; }

    (async () => {
      setLoading(true);
      const { rows: fetched } = await fetchCallLogs({ threadId, dealerId, limit: 15 });
      if (!cancelled) { setRows(fetched); setLoading(false); }
    })();

    // Live updates — a call that just ended (or one that just started
    // ringing) shows up here without needing to switch conversations.
    const channel = supabase
      .channel(`call-log:${threadId || dealerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_logs" }, () => {
        fetchCallLogs({ threadId, dealerId, limit: 15 }).then(({ rows: fetched }) => {
          if (!cancelled) setRows(fetched);
        });
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [threadId, dealerId]);

  if (loading || rows.length === 0) return null;

  return (
    <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 px-3 py-2 shrink-0">
      <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">Recent calls</p>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {rows.map((r) => {
          const { Icon, color, label } = rowMeta(r);
          const who = r.caller_name || r.callee_name || "";
          return (
            <div
              key={r.id}
              title={`${label}${who ? ` — ${who}` : ""}${r.duration_seconds ? ` (${formatDuration(r.duration_seconds)})` : ""}`}
              className="flex items-center gap-1.5 shrink-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full px-2.5 py-1"
            >
              <Icon size={13} className={color} />
              <span className="text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                {who || (r.call_type === "video" ? "Video call" : "Voice call")}
              </span>
              {r.duration_seconds ? (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{formatDuration(r.duration_seconds)}</span>
              ) : null}
              <span className="text-[11px] text-slate-400 dark:text-slate-500">{timeAgo(r.started_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
