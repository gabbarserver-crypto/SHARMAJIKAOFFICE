// src/pages/Reports.jsx
import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, Input, PrimaryButton } from "../components/UI";

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function Reports() {
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(today());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_profit_summary", { p_start: start, p_end: end });
    setLoading(false);
    if (!error && data?.[0]) setSummary(data[0]);
  };

  const rows = summary
    ? [
        { label: "Total Collection", value: summary.total_collection, color: "text-slate-800" },
        { label: "Government Fee Paid", value: -summary.govt_fee_paid, color: "text-rose-600" },
        { label: "Agency Paid", value: -summary.agency_paid, color: "text-rose-600" },
        { label: "Expenses", value: -summary.total_expenses, color: "text-rose-600" },
        { label: "Net Profit", value: summary.net_profit, color: "text-emerald-600", bold: true },
      ]
    : [];

  return (
    <div>
      <Card title="Profit Report" className="mb-5">
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <Field label="From">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <PrimaryButton onClick={run} disabled={loading} className="mb-4">
            {loading ? "Loading..." : "Run Report"}
          </PrimaryButton>
        </div>
      </Card>

      {summary && (
        <Card title={`Summary: ${start} to ${end}`}>
          {rows.map((r) => (
            <div key={r.label} className={`flex justify-between py-2.5 ${r.bold ? "border-t border-slate-200 mt-2 pt-3" : "border-b border-slate-100"}`}>
              <span className={`text-sm ${r.bold ? "font-bold text-slate-800" : "text-slate-600"}`}>{r.label}</span>
              <span className={`text-sm font-semibold ${r.color}`}>
                {r.value < 0 ? "-" : ""}₹{Math.abs(Number(r.value)).toLocaleString("en-IN")}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
