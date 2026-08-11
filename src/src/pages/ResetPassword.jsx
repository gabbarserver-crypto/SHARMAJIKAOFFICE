// src/pages/ResetPassword.jsx
import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import logo from "../assets/sjo-logo-full.png";

// Shown instead of the normal Dashboard/DealerPortal/Login when App.jsx
// detects a PASSWORD_RECOVERY auth event — i.e. someone clicked the reset
// link from their "Forgot Password" email and landed back on the app.
// Supabase gives them a temporary session at that point, just enough to
// call updateUser({ password }) once; onDone signs them out of that
// temporary session afterward so they log in fresh with the new password.
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-8 shadow-sm border border-slate-100">
        <div className="text-center mb-6">
          <img src={logo} alt="Sharma Ji Ka Office" className="w-full max-w-[220px] mx-auto mb-2" />
        </div>

        {done ? (
          <>
            <h1 className="text-xl font-extrabold text-slate-900 text-center">Password updated</h1>
            <p className="text-slate-400 text-sm text-center mt-1 mb-6">You can log in with your new password now.</p>
            <button
              onClick={onDone}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl"
            >
              Continue to Login
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-extrabold text-slate-900 text-center">Set a new password</h1>
            <p className="text-slate-400 text-sm text-center mt-1 mb-6">Choose a new password for your account</p>
            <form onSubmit={submit}>
              <label className="block text-xs font-semibold text-slate-500 mb-1">New Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
              />
              <label className="block text-xs font-semibold text-slate-500 mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
              />
              {error && <p className="text-rose-500 text-xs mb-3">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl mt-3 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Update Password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
