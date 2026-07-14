// src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "../components/UI";

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
        { label: "Total Applications", value: counts.total_applications },
        { label: "Today's Applications", value: counts.today_applications },
        { label: "Yesterday's Applications", value: counts.yesterday_applications },
        { label: "Draft Applications", value: counts.draft_applications },
        { label: "Pending (Review/Hold)", value: counts.pending_applications },
        { label: "Completed / Accepted", value: counts.completed_applications },
        { label: "Total Dealers", value: counts.total_dealers },
        { label: "Active Dealers", value: counts.active_dealers },
      ]
    : [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-1">Dashboard</h2>
      <p className="text-slate-400 mb-6">Live snapshot of office activity</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <p className="text-2xl font-bold text-slate-800">{t.value ?? "—"}</p>
            <p className="text-sm text-slate-500 mt-1">{t.label}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
