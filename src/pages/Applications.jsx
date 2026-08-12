// src/pages/Applications.jsx
import React, { useEffect, useState, useCallback, useMemo, useContext, createContext, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Card, StatusBadge, PrimaryButton, GhostButton, DangerButton, Field, Input, Select, Modal, Toast, STATUS_DISPLAY_LABELS, ROW_STATUS_TINT } from "../components/UI";
import ChatPanel from "../components/ChatPanel";
import ApplicationChatModal from "../components/ApplicationChatModal";
import SearchableSelect from "../components/SearchableSelect";
import { parseCSV, findByLabel } from "../lib/csv";
import BookAppointmentModal from "../components/BookAppointmentModal";
import { identityFor } from "../lib/chat";
import { isEligibleForAppointment, copyForwardDocuments } from "../lib/nextService";
import { MessageCircle, Phone, ArrowUp, ArrowDown, ArrowUpDown, Trash2, Link as LinkIcon } from "lucide-react";
import PCCStatusCheckModal from "../components/PCCStatusCheckModal";
import PCCLetterModal from "../components/PCCLetterModal";
import { DELHI_POLICE_STATIONS } from "../lib/delhiPoliceStations";
import { ageHighlightClass, validateAgeForService } from "../lib/age";
import DocUploadDropzone from "../components/DocUploadDropzone";


const STATUS_TABS = ["All", "Draft Submitted", "Under Review", "On Hold", "Rejected", "Accepted"];

// Columns a staff member can hide/show via the "Columns" button. Draft ID
// and Status stay pinned (always shown) since they're the primary way to
// identify/act on a row; everything else is optional detail. Mobile and
// Remark are deliberately left out of this list — they're always hidden by
// default and only revealed together via the dedicated toggle button next
// to "+ New Application".
const TOGGLEABLE_COLUMNS = [
  { key: "applicationDate", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "dealer", label: "Dealer" },
  { key: "service", label: "Service" },
  { key: "applicant", label: "Applicant" },
  { key: "dob", label: "DOB" },
  { key: "rtoFee", label: "Fee" },
  { key: "pccFee", label: "PCC Fee" },
  { key: "agencyFee", label: "Agency Fee" },
  { key: "profit", label: "Profit" },
  { key: "application", label: "Application" },
  { key: "lldl", label: "LL/DL No." },
  { key: "pccno", label: "PCC No" },
  { key: "rto", label: "RTO" },
  { key: "agency", label: "Agency" },
  { key: "slot", label: "Slot" },
];

// Columns a restricted "Staff View" is locked to — everything except the
// financial columns (Amount, Agency Fee, Profit). Dealer name is shown so
// staff can tell whose application they're looking at; whether it's
// editable there follows the same can_edit permission as every other cell
// (via CanEditContext), same as before. Staff in this view can't toggle any
// of these columns back on/off (see `restricted` prop on Applications).
const STAFF_VISIBLE_KEYS = [
  "applicationDate", "dealer", "service", "applicant", "dob", "rtoFee", "pccFee",
  "application", "lldl", "pccno", "rto", "agency", "slot", "mobile", "remark",
];

// Role-driven write lock. Applications() provides the current role's
// can_edit permission here; EditableCell/EditableSelect read it so every
// inline-edit control in the table is automatically locked for read-only
// roles without having to pass `disabled` at each of the ~15 call sites.
const CanEditContext = createContext(true);

// DOB helpers: stored in DB as ISO (YYYY-MM-DD), displayed/copied/typed as DD-MM-YYYY
function isoToDDMMYYYY(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function ddmmyyyyToISO(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const m = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed; // already ISO
  return trimmed; // leave as-is, let DB flag invalid dates
}

function EditableCell({ value, onSave, type = "text", width = "w-24", placeholder = "", disabled = false, noSpinner = false }) {
  const canEdit = useContext(CanEditContext);
  const locked = disabled || !canEdit;
  const [val, setVal] = useState(value ?? "");
  useEffect(() => { setVal(value ?? ""); }, [value]);
  return (
    <input
      type={type}
      value={locked ? (disabled ? "" : val) : val}
      placeholder={disabled ? "Not required" : (!canEdit ? "" : placeholder)}
      disabled={locked}
      title={!canEdit && !disabled ? "You don't have edit access for this section" : undefined}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (String(val) !== String(value ?? "")) onSave(val); }}
      className={`${width} rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${noSpinner ? "no-spinner" : ""} ${
        locked
          ? "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 placeholder:text-slate-300 dark:placeholder:text-slate-600 cursor-not-allowed"
          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
      }`}
    />
  );
}

function EditableSelect({ value, options, onSave, width = "w-32", placeholder = "Select", disabled = false }) {
  const canEdit = useContext(CanEditContext);
  const locked = disabled || !canEdit;
  return (
    <select
      value={locked && disabled ? "" : value || ""}
      onChange={(e) => onSave(e.target.value)}
      disabled={locked}
      title={!canEdit && !disabled ? "You don't have edit access for this section" : undefined}
      className={`${width} rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
        locked
          ? "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 cursor-not-allowed"
          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
      }`}
    >
      <option value="">{disabled ? "Not required" : placeholder}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

// Mirrors PCC_STAGE_ORDER/LABELS in PCCStatusCheckModal.jsx and
// api/_lib/pccClient.js — the 6 granular stages the auto-sync cron writes
// into pcc_stage every ~2 hours, shown here as a compact dot row so staff
// can see progress at a glance without opening the modal.
const PCC_STAGE_ORDER = ["Pending", "Assigned", "Field Verified", "Approved", "Verified", "Certificate Issued"];
const PCC_STAGE_SHORT_LABELS = {
  Pending: "Submitted",
  Assigned: "Assigned",
  "Field Verified": "Field Verified",
  Approved: "Approved",
  Verified: "Verified",
  "Certificate Issued": "Cert. Issued",
};

function PCCStageDots({ pccStage, pccCertificatePath }) {
  if (!pccStage) return null;
  const currentIdx = PCC_STAGE_ORDER.indexOf(pccStage);
  return (
    <div className="flex items-center gap-1" title={`Auto-synced stage: ${PCC_STAGE_SHORT_LABELS[pccStage] || pccStage}`}>
      {PCC_STAGE_ORDER.map((stage, i) => (
        <span
          key={stage}
          className={`w-1.5 h-1.5 rounded-full ${i <= currentIdx ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"}`}
        />
      ))}
      {pccCertificatePath && (
        <a
          href={supabase.storage.from("application-documents").getPublicUrl(pccCertificatePath).data.publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Download the saved certificate"
          className="ml-1 text-emerald-600 hover:text-emerald-700"
        >
          📄
        </a>
      )}
    </div>
  );
}

const PCC_STATUS_OPTIONS = ["Under Verification", "Certificate Issued", "Rejected", "Police Case"];
const PCC_STATUS_STYLES = {
  "Under Verification": "bg-yellow-50 text-yellow-800 border-yellow-300",
  "Certificate Issued": "bg-green-50 text-green-700 border-green-300",
  Rejected: "bg-red-50 text-red-700 border-red-300",
  "Police Case": "bg-orange-50 text-orange-700 border-orange-300",
};
function PCCNoPopup({ pccNo, pccStatus, onSave, onOpenPortal }) {
  const [open, setOpen] = useState(false);
  const [localNo, setLocalNo] = useState(pccNo || "");
  const [localStatus, setLocalStatus] = useState(pccStatus || "");
  const wrapRef = React.useRef(null);

  useEffect(() => {
    if (open) {
      setLocalNo(pccNo || "");
      setLocalStatus(pccStatus || "");
    }
  }, [open, pccNo, pccStatus]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleUpdate = () => {
    onSave({ pcc_no: localNo.trim() || null, pcc_status: localStatus || null });
    setOpen(false);
  };

  const style = pccStatus
    ? PCC_STATUS_STYLES[pccStatus] || "bg-blue-50 text-blue-600 border-blue-200"
    : null;

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          pccNo
            ? `px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${style}`
            : "text-blue-600 text-xs font-semibold hover:underline whitespace-nowrap"
        }
      >
        {pccNo || "+ Add PCC No"}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg w-60 overflow-hidden text-xs">
          <table className="w-full">
            <tbody>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2 font-semibold text-slate-500 dark:text-slate-500 w-16 align-middle">pcc no</td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={localNo}
                    onChange={(e) => setLocalNo(e.target.value)}
                    placeholder="DLSB-PCC/…"
                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
              </tr>
              <tr>
                <td className="bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2 font-semibold text-slate-500 dark:text-slate-500 align-middle">status</td>
                <td className="px-2 py-1.5">
                  <select
                    value={localStatus}
                    onChange={(e) => setLocalStatus(e.target.value)}
                    className="w-full rounded border border-slate-300 dark:border-slate-700 px-1.5 py-1 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">Not Started</option>
                    {PCC_STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
          <button
            type="button"
            onClick={onOpenPortal}
            className="w-full text-left px-2.5 py-1.5 text-[11px] text-blue-600 hover:bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800"
          >
            Open Delhi Police PCC portal ↗
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            className="w-full bg-orange-200 hover:bg-orange-300 text-orange-900 font-bold py-2 transition-colors"
          >
            update
          </button>
        </div>
      )}
    </div>
  );
}
function serviceLabel(s) {
  if (!s) return "";
  return s.short_name || s.parent_service;
}
// Any service whose name mentions PCC (e.g. "PCC" itself, or
// "LL RIC (with PCC Required)") gets auto-tagged with the "PCC" RTO below,
// so filtering/searching RTO="PCC" surfaces every PCC-related application
// in one place — not just ones on a real RTO's docket.
function isPccRelatedService(service) {
  const label = `${service?.parent_service || ""} ${service?.short_name || ""}`.toLowerCase();
  return label.includes("pcc");
}
function findPccRto(rtoList) {
  return (
    rtoList.find((r) => (r.name || "").trim().toLowerCase() === "pcc") ||
    rtoList.find((r) => (r.name || "").toLowerCase().includes("pcc")) ||
    null
  );
}
function dealerLabel(d) {
  if (!d) return "";
  return d.short_name || d.name;
}

function SortableTh({ column, label, sortKey, sortDir, onSort }) {
  const active = sortKey === column;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="text-left font-medium px-3 py-2 whitespace-nowrap">
      <button
        onClick={() => onSort(column)}
        className={`flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 ${active ? "text-slate-800 dark:text-slate-100 font-semibold" : ""}`}
      >
        {label}
        <Icon size={12} className={active ? "" : "opacity-40"} />
      </button>
    </th>
  );
}

// Service-answer keys are free text (typed by staff), so "Learner No",
// "learner no", "Learner No.", " Learner No" etc. can all occur — match
// loosely instead of requiring an exact key.
function getLearnerNo(answers) {
  if (!answers) return "";
  const entry = Object.entries(answers).find(([k]) =>
    k.replace(/[^a-z]/gi, "").toLowerCase().includes("learnerno")
  );
  return entry ? entry[1] || "" : "";
}

export default function Applications({ restricted = false, canEdit = true, canApprove = true, staff } = {}) {
  const isAdmin = staff?.roles?.role_name === "Admin";
  const [tab, setTab] = useState("All");
  const [chatOnly, setChatOnly] = useState(false);
  const [compactView, setCompactView] = useState(false); // point 9
  // Defaults to current-year-only once the data set gets large (13k+ historical
  // rows made "show everything" the default choke point). "Show All" lets
  // anyone drop back to the full history on demand.
  const [showAllYears, setShowAllYears] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState(null); // "customer" | "status"
  const [chatApp, setChatApp] = useState(null); // row whose small floating chat is open (point 10)
  const [detailPopup, setDetailPopup] = useState(null); // row shown in the Draft ID quick-detail popup (point 13)
  const [staffIdentity, setStaffIdentity] = useState(null);
  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { data: staffRow } = await supabase.from("staff").select("id, full_name").eq("auth_user_id", userData?.user?.id).maybeSingle();
      if (staffRow) setStaffIdentity(identityFor({ staff: staffRow }));
    })();
  }, []);
  const [staffList, setStaffList] = useState([]);
  const [dealerList, setDealerList] = useState([]);
  const [dealerHold, setDealerHold] = useState({}); // dealer_id -> true when out of usable credit
  const [serviceList, setServiceList] = useState([]);
  const [rtoList, setRtoList] = useState([]);
  const [agencyList, setAgencyList] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showUpdateCsv, setShowUpdateCsv] = useState(false);
  const [toast, setToast] = useState(null);
  const [pccCheckRow, setPccCheckRow] = useState(null);
  const [chatStatus, setChatStatus] = useState({}); // { [applicationId]: unreadCount } — omitted/0 when nothing's awaiting our reply

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() =>
    Object.fromEntries(TOGGLEABLE_COLUMNS.map((c) => [c.key, restricted ? STAFF_VISIBLE_KEYS.includes(c.key) : true]))
  );
  const toggleCol = (key) => setVisibleCols((v) => ({ ...v, [key]: !v[key] }));
  // Mobile and Remark are hidden by default and only shown together, via
  // the button under "+ New Application" — kept separate from the general
  // column picker per how this table is meant to be used day-to-day.
  const [showRemarkMobile, setShowRemarkMobile] = useState(false);
  const [filterDealer, setFilterDealer] = useState("");
  const [filterRto, setFilterRto] = useState("");
  const [filterAgency, setFilterAgency] = useState("");
  const [filterService, setFilterService] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc"); // "asc" | "desc"

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    // The service embed needs !inner (forcing an inner join) only when we're
    // filtering on one of its own columns (pcc_required) — using !inner
    // unconditionally would silently drop any application whose service_id
    // is somehow null.
    const servicesEmbed = filterService === "__PCC_REQUIRED__"
      ? "services!inner(parent_service,short_name,pcc_required,rto_required,agency_required,slot_booking_required,chat_in_app,next_service_id,next_service_wait_days,age_limit_required,min_age)"
      : "services(parent_service,short_name,pcc_required,rto_required,agency_required,slot_booking_required,chat_in_app,next_service_id,next_service_wait_days,age_limit_required,min_age)";
    let query = supabase
      .from("applications")
      .select(`*, dealers(name,code,short_name), ${servicesEmbed}, staff:assigned_staff_id(full_name)`)
      .order("submitted_at", { ascending: false });
    if (tab !== "All") query = query.eq("status", tab);
    // Dealer / RTO / Agency / Service filters used to run client-side after
    // fetching the entire table (all ~15k rows every time, joins and all) —
    // pushed into the query itself so only the rows that actually match
    // come over the network.
    if (filterDealer) query = query.eq("dealer_id", filterDealer);
    if (filterRto) query = query.eq("rto_id", filterRto);
    if (filterAgency) query = query.eq("agency_id", filterAgency);
    if (filterService === "__PCC_REQUIRED__") {
      query = query.eq("services.pcc_required", true);
    } else if (filterService) {
      query = query.eq("service_id", filterService);
    }
    // Date filtering: an explicit From/To range overrides the current-year
    // default, exactly as it did client-side before — just evaluated by
    // Postgres now instead of being fetched in full and thrown away in the
    // browser. The current-year default mirrors the old logic: prefer
    // application_date, fall back to submitted_at when application_date is
    // unset.
    if (filterDateFrom || filterDateTo) {
      if (filterDateFrom) query = query.gte("submitted_at", `${filterDateFrom}T00:00:00`);
      if (filterDateTo) query = query.lte("submitted_at", `${filterDateTo}T23:59:59`);
    } else if (!showAllYears) {
      const currentYear = new Date().getFullYear();
      const yFrom = `${currentYear}-01-01`;
      const yTo = `${currentYear}-12-31`;
      query = query.or(
        `and(application_date.gte.${yFrom},application_date.lte.${yTo}),and(application_date.is.null,submitted_at.gte.${yFrom}T00:00:00,submitted_at.lte.${yTo}T23:59:59)`
      );
    }
    const { data, error } = await query;
    if (error) {
      setToast("Couldn't load applications: " + error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const baseRows = data || [];
    setRows(baseRows);
    setLoading(false);

    // Chat awaiting-reply flags: fetched separately (and best-effort) so a
    // failure here never blocks the main applications list from loading.
    const chatAppIds = baseRows.filter((r) => r.services?.chat_in_app).map((r) => r.id);
    if (chatAppIds.length === 0) { setChatStatus({}); return; }
    try {
      const { data: threads, error: threadsError } = await supabase
        .from("chat_threads")
        .select("id, application_id")
        .in("application_id", chatAppIds);
      if (threadsError || !threads?.length) { setChatStatus({}); return; }
      const threadIds = threads.map((t) => t.id);
      const { data: messages, error: messagesError } = await supabase
        .from("chat_messages")
        .select("thread_id, sender_type, created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false });
      if (messagesError) { setChatStatus({}); return; }
      // Messages are newest-first, so walking from the top and counting the
      // unbroken run of non-staff messages approximates "unread since our
      // last reply" without needing separate read-receipt tracking. This
      // count is what shows in the badge next to the Draft ID.
      const messagesByThread = {};
      for (const m of messages || []) {
        (messagesByThread[m.thread_id] ||= []).push(m);
      }
      const statusByApp = {};
      for (const t of threads) {
        const threadMsgs = messagesByThread[t.id] || [];
        let count = 0;
        for (const m of threadMsgs) {
          if (m.sender_type === "staff") break;
          count++;
        }
        if (count > 0) statusByApp[t.application_id] = count;
      }
      setChatStatus(statusByApp);
    } catch {
      setChatStatus({});
    }
  }, [tab, filterDealer, filterRto, filterAgency, filterService, filterDateFrom, filterDateTo, showAllYears]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("staff").select("id, full_name");
      setStaffList(s || []);
      const { data: d } = await supabase.from("dealers").select("id, name, code, short_name").order("name");
      setDealerList(d || []);
      const { data: summaries } = await supabase.from("dealer_ledger_summary").select("dealer_id, credit_limit, running_balance");
      setDealerHold(Object.fromEntries((summaries || []).filter((s) => (Number(s.credit_limit || 0) + Number(s.running_balance || 0)) <= 0).map((s) => [s.dealer_id, true])));
      const { data: sv } = await supabase.from("services").select("id, parent_service, short_name, pcc_required, rto_required, agency_required, slot_booking_required, chat_in_app, age_limit_required, min_age").order("parent_service");
      setServiceList(sv || []);
      const { data: rt } = await supabase.from("rtos").select("id, name, code, type").order("name");
      setRtoList(rt || []);
      const { data: ag } = await supabase.from("agencies").select("id, name, code").order("name");
      setAgencyList(ag || []);
    })();
  }, []);

  const openDetail = async (row, mode = "customer") => {
    // Re-fetch this one application fresh (rather than trusting the row object
    // from local list state, which can be stale — e.g. right after a staff
    // assignment — and was causing "assigned staff not showing" on reopen).
    const { data: freshRow } = await supabase
      .from("applications")
      .select("*, dealers(name,code,short_name), services(parent_service,short_name,pcc_required,rto_required,agency_required,slot_booking_required,chat_in_app,next_service_id,next_service_wait_days,age_limit_required,min_age), staff:assigned_staff_id(full_name)")
      .eq("id", row.id)
      .maybeSingle();
    let docs = (await supabase.from("application_documents").select("*").eq("application_id", row.id)).data || [];
    // Safety net: a service's required documents can change after an
    // application was created (e.g. a new "only after approval" doc gets
    // added to the service later). application_documents is a one-time
    // snapshot taken at creation, so older applications silently miss any
    // doc type added afterwards — they don't even show as "Missing", the
    // row just doesn't exist. Diff against the service's current required
    // docs and backfill anything absent, rather than only handling the
    // zero-docs case.
    const serviceId = row.service_id || freshRow?.service_id;
    if (serviceId) {
      const { data: reqDocs } = await supabase
        .from("service_documents")
        .select("name, mandatory, post_approval")
        .eq("service_id", serviceId);
      const existingNames = new Set(docs.map((d) => d.name));
      const missing = (reqDocs || []).filter((d) => !existingNames.has(d.name));
      if (missing.length) {
        const { error: backfillError } = await supabase.from("application_documents").upsert(
          missing.map((d) => ({ application_id: row.id, name: d.name, mandatory: d.mandatory, post_approval: d.post_approval, status: "Pending" })),
          { onConflict: "application_id,name", ignoreDuplicates: true }
        );
        if (!backfillError) {
          docs = (await supabase.from("application_documents").select("*").eq("application_id", row.id)).data || [];
        }
      }
    }
    const { data: history } = await supabase
      .from("application_status_history")
      .select("*")
      .eq("application_id", row.id)
      .order("changed_at", { ascending: false });
    setSelected({ ...row, ...(freshRow || {}), docs, history });
    setModalMode(mode);
  };

  const closeDetail = () => {
    setSelected(null);
    setModalMode(null);
    load();
  };

  const updatePccFields = async (id, fields) => {
    const { error } = await supabase.from("applications").update(fields).eq("id", id);
    if (error) {
      setToast("Failed to update PCC details: " + error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...fields } : r)));
    setToast("PCC details updated");
  };

  // Shared "approve" logic: flips an application to Accepted (unless it already
  // is) and debits the dealer's ledger for the application amount. Used both by
  // the quick Approve button in the table and the Accept button inside the
  // status modal, so the ledger behavior can't drift between the two entry points.
  // Returns { ok, message } — caller decides how to surface it (toast/closeDetail/etc).
  const approveApplication = async (app, remarks = app.remarks) => {
    if (app.status === "Accepted") {
      return { ok: false, message: "Already accepted" };
    }
    // Keep an application_date that was already set (e.g. auto-filled when it
    // moved to Under Review, or hand-edited) rather than clobbering it here.
    const applicationDate = app.application_date || new Date().toISOString().slice(0, 10);
    // Accepted is now the final status — approval already implies the physical
    // process is fulfilled, so this is also what starts the 30-day "eligible
    // for next service" clock (write once, don't clobber an existing value).
    const updatePayload = { status: "Accepted", remarks, application_date: applicationDate };
    if (!app.completed_at) updatePayload.completed_at = new Date().toISOString();

    const { error } = await supabase
      .from("applications")
      .update(updatePayload)
      .eq("id", app.id);
    if (error) {
      return { ok: false, message: "Failed: " + error.message };
    }

    const serviceAndName = [serviceLabel(app.services), app.applicant_name].filter(Boolean).join(" ");
    const descriptionParts = [
      serviceAndName || null,
      app.application_no ? `App No: ${app.application_no}` : null,
      app.date_of_birth ? `DOB: ${isoToDDMMYYYY(app.date_of_birth)}` : null,
    ].filter(Boolean);

    const { error: ledgerError } = await supabase.from("ledger_transactions").insert({
      dealer_id: app.dealer_id,
      type: "debit",
      amount: app.amount || 0,
      voucher_no: app.draft_code,
      description: descriptionParts.join(" · "),
    });
    if (ledgerError) {
      return { ok: false, message: "Status updated, but ledger entry failed: " + ledgerError.message };
    }

    return {
      ok: true,
      message: `Accepted on ${isoToDDMMYYYY(applicationDate)} — ₹${Number(app.amount || 0).toLocaleString("en-IN")} debited to dealer ledger`,
    };
  };

  // Admin-only: deletes an application record outright. If it had already
  // been approved (debited to the dealer ledger, voucher_no = draft_code),
  // that ledger entry is removed too so the ledger doesn't keep a debit
  // for a record that no longer exists. The Agency Fee agency ledger entry
  // (voucher_no = draft_code-AGENCYFEE) isn't gated by status, so it's
  // always cleaned up here too.
  const deleteApplication = async (app) => {
    if (!window.confirm(`Delete application ${app.draft_code} (${app.applicant_name})? This cannot be undone.`)) return;
    if (app.status === "Accepted") {
      await supabase.from("ledger_transactions").delete().eq("dealer_id", app.dealer_id).eq("voucher_no", app.draft_code);
    }
    await supabase.from("agency_ledger_transactions").delete().eq("voucher_no", `${app.draft_code}-AGENCYFEE`);
    await supabase.from("application_documents").delete().eq("application_id", app.id);
    const { error } = await supabase.from("applications").delete().eq("id", app.id);
    if (error) {
      setToast("Failed to delete: " + error.message);
      return;
    }
    setToast("Application deleted");
    closeDetail();
    load();
  };

  const updateStatus = async (newStatus, remarks) => {
    if (newStatus === "Accepted") {
      const result = await approveApplication(selected, remarks);
      setToast(result.message);
      closeDetail();
      load();
      return;
    }

    const updatePayload = { status: newStatus, remarks };
    // Moving an application to Under Review marks the day it was formally
    // taken up — auto-fill it the first time, but never overwrite a date
    // that's already set (auto-filled earlier, or hand-edited in the table).
    if (newStatus === "Under Review" && !selected.application_date) {
      updatePayload.application_date = new Date().toISOString().slice(0, 10);
    }

    const { error } = await supabase
      .from("applications")
      .update(updatePayload)
      .eq("id", selected.id);
    if (error) {
      setToast("Failed: " + error.message);
      return;
    }

    setToast(`Marked as ${newStatus}`);
    closeDetail();
    load();
  };

  const assignStaff = async (staffId) => {
    const { error } = await supabase
      .from("applications")
      .update({ assigned_staff_id: staffId })
      .eq("id", selected.id);
    if (error) {
      setToast("Assignment failed: " + error.message);
      return;
    }
    setToast("Staff assigned");
    setSelected((s) => ({ ...s, assigned_staff_id: staffId }));
    load();
  };

  const updateRowField = async (id, field, value) => {
    const { error } = await supabase.from("applications").update({ [field]: value }).eq("id", id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  // Amount is special-cased: if this application has already been
  // Accepted, a matching debit already sits in ledger_transactions
  // (posted by approveApplication below). Editing Amount here needs to
  // keep that ledger row in sync too, same as editing it from the Ledger
  // page already keeps the application in sync (see
  // update_dealer_ledger_amount / 013_atomic_ledger_amount_update.sql).
  // update_application_amount does both writes in one atomic function
  // call so they can't drift from a half-completed save.
  const updateApplicationAmount = async (id, value) => {
    const newAmount = value === "" || value === null ? 0 : value;
    const { error } = await supabase.rpc("update_application_amount", {
      p_application_id: id,
      p_new_amount: newAmount,
    });
    if (error) {
      setToast("Failed to update amount: " + error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, amount: newAmount } : r)));
  };

  // Keeps the Agency's ledger in sync with an application's Agency Fee —
  // posts as a debit (it's a cost we owe the agency), independent of the
  // application's status. voucher_no is suffixed so it never collides with
  // a Payments-page voucher on the same draft_code. Delete-then-insert keeps
  // this idempotent whether the fee/agency changed or was cleared.
  const syncAgencyFeeLedger = async (row, agencyFeeValue, agencyId) => {
    const voucherNo = `${row.draft_code}-AGENCYFEE`;
    const { error: delError } = await supabase.from("agency_ledger_transactions").delete().eq("voucher_no", voucherNo);
    if (delError) return { error: delError };
    if (agencyFeeValue && agencyId) {
      const descriptionParts = [
        "Agency Fee",
        [serviceLabel(row.services), row.applicant_name].filter(Boolean).join(" ") || null,
        row.application_no ? `App No: ${row.application_no}` : null,
      ].filter(Boolean);
      const { error: insError } = await supabase.from("agency_ledger_transactions").insert({
        agency_id: agencyId,
        voucher_no: voucherNo,
        type: "debit",
        amount: agencyFeeValue,
        description: descriptionParts.join(" · "),
      });
      if (insError) return { error: insError };
    }
    return { error: null };
  };

  // Agency Fee needs an Agency to post its debit to, so entering a fee with
  // no Agency selected is blocked rather than silently skipping the ledger.
  const updateAgencyFee = async (row, rawValue) => {
    const value = rawValue === "" ? null : parseFloat(rawValue);
    if (value !== null && !row.agency_id) {
      setToast("Select an Agency for this application first — Agency Fee needs an agency to post to.");
      return;
    }
    const { error } = await supabase.from("applications").update({ agency_fee: value }).eq("id", row.id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, agency_fee: value } : r)));
    const { error: ledgerError } = await syncAgencyFeeLedger(row, value, row.agency_id);
    if (ledgerError) setToast("Agency Fee saved, but agency ledger sync failed: " + ledgerError.message);
  };

  // Changing the Agency while an Agency Fee is already set moves the ledger
  // debit to the new agency; clearing the Agency is blocked in that case
  // instead of leaving an orphaned fee with nowhere to post.
  const updateAgencyId = async (row, value) => {
    const newAgencyId = value || null;
    if (row.agency_fee && !newAgencyId) {
      setToast("Can't remove the Agency while an Agency Fee is set on this application — clear the Agency Fee first.");
      return;
    }
    const { error } = await supabase.from("applications").update({ agency_id: newAgencyId }).eq("id", row.id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, agency_id: newAgencyId } : r)));
    if (row.agency_fee) {
      const { error: ledgerError } = await syncAgencyFeeLedger(row, row.agency_fee, newAgencyId);
      if (ledgerError) setToast("Agency updated, but ledger sync failed: " + ledgerError.message);
    }
  };

  // PCC Fee is the trigger for auto-stamping today's date into Slot — used
  // here purely as a "fee received on" marker, not an actual slot booking.
  // Only fills it in when Slot is currently blank, so it never overwrites a
  // real slot time someone already typed in for a service that needs one.
  const updatePccFee = async (row, rawValue) => {
    const feeValue = rawValue === "" ? null : parseFloat(rawValue);
    const fields = { pcc_fee: feeValue };
    if (feeValue !== null && !row.slot_time) {
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      fields.slot_time = `${dd}-${mm}-${today.getFullYear()}`;
    }
    const { error } = await supabase.from("applications").update(fields).eq("id", row.id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...fields } : r)));
  };


  // Changing dealer/service on a Draft mid-flight (point 5/6) needs to also
  // refresh the row's joined `dealers`/`services` objects locally — other
  // cells (RTO/PCC/Agency/Slot required flags, dealer HOLD badge) read off
  // those joined objects, not the raw *_id, so without this they'd show
  // stale requirements until the next full page reload.
  const updateDealerOrService = async (id, field, value, list) => {
    const picked = list.find((item) => item.id === value);
    // Changing the service to a PCC-related one (e.g. "PCC" or "LL RIC
    // (with PCC Required)") auto-tags RTO as "PCC" too — see
    // isPccRelatedService/findPccRto above.
    const extra = field === "service_id" && isPccRelatedService(picked)
      ? { rto_id: findPccRto(rtoList)?.id || null }
      : {};
    const { error } = await supabase.from("applications").update({ [field]: value, ...extra }).eq("id", id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    const joinedKey = field === "dealer_id" ? "dealers" : "services";
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value, ...extra, [joinedKey]: picked || r[joinedKey] } : r)));
  };

  const openSarathi = async (row) => {
    if (!row.application_no) {
      setToast("Enter Application No first");
      return;
    }
    if (row.date_of_birth) {
      const formattedDob = isoToDDMMYYYY(row.date_of_birth);
      try {
        await navigator.clipboard.writeText(formattedDob);
        setToast("DOB copied: " + formattedDob);
      } catch {
        // clipboard may be blocked; ignore silently
      }
    }
    const url = `https://sarathi.parivahan.gov.in/sarathiservice/applicationredirect.do?as=${encodeURIComponent(row.application_no)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openPccPortal = async (row) => {
    const copyText = row.pcc_no || row.applicant_name || "";
    if (copyText) {
      try {
        await navigator.clipboard.writeText(copyText);
        setToast((row.pcc_no ? "PCC No copied: " : "Name copied: ") + copyText);
      } catch {
        // clipboard may be blocked; ignore silently
      }
    }
    window.open("https://pcccvr.delhipolice.gov.in/login", "_blank", "noopener,noreferrer");
  };

  const updateApplicantDetails = async (fields) => {
    const { error } = await supabase.from("applications").update(fields).eq("id", selected.id);
    if (error) {
      setToast("Failed to save: " + error.message);
      return;
    }
    setToast("Applicant details saved");
    setSelected((s) => ({ ...s, ...fields }));
    load();
  };

  const updateAnswers = async (answersObj) => {
    const { error } = await supabase
      .from("applications")
      .update({ service_answers: answersObj })
      .eq("id", selected.id);
    if (error) {
      setToast("Failed to save details: " + error.message);
      return;
    }
    setToast("Details saved");
    setSelected((s) => ({ ...s, service_answers: answersObj }));
    load();
  };

  const [bookingApp, setBookingApp] = useState(null); // { sourceApp, nextService } | null

  // Shared by createApplication and bookAppointment — copies a service's
  // required-document list onto a newly created application.
  const copyRequiredDocuments = async (applicationId, serviceId) => {
    if (!serviceId) return;
    const { data: reqDocs } = await supabase
      .from("service_documents")
      .select("name, mandatory, post_approval")
      .eq("service_id", serviceId);
    if (reqDocs?.length) {
      await supabase.from("application_documents").insert(
        reqDocs.map((d) => ({ application_id: applicationId, name: d.name, mandatory: d.mandatory, post_approval: d.post_approval, status: "Pending" }))
      );
    }
  };

  const createApplication = async (form) => {
    const { data: draftCode, error: codeError } = await supabase.rpc("next_draft_code", { p_dealer_id: form.dealer_id });
    if (codeError) {
      setToast("Failed: " + codeError.message);
      return;
    }
    const selectedService = serviceList.find((s) => s.id === form.service_id);
    const autoRtoId = isPccRelatedService(selectedService) ? findPccRto(rtoList)?.id || null : null;
    const { data: newApp, error } = await supabase.from("applications").insert({
      draft_code: draftCode,
      dealer_id: form.dealer_id,
      service_id: form.service_id,
      applicant_name: form.applicant_name,
      father_husband_name: form.father_husband_name || null,
      date_of_birth: form.date_of_birth || null,
      mobile: form.mobile || null,
      address: form.address || null,
      police_station: form.police_station || null,
      stay_since: form.stay_since || null,
      service_answers: form.service_answers && Object.keys(form.service_answers).length ? form.service_answers : null,
      status: form.status,
      rto_id: autoRtoId,
    }).select().single();
    if (error) {
      setToast("Failed to create: " + error.message);
      return;
    }

    // Mirror DealerPortal.jsx: copy this service's required-document list
    // onto the new application. Without this, applications created here
    // (as opposed to by the dealer) silently end up with zero required
    // documents even if the service has some configured in Masters.
    await copyRequiredDocuments(newApp.id, form.service_id);

    setToast(`Created ${draftCode}`);
    setShowNew(false);
    load();
  };

  // Learner's Licence -> Driving Licence (or whatever Next Service is
  // configured) — creates the follow-up draft from BookAppointmentModal.
  const bookAppointment = async (payload) => {
    const { data: newApp, error } = await supabase.from("applications").insert(payload).select().single();
    if (error) throw new Error(error.message);
    await copyRequiredDocuments(newApp.id, payload.service_id);
    await copyForwardDocuments(bookingApp.sourceApp.id, newApp.id);
    setToast(`Created ${payload.draft_code} from ${bookingApp.sourceApp.draft_code}`);
    setBookingApp(null);
    load();
  };

  // Applications that already have a follow-up draft created from them —
  // hides "Book Appointment" once it's been used, so it can't be clicked twice.
  const convertedSourceIds = new Set(rows.map((r) => r.source_application_id).filter(Boolean));

  const currentYear = new Date().getFullYear();
  // Dealer/RTO/Agency/Service and date-range filtering now happen in the
  // query itself (see load()) so a 15k-row table isn't fetched in full on
  // every load — this only handles chatOnly and free-text search, which
  // still run over whatever the query already narrowed down.
  const filteredRows = rows.filter((r) => {
    if (chatOnly && !chatStatus[r.id]) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = [
        r.draft_code, r.applicant_name, r.mobile, r.application_no, r.ll_dl_no,
        r.dealers?.name, r.dealers?.short_name, r.services?.parent_service, r.services?.short_name,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const profitOf = (r) => Number(r.amount || 0) - Number(r.rto_fee || 0) - Number(r.pcc_fee || 0) - Number(r.agency_fee || 0);

  // Accessor per sortable column header. Numeric columns compare as
  // numbers; everything else compares as case-insensitive strings.
  const SORT_ACCESSORS = {
    draftId: (r) => r.draft_code || "",
    applicationDate: (r) => r.application_date || "",
    amount: (r) => Number(r.amount || 0),
    dealer: (r) => dealerLabel(r.dealers) || "",
    service: (r) => serviceLabel(r.services) || "",
    applicant: (r) => r.applicant_name || "",
    dob: (r) => r.date_of_birth || "",
    rtoFee: (r) => Number(r.rto_fee || 0),
    pccFee: (r) => Number(r.pcc_fee || 0),
    agencyFee: (r) => Number(r.agency_fee || 0),
    profit: (r) => profitOf(r),
    application: (r) => r.application_no || "",
    lldl: (r) => r.ll_dl_no || "",
    pccno: (r) => r.pcc_no || "",
    rto: (r) => (r.services?.pcc_required ? "PCC" : rtoList.find((x) => x.id === r.rto_id)?.name || ""),
    agency: (r) => agencyList.find((x) => x.id === r.agency_id)?.name || "",
    slot: (r) => r.slot_time || "",
    mobile: (r) => r.mobile || "",
    remark: (r) => r.remarks || "",
    status: (r) => r.status || "",
  };

  const sortedRows = useMemo(() => {
    if (!sortKey || !SORT_ACCESSORS[sortKey]) return filteredRows;
    const acc = SORT_ACCESSORS[sortKey];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).toLowerCase().localeCompare(String(bv).toLowerCase()) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, sortKey, sortDir, rtoList, agencyList]);

  // Pagination — 14 rows per page by default. Export CSV still uses the full
  // sortedRows (unpaginated), only the on-screen table is sliced.
  const [pageSize, setPageSize] = useState(14);
  const PAGE_SIZE = pageSize;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [tab, search, filterDealer, filterRto, filterAgency, filterService, chatOnly, showAllYears]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pagedRows = useMemo(
    () => sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sortedRows, page]
  );

  const exportCSV = () => {
    const headers = restricted
      ? ["Draft ID", "Service", "Applicant", "DOB", "Fee", "PCC Fee", "Application No", "LL/DL No", "PCC No", "PCC Status", "RTO", "Agency", "Slot", "Mobile", "Remark", "Application Date", "Status", "Submitted At"]
      : ["Draft ID", "Amount", "Fee", "PCC Fee", "Agency Fee", "Dealer", "Service",
      "Applicant", "DOB", "Application No", "LL/DL No", "PCC No", "PCC Status", "RTO", "Agency",
      "Slot", "Mobile", "Remark", "Application Date", "Status", "Submitted At"];
    const escapeCsv = (val) => {
      const s = val === null || val === undefined ? "" : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    sortedRows.forEach((r) => {
      const rtoCell = r.services?.pcc_required ? "PCC" : rtoList.find((x) => x.id === r.rto_id)?.name;
      const fullRow = [
        r.draft_code, r.amount, r.rto_fee, r.pcc_fee, r.agency_fee,
        dealerLabel(r.dealers), serviceLabel(r.services), r.applicant_name, isoToDDMMYYYY(r.date_of_birth),
        r.application_no, r.ll_dl_no, r.pcc_no, r.pcc_status,
        rtoCell, agencyList.find((x) => x.id === r.agency_id)?.name,
        r.slot_time, r.mobile, r.remarks, r.application_date ? isoToDDMMYYYY(r.application_date) : "", r.status, r.submitted_at,
      ];
      const restrictedRow = [
        r.draft_code, serviceLabel(r.services), r.applicant_name, isoToDDMMYYYY(r.date_of_birth),
        r.rto_fee, r.pcc_fee, r.application_no, r.ll_dl_no, r.pcc_no, r.pcc_status,
        rtoCell, agencyList.find((x) => x.id === r.agency_id)?.name,
        r.slot_time, r.mobile, r.remarks, r.application_date ? isoToDDMMYYYY(r.application_date) : "", r.status, r.submitted_at,
      ];
      lines.push((restricted ? restrictedRow : fullRow).map(escapeCsv).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `applications-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => { setFilterDealer(""); setFilterRto(""); setFilterAgency(""); setFilterService(""); setFilterDateFrom(""); setFilterDateTo(""); };
  const activeFilterCount = [filterDealer, filterRto, filterAgency, filterService, filterDateFrom, filterDateTo].filter(Boolean).length;

  return (
    <CanEditContext.Provider value={canEdit}>
    <div>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap items-center">
          {STATUS_TABS.map((t) => {
            const draftCount = t === "Draft Submitted" ? rows.filter((r) => r.status === "Draft Submitted").length : 0;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${
                  tab === t ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                }`}
              >
                {STATUS_DISPLAY_LABELS[t] || t}
                {t === "Draft Submitted" && draftCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {draftCount}
                  </span>
                )}
              </button>
            );
          })}
          <span className="w-px h-5 bg-slate-200 mx-1" />
          <button
            onClick={() => setChatOnly((c) => !c)}
            title="Show only applications with chat enabled"
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${
              chatOnly ? "bg-blue-600 text-white border-blue-600" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
            }`}
          >
            💬 Chats
            {Object.values(chatStatus).some(Boolean) && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {Object.values(chatStatus).filter(Boolean).length}
              </span>
            )}
          </button>
          {!restricted && (
            <button
              onClick={() => setCompactView((c) => !c)}
              title="Toggle a denser, grouped-column table layout"
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                compactView ? "bg-violet-600 text-white border-violet-600" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
              }`}
            >
              ▦ Compact View
            </button>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAllYears((v) => !v)}
              title={showAllYears ? "Currently showing every year — click to go back to this year only" : `Currently showing ${currentYear} only — click to see all years`}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                showAllYears ? "bg-amber-500 text-white border-amber-500" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
              }`}
            >
              {showAllYears ? "📅 Showing All Years" : `📅 ${currentYear} Only`}
            </button>
            <GhostButton onClick={exportCSV}>⬇ Export CSV</GhostButton>
            {canEdit && !restricted && <GhostButton onClick={() => setShowImport(true)}>⬆ Import CSV</GhostButton>}
            {canEdit && !restricted && <GhostButton onClick={() => setShowUpdateCsv(true)}>✎ Update via CSV</GhostButton>}
            {canEdit && <PrimaryButton onClick={() => setShowNew(true)}>+ New Application</PrimaryButton>}
          </div>
          <button
            onClick={() => setShowRemarkMobile((s) => !s)}
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-blue-600"
          >
            {showRemarkMobile ? "Hide" : "Show"} Remark &amp; Mobile
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, mobile, draft ID, application no…"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm">🔍</span>
        </div>
        <GhostButton onClick={() => setShowFilters((s) => !s)}>
          Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </GhostButton>
        {!restricted && (
          <div className="relative">
            <GhostButton onClick={() => setShowColumnPicker((s) => !s)}>Columns</GhostButton>
            {showColumnPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColumnPicker(false)} />
                <div className="absolute right-0 mt-1 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl dark:bg-slate-900 dark:border-slate-800 shadow-lg p-2 w-56 max-h-80 overflow-y-auto">
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase">Show Columns</span>
                    <button
                      onClick={() => setVisibleCols(Object.fromEntries(TOGGLEABLE_COLUMNS.map((c) => [c.key, true])))}
                      className="text-[11px] font-semibold text-blue-600 hover:underline"
                    >
                      Reset
                    </button>
                  </div>
                  {TOGGLEABLE_COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:bg-slate-800/60 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                      <input type="checkbox" checked={visibleCols[c.key]} onChange={() => toggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {(search || activeFilterCount > 0) && (
          <button
            onClick={() => { setSearch(""); clearFilters(); }}
            className="text-xs font-semibold text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300"
          >
            Clear all
          </button>
        )}
      </div>

      {showFilters && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl dark:bg-slate-900 dark:border-slate-800 p-4 mb-4 grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          {!restricted && (
            <Select value={filterDealer} onChange={(e) => setFilterDealer(e.target.value)}>
              <option value="">All Dealers</option>
              {dealerList.map((d) => <option key={d.id} value={d.id}>{dealerLabel(d)}</option>)}
            </Select>
          )}
          <Select value={filterService} onChange={(e) => setFilterService(e.target.value)}>
            <option value="">All Services</option>
            <option value="__PCC_REQUIRED__">🔎 PCC Required (any service)</option>
            {serviceList.map((s) => <option key={s.id} value={s.id}>{serviceLabel(s)}</option>)}
          </Select>
          <Select value={filterRto} onChange={(e) => setFilterRto(e.target.value)}>
            <option value="">All RTOs</option>
            {rtoList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select value={filterAgency} onChange={(e) => setFilterAgency(e.target.value)}>
            <option value="">All Agencies</option>
            {agencyList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500 mb-1">Submitted From</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500 mb-1">Submitted To</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {!compactView && (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl dark:bg-slate-900 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-500">
            <tr>
              <SortableTh column="draftId" label="Draft ID" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              {visibleCols.applicationDate && <SortableTh column="applicationDate" label="Date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.amount && <SortableTh column="amount" label="Amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.dealer && <SortableTh column="dealer" label="Dealer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.service && <SortableTh column="service" label="Service" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.applicant && <SortableTh column="applicant" label="Applicant" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.dob && <SortableTh column="dob" label="DOB" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.rtoFee && <SortableTh column="rtoFee" label="Fee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.pccFee && <SortableTh column="pccFee" label="PCC Fee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.agencyFee && <SortableTh column="agencyFee" label="Agency Fee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.profit && <SortableTh column="profit" label="Profit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.application && <SortableTh column="application" label="Application" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.lldl && <SortableTh column="lldl" label="LL/DL No." sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.pccno && <SortableTh column="pccno" label="PCC No" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.rto && <SortableTh column="rto" label="RTO" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.agency && <SortableTh column="agency" label="Agency" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.slot && <SortableTh column="slot" label="Slot" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {showRemarkMobile && <SortableTh column="mobile" label="Mobile" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {showRemarkMobile && <SortableTh column="remark" label="Remark" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              <SortableTh column="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Appointment</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 transition-colors ${ROW_STATUS_TINT[r.status] || "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}>
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  <button
                    onClick={() =>
                      r.services?.chat_in_app
                        ? setChatApp({ id: r.id, dealer_id: r.dealer_id, label: `${r.draft_code} — ${r.applicant_name}` })
                        : setDetailPopup(r)
                    }
                    className={`inline-flex items-center gap-1.5 hover:underline font-medium ${
                      chatStatus[r.id] ? "text-rose-600 dark:text-rose-400" : "text-blue-600 dark:text-blue-400"
                    }`}
                    title={
                      r.services?.chat_in_app
                        ? chatStatus[r.id] ? "Dealer sent a message — click to reply" : "Open chat"
                        : "View full customer details and service charges"
                    }
                  >
                    {r.draft_code}
                    {chatStatus[r.id] > 0 && (
                      <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {chatStatus[r.id]}
                      </span>
                    )}
                  </button>
                </td>
                {visibleCols.applicationDate && (
                  <td className="px-3 py-2">
                    <EditableCell
                      width="w-24"
                      value={r.application_date ? isoToDDMMYYYY(r.application_date) : ""}
                      placeholder="DD-MM-YYYY"
                      onSave={(v) => updateRowField(r.id, "application_date", ddmmyyyyToISO(v) || null)}
                    />
                  </td>
                )}
                {visibleCols.amount && (
                  <td className="px-3 py-2">
                    <EditableCell type="number" width="w-14" noSpinner value={r.amount} onSave={(v) => updateApplicationAmount(r.id, v === "" ? null : parseFloat(v))} />
                  </td>
                )}
                {visibleCols.dealer && (
                  <td
                    className={`px-3 py-2 whitespace-nowrap ${dealerHold[r.dealer_id] ? "text-rose-600 font-bold" : "text-slate-600 dark:text-slate-300"}`}
                    title={dealerHold[r.dealer_id] ? "This dealer is out of usable credit" : undefined}
                  >
                    {r.status === "Draft Submitted" ? (
                      <EditableSelect
                        width="w-36"
                        value={r.dealer_id}
                        options={dealerList.map((d) => ({ id: d.id, name: dealerLabel(d) }))}
                        placeholder="Select Dealer"
                        onSave={(v) => v && updateDealerOrService(r.id, "dealer_id", v, dealerList)}
                      />
                    ) : (
                      dealerLabel(r.dealers)
                    )}
                  </td>
                )}
                {visibleCols.service && (
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {r.status === "Draft Submitted" ? (
                      <EditableSelect
                        width="w-36"
                        value={r.service_id}
                        options={serviceList.map((s) => ({ id: s.id, name: serviceLabel(s) }))}
                        placeholder="Select Service"
                        onSave={(v) => v && updateDealerOrService(r.id, "service_id", v, serviceList)}
                      />
                    ) : (
                      serviceLabel(r.services)
                    )}
                  </td>
                )}
                {visibleCols.applicant && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => openDetail(r, isAdmin ? "admin" : "customer")} className="text-blue-600 font-semibold hover:underline text-left">
                      {r.applicant_name}
                    </button>
                  </td>
                )}
                {visibleCols.dob && <td className={`px-3 py-2 whitespace-nowrap ${ageHighlightClass(r.date_of_birth) || "text-slate-500 dark:text-slate-500"}`}>{isoToDDMMYYYY(r.date_of_birth)}</td>}
                {visibleCols.rtoFee && (
                  <td className="px-3 py-2">
                    <EditableCell
                      type="number"
                      width="w-14"
                      noSpinner
                      value={r.rto_fee}
                      onSave={(v) => updateRowField(r.id, "rto_fee", v === "" ? null : parseFloat(v))}
                    />
                  </td>
                )}
                {visibleCols.pccFee && (
                  <td className="px-3 py-2">
                    <EditableCell
                      type="number"
                      width="w-20"
                      value={r.pcc_fee}
                      disabled={!r.services?.pcc_required}
                      onSave={(v) => updatePccFee(r, v)}
                    />
                  </td>
                )}
                {visibleCols.agencyFee && (
                  <td className="px-3 py-2">
                    <EditableCell
                      type="number"
                      width="w-20"
                      value={r.agency_fee}
                      disabled={!r.services?.agency_required}
                      onSave={(v) => updateAgencyFee(r, v)}
                    />
                  </td>
                )}
                {visibleCols.profit && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`font-semibold ${profitOf(r) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      ₹{profitOf(r).toLocaleString("en-IN")}
                    </span>
                  </td>
                )}
                {visibleCols.application && (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <EditableCell width="w-24" value={r.application_no} onSave={(v) => updateRowField(r.id, "application_no", v || null)} />
                      <button
                        onClick={() => openSarathi(r)}
                        title="Open on Sarathi Parivahan and copy DOB"
                        className="text-blue-600 shrink-0"
                      >
                        <LinkIcon size={14} />
                      </button>
                    </div>
                  </td>
                )}
                {visibleCols.lldl && (
                  <td className="px-3 py-2">
                    <EditableCell width="w-24" value={r.ll_dl_no} onSave={(v) => updateRowField(r.id, "ll_dl_no", v || null)} placeholder="LL/DL No." />
                  </td>
                )}
                {visibleCols.pccno && (
                  <td className="px-3 py-2">
                    {r.services?.pcc_required ? (
                      <div className="flex items-center gap-1.5">
                        <PCCNoPopup
                          pccNo={r.pcc_no}
                          pccStatus={r.pcc_status}
                          onOpenPortal={() => openPccPortal(r)}
                          onSave={(fields) => updatePccFields(r.id, fields)}
                        />
                        <PCCStageDots pccStage={r.pcc_stage} pccCertificatePath={r.pcc_certificate_path} />
                        {r.pcc_no && (
                          <button
                            type="button"
                            onClick={() => setPccCheckRow(r)}
                            title="Check live status on the Delhi Police PCC portal"
                            className="text-slate-400 dark:text-slate-500 hover:text-blue-600 text-xs shrink-0"
                          >
                            ⟳
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                )}
                {visibleCols.rto && (
                  <td className="px-3 py-2">
                    {r.services?.pcc_required ? (
                      // PCC (and anything bundling it, like LL RIC) never
                      // needs an actual RTO office — showing "PCC" here
                      // instead of leaving it blank makes it a quick visual
                      // marker: sort/scan the RTO column to see PCC rows
                      // grouped together, separate from blank = no RTO
                      // assigned yet on a service that actually needs one.
                      <span className="inline-block px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-medium">
                        PCC
                      </span>
                    ) : (
                      <EditableSelect
                        width="w-32"
                        value={r.rto_id}
                        options={rtoList}
                        placeholder="Select RTO"
                        disabled={!r.services?.rto_required}
                        onSave={(v) => updateRowField(r.id, "rto_id", v || null)}
                      />
                    )}
                  </td>
                )}
                {visibleCols.agency && (
                  <td className="px-3 py-2">
                    <EditableSelect
                      width="w-32"
                      value={r.agency_id}
                      options={agencyList}
                      placeholder="Select Agency"
                      disabled={!r.services?.agency_required}
                      onSave={(v) => updateAgencyId(r, v)}
                    />
                  </td>
                )}
                {visibleCols.slot && (
                  <td className="px-3 py-2">
                    <EditableCell
                      width="w-28"
                      value={r.slot_time}
                      disabled={!r.services?.slot_booking_required}
                      onSave={(v) => updateRowField(r.id, "slot_time", v || null)}
                      placeholder="DD-MM-YYYY"
                    />
                  </td>
                )}
                {showRemarkMobile && (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <EditableCell width="w-28" value={r.mobile} onSave={(v) => updateRowField(r.id, "mobile", v || null)} />
                      {r.mobile && (
                        <a
                          href={`tel:${r.mobile}`}
                          title={`Call ${r.mobile}`}
                          className="shrink-0 w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center hover:bg-emerald-100"
                        >
                          <Phone size={12} />
                        </a>
                      )}
                    </div>
                  </td>
                )}
                {showRemarkMobile && (
                  <td className="px-3 py-2">
                    <EditableCell width="w-36" value={r.remarks} onSave={(v) => updateRowField(r.id, "remarks", v || null)} />
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openDetail(r, "status")}
                      title="Assign staff, update status, view history"
                      className="hover:opacity-80"
                    >
                      <StatusBadge status={r.status} />
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {isEligibleForAppointment(r, convertedSourceIds) ? (
                    <button
                      onClick={() => setBookingApp({ sourceApp: r, nextService: serviceList.find((s) => s.id === r.services.next_service_id) })}
                      className="px-2 py-0.5 rounded-full text-xs font-semibold border bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30"
                    >
                      Book Appointment
                    </button>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={19} className="text-center text-slate-400 dark:text-slate-500 py-10">No applications match your search / filters</td></tr>
            )}
          </tbody>
        </table>
        </div>
        {sortedRows.length > 0 && (
          <div className="flex items-center justify-between px-1 py-3 text-sm text-slate-500 dark:text-slate-400">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs">
                Rows per page
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={pageSize}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setPageSize(Number.isFinite(n) && n > 0 ? n : 1);
                    setPage(1);
                  }}
                  className="w-16 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </label>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Prev
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {compactView && (
        <CompactApplicationsTable
          rows={pagedRows}
          onOpenDetail={(r) => setDetailPopup(r)}
          onOpenChat={(r) => setChatApp({ id: r.id, dealer_id: r.dealer_id, label: `${r.draft_code} — ${r.applicant_name}` })}
          profitOf={profitOf}
          rtoList={rtoList}
          agencyList={agencyList}
          page={page}
          totalPages={totalPages}
          setPage={setPage}
          totalCount={sortedRows.length}
          pageSize={PAGE_SIZE}
        />
      )}

      {selected && (
        <ApplicationDetailModal
          app={selected}
          mode={modalMode}
          staffList={staffList}
          restricted={restricted}
          canApprove={canApprove}
          isAdmin={isAdmin}
          onClose={closeDetail}
          onStatusChange={updateStatus}
          onDelete={deleteApplication}
          onAssign={assignStaff}
          onSaveAnswers={updateAnswers}
          onSaveApplicant={updateApplicantDetails}
          onDocsChanged={() => openDetail(selected, modalMode)}
        />
      )}

      {chatApp && (
        <ApplicationChatModal
          dealerId={chatApp.dealer_id}
          applicationId={chatApp.id}
          applicationLabel={chatApp.label}
          identity={staffIdentity}
          onClose={() => setChatApp(null)}
          onOpenDetail={() => {
            const row = rows.find((r) => r.id === chatApp.id);
            if (row) openDetail(row, "customer");
            setChatApp(null);
          }}
        />
      )}

      {detailPopup && (
        <DraftDetailPopup row={detailPopup} profitOf={profitOf} onClose={() => setDetailPopup(null)} />
      )}

      {showNew && (
        <NewApplicationModal
          dealerList={dealerList}
          serviceList={serviceList}
          onClose={() => setShowNew(false)}
          onCreate={createApplication}
        />
      )}

      {showImport && (
        <ImportApplicationsModal
          dealerList={dealerList}
          serviceList={serviceList}
          rtoList={rtoList}
          agencyList={agencyList}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
        />
      )}

      {showUpdateCsv && (
        <UpdateApplicationsModal
          dealerList={dealerList}
          serviceList={serviceList}
          rtoList={rtoList}
          agencyList={agencyList}
          onClose={() => setShowUpdateCsv(false)}
          onUpdated={() => { setShowUpdateCsv(false); load(); }}
        />
      )}

      {pccCheckRow && (
        <PCCStatusCheckModal
          row={pccCheckRow}
          onClose={() => setPccCheckRow(null)}
          onCertificateSaved={(id) =>
            setRows((rs) =>
              rs.map((r) =>
                r.id === id
                  ? { ...r, pcc_certificate_path: `pcc-certificates/${id}.pdf`, pcc_stage: "Certificate Issued", pcc_status: "Certificate Issued" }
                  : r
              )
            )
          }
        />
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
    </div>
    </CanEditContext.Provider>
  );
}

// Compact/grouped-column table (point 9) — pairs two related fields into a
// single two-line cell so the whole table fits in far less horizontal and
// vertical space. Read-only by design: editing individual fields (RTO fee,
// PCC no, etc.) needs the full table's per-cell inputs, so switch back to
// the normal view to edit — this view is for fast scanning across many
// applications at once.
function CompactApplicationsTable({ rows, onOpenDetail, onOpenChat, profitOf, rtoList, agencyList, page, totalPages, setPage, totalCount, pageSize }) {
  const fee = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
  const rtoName = (id) => rtoList.find((x) => x.id === id)?.name || "—";
  const agencyName = (id) => agencyList.find((x) => x.id === id)?.name || "—";

  const Pair = ({ top, bottom, bottomClass = "" }) => (
    <div className="leading-tight">
      <div className="text-slate-800 dark:text-slate-100">{top}</div>
      <div className={`text-xs mt-0.5 ${bottomClass || "text-slate-400 dark:text-slate-500"}`}>{bottom}</div>
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">Draft / Date</th>
              <th className="text-left font-medium px-3 py-2">Amount / Service</th>
              <th className="text-left font-medium px-3 py-2">Dealer / Customer</th>
              <th className="text-left font-medium px-3 py-2">App No / PCC No</th>
              <th className="text-left font-medium px-3 py-2">Fee / PCC Fee</th>
              <th className="text-left font-medium px-3 py-2">Agency Fee / Profit</th>
              <th className="text-left font-medium px-3 py-2">LL-DL No / DOB</th>
              <th className="text-left font-medium px-3 py-2">RTO / Agency</th>
              <th className="text-left font-medium px-3 py-2">Slot / Remark</th>
              <th className="text-left font-medium px-3 py-2">Status / Chat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 transition-colors ${ROW_STATUS_TINT[r.status] || "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}>
                <td className="px-3 py-2">
                  <button onClick={() => onOpenDetail(r)} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                    {r.draft_code}
                  </button>
                  <div className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">
                    {r.application_date ? isoToDDMMYYYY(r.application_date) : "—"}
                  </div>
                </td>
                <td className="px-3 py-2"><Pair top={fee(r.amount)} bottom={serviceLabel(r.services)} /></td>
                <td className="px-3 py-2"><Pair top={dealerLabel(r.dealers)} bottom={r.applicant_name} /></td>
                <td className="px-3 py-2"><Pair top={r.application_no || "—"} bottom={r.pcc_no || "—"} /></td>
                <td className="px-3 py-2"><Pair top={fee(r.rto_fee)} bottom={fee(r.pcc_fee)} /></td>
                <td className="px-3 py-2"><Pair top={fee(r.agency_fee)} bottom={fee(profitOf(r))} /></td>
                <td className="px-3 py-2"><Pair top={r.ll_dl_no || "—"} bottom={r.date_of_birth ? isoToDDMMYYYY(r.date_of_birth) : "—"} bottomClass={ageHighlightClass(r.date_of_birth)} /></td>
                <td className="px-3 py-2"><Pair top={rtoName(r.rto_id)} bottom={agencyName(r.agency_id)} /></td>
                <td className="px-3 py-2"><Pair top={r.slot_time || "—"} bottom={r.remarks || "—"} /></td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                  {r.services?.chat_in_app && (
                    <div className="mt-1">
                      <button onClick={() => onOpenChat(r)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        Chat
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="text-center text-slate-400 dark:text-slate-500 py-10">No applications match your search / filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800">Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Header names accepted in an import CSV, normalized (lowercase, letters/
// numbers only) -> internal field key. Several aliases per field so a
// dealer/staff-exported sheet with slightly different wording still works.
const IMPORT_HEADER_MAP = {
  draftid: "draft_code", draftcode: "draft_code",
  dealer: "dealer", dealername: "dealer",
  service: "service",
  applicant: "applicant_name", applicantname: "applicant_name",
  fatherhusband: "father_husband_name", fatherhusbandname: "father_husband_name",
  dob: "date_of_birth", dateofbirth: "date_of_birth",
  mobile: "mobile", mobileno: "mobile", phone: "mobile",
  address: "address",
  amount: "amount",
  fee: "rto_fee", rtofee: "rto_fee",
  pccfee: "pcc_fee",
  agencyfee: "agency_fee",
  applicationno: "application_no", application: "application_no",
  lldlno: "ll_dl_no",
  pccno: "pcc_no",
  pccstatus: "pcc_status",
  rto: "rto",
  agency: "agency",
  slot: "slot_time", slottime: "slot_time",
  remark: "remarks", remarks: "remarks",
  applicationdate: "application_date",
  status: "status",
};

const IMPORT_STATUS_MAP = {
  "draft submitted": "Draft Submitted",
  "under review": "Under Review",
  "on hold": "On Hold",
  rejected: "Rejected",
  accepted: "Accepted",
  approved: "Accepted", // display label round-trips back to the stored value
  completed: "Accepted", // legacy value — Completed was folded into Accepted
};

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v).replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function ImportApplicationsModal({ dealerList, serviceList, rtoList, agencyList, onClose, onImported }) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]); // { included, errors: [], payload }
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null); // { imported, skipped }
  const [error, setError] = useState("");

  const downloadTemplate = () => {
    const headers = [
      "Draft ID", "Dealer", "Service", "Applicant", "Father/Husband", "DOB", "Mobile", "Address",
      "Amount", "Fee", "PCC Fee", "Agency Fee", "Application No", "LL/DL No", "PCC No",
      "PCC Status", "RTO", "Agency", "Slot", "Remark", "Application Date", "Status",
    ];
    const example = [
      "", dealerList[0] ? dealerLabel(dealerList[0]) : "Dealer Name", serviceList[0]?.short_name || serviceList[0]?.parent_service || "Service Name",
      "Ramesh Kumar", "Suresh Kumar", "15-08-1990", "9876543210", "123 Main St",
      "1500", "500", "300", "200", "", "", "", "", "", "", "", "", "17-07-2026", "Draft Submitted",
    ];
    const escapeCsv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [headers.join(","), example.map(escapeCsv).join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "applications-import-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError("");
    setParsing(true);
    try {
      const text = await file.text();
      const rawRows = parseCSV(text);
      if (!rawRows.length) {
        setError("No data rows found in that file.");
        setPreview([]);
        setParsing(false);
        return;
      }

      const built = rawRows.map((raw) => {
        // Remap this row's headers to internal field keys.
        const row = {};
        Object.entries(raw).forEach(([h, v]) => {
          const key = IMPORT_HEADER_MAP[normalizeHeader(h)];
          if (key) row[key] = v;
        });

        const errors = [];
        const dealer = findByLabel(dealerList, row.dealer, ["name", "short_name", "code"]);
        if (row.dealer && !dealer) errors.push(`Dealer "${row.dealer}" not found`);
        if (!row.dealer) errors.push("Dealer is required");

        const service = findByLabel(serviceList, row.service, ["parent_service", "short_name"]);
        if (row.service && !service) errors.push(`Service "${row.service}" not found`);
        if (!row.service) errors.push("Service is required");

        if (!row.applicant_name) errors.push("Applicant name is required");

        const rto = row.rto && row.rto.trim().toUpperCase() !== "PCC"
          ? findByLabel(rtoList, row.rto, ["name", "code"])
          : null;
        if (row.rto && row.rto.trim().toUpperCase() !== "PCC" && !rto) errors.push(`RTO "${row.rto}" not found`);

        const agency = row.agency ? findByLabel(agencyList, row.agency, ["name", "code"]) : null;
        if (row.agency && !agency) errors.push(`Agency "${row.agency}" not found`);

        const statusRaw = (row.status || "Draft Submitted").trim().toLowerCase();
        const status = IMPORT_STATUS_MAP[statusRaw];
        if (row.status && !status) errors.push(`Status "${row.status}" not recognized`);

        const dob = row.date_of_birth ? ddmmyyyyToISO(row.date_of_birth) : null;
        const applicationDate = row.application_date ? ddmmyyyyToISO(row.application_date) : null;

        const payload = {
          draft_code: row.draft_code || null, // real sequential code assigned in runImport, per-dealer, at actual import time
          dealer_id: dealer?.id,
          service_id: service?.id,
          applicant_name: row.applicant_name,
          father_husband_name: row.father_husband_name || null,
          date_of_birth: dob,
          mobile: row.mobile || null,
          address: row.address || null,
          amount: toNumberOrNull(row.amount),
          rto_fee: toNumberOrNull(row.rto_fee),
          pcc_fee: toNumberOrNull(row.pcc_fee),
          agency_fee: toNumberOrNull(row.agency_fee),
          application_no: row.application_no || null,
          ll_dl_no: row.ll_dl_no || null,
          pcc_no: row.pcc_no || null,
          pcc_status: row.pcc_status || null,
          rto_id: rto?.id || null,
          agency_id: agency?.id || null,
          slot_time: row.slot_time || null,
          remarks: row.remarks || null,
          application_date: applicationDate,
          status: status || "Draft Submitted",
        };

        return { raw, errors, payload, dealerRaw: row.dealer || "", serviceRaw: row.service || "", rtoRaw: row.rto || "", rtoResolvedName: rto?.name || null, included: errors.length === 0 };
      });

      setPreview(built);
    } catch (err) {
      setError("Couldn't read that file: " + err.message);
    } finally {
      setParsing(false);
    }
  };

  const toggleIncluded = (i) => {
    setPreview((rows) => rows.map((r, idx) => (idx === i ? { ...r, included: !r.included } : r)));
  };

  const includedCount = preview.filter((r) => r.included).length;
  const errorCount = preview.filter((r) => r.errors.length > 0).length;

  // Batches this large go into a single insert() otherwise — and since insert()
  // is all-or-nothing, one colliding/bad row anywhere in a 10,000+ row file
  // fails the whole thing, every time it's retried. Chunking limits the blast
  // radius, and falling back to row-by-row within a failed chunk means a
  // duplicate draft_code (e.g. re-importing rows that already made it in on
  // a prior attempt) gets skipped and reported instead of blocking everything
  // else in that chunk.
  const IMPORT_CHUNK_SIZE = 300;

  const isDuplicateKeyError = (err) =>
    err?.code === "23505" || /duplicate key value/i.test(err?.message || "");

  const runImport = async () => {
    const rowsToImport = preview.filter((r) => r.included && r.errors.length === 0);
    if (!rowsToImport.length) return;
    setImporting(true);
    setError("");
    const totalSteps = rowsToImport.length * 2; // code-gen pass + insert pass, so the bar reflects real work either phase does
    setProgress({ done: 0, total: totalSteps, label: "Assigning draft codes…" });
    try {
      // Assign each row's real sequential draft code now (not during preview) so
      // cancelling after preview doesn't burn/skip numbers in a dealer's counter.
      // Rows where the CSV itself specified a draft_code keep that value as-is.
      const payloads = [];
      let codeGenDone = 0;
      for (const r of rowsToImport) {
        if (r.payload.draft_code) {
          payloads.push(r.payload);
        } else {
          const { data: generated, error: codeError } = await supabase.rpc("next_draft_code", { p_dealer_id: r.payload.dealer_id });
          if (codeError) {
            setError(`Import failed generating a draft code for "${r.payload.applicant_name}": ` + codeError.message);
            setImporting(false);
            setProgress(null);
            return;
          }
          payloads.push({ ...r.payload, draft_code: generated });
        }
        codeGenDone += 1;
        if (codeGenDone % 25 === 0 || codeGenDone === rowsToImport.length) {
          setProgress({ done: codeGenDone, total: totalSteps, label: "Assigning draft codes…" });
        }
      }

      const insertedRows = [];
      const duplicates = []; // { draft_code, applicant_name } — skipped, already existed
      const failures = []; // { draft_code, applicant_name, message } — unexpected errors

      for (let i = 0; i < payloads.length; i += IMPORT_CHUNK_SIZE) {
        const chunk = payloads.slice(i, i + IMPORT_CHUNK_SIZE);
        const { data: chunkRows, error: chunkError } = await supabase.from("applications").insert(chunk).select();

        if (!chunkError) {
          insertedRows.push(...(chunkRows || []));
        } else {
          // Whole chunk failed — fall back to one-row-at-a-time so a single
          // duplicate/bad row doesn't take the rest of the chunk down with it.
          for (const row of chunk) {
            const { data: rowData, error: rowError } = await supabase.from("applications").insert(row).select();
            if (!rowError) {
              insertedRows.push(...(rowData || []));
            } else if (isDuplicateKeyError(rowError)) {
              duplicates.push({ draft_code: row.draft_code, applicant_name: row.applicant_name });
            } else {
              failures.push({ draft_code: row.draft_code, applicant_name: row.applicant_name, message: rowError.message });
            }
          }
        }

        const insertDone = Math.min(i + IMPORT_CHUNK_SIZE, payloads.length);
        setProgress({
          done: rowsToImport.length + insertDone,
          total: totalSteps,
          label: `Importing rows ${insertDone.toLocaleString("en-IN")} of ${payloads.length.toLocaleString("en-IN")}…`,
        });
      }

      // Rows imported directly as Accepted skip the normal "Approve" action
      // (and its ledger debit) entirely, so post the matching ledger entry
      // here — same shape as approveApplication — for any imported row
      // that's already at that stage. Backdated to the row's own
      // Application Date (when the CSV provided one) rather than defaulting
      // to "now" — otherwise every imported row shows up on the ledger as
      // if it happened at import time, and the description now also
      // includes the service so it's identifiable without opening the row.
      const preApproved = insertedRows.filter((r) => r.status === "Accepted");
      if (preApproved.length) {
        const ledgerRows = preApproved.map((r) => {
          const service = serviceList.find((s) => s.id === r.service_id);
          return {
            dealer_id: r.dealer_id,
            type: "debit",
            amount: r.amount || 0,
            voucher_no: r.draft_code,
            description: `${r.applicant_name || ""}${service ? ` · Service: ${serviceLabel(service)}` : ""}${r.application_no ? ` · App No: ${r.application_no}` : ""}`,
            ...(r.application_date ? { created_at: r.application_date } : {}),
          };
        });
        const { error: ledgerError } = await supabase.from("ledger_transactions").insert(ledgerRows);
        if (ledgerError) {
          setError(`Applications imported, but ${preApproved.length} ledger entr${preApproved.length !== 1 ? "ies" : "y"} failed to post: ` + ledgerError.message);
          setImporting(false);
          setProgress(null);
          return;
        }
      }

      // Agency Fee posts a debit to the Agency's ledger — same as editing it
      // in the table — for any imported row that has both an Agency Fee and
      // an Agency, regardless of status. Rows with an Agency Fee but no
      // Agency just mean that fee was paid directly, nothing to post.
      // Backdated to Application Date for the same reason as above.
      const feeWithAgency = insertedRows.filter((r) => r.agency_fee && r.agency_id);
      if (feeWithAgency.length) {
        const agencyLedgerRows = feeWithAgency.map((r) => {
          const service = serviceList.find((s) => s.id === r.service_id);
          return {
            agency_id: r.agency_id,
            type: "debit",
            amount: r.agency_fee,
            voucher_no: `${r.draft_code}-AGENCYFEE`,
            description: `Agency Fee${service ? ` · Service: ${serviceLabel(service)}` : ""} · ${r.applicant_name || ""}${r.application_no ? ` · App No: ${r.application_no}` : ""}`,
            ...(r.application_date ? { created_at: r.application_date } : {}),
          };
        });
        const { error: agencyLedgerError } = await supabase.from("agency_ledger_transactions").insert(agencyLedgerRows);
        if (agencyLedgerError) {
          setError(`Applications imported, but ${feeWithAgency.length} agency ledger entr${feeWithAgency.length !== 1 ? "ies" : "y"} failed to post: ` + agencyLedgerError.message);
          setImporting(false);
          setProgress(null);
          return;
        }
      }

      setResult({
        imported: insertedRows.length,
        skipped: preview.length - rowsToImport.length,
        duplicates,
        failures,
      });
      setImporting(false);
      setProgress(null);
      onImported();
    } catch (err) {
      setError("Import failed: " + err.message);
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <Modal title="Import Application Records" onClose={onClose} wide>
      <p className="text-sm text-slate-500 dark:text-slate-500 mb-3">
        Upload a CSV of existing application records. Dealer, Service, RTO, and Agency are matched by name — make sure
        they match what's set up in Masters. Not sure of the format?{" "}
        <button onClick={downloadTemplate} className="text-blue-600 font-semibold hover:underline">Download a template</button>.
      </p>

      <div className="flex items-center gap-3 mb-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 file:font-semibold file:text-sm"
        />
        {fileName && <span className="text-xs text-slate-400 dark:text-slate-500">{fileName}</span>}
      </div>

      {parsing && <p className="text-sm text-slate-400 dark:text-slate-500">Reading file…</p>}
      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

      {preview.length > 0 && !result && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {preview.length} row{preview.length !== 1 ? "s" : ""} found — {includedCount} ready to import
              {errorCount > 0 && `, ${errorCount} with errors (excluded automatically, shown below)`}.
            </p>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-auto max-h-80 mb-4">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Import?</th>
                  <th className="px-3 py-2 text-left">Draft ID</th>
                  <th className="px-3 py-2 text-left">Dealer</th>
                  <th className="px-3 py-2 text-left">Service</th>
                  <th className="px-3 py-2 text-left">Applicant</th>
                  <th className="px-3 py-2 text-left">RTO</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {preview.map((r, i) => (
                  <tr key={i} className={r.errors.length ? "bg-rose-50/50 dark:bg-rose-500/5" : ""}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.included}
                        disabled={r.errors.length > 0}
                        onChange={() => toggleIncluded(i)}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.payload.draft_code || <span className="text-slate-400 dark:text-slate-500 italic">auto</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.dealerRaw || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.serviceRaw || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.payload.applicant_name || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.rtoRaw
                        ? (r.rtoResolvedName && r.rtoResolvedName.trim().toLowerCase() !== r.rtoRaw.trim().toLowerCase()
                            ? <span title={`Typed "${r.rtoRaw}"`} className="text-amber-600 font-semibold">{r.rtoResolvedName}</span>
                            : (r.rtoResolvedName || <span className="text-rose-500">{r.rtoRaw}</span>))
                        : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.payload.status}</td>
                    <td className="px-3 py-2 text-rose-600">{r.errors.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PrimaryButton disabled={importing || includedCount === 0} onClick={runImport}>
            {importing ? "Importing…" : `Import ${includedCount} Row${includedCount !== 1 ? "s" : ""}`}
          </PrimaryButton>

          {importing && progress && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>{progress.label}</span>
                <span>{Math.min(100, Math.round((progress.done / progress.total) * 100))}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                A file this size can take a few minutes — this stays open until every row's been processed.
              </p>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 px-3 py-2">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            ✓ Imported {result.imported} record{result.imported !== 1 ? "s" : ""}
            {result.skipped > 0 && ` (${result.skipped} skipped due to errors)`}.
          </p>

          {result.duplicates?.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                ⚠ {result.duplicates.length} row{result.duplicates.length !== 1 ? "s" : ""} skipped — draft code already existed:
              </p>
              <div className="mt-1 max-h-32 overflow-auto rounded-lg border border-amber-200 dark:border-amber-500/30 text-xs">
                <table className="w-full">
                  <tbody className="divide-y divide-amber-100 dark:divide-amber-500/10">
                    {result.duplicates.map((d, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 whitespace-nowrap font-mono">{d.draft_code}</td>
                        <td className="px-2 py-1">{d.applicant_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.failures?.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">
                ✕ {result.failures.length} row{result.failures.length !== 1 ? "s" : ""} failed with an unexpected error:
              </p>
              <div className="mt-1 max-h-32 overflow-auto rounded-lg border border-rose-200 dark:border-rose-500/30 text-xs">
                <table className="w-full">
                  <tbody className="divide-y divide-rose-100 dark:divide-rose-500/10">
                    {result.failures.map((f, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 whitespace-nowrap font-mono">{f.draft_code || "auto"}</td>
                        <td className="px-2 py-1">{f.applicant_name}</td>
                        <td className="px-2 py-1 text-rose-600 dark:text-rose-400">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <GhostButton className="mt-3" onClick={onClose}>Close</GhostButton>
        </div>
      )}
    </Modal>
  );
}

// Fields an Update-via-CSV file is allowed to change. `key` is the internal
// name resolved from IMPORT_HEADER_MAP (so it reads the exact same headers
// Export CSV writes and Import CSV accepts). `column` is the applications
// table column it writes to. Dealer/Draft ID aren't here — they're the
// match key, not something this flow edits.
const UPDATE_FIELD_DEFS = [
  { key: "applicant_name", label: "Applicant", column: "applicant_name", type: "text" },
  { key: "father_husband_name", label: "Father/Husband", column: "father_husband_name", type: "text" },
  { key: "date_of_birth", label: "DOB", column: "date_of_birth", type: "date" },
  { key: "mobile", label: "Mobile", column: "mobile", type: "text" },
  { key: "address", label: "Address", column: "address", type: "text" },
  { key: "amount", label: "Amount", column: "amount", type: "number" },
  { key: "rto_fee", label: "Fee", column: "rto_fee", type: "number" },
  { key: "pcc_fee", label: "PCC Fee", column: "pcc_fee", type: "number" },
  { key: "agency_fee", label: "Agency Fee", column: "agency_fee", type: "number" },
  { key: "application_no", label: "Application No", column: "application_no", type: "text" },
  { key: "ll_dl_no", label: "LL/DL No", column: "ll_dl_no", type: "text" },
  { key: "pcc_no", label: "PCC No", column: "pcc_no", type: "text" },
  { key: "pcc_status", label: "PCC Status", column: "pcc_status", type: "text" },
  { key: "rto", label: "RTO", column: "rto_id", type: "rto" },
  { key: "agency", label: "Agency", column: "agency_id", type: "agency" },
  { key: "slot_time", label: "Slot", column: "slot_time", type: "text" },
  { key: "remarks", label: "Remark", column: "remarks", type: "text" },
  { key: "application_date", label: "Application Date", column: "application_date", type: "date" },
  { key: "status", label: "Status", column: "status", type: "status" },
  { key: "service", label: "Service", column: "service_id", type: "service" },
];

function formatOldDisplay(def, oldValue, serviceList, rtoList, agencyList) {
  switch (def.type) {
    case "number": return oldValue === null || oldValue === undefined ? "—" : `₹${Number(oldValue).toLocaleString("en-IN")}`;
    case "date": return oldValue ? isoToDDMMYYYY(oldValue) : "—";
    case "rto": return oldValue ? (rtoList.find((x) => x.id === oldValue)?.name || "—") : "—";
    case "agency": return oldValue ? (agencyList.find((x) => x.id === oldValue)?.name || "—") : "—";
    case "service": return oldValue ? serviceLabel(serviceList.find((s) => s.id === oldValue)) || "—" : "—";
    default: return oldValue || "—";
  }
}

// Compares a parsed CSV row against the application row it matched to in
// the DB, field by field — but ONLY for fields whose header actually
// appears in the uploaded file (presentKeys). A column left out of the
// sheet entirely is never touched; a column that's present but left blank
// clears that field (except Status/Service, where a blank cell means
// "leave as-is" since those are required fields the app itself never lets
// you clear).
function diffFields(row, presentKeys, target, serviceList, rtoList, agencyList) {
  const changes = [];
  const fieldErrors = [];
  for (const def of UPDATE_FIELD_DEFS) {
    if (!presentKeys.has(def.key)) continue;
    const raw = row[def.key];
    let newValue;
    let newDisplay;
    let err = null;

    if (def.type === "text") {
      newValue = raw ? raw.trim() : null;
      newDisplay = newValue || "—";
    } else if (def.type === "number") {
      newValue = toNumberOrNull(raw);
      newDisplay = newValue === null ? "—" : `₹${Number(newValue).toLocaleString("en-IN")}`;
    } else if (def.type === "date") {
      newValue = raw ? ddmmyyyyToISO(raw) : null;
      newDisplay = newValue ? isoToDDMMYYYY(newValue) : "—";
    } else if (def.type === "status") {
      const key = (raw || "").trim().toLowerCase();
      if (!key) continue; // blank status cell — leave status as-is
      const mapped = IMPORT_STATUS_MAP[key];
      if (!mapped) { err = `Status "${raw}" not recognized`; }
      else { newValue = mapped; newDisplay = mapped; }
    } else if (def.type === "service") {
      const trimmed = (raw || "").trim();
      if (!trimmed) continue; // blank — leave service as-is, it's required
      const service = findByLabel(serviceList, trimmed, ["parent_service", "short_name"]);
      if (!service) { err = `Service "${raw}" not found`; }
      else { newValue = service.id; newDisplay = serviceLabel(service); }
    } else if (def.type === "rto") {
      const trimmed = (raw || "").trim();
      if (!trimmed) { newValue = null; newDisplay = "—"; }
      else if (trimmed.toUpperCase() === "PCC") { newValue = null; newDisplay = "PCC"; }
      else {
        const rto = findByLabel(rtoList, trimmed, ["name", "code"]);
        if (!rto) { err = `RTO "${raw}" not found`; }
        else { newValue = rto.id; newDisplay = rto.name; }
      }
    } else if (def.type === "agency") {
      const trimmed = (raw || "").trim();
      if (!trimmed) { newValue = null; newDisplay = "—"; }
      else {
        const agency = findByLabel(agencyList, trimmed, ["name", "code"]);
        if (!agency) { err = `Agency "${raw}" not found`; }
        else { newValue = agency.id; newDisplay = agency.name; }
      }
    }

    if (err) { fieldErrors.push(`${def.label}: ${err}`); continue; }

    const oldValue = target[def.column];
    const same = def.type === "number"
      ? Number(oldValue ?? 0) === Number(newValue ?? 0)
      : (oldValue ?? null) === (newValue ?? null);
    if (same) continue;

    changes.push({
      key: def.key,
      column: def.column,
      label: def.label,
      oldDisplay: formatOldDisplay(def, oldValue, serviceList, rtoList, agencyList),
      newDisplay,
      newValue,
      // Flagged so the preview can warn that this particular change won't
      // itself move any money already posted to the dealer ledger — same
      // as editing Amount by hand on an Accepted row today.
      warnLedger: def.key === "amount" && target.status === "Accepted",
    });
  }
  return { changes, fieldErrors };
}

// Update-via-CSV: the round-trip counterpart to Export CSV. Upload a
// previously-exported (or same-shaped) sheet with edited values — this
// matches each row back to its application by Draft ID (+ Dealer, since
// Draft IDs are only unique per-dealer) and updates ONLY the columns that
// are both present in the file and actually different from what's stored.
// Status→Accepted and Agency Fee/Agency changes reuse the exact same
// ledger-posting logic as the single-row Approve button and inline Agency
// Fee edit, so ledgers can't drift between the two entry points.
function UpdateApplicationsModal({ dealerList, serviceList, rtoList, agencyList, onClose, onUpdated }) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null); // { updated, failures }
  const [error, setError] = useState("");

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError("");
    setParsing(true);
    try {
      const text = await file.text();
      const rawRows = parseCSV(text);
      if (!rawRows.length) {
        setError("No data rows found in that file.");
        setPreview([]);
        setParsing(false);
        return;
      }

      const presentKeys = new Set();
      Object.keys(rawRows[0]).forEach((h) => {
        const key = IMPORT_HEADER_MAP[normalizeHeader(h)];
        if (key) presentKeys.add(key);
      });

      if (!presentKeys.has("draft_code")) {
        setError('This file has no "Draft ID" column — Update needs it to know which record each row belongs to. Use Export CSV, edit that file, then upload it here.');
        setPreview([]);
        setParsing(false);
        return;
      }

      const parsedRows = rawRows.map((raw) => {
        const row = {};
        Object.entries(raw).forEach(([h, v]) => {
          const key = IMPORT_HEADER_MAP[normalizeHeader(h)];
          if (key) row[key] = v;
        });
        const dealer = row.dealer ? findByLabel(dealerList, row.dealer, ["name", "short_name", "code"]) : null;
        return { raw, row, dealer, draftCode: (row.draft_code || "").trim() };
      });

      const draftCodes = [...new Set(parsedRows.map((r) => r.draftCode).filter(Boolean))];
      const { data: existing, error: fetchError } = await supabase
        .from("applications")
        .select("*")
        .in("draft_code", draftCodes);
      if (fetchError) {
        setError("Couldn't look up existing records: " + fetchError.message);
        setPreview([]);
        setParsing(false);
        return;
      }

      const built = parsedRows.map(({ row, dealer, draftCode }) => {
        const applicantRaw = row.applicant_name || "";
        const dealerRaw = row.dealer || "";
        if (!draftCode) {
          return { draftCode: "", dealerRaw, applicantRaw, changes: [], fieldErrors: [], notFound: "Missing Draft ID", included: false };
        }
        const candidates = (existing || []).filter((a) => a.draft_code === draftCode);
        const target = dealer
          ? candidates.find((a) => a.dealer_id === dealer.id) || null
          : (candidates.length === 1 ? candidates[0] : null);

        if (!target) {
          const notFound = candidates.length > 1
            ? "Multiple applications share this Draft ID across dealers — add a Dealer column to disambiguate"
            : "No application found with this Draft ID";
          return { draftCode, dealerRaw, applicantRaw, changes: [], fieldErrors: [], notFound, included: false };
        }

        const { changes, fieldErrors } = diffFields(row, presentKeys, target, serviceList, rtoList, agencyList);
        return {
          draftCode,
          dealerRaw: dealerRaw || dealerList.find((d) => d.id === target.dealer_id)?.name || "",
          applicantRaw: applicantRaw || target.applicant_name || "",
          target,
          changes,
          fieldErrors,
          notFound: null,
          included: changes.length > 0,
        };
      });

      setPreview(built);
    } catch (err) {
      setError("Couldn't read that file: " + err.message);
    } finally {
      setParsing(false);
    }
  };

  const toggleIncluded = (i) => {
    setPreview((rows) => rows.map((r, idx) => (idx === i && r.changes.length > 0 ? { ...r, included: !r.included } : r)));
  };

  const includedCount = preview.filter((r) => r.included).length;
  const noChangeCount = preview.filter((r) => !r.notFound && r.changes.length === 0 && r.fieldErrors.length === 0).length;
  const problemCount = preview.filter((r) => r.notFound || r.fieldErrors.length > 0).length;

  const runUpdate = async () => {
    const rowsToUpdate = preview.filter((r) => r.included);
    if (!rowsToUpdate.length) return;
    setUpdating(true);
    setError("");
    setProgress({ done: 0, total: rowsToUpdate.length });

    let updated = 0;
    const failures = [];

    for (const r of rowsToUpdate) {
      const fields = {};
      r.changes.forEach((c) => { fields[c.column] = c.newValue; });

      const statusChange = r.changes.find((c) => c.key === "status");
      const becomingAccepted = statusChange && statusChange.newValue === "Accepted" && r.target.status !== "Accepted";

      try {
        if (becomingAccepted) {
          // Same shape as the table's Approve button / CSV Import's
          // pre-approved path: flip status, backfill application_date /
          // completed_at if not already set, and post the dealer ledger debit.
          const applicationDate = fields.application_date || r.target.application_date || new Date().toISOString().slice(0, 10);
          fields.application_date = applicationDate;
          if (!r.target.completed_at) fields.completed_at = new Date().toISOString();

          const { error: updErr } = await supabase.from("applications").update(fields).eq("id", r.target.id);
          if (updErr) throw updErr;

          const finalAmount = fields.amount !== undefined ? fields.amount : r.target.amount;
          const finalServiceId = fields.service_id !== undefined ? fields.service_id : r.target.service_id;
          const finalApplicantName = fields.applicant_name !== undefined ? fields.applicant_name : r.target.applicant_name;
          const finalApplicationNo = fields.application_no !== undefined ? fields.application_no : r.target.application_no;
          const service = serviceList.find((s) => s.id === finalServiceId);
          const descriptionParts = [
            [serviceLabel(service), finalApplicantName].filter(Boolean).join(" ") || null,
            finalApplicationNo ? `App No: ${finalApplicationNo}` : null,
          ].filter(Boolean);

          const { error: ledgerError } = await supabase.from("ledger_transactions").insert({
            dealer_id: r.target.dealer_id,
            type: "debit",
            amount: finalAmount || 0,
            voucher_no: r.target.draft_code,
            description: descriptionParts.join(" · "),
            created_at: applicationDate,
          });
          if (ledgerError) throw new Error("Status updated, but dealer ledger entry failed: " + ledgerError.message);
        } else {
          const { error: updErr } = await supabase.from("applications").update(fields).eq("id", r.target.id);
          if (updErr) throw updErr;

          // Row was already Accepted before this import (not becoming
          // Accepted just now, that path above already posts the ledger
          // row fresh). If Amount changed, the existing ledger debit needs
          // to move with it — same sync as the inline table edit uses.
          if (fields.amount !== undefined && r.target.status === "Accepted") {
            const { error: syncErr } = await supabase.rpc("update_application_amount", {
              p_application_id: r.target.id,
              p_new_amount: fields.amount || 0,
            });
            if (syncErr) throw new Error("Saved, but ledger sync failed: " + syncErr.message);
          }
        }

        // Keep the agency ledger in sync — same delete-then-insert pattern
        // as the inline Agency Fee / Agency edits in the table.
        const feeOrAgencyChanged = r.changes.some((c) => c.key === "agency_fee" || c.key === "agency");
        if (feeOrAgencyChanged) {
          const finalFee = fields.agency_fee !== undefined ? fields.agency_fee : r.target.agency_fee;
          const finalAgencyId = fields.agency_id !== undefined ? fields.agency_id : r.target.agency_id;
          const voucherNo = `${r.target.draft_code}-AGENCYFEE`;
          const { error: delErr } = await supabase.from("agency_ledger_transactions").delete().eq("voucher_no", voucherNo);
          if (delErr) throw delErr;
          if (finalFee && finalAgencyId) {
            const finalServiceId = fields.service_id !== undefined ? fields.service_id : r.target.service_id;
            const finalApplicantName = fields.applicant_name !== undefined ? fields.applicant_name : r.target.applicant_name;
            const finalApplicationNo = fields.application_no !== undefined ? fields.application_no : r.target.application_no;
            const service = serviceList.find((s) => s.id === finalServiceId);
            const descriptionParts = [
              "Agency Fee",
              [serviceLabel(service), finalApplicantName].filter(Boolean).join(" ") || null,
              finalApplicationNo ? `App No: ${finalApplicationNo}` : null,
            ].filter(Boolean);
            const { error: agencyErr } = await supabase.from("agency_ledger_transactions").insert({
              agency_id: finalAgencyId,
              voucher_no: voucherNo,
              type: "debit",
              amount: finalFee,
              description: descriptionParts.join(" · "),
            });
            if (agencyErr) throw new Error("Saved, but agency ledger sync failed: " + agencyErr.message);
          }
        }

        updated += 1;
      } catch (err) {
        failures.push({ draft_code: r.draftCode, applicant_name: r.target?.applicant_name || r.applicantRaw, message: err.message });
      }

      setProgress((p) => ({ done: (p?.done || 0) + 1, total: p?.total || rowsToUpdate.length }));
    }

    setResult({ updated, failures });
    setUpdating(false);
    setProgress(null);
    if (updated > 0) onUpdated();
  };

  return (
    <Modal title="Update Applications via CSV" onClose={onClose} wide>
      <p className="text-sm text-slate-500 dark:text-slate-500 mb-3">
        Upload a CSV exported from this page (or shaped like it) with edited values. Rows are matched to existing
        records by <strong>Draft ID</strong> (plus Dealer, since Draft IDs repeat across dealers) — only columns
        present in the file, and only cells that actually differ from what's saved, get updated. Nothing is inserted;
        rows with no matching Draft ID are skipped.
      </p>

      <div className="flex items-center gap-3 mb-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 file:font-semibold file:text-sm"
        />
        {fileName && <span className="text-xs text-slate-400 dark:text-slate-500">{fileName}</span>}
      </div>

      {parsing && <p className="text-sm text-slate-400 dark:text-slate-500">Reading file…</p>}
      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

      {preview.length > 0 && !result && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {preview.length} row{preview.length !== 1 ? "s" : ""} found — {includedCount} with changes to update
              {noChangeCount > 0 && `, ${noChangeCount} unchanged`}
              {problemCount > 0 && `, ${problemCount} with issues`}.
            </p>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-auto max-h-96 mb-4">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Update?</th>
                  <th className="px-3 py-2 text-left">Draft ID</th>
                  <th className="px-3 py-2 text-left">Dealer</th>
                  <th className="px-3 py-2 text-left">Applicant</th>
                  <th className="px-3 py-2 text-left">Changes</th>
                  <th className="px-3 py-2 text-left">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {preview.map((r, i) => (
                  <tr key={i} className={r.notFound || r.fieldErrors.length ? "bg-rose-50/50 dark:bg-rose-500/5" : !r.changes.length ? "opacity-50" : ""}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.included}
                        disabled={r.changes.length === 0}
                        onChange={() => toggleIncluded(i)}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{r.draftCode || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.dealerRaw || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.applicantRaw || "—"}</td>
                    <td className="px-3 py-2">
                      {r.changes.length > 0 ? (
                        <ul className="space-y-0.5">
                          {r.changes.map((c, ci) => (
                            <li key={ci}>
                              <span className="font-semibold">{c.label}:</span> {c.oldDisplay} → <span className="text-blue-600 dark:text-blue-400 font-semibold">{c.newDisplay}</span>
                              {c.warnLedger && <span className="text-amber-600 dark:text-amber-400"> (won't move the already-posted dealer ledger entry)</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 italic">no changes</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-rose-600">
                      {r.notFound || r.fieldErrors.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PrimaryButton disabled={updating || includedCount === 0} onClick={runUpdate}>
            {updating ? "Updating…" : `Update ${includedCount} Row${includedCount !== 1 ? "s" : ""}`}
          </PrimaryButton>

          {updating && progress && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>Updating {progress.done} of {progress.total}…</span>
                <span>{Math.min(100, Math.round((progress.done / progress.total) * 100))}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 px-3 py-2">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            ✓ Updated {result.updated} record{result.updated !== 1 ? "s" : ""}.
          </p>

          {result.failures?.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">
                ✕ {result.failures.length} row{result.failures.length !== 1 ? "s" : ""} failed:
              </p>
              <div className="mt-1 max-h-32 overflow-auto rounded-lg border border-rose-200 dark:border-rose-500/30 text-xs">
                <table className="w-full">
                  <tbody className="divide-y divide-rose-100 dark:divide-rose-500/10">
                    {result.failures.map((f, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 whitespace-nowrap font-mono">{f.draft_code}</td>
                        <td className="px-2 py-1">{f.applicant_name}</td>
                        <td className="px-2 py-1 text-rose-600 dark:text-rose-400">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <GhostButton className="mt-3" onClick={onClose}>Close</GhostButton>
        </div>
      )}
    </Modal>
  );
}

// Quick-view popup opened by clicking a Draft ID — full customer details +
// service charges breakdown, without needing to open the bigger status/
// assignment modal. Admin panel only, for now (point 13).
function DraftDetailPopup({ row, profitOf, onClose }) {
  const fee = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
  return (
    <Modal title={`${row.draft_code} — Details`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">Customer</p>
          <div className="grid grid-cols-2 gap-y-1.5 text-sm">
            <span className="text-slate-400 dark:text-slate-500">Name</span>
            <span className="text-slate-800 dark:text-slate-100 font-medium">{row.applicant_name || "—"}</span>
            <span className="text-slate-400 dark:text-slate-500">Father/Husband</span>
            <span className="text-slate-700 dark:text-slate-200">{row.father_husband_name || "—"}</span>
            <span className="text-slate-400 dark:text-slate-500">DOB</span>
            <span className={row.date_of_birth ? ageHighlightClass(row.date_of_birth) || "text-slate-700 dark:text-slate-200" : "text-slate-700 dark:text-slate-200"}>{row.date_of_birth ? isoToDDMMYYYY(row.date_of_birth) : "—"}</span>
            <span className="text-slate-400 dark:text-slate-500">Mobile</span>
            <span className="text-slate-700 dark:text-slate-200">{row.mobile || "—"}</span>
            <span className="text-slate-400 dark:text-slate-500">Address</span>
            <span className="text-slate-700 dark:text-slate-200">{row.address || "—"}</span>
            <span className="text-slate-400 dark:text-slate-500">Dealer</span>
            <span className="text-slate-700 dark:text-slate-200">{dealerLabel(row.dealers)}</span>
            <span className="text-slate-400 dark:text-slate-500">Service</span>
            <span className="text-slate-700 dark:text-slate-200">{serviceLabel(row.services)}</span>
            <span className="text-slate-400 dark:text-slate-500">Status</span>
            <span className="text-slate-700 dark:text-slate-200">{row.status}</span>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">Service Charges</p>
          <div className="grid grid-cols-2 gap-y-1.5 text-sm">
            <span className="text-slate-400 dark:text-slate-500">Amount (charged)</span>
            <span className="text-slate-800 dark:text-slate-100 font-medium">{fee(row.amount)}</span>
            <span className="text-slate-400 dark:text-slate-500">Fee</span>
            <span className="text-slate-700 dark:text-slate-200">{fee(row.rto_fee)}</span>
            <span className="text-slate-400 dark:text-slate-500">PCC Fee</span>
            <span className="text-slate-700 dark:text-slate-200">{fee(row.pcc_fee)}</span>
            <span className="text-slate-400 dark:text-slate-500">Agency Fee</span>
            <span className="text-slate-700 dark:text-slate-200">{fee(row.agency_fee)}</span>
            <span className="text-slate-500 dark:text-slate-400 font-semibold border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">Profit</span>
            <span className="text-emerald-600 font-bold border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">{fee(profitOf(row))}</span>
          </div>
        </div>

        {row.remarks && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-1">Remark</p>
            <p className="text-sm text-slate-700 dark:text-slate-200">{row.remarks}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewApplicationModal({ dealerList, serviceList, onClose, onCreate }) {
  const [form, setForm] = useState({
    dealer_id: "", service_id: "", applicant_name: "", father_husband_name: "",
    date_of_birth: "", mobile: "", address: "", police_station: "", stay_since: "", status: "Draft Submitted",
  });
  const selectedService = serviceList.find((s) => s.id === form.service_id);
  const [answers, setAnswers] = useState([
    { key: "Application No", value: "" },
    { key: "Learner No", value: "" },
    { key: "PCC No", value: "" },
  ]);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const valid = form.dealer_id && form.service_id && form.applicant_name;
  const [ageError, setAgeError] = useState("");

  const setAnswerKey = (i) => (e) => setAnswers((a) => a.map((row, idx) => idx === i ? { ...row, key: e.target.value } : row));
  const setAnswerValue = (i) => (e) => setAnswers((a) => a.map((row, idx) => idx === i ? { ...row, value: e.target.value } : row));
  const removeAnswer = (i) => setAnswers((a) => a.filter((_, idx) => idx !== i));
  const addAnswer = () => setAnswers((a) => [...a, { key: "", value: "" }]);

  const handleCreate = () => {
    const dobIso = ddmmyyyyToISO(form.date_of_birth);
    const err = validateAgeForService(dobIso, selectedService);
    if (err) { setAgeError(err); return; }
    setAgeError("");
    const service_answers = {};
    answers.forEach(({ key, value }) => {
      if (key.trim() && value.trim()) service_answers[key.trim()] = value.trim();
    });
    onCreate({ ...form, date_of_birth: dobIso, stay_since: ddmmyyyyToISO(form.stay_since), service_answers });
  };

  return (
    <Modal title="Create New Application" onClose={onClose}>
      <p className="text-xs text-slate-500 dark:text-slate-500 mb-4">
        Use this for walk-in customers or phone orders that didn't come through the dealer app.
        If you don't have a dealer to attribute this to, create a "Walk-in / Office Counter" dealer
        once in Masters → Dealer, then pick it here.
      </p>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Dealer" required>
          <Select value={form.dealer_id} onChange={set("dealer_id")}>
            <option value="">Select Dealer</option>
            {dealerList.map((d) => <option key={d.id} value={d.id}>{dealerLabel(d)}</option>)}
          </Select>
        </Field>
        <Field label="Service" required>
          <SearchableSelect
            value={form.service_id}
            options={serviceList.map((s) => ({ id: s.id, name: serviceLabel(s) }))}
            onChange={(id) => setForm((s) => ({ ...s, service_id: id }))}
            placeholder="Search or select a service…"
          />
        </Field>
      </div>
      <Field label="Applicant Name" required>
        <Input value={form.applicant_name} onChange={set("applicant_name")} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Father / Husband Name">
          <Input value={form.father_husband_name} onChange={set("father_husband_name")} />
        </Field>
        <Field label="Date of Birth">
          <Input type="text" placeholder="DD-MM-YYYY" value={form.date_of_birth} onChange={set("date_of_birth")}
            className={ageHighlightClass(ddmmyyyyToISO(form.date_of_birth)) ? "border-amber-400" : ""} />
        </Field>
        <Field label="Mobile">
          <Input value={form.mobile} onChange={set("mobile")} />
        </Field>
        <Field label="Starting Status">
          <Select value={form.status} onChange={set("status")}>
            <option value="Draft Submitted">Draft</option>
            <option>Under Review</option>
            <option value="Accepted">Approved</option>
          </Select>
        </Field>
      </div>

      <Field label="Address">
        <Input value={form.address} onChange={set("address")} />
      </Field>

      {selectedService?.pcc_required && (
        <div className="grid sm:grid-cols-2 gap-x-4 -mt-1 mb-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30">
          <p className="sm:col-span-2 text-xs text-blue-700 dark:text-blue-300 mb-1">
            This service requires a PCC — fill these in now and they'll auto-fill the PCC request letter later.
          </p>
          <Field label="Police Station">
            <SearchableSelect
              value={form.police_station}
              options={DELHI_POLICE_STATIONS.map((name) => ({ id: name, name }))}
              onChange={(name) => setForm((s) => ({ ...s, police_station: name }))}
              placeholder="Search police station…"
            />
          </Field>
          <Field label="Staying at Address Since"><Input type="text" placeholder="DD-MM-YYYY" value={form.stay_since} onChange={set("stay_since")} /></Field>
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Additional Details <span className="text-slate-400 dark:text-slate-500 font-normal">(Learner No, PCC No, Application No, etc.)</span>
        </label>
        {answers.map((row, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <Input placeholder="Field name" value={row.key} onChange={setAnswerKey(i)} className="w-2/5" />
            <Input placeholder="Value" value={row.value} onChange={setAnswerValue(i)} />
            <button onClick={() => removeAnswer(i)} className="text-rose-500 text-xs font-semibold px-2 shrink-0">Remove</button>
          </div>
        ))}
        <GhostButton onClick={addAnswer}>+ Add Field</GhostButton>
      </div>

      <PrimaryButton disabled={!valid} onClick={handleCreate}>Create Application</PrimaryButton>
      {ageError && <p className="text-rose-500 text-xs mt-2">{ageError}</p>}
    </Modal>
  );
}

function ApplicationDetailModal({ app, mode = "customer", staffList, restricted = false, canApprove = true, isAdmin = false, onClose, onStatusChange, onDelete, onAssign, onSaveAnswers, onSaveApplicant, onDocsChanged }) {
  const [remarks, setRemarks] = useState(app.remarks || "");
  const [staffId, setStaffId] = useState(app.assigned_staff_id || "");
  const [staffIdentity, setStaffIdentity] = useState(null);
  const [pccCheckApp, setPccCheckApp] = useState(null);
  const [showPccLetter, setShowPccLetter] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { data: staffRow } = await supabase.from("staff").select("id, full_name").eq("auth_user_id", userData?.user?.id).maybeSingle();
      if (staffRow) setStaffIdentity(identityFor({ staff: staffRow }));
    })();
  }, []);
  const [applicant, setApplicant] = useState({
    applicant_name: app.applicant_name || "",
    father_husband_name: app.father_husband_name || "",
    date_of_birth: isoToDDMMYYYY(app.date_of_birth),
    mobile: app.mobile || "",
    address: app.address || "",
    police_station: app.police_station || "",
    stay_since: isoToDDMMYYYY(app.stay_since),
  });
  const [savingApplicant, setSavingApplicant] = useState(false);
  const [applicantAgeError, setApplicantAgeError] = useState("");
  const setApplicantField = (k) => (e) => setApplicant((s) => ({ ...s, [k]: e.target.value }));

  const saveApplicant = async () => {
    const dobIso = ddmmyyyyToISO(applicant.date_of_birth);
    const err = validateAgeForService(dobIso, app.services);
    if (err) { setApplicantAgeError(err); return; }
    setApplicantAgeError("");
    setSavingApplicant(true);
    await onSaveApplicant({
      applicant_name: applicant.applicant_name || null,
      father_husband_name: applicant.father_husband_name || null,
      date_of_birth: dobIso,
      mobile: applicant.mobile || null,
      address: applicant.address || null,
      police_station: applicant.police_station || null,
      stay_since: ddmmyyyyToISO(applicant.stay_since),
    });
    setSavingApplicant(false);
  };

  const [answers, setAnswers] = useState(() => {
    const existing = Object.entries(app.service_answers || {}).map(([key, value]) => ({ key, value: String(value) }));
    const defaults = ["Application No", "Learner No", "PCC No"]
      .filter((k) => !existing.some((row) => row.key === k))
      .map((k) => ({ key: k, value: "" }));
    return [...existing, ...defaults];
  });
  const [savingAnswers, setSavingAnswers] = useState(false);

  const setAnswerKey = (i) => (e) => setAnswers((a) => a.map((row, idx) => idx === i ? { ...row, key: e.target.value } : row));
  const setAnswerValue = (i) => (e) => setAnswers((a) => a.map((row, idx) => idx === i ? { ...row, value: e.target.value } : row));
  const removeAnswer = (i) => setAnswers((a) => a.filter((_, idx) => idx !== i));
  const addAnswer = () => setAnswers((a) => [...a, { key: "", value: "" }]);

  const saveAnswers = async () => {
    const answersObj = {};
    answers.forEach(({ key, value }) => {
      if (key.trim() && value.trim()) answersObj[key.trim()] = value.trim();
    });
    setSavingAnswers(true);
    await onSaveAnswers(answersObj);
    setSavingAnswers(false);
  };

  if (mode === "status") {
    return (
      <Modal title={`Status & Assignment — ${app.draft_code}`} onClose={onClose} wide>
        <div className="flex items-center gap-2 mb-5">
          <span className="text-sm text-slate-500 dark:text-slate-500">Current status:</span>
          <StatusBadge status={app.status} />
          {app.application_date && (
            <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">
              Approved on {isoToDDMMYYYY(app.application_date)}
            </span>
          )}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <Card title="Assign Staff" className="mb-4">
              <Field label="Responsible Staff">
                <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </Select>
              </Field>
              <GhostButton onClick={() => onAssign(staffId || null)}>Save Assignment</GhostButton>
            </Card>

            <Card title="Update Status">
              <Field label="Remarks (shown to dealer)">
                <Input
                  as="textarea"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Please re-upload a clearer Aadhaar photo"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton onClick={() => onStatusChange("Under Review", remarks)}>Move to Review</PrimaryButton>
                <GhostButton onClick={() => onStatusChange("On Hold", remarks)}>Put On Hold</GhostButton>
                <PrimaryButton
                  onClick={() => onStatusChange("Accepted", remarks)}
                  className="!bg-emerald-600 hover:!bg-emerald-700"
                  disabled={!canApprove}
                  title={canApprove ? "Debits the application amount to the dealer's ledger" : "You don't have approval rights for this role"}
                >
                  Approve
                </PrimaryButton>
                <DangerButton onClick={() => onStatusChange("Rejected", remarks)}>Reject</DangerButton>
                {isAdmin && (
                  <DangerButton
                    onClick={() => onDelete(app)}
                    className="!bg-transparent !text-rose-600 border border-rose-300 hover:!bg-rose-50 dark:hover:!bg-rose-950"
                    title={`Delete application ${app.draft_code}`}
                  >
                    🗑 Delete Application
                  </DangerButton>
                )}
              </div>
            </Card>
          </div>

          <div>
            <Card title="Application History">
              {(app.history || []).length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No history yet</p>}
              {(app.history || []).map((h) => (
                <div key={h.id} className="text-xs text-slate-500 dark:text-slate-500 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{h.status}</span> — {new Date(h.changed_at).toLocaleString()}
                  {h.remarks && <div className="text-slate-400 dark:text-slate-500 mt-0.5">{h.remarks}</div>}
                </div>
              ))}
            </Card>
          </div>
        </div>
      </Modal>
    );
  }

  if (mode === "admin") {
    const fee = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
    const profit = Number(app.amount || 0) - Number(app.rto_fee || 0) - Number(app.pcc_fee || 0) - Number(app.agency_fee || 0);
    return (
      <>
      <Modal title={`Application — ${app.draft_code}`} onClose={onClose} size="xl">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-500 mb-4 -mt-1">
          <span><span className="font-semibold text-slate-600 dark:text-slate-300">Dealer:</span> {dealerLabel(app.dealers) || "—"}</span>
          <span><span className="font-semibold text-slate-600 dark:text-slate-300">Service:</span> {serviceLabel(app.services) || "—"}</span>
          <span className="flex items-center gap-1.5">
            <StatusBadge status={app.status} />
            {app.application_date && <span className="text-xs text-slate-400 dark:text-slate-500">Approved on {isoToDDMMYYYY(app.application_date)}</span>}
          </span>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Column 1: applicant details + staff assignment */}
          <div>
            <Card title="Applicant Details" className="mb-4">
              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Name"><Input value={applicant.applicant_name} onChange={setApplicantField("applicant_name")} /></Field>
                <Field label="Father/Husband"><Input value={applicant.father_husband_name} onChange={setApplicantField("father_husband_name")} /></Field>
                <Field label="DOB"><Input type="text" placeholder="DD-MM-YYYY" value={applicant.date_of_birth} onChange={setApplicantField("date_of_birth")}
                  className={ageHighlightClass(ddmmyyyyToISO(applicant.date_of_birth)) ? "border-amber-400" : ""} /></Field>
                <Field label="Mobile">
                  <div className="flex items-center gap-2">
                    <Input value={applicant.mobile} onChange={setApplicantField("mobile")} />
                    {applicant.mobile && (
                      <a
                        href={`tel:${applicant.mobile}`}
                        title={`Call ${applicant.mobile}`}
                        className="shrink-0 w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center hover:bg-emerald-100"
                      >
                        <Phone size={14} />
                      </a>
                    )}
                  </div>
                </Field>
                <div className="col-span-2"><Field label="Address"><Input value={applicant.address} onChange={setApplicantField("address")} /></Field></div>
                {app.services?.pcc_required && (
                  <>
                    <Field label="Police Station">
                      <SearchableSelect
                        value={applicant.police_station}
                        options={DELHI_POLICE_STATIONS.map((name) => ({ id: name, name }))}
                        onChange={(name) => setApplicant((s) => ({ ...s, police_station: name }))}
                        placeholder="Search police station…"
                      />
                    </Field>
                    <Field label="Staying at Address Since"><Input type="text" placeholder="DD-MM-YYYY" value={applicant.stay_since} onChange={setApplicantField("stay_since")} /></Field>
                  </>
                )}
              </div>
              <PrimaryButton disabled={savingApplicant} onClick={saveApplicant}>
                {savingApplicant ? "Saving…" : "Save Applicant Details"}
              </PrimaryButton>
              {applicantAgeError && <p className="text-rose-500 text-xs mt-2">{applicantAgeError}</p>}
            </Card>

            <Card title="Assign Staff">
              <Field label="Responsible Staff">
                <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </Select>
              </Field>
              <GhostButton onClick={() => onAssign(staffId || null)}>Save Assignment</GhostButton>
            </Card>
          </div>

          {/* Column 2: service answers, documents, chat */}
          <div>
            <Card title="Service Answers" className="mb-4">
              {answers.map((row, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Input placeholder="Field name" value={row.key} onChange={setAnswerKey(i)} className="w-2/5" />
                  <Input placeholder="Value" value={row.value} onChange={setAnswerValue(i)} />
                  <button onClick={() => removeAnswer(i)} className="text-rose-500 text-xs font-semibold px-2 shrink-0">Remove</button>
                </div>
              ))}
              <div className="flex items-center justify-between mt-2">
                <GhostButton onClick={addAnswer}>+ Add Field</GhostButton>
                <PrimaryButton disabled={savingAnswers} onClick={saveAnswers}>
                  {savingAnswers ? "Saving…" : "Save Details"}
                </PrimaryButton>
              </div>
            </Card>

            <Card title="Documents" className="mb-4">
              {app.services?.pcc_required && (
                <button
                  onClick={() => setShowPccLetter(true)}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-3 block"
                >
                  📄 Generate PCC Request Letter
                </button>
              )}
              {(app.docs || []).length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No documents uploaded</p>}
              {(app.docs || [])
                .filter((d) => !d.post_approval || app.status === "Accepted")
                .map((d) => (
                  <div key={d.id}>
                    {/learn/i.test(d.name) && app.application_no && (
                      <button
                        onClick={async () => {
                          const learnerNo = getLearnerNo(app.service_answers);
                          if (learnerNo) {
                            try {
                              await navigator.clipboard.writeText(learnerNo);
                              setToast("Learner No copied: " + learnerNo);
                            } catch {
                              // clipboard may be blocked; ignore silently
                            }
                          }
                          window.open(
                            `https://sarathi.parivahan.gov.in/sarathiservice/applicationredirect.do?q=${encodeURIComponent(app.application_no)}`,
                            "_blank", "noopener,noreferrer"
                          );
                        }}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-1"
                      >
                        ↗ Download Learning (opens Sarathi)
                      </button>
                    )}
                    {/aadhaar/i.test(d.name) && (
                      <button
                        onClick={() => window.open("https://myaadhaar.uidai.gov.in", "uidai_popup", "width=900,height=700,noopener,noreferrer")}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-1"
                      >
                        ↗ Download Aadhaar (opens UIDAI)
                      </button>
                    )}
                    {/pcc/i.test(d.name) && app.pcc_no && (
                      <button
                        onClick={() => setPccCheckApp(app)}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-1 block"
                      >
                        ↗ Download PCC Certificate
                      </button>
                    )}
                    <DocumentRow doc={d} applicationId={app.id} onChanged={onDocsChanged} />
                  </div>
                ))}
            </Card>

            {app.services?.chat_in_app && (
              <Card title="Chat">
                <div className="h-80 -mx-5 -mb-5 border-t border-slate-200 dark:border-slate-800 overflow-hidden rounded-b-xl">
                  <ChatPanel
                    dealerId={app.dealer_id}
                    applicationId={app.id}
                    identity={staffIdentity}
                    emptyLabel="No messages on this application yet."
                  />
                </div>
              </Card>
            )}
          </div>

          {/* Column 3: fee details, history, update status */}
          <div>
            <Card title="Fee Details" className="mb-4">
              <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                <span className="text-slate-400 dark:text-slate-500">Amount (charged)</span>
                <span className="text-slate-800 dark:text-slate-100 font-medium">{fee(app.amount)}</span>
                <span className="text-slate-400 dark:text-slate-500">Fee</span>
                <span className="text-slate-700 dark:text-slate-200">{fee(app.rto_fee)}</span>
                <span className="text-slate-400 dark:text-slate-500">PCC Fee</span>
                <span className="text-slate-700 dark:text-slate-200">{fee(app.pcc_fee)}</span>
                <span className="text-slate-400 dark:text-slate-500">Agency Fee</span>
                <span className="text-slate-700 dark:text-slate-200">{fee(app.agency_fee)}</span>
                <span className="text-slate-500 dark:text-slate-400 font-semibold border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">Profit</span>
                <span className={`font-bold border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1 ${profit < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fee(profit)}</span>
              </div>
            </Card>

            <Card title="Application History" className="mb-4">
              {(app.history || []).length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No history yet</p>}
              {(app.history || []).map((h) => (
                <div key={h.id} className="text-xs text-slate-500 dark:text-slate-500 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{h.status}</span> — {new Date(h.changed_at).toLocaleString()}
                  {h.remarks && <div className="text-slate-400 dark:text-slate-500 mt-0.5">{h.remarks}</div>}
                </div>
              ))}
            </Card>

            <Card title="Update Status">
              <Field label="Remarks (shown to dealer)">
                <Input
                  as="textarea"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Please re-upload a clearer Aadhaar photo"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton onClick={() => onStatusChange("Under Review", remarks)}>Move to Review</PrimaryButton>
                <GhostButton onClick={() => onStatusChange("On Hold", remarks)}>Put On Hold</GhostButton>
                <PrimaryButton
                  onClick={() => onStatusChange("Accepted", remarks)}
                  className="!bg-emerald-600 hover:!bg-emerald-700"
                  disabled={!canApprove}
                  title={canApprove ? "Debits the application amount to the dealer's ledger" : "You don't have approval rights for this role"}
                >
                  Approve
                </PrimaryButton>
                <DangerButton onClick={() => onStatusChange("Rejected", remarks)}>Reject</DangerButton>
                <DangerButton
                  onClick={() => onDelete(app)}
                  className="!bg-transparent !text-rose-600 border border-rose-300 hover:!bg-rose-50 dark:hover:!bg-rose-950"
                  title={`Delete application ${app.draft_code}`}
                >
                  🗑 Delete Application
                </DangerButton>
              </div>
            </Card>
          </div>
        </div>
      </Modal>
      {pccCheckApp && (
        <PCCStatusCheckModal row={pccCheckApp} onClose={() => setPccCheckApp(null)} />
      )}
      {showPccLetter && (
        <PCCLetterModal app={app} onClose={() => setShowPccLetter(false)} />
      )}
      </>
    );
  }

  // mode === "customer": edit only customer-related details
  return (
    <>
    <Modal title={`Application — ${app.draft_code}`} onClose={onClose} size="wide">
      <div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-500 mb-4 -mt-1">
          <span><span className="font-semibold text-slate-600 dark:text-slate-300">Dealer:</span> {dealerLabel(app.dealers) || "—"}</span>
          <span><span className="font-semibold text-slate-600 dark:text-slate-300">Service:</span> {serviceLabel(app.services) || "—"}</span>
        </div>
        <Card title="Applicant Details" className="mb-4">
          <div className="grid grid-cols-2 gap-x-4">
            <Field label="Name"><Input value={applicant.applicant_name} onChange={setApplicantField("applicant_name")} /></Field>
            <Field label="Father/Husband"><Input value={applicant.father_husband_name} onChange={setApplicantField("father_husband_name")} /></Field>
            <Field label="DOB"><Input type="text" placeholder="DD-MM-YYYY" value={applicant.date_of_birth} onChange={setApplicantField("date_of_birth")}
              className={ageHighlightClass(ddmmyyyyToISO(applicant.date_of_birth)) ? "border-amber-400" : ""} /></Field>
            <Field label="Mobile">
              <div className="flex items-center gap-2">
                <Input value={applicant.mobile} onChange={setApplicantField("mobile")} />
                {applicant.mobile && (
                  <a
                    href={`tel:${applicant.mobile}`}
                    title={`Call ${applicant.mobile}`}
                    className="shrink-0 w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center hover:bg-emerald-100"
                  >
                    <Phone size={14} />
                  </a>
                )}
              </div>
            </Field>
            <div className="col-span-2"><Field label="Address"><Input value={applicant.address} onChange={setApplicantField("address")} /></Field></div>
            {app.services?.pcc_required && (
              <>
                <Field label="Police Station">
                  <SearchableSelect
                    value={applicant.police_station}
                    options={DELHI_POLICE_STATIONS.map((name) => ({ id: name, name }))}
                    onChange={(name) => setApplicant((s) => ({ ...s, police_station: name }))}
                    placeholder="Search police station…"
                  />
                </Field>
                <Field label="Staying at Address Since"><Input type="text" placeholder="DD-MM-YYYY" value={applicant.stay_since} onChange={setApplicantField("stay_since")} /></Field>
              </>
            )}
          </div>
          <PrimaryButton disabled={savingApplicant} onClick={saveApplicant}>
            {savingApplicant ? "Saving…" : "Save Applicant Details"}
          </PrimaryButton>
          {applicantAgeError && <p className="text-rose-500 text-xs mt-2">{applicantAgeError}</p>}
        </Card>

        <Card title="Service Answers" className="mb-4">
          {answers.map((row, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <Input placeholder="Field name" value={row.key} onChange={setAnswerKey(i)} className="w-2/5" />
              <Input placeholder="Value" value={row.value} onChange={setAnswerValue(i)} />
              <button onClick={() => removeAnswer(i)} className="text-rose-500 text-xs font-semibold px-2 shrink-0">Remove</button>
            </div>
          ))}
          <div className="flex items-center justify-between mt-2">
            <GhostButton onClick={addAnswer}>+ Add Field</GhostButton>
            <PrimaryButton disabled={savingAnswers} onClick={saveAnswers}>
              {savingAnswers ? "Saving…" : "Save Details"}
            </PrimaryButton>
          </div>
        </Card>

        <Card title="Documents">
          {app.services?.pcc_required && (
            <button
              onClick={() => setShowPccLetter(true)}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-3 block"
            >
              📄 Generate PCC Request Letter
            </button>
          )}
          {(app.docs || []).length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No documents uploaded</p>}
          {(app.docs || [])
            .filter((d) => !d.post_approval || app.status === "Accepted")
            .map((d) => (
              <div key={d.id}>
                {/learn/i.test(d.name) && app.application_no && (
                  <button
                    onClick={async () => {
                      const learnerNo = getLearnerNo(app.service_answers);
                      if (learnerNo) {
                        try {
                          await navigator.clipboard.writeText(learnerNo);
                          setToast("Learner No copied: " + learnerNo);
                        } catch {
                          // clipboard may be blocked; ignore silently
                        }
                      }
                      window.open(
                        `https://sarathi.parivahan.gov.in/sarathiservice/applicationredirect.do?q=${encodeURIComponent(app.application_no)}`,
                        "_blank", "noopener,noreferrer"
                      );
                    }}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-1"
                  >
                    ↗ Download Learning (opens Sarathi)
                  </button>
                )}
                {/aadhaar/i.test(d.name) && (
                  <button
                    onClick={() => window.open("https://myaadhaar.uidai.gov.in", "uidai_popup", "width=900,height=700,noopener,noreferrer")}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-1"
                  >
                    ↗ Download Aadhaar (opens UIDAI)
                  </button>
                )}
                {/pcc/i.test(d.name) && app.pcc_no && (
                  <button
                    onClick={() => setPccCheckApp(app)}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-1 block"
                  >
                    ↗ Download PCC Certificate
                  </button>
                )}
                <DocumentRow doc={d} onChanged={onDocsChanged} />
              </div>
            ))}
        </Card>

        {app.services?.chat_in_app && (
          <Card title="Chat" className="mt-4">
            <div className="h-80 -mx-5 -mb-5 border-t border-slate-200 dark:border-slate-800 overflow-hidden rounded-b-xl">
              <ChatPanel
                dealerId={app.dealer_id}
                applicationId={app.id}
                identity={staffIdentity}
                emptyLabel="No messages on this application yet."
              />
            </div>
          </Card>
        )}
      </div>
    </Modal>
    {pccCheckApp && (
      <PCCStatusCheckModal row={pccCheckApp} onClose={() => setPccCheckApp(null)} />
    )}
    {showPccLetter && (
      <PCCLetterModal app={app} onClose={() => setShowPccLetter(false)} />
    )}
    </>
  );
}

const DOC_STATUS_STYLES = {
  Pending: "bg-amber-50 text-amber-700",
  Verified: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-rose-50 text-rose-700",
};

function DocumentRow({ doc, applicationId, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const setStatus = async (status) => {
    let reject_reason = doc.reject_reason;
    if (status === "Rejected") {
      reject_reason = window.prompt("Reason for rejecting this document?", "") || "";
    }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data: staffRow } = await supabase.from("staff").select("id").eq("auth_user_id", userData?.user?.id).maybeSingle();
    await supabase
      .from("application_documents")
      .update({ status, reject_reason, verified_by: staffRow?.id || null, verified_at: new Date().toISOString() })
      .eq("id", doc.id);
    setBusy(false);
    onChanged?.();
  };

  // Same bucket + path convention as the dealer portal's own upload (see
  // DealerPortal.jsx's `upload`), so a file uploaded from either side lands
  // in the same place and neither side has to guess at the other's layout.
  // Lets staff/admin upload directly here too — e.g. the Learning Licence
  // PDF just downloaded from the Sarathi popup above — instead of only
  // being able to Verify/Reject whatever the dealer already sent.
  const uploadFile = async (file) => {
    if (!file || !applicationId) return;
    setUploading(true);
    setUploadError("");
    const path = `${applicationId}/${doc.id}-${file.name}`;
    const { error: uploadErr } = await supabase
      .storage
      .from("application-documents")
      .upload(path, file, { upsert: true });
    if (uploadErr) {
      setUploading(false);
      setUploadError("Upload failed: " + uploadErr.message);
      return;
    }
    const { data: urlData } = supabase.storage.from("application-documents").getPublicUrl(path);
    const { error: updateErr } = await supabase
      .from("application_documents")
      .update({ file_url: urlData.publicUrl, status: "Pending", reject_reason: null })
      .eq("id", doc.id);
    setUploading(false);
    if (updateErr) {
      setUploadError("Saved file but failed to update record: " + updateErr.message);
      return;
    }
    onChanged?.();
  };

  return (
    <div className="py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700 dark:text-slate-300">{doc.name}</span>
        <div className="flex items-center gap-2">
          {doc.file_url ? (
            <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs font-semibold">View</a>
          ) : (
            <span className="text-rose-500 text-xs">Missing</span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${DOC_STATUS_STYLES[doc.status] || DOC_STATUS_STYLES.Pending}`}>
            {doc.status || "Pending"}
          </span>
        </div>
      </div>
      {doc.file_url && doc.status !== "Verified" && doc.status !== "Rejected" && (
        <div className="flex gap-2 mt-1.5">
          <button disabled={busy} onClick={() => setStatus("Verified")} className="text-xs font-semibold text-emerald-600 disabled:opacity-50">Verify</button>
          <button disabled={busy} onClick={() => setStatus("Rejected")} className="text-xs font-semibold text-rose-500 disabled:opacity-50">Reject</button>
        </div>
      )}
      {doc.status === "Rejected" && doc.reject_reason && (
        <p className="text-xs text-rose-500 mt-1">Reason: {doc.reject_reason}</p>
      )}
      {/* Verified docs are locked to avoid an accidental overwrite of an
          already-approved file — Reject it first (above) if it genuinely
          needs replacing. */}
      {doc.status !== "Verified" && (
        <div className="mt-2">
          <DocUploadDropzone busy={uploading} onFile={uploadFile} />
          {uploadError && <p className="text-rose-500 text-xs mt-1">{uploadError}</p>}
        </div>
      )}
    </div>
  );
}

// A restricted view of the same Applications page for general staff — same
// list, same actions (status updates, chat, calling, document review), but
// locked to a column set that leaves out Amount, Dealer, Agency Fee, and
// Profit (see STAFF_VISIBLE_KEYS above). Wired up as its own nav tab in
// App.jsx so it's a distinct, bookmarkable view rather than a toggle.
export function StaffApplications({ canEdit = true, canApprove = true, staff } = {}) {
  return <Applications restricted canEdit={canEdit} canApprove={canApprove} staff={staff} />;
}
