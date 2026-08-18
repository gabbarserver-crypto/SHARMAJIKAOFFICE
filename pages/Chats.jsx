// src/pages/Chats.jsx
//
// The full-page "Expand" destination for the floating CommsWindow — same
// four tabs (Recent Chats / Recent Calls / New Call / Customer Chat), same
// data and row components (ThreadsTab / CallsTab / NewCallTab, all reused
// straight from CommsWindow.jsx), just laid out as top tabs + a big
// two-pane inbox instead of a small popup with a bottom nav. Keeps the
// desktop "Chats" page and the floating chat window looking and behaving
// identically, with one shared implementation.
import React, { useEffect, useState } from "react";
import { MessageSquare, Phone, UserPlus, Users } from "lucide-react";
import ChatPanel from "../components/ChatPanel";
import CallLogPanel from "../components/CallLogPanel";
import { identityFor } from "../lib/chat";
import { loadSeenMap, markThreadSeen } from "../lib/threadSeen";
import { ThreadsTab, CallsTab, NewCallTab } from "../components/CommsWindow";

const TABS = [
  { key: "chats", label: "Recent Chats", Icon: MessageSquare },
  { key: "calls", label: "Recent Calls", Icon: Phone },
  { key: "new", label: "New Call", Icon: UserPlus },
  { key: "customer", label: "Customer Chat", Icon: Users },
];

export default function Chats({ staff, call }) {
  const [tab, setTab] = useState("chats");
  const [selectedThread, setSelectedThread] = useState(null); // { threadId, dealerId, applicationId, label, dealerName } | null

  const identity = identityFor({ staff });
  const [seenMap, setSeenMap] = useState(() => loadSeenMap(identity));

  // Same "mark as seen the moment you open it" behavior as the floating
  // window — see lib/threadSeen.js.
  const openThread = (thread) => {
    setSelectedThread(thread);
    if (thread?.threadId) {
      setSeenMap(markThreadSeen(identity, thread.threadId));
    }
  };

  useEffect(() => {
    const onThreadSeen = (event) => {
      const currentKey = identity ? `${identity.type || "unknown"}:${identity.id || "unknown"}` : "anon";
      if (event?.detail?.identityKey && event.detail.identityKey !== currentKey) return;
      setSeenMap(loadSeenMap(identity));
    };
    window.addEventListener("sjo:thread-seen", onThreadSeen);
    return () => window.removeEventListener("sjo:thread-seen", onThreadSeen);
  }, [identity?.type, identity?.id]);

  const changeTab = (key) => {
    setTab(key);
    setSelectedThread(null);
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Chats</h1>
        <p className="text-sm text-slate-500 dark:text-slate-500">Every conversation, call, and contact, in one inbox.</p>
      </div>

      <div className="flex gap-2 mb-4">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => changeTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border flex items-center gap-1.5 ${
              tab === key
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-[340px_1fr] gap-4" style={{ height: "72vh" }}>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          {tab === "chats" ? (
            <ThreadsTab variant="staff" scope="general" seenMap={seenMap} onOpenThread={openThread} />
          ) : tab === "customer" ? (
            <ThreadsTab variant="staff" scope="application" seenMap={seenMap} onOpenThread={openThread} />
          ) : tab === "calls" ? (
            <CallsTab variant="staff" identity={identity} call={call} onOpenThread={openThread} />
          ) : (
            <NewCallTab variant="staff" identity={identity} call={call} onOpenThread={openThread} />
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {selectedThread ? selectedThread.label : "Select a conversation"}
            </h3>
            {selectedThread?.dealerName && (
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{selectedThread.dealerName}</p>
            )}
          </div>
          {selectedThread ? (
            <>
              <CallLogPanel threadId={selectedThread.threadId} dealerId={selectedThread.dealerId} />
              <ChatPanel
                dealerId={selectedThread.dealerId}
                applicationId={selectedThread.applicationId}
                identity={identity}
                emptyLabel="No messages here yet."
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
              Pick a conversation on the left to view and reply.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
