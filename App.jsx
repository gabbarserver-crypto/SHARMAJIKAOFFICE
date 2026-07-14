// src/App.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Applications from "./pages/Applications";
import Payments from "./pages/Payments";
import Ledger from "./pages/Ledger";
import Reports from "./pages/Reports";
import Masters from "./pages/Masters";
import Settings from "./pages/Settings";

const NAV = [
  { key: "dashboard", label: "Dashboard", Component: Dashboard },
  { key: "applications", label: "Applications", Component: Applications },
  { key: "masters", label: "Masters", Component: Masters },
  { key: "payments", label: "Payments", Component: Payments },
  { key: "ledger", label: "Ledger", Component: Ledger },
  { key: "reports", label: "Reports", Component: Reports },
  { key: "settings", label: "Settings", Component: Settings },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [staff, setStaff] = useState(null);
  const [active, setActive] = useState("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;
  }

  if (!session) {
    return <Login onLoggedIn={setStaff} />;
  }

  const Active = NAV.find((n) => n.key === active)?.Component || Dashboard;

  return (
    <div className="min-h-screen bg-slate-100 flex">
      <aside className="w-60 shrink-0 bg-[#0f1b3d] text-slate-300 flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <p className="text-white font-bold text-lg leading-tight">Sharma Ji Ka Office</p>
          <p className="text-xs text-slate-400">RTO Services ERP — Admin</p>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setActive(n.key)}
              className={`w-full text-left px-5 py-2.5 text-sm transition-colors ${
                active === n.key ? "bg-blue-600 text-white font-medium" : "hover:bg-white/5 text-slate-300"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between">
          <span className="text-xs text-slate-400 truncate">{staff?.full_name || "Signed in"}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs text-slate-400 hover:text-white font-semibold"
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-y-auto">
        <Active />
      </main>
    </div>
  );
}
