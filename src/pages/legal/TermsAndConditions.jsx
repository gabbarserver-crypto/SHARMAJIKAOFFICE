// src/pages/legal/TermsAndConditions.jsx
import React from "react";
import LegalLayout from "./LegalLayout";

export default function TermsAndConditions() {
  return (
    <LegalLayout title="Terms &amp; Conditions" updated="11 August 2026">
      <p>
        These terms govern use of the One Infinity dealer portal and our Driving
        Licence, RC Transfer, PCC, and other RTO documentation services. By using our
        services or this website, you agree to the terms below.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Our services</h2>
      <p>
        We assist applicants in preparing and submitting documentation to government
        authorities (RTOs, police departments, etc.) for services such as Driving
        Licences, RC transfers, and Police Clearance Certificates. We are a facilitation
        service — final approval, issuance, and processing timelines for any application
        rest with the relevant government authority, not with us.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Dealer accounts &amp; wallet</h2>
      <p>
        Registered dealers may top up a wallet balance to pay for application processing
        through our portal. Dealers are responsible for the accuracy of applicant details
        submitted through their account, and for keeping their login credentials
        confidential. Wallet balances and credit limits are for use within the portal only
        and are not transferable to a third party.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Accuracy of information</h2>
      <p>
        Applicants and dealers are responsible for providing true, accurate, and complete
        information and documents. We are not liable for delays, rejections, or other
        consequences arising from incorrect or incomplete information supplied to us.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Payments</h2>
      <p>
        Payments made through our portal are processed via a third-party payment gateway.
        See our{" "}
        <a href="/refund-policy" className="text-[var(--accent)] underline">Refund Policy</a>{" "}
        for how refunds and cancellations are handled.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Limitation of liability</h2>
      <p>
        To the extent permitted by law, One Infinity is not liable for indirect or
        consequential loss arising from use of our services, including delays caused by
        government departments outside our control.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Changes to these terms</h2>
      <p>
        We may update these terms from time to time; the "Last updated" date above will
        reflect the most recent revision.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Contact</h2>
      <p>
        For questions about these terms, reach us at{" "}
        <a href="mailto:sharmajikaoffice@gmail.com" className="text-[var(--accent)] underline">
          sharmajikaoffice@gmail.com
        </a>{" "}
        or{" "}
        <a href="tel:+919899029807" className="text-[var(--accent)] underline">9899029807</a>.
      </p>
    </LegalLayout>
  );
}
