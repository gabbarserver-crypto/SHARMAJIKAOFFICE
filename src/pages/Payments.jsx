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
  const [form, setForm] = useState({ payment_type: "dealer", dealer_id: "", application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "", paid_at_agency_id: "" });
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
    const isAgencyOnly = form.payment_type === "agency";
    if (isAgencyOnly ? !form.paid_at_agency_id : !form.dealer_id) {
      setToast(isAgencyOnly ? "Agency and amount are required" : "Dealer and amount are required");
      return;
    }
    if (!form.amount) {
      setToast("Amount is required");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data: staffRow } = await supabase.from("staff").select("id").eq("auth_user_id", userData?.user?.id).maybeSingle();

    const { data: paymentRow, error } = await supabase
      .from("payments")
      .insert({
        dealer_id: isAgencyOnly ? null : form.dealer_id,
        application_id: isAgencyOnly ? null : (form.application_id || null),
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
    // agency's ledger too. For a pure Agency payment (no dealer at all),
    // only the agency side is posted. Voucher no. is the payment's own
    // reference no. (or a generated fallback) so this stays a distinct,
    // traceable line.
    const dealerName = dealers.find((d) => d.id === form.dealer_id)?.name;
    const agencyName = agencies.find((a) => a.id === form.paid_at_agency_id)?.name;
    const voucherNo = form.reference_no?.trim() || `PMT-${paymentRow.id}`;
    const amount = parseFloat(form.amount);

    const ledgerInserts = [];
    if (!isAgencyOnly) {
      ledgerInserts.push(
        supabase.from("ledger_transactions").insert({
          dealer_id: form.dealer_id,
          voucher_no: voucherNo,
          payment_id: paymentRow.id,
          type: "credit",
          amount,
          description: `Payment received — ${form.payment_mode}${agencyName ? ` · Paid at: ${agencyName}` : ""}${form.remarks ? ` · ${form.remarks}` : ""}`,
        })
      );
    }

    if (form.paid_at_agency_id) {
      ledgerInserts.push(
        supabase.from("agency_ledger_transactions").insert({
          agency_id: form.paid_at_agency_id,
          voucher_no: voucherNo,
          payment_id: paymentRow.id,
          type: "credit",
          amount,
          description: isAgencyOnly
            ? `Payment received — ${form.payment_mode}${form.remarks ? ` · ${form.remarks}` : ""}`
            : `Payment collected on behalf of ${dealerName || "dealer"} — ${form.payment_mode}${form.remarks ? ` · ${form.remarks}` : ""}`,
        })
      );
    }

    const ledgerResults = await Promise.all(ledgerInserts);
    const ledgerError = ledgerResults.find((r) => r.error)?.error;

    setSaving(false);
    if (ledgerError) {
      setToast("Payment saved, but ledger sync failed: " + ledgerError.message);
    } else if (isAgencyOnly) {
      setToast(`Payment recorded — ${agencyName || "agency"} ledger updated`);
    } else {
      setToast(`Payment recorded — ledger entry & receipt generated${agencyName ? ` (dealer & ${agencyName} ledgers updated)` : ""}`);
    }
    setForm({ payment_type: "dealer", dealer_id: "", application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "", paid_at_agency_id: "" });
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
    const payerName = p.dealers?.name || p.paid_at_agency?.name || "this payer";
    if (!window.confirm(`Delete this ₹${Number(p.amount).toLocaleString("en-IN")} payment from ${payerName}? This also removes its ledger entries.`)) return;
    const voucherNo = p.reference_no?.trim() || `PMT-${p.id}`;

    const deleteLedgerRows = async (table, entityCol, entityId) => {
      let { data, error } = await supabase.from(table).delete().eq("payment_id", p.id).select("id");
      if (!error && (!data || data.length === 0)) {
        // Pre-payment_id row — fall back to the old voucher_no match.
        ({ data, error } = await supabase.from(table).delete().eq(entityCol, entityId).eq("voucher_no", voucherNo).select("id"));
      }
      return { data, error };
    };

    // Only the side(s) this payment actually posted to are required to
    // match — a pure Agency payment (p.dealer_id null) never had a dealer
    // ledger row to begin with, so there's nothing to find there.
    const dealerResult = p.dealer_id
      ? await deleteLedgerRows("ledger_transactions", "dealer_id", p.dealer_id)
      : { data: [], error: null, skipped: true };
    const agencyResult = p.paid_at_agency_id
      ? await deleteLedgerRows("agency_ledger_transactions", "agency_id", p.paid_at_agency_id)
      : { data: [], error: null, skipped: true };

    if (dealerResult.error || agencyResult.error) {
      setToast("Failed to remove ledger entries: " + (dealerResult.error || agencyResult.error).message + " — payment was NOT deleted.");
      return;
    }
    const dealerOk = dealerResult.skipped || (dealerResult.data && dealerResult.data.length > 0);
    const agencyOk = agencyResult.skipped || (agencyResult.data && agencyResult.data.length > 0);
    if (!dealerOk || !agencyOk) {
      setToast("Couldn't find this payment's ledger entry to remove — payment was NOT deleted. Please check the ledger manually.");
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

    const dealerResult = original.dealer_id
      ? await updateLedgerRow("ledger_transactions", "dealer_id", original.dealer_id, {
          amount: parseFloat(edited.amount),
          voucher_no: newVoucherNo,
          description: `Payment received — ${edited.payment_mode}${agencyName ? ` · Paid at: ${agencyName}` : ""}${edited.remarks ? ` · ${edited.remarks}` : ""}`,
        })
      : { data: [], error: null, skipped: true };
    let agencyResult = { data: [], error: null, skipped: true };
    if (original.paid_at_agency_id) {
      agencyResult = await updateLedgerRow("agency_ledger_transactions", "agency_id", original.paid_at_agency_id, {
        amount: parseFloat(edited.amount),
        voucher_no: newVoucherNo,
      });
    }

    if (dealerResult.error || agencyResult.error) {
      setToast("Payment updated, but its ledger entry failed to sync: " + (dealerResult.error || agencyResult.error).message);
    } else if (!(dealerResult.skipped || (dealerResult.data && dealerResult.data.length > 0)) || !(agencyResult.skipped || (agencyResult.data && agencyResult.data.length > 0))) {
      setToast("Payment updated, but couldn't find its ledger entry to update — please check the ledger manually.");
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
        <Field label="Payment Type" required>
          <Select value={form.payment_type} onChange={set("payment_type")}>
            <option value="dealer">Dealer</option>
            <option value="agency">Agency (no dealer involved)</option>
          </Select>
        </Field>
        {form.payment_type === "dealer" ? (
          <>
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
          </>
        ) : (
          <Field label="Agency" required>
            <Select value={form.paid_at_agency_id} onChange={set("paid_at_agency_id")}>
              <option value="">Select Agency</option>
              {agencies.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
            </Select>
          </Field>
        )}
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
        {form.payment_type === "dealer" && (
          <Field label="Paid At (Agency)">
            <Select value={form.paid_at_agency_id} onChange={set("paid_at_agency_id")}>
              <option value="">— Not via an agency —</option>
              {agencies.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
            </Select>
          </Field>
        )}
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
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {p.dealers?.name || (p.paid_at_agency?.name ? `${p.paid_at_agency.name} (Agency)` : "—")}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {p.applications?.draft_code ? `${p.applications.draft_code} · ` : ""}{p.payment_mode} · {new Date(p.created_at).toLocaleString()}
                  {p.dealer_id && p.paid_at_agency?.name ? ` · Paid at: ${p.paid_at_agency.name}` : ""}
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
  const [recentImports, setRecentImports] = useState(null); // null = not loaded yet
  const [undoing, setUndoing] = useState(false);

  const loadRecentImports = async () => {
    const { data } = await supabase
      .from("payments")
      .select("import_batch, amount, created_at, dealers(name), paid_at_agency:paid_at_agency_id(name)")
      .not("import_batch", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const byBatch = new Map();
    for (const row of data || []) {
      const b = byBatch.get(row.import_batch) || { batchId: row.import_batch, count: 0, total: 0, at: row.created_at, names: new Set() };
      b.count += 1;
      b.total += Number(row.amount || 0);
      if (row.created_at > b.at) b.at = row.created_at;
      if (row.dealers?.name || row.paid_at_agency?.name) b.names.add(row.dealers?.name || row.paid_at_agency?.name);
      byBatch.set(row.import_batch, b);
    }
    setRecentImports([...byBatch.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10));
  };

  useEffect(() => { loadRecentImports(); }, []);

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError("");
    const reader = new FileReader();
    reader.onload = async (e) => {
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
        // A row is valid if it has a payer — either a Dealer, or (when
        // Dealer is left blank on purpose) an Agency standing in as a pure
        // Agency payment. Only actually error if dealerRaw was given but
        // didn't match anything, or if BOTH are missing entirely.
        if (dealerRaw && !dealer) errors.push(`Dealer "${dealerRaw}" not found`);
        if (!dealerRaw && !agencyRaw) errors.push("Either Dealer or Agency is required");
        if (agencyRaw && !agency) errors.push(`Agency "${agencyRaw}" not found`);
        if (!amountRaw || Number.isNaN(amount) || amount <= 0) errors.push("Amount is missing or invalid");

        if (dateRaw && !paidOn) errors.push(`Date "${dateRaw}" not recognized (use DD-MM-YYYY)`);

        return {
          dealerRaw, applicationRaw, agencyRaw,
          included: errors.length === 0,
          errors,
          warnings: [],
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

      // Duplicate check — importing the same file (or an overlapping one)
      // twice is the #1 way this table ends up with doubled payments.
      // Flag anything that looks like it's already in the table: same
      // payer + same reference no. (when given), or same payer + same
      // amount + same date (when it isn't). This is a WARNING, not an
      // error — the row stays untouched and toggleable, it's just
      // unchecked by default so a re-import needs a deliberate opt-in
      // per row instead of silently doubling everything.
      const payerIds = [...new Set(built.flatMap((r) => [r.payload.dealer_id, r.payload.agency_id]).filter(Boolean))];
      if (payerIds.length) {
        const [{ data: existingByDealer }, { data: existingByAgency }] = await Promise.all([
          supabase.from("payments").select("dealer_id, amount, reference_no, created_at").in("dealer_id", payerIds),
          supabase.from("payments").select("paid_at_agency_id, amount, reference_no, created_at").in("paid_at_agency_id", payerIds),
        ]);
        const existing = [...(existingByDealer || []), ...(existingByAgency || [])];

        for (const r of built) {
          if (r.errors.length) continue;
          const payerId = r.payload.dealer_id || r.payload.agency_id;
          const rowDate = (r.payload.paid_on || new Date().toISOString()).slice(0, 10);
          const refKey = r.payload.reference_no?.trim().toLowerCase();

          const isDup = existing.some((p) => {
            const sameDealer = r.payload.dealer_id && p.dealer_id === r.payload.dealer_id;
            const sameAgency = r.payload.agency_id && p.paid_at_agency_id === r.payload.agency_id;
            if (!sameDealer && !sameAgency) return false;
            if (Number(p.amount) !== Number(r.payload.amount)) return false;
            if (refKey) return (p.reference_no || "").trim().toLowerCase() === refKey;
            return (p.created_at || "").slice(0, 10) === rowDate;
          });

          if (isDup) {
            r.warnings.push(
              refKey
                ? `Possible duplicate — a payment with this reference no. already exists for ${r.payload.dealer_name || r.payload.agency_name}`
                : `Possible duplicate — a payment of this amount on this date already exists for ${r.payload.dealer_name || r.payload.agency_name}`
            );
            r.included = false; // default OFF; staff can still tick it back on if it's genuinely a second, separate payment
          }
        }
      }

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
    // One id per import RUN (not per row) — tags every payment this run
    // creates so the whole batch can be found and undone later in one
    // shot, either right after import or from "Recent Imports" below.
    const batchId = `imp_${Date.now()}`;
    const importedIds = [];
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: staffRow } = await supabase.from("staff").select("id").eq("auth_user_id", userData?.user?.id).maybeSingle();

      let imported = 0;
      for (const r of rowsToImport) {
        const { payload } = r;

        // Resolve an application draft code to its id, if one was given —
        // best-effort: an unmatched code just leaves the payment untied to
        // a specific application rather than failing the whole row.
        // Doesn't apply at all to a pure Agency row (no dealer_id) since
        // applications are always dealer-scoped.
        let applicationId = null;
        if (payload.application_draft_code && payload.dealer_id) {
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
            dealer_id: payload.dealer_id || null,
            application_id: applicationId,
            amount: payload.amount,
            payment_mode: payload.payment_mode,
            reference_no: payload.reference_no,
            remarks: payload.remarks,
            paid_at_agency_id: payload.agency_id || null,
            received_by: staffRow?.id || null,
            import_batch: batchId,
            ...(payload.paid_on ? { created_at: payload.paid_on } : {}),
          })
          .select()
          .single();

        if (insertError) {
          setError(`Import stopped at "${payload.dealer_name || payload.agency_name}" (₹${payload.amount}): ` + insertError.message);
          setImporting(false);
          return;
        }
        importedIds.push(paymentRow.id);

        const voucherNo = payload.reference_no?.trim() || `PMT-${paymentRow.id}`;
        const ledgerInserts = [];
        if (payload.dealer_id) {
          ledgerInserts.push(
            supabase.from("ledger_transactions").insert({
              dealer_id: payload.dealer_id,
              voucher_no: voucherNo,
              payment_id: paymentRow.id,
              type: "credit",
              amount: payload.amount,
              description: `Payment received — ${payload.payment_mode}${payload.agency_name ? ` · Paid at: ${payload.agency_name}` : ""}${payload.remarks ? ` · ${payload.remarks}` : ""}`,
              ...(payload.paid_on ? { created_at: payload.paid_on } : {}),
            })
          );
        }
        if (payload.agency_id) {
          ledgerInserts.push(
            supabase.from("agency_ledger_transactions").insert({
              agency_id: payload.agency_id,
              voucher_no: voucherNo,
              payment_id: paymentRow.id,
              type: "credit",
              amount: payload.amount,
              description: payload.dealer_id
                ? `Payment collected on behalf of ${payload.dealer_name || "dealer"} — ${payload.payment_mode}${payload.remarks ? ` · ${payload.remarks}` : ""}`
                : `Payment received — ${payload.payment_mode}${payload.remarks ? ` · ${payload.remarks}` : ""}`,
              ...(payload.paid_on ? { created_at: payload.paid_on } : {}),
            })
          );
        }
        await Promise.all(ledgerInserts);
        imported++;
      }

      setResult({ imported, skipped: preview.length - rowsToImport.length, batchId, importedIds });
      setImporting(false);
      onImported();
    } catch (err) {
      setError("Import failed: " + err.message);
      setImporting(false);
    }
  };

  // Deletes every payment from one import run — its ledger entries first
  // (payments.id is what payment_id points at, so those have to go before
  // the payments themselves), then the payments rows. Used both by "Undo
  // this import" right after a run, and by deleting an older run from
  // "Recent Imports" below.
  const deleteImportBatch = async (batchId, paymentIds) => {
    let ids = paymentIds;
    if (!ids) {
      const { data } = await supabase.from("payments").select("id").eq("import_batch", batchId);
      ids = (data || []).map((p) => p.id);
    }
    if (!ids.length) return { error: null, count: 0 };
    await Promise.all([
      supabase.from("ledger_transactions").delete().in("payment_id", ids),
      supabase.from("agency_ledger_transactions").delete().in("payment_id", ids),
    ]);
    const { error } = await supabase.from("payments").delete().in("id", ids);
    return { error, count: ids.length };
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
              CSV columns: <b>Dealer</b> (name or code) and <b>Amount</b> (required). Leave Dealer blank and fill in <b>Paid At Agency</b> instead
              for a pure Agency payment (no dealer involved) — otherwise Dealer is required. Also: Application (optional — draft code),
              Payment Mode (optional, defaults to Cash), Reference No, Date (optional, DD-MM-YYYY — defaults to today if left blank), Remarks.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 file:font-semibold file:text-sm"
            />
            {fileName && <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{fileName}</span>}

            {recentImports?.length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Recent Imports — imported by mistake? Delete the whole run here.</p>
                <div className="space-y-1.5">
                  {recentImports.map((b) => (
                    <div key={b.batchId} className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
                      <span className="text-slate-600 dark:text-slate-300">
                        {new Date(b.at).toLocaleString()} · {b.count} payment{b.count !== 1 ? "s" : ""} · ₹{b.total.toLocaleString("en-IN")}
                        {b.names.size > 0 && <span className="text-slate-400 dark:text-slate-500"> · {[...b.names].slice(0, 3).join(", ")}{b.names.size > 3 ? "…" : ""}</span>}
                      </span>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete all ${b.count} payments from this import (₹${b.total.toLocaleString("en-IN")} total)? This also removes their ledger entries. Can't be undone.`)) return;
                          const { error } = await deleteImportBatch(b.batchId, null);
                          if (error) { setError("Failed to delete import: " + error.message); return; }
                          loadRecentImports();
                          onImported();
                        }}
                        className="text-rose-500 font-semibold hover:underline shrink-0 ml-3"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                    <th className="px-3 py-2 text-left">Errors / Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className={`border-t border-slate-100 dark:border-slate-800 ${r.errors.length ? "bg-rose-50 dark:bg-rose-500/10" : r.warnings.length ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={r.included} disabled={r.errors.length > 0} onChange={() => toggleIncluded(i)} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.payload.dealer_name || r.dealerRaw || (r.payload.agency_name ? `${r.payload.agency_name} (Agency)` : "—")}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.applicationRaw || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.paid_on ? isoToDDMMYYYY(r.payload.paid_on) : "— (today)"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">₹{r.payload.amount || 0}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.payment_mode}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.reference_no || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.payload.agency_name || "—"}</td>
                      <td className={r.errors.length ? "px-3 py-2 text-rose-600" : "px-3 py-2 text-amber-600"}>
                        {r.errors.join("; ") || r.warnings.join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="text-rose-500 text-sm mb-3">{error}</p>}
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {includedCount} of {preview.length} rows will be imported
                {preview.some((r) => r.warnings.length) && <span className="text-amber-600"> — possible duplicates are unchecked, review before importing</span>}
              </p>
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
            <div className="flex items-center justify-center gap-3 mt-4">
              {result.imported > 0 && (
                <GhostButton
                  disabled={undoing}
                  onClick={async () => {
                    if (!window.confirm(`Undo this import? Deletes all ${result.imported} payment(s) just created and their ledger entries.`)) return;
                    setUndoing(true);
                    const { error } = await deleteImportBatch(result.batchId, result.importedIds);
                    setUndoing(false);
                    if (error) { setError("Failed to undo: " + error.message); return; }
                    onImported();
                    onClose();
                  }}
                >
                  {undoing ? "Undoing…" : "Undo this import"}
                </GhostButton>
              )}
              <PrimaryButton onClick={onClose}>Done</PrimaryButton>
            </div>
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
