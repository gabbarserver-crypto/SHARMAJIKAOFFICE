// src/components/DealerPaymentsPanel.jsx
//
// The dealer-side payments view. Dealers only pay by QR now — the old
// "report a bank transfer and wait for staff to verify" flow has been
// removed, so every payment shown here is already posted straight to the
// ledger the moment it lands (see api/payments/webhook.js).
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, PrimaryButton, Toast } from "./UI";
import QrPaymentPanel from "./QrPaymentPanel";

export default function DealerPaymentsPanel({ dealerId, identity }) {
  const [recent, setRecent] = useState([]);
  const [toast, setToast] = useState(null);
  const [showQr, setShowQr] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("ledger_entries")
      .select("*, applications:source_application_id(draft_code)")
      .eq("entry_type", "PAYMENT")
      .eq("dealer_id", dealerId)
      .order("created_at", { ascending: false })
      .limit(30);
    setRecent(data || []);
  };

  useEffect(() => { load(); }, [dealerId]);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Card title="Pay by QR">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Scan with any UPI app and it's recorded automatically the moment it's paid.
          </p>
          <PrimaryButton onClick={() => setShowQr(true)} className="w-full">Pay by QR</PrimaryButton>
        </Card>
      </div>

      <Card title="Recent Payments">
        <div className="space-y-2 max-h-[520px] overflow-y-auto">
          {recent.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {p.applications?.draft_code || "General payment"}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {p.payment_mode} · {new Date(p.created_at).toLocaleString()}
                </p>
              </div>
              <p className="text-sm font-bold text-emerald-600">
                ₹{Math.abs(Number(p.amount)).toLocaleString("en-IN")}
              </p>
            </div>
          ))}
          {recent.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No payments yet</p>}
        </div>
      </Card>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {showQr && (
        <QrPaymentPanel
          dealerId={dealerId}
          onClose={() => setShowQr(false)}
          onPaid={() => load()}
        />
      )}
    </div>
  );
}
