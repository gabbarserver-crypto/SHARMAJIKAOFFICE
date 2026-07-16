import React, { useState } from "react";
import { useDarkMode } from "../lib/theme";
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

function LogoMark({ dark }) {
  const dots = [
    [10, 6, 2.2], [16, 5, 1.6], [21, 9, 1.8],
    [7, 12, 1.6], [13, 12, 2.4], [19, 14, 1.6],
    [9, 18, 1.8], [15, 19, 2], [21, 20, 1.4],
  ];
  return (
    <svg width="20" height="20" viewBox="0 0 28 28">
      {dots.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} className={dark ? "fill-cyan-400" : "fill-cyan-500"} />
      ))}
    </svg>
  );
}

function NavItem({ icon: Icon, label, active, collapsed, dark, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={[
        "group relative w-full flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
        active
          ? dark
            ? "bg-slate-800 text-white"
            : "bg-blue-50 text-blue-700"
          : dark
          ? "text-slate-300 hover:bg-slate-800"
          : "text-slate-600 hover:bg-slate-50",
      ].join(" ")}
    >
      <span className="relative shrink-0">
        <Icon size={18} strokeWidth={1.75} className={active ? (dark ? "text-cyan-400" : "text-blue-600") : dark ? "text-slate-400" : "text-slate-500"} />
        {collapsed && badge > 0 && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500" />
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

function SectionLabel({ children, collapsed, dark }) {
  if (collapsed) return <div className="h-4" />;
  return (
    <p className={`px-2.5 text-xs font-semibold tracking-wider uppercase mb-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
      {children}
    </p>
  );
}

// nav: [{ key, label }] — Menu section. staff: { full_name } | null.
export default function Sidebar({ nav, active, onNavigate, staff, badges = {}, onLogout }) {
  const [collapsed, setCollapsed] = useState(false);
  const [dark, toggleDark] = useDarkMode();

  const panelBg = dark ? "bg-slate-900" : "bg-white";
  const panelBorder = dark ? "border-slate-800" : "border-slate-200";

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
        "shrink-0 h-screen sticky top-0 flex flex-col border-r shadow-sm transition-all duration-300",
        collapsed ? "w-20" : "w-64",
        panelBg,
        panelBorder,
      ].join(" ")}
    >
      {/* Header */}
      <div className={`flex items-center gap-2.5 px-4 py-4 border-b ${panelBorder}`}>
        <div
          className={[
            "w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center",
            dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white",
          ].join(" ")}
        >
          <LogoMark dark={dark} />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold truncate ${dark ? "text-white" : "text-slate-800"}`}>Sharma Ji Ka Office</p>
            <p className={`text-xs truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>RTO Services ERP</p>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            className={`shrink-0 p-1 rounded-md ${dark ? "text-slate-500 hover:bg-slate-800" : "text-slate-400 hover:bg-slate-100"}`}
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          className={`mx-auto mt-3 p-1 rounded-md ${dark ? "text-slate-500 hover:bg-slate-800" : "text-slate-400 hover:bg-slate-100"}`}
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* Nav */}
      <div className="flex-1 px-3 py-4 overflow-y-auto">
        <SectionLabel collapsed={collapsed} dark={dark}>Menu</SectionLabel>
        <nav className="space-y-1">
          {nav.map((item) => (
            <NavItem
              key={item.key}
              icon={ICONS[item.key] || LayoutGrid}
              label={item.label}
              active={active === item.key}
              collapsed={collapsed}
              dark={dark}
              badge={badges[item.key] || 0}
              onClick={() => onNavigate(item.key)}
            />
          ))}
        </nav>
      </div>

      {/* Theme toggle */}
      <div className={`px-4 py-3 flex items-center border-t ${panelBorder} ${collapsed ? "justify-center" : "gap-2.5"}`}>
        <Sun size={14} className={dark ? "text-slate-600" : "text-slate-400"} />
        <button
          onClick={toggleDark}
          aria-label="Toggle dark mode"
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${dark ? "bg-slate-700" : "bg-slate-200"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
              dark ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        {!collapsed && <Moon size={14} className={dark ? "text-slate-300" : "text-slate-400"} />}
      </div>

      {/* Profile */}
      <div className={`flex items-center gap-2.5 px-4 py-4 border-t ${panelBorder}`}>
        <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-indigo-200 to-purple-300 flex items-center justify-center text-xs font-semibold text-indigo-700">
          {initials}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold truncate ${dark ? "text-white" : "text-slate-800"}`}>{staff?.full_name || "Signed in"}</p>
            <button onClick={onLogout} className={`text-xs font-semibold ${dark ? "text-slate-500 hover:text-white" : "text-slate-400 hover:text-slate-700"}`}>
              Logout
            </button>
          </div>
        )}
        {collapsed && (
          <button onClick={onLogout} title="Logout" className={`shrink-0 ${dark ? "text-slate-500 hover:text-white" : "text-slate-400 hover:text-slate-700"}`}>
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
