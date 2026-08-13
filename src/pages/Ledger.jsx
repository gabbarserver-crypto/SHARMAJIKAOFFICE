// src/pages/Ledger.jsx
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, GhostButton, PrimaryButton, Modal } from "../components/UI";
import { DealerForm, AgencyForm } from "./Masters";

// Tailwind classes per ledger_type, purely cosmetic grouping — payments in
// green, PCC in blue, anything else (service names like LL RIC, MCWG...)
// neutral.
function txnTypeClass(typeLabel) {
  if (!typeLabel) return "text-slate-400 dark:text-slate-500";
  if (typeLabel === "PAYMENT") return "text-emerald-600 dark:text-emerald-400 font-semibold";
  if (typeLabel === "PCC") return "text-sky-600 dark:text-sky-400 font-semibold";
  return "text-slate-600 dark:text-slate-300 font-semibold";
}

// Builds a CSV of the given ledger rows and triggers a browser download —
// entirely client-side, matching how the rest of the app's CSV export/import
// works (see lib/csv.js).
function exportLedgerCSV(entityName, rows) {
  const escapeCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Date", "Entry Code", "Type", "Name", "Debit", "Credit", "Running Balance"];
  const lines = [header.join(",")];
  rows.forEach((r) => {
    lines.push([
      escapeCsv(new Date(r.entry_date).toLocaleDateString()),
      escapeCsv(r.entry_code),
      escapeCsv(r.ledger_type),
      escapeCsv(r.display_name),
      escapeCsv(r.debit > 0 ? r.debit : ""),
      escapeCsv(r.credit > 0 ? r.credit : ""),
      escapeCsv(r.running_balance),
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(entityName || "ledger").replace(/[^a-z0-9]+/gi, "-")}-ledger.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// "Dealer" (they owe us) and "Agency" (we owe/settle with them) sit here
// as the two ledger heads. Each lists every dealer/agency with its running
// balance; clicking the name or balance opens that entity's transaction
// ledger below. Add/Edit for dealers & agencies lives here too (reusing the
// same forms Masters used to use) — Masters no longer has Dealer/Agency
// tabs, this page is now the only place to manage them.
//
// Backed by ledger_entries (one row per SERVICE or PAYMENT — no more
// double-entry pairs, no more type/name buried in free text) via the
// dealer_ledger / agency_ledger views, which already compute debit,
// credit, and running_balance server-side.
export default function Ledger({ only, initialEntityId, isAdmin = false } = {}) {
  const [entityId, setEntityId] = useState(initialEntityId || "");
  const [entityMode, setEntityMode] = useState(only === "agency" ? "agency" : "dealer"); // "dealer" | "agency"
  const [summary, setSummary] = useState(null); // { credit_limit } for dealer mode, fetched from dealers table directly
  const [rows, setRowsState] = useState([]); // ledger rows for the open entity, from dealer_ledger / agency_ledger
  const [loadError, setLoadError] = useState(null);
  const [entityName, setEntityName] = useState("");
  const [sortKey, setSortKey] = useState("entry_date");
  const [sortDir, setSortDir] = useState("desc"); // newest first by default
  const [periodFrom, setPeriodFrom] = useState(""); // yyyy-mm-dd, empty = no lower bound
  const [periodTo, setPeriodTo] = useState(""); // yyyy-mm-dd, empty = no upper bound
  const [appDetail, setAppDetail] = useState(null); // application row shown in the row-click modal
  const [appDetailLoading, setAppDetailLoading] = useState(false);
  const [appDetailError, setAppDetailError] = useState("");
  const [appDetailRow, setAppDetailRow] = useState(null); // the ledger_entries row that was clicked
  const [editAmount, setEditAmount] = useState(""); // draft value while editing the Amount field in the modal
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountSaveError, setAmountSaveError] = useState("");

  // Clicking a SERVICE row's name looks the application up by entry_code
  // (== application_no for rows created from a real application) so staff
  // don't have to leave the ledger to see what a line item was for.
  // PAYMENT rows have no application behind them, so they're not clickable.
  const openAppDetail = useCallback(async (row) => {
    if (row.entry_type !== "SERVICE") return;
    setAppDetailLoading(true);
    setAppDetailError("");
    setAmountSaveError("");
    setAppDetail(null);
    setAppDetailRow(row);
    const { data, error } = await supabase
      .from("applications")
      .select("*, dealers(name,code,short_name), services(parent_service,short_name), staff:assigned_staff_id(full_name)")
      .eq("application_no", row.entry_code)
      .maybeSingle();
    setAppDetailLoading(false);
    if (error || !data) {
      setAppDetailError(`No application found for App No: ${row.entry_code}`);
      return;
    }
    setAppDetail(data);
    setEditAmount(String(row.debit || data.amount || ""));
  }, []);

  // Saves the edited Amount into both ledger_entries and the linked
  // application's own amount field, atomically, via a single Postgres
  // function (see 005_summary_views_and_rpc.sql) — so either both land or
  // neither does, and the ledger + application amount can never go out of
  // sync from a half-completed save.
  const saveAmount = useCallback(async () => {
    if (!appDetailRow || !appDetail) return;
    const newAmount = Number(editAmount);
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      setAmountSaveError("Enter a valid amount");
      return;
    }
    setSavingAmount(true);
    setAmountSaveError("");
    const { error: rpcErr } = await supabase.rpc("update_ledger_entry_amount", {
      p_entry_id: appDetailRow.id,
      p_application_id: appDetail.id,
      p_new_amount: newAmount,
    });
    setSavingAmount(false);
    if (rpcErr) {
      setAmountSaveError(rpcErr.message);
      return;
    }
    // Reflect the new amount locally so the ledger table + running balance
    // recompute without a full refetch of everything.
    setRowsState((prev) =>
      prev.map((r) => (r.id === appDetailRow.id ? { ...r, debit: newAmount } : r))
    );
    setAppDetailRow((r) => ({ ...r, debit: newAmount }));
    setAppDetail((a) => ({ ...a, amount: newAmount }));
  }, [appDetailRow, appDetail, editAmount]);

  // Admin-only: removes a single ledger entry outright — for correcting
  // mistakes like a duplicate row, without touching the application/payment
  // it came from.
  const [deletingRowId, setDeletingRowId] = useState(null);
  const deleteRow = useCallback(async (row) => {
    const amt = row.debit > 0 ? row.debit : row.credit;
    if (!window.confirm(`Delete this ${row.ledger_type} entry of ₹${Number(amt).toLocaleString("en-IN")} (${row.entry_code})? This cannot be undone.`)) return;
    setDeletingRowId(row.id);
    const { error } = await supabase.from("ledger_entries").delete().eq("id", row.id);
    setDeletingRowId(null);
    if (error) {
      alert("Failed to delete: " + error.message);
      return;
    }
    setRowsState((prev) => prev.filter((r) => r.id !== row.id));
  }, []);

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "entry_date") { av = new Date(av); bv = new Date(bv); }
      if (sortKey === "debit" || sortKey === "credit" || sortKey === "running_balance") { av = Number(av || 0); bv = Number(bv || 0); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "entry_date" ? "desc" : "asc"); }
  };
  const ledgerDetailRef = useRef(null);

  const openLedger = (mode, id, name) => {
    setEntityMode(mode);
    setEntityId(id);
    if (name) setEntityName(name);
  };

  // Clicking a name/balance should feel like being taken straight to that
  // entity's transactions — scroll there instead of leaving the person to
  // notice the section changed further down the page.
  useEffect(() => {
    if (entityId) ledgerDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [entityId, entityMode]);

  useEffect(() => {
    (async () => {
      if (!entityId) { setSummary(null); setRowsState([]); return; }
      if (entityMode === "dealer") {
        const { data: dealerRow } = await supabase.from("dealers").select("name, credit_limit").eq("id", entityId).maybeSingle();
        if (dealerRow?.name) setEntityName(dealerRow.name);
        setSummary(dealerRow);
        const { data: r, error: rErr } = await supabase
          .from("dealer_ledger")
          .select("*")
          .eq("dealer_id", entityId)
          .order("entry_date", { ascending: false });
        setLoadError(rErr?.message || null);
        setRowsState(r || []);
      } else {
        const { data: agencyRow } = await supabase.from("agencies").select("name").eq("id", entityId).maybeSingle();
        if (agencyRow?.name) setEntityName(agencyRow.name);
        setSummary(null);
        const { data: r, error: rErr } = await supabase
          .from("agency_ledger")
          .select("*")
          .eq("agency_id", entityId)
          .order("entry_date", { ascending: false });
        setLoadError(rErr?.message || null);
        setRowsState(r || []);
      }
    })();
  }, [entityId, entityMode]);

  // running_balance is already computed server-side by the view (walked
  // chronologically by entry_date/created_at), so the latest row — however
  // the table is currently sorted for display — always carries the correct
  // final balance.
  const runningBalance = useMemo(() => {
    if (!rows.length) return 0;
    return rows.reduce((latest, r) => {
      const d = new Date(r.entry_date);
      return !latest || d >= latest.d ? { d, val: Number(r.running_balance || 0) } : latest;
    }, null)?.val ?? 0;
  }, [rows]);

  // Available Limit = Credit Limit + Running Balance. Running balance is
  // negative when the dealer owes money and positive when they're in
  // credit, so adding it (not subtracting it) correctly shrinks the
  // available limit as debt grows and grows it when they're prepaid.
  const availableLimit = Number(summary?.credit_limit || 0) + Number(runningBalance || 0);

  // Rows within the selected date range (inclusive).
  const periodRows = useMemo(() => {
    if (!periodFrom && !periodTo) return sortedRows;
    const from = periodFrom ? new Date(periodFrom + "T00:00:00") : null;
    const to = periodTo ? new Date(periodTo + "T23:59:59") : null;
    return sortedRows.filter((r) => {
      const d = new Date(r.entry_date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [sortedRows, periodFrom, periodTo]);

  const periodTotals = useMemo(
    () =>
      periodRows.reduce(
        (acc, r) => {
          acc.debit += Number(r.debit || 0);
          acc.credit += Number(r.credit || 0);
          return acc;
        },
        { debit: 0, credit: 0 }
      ),
    [periodRows]
  );

  return (
    <div>
      {!only && (
        <div className="no-print flex gap-2 mb-4">
          <button
            onClick={() => setEntityMode("dealer")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${
              entityMode === "dealer" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            }`}
          >
            Dealer
          </button>
          <button
            onClick={() => setEntityMode("agency")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${
              entityMode === "agency" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            }`}
          >
            Agency
          </button>
        </div>
      )}

      {(only === "dealer" || (!only && entityMode === "dealer")) && (
        <SundryHead
          title="Dealer"
          subtitle="Dealers — amounts owed to us"
          entityMode="dealer"
          table="dealers"
          balancesTable="dealer_ledger_balances"
          balancesKey="dealer_id"
          Form={DealerForm}
          selectedId={entityMode === "dealer" ? entityId : null}
          onOpenLedger={(id, name) => openLedger("dealer", id, name)}
          className="no-print"
        />
      )}

      {(only === "agency" || (!only && entityMode === "agency")) && (
        <SundryHead
          title="Agency"
          subtitle="Agencies — amounts we owe / settle with them"
          entityMode="agency"
          table="agencies"
          balancesTable="agency_ledger_balances"
          balancesKey="agency_id"
          Form={AgencyForm}
          selectedId={entityMode === "agency" ? entityId : null}
          onOpenLedger={(id, name) => openLedger("agency", id, name)}
          className="no-print"
        />
      )}

      {entityId && (
        <div className="mt-6" ref={ledgerDetailRef}>
          <div className="no-print flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{entityName || "Ledger"}</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.open(`?nav=${entityMode === "dealer" ? "dealerLedger" : "agencyLedger"}&entity=${entityId}`, "_blank", "noopener,noreferrer")}
                className="text-sm font-semibold text-slate-500 hover:text-blue-600"
              >
                ↗ Open in New Tab
              </button>
              <button onClick={() => window.print()} className="text-sm font-semibold text-slate-500 hover:text-blue-600">
                🖶 Print
              </button>
              <button onClick={() => exportLedgerCSV(entityName, periodRows)} className="text-sm font-semibold text-slate-500 hover:text-blue-600">
                ⬇ Export CSV
              </button>
            </div>
          </div>
          <h3 className="hidden print:block text-lg font-bold mb-4">{entityName || "Ledger"} — Ledger Statement</h3>
          <div className="no-print flex items-end justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-xs text-slate-400 dark:text-slate-500 mb-1">From</label>
                <input
                  type="date"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 dark:text-slate-500 mb-1">To</label>
                <input
                  type="date"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                />
              </div>
              {(periodFrom || periodTo) && (
                <button
                  onClick={() => { setPeriodFrom(""); setPeriodTo(""); }}
                  className="text-sm font-semibold text-slate-500 hover:text-blue-600 pb-1.5"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
            <Card>
              <p className="text-xs text-slate-400 dark:text-slate-500">Running Balance</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1">₹{Number(runningBalance || 0).toLocaleString("en-IN")}</p>
              {loadError && <p className="text-[11px] text-amber-600 mt-1">Error loading ledger: {loadError}</p>}
            </Card>
            {entityMode === "dealer" && summary && (
              <>
                <Card>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Credit Limit</p>
                  <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1">₹{Number(summary.credit_limit || 0).toLocaleString("en-IN")}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Available Limit</p>
                  <p className="text-xl font-bold text-emerald-600 mt-1">₹{availableLimit.toLocaleString("en-IN")}</p>
                </Card>
              </>
            )}
            <Card>
              <p className="text-xs text-slate-400 dark:text-slate-500">Total Debit{(periodFrom || periodTo) ? " (period)" : ""}</p>
              <p className="text-xl font-bold text-rose-600 mt-1">₹{periodTotals.debit.toLocaleString("en-IN")}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400 dark:text-slate-500">Total Credit{(periodFrom || periodTo) ? " (period)" : ""}</p>
              <p className="text-xl font-bold text-emerald-600 mt-1">₹{periodTotals.credit.toLocaleString("en-IN")}</p>
            </Card>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
                <tr>
                  <SortableTh label="Date" sortKeyName="entry_date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Entry Code" sortKeyName="entry_code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-3 py-2 text-left">Type</th>
                  <SortableTh label="Name" sortKeyName="display_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Debit" sortKeyName="debit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Credit" sortKeyName="credit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Running Balance" sortKeyName="running_balance" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  {isAdmin && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {periodRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{new Date(r.entry_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{r.entry_code}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${txnTypeClass(r.ledger_type)}`}>{r.ledger_type || "—"}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                      {r.entry_type === "SERVICE" ? (
                        <button
                          type="button"
                          onClick={() => openAppDetail