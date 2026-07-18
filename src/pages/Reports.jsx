// src/pages/Reports.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, Input, Select, PrimaryButton } from "../components/UI";

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function serviceLabel(s) {
  if (!s) return "";
  return s.short_name || `${s.parent_service}${s.sub_service ? ` — ${s.sub_service}` : ""}`;
}
function dealerLabel(d) {
  if (!d) return "";
  return d.short_name || d.name;
}

export default function Reports() {
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(today());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  // Single-service report (point 20) — pick one service, see every
  // application for it with Customer Name, Dealer, and Remark.
  const [serviceList, setServiceList] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [serviceRows, setServiceRows] = useState([]);
  const [serviceLoading, setServiceLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("services").select("id, parent_service, sub_service, short_name").order("parent_service");
      setServiceList(data || []);
    })();
  }, []);

  const runServiceReport = async () => {
    if (!serviceId) return;
    setServiceLoading(true);
    const { data } = await supabase
      .from("applications")
      .select("id, applicant_name, remarks, status, submitted_at, dealers(name, short_name)")
      .eq("service_id", serviceId)
      .order("submitted_at", { ascending: false });
    setServiceRows(data || []);
    setServiceLoading(false);
  };

  const run = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_profit_summary", { p_start: start, p_end: end });
    setLoading(false);
    if (!error && data?.[0]) setSummary(data[0]);
  };

  const rows = summary
    ? [
        { label: "Total Collection", value: summary.total_collection, color: "text-slate-800 dark:text-slate-100" },
        { label: "Government Fee Paid", value: -summary.govt_fee_paid, color: "text-rose-600" },
        { label: "Agency Paid", value: -summary.agency_paid, color: "text-rose-600" },
        { label: "Expenses", value: -summary.total_expenses, color: "text-rose-600" },
        { label: "Net Profit", value: summary.net_profit, color: "text-emerald-600", bold: true },
      ]
    : [];

  return (
    <div>
      <Card title="Service Report" className="mb-5">
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <Field label="Service">
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Select a service</option>
              {serviceList.map((s) => <option key={s.id} value={s.id}>{serviceLabel(s)}</option>)}
            </Select>
          </Field>
          <PrimaryButton onClick={runServiceReport} disabled={!serviceId || serviceLoading} className="mb-4">
            {serviceLoading ? "Loading..." : "Run Report"}
          </PrimaryButton>
        </div>

        {serviceRows.length > 0 && (
          <div className="mt-4 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Customer Name</th>
                  <th className="text-left font-medium px-3 py-2">Dealer</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Remark</th>
                </tr>
              </thead>
              <tbody>
                {serviceRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{r.applicant_name}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{dealerLabel(r.dealers)}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.status}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {serviceId && !serviceLoading && serviceRows.length === 0 && (
          <p className="text-sm text-slate-400 mt-3">No applications yet for this service.</p>
        )}
      </Card>

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
            <div key={r.label} className={`flex justify-between py-2.5 ${r.bold ? "border-t border-slate-200 dark:border-slate-800 mt-2 pt-3" : "border-b border-slate-100 dark:border-slate-800"}`}>
              <span className={`text-sm ${r.bold ? "font-bold text-slate-800 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"}`}>{r.label}</span>
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
