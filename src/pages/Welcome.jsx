// src/pages/Welcome.jsx
//
// A brief branded splash shown once per browser session before Login —
// see App.jsx: it's skipped on subsequent navigations within the same tab
// (tracked via sessionStorage) so it doesn't get in the way of a dealer/
// staff member who's already signed in and out again. Doubles as a minimal
// public-facing intro, since the same URL is what you'd hand to a
// prospective customer — hence the one-line service list, even though the
// screen itself stays intentionally simple (logo + Continue).
import React from "react";
import logo from "../assets/sjo-logo-full.png";

export default function Welcome({ onContinue }) {
  return (
    <div className="min-h-screen bg-[#0f1b3d] flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <img src={logo} alt="Sharma Ji Ka Office" className="w-full max-w-[240px] mx-auto mb-4" />
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            Your trusted partner for Driving Licence, RC Transfer, PCC and other RTO services.
          </p>
          <button onClick={onContinue} className="w-full btn-accent text-white font-semibold py-3 rounded-xl">
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
