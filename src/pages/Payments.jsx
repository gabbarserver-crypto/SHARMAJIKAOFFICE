// src/pages/Payments.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, Input, Select, PrimaryButton, Toast } from "../components/UI";

export default function Payments() {
  const [dealers, setDealers] = useState([]);
  const [applications, setApplications] = useState([]);
  const [form, setForm] = useState({ dealer_id: "", application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "" });
  const [recent, setRecent] = useState([]);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("dealers").select("id, name, code");
      setDealers(data || []);
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
      .select("*, dealers(name), applications(draft_code)")
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

    const { error } = await supabase.from("payments").insert({
      dealer_id: form.dealer_id,
      application_id: form.application_id || null,
      amount: parseFloat(form.amount),
      payment_mode: form.payment_mode,
      reference_no: form.reference_no || null,
      remarks: form.remarks || null,
      received_by: staffRow?.id || null,
    });
    setSaving(false);
    if (error) {
      setToast("Failed: " + error.message);
      return;
    }
    setToast("Payment recorded — ledger entry & receipt generated");
    setForm({ dealer_id: "", application_id: "", amount: "", payment_mode: "Cash", reference_no: "", remarks: "" });
    loadRecent();
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
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
            <div key={p.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <p className="text-sm font-semibold text-slate-700">{p.dealers?.name}</p>
                <p className="text-xs text-slate-400">
                  {p.applications?.draft_code ? `${p.applications.draft_code} · ` : ""}{p.payment_mode} · {new Date(p.created_at).toLocaleString()}
                </p>
              </div>
              <p className="text-sm font-bold text-emerald-600">₹{Number(p.amount).toLocaleString("en-IN")}</p>
            </div>
          ))}
          {recent.length === 0 && <p className="text-sm text-slate-400">No payments yet</p>}
        </div>
      </Card>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
