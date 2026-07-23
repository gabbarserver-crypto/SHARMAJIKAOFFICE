// src/components/NotificationToaster.jsx
//
// Renders whatever lib/notify.js's notify() fires, as a stack of dismissable
// toasts fixed to the top-right of the screen. Mounted once, near the top
// of App.jsx (both the staff and dealer branches), so it's visible no
// matter which page/tab is open.
import React, { useEffect, useState } from "react";
import { FileText, MessageCircle, Phone, X } from "lucide-react";
import { onNotify } from "../lib/notify";

const ICONS = { draft: FileText, chat: MessageCircle, call: Phone };
const ACCENTS = {
  draft: "border-l-amber-500",
  chat: "border-l-blue-500",
  call: "border-l-emerald-500",
};

const AUTO_DISMISS_MS = 6000;

export default function NotificationToaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => onNotify((t) => {
    setToasts((list) => [...list, t]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), AUTO_DISMISS_MS);
  }), []);

  const dismiss = (id) => setToasts((list) => list.filter((x) => x.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[998] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind] || MessageCircle;
        return (
          <div
            key={t.id}
            className={`bg-white dark:bg-slate-900 shadow-xl rounded-lg border border-slate-200 dark:border-slate-800 border-l-4 ${ACCENTS[t.kind] || ACCENTS.chat} px-3 py-2.5 flex items-start gap-2.5 cursor-pointer`}
            onClick={() => { t.onClick?.(); dismiss(t.id); }}
          >
            <Icon size={17} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <div className="min-w-0 flex-1">
              {t.title && <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{t.title}</p>}
              {t.body && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{t.body}</p>}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
              className="shrink-0 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
