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
import { Gamepad2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { supabase } from "../lib/supabase";
import logo from "../assets/sjo-logo-full.png";

export default function Welcome({ onContinue }) {
  // Opens the standalone SJO Games site. On native, a plain <a target="_blank">
  // would hand off to the system browser (Chrome) instead of staying inside
  // the app, so it goes through an in-app Custom Tab instead (same reasoning
  // as submitWithGoogle in Login.jsx).
  const GAMES_URL = "https://sjo-games-vercel-app.vercel.app/games/index.html";
  const openGames = async () => {
    // Hand off the current session so someone already logged into the
    // portal doesn't have to log in again on the games site. Both apps
    // share the same Supabase project, so the games site can adopt this
    // session directly via supabase.auth.setSession(). Tokens travel in
    // the URL only once and are stripped immediately by the games site.
    const { data: { session } } = await supabase.auth.getSession();
    let url = GAMES_URL;
    if (session) {
      const params = new URLSearchParams({
        at: session.access_token,
        rt: session.refresh_token,
      });
      url = `${GAMES_URL}?${params.toString()}`;
    }

    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-[#0f1b3d] flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-white rounded-2xl p-8 shadow-xl">
            <img src={logo} alt="Sharma Ji Ka Office" className="w-full max-w-[240px] mx-auto mb-4" />
            <p className="text-slate-500 text-sm leading-relaxed mb-6">
              Your trusted partner for Driving Licence, RC Transfer, PCC and other RTO services.
            </p>

            {/* Two entry points: our Stamps & Prints storefront (a separate
                site — see sharma-ji-stamps.vercel.app), and the RTO/PCC
                service, which continues into Login on this same app. */}
            <div className="space-y-3">
              <a
                href="https://sharma-ji-stamps.vercel.app/"
                className="block w-full border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl"
              >
                Stamps &amp; Prints
              </a>
              <button onClick={onContinue} className="w-full btn-accent text-white font-semibold py-3 rounded-xl">
                Backend
              </button>

              <button
                type="button"
                onClick={openGames}
                className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl mt-3"
              >
                <Gamepad2 size={18} />
                SJO Games
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Public footer — this is the part Cashfree (and any payment-gateway
          KYC crawler) needs to reach without hitting a login wall. Kept
          plain <a href> links (real navigations, not client-side nav
          callbacks) so they work as standalone routes — see App.jsx's
          LEGAL_ROUTES check, which serves these before any auth logic. */}
      <footer className="text-white/50 text-xs sm:text-sm py-6 px-4">
        <div className="max-w-sm mx-auto text-center space-y-2">
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            <a href="/privacy-policy" className="hover:text-white/80">Privacy Policy</a>
            <a href="/terms-and-conditions" className="hover:text-white/80">Terms &amp; Conditions</a>
            <a href="/refund-policy" className="hover:text-white/80">Refund Policy</a>
            <a href="/contact-us" className="hover:text-white/80">Contact Us</a>
          </nav>
          <p>Dayalpur, 33 Ft Road, North East Delhi – 110094 · 9899029807</p>
          <p>© {new Date().getFullYear()} Sharma Ji Ka Office</p>
        </div>
      </footer>
    </div>
  );
}
