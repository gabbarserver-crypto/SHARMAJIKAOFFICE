// src/pages/legal/PrivacyPolicy.jsx
import React from "react";
import LegalLayout from "./LegalLayout";

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" updated="11 August 2026">
      <p>
        Sharma Ji Ka Office ("we", "us", "our") provides Driving Licence, RC Transfer,
        Police Clearance Certificate (PCC) and other RTO-related documentation services
        through our dealer network and this website. This policy explains what
        information we collect from applicants and dealers, and how we use it.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Information we collect</h2>
      <p>
        To process an RTO or PCC application on your behalf, we collect information such
        as your name, date of birth, address, mobile number, email, government-issued ID
        details, and supporting documents/photographs you or your dealer upload. When you
        top up a dealer wallet or make a payment, our payment gateway partner also
        processes payment details necessary to complete that transaction — we do not
        store your card, UPI PIN, or net-banking credentials ourselves.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">How we use it</h2>
      <p>
        We use this information to prepare, submit, and track your application with the
        relevant government authority (such as the local RTO or police department), to
        communicate updates via chat, call, SMS, or email, to process payments and
        maintain dealer account/wallet balances, and to meet our own legal and
        record-keeping obligations.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Sharing</h2>
      <p>
        We share applicant information with the government department or authority the
        application is being filed with, and with payment gateway providers strictly to
        process a payment. We do not sell personal data to third parties.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Data retention &amp; security</h2>
      <p>
        Application and payment records are retained for as long as required to service
        your application and to meet accounting/regulatory retention requirements. We use
        reasonable technical and organisational measures to protect stored data, including
        access controls limiting who at Sharma Ji Ka Office can view a given record.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Your choices</h2>
      <p>
        You can ask us to review, correct, or delete personal information we hold about
        you (subject to what we're legally required to retain for filed applications) by
        reaching out using the details on our{" "}
        <a href="/contact-us" className="text-[var(--accent)] underline">Contact Us</a> page.
      </p>

      <h2 className="text-lg font-semibold text-slate-800 pt-2">Contact</h2>
      <p>
        Questions about this policy can be sent to{" "}
        <a href="mailto:sharmajikaoffice@gmail.com" className="text-[var(--accent)] underline">
          sharmajikaoffice@gmail.com
        </a>{" "}
        or by phone at{" "}
        <a href="tel:+919899029807" className="text-[var(--accent)] underline">9899029807</a>.
      </p>
    </LegalLayout>
  );
}
