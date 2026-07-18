// src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { FileText, CalendarCheck, CalendarClock, FileEdit, Clock, CheckCircle2, Users, UserCheck } from "lucide-react";

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

export default function Dashboard() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("dashboard_counts").select("*").maybeSingle();
      setCounts(data);
    })();
  }, []);

  const tiles = counts
    ? [
        { key: "total_applications", label: "Total Applications", value: counts.total_applications },
        { key: "today_applications", label: "Today's Applications", value: counts.today_applications },
        { key: "yesterday_applications", label: "Yesterday's Applications", value: counts.yesterday_applications },
        { key: "draft_applications", label: "Draft Applications", value: counts.draft_applications },
        { key: "pending_applications", label: "Pending (Review/Hold)", value: counts.pending_applications },
        { key: "completed_applications", label: "Completed / Accepted", value: counts.completed_applications },
        { key: "total_dealers", label: "Total Dealers", value: counts.total_dealers },
        { key: "active_dealers", label: "Active Dealers", value: counts.active_dealers },
      ]
    : [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1">Dashboard</h2>
      <p className="text-slate-400 dark:text-slate-500 mb-6">Live snapshot of office activity</p>
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
    </div>
  );
}
