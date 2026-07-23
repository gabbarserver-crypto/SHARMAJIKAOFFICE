// src/App.jsx
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "./lib/supabase";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Applications, { StaffApplications } from "./pages/Applications";
import Payments from "./pages/Payments";
import Ledger from "./pages/Ledger";import Reports from "./pages/Reports";
import Masters from "./pages/Masters";
import Settings from "./pages/Settings";
import Chats from "./pages/Chats";
import DealerPortal from "./pages/DealerPortal";
import StaffChatWidget from "./components/StaffChatWidget";
import GlobalCallOverlay from "./components/GlobalCallOverlay";
import NotificationToaster from "./components/NotificationToaster";
import { useDirectCall } from "./lib/directCall";
import { notify, requestNotificationPermission } from "./lib/notify";
import { identityFor, countOpenThreads } from "./lib/chat";
import PinUnlock from "./pages/PinUnlock";
import SetupPinPrompt from "./components/SetupPinPrompt";
import { hasPinSetUp, hasBeenPromptedForPin } from "./lib/pinLock";

// Thin wrappers so "Dealer" and "Agency" can be their own sidebar entries
// (each scoped to just that one head + its transaction ledger) while still
// sharing the same Ledger page code and the same "ledger" permission.
function DealerLedgerPage({ initialEntityId }) { return <Ledger only="dealer" initialEntityId={initialEntityId} />; }
function AgencyLedgerPage({ initialEntityId }) { return <Ledger only="agency" initialEntityId={initialEntityId} />; }

const NAV = [
  { key: "dashboard", label: "Dashboard", Component: Dashboard },
  { key: "applications", label: "Applications", Component: Applications },
  { key: "staffApplications", label: "Staff View", Component: StaffApplications },
  { key: "chats", label: "Call/Chat", Component: Chats },
  { key: "masters", label: "Masters", Component: Masters },
  { key: "payments", label: "Payments", Component: Payments },
  { key: "ledger", label: "Ledger", Component: Ledger },
  { key: "dealerLedger", label: "Dealer", Component: DealerLedgerPage },
  { key: "agencyLedger", label: "Agency", Component: AgencyLedgerPage },
  { key: "reports", label: "Reports", Component: Reports },
  { key: "settings", label: "Settings", Component: Settings },
];

// Each NAV key maps to a `module` value in the `permissions` table — driven
// by role, from Settings → Permissions. "Admin" always sees every tab and
// has full write/approve rights; every other role is gated by its row in
// `permissions` (can_view controls the tab, can_edit controls inline table
// edits, can_approve controls the Approve action).
const MODULE_BY_NAV_KEY = {
  dashboard: "dashboard",
  applications: "applications",
  staffApplications: "staffApplications",
  chats: "chats",
  masters: "masters",
  payments: "payments",
  ledger: "ledger",
  dealerLedger: "ledger",
  agencyLedger: "ledger",
  reports: "reports",
  settings: "settings",
};

export default function App() {
  // authStatus: "loading" | "signed-out" | "signed-in"
  const [authStatus, setAuthStatus] = useState("loading");
  const [staff, setStaff] = useState(null);
  const [dealer, setDealer] = useState(null);
  const [dealerStaff, setDealerStaff] = useState(null); // set only for a dealer sub-staff login
  const [authError, setAuthError] = useState("");
  const [authUserId, setAuthUserId] = useState(null); // Supabase auth user id — stable across staff/dealer/dealer_staff, used to scope the device PIN
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  // A "Open in New Tab" link (see Ledger.jsx) points here as
  // ?nav=dealerLedger&entity=<id> — read once on load so the new tab lands
  // straight on that dealer/agency's ledger instead of the dashboard.
  const initialUrlParams = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const [active, setActive] = useState(initialUrlParams.get("nav") || "dashboard");
  const initialEntityId = initialUrlParams.get("entity") || null;
  const [pendingChatCount, setPendingChatCount] = useState(0);
  const [permMap, setPermMap] = useState({}); // { [module]: permissions row } for the staff member's role
  const roleName = staff?.roles?.role_name || null;
  const isAdmin = roleName === "Admin";

  // Load the role's permission rows whenever the signed-in staff member (or
  // their role) changes. Empty for dealer/dealer-staff logins — DealerPortal
  // has its own tab logic (Dealer vs Dealer Staff) and doesn't use this.
  useEffect(() => {
    if (!staff?.role_id) { setPermMap({}); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("permissions").select("*").eq("role_id", staff.role_id);
      if (cancelled) return;
      const map = {};
      (data || []).forEach((row) => { map[row.module] = row; });
      setPermMap(map);
    })();
    return () => { cancelled = true; };
  }, [staff?.role_id]);

  // Admin bypasses permissions entirely and sees every tab except the
  // restricted "Staff View" (which exists only as the Staff role's
  // column-limited substitute for the full Applications tab).
  const visibleNav = React.useMemo(() => {
    if (!staff) return NAV;
    if (isAdmin) return NAV.filter((n) => n.key !== "staffApplications");
    return NAV.filter((n) => permMap[MODULE_BY_NAV_KEY[n.key]]?.can_view);
  }, [staff, isAdmin, permMap]);

  // If the current tab isn't in the visible set (role changed, or the
  // default "dashboard" isn't permitted for this role), jump to the first
  // tab that is.
  useEffect(() => {
    if (!visibleNav.length) return;
    if (!visibleNav.some((n) => n.key === active)) setActive(visibleNav[0].key);
  }, [visibleNav, active]);

  const activeModule = MODULE_BY_NAV_KEY[active];
  const canEditActive = !staff || isAdmin || !!permMap[activeModule]?.can_edit;
  const canApproveActive = !staff || isAdmin || !!permMap[activeModule]?.can_approve;

  const refreshPendingChatCount = useCallback(async () => {
    try {
      setPendingChatCount(await countOpenThreads());
    } catch {
      // Best-effort — a failed badge refresh shouldn't be visible to staff,
      // it should just leave the last-known count in place.
    }
  }, []);

  useEffect(() => {
    if (!staff) return;
    refreshPendingChatCount();
    // Recheck periodically...
    const interval = setInterval(refreshPendingChatCount, 30000);
    // ...and immediately whenever any new message comes in anywhere, so the
    // badge doesn't wait up to 30s to reflect a message that just arrived —
    // and pop a toast (+ sound) for it too, as long as it isn't our own
    // message coming back through the realtime feed.
    const channel = supabase
      .channel(`chat_messages:sidebar-badge:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        refreshPendingChatCount();
        const m = payload.new;
        if (m && m.sender_type !== "staff") {
          notify({
            kind: "chat",
            title: m.sender_name || "New message",
            body: m.body || (m.attachment_url ? "Sent an image" : ""),
            onClick: () => setActive("chats"),
          });
        }
      })
      .subscribe();
    // New draft applications — a dealer submitting a new application is
    // work staff needs to pick up, so it gets the same toast+sound
    // treatment as an incoming chat message.
    const draftsChannel = supabase
      .channel(`applications:new-draft:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "applications" }, (payload) => {
        const a = payload.new;
        if (a?.status === "Draft Submitted") {
          notify({
            kind: "draft",
            title: "New draft application",
            body: `${a.draft_code || a.application_no || ""} — ${a.applicant_name || ""}`.trim(),
            onClick: () => setActive("applications"),
          });
        }
      })
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
      supabase.removeChannel(draftsChannel);
    };
  }, [staff, refreshPendingChatCount]);

  // Ask for browser/OS notification permission once, right after sign-in —
  // covers the "tab isn't focused" case in lib/notify.js. Harmless no-op on
  // platforms that don't support the Notification API.
  useEffect(() => {
    if (staff || dealer || dealerStaff) requestNotificationPermission();
  }, [staff, dealer, dealerStaff]);

  // The single source of truth for "are we actually allowed in" —
  // this only ever runs to completion BEFORE we show the Dashboard,
  // so there's no flash-then-logout race.
  // Checks staff first (full admin access), then falls back to dealers
  // (restricted, own-data-only portal). Same login screen serves both.
  const verifySession = useCallback(async (session) => {
    setAuthUserId(session?.user?.id || null);
    if (!session) {
      setStaff(null);
      setDealer(null);
      setDealerStaff(null);
      setAuthStatus("signed-out");
      return;
    }

    const { data: staffRow, error: staffError } = await supabase
      .from("staff")
      .select("id, full_name, role_id, roles(role_name)")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (staffError) {
      setAuthError("Couldn't verify your profile: " + staffError.message);
      await supabase.auth.signOut();
      setStaff(null); setDealer(null); setDealerStaff(null);
      setAuthStatus("signed-out");
      return;
    }

    if (staffRow) {
      setAuthError("");
      setStaff(staffRow);
      setDealer(null);
      setDealerStaff(null);
      setAuthStatus("signed-in");
      return;
    }

    const { data: dealerRow, error: dealerError } = await supabase
      .from("dealers")
      .select("id, name, short_name, code, credit_limit, wallet_balance")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (dealerError) {
      setAuthError("Couldn't verify your dealer profile: " + dealerError.message);
      await supabase.auth.signOut();
      setStaff(null); setDealer(null); setDealerStaff(null);
      setAuthStatus("signed-out");
      return;
    }

    if (dealerRow) {
      setAuthError("");
      setStaff(null);
      setDealerStaff(null);
      setDealer(dealerRow);
      setAuthStatus("signed-in");
      return;
    }

    // Not a primary dealer login either — check if it's one of a dealer's
    // own sub-staff logins (dealer_staff). Same restricted DealerPortal,
    // scoped to the parent dealer, but messages/identity are their own.
    const { data: dealerStaffRow, error: dealerStaffError } = await supabase
      .from("dealer_staff")
      .select("id, full_name, dealer_id, active, dealers(id, name, short_name, code, credit_limit, wallet_balance)")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (dealerStaffError) {
      setAuthError("Couldn't verify your profile: " + dealerStaffError.message);
      await supabase.auth.signOut();
      setStaff(null); setDealer(null); setDealerStaff(null);
      setAuthStatus("signed-out");
      return;
    }

    if (!dealerStaffRow || !dealerStaffRow.active || !dealerStaffRow.dealers) {
      setAuthError("This account isn't linked to a staff or dealer profile. Contact your admin.");
      await supabase.auth.signOut();
      setStaff(null); setDealer(null); setDealerStaff(null);
      setAuthStatus("signed-out");
      return;
    }

    setAuthError("");
    setStaff(null);
    setDealerStaff({ id: dealerStaffRow.id, full_name: dealerStaffRow.full_name, dealer_id: dealerStaffRow.dealer_id });
    setDealer(dealerStaffRow.dealers);
    setAuthStatus("signed-in");
  }, []);

  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => verifySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase fires this when someone lands back on the app via a
      // "Forgot Password" email link — show the reset-password screen
      // instead of routing them into the normal Dashboard/DealerPortal,
      // even though they technically now have a (temporary) session.
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        return;
      }
      verifySession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [verifySession]);

  // PIN lock gating (keyed on authUserId, not on every verifySession call,
  // so a background token refresh doesn't re-lock an already-unlocked
  // session — only an actual sign-in/sign-out changes authUserId).
  useEffect(() => {
    if (!authUserId) {
      setPinUnlocked(false);
      setShowPinSetup(false);
      return;
    }
    setPinUnlocked(false);
    setShowPinSetup(!hasPinSetUp(authUserId) && !hasBeenPromptedForPin(authUserId));
  }, [authUserId]);

  const userLabel = staff?.full_name || dealer?.name || dealerStaff?.full_name || "there";

  // One identity for whoever is signed in — staff, a dealer's own login, or
  // one of a dealer's sub-staff logins. Used both for chat (as before) and
  // now for direct person-to-person calling (see lib/directCall.js). The
  // useDirectCall() listener has to be mounted unconditionally, every
  // render, so it's up here — above the early returns below — otherwise a
  // staff member on, say, the Applications tab would never hear an
  // incoming call ring at all.
  const myIdentity = staff
    ? identityFor({ staff })
    : identityFor({ dealer: dealerStaff ? null : dealer, dealerStaff });
  const directCall = useDirectCall({ identity: myIdentity });


  if (passwordRecovery) {
    return <ResetPassword onDone={() => { setPasswordRecovery(false); supabase.auth.signOut(); }} />;
  }

  if (authStatus === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;
  }

  if (authStatus === "signed-out") {
    return <Login authError={authError} />;
  }

  if (authUserId && hasPinSetUp(authUserId) && !pinUnlocked) {
    return (
      <PinUnlock
        userId={authUserId}
        userLabel={userLabel}
        onUnlocked={() => setPinUnlocked(true)}
        onSignOut={() => supabase.auth.signOut()}
      />
    );
  }

  const pinSetupOverlay = showPinSetup && (
    <SetupPinPrompt userId={authUserId} onDone={() => setShowPinSetup(false)} />
  );

  if (dealer) {
    return (
      <>
        <DealerPortal dealer={dealer} identity={myIdentity} call={directCall} onLogout={() => supabase.auth.signOut()} />
        <GlobalCallOverlay call={directCall} />
        <NotificationToaster />
        {pinSetupOverlay}
      </>
    );
  }

  const Active = NAV.find((n) => n.key === active)?.Component || Dashboard;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex">
      <Sidebar
        nav={visibleNav}
        active={active}
        onNavigate={(key) => { setActive(key); refreshPendingChatCount(); }}
        staff={staff}
        badges={{ chats: pendingChatCount }}
        onLogout={() => supabase.auth.signOut()}
      />
      <main className="flex-1 p-8 overflow-y-auto">
        <Active staff={staff} canEdit={canEditActive} canApprove={canApproveActive} initialEntityId={initialEntityId} call={directCall} />
      </main>
      <StaffChatWidget
        staff={staff}
        identity={myIdentity}
        pendingCount={pendingChatCount}
        onExpand={() => setActive("chats")}
      />
      <GlobalCallOverlay call={directCall} />
      <NotificationToaster />
      {pinSetupOverlay}
    </div>
  );
}
