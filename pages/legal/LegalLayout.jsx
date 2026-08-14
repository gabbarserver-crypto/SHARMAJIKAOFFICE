// src/pages/legal/LegalLayout.jsx
//
// Shared chrome for the public policy pages (Privacy, Terms, Refund,
// Contact Us). These are plain, unauthenticated routes — see App.jsx's
// LEGAL_ROUTES check, which renders one of these before any Supabase/auth
// logic even runs, so they're reachable with no login and no session at
// all (required for payment-gateway KYC verification of the site).
import React from "react";
import logo from "../../assets/one-infinity-logo-full.png";

export default function LegalLayout({ title, updated, children }) {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-[#0f1b3d]">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <img src={logo} alt="One Infinity" className="h-8 w-auto" />
          </a>
          <a href="/" className="text-white/70 hover:text-white text-sm">
            ← Back to home
          </a>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-5 py-10">
          <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-10">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">{title}</h1>
            {updated && <p className="text-sm text-slate-400 mb-8">Last updated: {updated}</p>}
            <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed space-y-4">
              {children}
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-[#0f1b3d] text-white/60 text-sm">
        <div className="max-w-3xl mx-auto px-5 py-6 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>© {new Date().getFullYear()} One Infinity</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/privacy-policy" className="hover:text-white">Privacy Policy</a>
            <a href="/terms-and-conditions" className="hover:text-white">Terms &amp; Conditions</a>
            <a href="/refund-policy" className="hover:text-white">Refund Policy</a>
            <a href="/contact-us" className="hover:text-white">Contact Us</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
