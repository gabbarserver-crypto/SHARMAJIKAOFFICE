// src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { FileText, CalendarCheck, CalendarClock, FileEdit, Clock, CheckCircle2, Users, UserCheck, Download, Smartphone, CreditCard, BarChart2, Settings as SettingsIcon, LayoutGrid } from "lucide-react";
import { BOTTOM_TAB_KEYS } from "../components/BottomTabBar";

// Icons for whichever nav items land in the mobile-only overflow row below
// (see Dashboard()'s OVERFLOW_KEYS) — anything not already in the bottom
// tab bar. Dealer/Agency are excluded on purpose (same reasoning as
// BottomTabBar.jsx: Ledger already covers both).
const OVERFLOW_ICONS = { payments: CreditCard, reports: BarChart2, settings: SettingsIcon };

// Bump this when you replace public/downloads/sjo-app.apk with a new build
// so the version number on the dashboard stays in sync.
const APP_VERSION = "1.0.0";
const APK_PATH = "/downloads/sjo-app.apk";

// Each tile gets its own solid color fill (point 16) instead of a plain
// white card with just the number colored — makes the dashboard scannable
// at a glance rather than needing to read every label.
const TILE_STYLES = {
  total_applications:     { icon: FileText,      classes: "bg-blue-600" },
  today_applications:     { icon: CalendarCheck,  classes: "bg-emerald-600" },
  yesterday_applications: { icon: CalendarClock,  classes: "bg-slate-600" },
  draft_applications:     { icon: FileEdit,       classes: "bg-amber-500" },
  pending_applications:   { icon: Clock,          classes: "bg-orange-600" },
  completed_applications: { icon: CheckCircle2,   classes: "bg-green-600" },
  total_dealers:          { icon: Users,          classes: "bg-indigo-600" },
  active_dealers:         { icon: UserCheck,      classes: "bg-teal-600" },
};

export default function Dashboard({ visibleNav = [], onNavigate, active }) {
  const [counts, setCounts] = useState(null);
  const [balances, setBalances] = useState({ dealer_total: null, agency_total: null });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("dashboard_counts").select("*").maybeSingle();
      setCounts(data);
    })();
    (async () => {
      const [{ data: dealerSummaries }, { data: agencySummaries }] = await Promise.all([
        supabase.from("dealer_ledger_summary").select("running_balance"),
        supabase.from("agency_ledger_summary").select("running_balance"),
      ]);
      setBalances({
        dealer_total: (dealerSummaries || []).reduce((acc, s) => acc + Number(s.running_balance || 0), 0),
        agency_total: (agencySummaries || []).reduce((acc, s) => acc + Number(s.running_balance || 0), 0),
      });
    })();
  }, []);

  const tiles = counts
    ? [
        { key: "total_applications", label: "Total Applications", value: counts.total_applications },
        { key: "today_applications", label: "Today's Applications", value: counts.today_applications },
        { key: "yesterday_applications", label: "Yesterday's Applications", value: counts.yesterday_applications },
        { key: "draft_applications", label: "Draft Applications", value: counts.draft_applications },
        { key: "pending_applications", label: "Pending (Review/Hold)", value: counts.pending_applications },
        { key: "completed_applications", label: "Accepted", value: counts.completed_applications },
        { key: "total_dealers", label: "Total Dealers", value: counts.total_dealers },
        { key: "active_dealers", label: "Active Dealers", value: counts.active_dealers },
      ]
    : [];

  // Everything visible to this role that ISN'T already in the bottom tab
  // bar (see BottomTabBar.jsx) — Dealer/Agency are filtered out here too,
  // same reasoning: Ledger already covers both, no need for their own
  // shortcut. Mobile-only; on tablet/desktop the sidebar already lists
  // every section, so this row would just be redundant there.
  const overflowNav = visibleNav.filter(
    (n) => !BOTTOM_TAB_KEYS.includes(n.key) && n.key !== "dealerLedger" && n.key !== "agencyLedger"
  );

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1">Dashboard</h2>
      <p className="text-slate-400 dark:text-slate-500 mb-6">Live snapshot of office activity</p>

      {overflowNav.length > 0 && onNavigate && (
        <div className="md:hidden flex gap-2 overflow-x-auto pb-1 mb-5 -mx-1 px-1">
          {overflowNav.map((n) => {
            const Icon = OVERFLOW_ICONS[n.key] || LayoutGrid;
            const isActive = active === n.key;
            return (
              <button
                key={n.key}
                onClick={() => onNavigate(n.key)}
                className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold border ${
                  isActive
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                <Icon size={15} />
                {n.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => {
          const style = TILE_STYLES[t.key] || { icon: FileText, classes: "bg-slate-600" };
          const Icon = style.icon;
          return (
            <div key={t.key} className={`${style.classes} rounded-2xl p-5 text-white shadow-sm relative overflow-hidden`}>
              <Icon size={22} className="opacity-80 mb-3" />
              <p className="text-3xl font-bold leading-none">{t.value ?? "—"}</p>
              <p className="text-sm opacity-90 mt-2">{t.label}</p>
              <Icon size={90} className="absolute -right-4 -bottom-4 opacity-10" />
            </div>
          );
        })}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
          <p className="text-xs text-slate-400 dark:text-slate-500">Total Dealer Balance</p>
          <p className={`text-2xl font-bold mt-1 ${Number(balances.dealer_total) < 0 ? "text-rose-600" : "text-slate-800 dark:text-slate-100"}`}>
            {balances.dealer_total === null ? "—" : `₹${balances.dealer_total.toLocaleString("en-IN")}`}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
          <p className="text-xs text-slate-400 dark:text-slate-500">Total Agency Balance</p>
          <p className={`text-2xl font-bold mt-1 ${Number(balances.agency_total) < 0 ? "text-rose-600" : "text-slate-800 dark:text-slate-100"}`}>
            {balances.agency_total === null ? "—" : `₹${balances.agency_total.toLocaleString("en-IN")}`}
          </p>
        </div>
      </div>

      <div className="mt-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 dark:bg-slate-700 text-white rounded-xl p-3">
            <Smartphone size={22} />
          </div>
          <div>
            <p className="font-semibold text-slate-800 dark:text-slate-100">Android App</p>
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Version {APP_VERSION} · Direct APK install (not on Play Store)
            </p>
          </div>
        </div>
        <a
          href={APK_PATH}
          download
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
        >
          <Download size={16} />
          Download App
        </a>
      </div>
    </div>
  );
}
