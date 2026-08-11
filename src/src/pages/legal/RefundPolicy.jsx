// src/pages/legal/RefundPolicy.jsx
import React from "react";
import LegalLayout from "./LegalLayout";

export default function RefundPolicy() {
  return (
    <LegalLayout title="Refund &amp; Cancellation Policy" updated="11 August 2026">
      <h2 className="text-lg font-semibold text-slate-800 pt-2">Wallet top-ups</h2>
      <p>
        Wallet top-ups made by dealers through our portal are used to pay for application
        processing fees and service charges as applications are submitted. A top-up is
        confirmed only once payment is verified by our team/payment gateway; unused wallet
        balance remains available in the dealer's account for future applications and is
        not automatically forfeited.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Cancellations before processing</h2>
      <p>
        If an application has not yet been submitted to the relevant government authority,
        a dealer may request cancellation and a refund of the wallet amount charged for
        that application by contacting us. Once an application has been submitted to a
        government authority (RTO, police department, etc.), government fees already paid
        on the applicant's behalf are non-refundable, as they are remitted to the
        authority and outside our control.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Failed or duplicate payments</h2>
      <p>
        If a payment is deducted but not reflected in your wallet balance due to a
        technical or gateway error, contact us with the transaction reference/UTR number.
        Verified failed or duplicate payments are refunded to the original payment method,
        or credited to the wallet, typically within 5–7 business days of verification.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Service fees</h2>
      <p>
        Our own service/facilitation charges (as distinct from government fees) for work
        already performed on a submitted application are non-refundable.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">How to request a refund</h2>
      <p>
        Email{" "}
        <a href="mailto:sharmajikaoffice@gmail.com" className="text-[var(--accent)] underline">
          sharmajikaoffice@gmail.com
        </a>{" "}
        or call{" "}
        <a href="tel:+919899029807" className="text-[var(--accent)] underline">9899029807</a>{" "}
        with your dealer code, application/draft ID, and payment reference. We aim to
        respond within 2 business days.
      </p>
    </LegalLayout>
  );
}
