// src/pages/Payments.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, Input, Select, PrimaryButton, GhostButton, DangerButton, Modal, Toast } from "../components/UI";
import { parseCSV, findByLabel, ddmmyyyyToISO } from "../lib/csv";

function isoToDDMMYYYY(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export default function Payments({ staff } = {}) {
  const isAdmin = staff?.roles?.role_name === "Admin";
  const [editingPayment, setEditingPayment] = useState(null); // payment row being edited, or null
  const [dealers, setDealers] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [applications, setApplications] = useState([]);
  const [form, setForm] = useState({ dealer_id: "", application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "", paid_at_agency_id: "" });
  const [recent, setRecent] = useState([]);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.tagName === "SELECT" ? e.target.value : e.target.value.toUpperCase() }));

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("dealers").select("id, name, code");
      setDealers(data || []);
      const { data: a } = await supabase.from("agencies").select("id, name, code");
      setAgencies(a || []);
      loadRecent();
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!form.dealer_id) { setApplications([]); return; }
      const { data } = await supabase
        .from("applications")
        .select("id, draft_code, applicant_name")
        .eq("dealer_id", form.dealer_id)
        .order("submitted_at", { ascending: false });
      setApplications(data || []);
    })();
  }, [form.dealer_id]);

  const loadRecent = async () => {
    const { data } = await supabase
      .from("payments")
      .select("*, dealers(name), applications(draft_code), paid_at_agency:paid_at_agency_id(name)")
      .order("created_at", { ascending: false })
      .limit(20);
    setRecent(data || []);
  };

  const submit = async () => {
    if (!form.dealer_id || !form.amount) {
      setToast("Dealer and amount are required");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data: staffRow } = await supabase.from("staff").select("id").eq("auth_user_id", userData?.user?.id).maybeSingle();

    const { data: paymentRow, error } = await supabase
      .from("payments")
      .insert({
        dealer_id: form.dealer_id,
        application_id: form.application_id || null,
        amount: parseFloat(form.amount),
        payment_mode: form.payment_mode,
        reference_no: form.reference_no || null,
        remarks: form.remarks || null,
        paid_at_agency_id: form.paid_at_agency_id || null,
        received_by: staffRow?.id || null,
      })
      .select()
      .single();

    if (error) {
      setSaving(false);
      setToast("Failed: " + error.message);
      return;
    }

    // Post this payment to the dealer ledger (a payment received reduces
    // what the dealer owes, so it's posted as a credit) and, if a "Paid At"
    // agency was chosen, mirror the same amount as a credit on that
    // agency's ledger too. Voucher no. is the payment's own reference no.
    // (or a generated fallback) so this stays a distinct, traceable line.
    const dealerName = dealers.find((d) => d.id === form.dealer_id)?.name;
    const agencyName = agencies.find((a) => a.id === form.paid_at_agency_id)?.name;
    const voucherNo = form.reference_no?.trim() || `PMT-${paymentRow.id}`;
    const amount = parseFloat(form.amount);

    const ledgerInserts = [
      supabase.from("ledger_transactions").insert({
        dealer_id: form.dealer_id,
        voucher_no: voucherNo,
        payment_id: paymentRow.id,
        type: "credit",
        amount,
        description: `Payment received — ${form.payment_mode}${agencyName ? ` · Paid at: ${agencyName}` : ""}${form.remarks ? ` · ${form.remarks}` : ""}`,
      }),
    ];

    if (form.paid_at_agency_id) {
      ledgerInserts.push(
        supabase.from("agency_ledger_transactions").insert({
          agency_id: form.paid_at_agency_id,
          voucher_no: voucherNo,
          payment_id: paymentRow.id,
          type: "credit",
          amount,
          description: `Payment collected on behalf of ${dealerName || "dealer"} — ${form.payment_mode}${form.remarks ? ` · ${form.remarks}` : ""}`,
        })
      );
    }

    const ledgerResults = await Promise.all(ledgerInserts);
    const ledgerError = ledgerResults.find((r) => r.error)?.error;

    setSaving(false);
    if (ledgerError) {
      setToast("Payment saved, but ledger sync failed: " + ledgerError.message);
    } else {
      setToast(`Payment recorded — ledger entry & receipt generated${agencyName ? ` (dealer & ${agencyName} ledgers updated)` : ""}`);
    }
    setForm({ dealer_id: "", application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "", paid_at_agency_id: "" });
    loadRecent();
  };

  // Admin-only: deleting a payment also removes the ledger entries it
  // posted. Matches by payment_id (set on every payment going forward) and
  // falls back to voucher_no (the payment's reference no., or a PMT-<id>
  // fallback) for payments recorded before payment_id existed. Unlike the
  // previous version, this checks what actually got deleted — a delete
  // that matches zero rows doesn't error, so silently trusting it is how
  // a payment could disappear while its ledger entry stayed behind.
  const deletePayment = async (p) => {
    if (!window.confirm(`Delete this ₹${Number(p.amount).toLocaleString("en-IN")} payment from ${p.dealers?.name || "this dealer"}? This also removes its ledger entries.`)) return;
    const voucherNo = p.reference_no?.trim() || `PMT-${p.id}`;

    const deleteLedgerRows = async (table, entityCol, entityId) => {
      let { data, error } = await supabase.from(table).delete().eq("payment_id", p.id).select("id");
      if (!error && (!data || data.length === 0)) {
        // Pre-payment_id row — fall back to the old voucher_no match.
        ({ data, error } = await supabase.from(table).delete().eq(entityCol, entityId).eq("voucher_no", voucherNo).select("id"));
      }
      return { data, error };
    };

    const dealerResult = await deleteLedgerRows("ledger_transactions", "dealer_id", p.dealer_id);
    let agencyResult = { data: [], error: null };
    if (p.paid_at_agency_id) {
      agencyResult = await deleteLedgerRows("agency_ledger_transactions", "agency_id", p.paid_at_agency_id);
    }

    if (dealerResult.error || agencyResult.error) {
      setToast("Failed to remove ledger entries: " + (dealerResult.error || agencyResult.error).message + " — payment was NOT deleted.");
      return;
    }
    if (!dealerResult.data || dealerResult.data.length === 0) {
      setToast("Couldn't find this payment's ledger entry to remove — payment was NOT deleted. Please check the dealer's ledger manually.");
      return;
    }

    const { error } = await supabase.from("payments").delete().eq("id", p.id);
    if (error) {
      setToast("Failed to delete: " + error.message);
      return;
    }
    setToast("Payment deleted");
    loadRecent();
  };

  // Admin-only: saves an edited amount/mode/reference/remarks and updates
  // the matching ledger entry — payment_id first, voucher_no fallback for
  // pre-payment_id rows (see deletePayment above for why the fallback
  // exists and why zero-row results are treated as a failure, not success).
  const savePaymentEdit = async (edited) => {
    const original = editingPayment;
    const oldVoucherNo = original.reference_no?.trim() || `PMT-${original.id}`;
    const newVoucherNo = edited.reference_no?.trim() || `PMT-${original.id}`;
    const { error } = await supabase
      .from("payments")
      .update({
        amount: parseFloat(edited.amount),
        payment_mode: edited.payment_mode,
        reference_no: edited.reference_no || null,
        remarks: edited.remarks || null,
      })
      .eq("id", original.id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    const agencyName = agencies.find((a) => a.id === original.paid_at_agency_id)?.name;

    const updateLedgerRow = async (table, entityCol, entityId, patch) => {
      let { data, error } = await supabase.from(table).update(patch).eq("payment_id", original.id).select("id");
      if (!error && (!data || data.length === 0)) {
        ({ data, error } = await supabase.from(table).update(patch).eq(entityCol, entityId).eq("voucher_no", oldVoucherNo).select("id"));
      }
      return { data, error };
    };

    const dealerResult = await updateLedgerRow("ledger_transactions", "dealer_id", original.dealer_id, {
      amount: parseFloat(edited.amount),
      voucher_no: newVoucherNo,
      description: `Payment received — ${edited.payment_mode}${agencyName ? ` · Paid at: ${agencyName}` : ""}${edited.remarks ? ` · ${edited.remarks}` : ""}`,
    });
    let agencyResult = { data: [], error: null };
    if (original.paid_at_agency_id) {
      agencyResult = await updateLedgerRow("agency_ledger_transactions", "agency_id", original.paid_at_agency_id, {
        amount: parseFloat(edited.amount),
        voucher_no: newVoucherNo,
      });
    }

    if (dealerResult.error || agencyResult.error) {
      setToast("Payment updated, but its ledger entry failed to sync: " + (dealerResult.error || agencyResult.error).message);
    } else if (!dealerResult.data || dealerResult.data.length === 0) {
      setToast("Payment updated, but couldn't find its ledger entry to update — please check the dealer's ledger manually.");
    } else {
      setToast("Payment updated");
    }
    setEditingPayment(null);
    loadRecent();
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="lg:col-span-2 flex justify-end">
        <GhostButton onClick={() => setShowImport(true)}>⬆ Import CSV</GhostButton>
      </div>

      <Card title="Record New Payment">
        <Field label="Dealer" required>
          <Select value={form.dealer_id} onChange={set("dealer_id")}>
            <option value="">Select Dealer</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
          </Select>
        </Field>
        <Field label="Application (optional)">
          <Select value={form.application_id} onChange={set("application_id")} disabled={!form.dealer_id}>
            <option value="">— General payment, not tied to one application —</option>
            {applications.map((a) => <option key={a.id} value={a.id}>{a.draft_code} — {a.applicant_name}</option>)}
          </Select>
        </Field>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Amount (₹)" required>
            <Input type="number" value={form.amount} onChange={set("amount")} />
          </Field>
          <Field label="Payment Mode" required>
            <Select value={form.payment_mode} onChange={set("payment_mode")}>
              <option>Cash</option><option>UPI</option><option>Bank</option><option>Cheque</option>
            </Select>
          </Field>
        </div>
        <Field label="Reference No.">
          <Input value={form.reference_no} onChange={set("reference_no")} placeholder="UTR / cheque no." />
        </Field>
        <Field label="Paid At (Agency)">
          <Select value={form.paid_at_agency_id} onChange={set("paid_at_agency_id")}>
            <option value="">— Not via an agency —</option>
            {agencies.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
          </Select>
        </Field>
        <Field label="Remarks">
          <Input value={form.remarks} onChange={set("remarks")} />
        </Field>
        <PrimaryButton onClick={submit} disabled={saving}>
          {saving ? "Saving..." : "Save Payment & Generate Receipt"}
        </PrimaryButton>
      </Card>

      <Card title="Recent Payments">
        <div className="space-y-2 max-h-[520px] overflow-y-auto">
          {recent.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{p.dealers?.name}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {p.applications?.draft_code ? `${p.applications.draft_code} · ` : ""}{p.payment_mode} · {new Date(p.created_at).toLocaleString()}
                  {p.paid_at_agency?.name ? ` · Paid at: ${p.paid_at_agency.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm font-bold text-emerald-600">₹{Number(p.amount).toLocaleString("en-IN")}</p>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditingPayment(p)} className="text-xs font-semibold text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => deletePayment(p)} className="text-xs font-semibold text-rose-500 hover:underline">Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {recent.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No payments yet</p>}
        </div>
      </Card>

      {editingPayment && (
        <EditPaymentModal
          payment={editingPayment}
          onClose={() => setEditingPayment(null)}
          onSave={savePaymentEdit}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {showImport && (
        <PaymentsImportModal
          dealers={dealers}
          agencies={agencies}
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            loadRecent();
          }}
        />
      )}
    </div>
  );
}

// Bulk CSV import for Payments — mirrors the Applications import feature:
// parse, resolve names to IDs, preview with per-row validation, then insert
// only the valid+included rows. Each imported payment gets the exact same
// ledger postings (dealer credit, + agency credit if "Paid At Agency" is
// filled in) as a normal single payment via the form above, so bulk-
// imported payments show up in Ledger identically to manually entered ones.
//
// Expected CSV headers (case-insensitive, flexible spacing): Dealer,
// Application (optional — draft code), Amount, Payment Mode (optional,
// defaults to Cash), Reference No (optional), Paid At Agency (optional),
// Remarks (optional).
function PaymentsImportModal({ dealers, agencies, onClose, onImported }) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(String(e.target.result));
      const built = parsed.map((raw) => {
        const get = (...keys) => {
          for (const k of keys) {
            const hit = Object.keys(raw).find((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === k);
            if (hit && raw[hit]) return raw[hit];
          }
          return "";
        };
        const dealerRaw = get("dealer", "dealername", "dealercode");
        const applicationRaw = get("application", "draftcode", "draftid");
        const amountRaw = get("amount");
        const modeRaw = get("paymentmode", "mode") || "Cash";
        const referenceRaw = get("referenceno", "reference", "utr", "voucherno", "vouchernumber", "voucher");
        const agencyRaw = get("paidatagency", "agency");
        const remarksRaw = get("remarks", "remark", "narration", "description");
        const dateRaw = get("date", "paymentdate", "paidon", "paiddate");
        const paidOn = dateRaw ? ddmmyyyyToISO(dateRaw) : null;

        const dealer = findByLabel(dealers, dealerRaw, ["name", "code", "short_name"]);
        const agency = agencyRaw ? findByLabel(agencies, agencyRaw, ["name", "code"]) : null;
        const amount = parseFloat(amountRaw);

        const errors = [];
        if (!dealer) errors.push(`Dealer "${dealerRaw}" not found`);
        if (!amountRaw || Number.isNaN(amount) || amount <= 0) errors.push("Amount is missing or invalid");
        if (agencyRaw && !agency) errors.push(`Agency "${agencyRaw}" not found`);

        if (dateRaw && !paidOn) errors.push(`Date "${dateRaw}" not recognized (use DD-MM-YYYY)`);

        return {
          dealerRaw, applicationRaw, agencyRaw,
          included: errors.length === 0,
          errors,
          payload: {
            dealer_id: dealer?.id,
            dealer_name: dealer?.name,
            agency_id: agency?.id,
            agency_name: agency?.name,
            application_draft_code: applicationRaw || null,
            amount,
            payment_mode: modeRaw,
            reference_no: referenceRaw || null,
            remarks: remarksRaw || null,
            paid_on: paidOn,
          },
        };
      });
      setPreview(built);
    };
    reader.readAsText(file);
  };

  const toggleIncluded = (i) => setPreview((p) => p.map((r, idx) => (idx === i ? { ...r, included: !r.included } : r)));
  const includedCount = preview.filter((r) => r.included && r.errors.length === 0).length;

  const runImport = async () => {
    const rowsToImport = preview.filter((r) => r.included && r.errors.length === 0);
    if (!rowsToImport.length) return;
    setImporting(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: staffRow } = await supabase.from("staff").select("id").eq("auth_user_id", userData?.user?.id).maybeSingle();

      let imported = 0;
      for (const r of rowsToImport) {
        const { payload } = r;

        // Resolve an application draft code to its id, if one was given —
        // best-effort: an unmatched code just leaves the payment untied to
        // a specific application rather than failing the whole row.
        let applicationId = null;
        if (payload.application_draft_code) {
          const { data: appRow } = await supabase
            .from("applications")
            .select("id")
            .eq("dealer_id", payload.dealer_id)
            .eq("draft_code", payload.application_draft_code)
            .maybeSingle();
          applicationId = appRow?.id || null;
        }

        const { data: paymentRow, error: insertError } = await supabase
          .from("payments")
          .insert({
            dealer_id: payload.dealer_id,
            application_id: applicationId,
            amount: payload.amount,
            payment_mode: payload.payment_mode,
            reference_no: payload.reference_no,
            remarks: payload.remarks,
            paid_at_agency_id: payload.agency_id || null,
            received_by: staffRow?.id || null,
            ...(payload.paid_on ? { created_at: payload.paid_on } : {}),
          })
          .select()
          .single();

        if (insertError) {
          setError(`Import stopped at "${payload.dealer_name}" (₹${payload.amount}): ` + insertError.message);
          setImporting(false);
          return;
        }

        const voucherNo = payload.reference_no?.trim() || `PMT-${paymentRow.id}`;
        const ledgerInserts = [
          supabase.from("ledger_transactions").insert({
            dealer_id: payload.dealer_id,
            voucher_no: voucherNo,
            payment_id: paymentRow.id,
            type: "credit",
            amount: payload.amount,
            description: `Payment received — ${payload.payment_mode}${payload.agency_name ? ` · Paid at: ${payload.agency_name}` : ""}${payload.remarks ? ` · ${payload.remarks}` : ""}`,
            ...(payload.paid_on ? { created_at: payload.paid_on } : {}),
          }),
        ];
        if (payload.agency_id) {
          ledgerInserts.push(
            supabase.from("agency_ledger_transactions").insert({
              agency_id: payload.agency_id,
              voucher_no: voucherNo,
              payment_id: paymentRow.id,
              type: "credit",
              amount: payload.amount,
              description: `Payment collected on behalf of ${payload.dealer_name || "dealer"} — ${payload.payment_mode}${payload.remarks ? ` · ${payload.remarks}` : ""}`,
              ...(payload.paid_on ? { created_at: payload.paid_on } : {}),
            })
          );
        }
        await Promise.all(ledgerInserts);
        imported++;
      }

      setResult({ imported, skipped: preview.length - rowsToImport.length });
      setImporting(false);
      onImported();
    } catch (err) {
      setError("Import failed: " + err.message);
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">Import Payments</h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>

        {!preview.length && (
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
              CSV columns: <b>Dealer</b> (required — name or code), <b>Amount</b> (required), Application (optional — draft code),
              Payment Mode (optional, defaults to Cash), Reference No, Date (optional, DD-MM-YYYY — defaults to today if left blank), Paid At Agency, Remarks.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 file:font-semibold file:text-sm"
            />
            {fileName && <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{fileName}</span>}
          </div>
        )}

        {preview.length > 0 && !result && (
          <div>
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg mb-4">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Import?</th>
                    <th className="px-3 py-2 text-left">Dealer</th>
                    <th className="px-3 py-2 text-left">Application</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Amount</th>
                    <th className="px-3 py-2 text-left">Mode</th>
                    <th className="px-3 py-2 text-left">Voucher No.</th>
                    <th className="px-3 py-2 text-left">Agency</th>
                    <th className="px-3 py-2 text-left">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className={`border-t border-slate-100 dark:border-slate-800 ${r.errors.length ? "bg-rose-50 dark:bg-rose-500/10" : ""}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={r.included} disabled={r.errors.length > 0} onChange={() => toggleIncluded(i)} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.dealer_name || r.dealerRaw || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.applicationRaw || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.paid_on ? isoToDDMMYYYY(r.payload.paid_on) : "— (today)"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">₹{r.payload.amount || 0}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.payment_mode}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.reference_no || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.agency_name || "—"}</td>
                      <td className="px-3 py-2 text-rose-600">{r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="text-rose-500 text-sm mb-3">{error}</p>}
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">{includedCount} of {preview.length} rows will be imported</p>
              <div className="flex gap-2">
                <GhostButton onClick={() => { setPreview([]); setFileName(""); }}>Start Over</GhostButton>
                <PrimaryButton disabled={importing || includedCount === 0} onClick={runImport}>
                  {importing ? "Importing…" : `Import ${includedCount} Row${includedCount !== 1 ? "s" : ""}`}
                </PrimaryButton>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="text-center py-6">
            <p className="text-lg font-semibold text-emerald-600">Imported {result.imported} payment{result.imported !== 1 ? "s" : ""}</p>
            {result.skipped > 0 && <p className="text-sm text-slate-400 mt-1">{result.skipped} row(s) skipped</p>}
            <PrimaryButton onClick={onClose} className="mt-4">Done</PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

// Admin-only quick edit for a payment row — amount/mode/reference/remarks
// only (dealer, application, and Paid-At-Agency stay fixed to avoid the
// ledger-reversal complexity of re-pointing a payment to a different
// dealer or agency after the fact).
function EditPaymentModal({ payment, onClose, onSave }) {
  const [f, setF] = useState({
    amount: payment.amount,
    payment_mode: payment.payment_mode,
    reference_no: payment.reference_no || "",
    remarks: payment.remarks || "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Modal title={`Edit Payment — ${payment.dealers?.name || ""}`} onClose={onClose}>
      <Field label="Amount" required><Input type="number" value={f.amount} onChange={set("amount")} /></Field>
      <Field label="Payment Mode">
        <Select value={f.payment_mode} onChange={set("payment_mode")}>
          {["Cash", "UPI", "Bank Transfer", "Cheque", "Card"].map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </Field>
      <Field label="Reference No."><Input value={f.reference_no} onChange={set("reference_no")} /></Field>
      <Field label="Remarks"><Input value={f.remarks} onChange={set("remarks")} /></Field>
      <div className="flex gap-2">
        <PrimaryButton onClick={() => onSave(f)}>Save Changes</PrimaryButton>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
      </div>
    </Modal>
  );
}
