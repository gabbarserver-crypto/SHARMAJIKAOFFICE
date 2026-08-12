// src/pages/Ledger.jsx
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, GhostButton, PrimaryButton, Modal } from "../components/UI";
import { DealerForm, AgencyForm } from "./Masters";

// Now that Type has its own column, strip the parts of the description that
// just repeat it — the "Service: X" segment, and the "Payment received"
// prefix — along with whatever separator (·, -, –, —) sat next to them, so
// the remaining text doesn't have an orphaned separator left behind.
export function stripTypeFromDescription(description) {
  if (!description) return description;
  let d = description;
  d = d.replace(/\s*[·\-–—]?\s*Service:\s*[^·\-–—\n]+/i, "");
  d = d.replace(/^\s*Payment received\s*[·\-–—]?\s*/i, "");
  d = d.replace(/\s*[·\-–—]\s*[·\-–—]\s*/g, " · "); // collapse any now-adjacent separators
  d = d.replace(/\s*·\s*/g, " · "); // normalize spacing around any remaining separator
  d = d.replace(/^[\s·\-–—]+/, "").replace(/[\s·\-–—]+$/, "");
  return d.trim();
}

// Ledger transactions don't have their own "type" column — the type (LL RIC,
// PCC, PAYMENT, ...) is embedded in the free-text description, e.g.
// "MANOJ KUMAR · Service: LL RIC · App No: 3303448226" or
// "Payment received — Cash · UPI 16-07-2026". This pulls a short label back
// out of that text for display as its own column.
export function deriveTxnType(description) {
  if (!description) return null;
  if (/payment received/i.test(description)) return "PAYMENT";
  const m = description.match(/Service:\s*([^·\n]+)/i);
  if (m) return m[1].trim().toUpperCase();
  return null;
}

// Pulls the application number back out of a ledger description like
// "...· App No: 1870636524" so a row can be linked to its application.
export function extractAppNo(description) {
  if (!description) return null;
  const m = description.match(/App No:\s*([^\s·\-–—]+)/i);
  return m ? m[1].trim() : null;
}

// Tailwind classes per Type, purely cosmetic grouping — payments in green,
// PCC in blue, anything else (service names like LL RIC, MCWG...) neutral.
function txnTypeClass(typeLabel) {
  if (!typeLabel) return "text-slate-400 dark:text-slate-500";
  if (typeLabel === "PAYMENT") return "text-emerald-600 dark:text-emerald-400 font-semibold";
  if (typeLabel === "PCC") return "text-sky-600 dark:text-sky-400 font-semibold";
  return "text-slate-600 dark:text-slate-300 font-semibold";
}

// Builds a CSV of the given transactions and triggers a browser download —
// entirely client-side, matching how the rest of the app's CSV export/import
// works (see lib/csv.js).
function exportLedgerCSV(entityName, txns) {
  const escapeCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Date", "Voucher No.", "Type", "Description", "Debit", "Credit", "Running Balance"];
  const lines = [header.join(",")];
  txns.forEach((t) => {
    lines.push([
      escapeCsv(new Date(t.created_at).toLocaleDateString()),
      escapeCsv(t.voucher_no),
      escapeCsv(deriveTxnType(t.description) || ""),
      escapeCsv(stripTypeFromDescription(t.description)),
      escapeCsv(t.type === "debit" ? t.amount : ""),
      escapeCsv(t.type === "credit" ? t.amount : ""),
      escapeCsv(t.running_balance),
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
export default function Ledger({ only, initialEntityId, isAdmin = false } = {}) {
  const [entityId, setEntityId] = useState(initialEntityId || "");
  const [entityMode, setEntityMode] = useState(only === "agency" ? "agency" : "dealer"); // "dealer" | "agency" — mode of the currently open ledger detail
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [txns, setTxns] = useState([]);
  const [entityName, setEntityName] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc"); // newest first by default
  const [periodFrom, setPeriodFrom] = useState(""); // yyyy-mm-dd, empty = no lower bound
  const [periodTo, setPeriodTo] = useState(""); // yyyy-mm-dd, empty = no upper bound
  const [appDetail, setAppDetail] = useState(null); // application row shown in the description-click modal
  const [appDetailLoading, setAppDetailLoading] = useState(false);
  const [appDetailError, setAppDetailError] = useState("");
  const [appDetailTxn, setAppDetailTxn] = useState(null); // the ledger_transactions/agency_ledger_transactions row that was clicked
  const [editAmount, setEditAmount] = useState(""); // draft value while editing the Amount field in the modal
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountSaveError, setAmountSaveError] = useState("");

  // Description cells that carry an "App No: ..." are clickable — this
  // looks the application up by that number and opens it in a modal so
  // staff don't have to leave the ledger to see what a line item was for.
  const openAppDetail = useCallback(async (txn) => {
    const appNo = extractAppNo(txn.description);
    if (!appNo) return;
    setAppDetailLoading(true);
    setAppDetailError("");
    setAmountSaveError("");
    setAppDetail(null);
    setAppDetailTxn(txn);
    const { data, error } = await supabase
      .from("applications")
      .select("*, dealers(name,code,short_name), services(parent_service,short_name), staff:assigned_staff_id(full_name)")
      .eq("application_no", appNo)
      .maybeSingle();
    setAppDetailLoading(false);
    if (error || !data) {
      setAppDetailError(`No application found for App No: ${appNo}`);
      return;
    }
    setAppDetail(data);
    setEditAmount(String(txn.amount ?? data.amount ?? ""));
  }, []);

  // Saves the edited Amount into both the ledger transaction that was
  // clicked (so the ledger table + running balance reflect it immediately)
  // and the linked application's own amount field, so the two stay in
  // sync. Only Amount is editable here — every other field in the modal is
  // read-only, on purpose.
  //
  // Both writes happen inside a single Postgres function (see
  // supabase/013_atomic_ledger_amount_update.sql) instead of two separate
  // client-side .update() calls — so either both land or neither does,
  // and the ledger + application amount can never go out of sync from a
  // half-completed save.
  const saveAmount = useCallback(async () => {
    if (!appDetailTxn || !appDetail) return;
    const newAmount = Number(editAmount);
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      setAmountSaveError("Enter a valid amount");
      return;
    }
    setSavingAmount(true);
    setAmountSaveError("");
    const rpcName = entityMode === "dealer" ? "update_dealer_ledger_amount" : "update_agency_ledger_amount";
    const { error: rpcErr } = await supabase.rpc(rpcName, {
      p_txn_id: appDetailTxn.id,
      p_application_id: appDetail.id,
      p_new_amount: newAmount,
    });
    setSavingAmount(false);
    if (rpcErr) {
      setAmountSaveError(rpcErr.message);
      return;
    }
    // Reflect the new amount locally so the ledger table + running balance
    // recompute without a full refetch.
    setTxns((prev) => prev.map((t) => (t.id === appDetailTxn.id ? { ...t, amount: newAmount } : t)));
    setAppDetailTxn((t) => ({ ...t, amount: newAmount }));
    setAppDetail((a) => ({ ...a, amount: newAmount }));
  }, [appDetailTxn, appDetail, editAmount, entityMode]);

  // Admin-only: removes a single ledger transaction row outright — for
  // correcting mistakes like a duplicate debit (e.g. from a double-clicked
  // Approve) without having to touch the application it came from. This
  // only removes the ledger row; it does not change the linked
  // application's status or amount.
  const [deletingTxnId, setDeletingTxnId] = useState(null);
  const deleteTxn = useCallback(async (txn) => {
    if (!window.confirm(`Delete this ${txn.type} entry of ₹${Number(txn.amount).toLocaleString("en-IN")} (Voucher ${txn.voucher_no})? This cannot be undone.`)) return;
    setDeletingTxnId(txn.id);
    const table = entityMode === "dealer" ? "ledger_transactions" : "agency_ledger_transactions";
    const { error } = await supabase.from(table).delete().eq("id", txn.id);
    setDeletingTxnId(null);
    if (error) {
      alert("Failed to delete: " + error.message);
      return;
    }
    setTxns((prev) => prev.filter((t) => t.id !== txn.id));
  }, [entityMode]);

  // Running balance is a property of *when* a transaction happened, not of
  // whatever order it's currently displayed in — so it's always computed by
  // walking the transactions oldest-to-newest first, then the result is
  // re-sorted for display. Re-sorting by voucher/description/amount later
  // never recalculates or scrambles these balances.
  const sortedTxns = useMemo(() => {
    const chronological = [...txns].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let running = 0;
    const withBalance = chronological.map((t) => {
      running += t.type === "credit" ? Number(t.amount || 0) : -Number(t.amount || 0);
      return { ...t, running_balance: running };
    });
    const byId = new Map(withBalance.map((t) => [t.id, t]));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...txns].map((t) => byId.get(t.id)).sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "created_at") { av = new Date(av); bv = new Date(bv); }
      if (sortKey === "amount") { av = Number(av || 0); bv = Number(bv || 0); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [txns, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "created_at" ? "desc" : "asc"); }
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
      if (!entityId) { setSummary(null); setTxns([]); return; }
      const table = entityMode === "dealer" ? "dealers" : "agencies";
      const { data: entityRow } = await supabase.from(table).select("name").eq("id", entityId).maybeSingle();
      if (entityRow?.name) setEntityName(entityRow.name);
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

  // Available Limit = Credit Limit + Running Balance. Running balance is
  // negative when the dealer owes money and positive when they're in
  // credit, so adding it (not subtracting it) correctly shrinks the
  // available limit as debt grows and grows it when they're prepaid.
  // Computed here instead of trusted from the summary view, since that
  // view was doing Credit Limit - Running Balance and produced a bogus
  // (inflated) number whenever running_balance was negative.
  const availableLimit = Number(summary?.credit_limit || 0) + Number(runningBalance || 0);

  // Rows within the selected date range (inclusive). Each row keeps the
  // running_balance computed from *all* history in sortedTxns above — a
  // date filter narrows which rows are shown, it doesn't reset the
  // opening balance to zero.
  const periodTxns = useMemo(() => {
    if (!periodFrom && !periodTo) return sortedTxns;
    const from = periodFrom ? new Date(periodFrom + "T00:00:00") : null;
    const to = periodTo ? new Date(periodTo + "T23:59:59") : null;
    return sortedTxns.filter((t) => {
      const d = new Date(t.created_at);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [sortedTxns, periodFrom, periodTo]);

  const periodTotals = useMemo(
    () =>
      periodTxns.reduce(
        (acc, t) => {
          if (t.type === "debit") acc.debit += Number(t.amount || 0);
          else acc.credit += Number(t.amount || 0);
          return acc;
        },
        { debit: 0, credit: 0 }
      ),
    [periodTxns]
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
          summaryTable="dealer_ledger_summary"
          summaryKey="dealer_id"
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
          summaryTable="agency_ledger_summary"
          summaryKey="agency_id"
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
              <button onClick={() => exportLedgerCSV(entityName, periodTxns)} className="text-sm font-semibold text-slate-500 hover:text-blue-600">
                ⬇ Export CSV
              </button>
            </div>
          </div>
          {/* Print-only heading — the buttons/nav above are hidden via .no-print, so
              a printed page needs its own plain-text title instead. */}
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
                  <SortableTh label="Date" sortKeyName="created_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Voucher No." sortKeyName="voucher_no" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-3 py-2 text-left">Type</th>
                  <SortableTh label="Description" sortKeyName="description" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Debit" sortKeyName="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Credit" sortKeyName="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Running Balance" sortKeyName="running_balance" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  {isAdmin && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {periodTxns.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{t.voucher_no}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${txnTypeClass(deriveTxnType(t.description))}`}>{deriveTxnType(t.description) || "—"}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                      {extractAppNo(t.description) ? (
                        <button
                          type="button"
                          onClick={() => openAppDetail(t)}
                          className="text-left hover:underline decoration-dotted text-blue-600 dark:text-blue-400"
                          title="View application details"
                        >
                          {stripTypeFromDescription(t.description)}
                        </button>
                      ) : (
                        stripTypeFromDescription(t.description)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-rose-600">
                      {t.type === "debit" ? `₹${Number(t.amount).toLocaleString("en-IN")}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-emerald-600">
                      {t.type === "credit" ? `₹${Number(t.amount).toLocaleString("en-IN")}` : ""}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${t.running_balance < 0 ? "text-rose-600" : "text-slate-700 dark:text-slate-300"}`}>
                      ₹{Number(t.running_balance).toLocaleString("en-IN")}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => deleteTxn(t)}
                          disabled={deletingTxnId === t.id}
                          className="text-rose-600 hover:text-rose-700 text-xs font-medium disabled:opacity-50"
                          title="Delete this ledger entry"
                        >
                          {deletingTxnId === t.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {periodTxns.length === 0 && (
                  <tr><td colSpan={isAdmin ? 8 : 7} className="text-center text-slate-400 dark:text-slate-500 py-8">No transactions yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {(appDetailLoading || appDetail || appDetailError) && (
        <Modal
          title="Application Details"
          onClose={() => { setAppDetail(null); setAppDetailError(""); setAppDetailTxn(null); setAmountSaveError(""); }}
        >
          {appDetailLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
          {appDetailError && <p className="text-sm text-rose-600">{appDetailError}</p>}
          {appDetail && (
            <div className="space-y-3 text-sm">
              <Row label="Applicant" value={appDetail.applicant_name} />
              <Row label="App No." value={appDetail.application_no} />
              <Row label="Status" value={appDetail.status} />
              <Row label="Service" value={appDetail.services?.short_name || appDetail.services?.parent_service} />
              <Row label="Dealer" value={appDetail.dealers?.name} />
              <Row label="Assigned Staff" value={appDetail.staff?.full_name} />
              <div className="flex justify-between items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                <span className="text-slate-400 dark:text-slate-500">Amount</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-32 text-right rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] focus:border-[var(--accent)]"
                  />
                  <PrimaryButton onClick={saveAmount} disabled={savingAmount || Number(editAmount) === Number(appDetail.amount)}>
                    {savingAmount ? "Saving…" : "Save"}
                  </PrimaryButton>
                </div>
              </div>
              {amountSaveError && <p className="text-rose-600 text-xs -mt-1">{amountSaveError}</p>}
              <Row label="Submitted" value={appDetail.submitted_at ? new Date(appDetail.submitted_at).toLocaleDateString() : null} />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// A label/value line used by the application-details modal above.
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-2">
      <span className="text-slate-400 dark:text-slate-500">{label}</span>
      <span className="text-slate-800 dark:text-slate-100 font-medium text-right">{value || "—"}</span>
    </div>
  );
}

// One "head" — either Dealer or Agency: every record in that table, with
// just Name / Code / Active status / Balance, name & balance clickable
// into the ledger below, plus a New/Edit affordance (reusing the same
// forms Masters used to use — those tabs are gone from Masters now).
function SundryHead({ title, subtitle, entityMode, table, summaryTable, summaryKey, Form, selectedId, onOpenLedger, className = "" }) {
  const [rows, setRows] = useState([]);
  const [balances, setBalances] = useState({}); // id -> running_balance
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // row being edited, or null
  const [open, setOpen] = useState(false); // form modal open
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    // Fetch rows and balances together so they land in state in the same
    // pass — otherwise the zero-balance filter below would briefly hide
    // every row on first paint (balances start empty).
    const [{ data }, { data: summaries }] = await Promise.all([
      supabase.from(table).select("*").order("name"),
      supabase.from(summaryTable).select("*"),
    ]);
    setRows(data || []);
    setBalances(Object.fromEntries((summaries || []).map((s) => [s[summaryKey], s.running_balance])));
    setLoading(false);
  }, [table, summaryTable, summaryKey]);

  useEffect(() => { load(); }, [load]);

  // Zero-balance accounts are settled/uninteresting for everyday browsing,
  // so they're hidden — but a search should still be able to find a
  // specific dealer/agency even if its balance happens to be zero.
  const searchTerm = search.trim().toLowerCase();
  const visibleRows = rows.filter((r) => {
    if (searchTerm) {
      return (r.name || "").toLowerCase().includes(searchTerm) || (r.code || "").toLowerCase().includes(searchTerm);
    }
    return Number(balances[r.id] ?? 0) !== 0;
  });

  const save = async (form) => {
    const payload = entityMode === "dealer"
      ? {
          name: form.name, code: form.code, short_name: form.short_name || null, contact_name: form.contact_name, mobile: form.mobile, email: form.email,
          address: form.address, city: form.city, state: form.state, pincode: form.pincode,
          credit_limit: parseFloat(form.credit_limit) || 0,
          opening_balance: parseFloat(form.opening_balance) || 0,
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
    const bal = balances[row.id];
    if (bal === undefined) return "Active";
    const avail = Number(row.credit_limit || 0) + Number(bal || 0);
    return avail <= 0 ? "On Hold" : "Active";
  };

  const totalBalance = Object.values(balances).reduce((acc, b) => acc + Number(b || 0), 0);

  return (
    <Card
      title={
        <div className="flex items-center justify-between w-full">
          <div>
            <span>{title}</span>
            <span className="block text-xs font-normal text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500">Total Balance</span>
              <span className={`block text-sm font-bold ${totalBalance < 0 ? "text-rose-600" : "text-slate-800 dark:text-slate-100"}`}>
                ₹{totalBalance.toLocaleString("en-IN")}
              </span>
            </div>
            <GhostButton onClick={() => { setEditing(null); setOpen(true); }}>+ New</GhostButton>
          </div>
        </div>
      }
      className={className}
    >
      <div className="mb-3">
        <div className="relative max-w-xs">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()} name or code…`}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-xs">🔍</span>
        </div>
      </div>
      <div className="overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">Name</th>
              <th className="text-left font-medium px-3 py-2">Code</th>
              <th className="text-left font-medium px-3 py-2">Active</th>
              <th className="text-right font-medium px-3 py-2">Balance</th>
              <th className="text-right font-medium px-3 py-2">Edit</th>
              <th className="text-right font-medium px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const bal = balances[r.id];
              const isSelected = selectedId === r.id;
              const navKey = entityMode === "dealer" ? "dealerLedger" : "agencyLedger";
              return (
                <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 ${isSelected ? "bg-blue-50 dark:bg-blue-500/10" : ""}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => onOpenLedger(r.id, r.name)} className="text-blue-600 font-semibold hover:underline text-left">
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
                    <button
                      onClick={() => window.open(`?nav=${navKey}&entity=${r.id}`, "_blank", "noopener,noreferrer")}
                      title="Open this ledger in a new window"
                      className="text-blue-600 font-semibold hover:underline"
                    >
                      ₹{Number(bal || 0).toLocaleString("en-IN")}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => { setEditing(r); setOpen(true); }} className="text-xs font-semibold text-slate-500 hover:text-blue-600">
                      Edit
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => window.open(`?nav=${navKey}&entity=${r.id}`, "_blank", "noopener,noreferrer")}
                      title="Open this ledger in a new tab"
                      className="text-xs font-semibold text-slate-400 hover:text-blue-600"
                    >
                      ↗
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && visibleRows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 dark:text-slate-500 py-8">{searchTerm ? "No match" : "None yet"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {open && <Form initial={editing} onSave={save} onClose={() => setOpen(false)} />}
    </Card>
  );
}

// Clickable column header for the transaction table — shows an arrow when
// this is the active sort column, flips direction on repeat clicks.
function SortableTh({ label, sortKeyName, sortKey, sortDir, onSort, align = "left" }) {
  const active = sortKey === sortKeyName;
  return (
    <th
      onClick={() => onSort(sortKeyName)}
      className={`font-medium px-3 py-2 cursor-pointer select-none whitespace-nowrap ${align === "right" ? "text-right" : "text-left"} ${active ? "text-slate-800 dark:text-slate-100" : ""}`}
    >
      {label} {active && (sortDir === "asc" ? "↑" : "↓")}
    </th>
  );
}
