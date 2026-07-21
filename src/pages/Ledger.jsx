// src/pages/Ledger.jsx
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, GhostButton, PrimaryButton } from "../components/UI";
import { DealerForm, AgencyForm } from "./Masters";

// "Sundry Debtors" (dealers — they owe us) and "Sundry Creditors"
// (agencies — we owe/settle with them) sit here as the two ledger heads.
// Each lists every dealer/agency with its running balance; clicking the
// name or balance opens that entity's transaction ledger below. Add/Edit
// for dealers & agencies has moved in here too (reusing the same forms
// Masters used) so this page covers both "who do we owe/who owes us" and
// "manage the dealer/agency record" in one place.
export default function Ledger() {
  const [entityId, setEntityId] = useState("");
  const [entityMode, setEntityMode] = useState("dealer"); // "dealer" | "agency" — mode of the currently open ledger detail
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [txns, setTxns] = useState([]);

  const openLedger = (mode, id) => {
    setEntityMode(mode);
    setEntityId(id);
  };

  useEffect(() => {
    (async () => {
      if (!entityId) { setSummary(null); setTxns([]); return; }
      if (entityMode === "dealer") {
        const { data: s, error: sErr } = await supabase.from("dealer_ledger_summary").select("*").eq("dealer_id", entityId).maybeSingle();
        if (sErr) console.error("dealer_ledger_summary:", sErr);
        setSummary(s);
        setSummaryError(sErr?.message || null);
        const { data: t } = await supabase.from("ledger_transactions").select("*").eq("dealer_id", entityId).order("created_at", { ascending: false });
        setTxns(t || []);
      } else {
        const { data: s, error: sErr } = await supabase.from("agency_ledger_summary").select("*").eq("agency_id", entityId).maybeSingle();
        if (sErr) console.error("agency_ledger_summary:", sErr);
        setSummary(s);
        setSummaryError(sErr?.message || null);
        const { data: t } = await supabase.from("agency_ledger_transactions").select("*").eq("agency_id", entityId).order("created_at", { ascending: false });
        setTxns(t || []);
      }
    })();
  }, [entityId, entityMode]);

  // Running balance computed straight from the transactions we already
  // fetched, so it shows up even if the *_ledger_summary view returns no
  // row, errors out, or is blocked by RLS. Credit is money in (reduces what
  // they owe), debit is money out (increases what they owe) — matches how
  // entries are posted elsewhere in the app.
  const computedBalance = txns.reduce(
    (acc, t) => acc + (t.type === "credit" ? Number(t.amount || 0) : -Number(t.amount || 0)),
    0
  );
  const runningBalance = summary?.running_balance ?? computedBalance;

  return (
    <div>
      <SundryHead
        title="Sundry Debtors"
        subtitle="Dealers — amounts owed to us"
        entityMode="dealer"
        table="dealers"
        summaryTable="dealer_ledger_summary"
        summaryKey="dealer_id"
        Form={DealerForm}
        selectedId={entityMode === "dealer" ? entityId : null}
        onOpenLedger={(id) => openLedger("dealer", id)}
      />

      <SundryHead
        title="Sundry Creditors"
        subtitle="Agencies — amounts we owe / settle with them"
        entityMode="agency"
        table="agencies"
        summaryTable="agency_ledger_summary"
        summaryKey="agency_id"
        Form={AgencyForm}
        selectedId={entityMode === "agency" ? entityId : null}
        onOpenLedger={(id) => openLedger("agency", id)}
        className="mt-6"
      />

      {entityId && (
        <div className="mt-6">
          <div className="grid sm:grid-cols-3 gap-4 mb-5">
            <Card>
              <p className="text-xs text-slate-400 dark:text-slate-500">Running Balance</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1">₹{Number(runningBalance || 0).toLocaleString("en-IN")}</p>
              {summaryError && <p className="text-[11px] text-amber-600 mt-1">Computed from transactions — summary view error: {summaryError}</p>}
            </Card>
            {entityMode === "dealer" && summary && (
              <>
                <Card>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Credit Limit</p>
                  <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1">₹{Number(summary.credit_limit || 0).toLocaleString("en-IN")}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Available Limit</p>
                  <p className="text-xl font-bold text-emerald-600 mt-1">₹{Number(summary.available_limit || 0).toLocaleString("en-IN")}</p>
                </Card>
              </>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Date</th>
                  <th className="text-left font-medium px-3 py-2">Voucher No.</th>
                  <th className="text-left font-medium px-3 py-2">Description</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-500">{t.voucher_no}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{t.description}</td>
                    <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${t.type === "debit" ? "text-rose-600" : "text-emerald-600"}`}>
                      {t.type === "debit" ? "-" : "+"}₹{Number(t.amount).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
                {txns.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-slate-400 dark:text-slate-500 py-8">No transactions yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// One "head" — either Sundry Debtors (dealers) or Sundry Creditors
// (agencies): every record in that table, with just Name / Code / Active
// status / Balance, name & balance clickable into the ledger below, plus
// a New/Edit affordance (reusing the same forms Masters used) so this
// page can fully replace the Dealer/Agency tabs in Masters if you want to
// remove them there.
function SundryHead({ title, subtitle, entityMode, table, summaryTable, summaryKey, Form, selectedId, onOpenLedger, className = "" }) {
  const [rows, setRows] = useState([]);
  const [balances, setBalances] = useState({}); // id -> running_balance
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // row being edited, or null
  const [open, setOpen] = useState(false); // form modal open

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from(table).select("*").order("name");
    setRows(data || []);
    const { data: summaries } = await supabase.from(summaryTable).select("*");
    setBalances(Object.fromEntries((summaries || []).map((s) => [s[summaryKey], s.running_balance])));
    setLoading(false);
  }, [table, summaryTable, summaryKey]);

  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    const payload = entityMode === "dealer"
      ? {
          name: form.name, code: form.code, short_name: form.short_name || null, contact_name: form.contact_name, mobile: form.mobile, email: form.email,
          address: form.address, city: form.city, state: form.state, pincode: form.pincode,
          credit_limit: parseFloat(form.credit_limit) || 0,
        }
      : {
          name: form.name, code: form.code, contact_person: form.contact_person, mobile: form.mobile, status: form.status,
          opening_balance: parseFloat(form.opening_balance) || 0, default_processing_charges: parseFloat(form.default_processing_charges) || 0,
          payment_terms: form.payment_terms,
        };
    const { error } = editing
      ? await supabase.from(table).update(payload).eq("id", editing.id)
      : await supabase.from(table).insert(payload);
    if (error) { alert("Failed: " + error.message); return; }
    setOpen(false); setEditing(null); load();
  };

  // Dealers don't carry an explicit "active" flag — same computed
  // definition Masters uses: on hold once available credit runs out.
  // Agencies do have their own status field, so that's used as-is.
  const activeLabel = (row) => {
    if (entityMode === "agency") return row.status || "Active";
    const avail = balances[row.id];
    return avail !== undefined && Number(avail) <= 0 ? "On Hold" : "Active";
  };

  return (
    <Card
      title={
        <div className="flex items-center justify-between w-full">
          <div>
            <span>{title}</span>
            <span className="block text-xs font-normal text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</span>
          </div>
          <GhostButton onClick={() => { setEditing(null); setOpen(true); }}>+ New</GhostButton>
        </div>
      }
      className={className}
    >
      <div className="overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">Name</th>
              <th className="text-left font-medium px-3 py-2">Code</th>
              <th className="text-left font-medium px-3 py-2">Active</th>
              <th className="text-right font-medium px-3 py-2">Balance</th>
              <th className="text-right font-medium px-3 py-2">Edit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bal = balances[r.id];
              const isSelected = selectedId === r.id;
              return (
                <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 ${isSelected ? "bg-blue-50 dark:bg-blue-500/10" : ""}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => onOpenLedger(r.id)} className="text-blue-600 font-semibold hover:underline text-left">
                      {r.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500">{r.code}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                      activeLabel(r) === "Active"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-rose-50 text-rose-600 border-rose-200"
                    }`}>
                      {activeLabel(r)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => onOpenLedger(r.id)} className="text-blue-600 font-semibold hover:underline">
                      ₹{Number(bal || 0).toLocaleString("en-IN")}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => { setEditing(r); setOpen(true); }} className="text-xs font-semibold text-slate-500 hover:text-blue-600">
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 dark:text-slate-500 py-8">None yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {open && <Form initial={editing} onSave={save} onClose={() => setOpen(false)} />}
    </Card>
  );
}
