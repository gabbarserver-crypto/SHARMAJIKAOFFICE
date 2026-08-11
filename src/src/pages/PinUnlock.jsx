// src/pages/PinUnlock.jsx
import React, { useState } from "react";
import { verifyPin } from "../lib/pinLock";
import PinPad from "../components/PinPad";
import logo from "../assets/sjo-logo-full.png";

// Shown instead of the normal Dashboard/DealerPortal when a valid Supabase
// session already exists on this device AND a PIN has been set up for
// this user — a quick "unlock" gate rather than a full re-login. Getting
// the PIN wrong doesn't touch Supabase at all (it's a local check), so
// there's no lockout/rate-limit concern from repeated tries — the actual
// account security still rests on the underlying login.
export default function PinUnlock({ userId, userLabel, onUnlocked, onSignOut }) {
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const handleComplete = async (pin) => {
    setChecking(true);
    const ok = await verifyPin(userId, pin);
    setChecking(false);
    if (ok) {
      onUnlocked();
    } else {
      setError("Incorrect PIN");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-8 shadow-sm border border-slate-100 text-center">
        <img src={logo} alt="Sharma Ji Ka Office" className="w-full max-w-[200px] mx-auto mb-4" />
        <p className="text-slate-500 text-sm mb-1">Welcome back,</p>
        <p className="text-slate-800 font-semibold mb-6">{userLabel}</p>

        <PinPad length={4} onComplete={handleComplete} error={error} disabled={checking} />

        <button onClick={onSignOut} className="text-xs text-slate-400 hover:text-slate-600 mt-6">
          Not you, or forgot your PIN? Sign out
        </button>
      </div>
    </div>
  );
}
