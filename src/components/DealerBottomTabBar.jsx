// src/components/DealerBottomTabBar.jsx
//
// Mobile-only bottom navigation bar for the Dealer Portal — the same
// pattern as the staff app's BottomTabBar.jsx, so a dealer switching
// between "Applications / Call-Chat / Ledger / Payments / Staff" on a
// phone gets one-tap icon buttons instead of the horizontal pill row
// (which still shows as-is on tablet/desktop, where there's room for it).
import React from "react";
import { FileOutput, MessageSquare, BookOpen, Receipt, Users, ClipboardList, ShieldCheck, LayoutDashboard } from "lucide-react";

const ICONS = {
  Dashboard: LayoutDashboard,
  Applications: FileOutput,
  "PCC Status": ShieldCheck,
  "Call/Chat": MessageSquare,
  Ledger: BookOpen,
  Service: ClipboardList,
  Payments: Receipt,
  Staff: Users,
};

export default function DealerBottomTabBar({ tabs, active, onNavigate, unreadChats = 0 }) {
  return (
    <nav
      className="no-print fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((t) => {
        const Icon = ICONS[t] || FileOutput;
        const isActive = active === t;
        const badge = t === "Call/Chat" ? unreadChats : 0;
        return (
          <button
            key={t}
            onClick={() => onNavigate(t)}
            className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-[10px] font-medium ${
              isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            <span className="relative">
              <Icon size={20} strokeWidth={isActive ? 2.3 : 1.9} />
              {badge > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            {t}
          </button>
        );
      })}
    </nav>
  );
}
