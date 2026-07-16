import React, { useCallback, useEffect, useState } from "react";
import { MessageCircle, X, Maximize2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import ChatPanel from "./ChatPanel";

// Staff-side counterpart to the dealer's floating ChatWidget. Unlike the
// dealer's widget (which is scoped to one dealer's general thread), staff
// talk to many dealers, so this shows a short list of open conversations
// (dealer hasn't been replied to yet) and lets you jump into one inline —
// or hit the expand button to open the full Chats page (src/pages/Chats.jsx)
// for the complete inbox with history/search.
export default function StaffChatWidget({ staff, identity, pendingCount, onExpand }) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null); // { threadId, dealerId, applicationId, label } | null

  const loadOpenThreads = useCallback(async () => {
    setLoading(true);
    try {
      const { data: threadRows } = await supabase
        .from("chat_threads")
        .select("id, application_id, dealer_id, applications(draft_code, application_no, applicant_name), dealers(name, short_name, code)")
        .not("application_id", "is", null);
      const threadIds = (threadRows || []).map((t) => t.id);
      let latestByThread = {};
      if (threadIds.length) {
        const { data: messages } = await supabase
          .from("chat_messages")
          .select("thread_id, sender_type, body, created_at")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: false });
        for (const m of messages || []) {
          if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
        }
      }
      const openThreads = (threadRows || [])
        .map((t) => {
          const latest = latestByThread[t.id];
          return {
            threadId: t.id,
            applicationId: t.application_id,
            dealerId: t.dealer_id,
            label: `${t.applications?.application_no || t.applications?.draft_code || "—"} — ${t.applications?.applicant_name || "—"}`,
            dealerLabel: t.dealers?.short_name || t.dealers?.name || t.dealers?.code || "—",
            lastMessage: latest?.body || null,
            lastAt: latest?.created_at || null,
            awaitingReply: latest ? latest.sender_type !== "staff" : false,
          };
        })
        .filter((t) => t.awaitingReply)
        .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
        .slice(0, 8);
      setThreads(openThreads);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadOpenThreads();
  }, [open, loadOpenThreads]);

  if (!staff) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-80 h-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              <MessageCircle size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Chats</p>
              <p className="text-xs text-slate-300 leading-tight truncate">
                {selected ? selected.label : "Open conversations"}
              </p>
            </div>
            <button
              onClick={onExpand}
              title="Open full Chats inbox"
              className="w-7 h-7 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center"
            >
              <Maximize2 size={15} />
            </button>
            <button
              onClick={() => { setOpen(false); setSelected(null); }}
              title="Minimize"
              className="w-7 h-7 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center"
            >
              <X size={16} />
            </button>
          </div>

          {selected ? (
            <>
              <button
                onClick={() => setSelected(null)}
                className="text-xs font-semibold text-blue-600 px-3 py-1.5 border-b border-slate-100 text-left hover:bg-slate-50 shrink-0"
              >
                ← Back to list
              </button>
              <div className="flex-1 min-h-0">
                <ChatPanel
                  dealerId={selected.dealerId}
                  applicationId={selected.applicationId}
                  identity={identity}
                  emptyLabel="No messages on this application yet."
                  onMessage={loadOpenThreads}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loading ? (
                <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
              ) : threads.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8 px-4">Nothing waiting on you right now.</p>
              ) : (
                threads.map((t) => (
                  <button
                    key={t.threadId}
                    onClick={() => setSelected(t)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-semibold text-slate-700 truncate">{t.label}</span>
                      <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 ml-2" />
                    </div>
                    <p className="text-xs text-slate-400 mb-1">{t.dealerLabel}</p>
                    {t.lastMessage && <p className="text-xs text-slate-500 truncate">{t.lastMessage}</p>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Open chat"}
        className="relative w-14 h-14 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center hover:bg-slate-800 transition-colors"
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center">
            {pendingCount}
          </span>
        )}
      </button>
    </div>
  );
}
