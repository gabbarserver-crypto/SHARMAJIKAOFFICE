// src/pages/DealerPortal.jsx
// Restricted view shown to a Dealer login (as opposed to Staff, who get
// the full admin app via App.jsx + Sidebar). A dealer can only ever see
// their own applications and their own ledger — enforced both here
// (queries always filter by dealer.id) and at the database level via
// the RLS policies added in enable_dealer_login.sql.
import React, { useCallback, useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Card, StatusBadge, Modal, Field, Input, Select, PrimaryButton, GhostButton, Toast } from "../components/UI";
import ChatWidget from "../components/ChatWidget";
import ChatPanel from "../components/ChatPanel";
import ApplicationChatModal from "../components/ApplicationChatModal";
import BookAppointmentModal from "../components/BookAppointmentModal";
import { isEligibleForAppointment, copyForwardDocuments } from "../lib/nextService";
import { getOrCreateThread, sendMessage, countDealerUnread } from "../lib/chat";
import { createDealerStaffLogin } from "../lib/serverApi";
import { DELHI_POLICE_STATIONS } from "../lib/delhiPoliceStations";
import { useDarkMode } from "../lib/theme";
import { Sun, Moon, Fingerprint } from "lucide-react";
import SearchableSelect from "../components/SearchableSelect";
import PCCStatusCheckModal from "../components/PCCStatusCheckModal";

const TABS = ["Applications", "Chats", "Ledger"];

// `identity` is { type: 'dealer' | 'dealer_staff', id, name } — resolved in
// App.jsx from whichever login this is. It's what scopes chat messages to
// "who sent this", while `dealer.id` (the parent dealer, same for both a
// dealer's own login and any of their sub-staff) scopes *which* dealer's
// data/threads this portal shows.
export default function DealerPortal({ dealer, identity, onLogout }) {
  const [tab, setTab] = useState("Applications");
  const [showNew, setShowNew] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [docsForApp, setDocsForApp] = useState(null); // { id, applicant_name } | null
  const [chatApp, setChatApp] = useState(null); // { id, label } | null
  const [unreadChats, setUnreadChats] = useState(0);
  const [showTopUp, setShowTopUp] = useState(false);
  const [runningBalance, setRunningBalance] = useState(null);

  // Running Balance shown beside Credit Limit in the summary cards — same
  // computation as the "My Ledger" tab (DealerLedger below), just lifted up
  // here too so it's visible without switching tabs.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ledger_transactions").select("type, amount").eq("dealer_id", dealer.id);
      const balance = (data || []).reduce((acc, t) => acc + (t.type === "credit" ? Number(t.amount || 0) : -Number(t.amount || 0)), 0);
      setRunningBalance(balance);
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, refreshUnreadChats)
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
              Dealer Portal · Code {dealer.code}{identity?.type === "dealer_staff" ? ` · ${identity.name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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

      <main className="max-w-5xl mx-auto p-6">
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <Card title="Wallet Balance">
            <div className="flex items-center justify-between">
              <p className="text-2xl font-bold text-emerald-600">
                ₹{Number(dealer.wallet_balance || 0).toLocaleString("en-IN")}
              </p>
              <GhostButton onClick={() => setShowTopUp(true)}>Top Up</GhostButton>
            </div>
          </Card>
          <Card title="Running Balance">
            <p className={`text-2xl font-bold ${runningBalance < 0 ? "text-rose-600" : "text-slate-800 dark:text-slate-100"}`}>
              {runningBalance === null ? "…" : `₹${runningBalance.toLocaleString("en-IN")}`}
            </p>
          </Card>
          <Card title="Credit Limit">
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
              ₹{Number(dealer.credit_limit || 0).toLocaleString("en-IN")}
            </p>
          </Card>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div className="flex flex-wrap gap-2">
            {visibleTabs.map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); if (t === "Chats") refreshUnreadChats(); }}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold border flex items-center gap-1.5 ${
                  tab === t ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                }`}
              >
                {t}
                {t === "Chats" && unreadChats > 0 && (
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
        {tab === "Chats" && <DealerChats dealerId={dealer.id} identity={identity} onMessage={refreshUnreadChats} />}
        {tab === "Ledger" && <DealerLedger dealerId={dealer.id} />}
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

      {showTopUp && <TopUpModal dealer={dealer} onClose={() => setShowTopUp(false)} />}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <ChatWidget dealerId={dealer.id} identity={identity} title={dealer.name} />
    </div>
  );
}

function NewApplicationModal({ dealer, onClose, onCreated }) {
  const [services, setServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({
    service_id: "", applicant_name: "", father_husband_name: "",
    date_of_birth: "", mobile: "", address: "", police_station: "", stay_since: "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const selectedService = services.find((s) => s.id === f.service_id);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("services").select("id, parent_service, short_name, pcc_required").order("parent_service");
      setServices(data || []);
    })();
  }, []);

  const submit = async () => {
    if (!f.service_id || !f.applicant_name.trim()) {
      setError("Service and Applicant Name are required");
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
      <Field label="Service" required>
        <SearchableSelect
          value={f.service_id}
          options={services.map((s) => ({ id: s.id, name: `${s.parent_service}${s.short_name ? ` (${s.short_name})` : ""}` }))}
          onChange={(id) => setF((s) => ({ ...s, service_id: id }))}
          placeholder="Search or select a service…"
        />
      </Field>
      <Field label="Applicant Name" required><Input value={f.applicant_name} onChange={set("applicant_name")} /></Field>
      <Field label="Father / Husband Name"><Input value={f.father_husband_name} onChange={set("father_husband_name")} /></Field>
      <Field label="Date of Birth"><Input type="date" value={f.date_of_birth} onChange={set("date_of_birth")} /></Field>
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
  Approved: (s) => s === "Accepted" || s === "Completed",
};

function DealerApplications({ dealerId, refreshKey, onSelect, onChat }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [serviceList, setServiceList] = useState([]);
  const [bookingApp, setBookingApp] = useState(null); // { sourceApp, nextService } | null
  const [toast, setToast] = useState(null);

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
      .select("id, draft_code, application_no, applicant_name, father_husband_name, date_of_birth, mobile, address, status, submitted_at, service_id, dealer_id, completed_at, source_application_id, ll_dl_no, pcc_no, service_answers, services(parent_service, short_name, chat_in_app, next_service_id, next_service_wait_days)")
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

  const draftCount = rows.filter((r) => DEALER_STATUS_GROUPS.Draft(r.status)).length;
  const statusFiltered = statusFilter === "All" ? rows : rows.filter((r) => DEALER_STATUS_GROUPS[statusFilter](r.status));
  const q = search.trim().toLowerCase();
  const visibleRows = !q ? statusFiltered : statusFiltered.filter((r) =>
    [r.applicant_name, r.mobile, r.draft_code, r.application_no].some((v) => (v || "").toLowerCase().includes(q))
  );
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
      <div className="flex items-center gap-2 -mt-1 mb-3 flex-wrap">
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
                <th className="text-left font-medium px-3 py-2">Ref No.</th>
                <th className="text-left font-medium px-3 py-2">Applicant</th>
                <th className="text-left font-medium px-3 py-2">Service</th>
                <th className="text-left font-medium px-3 py-2">Submitted</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-3 py-2">Chat</th>
                <th className="text-left font-medium px-3 py-2">Appointment</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:bg-slate-800/60">
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {r.application_no || r.draft_code}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onSelect?.({ id: r.id, applicant_name: r.applicant_name, draft_code: r.application_no || r.draft_code, service_id: r.service_id })}
                      className="text-blue-600 font-semibold hover:underline text-left"
                    >
                      {r.applicant_name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {r.services?.short_name || r.services?.parent_service || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-500">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-IN") : "—"}</td>
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
                <tr><td colSpan={7} className="text-center text-slate-400 dark:text-slate-500 py-8">No applications in this view</td></tr>
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
    // transient error) may have zero document rows even though their
    // service does require some. Backfill them here instead of just
    // telling the dealer "none required".
    if ((!data || data.length === 0) && application.service_id) {
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
      if (reqDocs?.length) {
        const { error: backfillInsertError } = await supabase.from("application_documents").upsert(
          reqDocs.map((d) => ({ application_id: application.id, name: d.name, mandatory: d.mandatory, post_approval: d.post_approval, status: "Pending" })),
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
    const { error: updateError } = await supabase
      .from("application_documents")
      .update({ file_url: urlData.publicUrl, status: "Pending", reject_reason: null })
      .eq("id", doc.id);
    setBusyId(null);
    if (updateError) {
      setError("Saved file but failed to update record: " + updateError.message);
      return;
    }
    onUploaded?.(doc.name);
    load();
  };

  const isApproved = application.status === "Accepted" || application.status === "Completed";
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
      <p className="text-xs text-slate-500 dark:text-slate-500 mb-4">{application.applicant_name}</p>
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
                <input
                  type="file"
                  accept="image/*,.pdf"
                  disabled={busyId === d.id}
                  onChange={(e) => upload(d, e.target.files?.[0])}
                  className="text-xs"
                />
                {busyId === d.id && <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">Uploading…</span>}
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

function DealerChats({ dealerId, identity, onMessage }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: threadRows, error: threadsError } = await supabase
        .from("chat_threads")
        .select("id, application_id, applications(draft_code, application_no, applicant_name)")
        .eq("dealer_id", dealerId);
      if (threadsError) throw threadsError;

      const threadIds = (threadRows || []).map((t) => t.id);
      let latestByThread = {};
      if (threadIds.length) {
        const { data: messages, error: messagesError } = await supabase
          .from("chat_messages")
          .select("thread_id, sender_type, body, created_at")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: false });
        if (messagesError) throw messagesError;
        for (const m of messages || []) {
          if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
        }
      }

      const enriched = (threadRows || [])
        .map((t) => {
          const latest = latestByThread[t.id];
          return {
            threadId: t.id,
            applicationId: t.application_id,
            label: t.application_id
              ? `${t.applications?.application_no || t.applications?.draft_code || "—"} — ${t.applications?.applicant_name || "—"}`
              : "General",
            lastMessage: latest?.body || null,
            lastAt: latest?.created_at || null,
            awaitingReply: latest ? latest.sender_type === "staff" : false,
          };
        })
        .sort((a, b) => {
          // General thread first, then most recently active.
          if (!a.applicationId !== !b.applicationId) return a.applicationId ? 1 : -1;
          return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
        });

      setThreads(enriched);
    } catch (e) {
      setError(e.message || "Couldn't load chats");
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => { load(); }, [load]);

  const selected = threads.find((t) => t.threadId === selectedThreadId) || null;

  const handleMessage = () => {
    load();
    onMessage?.();
  };

  return (
    <Card title="Chats">
      <div className="grid md:grid-cols-[260px_1fr] gap-4" style={{ height: "60vh" }}>
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Loading…</p>
            ) : error ? (
              <p className="text-sm text-rose-500 text-center py-8 px-4">{error}</p>
            ) : threads.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 px-4">No conversations yet.</p>
            ) : (
              threads.map((t) => (
                <button
                  key={t.threadId}
                  onClick={() => setSelectedThreadId(t.threadId)}
                  className={`w-full text-left px-4 py-3 hover:bg-white dark:bg-slate-900 ${selectedThreadId === t.threadId ? "bg-white dark:bg-slate-900" : ""}`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">{t.label}</span>
                    {t.awaitingReply && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 ml-2" />}
                  </div>
                  {t.lastMessage && <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{t.lastMessage}</p>}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          {selected ? (
            <ChatPanel
              dealerId={dealerId}
              applicationId={selected.applicationId}
              identity={identity}
              emptyLabel="No messages yet — say hello."
              onMessage={handleMessage}
            />
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

const TOPUP_AMOUNTS = [10000, 20000];

// Your UPI ID + display name — set these as Vite env vars
// (VITE_UPI_ID / VITE_UPI_PAYEE_NAME) so they aren't hardcoded here.
const UPI_ID = import.meta.env.VITE_UPI_ID || "your-upi-id@bank";
const UPI_PAYEE_NAME = import.meta.env.VITE_UPI_PAYEE_NAME || "SJO Services";

function TopUpModal({ dealer, onClose }) {
  const [amount, setAmount] = useState(TOPUP_AMOUNTS[0]);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const finalAmount = useCustom ? parseFloat(customAmount) || 0 : amount;
  const note = `Wallet top-up — ${dealer.code}`;
  const upiLink = finalAmount > 0
    ? `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_PAYEE_NAME)}&am=${finalAmount}&cu=INR&tn=${encodeURIComponent(note)}`
    : null;
  const qrSrc = upiLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiLink)}`
    : null;

  return (
    <Modal title="Top Up Wallet" onClose={onClose}>
      <Field label="Amount">
        <div className="grid grid-cols-3 gap-2 mb-2">
          {TOPUP_AMOUNTS.map((a) => (
            <button
              key={a}
              onClick={() => { setAmount(a); setUseCustom(false); }}
              className={`py-2 rounded-lg text-sm font-semibold border ${
                !useCustom && amount === a ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
              }`}
            >
              ₹{a.toLocaleString("en-IN")}
            </button>
          ))}
          <button
            onClick={() => setUseCustom(true)}
            className={`py-2 rounded-lg text-sm font-semibold border ${
              useCustom ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
            }`}
          >
            Other
          </button>
        </div>
        {useCustom && (
          <Input type="number" placeholder="Enter amount (₹)" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} />
        )}
      </Field>

      {finalAmount > 0 ? (
        <div className="text-center py-2">
          <img src={qrSrc} alt="UPI QR code" className="mx-auto rounded-lg border border-slate-200 dark:border-slate-800" width={220} height={220} />
          <p className="text-sm text-slate-500 dark:text-slate-500 mt-3">Scan with any UPI app, or tap below on your phone</p>
          <a
            href={upiLink}
            className="inline-block mt-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
          >
            Pay ₹{finalAmount.toLocaleString("en-IN")} via UPI App
          </a>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
            After paying, your wallet balance will be updated once our team confirms the payment.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">Enter an amount to generate a payment QR.</p>
      )}
    </Modal>
  );
}

function DealerLedger({ dealerId }) {
  const [txns, setTxns] = useState([]);
  const [appsByCode, setAppsByCode] = useState({}); // draft/application_no -> { applicant_name, services }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("ledger_transactions")
        .select("*")
        .eq("dealer_id", dealerId)
        .order("created_at", { ascending: false });
      const rows = data || [];
      setTxns(rows);

      // Ledger entries reference the application via voucher_no (== draft_code
      // at the time it was accepted). Resolve those back to a service +
      // applicant name to display, instead of parsing the free-text description.
      const codes = [...new Set(rows.map((t) => t.voucher_no).filter(Boolean))];
      if (codes.length) {
        const { data: apps } = await supabase
          .from("applications")
          .select("draft_code, application_no, applicant_name, services(parent_service, short_name)")
          .eq("dealer_id", dealerId)
          .or(codes.map((c) => `draft_code.eq.${c},application_no.eq.${c}`).join(","));
        const map = {};
        (apps || []).forEach((a) => {
          const label = a.services ? (a.services.short_name || a.services.parent_service) : null;
          if (a.draft_code) map[a.draft_code] = { applicant_name: a.applicant_name, service: label };
          if (a.application_no) map[a.application_no] = { applicant_name: a.applicant_name, service: label };
        });
        setAppsByCode(map);
      } else {
        setAppsByCode({});
      }
      setLoading(false);
    })();
  }, [dealerId]);

  // Running balance shown per-row, computed chronologically (oldest first)
  // even though the table itself displays newest-first.
  const balanceById = {};
  let running = 0;
  [...txns].reverse().forEach((t) => {
    running += t.type === "credit" ? Number(t.amount || 0) : -Number(t.amount || 0);
    balanceById[t.id] = running;
  });
  const currentBalance = running;

  return (
    <Card title="My Ledger">
      <p className="text-sm text-slate-500 dark:text-slate-500 mb-4">
        Running balance: <span className="font-bold text-slate-800 dark:text-slate-100">₹{currentBalance.toLocaleString("en-IN")}</span>
      </p>
      {loading ? (
        <p className="text-slate-400 dark:text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Service</th>
                <th className="text-left font-medium px-3 py-2">Applicant Name</th>
                <th className="text-right font-medium px-3 py-2">Amount</th>
                <th className="text-right font-medium px-3 py-2">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => {
                const matched = appsByCode[t.voucher_no];
                return (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{t.created_at ? new Date(t.created_at).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{matched?.service || t.description || t.remarks || "—"}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{matched?.applicant_name || "—"}</td>
                    <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${t.type === "credit" ? "text-emerald-600" : "text-rose-600"}`}>
                      {t.type === "credit" ? "+" : "-"}₹{Number(t.amount || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">₹{balanceById[t.id].toLocaleString("en-IN")}</td>
                  </tr>
                );
              })}
              {txns.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 dark:text-slate-500 py-8">No ledger entries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
