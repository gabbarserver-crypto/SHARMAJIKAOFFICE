// src/pages/Login.jsx
import React, { useState } from "react";
import { Eye, EyeOff, Fingerprint } from "lucide-react";
import { supabase } from "../lib/supabase";
import logo from "../assets/sjo-logo-full.png";

export default function Login({ authError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Forgot Password (point 4) — swaps the login form for a small email-only
  // form, sends a reset link via Supabase Auth. Clicking that link in the
  // email brings them back here with a PASSWORD_RECOVERY session, which
  // App.jsx intercepts and routes to ResetPassword.jsx instead of Login.
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");

  const sendResetEmail = async (e) => {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: window.location.origin,
    });
    setForgotLoading(false);
    if (resetError) {
      setForgotError(resetError.message);
      return;
    }
    setForgotSent(true);
  };

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

  // Fingerprint/Face ID login (point 17) — experimental Supabase Passkeys.
  // Requires the person to have already registered a passkey once (from
  // inside the dealer/staff portal after a normal password login — see the
  // "Set up Fingerprint Login" button there), and requires Passkeys enabled
  // + this domain set as the Relying Party in Supabase Dashboard →
  // Authentication → Passkeys.
  const submitWithPasskey = async () => {
    setError("");
    setPasskeyLoading(true);
    const { error: passkeyError } = await supabase.auth.signInWithPasskey();
    setPasskeyLoading(false);
    if (passkeyError) setError(passkeyError.message);
  };

  const displayError = error || authError;

  if (showForgot) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 shadow-sm border border-slate-100">
          <div className="text-center mb-6">
            <img src={logo} alt="Sharma Ji Ka Office" className="w-full max-w-[240px] mx-auto mb-2" />
          </div>

          {forgotSent ? (
            <>
              <h1 className="text-xl font-extrabold text-slate-900 text-center">Check your email</h1>
              <p className="text-slate-400 text-sm text-center mt-1 mb-6">
                We've sent a password reset link to <span className="font-medium text-slate-600">{forgotEmail}</span>.
                Click it to set a new password.
              </p>
              <button
                onClick={() => { setShowForgot(false); setForgotSent(false); }}
                className="w-full border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl"
              >
                Back to Login
              </button>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold text-slate-900 text-center">Reset your password</h1>
              <p className="text-slate-400 text-sm text-center mt-1 mb-6">Enter your email and we'll send you a reset link</p>
              <form onSubmit={sendResetEmail}>
                <label className="block text-xs font-semibold text-blue-600 mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
                  placeholder="example@email.com"
                />
                {forgotError && <p className="text-rose-500 text-xs mb-3">{forgotError}</p>}
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl mt-3 disabled:opacity-50"
                >
                  {forgotLoading ? "Sending..." : "Send Reset Link"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForgot(false)}
                  className="w-full text-slate-400 hover:text-slate-600 text-sm mt-3"
                >
                  Back to Login
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-8 shadow-sm border border-slate-100">
        <div className="text-center mb-6">
          <img src={logo} alt="Sharma Ji Ka Office" className="w-full max-w-[240px] mx-auto mb-2" />
        </div>

        <h1 className="text-2xl font-extrabold text-slate-900 text-center leading-tight">Login to your account.</h1>
        <p className="text-slate-400 text-sm text-center mt-1 mb-6">Hello, welcome back to your account</p>

        <form onSubmit={submit}>
          <label className="block text-xs font-semibold text-blue-600 mb-1">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
            placeholder="example@email.com"
          />

          <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
          <div className="relative mb-2">
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
              placeholder="Your Password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="flex items-center justify-between text-xs mb-4 mt-3">
            <label className="flex items-center gap-1.5 text-slate-500">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded" />
              Remember me
            </label>
            <a href="#" onClick={(e) => { e.preventDefault(); setShowForgot(true); setForgotEmail(email); }} className="text-blue-600 font-medium hover:underline">Forgot Password?</a>
          </div>

          {displayError && <p className="text-rose-500 text-xs mb-3">{displayError}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-400">or</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <button
          onClick={submitWithPasskey}
          disabled={passkeyLoading}
          className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl disabled:opacity-50"
        >
          <Fingerprint size={18} />
          {passkeyLoading ? "Waiting for fingerprint / Face ID…" : "Sign in with Fingerprint / Face ID"}
        </button>
      </div>
    </div>
  );
}
