import React, { useState } from "react";
import { MessageCircle, X, Minus } from "lucide-react";
import ChatPanel from "./ChatPanel";
import Avatar from "./Avatar";

// Persistent floating chat button + panel, mounted once per session so it
// stays visible across every page/tab. This is the dealer's *general*
// thread (application_id: null) — one running conversation covering
// everything, in addition to the per-application chats opened from an
// application's row/detail (see ApplicationChatModal usages in
// Applications.jsx and DealerPortal.jsx).
//
// Three states, like Facebook Messenger's web chat heads:
//   "closed"    — nothing but the round bubble
//   "open"      — full panel
//   "minimized" — collapsed to a slim header bar (keeps the thread mounted,
//                 so nothing is lost/reset), click it to reopen
export default function ChatWidget({ dealerId, identity, title = "SJO Support" }) {
  const [state, setState] = useState("closed"); // "closed" | "open" | "minimized"
  const [unread, setUnread] = useState(0);

  const openFull = () => { setState("open"); setUnread(0); };
  const minimize = () => setState("minimized");
  const close = () => setState("closed");

  const handleMessage = (msg) => {
    const isMine = identity && msg.sender_type === identity.type && msg.sender_id === identity.id;
    if (!isMine && state !== "open") setUnread((u) => u + 1);
  };

  if (!dealerId) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {state === "open" && (
        <div className="w-80 h-[440px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          <button onClick={openFull} className="bg-blue-600 text-white px-4 py-3 flex items-center gap-2.5 shrink-0 text-left">
            <Avatar name={title} size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight truncate">{title}</p>
              <p className="text-xs text-blue-100 leading-tight">General conversation for this dealer</p>
            </div>
            <span onClick={(e) => { e.stopPropagation(); minimize(); }} title="Minimize" className="w-7 h-7 shrink-0 rounded-md hover:bg-white/15 flex items-center justify-center">
              <Minus size={16} />
            </span>
            <span onClick={(e) => { e.stopPropagation(); close(); }} title="Close" className="w-7 h-7 shrink-0 rounded-md hover:bg-white/15 flex items-center justify-center">
              <X size={16} />
            </span>
          </button>
          <ChatPanel dealerId={dealerId} identity={identity} onMessage={handleMessage} />
        </div>
      )}

      {/* Minimized dock — a slim header bar, click it (Facebook-style) to
          expand back to the full panel. The ChatPanel itself isn't rendered
          while minimized (no need to keep a live subscription open for a
          bar the user can't read), but messages reload instantly from the
          DB when reopened, so nothing is actually lost. */}
      {state === "minimized" && (
        <button
          onClick={openFull}
          className="w-72 bg-blue-600 text-white rounded-xl shadow-xl px-4 py-3 flex items-center gap-2.5 hover:bg-blue-700 transition-colors"
        >
          <Avatar name={title} size={30} />
          <span className="text-sm font-semibold flex-1 text-left truncate">{title}</span>
          {unread > 0 && (
            <span className="min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
              {unread}
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); close(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); close(); } }}
            title="Close"
            aria-label="Close chat"
            className="w-6 h-6 shrink-0 rounded-md hover:bg-white/15 flex items-center justify-center"
          >
            <X size={14} />
          </span>
        </button>
      )}

      {state === "closed" && (
        <button
          onClick={openFull}
          aria-label="Open chat"
          className="relative w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center hover:bg-blue-700 transition-colors"
        >
          <MessageCircle size={24} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center">
              {unread}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
