// src/components/StaffQrSendPanel.jsx
//
// Staff counterpart to QrPaymentPanel (which a dealer opens for themself).
// This is for the other direction: staff picks a dealer, generates a QR,
// and it's sent straight to that dealer -- as a chat message (with the QR
// as an attachment, so it's sitting in their Payments/Chats tab whichever
// they open first) and as a push notification if their phone has the app.
//
// The payment side is identical to the dealer-initiated flow: the QR is a
// normal api/payments/create-qr.js order tied to that dealer_id, and
// api/payments/webhook.js inserts the `payments` row against THAT dealer
// the instant Cashfree confirms it -- same auto-verified, no staff-action-
// required path. This panel is only about *how the dealer receives the QR*,
// not how the payment itself gets recorded.
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { createPaymentQr, sendPush } from "../lib/serverApi";
import { getOrCreateThread, sendMessage, identityFor } from "../lib/chat";
import { Modal, Field, Input, Select, PrimaryButton, GhostButton, Toast } from "./UI";

const DEFAULT_MINUTES = 10;

export default function StaffQrSendPanel({ staff, dealers, onClose }) {
  const [step, setStep] = useState("form"); // form | sending | qr | paid | expired
  const [dealerId, setDealerId] = useState("");
  const [applications, setApplications] = useState([]);
  const [applicationId, setApplicationId] = useState("");
  const [amount, setAmount] = useState("");
  const [minutesValid, setMinutesValid] = useState(DEFAULT_MINUTES);
  const [qr, setQr] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [toast, setToast] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    (async () => {
      if (!dealerId) { setApplications([]); return; }
      const { data } = await supabase
        .from("applications")
        .select("id, draft_code, applicant_name")
        .eq("dealer_id", dealerId)
        .order("submitted_at", { ascending: false });
      setApplications(data || []);
    })();
  }, [dealerId]);

  const generateAndSend = async () => {
    if (!dealerId) { setToast("Pick a dealer"); return; }
    if (!amount || Number(amount) <= 0) { setToast("Enter an amount"); return; }
    setStep("sending");
    try {
      const result = await createPaymentQr({ dealerId, applicationId: applicationId || null, amount: Number(amount), minutesValid });

      const thread = await getOrCreateThread({ dealerId, applicationId: applicationId || null });
      await sendMessage({
        threadId: thread.id,
        sender: identityFor({ staff }),
        body: `Payment QR for ₹${Number(amount).toLocaleString("en-IN")} — scan with any UPI app (PhonePe, GPay, Paytm, BHIM). Expires in ${minutesValid} minutes.`,
        attachmentUrl: result.qrImageUrl,
      });

      await sendPush({
        targetType: "dealer",
        targetId: dealerId,
        title: "Payment QR sent",
        body: `₹${Number(amount).toLocaleString("en-IN")} — open Chats to scan and pay`,
        data: { kind: "payment_qr", threadId: thread.id },
      });

      setQr(result);
      setStep("qr");
    } catch (e) {
      setToast(e.message || "Could not generate/send QR");
      setStep("form");
    }
  };

  // Live countdown, purely for staff's own view of how long the dealer has
  // left -- Cashfree enforces the real expiry (order_expiry_time), not this.
  useEffect(() => {
    if (step !== "qr" || !qr) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(qr.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setStep("expired");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step, qr]);

  // Same Realtime-plus-poll pattern as QrPaymentPanel, so staff sees "Paid"
  // land here too without having to go check the Receipts list separately.
  useEffect(() => {
    if (step !== "qr" || !qr) return;

    const channel = supabase
      .channel(`staff-qr-request-${qr.qrRequestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_qr_requests", filter: `id=eq.${qr.qrRequestId}` },
        (payload) => {
          if (payload.new.status === "paid") setStep("paid");
          else if (payload.new.status === "expired") setStep("expired");
        }
      )
      .subscribe();

    pollRef.current = setInterval(async () => {
      const { data } = await supabase.from("payment_qr_requests").select("status").eq("id", qr.qrRequestId).maybeSingle();
      if (data?.status === "paid") setStep("paid");
      else if (data?.status === "expired") setStep("expired");
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollRef.current);
    };
  }, [step, qr]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const dealerName = dealers.find((d) => d.id === dealerId)?.name;

  return (
    <Modal title="Send Payment QR to Dealer" onClose={onClose}>
      {step === "form" && (
        <div className="space-y-4">
          <Field label="Dealer" required>
            <Select value={dealerId} onChange={(e) => { setDealerId(e.target.value); setApplicationId(""); }}>
              <option value="">— Select dealer —</option>
              {dealers.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
            </Select>
          </Field>
          <Field label="Application (optional)">
            <Select value={applicationId} onChange={(e) => setApplicationId(e.target.value)} disabled={!dealerId}>
              <option value="">— General payment, not tied to one application —</option>
              {applications.map((a) => <option key={a.id} value={a.id}>{a.draft_code} — {a.applicant_name}</option>)}
            </Select>
          </Field>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Amount (₹)" required>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="QR valid for (minutes)">
              <Input type="number" value={minutesValid} onChange={(e) => setMinutesValid(e.target.value)} />
            </Field>
          </div>
          <PrimaryButton onClick={generateAndSend} className="w-full">
            Generate &amp; Send to Dealer
          </PrimaryButton>
        </div>
      )}

      {step === "sending" && (
        <p className="text-center text-sm text-slate-400 py-8">Generating QR and sending to {dealerName || "dealer"}…</p>
      )}

      {step === "qr" && qr && (
        <div className="text-center space-y-4">
          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
            Sent to {dealerName} — via chat{typeof window !== "undefined" ? " and push notification" : ""}.
          </p>
          {qr.qrImageUrl && (
            <img src={qr.qrImageUrl} alt="UPI payment QR" className="mx-auto w-48 h-48 rounded-lg border border-slate-200 dark:border-slate-700" />
          )}
          <p className="text-xl font-bold text-slate-700 dark:text-slate-200">₹{Number(amount).toLocaleString("en-IN")}</p>
          <p className={`text-sm font-mono ${secondsLeft <= 30 ? "text-rose-500" : "text-slate-400"}`}>
            Expires in {mm}:{ss}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">Waiting for payment…</p>
          <GhostButton onClick={onClose} className="w-full">Close</GhostButton>
        </div>
      )}

      {step === "paid" && (
        <div className="text-center space-y-3 py-4">
          <p className="text-3xl">✅</p>
          <p className="text-lg font-semibold text-emerald-600">Paid by {dealerName}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">₹{Number(amount).toLocaleString("en-IN")} recorded automatically against their account.</p>
          <PrimaryButton onClick={onClose} className="w-full">Done</PrimaryButton>
        </div>
      )}

      {step === "expired" && (
        <div className="text-center space-y-3 py-4">
          <p className="text-lg font-semibold text-rose-500">QR expired, unpaid</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{dealerName} didn't pay in time. Generate a fresh one to resend.</p>
          <div className="flex gap-2">
            <GhostButton onClick={() => { setStep("form"); setQr(null); }} className="flex-1">Try again</GhostButton>
            <PrimaryButton onClick={onClose} className="flex-1">Close</PrimaryButton>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Modal>
  );
}
