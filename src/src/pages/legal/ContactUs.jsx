// src/pages/legal/ContactUs.jsx
import React from "react";
import LegalLayout from "./LegalLayout";

export default function ContactUs() {
  return (
    <LegalLayout title="Contact Us">
      <p>
        For questions about your application, dealer account, or a payment, reach us
        through any of the channels below.
      </p>

      <div className="not-prose grid sm:grid-cols-2 gap-4 mt-6">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Address</div>
          <div className="text-slate-700">Dayalpur, 33 Ft Road, North East Delhi – 110094</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Phone</div>
          <a href="tel:+919899029807" className="text-[var(--accent)] font-medium">9899029807</a>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Email</div>
          <a href="mailto:sharmajikaoffice@gmail.com" className="text-[var(--accent)] font-medium">
            sharmajikaoffice@gmail.com
          </a>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Business Hours</div>
          <div className="text-slate-700">Monday – Saturday, 9:00 AM – 7:00 PM</div>
        </div>
      </div>
    </LegalLayout>
  );
}
