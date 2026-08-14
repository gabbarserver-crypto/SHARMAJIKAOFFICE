// src/pages/DealerPortal.jsx
// Restricted view shown to a Dealer login (as opposed to Staff, who get
// the full admin app via App.jsx + Sidebar). A dealer can only ever see
// their own applications and their own ledger — enforced both here
// (queries always filter by dealer.id) and at the database level via
// the RLS policies added in enable_dealer_login.sql.
import React, { useCallback, useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Card, StatusBadge, Modal, Field, Input, Select, PrimaryButton, GhostButton, Toast } from "../components/UI";
import CommsWindow from "../components/CommsWindow";
import ChatPanel from "../components/ChatPanel";
import CallLogPanel from "../components/CallLogPanel";
import ApplicationChatModal from "../components/ApplicationChatModal";
import BookAppointmentModal from "../components/BookAppointmentModal";
import { isEligibleForAppointment, copyForwardDocuments } from "../lib/nextService";
import { getOrCreateThread, sendMessage, countDealerUnread, listRecentThreadsForDealer } from "../lib/chat";
import { notify } from "../lib/notify";
import { createDealerStaffLogin, sendPush } from "../lib/serverApi";
import { DELHI_POLICE_STATIONS } from "../lib/delhiPoliceStations";
import { ageHighlightClass, validateAgeForService } from "../lib/age";
import { scanAadhaarQr, isAadhaarQrScanSupported } from "../lib/aadhaarQr";
import { scanAadhaarImage } from "../lib/aadhaarOcr";
import { useDarkMode } from "../lib/theme";
import { Sun, Moon, Fingerprint, Download, Phone, ScanLine, ScanText, Gamepad2 } from "lucide-react";
import SearchableSelect from "../components/SearchableSelect";
import QrPaymentPanel from "../components/QrPaymentPanel";
import PCCStatusCheckModal from "../components/PCCStatusCheckModal";
import ImageCropModal from "../components/ImageCropModal";
import DealerBottomTabBar from "../components/DealerBottomTabBar";
import DocUploadDropzone from "../components/DocUploadDropzone";
import PastelAvatar from "../components/PastelAvatar";
import { Search, Users } from "lucide-react";
import { loadSeenMap, saveSeenMap, isThreadSeen } from "../lib/threadSeen";
// (Ledger's description-parsing helpers are gone — dealer_ledger already
// carries ledger_type / display_name as real columns, so nothing needs
// importing from Ledger.jsx anymore.)
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

// Same file the Dashboard's "Download App" card points to (see
// src/pages/Dashboard.jsx) — one APK, linked from every portal.
// IMPORTANT: this is a GitHub Releases URL, NOT a local /public file.
// Do not put the .apk back under public/downloads/ — Capacitor copies the
// entire dist/ (which includes everything in public/) into the native
// Android app's own assets at build time, so a self-hosted APK there ends
// up bundled INSIDE the app itself, ballooning its size with every build
// (this is what caused the app to balloon to ~100MB+ before).
const APK_PATH = "https://github.com/gabbarserver-crypto/one-infinity/releases/latest/download/app-1infinity.apk";

// 1 Infinity Games — same standalone games site linked from the staff Dashboard
// (see src/pages/Dashboard.jsx), handing off the current Supabase session
// so a dealer who's already logged in here doesn't have to log in again
// there. Tokens travel in the URL only once and are stripped immediately
// on arrival — see sjo-supabase-sync.js on the games site.
const GAMES_URL = "https://sjo-games-vercel-app.vercel.app/games/index.html";
const openGames = async () => {
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

const TABS = ["Applications", "Call/Chat", "Ledger", "Service", "Payments"];

// Small reusable sortable <th> — click toggles asc/desc on that column,
// clicking a different column switches to it (asc first). Shared by the
// Applications and Ledger tables below.
function SortableTh({ label, sortKeyName, sortKey, sortDir, onSort, align = "left" }) {
  const active = sortKey === sortKeyName;
  return (
    <th
      onClick={() => onSort(sortKeyName)}
      className={`font-medium px-3 py-2 cursor-pointer select-none whitespace-nowrap hover:text-slate-700 dark:hover:text-slate-300 ${align === "right" ? "text-right" : "text-left"}`}
    >
      {label} {active && (sortDir === "asc" ? "↑" : "↓")}
    </th>
  );
}

// `identity` is { type: 'dealer' | 'dealer_staff', id, name } — resolved in
// App.jsx from whichever login this is. It's what scopes chat messages to
// "who sent this", while `dealer.id` (the parent dealer, same for both a
// dealer's own login and any of their sub-staff) scopes *which* dealer's
// data/threads this portal shows. `call` is the useDirectCall() controller,
// mounted once in App.jsx, for ringing a specific named admin staff member
// straight from the "Our Team" directory on the Call/Chat tab.
export default function DealerPortal({ dealer, identity, call, onLogout }) {
  const [tab, setTab] = useState("Applications");
  const [showNew, setShowNew] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [docsForApp, setDocsForApp] = useState(null); // { id, applicant_name } | null
  const [chatApp, setChatApp] = useState(null); // { id, label } | null
  const [unreadChats, setUnreadChats] = useState(0);
  const [runningBalance, setRunningBalance] = useState(null);
  const [showQr, setShowQr] = useState(false);
  // Ref into the shared CommsWindow (Recent Chats/Recent Calls/New Call/
  // Customer Chat) so the mobile bottom tab bar can open it directly —
  // see DealerBottomTabBar's "Call/Chat" handling below.
  const commsRef = useRef(null);

  // Running Balance shown beside Credit Limit in the summary cards — same
  // computation as the "My Ledger" tab (DealerLedger below), just lifted up
  // here too so it's visible without switching tabs.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("dealer_ledger_balances").select("running_balance").eq("dealer_id", dealer.id).maybeSingle();
      if (error) {
        // Leave runningBalance as-is (null on first load shows "…", a
        // stale-but-real number on refresh stays put) rather than falling
        // through to a confidently wrong ₹0 on a failed fetch.
        console.error("Couldn't load running balance:", error.message);
        return;
      }
      // No row at all means this dealer has no ledger activity yet — that's
      // a real ₹0, not a fetch failure, so it's fine to default here.
      setRunningBalance(Number(data?.running_balance || 0));
    })();
  }, [dealer.id, refreshKey]);

  const refreshUnreadChats = useCallback(async () => {
    try {
      setUnreadChats(await countDealerUnread(dealer.id));
    } catch {
      // Best-effort — a failed badge refresh just leaves the last-known count.
    }
  }, [dealer.id]);

  useEffect(() => {
    refreshUnreadChats();
    const interval = setInterval(refreshUnreadChats, 30000);
    const channel = supabase
      .channel(`chat_messages:dealer-badge:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, async (payload) => {
        refreshUnreadChats();
        const m = payload.new;
        if (!m || m.sender_type !== "staff") return;
        // chat_messages doesn't carry dealer_id directly — this fires for
        // every dealer's messages, so confirm the thread is actually ours
        // before notifying (refreshUnreadChats above is already dealer-
        // scoped internally, this check is just for the toast).
        const { data: thread } = await supabase.from("chat_threads").select("dealer_id").eq("id", m.thread_id).maybeSingle();
        if (thread?.dealer_id !== dealer.id) return;
        notify({
          kind: "chat",
          title: m.sender_name || "New message",
          body: m.body || (m.attachment_url ? "Sent an image" : ""),
          onClick: () => setTab("Call/Chat"),
        });
      })
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [refreshUnreadChats]);

  const postSystemMessage = async (text, applicationId = null) => {
    try {
      const thread = await getOrCreateThread({ dealerId: dealer.id, applicationId });
      await sendMessage({ threadId: thread.id, sender: { ...identity, body: text } });
      sendPush({ targetType: "all_staff", title: identity?.name || "New message", body: text, data: { kind: "chat" } });
    } catch {
      // Best-effort — a missed system note shouldn't block the flow that triggered it.
    }
  };

  const visibleTabs = identity?.type === "dealer" ? [...TABS, "Staff"] : TABS;
  const [dark, toggleDark] = useDarkMode();
  const [passkeyMsg, setPasskeyMsg] = useState("");
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

  // Load the current photo for whichever identity is logged in — the
  // dealer owner, or one of their sub-staff logins.
  useEffect(() => {
    (async () => {
      const table = identity?.type === "dealer_staff" ? "dealer_staff" : "dealers";
      const id = identity?.type === "dealer_staff" ? identity.id : dealer.id;
      if (!id) return;
      const { data } = await supabase.from(table).select("photo_url").eq("id", id).maybeSingle();
      setPhotoUrl(data?.photo_url || null);
    })();
  }, [identity, dealer.id]);

  const uploadProfilePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      const table = identity?.type === "dealer_staff" ? "dealer_staff" : "dealers";
      const id = identity?.type === "dealer_staff" ? identity.id : dealer.id;
      const ext = file.name.split(".").pop();
      const path = `${uid}/dealer-${id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("profile-photos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("profile-photos").getPublicUrl(path);
      await supabase.from(table).update({ photo_url: pub.publicUrl }).eq("id", id);
      setPhotoUrl(pub.publicUrl);
    } catch (err) {
      setToast("Couldn't upload photo: " + err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Registers a passkey (fingerprint/Face ID/device PIN) for the currently
  // signed-in account so they can use "Sign in with Fingerprint / Face ID"
  // on the login screen afterward. Experimental Supabase API — see the note
  // in lib/supabase.js. Needs Passkeys enabled + this domain set as the
  // Relying Party in Supabase Dashboard first, or this will error out.
  const setUpPasskey = async () => {
    setPasskeyMsg("Follow your device's prompt…");
    const { error } = await supabase.auth.registerPasskey();
    setPasskeyMsg(error ? "Couldn't set up: " + error.message : "Fingerprint / Face ID login is set up on this device.");
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="bg-[#0f1b3d] text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/*"
            ref={photoInputRef}
            className="hidden"
            onChange={uploadProfilePhoto}
          />
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            title="Change profile photo"
            className="w-11 h-11 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold overflow-hidden relative group"
          >
            {photoUrl ? (
              <img src={photoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              (identity?.name || dealer.name || "?").split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
            )}
            <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[9px]">
              {uploadingPhoto ? "…" : "Edit"}
            </span>
          </button>
          <div>
            <p className="font-bold text-lg">{dealer.name}</p>
            <p className="text-slate-300 text-xs">
              Dealer Portal · Code {dealer.code}
              {identity?.type === "dealer_staff" ? ` · ${identity.name}` : (dealer.contact_name ? ` · ${dealer.contact_name}` : "")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={APK_PATH}
            download
            title="Download Android App"
            aria-label="Download Android App"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-slate-200"
          >
            <Download size={16} />
          </a>
          <button
            onClick={openGames}
            title="1 Infinity Games"
            aria-label="1 Infinity Games"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-slate-200"
          >
            <Gamepad2 size={16} />
          </button>
          <button
            onClick={setUpPasskey}
            title="Set up Fingerprint / Face ID login on this device"
            aria-label="Set up fingerprint login"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-slate-200"
          >
            <Fingerprint size={16} />
          </button>
          <button
            onClick={toggleDark}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle dark mode"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-slate-200"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={onLogout}
            className="text-sm font-semibold bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg"
          >
            Logout
          </button>
        </div>
      </header>
      {passkeyMsg && (
        <div className="bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 text-sm px-6 py-2 flex items-center justify-between">
          <span>{passkeyMsg}</span>
          <button onClick={() => setPasskeyMsg("")} className="text-blue-400 hover:text-blue-600">×</button>
        </div>
      )}

      <main className="max-w-5xl mx-auto p-6 pb-24 md:pb-6">
        {(tab === "Applications" || tab === "Ledger" || tab === "Payments") && (
          <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 sm:p-5">
              <h3 className="text-[10px] sm:text-base font-semibold text-slate-800 dark:text-slate-100 mb-0.5 sm:mb-4 truncate">Running Balance</h3>
              <p className={`text-sm sm:text-2xl font-bold truncate ${runningBalance < 0 ? "text-rose-600" : "text-slate-800 dark:text-slate-100"}`}>
                {runningBalance === null ? "…" : `₹${runningBalance.toLocaleString("en-IN")}`}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 sm:p-5">
              <h3 className="text-[10px] sm:text-base font-semibold text-slate-800 dark:text-slate-100 mb-0.5 sm:mb-4 truncate">Credit Limit</h3>
              <p className="text-sm sm:text-2xl font-bold text-slate-800 dark:text-slate-100 truncate">
                ₹{Number(dealer.credit_limit || 0).toLocaleString("en-IN")}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 sm:p-5 flex flex-col justify-between">
              <h3 className="text-[10px] sm:text-base font-semibold text-slate-800 dark:text-slate-100 mb-0.5 sm:mb-4 truncate">Pay by QR</h3>
              <GhostButton onClick={() => setShowQr(true)} className="!text-[10px] sm:!text-sm w-full justify-center">
                Pay by QR
              </GhostButton>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div className="hidden md:flex flex-wrap gap-2">
            {visibleTabs.map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); if (t === "Call/Chat") refreshUnreadChats(); }}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold border flex items-center gap-1.5 ${
                  tab === t ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                }`}
              >
                {t}
                {t === "Call/Chat" && unreadChats > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadChats}
                  </span>
                )}
              </button>
            ))}
          </div>
          <PrimaryButton onClick={() => setShowNew(true)} className="w-full sm:w-auto justify-center">+ New Application</PrimaryButton>
        </div>

        {tab === "Applications" && (
          <DealerApplications
            dealerId={dealer.id}
            refreshKey={refreshKey}
            onSelect={(app) => setDocsForApp(app)}
            onChat={(app) => setChatApp({ id: app.id, label: `${app.draft_code} — ${app.applicant_name}` })}
          />
        )}
        {tab === "Call/Chat" && (
          <div className="space-y-5">
            <StaffDirectory call={call} />
            <DealerChats dealerId={dealer.id} identity={identity} onMessage={refreshUnreadChats} />
          </div>
        )}
        {tab === "Ledger" && <DealerLedger dealerId={dealer.id} />}
        {tab === "Service" && <DealerServiceAmounts dealerId={dealer.id} />}
        {tab === "Payments" && <DealerPaymentHistory dealerId={dealer.id} />}
        {tab === "Staff" && <DealerStaffTab dealerId={dealer.id} />}
      </main>

      {showNew && (
        <NewApplicationModal
          dealer={dealer}
          onClose={() => setShowNew(false)}
          onCreated={(draftCode, applicantName, applicationId, serviceId) => {
            setShowNew(false);
            setTab("Applications");
            setRefreshKey((k) => k + 1);
            setToast(`Application ${draftCode} submitted as draft`);
            postSystemMessage(`New application submitted: ${draftCode} — ${applicantName}. It's now showing under Draft Submitted.`);
            setDocsForApp({ id: applicationId, applicant_name: applicantName, draft_code: draftCode, service_id: serviceId });
          }}
        />
      )}

      {docsForApp && (
        <ApplicationDocsModal
          application={docsForApp}
          onUploaded={(docName) => postSystemMessage(`Document "${docName}" uploaded for ${docsForApp.draft_code} — ${docsForApp.applicant_name}.`, docsForApp.id)}
          onClose={() => setDocsForApp(null)}
        />
      )}

      {chatApp && (
        <ApplicationChatModal
          dealerId={dealer.id}
          applicationId={chatApp.id}
          applicationLabel={chatApp.label}
          identity={identity}
          onClose={() => setChatApp(null)}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {showQr && (
        <QrPaymentPanel
          dealerId={dealer.id}
          onClose={() => setShowQr(false)}
          onPaid={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <CommsWindow ref={commsRef} variant="dealer" dealerId={dealer.id} dealerName={dealer.name} identity={identity} call={call} />

      <DealerBottomTabBar
        tabs={visibleTabs}
        active={tab}
        onNavigate={(t) => {
          if (t === "Call/Chat") {
            // Mobile: tapping Call/Chat opens the same polished Recent
            // Chats window (search, avatars, timeAgo, Recent Chats/Recent
            // Calls/New Call/Customer Chat tabs) that the floating icon
            // opens on desktop — instead of the plain in-page Chats card.
            refreshUnreadChats();
            commsRef.current?.open();
            return;
          }
          setTab(t);
        }}
        unreadChats={unreadChats}
      />
    </div>
  );
}

function NewApplicationModal({ dealer, onClose, onCreated }) {
  const [services, setServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false); // QR
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [scanNote, setScanNote] = useState("");
  const qrInputRef = useRef(null);
  const ocrInputRef = useRef(null);
  const [f, setF] = useState({
    service_id: "", applicant_name: "", father_husband_name: "",
    date_of_birth: "", mobile: "", address: "", police_station: "", stay_since: "",
    already_has_dl_ll: "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const selectedService = services.find((s) => s.id === f.service_id);
  // "Learner" service = anything whose name mentions Learner Licence (LL) —
  // that's the only place we ask whether the applicant already holds a
  // licence, since it changes which service they actually need.
  const isLearnerService = !!selectedService && /learner|\bll\b/i.test(`${selectedService.parent_service || ""} ${selectedService.short_name || ""}`);

  const scanAadhaar = async (file) => {
    if (!file) return;
    setScanning(true);
    setScanNote("");
    setError("");
    try {
      const result = await scanAadhaarQr(file);
      setF((s) => ({
        ...s,
        applicant_name: result.name || s.applicant_name,
        father_husband_name: result.fatherHusbandName || s.father_husband_name,
        address: result.address || s.address,
      }));
      // The QR only carries a year of birth, not the full date — never
      // silently fabricate a day/month onto official RTO paperwork, so we
      // just tell the dealer what year to look for and leave the actual
      // date field for them to set.
      setScanNote(
        result.yearOfBirth
          ? `Filled from Aadhaar QR. Year of birth on the card: ${result.yearOfBirth} — please set the exact Date of Birth below.`
          : "Filled from Aadhaar QR. Please double-check the details below."
      );
    } catch (e) {
      setError(e.message || "Couldn't read the Aadhaar QR");
    } finally {
      setScanning(false);
      if (qrInputRef.current) qrInputRef.current.value = "";
    }
  };

  const scanFromImage = async (file) => {
    if (!file) return;
    setOcrScanning(true);
    setOcrProgress(0);
    setScanNote("");
    setError("");
    try {
      const result = await scanAadhaarImage(file, setOcrProgress);
      setF((s) => ({
        ...s,
        applicant_name: result.name || s.applicant_name,
        father_husband_name: result.fatherHusbandName || s.father_husband_name,
        address: result.address || s.address,
        date_of_birth: result.dateOfBirth || s.date_of_birth,
      }));
      const missing = [!result.name && "name", !result.dateOfBirth && "DOB", !result.address && "address"].filter(Boolean);
      setScanNote(
        missing.length
          ? `Filled what could be read from the image. Couldn't find: ${missing.join(", ")} — please fill those in and double-check the rest.`
          : "Filled from the image — please double-check everything before submitting."
      );
    } catch (e) {
      setError(e.message || "Couldn't read this image");
    } finally {
      setOcrScanning(false);
      setOcrProgress(0);
      if (ocrInputRef.current) ocrInputRef.current.value = "";
    }
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("services").select("id, parent_service, short_name, pcc_required, age_limit_required, min_age").order("parent_service");
      setServices(data || []);
    })();
  }, []);

  const submit = async () => {
    if (!f.service_id || !f.applicant_name.trim()) {
      setError("Service and Applicant Name are required");
      return;
    }
    const ageErr = validateAgeForService(f.date_of_birth, selectedService);
    if (ageErr) {
      setError(ageErr);
      return;
    }
    setSaving(true);
    setError("");
    const { data: draftCode, error: codeError } = await supabase.rpc("next_draft_code", { p_dealer_id: dealer.id });
    if (codeError) {
      setSaving(false);
      setError("Failed: " + codeError.message);
      return;
    }
    const { data: newApp, error: insertError } = await supabase
      .from("applications")
      .insert({
        draft_code: draftCode,
        dealer_id: dealer.id,
        service_id: f.service_id,
        applicant_name: f.applicant_name.trim(),
        father_husband_name: f.father_husband_name || null,
        date_of_birth: f.date_of_birth || null,
        mobile: f.mobile || null,
        address: f.address || null,
        police_station: f.police_station || null,
        stay_since: f.stay_since || null,
        status: "Draft Submitted",
        ...(isLearnerService && f.already_has_dl_ll ? { service_answers: { "Already has DL/LL": f.already_has_dl_ll } } : {}),
      })
      .select()
      .single();
    if (insertError) {
      setSaving(false);
      setError("Failed: " + insertError.message);
      return;
    }

    // Copy this service's required-document list onto the new application
    // so the dealer immediately sees what needs to be uploaded.
    const { data: reqDocs, error: reqDocsError } = await supabase
      .from("service_documents")
      .select("name, mandatory, post_approval")
      .eq("service_id", f.service_id);
    if (reqDocsError) {
      setSaving(false);
      setError("Application created, but couldn't load its required documents: " + reqDocsError.message);
      onCreated(draftCode, f.applicant_name.trim(), newApp.id, f.service_id);
      return;
    }
    if (reqDocs?.length) {
      const { error: docsInsertError } = await supabase.from("application_documents").upsert(
        reqDocs.map((d) => ({ application_id: newApp.id, name: d.name, mandatory: d.mandatory, post_approval: d.post_approval, status: "Pending" })),
        { onConflict: "application_id,name", ignoreDuplicates: true }
      );
      if (docsInsertError) {
        setSaving(false);
        setError("Application created, but couldn't set up its documents: " + docsInsertError.message);
        onCreated(draftCode, f.applicant_name.trim(), newApp.id, f.service_id);
        return;
      }
    }

    setSaving(false);
    onCreated(draftCode, f.applicant_name.trim(), newApp.id, f.service_id);
  };

  return (
    <Modal title="New Application" onClose={onClose}>
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-500 mb-1.5">Fill from Aadhaar (optional)</p>
        <div className="grid grid-cols-2 gap-2">
          {isAadhaarQrScanSupported() && (
            <>
              <input ref={qrInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => scanAadhaar(e.target.files?.[0])} />
              <button
                type="button"
                onClick={() => qrInputRef.current?.click()}
                disabled={scanning || ocrScanning}
                className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-blue-300 hover:bg-blue-50 text-blue-700 font-semibold py-3 rounded-xl disabled:opacity-50 text-sm"
              >
                <ScanLine size={18} />
                {scanning ? "Reading QR…" : "Scan QR"}
              </button>
            </>
          )}
          <input ref={ocrInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => scanFromImage(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => ocrInputRef.current?.click()}
            disabled={scanning || ocrScanning}
            className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed border-purple-300 hover:bg-purple-50 text-purple-700 font-semibold py-3 rounded-xl disabled:opacity-50 text-sm ${!isAadhaarQrScanSupported() ? "col-span-2" : ""}`}
          >
            <ScanText size={18} />
            {ocrScanning ? `Reading image… ${ocrProgress}%` : "Fill from Image"}
          </button>
        </div>
        {scanNote && <p className="text-xs text-emerald-600 mt-1.5">{scanNote}</p>}
      </div>
      <Field label="Service" required>
        <SearchableSelect
          value={f.service_id}
          options={services.map((s) => ({ id: s.id, name: `${s.parent_service}${s.short_name ? ` (${s.short_name})` : ""}` }))}
          onChange={(id) => setF((s) => ({ ...s, service_id: id }))}
          placeholder="Search or select a service…"
        />
      </Field>
      {isLearnerService && (
        <Field label="Applicant already has a Driving Licence or Learner Licence?">
          <Select value={f.already_has_dl_ll} onChange={set("already_has_dl_ll")}>
            <option value="">Select…</option>
            <option value="No">No</option>
            <option value="Yes — has Learner Licence">Yes — has Learner Licence</option>
            <option value="Yes — has Driving Licence">Yes — has Driving Licence</option>
          </Select>
        </Field>
      )}
      <Field label="Applicant Name" required><Input value={f.applicant_name} onChange={set("applicant_name")} /></Field>
      <Field label="Father / Husband Name"><Input value={f.father_husband_name} onChange={set("father_husband_name")} /></Field>
      <Field label="Date of Birth">
        <Input type="date" value={f.date_of_birth} onChange={set("date_of_birth")}
          className={ageHighlightClass(f.date_of_birth) ? "border-amber-400" : ""} />
      </Field>
      <Field label="Mobile"><Input value={f.mobile} onChange={set("mobile")} /></Field>
      <Field label="Address"><Input value={f.address} onChange={set("address")} /></Field>
      {selectedService?.pcc_required && (
        <div className="grid sm:grid-cols-2 gap-x-4 -mt-1 mb-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30">
          <p className="sm:col-span-2 text-xs text-blue-700 dark:text-blue-300 mb-1">
            This service requires a PCC — fill these in now and they'll auto-fill the PCC request letter later.
          </p>
          <Field label="Police Station">
            <SearchableSelect
              value={f.police_station}
              options={DELHI_POLICE_STATIONS.map((name) => ({ id: name, name }))}
              onChange={(name) => setF((s) => ({ ...s, police_station: name }))}
              placeholder="Search police station…"
            />
          </Field>
          <Field label="Staying at Address Since"><Input type="date" value={f.stay_since} onChange={set("stay_since")} /></Field>
        </div>
      )}
      {error && <p className="text-rose-500 text-xs mb-3">{error}</p>}
      <div className="flex gap-2">
        <PrimaryButton onClick={submit} disabled={saving}>{saving ? "Submitting…" : "Submit Application"}</PrimaryButton>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
      </div>
    </Modal>
  );
}

const DEALER_STATUS_GROUPS = {
  Draft: (s) => s === "Draft Submitted",
  Process: (s) => s === "Under Review" || s === "On Hold",
  Approved: (s) => s === "Accepted",
};

function DealerApplications({ dealerId, refreshKey, onSelect, onChat }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [serviceList, setServiceList] = useState([]);
  const [bookingApp, setBookingApp] = useState(null); // { sourceApp, nextService } | null
  const [detailsApp, setDetailsApp] = useState(null); // row whose Father/Husband, Address & Application No. popup is open
  const [toast, setToast] = useState(null);
  const [sortKey, setSortKey] = useState("submitted_at");
  const [sortDir, setSortDir] = useState("desc");
  const [showAllYears, setShowAllYears] = useState(false);
  const currentYear = new Date().getFullYear();
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "submitted_at" ? "desc" : "asc"); }
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("services").select("id, parent_service, short_name").order("parent_service");
      setServiceList(data || []);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("applications")
      .select("id, draft_code, application_no, applicant_name, father_husband_name, date_of_birth, mobile, address, status, submitted_at, service_id, dealer_id, completed_at, source_application_id, ll_dl_no, pcc_no, pcc_status, pcc_stage, pcc_timeline, pcc_certificate_path, pcc_last_synced_at, service_answers, services(parent_service, short_name, chat_in_app, next_service_id, next_service_wait_days)")
      .eq("dealer_id", dealerId)
      .order("submitted_at", { ascending: false });
    if (error) {
      setToast("Couldn't load applications: " + error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(data || []);
    setLoading(false);
  }, [dealerId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Current-year-only is the default, same as the admin Applications page —
  // toggling "Show All Years" drops this filter.
  const yearScopedRows = showAllYears ? rows : rows.filter((r) => {
    const y = r.submitted_at ? Number(r.submitted_at.slice(0, 4)) : null;
    return y === currentYear;
  });
  const draftCount = yearScopedRows.filter((r) => DEALER_STATUS_GROUPS.Draft(r.status)).length;
  const statusFiltered = statusFilter === "All" ? yearScopedRows : yearScopedRows.filter((r) => DEALER_STATUS_GROUPS[statusFilter](r.status));
  const q = search.trim().toLowerCase();
  const visibleRows = !q ? statusFiltered : statusFiltered.filter((r) =>
    [r.applicant_name, r.mobile, r.draft_code, r.application_no].some((v) => (v || "").toLowerCase().includes(q))
  );

  const APP_SORT_ACCESSORS = {
    ref: (r) => r.application_no || r.draft_code || "",
    applicant: (r) => r.applicant_name || "",
    service: (r) => r.services?.short_name || r.services?.parent_service || "",
    submitted_at: (r) => (r.submitted_at ? new Date(r.submitted_at).getTime() : 0),
    status: (r) => r.status || "",
  };
  const sortedRows = [...visibleRows].sort((a, b) => {
    const acc = APP_SORT_ACCESSORS[sortKey];
    if (!acc) return 0;
    const av = acc(a), bv = acc(b);
    const dir = sortDir === "asc" ? 1 : -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).toLowerCase().localeCompare(String(bv).toLowerCase()) * dir;
  });
  const convertedSourceIds = new Set(rows.map((r) => r.source_application_id).filter(Boolean));

  const bookAppointment = async (payload) => {
    const { data: newApp, error } = await supabase.from("applications").insert(payload).select().single();
    if (error) throw new Error(error.message);
    if (payload.service_id) {
      const { data: reqDocs } = await supabase.from("service_documents").select("name, mandatory, post_approval").eq("service_id", payload.service_id);
      if (reqDocs?.length) {
        await supabase.from("application_documents").insert(
          reqDocs.map((d) => ({ application_id: newApp.id, name: d.name, mandatory: d.mandatory, post_approval: d.post_approval, status: "Pending" }))
        );
      }
    }
    await copyForwardDocuments(bookingApp.sourceApp.id, newApp.id);
    setToast(`Created ${payload.draft_code} from ${bookingApp.sourceApp.draft_code}`);
    setBookingApp(null);
    load();
  };

  return (
    <Card title="My Applications">
      <div className="flex items-center justify-between -mt-1 mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {["All", "Draft", "Process", "Approved"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${
                statusFilter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
              }`}
            >
              {f === "Process" ? "Under Process" : f}
              {f === "Draft" && draftCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {draftCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAllYears((v) => !v)}
          title={showAllYears ? "Currently showing every year — click to go back to this year only" : `Currently showing ${currentYear} only — click to see all years`}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
            showAllYears ? "bg-amber-500 text-white border-amber-500" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
          }`}
        >
          {showAllYears ? "📅 Showing All Years" : `📅 ${currentYear} Only`}
        </button>
      </div>
      <div className="relative mb-3 max-w-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, mobile, draft ID, application no…"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
        />
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Click an applicant's name to upload or view required documents.</p>
      {loading ? (
        <p className="text-slate-400 dark:text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
              <tr>
                <SortableTh label="Ref No." sortKeyName="ref" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Applicant" sortKeyName="applicant" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Submitted" sortKeyName="submitted_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Service" sortKeyName="service" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="text-left font-medium px-3 py-2">Mobile</th>
                <SortableTh label="Status" sortKeyName="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="text-left font-medium px-3 py-2">Chat</th>
                <th className="text-left font-medium px-3 py-2">Appointment</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:bg-slate-800/60">
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    <button
                      onClick={() => setDetailsApp(r)}
                      title="View father/husband name, address & application no."
                      className="hover:underline decoration-dotted underline-offset-2 text-left"
                    >
                      {r.application_no || r.draft_code}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onSelect?.(r)}
                      className="text-blue-600 font-semibold hover:underline text-left"
                    >
                      {r.applicant_name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {r.services?.short_name || r.services?.parent_service || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{r.mobile || "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2">
                    {r.services?.chat_in_app ? (
                      <button
                        onClick={() => onChat?.({ id: r.id, draft_code: r.application_no || r.draft_code, applicant_name: r.applicant_name })}
                        className="text-blue-600 text-xs font-semibold hover:underline"
                      >
                        Chat
                      </button>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEligibleForAppointment(r, convertedSourceIds) ? (
                      <button
                        onClick={() => setBookingApp({ sourceApp: r, nextService: serviceList.find((s) => s.id === r.services.next_service_id) })}
                        className="text-blue-600 text-xs font-semibold hover:underline"
                      >
                        Book Appointment
                      </button>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 dark:text-slate-500 py-8">No applications in this view</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {bookingApp && (
        <BookAppointmentModal
          sourceApp={bookingApp.sourceApp}
          nextService={bookingApp.nextService}
          onClose={() => setBookingApp(null)}
          onBooked={bookAppointment}
        />
      )}
      {detailsApp && (
        <Modal title={`Details — ${detailsApp.application_no || detailsApp.draft_code}`} onClose={() => setDetailsApp(null)}>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500">Applicant</p>
              <p className="text-slate-700 dark:text-slate-300 font-semibold">{detailsApp.applicant_name || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500">Father/Husband</p>
              <p className="text-slate-700 dark:text-slate-300">{detailsApp.father_husband_name || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500">Address</p>
              <p className="text-slate-700 dark:text-slate-300">{detailsApp.address || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500">Application No.</p>
              <p className="text-slate-700 dark:text-slate-300">{detailsApp.application_no || "—"}</p>
            </div>
          </div>
        </Modal>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Card>
  );
}

const DOC_STATUS_STYLES = {
  Pending: "bg-amber-50 text-amber-700",
  Verified: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-rose-50 text-rose-700",
};

function ApplicationDocsModal({ application, onUploaded, onClose }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [pccCheckApp, setPccCheckApp] = useState(null);
  const [cropTarget, setCropTarget] = useState(null); // { doc, file } while the crop modal is open

  const load = async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("application_documents")
      .select("*")
      .eq("application_id", application.id)
      .order("name");
    if (fetchError) {
      setError("Couldn't load documents: " + fetchError.message);
      setLoading(false);
      return;
    }

    // Safety net: older drafts (created before this feature, or hit a
    // transient error) may be missing document rows even though their
    // service does require some. This also covers the case where the
    // service's required documents changed *after* this application was
    // created — application_documents is a one-time snapshot taken at
    // creation, so any doc type added to the service later never gets
    // added to already-existing applications on its own. Diff against
    // the current required docs (not just "zero rows total") and backfill
    // whatever's missing, instead of just telling the dealer "none required".
    if (application.service_id) {
      const { data: reqDocs, error: reqDocsError } = await supabase
        .from("service_documents")
        .select("name, mandatory, post_approval")
        .eq("service_id", application.service_id);
      if (reqDocsError) {
        // Don't silently show "no documents required" when the lookup itself
        // failed (e.g. an RLS policy blocking this role from reading
        // service_documents) — that's a permissions bug, not an empty list.
        setError("Couldn't load required documents: " + reqDocsError.message);
        setDocs(data || []);
        setLoading(false);
        return;
      }
      const existingNames = new Set((data || []).map((d) => d.name));
      const missing = (reqDocs || []).filter((d) => !existingNames.has(d.name));
      if (missing.length) {
        const { error: backfillInsertError } = await supabase.from("application_documents").upsert(
          missing.map((d) => ({ application_id: application.id, name: d.name, mandatory: d.mandatory, post_approval: d.post_approval, status: "Pending" })),
          { onConflict: "application_id,name", ignoreDuplicates: true }
        );
        if (backfillInsertError) {
          setError("Found required documents but couldn't set them up: " + backfillInsertError.message);
          setDocs(data || []);
          setLoading(false);
          return;
        }
        const { data: refetched } = await supabase
          .from("application_documents")
          .select("*")
          .eq("application_id", application.id)
          .order("name");
        setDocs(refetched || []);
        setLoading(false);
        return;
      }
    }

    setDocs(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [application.id]);

  const upload = async (doc, file) => {
    if (!file) return;
    setBusyId(doc.id);
    setError("");
    const path = `${application.id}/${doc.id}-${file.name}`;
    const { error: uploadError } = await supabase
      .storage
      .from("application-documents")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      setBusyId(null);
      setError("Upload failed: " + uploadError.message);
      return;
    }
    const { data: urlData } = supabase.storage.from("application-documents").getPublicUrl(path);
    // Auto-verify: a document the dealer uploads is trusted immediately (no
    // "Pending" wait for staff to click Verify) — staff can still Reject it
    // afterwards if something's actually wrong with it (see DocumentRow in
    // Applications.jsx, which now allows Reject even on a Verified doc).
    const { error: updateError } = await supabase
      .from("application_documents")
      .update({ file_url: urlData.publicUrl, status: "Verified", reject_reason: null, verified_at: new Date().toISOString() })
      .eq("id", doc.id);
    setBusyId(null);
    if (updateError) {
      setError("Saved file but failed to update record: " + updateError.message);
      return;
    }
    onUploaded?.(doc.name);
    load();
  };

  // Photo / Signature / Aadhaar are the document types worth cropping —
  // Signature additionally gets the background-removal option. Anything
  // else (a PDF, or a document name that isn't one of these) skips
  // straight to upload() unchanged, same as before this feature existed.
  const CROPPABLE = /photo|sign|aadhaar/i;
  const onFilePicked = (doc, file) => {
    if (!file) return;
    if (file.type.startsWith("image/") && CROPPABLE.test(doc.name)) {
      setCropTarget({ doc, file });
    } else {
      upload(doc, file);
    }
  };

  const isApproved = application.status === "Accepted";
  // Post-approval documents (e.g. a PCC Certificate or Learner Licence PDF
  // that literally doesn't exist until approval) stay hidden until the
  // application actually reaches that stage — showing them earlier would
  // just read as "missing document" for something the dealer can't get yet.
  const visibleDocs = docs.filter((d) => !d.post_approval || isApproved);

  // Opens the official Sarathi "Print Learner's Licence" page in a popup,
  // pre-filled with this application's Application No. via the query
  // param Parivahan's own redirect link supports. OTP + captcha + the
  // final submit on Sarathi's page still have to be done manually — that
  // page is a government portal with its own captcha specifically to
  // block this kind of automation, so this only gets the dealer to the
  // right pre-filled page, not all the way through it. Once they've
  // downloaded the PDF from Sarathi, they upload it below like any other
  // document.
  const openSarathiPopup = () => {
    if (!application.application_no) {
      setError("Enter the Application No. on this application first (Applications tab), then try again.");
      return;
    }
    const url = `https://sarathi.parivahan.gov.in/sarathiservice/applicationredirect.do?q=${encodeURIComponent(application.application_no)}`;
    window.open(url, "sarathi_popup", "width=900,height=700,noopener,noreferrer");
  };

  // Same idea as the Sarathi shortcut above, for UIDAI's "Download Aadhaar"
  // page. UIDAI's OTP + captcha still have to be done manually there, and
  // no website — including this one — is allowed to reach into the
  // browser's download and grab a file that came from a different site, so
  // this can only get the dealer to the right page, not the finished PDF.
  // Once the e-Aadhaar is downloaded from UIDAI, upload it below like any
  // other document.
  const openUidaiPortal = () => {
    window.open("https://myaadhaar.uidai.gov.in", "uidai_popup", "width=900,height=700,noopener,noreferrer");
  };

  return (
    <>
    <Modal title={`Documents — ${application.draft_code}`} onClose={onClose}>
      <div className="mb-4">
        <p className="text-xs text-slate-500 dark:text-slate-500">{application.applicant_name}</p>
        {application.father_husband_name && (
          <p className="text-xs text-slate-400 dark:text-slate-500">Father/Husband: {application.father_husband_name}</p>
        )}
        {application.address && (
          <p className="text-xs text-slate-400 dark:text-slate-500">Address: {application.address}</p>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
      ) : visibleDocs.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No documents are required for this application{!isApproved && docs.length > 0 ? " yet" : ""}.</p>
      ) : (
        <div className="space-y-3">
          {visibleDocs.map((d) => (
            <div key={d.id} className="border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {d.name} {d.mandatory && <span className="text-rose-500">*</span>}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${DOC_STATUS_STYLES[d.status] || DOC_STATUS_STYLES.Pending}`}>
                  {d.status || "Pending"}
                </span>
              </div>
              {/learn/i.test(d.name) && (
                <button
                  onClick={openSarathiPopup}
                  className="text-xs font-semibold text-blue-600 hover:underline mb-1.5 block"
                >
                  ↗ Download Learning (opens Sarathi)
                </button>
              )}
              {/aadhaar/i.test(d.name) && (
                <button
                  onClick={openUidaiPortal}
                  className="text-xs font-semibold text-blue-600 hover:underline mb-1.5 block"
                >
                  ↗ Download Aadhaar (opens UIDAI)
                </button>
              )}
              {/pcc/i.test(d.name) && application.pcc_no && (
                <button
                  onClick={() => setPccCheckApp(application)}
                  className="text-xs font-semibold text-blue-600 hover:underline mb-1.5 block"
                >
                  ↗ Download PCC Certificate
                </button>
              )}
              {d.file_url && (
                <a href={d.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 mb-1">
                  {/\.(png|jpe?g|gif|webp|bmp)$/i.test(d.file_url) ? (
                    <img
                      src={d.file_url}
                      alt={d.name}
                      className="w-14 h-14 rounded border border-slate-200 dark:border-slate-800 object-cover shrink-0"
                    />
                  ) : (
                    <span className="w-14 h-14 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-center text-[10px] font-semibold text-slate-400 dark:text-slate-500 shrink-0">
                      FILE
                    </span>
                  )}
                  <span className="text-blue-600 text-xs font-semibold">View uploaded file</span>
                </a>
              )}
              {d.status === "Rejected" && d.reject_reason && (
                <p className="text-xs text-rose-500 mt-1">Reason: {d.reject_reason}</p>
              )}
              <div className="mt-2">
                <DocUploadDropzone
                  busy={busyId === d.id}
                  onFile={(file) => onFilePicked(d, file)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-rose-500 text-xs mt-3">{error}</p>}
      <div className="mt-4">
        <GhostButton onClick={onClose}>Close</GhostButton>
      </div>
    </Modal>
    {pccCheckApp && (
      <PCCStatusCheckModal row={pccCheckApp} onClose={() => setPccCheckApp(null)} />
    )}
    {cropTarget && (
      <ImageCropModal
        file={cropTarget.file}
        allowBackgroundRemoval={/sign/i.test(cropTarget.doc.name)}
        onClose={() => setCropTarget(null)}
        onDone={(croppedFile) => {
          const doc = cropTarget.doc;
          setCropTarget(null);
          upload(doc, croppedFile);
        }}
      />
    )}
    </>
  );
}

function DealerStaffTab({ dealerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ fullName: "", email: "", password: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("dealer_staff").select("*").eq("dealer_id", dealerId).order("full_name");
    setRows(data || []);
    setLoading(false);
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!f.fullName || !f.email || !f.password) return;
    setSaving(true);
    setMsg("");
    try {
      await createDealerStaffLogin({ dealerId, fullName: f.fullName, email: f.email, password: f.password });
      setF({ fullName: "", email: "", password: "" });
      setShowAdd(false);
      load();
    } catch (e) {
      setMsg("Failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    await supabase.from("dealer_staff").update({ active: !row.active }).eq("id", row.id);
    load();
  };

  return (
    <Card title="My Staff">
      <p className="text-xs text-slate-400 dark:text-slate-500 -mt-2 mb-3">
        Give your own team their own logins to this portal — they'll see the same applications and chats as you.
      </p>
      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 mb-3">No staff added yet.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2">
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">{r.full_name}</span>
                <span className="text-slate-400 dark:text-slate-500 text-xs ml-2">{r.email}</span>
              </div>
              <button
                onClick={() => toggleActive(r)}
                className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                  r.active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800"
                }`}
              >
                {r.active ? "Active" : "Disabled"}
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd ? (
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
          <div className="grid sm:grid-cols-3 gap-2 mb-2">
            <Input placeholder="Full name" value={f.fullName} onChange={(e) => setF((s) => ({ ...s, fullName: e.target.value }))} />
            <Input type="email" placeholder="Email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} />
            <Input type="password" placeholder="Password" value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <PrimaryButton onClick={add} disabled={saving}>{saving ? "Creating…" : "Create Login"}</PrimaryButton>
            <GhostButton onClick={() => setShowAdd(false)}>Cancel</GhostButton>
          </div>
          {msg && <p className="text-xs text-rose-500 mt-2">{msg}</p>}
        </div>
      ) : (
        <GhostButton onClick={() => setShowAdd(true)}>+ Add Staff</GhostButton>
      )}
    </Card>
  );
}

// Shows every admin staff member by name so a dealer (or their sub-staff)
// can pick exactly who to call, instead of ringing an anonymous "General"
// line and hoping someone happens to be watching it. Calling here rings
// that person's personal channel directly (see lib/directCall.js) — it
// works even if that staff member isn't currently looking at this dealer's
// chat thread, since useDirectCall() listens globally for as long as
// they're signed in.
function StaffDirectory({ call }) {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("staff").select("id, full_name, role").order("full_name");
      setStaffList(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading || staffList.length === 0) return null;

  return (
    <Card title="Our Team">
      <p className="text-xs text-slate-400 dark:text-slate-500 -mt-2 mb-3">Tap Call to ring someone on our team directly.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {staffList.map((s) => (
          <div key={s.id} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-slate-700 dark:text-slate-300 truncate">{s.full_name}</p>
              {s.role && <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{s.role}</p>}
            </div>
            <button
              onClick={() => call?.startCall({ type: "staff", id: s.id, name: s.full_name }, "audio")}
              disabled={!call || call.status !== "idle"}
              title={`Call ${s.full_name}`}
              className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30"
            >
              <Phone size={14} />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Same relative-time formatting used by the admin panel's chat list
// (CommsWindow.jsx) — kept in sync so both look and read the same way.
function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DealerChats({ dealerId, identity, onMessage }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [query, setQuery] = useState("");
  const [seenMap, setSeenMap] = useState(() => loadSeenMap(identity));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listRecentThreadsForDealer(dealerId, 60);
      setThreads(rows);
    } catch (e) {
      setError(e.message || "Couldn't load chats");
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => { load(); }, [load]);

  const selected = threads.find((t) => t.threadId === selectedThreadId) || null;

  const selectThread = (t) => {
    setSelectedThreadId(t.threadId);
    setSeenMap((prev) => {
      const next = { ...prev, [t.threadId]: new Date().toISOString() };
      saveSeenMap(identity, next);
      return next;
    });
  };

  const handleMessage = () => {
    load();
    onMessage?.();
  };

  const filtered = threads.filter((t) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return t.label.toLowerCase().includes(q) || (t.lastMessage || "").toLowerCase().includes(q);
  });

  return (
    <Card title="Chats">
      <div className="grid md:grid-cols-[280px_1fr] gap-4" style={{ height: "60vh" }}>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2">
              <Search size={15} className="text-slate-400 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats…"
                className="bg-transparent text-sm outline-none flex-1 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Loading…</p>
            ) : error ? (
              <p className="text-sm text-rose-500 text-center py-8 px-4">{error}</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 px-4">
                {query.trim() ? "No matching chats." : "No conversations yet."}
              </p>
            ) : (
              filtered.map((t) => {
                const isGeneral = !t.applicationId;
                const unread = t.unreadCount > 0 && !isThreadSeen(seenMap, t.threadId, t.lastAt);
                return (
                  <button
                    key={t.threadId}
                    onClick={() => selectThread(t)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-3 ${
                      selectedThreadId === t.threadId ? "bg-slate-50 dark:bg-slate-800/60" : ""
                    }`}
                  >
                    <div className="relative shrink-0">
                      <PastelAvatar name={isGeneral ? "Support Team" : t.label} size={40} />
                      {isGeneral && (
                        <span
                          title="Group chat — you, your staff, and our team"
                          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center border-2 border-white dark:border-slate-900"
                        >
                          <Users size={9} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                          {isGeneral ? "Support Team" : t.label}
                        </span>
                        {t.lastAt && <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">{timeAgo(t.lastAt)}</span>}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {t.lastMessage || "No messages yet"}
                      </p>
                    </div>
                    {unread && (
                      <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center">
                        {t.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          {selected ? (
            <>
              <CallLogPanel threadId={selected.threadId} dealerId={dealerId} />
              <ChatPanel
                dealerId={dealerId}
                applicationId={selected.applicationId}
                identity={identity}
                emptyLabel="No messages yet — say hello."
                onMessage={handleMessage}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
              Pick a conversation on the left.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function monthKeyOf(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabelOf(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// Payments-only view for the dealer portal — same dealer_ledger view as
// "Service" tab — the application-side counterpart to "Payments": that tab
// shows only what's been paid, this one shows only what's been charged —
// every application's service amount alongside the applicant's own
// details, straight from the applications table (no ledger join needed).
function DealerServiceAmounts({ dealerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("applications")
        .select("id, draft_code, applicant_name, mobile, amount, submitted_at, status, services(parent_service, short_name)")
        .eq("dealer_id", dealerId)
        .order("submitted_at", { ascending: false });
      if (error) {
        console.error("Couldn't load service amounts:", error.message);
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setLoadError(null);
      setRows(data || []);
      setLoading(false);
    })();
  }, [dealerId]);

  const filteredRows = rows.filter((r) => {
    const d = r.submitted_at?.slice(0, 10);
    if (rangeFrom && d < rangeFrom) return false;
    if (rangeTo && d > rangeTo) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const haystack = [r.draft_code, r.applicant_name, r.mobile, r.services?.parent_service, r.services?.short_name].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const totalAmount = filteredRows.reduce((acc, r) => acc + Number(r.amount || 0), 0);

  return (
    <Card title="Service Amounts">
      <p className="text-sm text-slate-500 dark:text-slate-500 mb-4">
        Total{(rangeFrom || rangeTo || query) ? " (filtered)" : ""}: <span className="font-bold text-slate-800 dark:text-slate-100">₹{totalAmount.toLocaleString("en-IN")}</span> across {filteredRows.length} application{filteredRows.length !== 1 ? "s" : ""}
      </p>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, mobile, draft ID, service…"
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40 w-56"
        />
        <input
          type="date"
          value={rangeFrom}
          onChange={(e) => setRangeFrom(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          value={rangeTo}
          onChange={(e) => setRangeTo(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        {(rangeFrom || rangeTo || query) && (
          <button onClick={() => { setRangeFrom(""); setRangeTo(""); setQuery(""); }} className="text-xs font-semibold text-slate-500 hover:text-blue-600">
            Clear
          </button>
        )}
      </div>
      {loading ? (
        <p className="text-slate-400 dark:text-slate-500 text-sm">Loading…</p>
      ) : loadError ? (
        <p className="text-center text-rose-600 py-8">Couldn't load service amounts — please refresh and try again.</p>
      ) : filteredRows.length === 0 ? (
        <p className="text-center text-slate-400 dark:text-slate-500 py-8">No applications yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Draft ID</th>
                <th className="text-left font-medium px-3 py-2">Applicant</th>
                <th className="text-left font-medium px-3 py-2">Mobile</th>
                <th className="text-left font-medium px-3 py-2">Service</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-right font-medium px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{r.draft_code}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{r.applicant_name}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{r.mobile || "—"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">
                    {r.services?.short_name || r.services?.parent_service || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{r.status}</td>
                  <td className="px-3 py-2 text-right font-semibold whitespace-nowrap text-slate-800 dark:text-slate-100">
                    {r.amount != null ? `₹${Number(r.amount).toLocaleString("en-IN")}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// "My Ledger" but filtered to entry_type = PAYMENT, so a dealer can check
// what they've paid without SERVICE charge rows mixed in. Running Balance
// shown here is still the dealer's real overall balance at that point in
// time (services + payments combined) — just the row list is filtered.
function DealerPaymentHistory({ dealerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("dealer_ledger")
        .select("id, entry_code, entry_date, display_name, credit, running_balance, payment_mode, reference_no")
        .eq("dealer_id", dealerId)
        .eq("entry_type", "PAYMENT")
        .order("entry_date", { ascending: false });
      if (error) {
        console.error("Couldn't load payment history:", error.message);
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setLoadError(null);
      setRows(data || []);
      setLoading(false);
    })();
  }, [dealerId]);

  const filteredRows = rows.filter((r) => {
    const d = r.entry_date;
    if (rangeFrom && d < rangeFrom) return false;
    if (rangeTo && d > rangeTo) return false;
    return true;
  });

  const totalPaid = filteredRows.reduce((acc, r) => acc + Number(r.credit || 0), 0);

  return (
    <Card title="Payment History">
      <p className="text-sm text-slate-500 dark:text-slate-500 mb-4">
        Total paid{(rangeFrom || rangeTo) ? " (in range)" : ""}: <span className="font-bold text-emerald-600">₹{totalPaid.toLocaleString("en-IN")}</span>
      </p>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="date"
          value={rangeFrom}
          onChange={(e) => setRangeFrom(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          value={rangeTo}
          onChange={(e) => setRangeTo(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        {(rangeFrom || rangeTo) && (
          <button onClick={() => { setRangeFrom(""); setRangeTo(""); }} className="text-xs font-semibold text-slate-500 hover:text-blue-600">
            Clear
          </button>
        )}
      </div>
      {loading ? (
        <p className="text-slate-400 dark:text-slate-500 text-sm">Loading…</p>
      ) : loadError ? (
        <p className="text-center text-rose-600 py-8">Couldn't load payment history — please refresh and try again.</p>
      ) : filteredRows.length === 0 ? (
        <p className="text-center text-slate-400 dark:text-slate-500 py-8">No payments yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Entry Code</th>
                <th className="text-left font-medium px-3 py-2">Mode / Ref No.</th>
                <th className="text-right font-medium px-3 py-2">Amount</th>
                <th className="text-right font-medium px-3 py-2">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{new Date(r.entry_date).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{r.entry_code}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {r.payment_mode || "—"}{r.reference_no ? ` · ${r.reference_no}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold whitespace-nowrap text-emerald-600">
                    ₹{Number(r.credit || 0).toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    ₹{Number(r.running_balance || 0).toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DealerLedger({ dealerId }) {
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "created_at" ? "desc" : "asc"); }
  };
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [viewMode, setViewMode] = useState("month"); // "month" | "range"
  const [selectedMonthKey, setSelectedMonthKey] = useState(currentMonthKey);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("dealer_ledger")
        .select("id, entry_type, ledger_type, display_name, debit, credit, running_balance, entry_date")
        .eq("dealer_id", dealerId)
        .order("entry_date", { ascending: false });
      if (error) {
        // Don't let a failed fetch fall through to `data || []` — an empty
        // array here renders as a confident "No ledger entries yet" / ₹0,
        // which looks identical to a genuinely empty ledger even though the
        // dealer's actual balance (shown correctly in the card above, from
        // its own separate query) says otherwise. Surface the failure
        // instead of hiding it behind a wrong-but-plausible empty state.
        console.error("Couldn't load ledger:", error.message);
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setLoadError(null);
      setTxns(data || []);
      setLoading(false);
    })();
  }, [dealerId]);

  // dealer_ledger already carries the service name / payment description
  // as display_name and ledger_type as real columns — no more matching
  // against applications by voucher code, no more parsing free text.
  const enrichedTxns = txns.map((t) => ({
    ...t,
    created_at: t.entry_date,
    type: t.credit > 0 ? "credit" : "debit",
    amount: t.credit > 0 ? t.credit : t.debit,
    serviceCell: t.ledger_type || "—",
    applicantCell: t.display_name || "—",
  }));

  // Running balance walked chronologically (oldest first) regardless of
  // display order, then grouped into months. Each month's opening balance is
  // simply the running balance carried over from the end of the previous
  // month — 0 for whichever month has the earliest activity.
  const chronological = [...enrichedTxns].reverse();
  let running = 0;
  const monthOrder = [];
  const monthGroups = {};
  const chronologicalWithBalance = [];
  chronological.forEach((t) => {
    running += t.type === "credit" ? Number(t.amount || 0) : -Number(t.amount || 0);
    const withBalance = { ...t, balance: running };
    chronologicalWithBalance.push(withBalance);
    const key = t.created_at ? monthKeyOf(t.created_at) : "Undated";
    if (!monthGroups[key]) {
      monthGroups[key] = { key, opening: running - (t.type === "credit" ? Number(t.amount || 0) : -Number(t.amount || 0)), closing: running, txns: [] };
      monthOrder.push(key);
    }
    monthGroups[key].txns.push(withBalance);
    monthGroups[key].closing = running;
  });
  const currentBalance = running;

  // Most recent month first; each month's own rows are then sorted per the
  // clicked column (defaulting to newest-first, matching the old layout).
  const orderedMonths = [...monthOrder].reverse().map((key) => monthGroups[key]);

  // Months that actually have entries, newest first — plus the current
  // month even when it's empty, so the picker always has something selected.
  const monthPickerOptions = monthOrder.includes(currentMonthKey)
    ? [...monthOrder].reverse()
    : [currentMonthKey, ...[...monthOrder].reverse()];

  // Running balance immediately before a given month, for months with no
  // transactions of their own (so the opening balance still carries over).
  const balanceBeforeMonth = (key) => {
    let bal = 0;
    for (const k of monthOrder) {
      if (k >= key) break;
      bal = monthGroups[k].closing;
    }
    return bal;
  };
  const selectedMonthGroup = monthGroups[selectedMonthKey] || (() => {
    const bal = balanceBeforeMonth(selectedMonthKey);
    return { key: selectedMonthKey, opening: bal, closing: bal, txns: [] };
  })();

  // Date-range mode: opening balance is whatever the running balance was
  // just before the first transaction in range.
  let rangeOpening = 0;
  const rangeTxns = [];
  chronologicalWithBalance.forEach((t) => {
    const d = t.created_at ? t.created_at.slice(0, 10) : null;
    const afterFrom = !rangeFrom || (d && d >= rangeFrom);
    const beforeTo = !rangeTo || (d && d <= rangeTo);
    if (afterFrom && beforeTo) {
      rangeTxns.push(t);
    } else if (rangeFrom && d && d < rangeFrom) {
      rangeOpening = t.balance;
    }
  });
  const rangeClosing = rangeTxns.length ? rangeTxns[rangeTxns.length - 1].balance : rangeOpening;
  const rangeGroup = { key: "range", opening: rangeOpening, closing: rangeClosing, txns: rangeTxns };

  const displayedGroups = viewMode === "month" ? [selectedMonthGroup] : [rangeGroup];

  const LEDGER_SORT_ACCESSORS = {
    created_at: (t) => (t.created_at ? new Date(t.created_at).getTime() : 0),
    serviceCell: (t) => t.serviceCell || "",
    applicantCell: (t) => t.applicantCell || "",
    amount: (t) => Number(t.amount || 0),
    balance: (t) => t.balance,
  };
  const sortGroupTxns = (arr) => {
    const acc = LEDGER_SORT_ACCESSORS[sortKey] || LEDGER_SORT_ACCESSORS.created_at;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...arr].sort((a, b) => {
      const av = acc(a), bv = acc(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).toLowerCase().localeCompare(String(bv).toLowerCase()) * dir;
    });
  };

  return (
    <Card title="My Ledger">
      <p className="text-sm text-slate-500 dark:text-slate-500 mb-4">
        Running balance: <span className="font-bold text-slate-800 dark:text-slate-100">₹{currentBalance.toLocaleString("en-IN")}</span>
      </p>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex items-center rounded-full border border-slate-300 dark:border-slate-700 overflow-hidden text-xs font-semibold">
          <button
            onClick={() => setViewMode("month")}
            className={`px-3 py-1.5 ${viewMode === "month" ? "bg-slate-900 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
          >
            Month-wise
          </button>
          <button
            onClick={() => setViewMode("range")}
            className={`px-3 py-1.5 ${viewMode === "range" ? "bg-slate-900 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
          >
            Date-wise
          </button>
        </div>
        {viewMode === "month" ? (
          <select
            value={selectedMonthKey}
            onChange={(e) => setSelectedMonthKey(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            {monthPickerOptions.map((key) => (
              <option key={key} value={key}>{monthLabelOf(key)}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="date"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </>
        )}
      </div>
      {loading ? (
        <p className="text-slate-400 dark:text-slate-500 text-sm">Loading…</p>
      ) : loadError ? (
        <p className="text-center text-rose-600 py-8">Couldn't load your ledger — please refresh and try again.</p>
      ) : txns.length === 0 ? (
        <p className="text-center text-slate-400 dark:text-slate-500 py-8">No ledger entries yet</p>
      ) : (
        <div className="space-y-6">
          {displayedGroups.map((group) => (
            <div key={group.key} className="overflow-x-auto">
              <div className="flex items-center justify-between mb-1 px-1">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {group.key === "range"
                    ? (rangeFrom || rangeTo ? `${rangeFrom || "…"} to ${rangeTo || "…"}` : "All transactions")
                    : group.key === "Undated" ? "Undated" : monthLabelOf(group.key)}
                </h4>
                <div className="text-xs text-slate-500 dark:text-slate-500 flex gap-4">
                  <span>Opening: <span className="font-semibold text-slate-700 dark:text-slate-300">₹{group.opening.toLocaleString("en-IN")}</span></span>
                  <span>Closing: <span className="font-semibold text-slate-700 dark:text-slate-300">₹{group.closing.toLocaleString("en-IN")}</span></span>
                </div>
              </div>
              <table className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
                  <tr>
                    <SortableTh label="Date" sortKeyName="created_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Service" sortKeyName="serviceCell" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Applicant Name" sortKeyName="applicantCell" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Amount" sortKeyName="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="Running Balance" sortKeyName="balance" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
                    <td colSpan={4} className="px-3 py-1.5 text-xs italic text-slate-400 dark:text-slate-500">Opening Balance</td>
                    <td className="px-3 py-1.5 text-right text-xs italic text-slate-500 dark:text-slate-400 whitespace-nowrap">₹{group.opening.toLocaleString("en-IN")}</td>
                  </tr>
                  {group.txns.length === 0 && (
                    <tr className="border-t border-slate-100 dark:border-slate-800">
                      <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
                        No transactions {viewMode === "month" ? "this month" : "in this range"}
                      </td>
                    </tr>
                  )}
                  {sortGroupTxns(group.txns).map((t) => (
                    <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{t.created_at ? new Date(t.created_at).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{t.serviceCell}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{t.applicantCell}</td>
                      <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${t.type === "credit" ? "text-emerald-600" : "text-rose-600"}`}>
                        {t.type === "credit" ? "+" : "-"}₹{Number(t.amount || 0).toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">₹{t.balance.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30">
                    <td colSpan={4} className="px-3 py-1.5 text-xs italic text-slate-400 dark:text-slate-500">Closing Balance</td>
                    <td className="px-3 py-1.5 text-right text-xs italic font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">₹{group.closing.toLocaleString("en-IN")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
