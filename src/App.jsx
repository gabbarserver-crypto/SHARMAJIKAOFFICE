// src/App.jsx
import React, { useEffect, useState, useCallback } from "react";
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
  // authStatus: "loading" | "signed-out" | "signed-in"
  const [authStatus, setAuthStatus] = useState("loading");
  const [staff, setStaff] = useState(null);
  const [authError, setAuthError] = useState("");
  const [active, setActive] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // The single source of truth for "are we actually allowed in" —
  // this only ever runs to completion BEFORE we show the Dashboard,
  // so there's no flash-then-logout race.
  const verifySession = useCallback(async (session) => {
    if (!session) {
      setStaff(null);
      setAuthStatus("signed-out");
      return;
    }
    const { data: staffRow, error } = await supabase
      .from("staff")
      .select("id, full_name, role_id")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (error) {
      setAuthError("Couldn't verify your staff profile: " + error.message);
      await supabase.auth.signOut();
      setStaff(null);
      setAuthStatus("signed-out");
      return;
    }
    if (!staffRow) {
      setAuthError("This account isn't linked to a staff profile. Contact your admin.");
      await supabase.auth.signOut();
      setStaff(null);
      setAuthStatus("signed-out");
      return;
    }
    setAuthError("");
    setStaff(staffRow);
    setAuthStatus("signed-in");
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => verifySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      verifySession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [verifySession]);

  if (authStatus === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;
  }

  if (authStatus === "signed-out") {
    return <Login authError={authError} />;
  }

  const Active = NAV.find((n) => n.key === active)?.Component || Dashboard;

  return (
    <div className="min-h-screen bg-slate-100 flex">
      <aside
        className={`shrink-0 bg-[#0f1b3d] text-slate-300 flex flex-col transition-all duration-200 overflow-hidden ${
          sidebarOpen ? "w-60" : "w-0"
        }`}
      >
        <div className="w-60 flex flex-col h-full">
          <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-white font-bold text-lg leading-tight truncate">Sharma Ji Ka Office</p>
              <p className="text-xs text-slate-400">RTO Services ERP — Admin</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/10"
            >
              ‹
            </button>
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
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-y-auto relative">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
            className="fixed top-4 left-4 z-40 w-8 h-8 flex items-center justify-center rounded-md bg-[#0f1b3d] text-slate-300 hover:text-white shadow-lg"
          >
            ›
          </button>
        )}
        <Active />
      </main>
    </div>
  );
}
