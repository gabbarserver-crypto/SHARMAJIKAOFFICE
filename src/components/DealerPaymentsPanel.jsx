// src/components/DealerPaymentsPanel.jsx
//
// The dealer-side counterpart to the staff "Record New Payment" form on
// the Receipts page — same visual layout, but scoped to this one dealer
// and with real limits: no Dealer picker (it's always them), and whatever
// they submit lands as 'pending' with NO ledger entry posted yet. A staff
// member has to Verify it (Receipts page → "Pending Verification") before
// it actually reduces what they owe — see server/migrations/005_payment_verification.sql
// for how that's enforced at the database level, not just in this UI.
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, Input, Select, PrimaryButton, GhostButton, Toast } from "./UI";
import QrPaymentPanel from "./QrPaymentPanel";

const STATUS_META = {
  pending: { label: "Pending verification", className: "text-amber-600 dark:text-amber-400" },
  verified: { label: "Verified", className: "text-emerald-600 dark:text-emerald-400" },
  rejected: { label: "Rejected", className: "text-rose-500" },
};

export default function DealerPaymentsPanel({ dealerId, identity }) {
  const [applications, setApplications] = useState([]);
  const [recent, setRecent] = useState([]);
  const [form, setForm] = useState({ application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "" });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showQr, setShowQr] = useState(false);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const load = async () => {
    const [{ data: apps }, { data: paymentRows }] = await Promise.all([
      supabase.from("applications").select("id, draft_code, applicant_name").eq("dealer_id", dealerId).order("submitted_at", { ascending: false }),
      supabase
        .from("payments")
        .select("*, applications(draft_code)")
        .eq("dealer_id", dealerId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setApplications(apps || []);
    setRecent(paymentRows || []);
  };

  useEffect(() => { load(); }, [dealerId]);

  const submit = async () => {
    if (!form.amount || Number(form.amount) <= 0) {
      setToast("Enter an amount");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("payments").insert({
      dealer_id: dealerId,
      application_id: form.application_id || null,
      amount: parseFloat(form.amount),
      payment_mode: form.payment_mode,
      reference_no: form.reference_no || null,
      remarks: form.remarks || null,
      status: "pending",
      submitted_by: "dealer",
    });
    setSaving(false);
    if (error) {
      setToast("Failed to submit: " + error.message);
      return;
    }
    setToast("Submitted — this'll show as Pending until our team verifies it.");
    setForm({ application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "" });
    load();
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card title="Submit a Payment">
        <div className="mb-4 p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Pay by QR — instant, no verification wait</p>
            <p className="text-xs text-emerald-600/80 dark:text-emerald-500/70">Scan with any UPI app; it's recorded automatically the moment it's paid.</p>
          </div>
          <GhostButton onClick={() => setShowQr(true)} className="whitespace-nowrap">Pay by QR</GhostButton>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          Or let us know about a payment you've made another way — it'll show as Pending until our team verifies it against what we received.
        </p>
        <Field label="Application (optional)">
          <Select value={form.application_id} onChange={set("application_id")}>
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
              <option>Cash</option><option>Bank</option><option>UPI</option><option>Cheque</option>
            </Select>
          </Field>
        </div>
        <Field label="Reference No.">
          <Input value={form.reference_no} onChange={set("reference_no")} placeholder="UTR / cheque no." />
        </Field>
        <Field label="Remarks">
          <Input value={form.remarks} onChange={set("remarks")} />
        </Field>
        <PrimaryButton onClick={submit} disabled={saving}>
          {saving ? "Submitting…" : "Submit Payment"}
        </PrimaryButton>
      </Card>

      <Card title="Recent Payments">
        <div className="space-y-2 max-h-[520px] overflow-y-auto">
          {recent.map((p) => {
            const meta = STATUS_META[p.status] || STATUS_META.verified;
            return (
              <div key={p.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {p.applications?.draft_code || "General payment"}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {p.payment_mode} · {new Date(p.created_at).toLocaleString()}
                  </p>
                  <p className={`text-xs font-semibold mt-0.5 ${meta.className}`}>{meta.label}</p>
                </div>
                <p className={`text-sm font-bold ${p.status === "rejected" ? "text-slate-400 line-through" : "text-emerald-600"}`}>
                  ₹{Number(p.amount).toLocaleString("en-IN")}
                </p>
              </div>
            );
          })}
          {recent.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No payments yet</p>}
        </div>
      </Card>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {showQr && (
        <QrPaymentPanel
          dealerId={dealerId}
          applications={applications}
          onClose={() => setShowQr(false)}
          onPaid={() => load()}
        />
      )}
    </div>
  );
}
