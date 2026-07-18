// src/pages/Chats.jsx
//
// A dedicated inbox for staff: every application with chat enabled, in one
// place, instead of having to open each application's detail view to check.
// "Open" here means "the dealer's latest message hasn't been replied to by
// staff yet" (same definition used for the badge on the Applications list) —
// it's a decent proxy for unread since there's no per-staff read-tracking
// table, not a literal read/unseen flag.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import ChatPanel from "../components/ChatPanel";
import { identityFor } from "../lib/chat";

export default function Chats({ staff }) {
  const [threads, setThreads] = useState([]); // enriched: { threadId, applicationId, draftCode, applicantName, dealerId, dealerLabel, awaitingReply, lastAt }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open"); // "open" | "all"
  const [selectedThreadId, setSelectedThreadId] = useState(null);

  // "Chat Dealer" — a dealer's general thread (application_id: null), i.e.
  // a normal message sent from the dealer's floating chat widget rather than
  // from a specific application. These don't show up in the per-application
  // list above, so they get their own section.
  const [dealerThreads, setDealerThreads] = useState([]); // { threadId, dealerId, dealerLabel, awaitingReply, lastAt, lastMessage }
  const [dealerThreadsLoading, setDealerThreadsLoading] = useState(true);
  const [selectedDealerThreadId, setSelectedDealerThreadId] = useState(null);

  const identity = identityFor({ staff });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Only applications whose service has chat enabled ever get a thread,
      // but we don't need to filter on that here — we can just start from
      // chat_threads itself and join back to the application for display.
      const { data: threadRows, error: threadsError } = await supabase
        .from("chat_threads")
        .select("id, application_id, dealer_id, applications(draft_code, application_no, applicant_name), dealers(name, short_name, code)")
        .not("application_id", "is", null);
      if (threadsError) throw threadsError;

      const threadIds = (threadRows || []).map((t) => t.id);
      let latestByThread = {};
      if (threadIds.length) {
        const { data: messages, error: messagesError } = await supabase
          .from("chat_messages")
          .select("thread_id, sender_type, body, created_at")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: false });
        if (messagesError) throw messagesError;
        for (const m of messages || []) {
          if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
        }
      }

      const enriched = (threadRows || [])
        .map((t) => {
          const latest = latestByThread[t.id];
          return {
            threadId: t.id,
            applicationId: t.application_id,
            dealerId: t.dealer_id,
            draftCode: t.applications?.application_no || t.applications?.draft_code || "—",
            applicantName: t.applications?.applicant_name || "—",
            dealerLabel: t.dealers?.short_name || t.dealers?.name || t.dealers?.code || "—",
            lastMessage: latest?.body || null,
            lastAt: latest?.created_at || null,
            awaitingReply: latest ? latest.sender_type !== "staff" : false,
          };
        })
        // Threads with no messages yet aren't useful in an inbox view.
        .filter((t) => t.lastAt)
        .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

      setThreads(enriched);
    } catch (e) {
      setError(e.message || "Couldn't load chats");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDealerThreads = useCallback(async () => {
    setDealerThreadsLoading(true);
    try {
      const { data: threadRows, error: threadsError } = await supabase
        .from("chat_threads")
        .select("id, dealer_id, dealers(name, short_name, code)")
        .is("application_id", null);
      if (threadsError) throw threadsError;

      const threadIds = (threadRows || []).map((t) => t.id);
      let latestByThread = {};
      if (threadIds.length) {
        const { data: messages, error: messagesError } = await supabase
          .from("chat_messages")
          .select("thread_id, sender_type, body, created_at")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: false });
        if (messagesError) throw messagesError;
        for (const m of messages || []) {
          if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
        }
      }

      const enriched = (threadRows || [])
        .map((t) => {
          const latest = latestByThread[t.id];
          return {
            threadId: t.id,
            dealerId: t.dealer_id,
            dealerLabel: t.dealers?.short_name || t.dealers?.name || t.dealers?.code || "—",
            lastMessage: latest?.body || null,
            lastAt: latest?.created_at || null,
            awaitingReply: latest ? latest.sender_type !== "staff" : false,
          };
        })
        .filter((t) => t.lastAt)
        .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

      setDealerThreads(enriched);
    } catch {
      // Best-effort — a failure here shouldn't block the per-application
      // chat list above from working.
    } finally {
      setDealerThreadsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDealerThreads(); }, [loadDealerThreads]);

  const visible = useMemo(
    () => (filter === "open" ? threads.filter((t) => t.awaitingReply) : threads),
    [threads, filter]
  );

  const selected = threads.find((t) => t.threadId === selectedThreadId) || null;
  const selectedDealerThread = dealerThreads.find((t) => t.threadId === selectedDealerThreadId) || null;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Chats</h1>
          <p className="text-sm text-slate-500 dark:text-slate-500">Every application conversation, in one inbox.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("open")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
              filter === "open" ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
            }`}
          >
            Open ({threads.filter((t) => t.awaitingReply).length})
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
              filter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
            }`}
          >
            All ({threads.length})
          </button>
        </div>
      </div>

      {error && <p className="text-rose-500 text-sm mb-4">{error}</p>}

      <div className="grid md:grid-cols-[320px_1fr] gap-4" style={{ height: "70vh" }}>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 px-4">
                {filter === "open" ? "Nothing waiting on you right now." : "No conversations yet."}
              </p>
            ) : (
              visible.map((t) => (
                <button
                  key={t.threadId}
                  onClick={() => setSelectedThreadId(t.threadId)}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-50 dark:bg-slate-800/60 ${selectedThreadId === t.threadId ? "bg-blue-50" : ""}`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">{t.applicantName}</span>
                    {t.awaitingReply && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 ml-2" />}
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">{t.draftCode} · {t.dealerLabel}</p>
                  {t.lastMessage && <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{t.lastMessage}</p>}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {selected ? `${selected.draftCode} — ${selected.applicantName}` : "Select a conversation"}
            </h3>
          </div>
          {selected ? (
            <ChatPanel
              dealerId={selected.dealerId}
              applicationId={selected.applicationId}
              identity={identity}
              emptyLabel="No messages on this application yet."
              onMessage={load}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
              Pick a conversation on the left to view and reply.
            </div>
          )}
        </div>
      </div>

      {/* Chat Dealer — general (not tied to any application) conversations.
          A dealer's normal message from their floating chat widget lands
          here, since it has no application to attach to. */}
      <div className="mt-8">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">Chat Dealer</h3>
        <p className="text-sm text-slate-500 dark:text-slate-500 mb-4">General messages from dealers, not tied to a specific application.</p>

        <div className="grid md:grid-cols-[320px_1fr] gap-4" style={{ height: "60vh" }}>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {dealerThreadsLoading ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Loading…</p>
              ) : dealerThreads.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 px-4">No general dealer messages yet.</p>
              ) : (
                dealerThreads.map((t) => (
                  <button
                    key={t.threadId}
                    onClick={() => setSelectedDealerThreadId(t.threadId)}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-50 dark:bg-slate-800/60 ${selectedDealerThreadId === t.threadId ? "bg-blue-50" : ""}`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">{t.dealerLabel}</span>
                      {t.awaitingReply && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 ml-2" />}
                    </div>
                    {t.lastMessage && <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{t.lastMessage}</p>}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {selectedDealerThread ? selectedDealerThread.dealerLabel : "Select a conversation"}
              </h3>
            </div>
            {selectedDealerThread ? (
              <ChatPanel
                dealerId={selectedDealerThread.dealerId}
                identity={identity}
                emptyLabel="No general messages with this dealer yet."
                onMessage={loadDealerThreads}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                Pick a conversation on the left to view and reply.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
