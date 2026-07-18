import React, { useState } from "react";
import { useDarkMode } from "../lib/theme";
import logoMark from "../assets/sjo-icon-mark.png";
import {
  LayoutGrid,
  FileOutput,
  Database,
  CreditCard,
  BookOpen,
  BarChart2,
  Settings as SettingsIcon,
  MessageSquare,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Sun,
  Moon,
  Users,
} from "lucide-react";

// Maps each NAV key from App.jsx to an icon. Keep in sync if pages are added/removed.
const ICONS = {
  dashboard: LayoutGrid,
  applications: FileOutput,
  staffApplications: Users,
  chats: MessageSquare,
  masters: Database,
  payments: CreditCard,
  ledger: BookOpen,
  reports: BarChart2,
  settings: SettingsIcon,
};

// Violet/purple theme + rounded "active pill" treatment (point 15), inspired
// by a floating icon-only mobile sidebar reference. Kept the existing
// labels/badges/collapse functionality rather than going fully icon-only —
// losing the chat-unread badges and page labels would hurt usability more
// than the visual match is worth. Collapsing the sidebar (chevron button)
// already gets you an icon-only rail close to that reference.
function NavItem({ icon: Icon, label, active, collapsed, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={[
        "group relative w-full flex items-center rounded-full py-2.5 text-sm font-medium transition-colors",
        collapsed ? "justify-center px-0" : "gap-2.5 px-3.5",
        active ? "bg-white text-violet-700 shadow-sm" : "text-violet-100 hover:bg-white/10",
      ].join(" ")}
    >
      <span className="relative shrink-0">
        <Icon size={18} strokeWidth={1.9} className={active ? "text-violet-600" : "text-violet-200"} />
        {collapsed && badge > 0 && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-400" />
        )}
      </span>
      {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
      {!collapsed && badge > 0 && (
        <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-semibold flex items-center justify-center">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function SectionLabel({ children, collapsed }) {
  if (collapsed) return <div className="h-4" />;
  return (
    <p className="px-3.5 text-xs font-semibold tracking-wider uppercase mb-2 text-violet-300">
      {children}
    </p>
  );
}

// nav: [{ key, label }] — Menu section. staff: { full_name } | null.
export default function Sidebar({ nav, active, onNavigate, staff, badges = {}, onLogout }) {
  const [collapsed, setCollapsed] = useState(false);
  const [dark, toggleDark] = useDarkMode();

  const initials = (staff?.full_name || "?")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside
      className={[
        "shrink-0 h-screen sticky top-0 flex flex-col m-3 rounded-3xl shadow-lg transition-all duration-300",
        "bg-gradient-to-b from-violet-600 to-purple-700",
        collapsed ? "w-20" : "w-64",
      ].join(" ")}
      style={{ height: "calc(100vh - 1.5rem)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/15">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-white flex items-center justify-center overflow-hidden">
          <img src={logoMark} alt="SJO" className="w-8 h-8 object-contain" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-white">Sharma Ji Ka Office</p>
            <p className="text-xs truncate text-violet-200">RTO Services ERP</p>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            className="shrink-0 p-1 rounded-md text-violet-200 hover:bg-white/10"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          className="mx-auto mt-3 p-1 rounded-md text-violet-200 hover:bg-white/10"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* Nav */}
      <div className="flex-1 px-3 py-4 overflow-y-auto">
        <SectionLabel collapsed={collapsed}>Menu</SectionLabel>
        <nav className="space-y-1">
          {nav.map((item) => (
            <NavItem
              key={item.key}
              icon={ICONS[item.key] || LayoutGrid}
              label={item.label}
              active={active === item.key}
              collapsed={collapsed}
              badge={badges[item.key] || 0}
              onClick={() => onNavigate(item.key)}
            />
          ))}
        </nav>
      </div>

      {/* Theme toggle */}
      <div className={`px-4 py-3 flex items-center border-t border-white/15 ${collapsed ? "justify-center" : "gap-2.5"}`}>
        <Sun size={14} className="text-violet-200" />
        <button
          onClick={toggleDark}
          aria-label="Toggle dark mode"
          className="relative w-9 h-5 rounded-full transition-colors shrink-0 bg-white/20"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
              dark ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        {!collapsed && <Moon size={14} className="text-violet-200" />}
      </div>

      {/* Profile */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-t border-white/15">
        <div className="w-9 h-9 shrink-0 rounded-full bg-white flex items-center justify-center text-xs font-semibold text-violet-700">
          {initials}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate text-white">{staff?.full_name || "Signed in"}</p>
            <button onClick={onLogout} className="text-xs font-semibold text-violet-200 hover:text-white">
              Logout
            </button>
          </div>
        )}
        {collapsed && (
          <button onClick={onLogout} title="Logout" className="shrink-0 text-violet-200 hover:text-white">
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
