import React, { useState } from "react";
import { X, Minus, ExternalLink } from "lucide-react";
import ChatPanel from "./ChatPanel";
import Avatar from "./Avatar";

// Chat scoped to one application — opened from that application's row in
// either the admin Applications table or the dealer's "My Applications"
// list. Only shown for services where the "Chat in Application" workflow
// rule is on (services.chat_in_app), same flag already configured per
// service in Masters > Service.
//
// Opens as a small docked bar first (Facebook Messenger web's chat-head
// pattern) rather than immediately popping open the full detail view —
// clicking the bar's header expands it. Minimize collapses it back to that
// same bar without losing your place; only the X actually calls onClose
// (which unmounts this from the parent). onOpenDetail (optional — staff
// side only) opens the full application detail modal alongside the chat,
// for when you need to see/edit applicant details, documents, etc.
//
// Visibility (dealer + their sub-staff + our staff) is enforced by RLS on
// chat_threads/chat_messages, keyed off dealerId — this component just
// needs to be told which dealer + application it's scoped to.
export default function ApplicationChatModal({ dealerId, applicationId, applicationLabel, identity, onClose, onOpenDetail }) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed z-50 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl dark:bg-slate-900 dark:border-slate-800 shadow-xl px-3.5 py-2.5 flex items-center gap-2.5 hover:bg-slate-50 dark:bg-slate-800/60 transition-colors"
        style={{ bottom: "calc(6rem + env(safe-area-inset-bottom))", right: "calc(1.25rem + env(safe-area-inset-right))" }}
      >
        <Avatar name={applicationLabel} size={32} />
        <div className="min-w-0 flex-1 text-left">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight">Application Chat</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 leading-tight truncate">{applicationLabel}</p>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onClose(); } }}
          title="Close"
          aria-label="Close chat"
          className="w-6 h-6 shrink-0 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-400 dark:text-slate-500"
        >
          <X size={14} />
        </span>
      </button>
    );
  }

  return (
    <div
      className="fixed z-50 w-80 h-[460px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
      style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))", right: "calc(1.25rem + env(safe-area-inset-right))" }}
    >
      <button onClick={() => setExpanded(false)} className="bg-blue-600 text-white px-3.5 py-3 flex items-center gap-2.5 shrink-0 text-left">
        <Avatar name={applicationLabel} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight truncate">Application Chat</p>
          <p className="text-xs text-blue-100 leading-tight truncate">{applicationLabel}</p>
        </div>
        <span onClick={(e) => { e.stopPropagation(); setExpanded(false); }} title="Minimize" className="w-7 h-7 shrink-0 rounded-md hover:bg-white/15 flex items-center justify-center">
          <Minus size={16} />
        </span>
        {onOpenDetail && (
          <span onClick={(e) => { e.stopPropagation(); onOpenDetail(); }} title="Open full detail view" className="w-7 h-7 shrink-0 rounded-md hover:bg-white/15 flex items-center justify-center">
            <ExternalLink size={15} />
          </span>
        )}
        <span onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close" className="w-7 h-7 shrink-0 rounded-md hover:bg-white/15 flex items-center justify-center">
          <X size={16} />
        </span>
      </button>
      <div className="flex-1 min-h-0">
        <ChatPanel
          dealerId={dealerId}
          applicationId={applicationId}
          identity={identity}
          emptyLabel="No messages on this application yet."
        />
      </div>
    </div>
  );
}
