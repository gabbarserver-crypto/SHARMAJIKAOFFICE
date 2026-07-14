// src/pages/Login.jsx
import React, { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login({ authError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    // If sign-in succeeded, App.jsx's onAuthStateChange listener takes over from
    // here — it verifies the staff link before ever showing the Dashboard, and
    // will feed back `authError` (via props) if that check fails.
  };

  const displayError = error || authError;

  return (
    <div className="min-h-screen bg-[#0f1b3d] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full border-2 border-amber-500 mx-auto flex items-center justify-center mb-3">
            <span className="font-extrabold text-lg tracking-wide text-slate-800">SJO</span>
          </div>
          <h1 className="font-bold text-slate-800 text-lg">Sharma Ji Ka Office</h1>
          <p className="text-slate-400 text-sm">Admin / Staff Login</p>
        </div>

        <form onSubmit={submit}>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder="you@office.com"
          />
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          {displayError && <p className="text-rose-500 text-xs mb-3">{displayError}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg mt-3 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
