// src/pages/Ledger.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Select, Field } from "../components/UI";

export default function Ledger() {
  const [mode, setMode] = useState("dealer");
  const [dealers, setDealers] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [entityId, setEntityId] = useState("");
  const [summary, setSummary] = useState(null);
  const [txns, setTxns] = useState([]);

  useEffect(() => {
    (async () => {
      const { data: d } = await supabase.from("dealers").select("id, name, code");
      setDealers(d || []);
      const { data: a } = await supabase.from("agencies").select("id, name, code");
      setAgencies(a || []);
    })();
  }, []);

  useEffect(() => {
    setEntityId("");
    setSummary(null);
    setTxns([]);
  }, [mode]);

  useEffect(() => {
    (async () => {
      if (!entityId) return;
      if (mode === "dealer") {
        const { data: s } = await supabase.from("dealer_ledger_summary").select("*").eq("dealer_id", entityId).maybeSingle();
        setSummary(s);
        const { data: t } = await supabase.from("ledger_transactions").select("*").eq("dealer_id", entityId).order("created_at", { ascending: false });
        setTxns(t || []);
      } else {
        const { data: s } = await supabase.from("agency_ledger_summary").select("*").eq("agency_id", entityId).maybeSingle();
        setSummary(s);
        const { data: t } = await supabase.from("agency_ledger_transactions").select("*").eq("agency_id", entityId).order("created_at", { ascending: false });
        setTxns(t || []);
      }
    })();
  }, [entityId, mode]);

  const list = mode === "dealer" ? dealers : agencies;

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {["dealer", "agency"].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
              mode === m ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"
            }`}
          >
            {m === "dealer" ? "Dealer Ledger" : "Agency Ledger"}
          </button>
        ))}
      </div>

      <Card className="mb-5">
        <Field label={mode === "dealer" ? "Select Dealer" : "Select Agency"}>
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">— Choose —</option>
            {list.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.code})</option>)}
          </Select>
        </Field>
      </Card>

      {summary && (
        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <Card>
            <p className="text-xs text-slate-400">Running Balance</p>
            <p className="text-xl font-bold text-slate-800 mt-1">₹{Number(summary.running_balance || 0).toLocaleString("en-IN")}</p>
          </Card>
          {mode === "dealer" && (
            <>
              <Card>
                <p className="text-xs text-slate-400">Credit Limit</p>
                <p className="text-xl font-bold text-slate-800 mt-1">₹{Number(summary.credit_limit || 0).toLocaleString("en-IN")}</p>
              </Card>
              <Card>
                <p className="text-xs text-slate-400">Available Limit</p>
                <p className="text-xl font-bold text-emerald-600 mt-1">₹{Number(summary.available_limit || 0).toLocaleString("en-IN")}</p>
              </Card>
            </>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left font-medium px-4 py-3">Date</th>
              <th className="text-left font-medium px-4 py-3">Voucher No.</th>
              <th className="text-left font-medium px-4 py-3">Description</th>
              <th className="text-right font-medium px-4 py-3">Debit</th>
              <th className="text-right font-medium px-4 py-3">Credit</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-slate-500">{t.voucher_no}</td>
                <td className="px-4 py-3 text-slate-700">{t.description}</td>
                <td className="px-4 py-3 text-right text-rose-600">{t.type === "debit" ? `₹${Number(t.amount).toLocaleString("en-IN")}` : ""}</td>
                <td className="px-4 py-3 text-right text-emerald-600">{t.type === "credit" ? `₹${Number(t.amount).toLocaleString("en-IN")}` : ""}</td>
              </tr>
            ))}
            {entityId && txns.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-8">No transactions yet</td></tr>
            )}
            {!entityId && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-8">Select a {mode} to view the ledger</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
