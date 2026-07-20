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
import { MessageCircle, Phone, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

const PCC_STATUS_API_BASE = import.meta.env.VITE_PCC_STATUS_API_BASE || "http://localhost:5000";

const STATUS_TABS = ["All", "Draft Submitted", "Under Review", "On Hold", "Rejected", "Accepted", "Completed"];

// Columns a staff member can hide/show via the "Columns" button. Draft ID,
// Status, and Chat stay pinned (always shown) since they're the primary way
// to identify/act on a row; everything else is optional detail.
const TOGGLEABLE_COLUMNS = [
  { key: "applicationDate", label: "Application Date" },
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
  { key: "mobile", label: "Mobile" },
  { key: "remark", label: "Remark" },
];

// Columns a restricted "Staff View" is locked to — everything except the
// financial / dealer-identifying columns (Amount, Dealer, Agency Fee,
// Profit). Staff in this view can't toggle those back on (see `restricted`
// prop on the Applications component below).
const STAFF_VISIBLE_KEYS = [
  "applicationDate", "service", "applicant", "dob", "rtoFee", "pccFee",
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

function EditableCell({ value, onSave, type = "text", width = "w-24", placeholder = "", disabled = false }) {
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
      className={`${width} rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
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

/**
 * Confirmed from the real get-pcc-application-status response: the API's
 * timeline entries use a "stage" key (Pending, Assigned, Field Verified,
 * Approved, Verified, Certificate Issued) which we map to the friendlier
 * labels the portal's own UI displays.
 */
const PCC_STAGE_ORDER = ["Pending", "Assigned", "Field Verified", "Approved", "Verified", "Certificate Issued"];
const PCC_STAGE_LABELS = {
  Pending: "Application Submitted",
  Assigned: "Assigned for Field Verification",
  "Field Verified": "Field Verified",
  Approved: "Approved",
  Verified: "Verified",
  "Certificate Issued": "Certificate Issued",
};

function mapToSteps(status) {
  const timeline = status?.timeline || [];
  const byStage = {};
  timeline.forEach((entry) => { byStage[entry.stage] = entry; });

  return PCC_STAGE_ORDER.map((stage) => ({
    label: PCC_STAGE_LABELS[stage] || stage,
    done: Boolean(byStage[stage]),
    timestamp: byStage[stage]?.date || null,
    description: byStage[stage]?.description || null,
  }));
}
// Delhi Police's portal expects the FULL application number including the
// "DLSB-PCC/" prefix (e.g. "DLSB-PCC/202605030627"). Our pcc_no field is often
// stored as just the trailing number, so add the prefix back if it's missing.
function normalizePccApplicationNumber(pccNo) {
  if (!pccNo) return pccNo;
  const trimmed = pccNo.trim();
  return /^DLSB-PCC\//i.test(trimmed) ? trimmed : `DLSB-PCC/${trimmed}`;
}

// Strip any leading "S/O", "W/O", "D/O", "C/O" (with or without punctuation)
// in case it was typed into the Father/Husband field — the portal expects
// just the plain name, with no relation prefix.
function stripKinPrefix(name) {
  if (!name) return name;
  return name.replace(/^\s*(s\/o|w\/o|d\/o|c\/o)[\s:.]*?/i, "").trim();
}

// Mirrors the Delhi Police portal's own "Track Application" form: application
// number (with the fixed DLSB-PCC/ prefix), applicant name, guardian name —
// prefilled from our record, but editable, with an explicit "Search
// Application" button. Nothing fires until the user clicks it.
function PCCStatusCheckModal({ row, onClose }) {
  const [applicationNumber, setApplicationNumber] = useState(
    normalizePccApplicationNumber(row.pcc_no)?.replace(/^DLSB-PCC\//i, "") || ""
  );
  const [applicantName, setApplicantName] = useState(row.applicant_name || "");
  const [guardianName, setGuardianName] = useState(stripKinPrefix(row.father_husband_name) || "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${PCC_STATUS_API_BASE}/api/pcc-status/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationNumber: normalizePccApplicationNumber(applicationNumber),
          applicantName,
          guardianName,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Application not found on the PCC portal");
      }
      setResult(data);
      return data;
    } catch (err) {
      setError(err.message || "Failed to reach the PCC status server");
      return null;
    } finally {
      setLoading(false);
    }
  };

  // The certificate link's token appears to be short-lived, so instead of
  // reusing whatever certificateUrl came back from the earlier search, we
  // re-run the check right at click time and open the freshest possible link
  // immediately — minimizing the gap between "token issued" and "token used".
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const fresh = await runCheck();
      const url = fresh?.status?.certificateUrl;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        setError("Couldn't get a fresh certificate link — try Search Application again.");
      }
    } finally {
      setDownloading(false);
    }
  };

  const application = result?.application || null;
  const status = result?.status || null;
  const steps = mapToSteps(status);
  const lastStep = steps[steps.length - 1];

  return (
    <Modal title="Track Application" onClose={onClose} wide>
      <div className="max-w-lg">
        <Field label="Application Number">
          <div className="flex">
            <span className="shrink-0 inline-flex items-center px-3 rounded-l-lg bg-blue-900 text-white text-sm font-semibold">
              DLSB-PCC/
            </span>
            <input
              type="text"
              value={applicationNumber}
              onChange={(e) => setApplicationNumber(e.target.value)}
              className="flex-1 rounded-r-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Applicant Name">
            <Input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} />
          </Field>
          <Field label="Guardian Name">
            <Input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
          </Field>
        </div>

        <PrimaryButton disabled={loading} onClick={runCheck} className="w-full mt-2">
          {loading ? "Searching…" : "Search Application"}
        </PrimaryButton>

        {error && (
          <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-4">
            {error}
          </div>
        )}

        {result && !application && (
          <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">No matching application found.</p>
        )}

        {application && (
          <div className="mt-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
              <div className="text-sm">
                <div className="text-xs text-slate-400 dark:text-slate-500">Application Number</div>
                <div className="font-semibold text-slate-700 dark:text-slate-300">{applicationNumber}</div>
              </div>
              <div className="text-sm">
                <div className="text-xs text-slate-400 dark:text-slate-500">Applicant Name</div>
                <div className="font-semibold text-slate-700 dark:text-slate-300">{application.applicantName}</div>
              </div>
              {status?.certificateUrl && (
                <button
                  type="button"
                  disabled={downloading}
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm"
                >
                  {downloading ? "Getting link…" : "⬇ Download Certificate"}
                </button>
              )}
            </div>
            {status?.certificateUrl && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                This link requires an active, logged-in session on the Delhi Police portal in this
                browser. If it shows a 401 error,{" "}
                <button
                  type="button"
                  onClick={() => window.open("https://pcccvr.delhipolice.gov.in/login", "_blank", "noopener,noreferrer")}
                  className="text-blue-600 font-semibold hover:underline"
                >
                  log into the portal
                </button>{" "}
                first, then try the download again.
              </p>
            )}

            {status && (
              <>
                <h4 className="font-semibold text-slate-700 dark:text-slate-300 mt-5 mb-3">Application Progress</h4>
                <ul>
                  {steps.map((s) => (
                    <li key={s.label} className="flex items-start gap-2 py-1.5 text-sm">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                        s.done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400 dark:text-slate-500"
                      }`}>
                        {s.done ? "✓" : ""}
                      </span>
                      <div>
                        <div className={s.done ? "text-slate-800 dark:text-slate-100 font-medium" : "text-slate-400 dark:text-slate-500"}>{s.label}</div>
                        {s.timestamp && <div className="text-xs text-blue-600">{s.timestamp}</div>}
                        {s.description && <div className="text-xs text-slate-400 dark:text-slate-500">{s.description}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {!status && result?.statusError && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4">
                Found the application, but couldn't load its progress right now. Try Search Application again.
              </p>
            )}

            {lastStep.done && !status?.certificateUrl && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                Certificate Issued — but no download link came back this time.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function serviceLabel(s) {
  if (!s) return "";
  return s.short_name || s.parent_service;
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

export default function Applications({ restricted = false, canEdit = true, canApprove = true } = {}) {
  const [tab, setTab] = useState("All");
  const [chatOnly, setChatOnly] = useState(false);
  const [compactView, setCompactView] = useState(false); // point 9
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
  const [toast, setToast] = useState(null);
  const [pccCheckRow, setPccCheckRow] = useState(null);
  const [chatStatus, setChatStatus] = useState({}); // { [applicationId]: true } when awaiting our reply

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() =>
    Object.fromEntries(TOGGLEABLE_COLUMNS.map((c) => [c.key, restricted ? STAFF_VISIBLE_KEYS.includes(c.key) : true]))
  );
  const toggleCol = (key) => setVisibleCols((v) => ({ ...v, [key]: !v[key] }));
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
    let query = supabase
      .from("applications")
      .select("*, dealers(name,code,short_name), services(parent_service,short_name,pcc_required,rto_required,agency_required,slot_booking_required,chat_in_app,next_service_id,next_service_wait_days), staff:assigned_staff_id(full_name)")
      .order("submitted_at", { ascending: false });
    if (tab !== "All") query = query.eq("status", tab);
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
      // Latest message per thread (messages are already newest-first).
      const latestByThread = {};
      for (const m of messages || []) {
        if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
      }
      const statusByApp = {};
      for (const t of threads) {
        const latest = latestByThread[t.id];
        if (latest) {
          statusByApp[t.application_id] = latest.sender_type !== "staff"; // true = awaiting our reply
        }
      }
      setChatStatus(statusByApp);
    } catch {
      setChatStatus({});
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("staff").select("id, full_name");
      setStaffList(s || []);
      const { data: d } = await supabase.from("dealers").select("id, name, code, short_name").order("name");
      setDealerList(d || []);
      const { data: summaries } = await supabase.from("dealer_ledger_summary").select("dealer_id, available_limit");
      setDealerHold(Object.fromEntries((summaries || []).filter((s) => s.available_limit <= 0).map((s) => [s.dealer_id, true])));
      const { data: sv } = await supabase.from("services").select("id, parent_service, short_name, pcc_required, rto_required, agency_required, slot_booking_required, chat_in_app").order("parent_service");
      setServiceList(sv || []);
      const { data: rt } = await supabase.from("rtos").select("id, name, code, type").order("name");
      setRtoList(rt || []);
      const { data: ag } = await supabase.from("agencies").select("id, name, code").order("name");
      setAgencyList(ag || []);
    })();
  }, []);

  const openDetail = async (row, mode = "customer") => {
    const { data: docs } = await supabase.from("application_documents").select("*").eq("application_id", row.id);
    const { data: history } = await supabase
      .from("application_status_history")
      .select("*")
      .eq("application_id", row.id)
      .order("changed_at", { ascending: false });
    setSelected({ ...row, docs, history });
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

    const { error } = await supabase
      .from("applications")
      .update({ status: "Accepted", remarks, application_date: applicationDate })
      .eq("id", app.id);
    if (error) {
      return { ok: false, message: "Failed: " + error.message };
    }

    const descriptionParts = [
      app.applicant_name ? `Customer: ${app.applicant_name}` : null,
      `Service: ${serviceLabel(app.services) || "—"}`,
      `Date: ${isoToDDMMYYYY(applicationDate)}`,
      app.application_no ? `App No: ${app.application_no}` : null,
      app.ll_dl_no ? `LL/DL No: ${app.ll_dl_no}` : null,
      app.date_of_birth ? `DOB: ${isoToDDMMYYYY(app.date_of_birth)}` : null,
      app.services?.pcc_required && app.pcc_no ? `PCC No: ${app.pcc_no}` : null,
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
    // Completed is when the 30-day "eligible for next service" clock starts
    // — write it once, don't clobber it if somehow re-marked.
    if (newStatus === "Completed" && !selected.completed_at) {
      updatePayload.completed_at = new Date().toISOString();
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

  // Changing dealer/service on a Draft mid-flight (point 5/6) needs to also
  // refresh the row's joined `dealers`/`services` objects locally — other
  // cells (RTO/PCC/Agency/Slot required flags, dealer HOLD badge) read off
  // those joined objects, not the raw *_id, so without this they'd show
  // stale requirements until the next full page reload.
  const updateDealerOrService = async (id, field, value, list) => {
    const { error } = await supabase.from("applications").update({ [field]: value }).eq("id", id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    const picked = list.find((item) => item.id === value);
    const joinedKey = field === "dealer_id" ? "dealers" : "services";
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value, [joinedKey]: picked || r[joinedKey] } : r)));
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
    const { data: newApp, error } = await supabase.from("applications").insert({
      draft_code: draftCode,
      dealer_id: form.dealer_id,
      service_id: form.service_id,
      applicant_name: form.applicant_name,
      father_husband_name: form.father_husband_name || null,
      date_of_birth: form.date_of_birth || null,
      mobile: form.mobile || null,
      address: form.address || null,
      service_answers: form.service_answers && Object.keys(form.service_answers).length ? form.service_answers : null,
      status: form.status,
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

  const filteredRows = rows.filter((r) => {
    if (chatOnly && !chatStatus[r.id]) return false;
    if (filterDealer && r.dealer_id !== filterDealer) return false;
    if (filterRto && r.rto_id !== filterRto) return false;
    if (filterAgency && r.agency_id !== filterAgency) return false;
    if (filterService && r.service_id !== filterService) return false;
    if (filterDateFrom && (!r.submitted_at || r.submitted_at.slice(0, 10) < filterDateFrom)) return false;
    if (filterDateTo && (!r.submitted_at || r.submitted_at.slice(0, 10) > filterDateTo)) return false;
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
    rto: (r) => rtoList.find((x) => x.id === r.rto_id)?.name || "",
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

  // Pagination — 10 rows per page (point 8). Export CSV still uses the full
  // sortedRows (unpaginated), only the on-screen table is sliced.
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [tab, search, filterDealer, filterRto, filterAgency, filterService, chatOnly]);
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
      : ["Draft ID", "Amount", "Fee", "PCC Fee", "Agency Fee", "Profit", "Dealer", "Service",
      "Applicant", "DOB", "Application No", "LL/DL No", "PCC No", "PCC Status", "RTO", "Agency",
      "Slot", "Mobile", "Remark", "Application Date", "Status", "Submitted At"];
    const escapeCsv = (val) => {
      const s = val === null || val === undefined ? "" : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    sortedRows.forEach((r) => {
      const fullRow = [
        r.draft_code, r.amount, r.rto_fee, r.pcc_fee, r.agency_fee, profitOf(r),
        dealerLabel(r.dealers), serviceLabel(r.services), r.applicant_name, isoToDDMMYYYY(r.date_of_birth),
        r.application_no, r.ll_dl_no, r.pcc_no, r.pcc_status,
        rtoList.find((x) => x.id === r.rto_id)?.name, agencyList.find((x) => x.id === r.agency_id)?.name,
        r.slot_time, r.mobile, r.remarks, r.application_date ? isoToDDMMYYYY(r.application_date) : "", r.status, r.submitted_at,
      ];
      const restrictedRow = [
        r.draft_code, serviceLabel(r.services), r.applicant_name, isoToDDMMYYYY(r.date_of_birth),
        r.rto_fee, r.pcc_fee, r.application_no, r.ll_dl_no, r.pcc_no, r.pcc_status,
        rtoList.find((x) => x.id === r.rto_id)?.name, agencyList.find((x) => x.id === r.agency_id)?.name,
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
  // Count of applications currently awaiting a staff reply in chat — same
  // "awaiting reply" definition as the Chats page/sidebar badge — shown as
  // a chat-count badge next to the page title.
  const openChatCount = Object.values(chatStatus).filter(Boolean).length;

  return (
    <CanEditContext.Provider value={canEdit}>
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Applications</h2>
            {openChatCount > 0 && (
              <span
                title={`${openChatCount} chat${openChatCount !== 1 ? "s" : ""} awaiting your reply`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500 text-white"
              >
                <MessageCircle size={12} />
                {openChatCount}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 dark:text-slate-500">
            {filteredRows.length} record{filteredRows.length !== 1 ? "s" : ""}
            {filteredRows.length !== rows.length && ` (of ${rows.length})`}
          </p>
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
            Draft: {rows.filter((r) => r.status === "Draft Submitted").length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GhostButton onClick={exportCSV}>⬇ Export CSV</GhostButton>
          {canEdit && <GhostButton onClick={() => setShowImport(true)}>⬆ Import CSV</GhostButton>}
          {canEdit && <PrimaryButton onClick={() => setShowNew(true)}>+ New Application</PrimaryButton>}
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap items-center">
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
        <button
          onClick={() => setCompactView((c) => !c)}
          title="Toggle a denser, grouped-column table layout"
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
            compactView ? "bg-violet-600 text-white border-violet-600" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
          }`}
        >
          ▦ Compact View
        </button>
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
              {visibleCols.applicationDate && <SortableTh column="applicationDate" label="Application Date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
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
              {visibleCols.mobile && <SortableTh column="mobile" label="Mobile" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              {visibleCols.remark && <SortableTh column="remark" label="Remark" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
              <SortableTh column="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Chat</th>
              <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Appointment</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 transition-colors ${ROW_STATUS_TINT[r.status] || "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}>
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  <button
                    onClick={() => setDetailPopup(r)}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    title="View full customer details and service charges"
                  >
                    {r.draft_code}
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
                    <EditableCell type="number" width="w-20" value={r.amount} onSave={(v) => updateRowField(r.id, "amount", v === "" ? null : parseFloat(v))} />
                  </td>
                )}
                {visibleCols.dealer && (
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
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
                    {dealerHold[r.dealer_id] && (
                      <span
                        title="This dealer is out of usable credit"
                        className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200 align-middle"
                      >
                        HOLD
                      </span>
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
                    <button onClick={() => openDetail(r, "customer")} className="text-blue-600 font-semibold hover:underline text-left">
                      {r.applicant_name}
                    </button>
                  </td>
                )}
                {visibleCols.dob && <td className="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{isoToDDMMYYYY(r.date_of_birth)}</td>}
                {visibleCols.rtoFee && (
                  <td className="px-3 py-2">
                    <EditableCell
                      type="number"
                      width="w-20"
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
                      onSave={(v) => updateRowField(r.id, "pcc_fee", v === "" ? null : parseFloat(v))}
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
                      onSave={(v) => updateRowField(r.id, "agency_fee", v === "" ? null : parseFloat(v))}
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
                        className="text-blue-600 text-xs font-semibold underline shrink-0"
                      >
                        Link
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
                    <EditableSelect
                      width="w-32"
                      value={r.rto_id}
                      options={rtoList}
                      placeholder="Select RTO"
                      disabled={!r.services?.rto_required}
                      onSave={(v) => updateRowField(r.id, "rto_id", v || null)}
                    />
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
                      onSave={(v) => updateRowField(r.id, "agency_id", v || null)}
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
                      placeholder="e.g. 15-07 11AM"
                    />
                  </td>
                )}
                {visibleCols.mobile && (
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
                {visibleCols.remark && (
                  <td className="px-3 py-2">
                    <EditableCell width="w-36" value={r.remarks} onSave={(v) => updateRowField(r.id, "remarks", v || null)} />
                  </td>
                )}
                <td className="px-3 py-2">
                  <button
                    onClick={() => openDetail(r, "status")}
                    title="Assign staff, update status, view history"
                    className="hover:opacity-80"
                  >
                    <StatusBadge status={r.status} />
                  </button>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.services?.chat_in_app ? (
                    <button
                      onClick={() => setChatApp({ id: r.id, dealer_id: r.dealer_id, label: `${r.draft_code} — ${r.applicant_name}` })}
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                        chatStatus[r.id]
                          ? "bg-rose-50 text-rose-600 border-rose-200 animate-pulse"
                          : "bg-slate-50 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800"
                      }`}
                      title={chatStatus[r.id] ? "Dealer sent a message — awaiting your reply" : "Open chat"}
                    >
                      {chatStatus[r.id] ? "New message" : "Chat"}
                    </button>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
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
              <tr><td colSpan={20} className="text-center text-slate-400 dark:text-slate-500 py-10">No applications match your search / filters</td></tr>
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
          onClose={closeDetail}
          onStatusChange={updateStatus}
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

      {pccCheckRow && (
        <PCCStatusCheckModal row={pccCheckRow} onClose={() => setPccCheckRow(null)} />
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

  const Pair = ({ top, bottom }) => (
    <div className="leading-tight">
      <div className="text-slate-800 dark:text-slate-100">{top}</div>
      <div className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">{bottom}</div>
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
                <td className="px-3 py-2"><Pair top={r.ll_dl_no || "—"} bottom={r.date_of_birth ? isoToDDMMYYYY(r.date_of_birth) : "—"} /></td>
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
  rtofee: "rto_fee",
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
  completed: "Completed",
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

        const rto = row.rto ? findByLabel(rtoList, row.rto, ["name", "code"]) : null;
        if (row.rto && !rto) errors.push(`RTO "${row.rto}" not found`);

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

        return { raw, errors, payload, dealerRaw: row.dealer || "", serviceRaw: row.service || "", included: errors.length === 0 };
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

  const runImport = async () => {
    const rowsToImport = preview.filter((r) => r.included && r.errors.length === 0);
    if (!rowsToImport.length) return;
    setImporting(true);
    setError("");
    try {
      // Assign each row's real sequential draft code now (not during preview) so
      // cancelling after preview doesn't burn/skip numbers in a dealer's counter.
      // Rows where the CSV itself specified a draft_code keep that value as-is.
      const payloads = [];
      for (const r of rowsToImport) {
        if (r.payload.draft_code) {
          payloads.push(r.payload);
          continue;
        }
        const { data: generated, error: codeError } = await supabase.rpc("next_draft_code", { p_dealer_id: r.payload.dealer_id });
        if (codeError) {
          setError(`Import failed generating a draft code for "${r.payload.applicant_name}": ` + codeError.message);
          setImporting(false);
          return;
        }
        payloads.push({ ...r.payload, draft_code: generated });
      }

      const { error: insertError } = await supabase.from("applications").insert(payloads);
      if (insertError) {
        setError("Import failed: " + insertError.message);
        setImporting(false);
        return;
      }
      setResult({ imported: rowsToImport.length, skipped: preview.length - rowsToImport.length });
      setImporting(false);
      onImported();
    } catch (err) {
      setError("Import failed: " + err.message);
      setImporting(false);
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
        </>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 px-3 py-2">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            ✓ Imported {result.imported} record{result.imported !== 1 ? "s" : ""}
            {result.skipped > 0 && ` (${result.skipped} skipped due to errors)`}.
          </p>
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
            <span className="text-slate-700 dark:text-slate-200">{row.date_of_birth ? isoToDDMMYYYY(row.date_of_birth) : "—"}</span>
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
    date_of_birth: "", mobile: "", address: "", status: "Draft Submitted",
  });
  const [answers, setAnswers] = useState([
    { key: "Application No", value: "" },
    { key: "Learner No", value: "" },
    { key: "PCC No", value: "" },
  ]);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const valid = form.dealer_id && form.service_id && form.applicant_name;

  const setAnswerKey = (i) => (e) => setAnswers((a) => a.map((row, idx) => idx === i ? { ...row, key: e.target.value } : row));
  const setAnswerValue = (i) => (e) => setAnswers((a) => a.map((row, idx) => idx === i ? { ...row, value: e.target.value } : row));
  const removeAnswer = (i) => setAnswers((a) => a.filter((_, idx) => idx !== i));
  const addAnswer = () => setAnswers((a) => [...a, { key: "", value: "" }]);

  const handleCreate = () => {
    const service_answers = {};
    answers.forEach(({ key, value }) => {
      if (key.trim() && value.trim()) service_answers[key.trim()] = value.trim();
    });
    onCreate({ ...form, date_of_birth: ddmmyyyyToISO(form.date_of_birth), service_answers });
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
          <Input type="text" placeholder="DD-MM-YYYY" value={form.date_of_birth} onChange={set("date_of_birth")} />
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
    </Modal>
  );
}

function ApplicationDetailModal({ app, mode = "customer", staffList, restricted = false, canApprove = true, onClose, onStatusChange, onAssign, onSaveAnswers, onSaveApplicant, onDocsChanged }) {
  const [remarks, setRemarks] = useState(app.remarks || "");
  const [staffId, setStaffId] = useState(app.assigned_staff_id || "");
  const [staffIdentity, setStaffIdentity] = useState(null);
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
  });
  const [savingApplicant, setSavingApplicant] = useState(false);
  const setApplicantField = (k) => (e) => setApplicant((s) => ({ ...s, [k]: e.target.value }));

  const saveApplicant = async () => {
    setSavingApplicant(true);
    await onSaveApplicant({
      applicant_name: applicant.applicant_name || null,
      father_husband_name: applicant.father_husband_name || null,
      date_of_birth: ddmmyyyyToISO(applicant.date_of_birth),
      mobile: applicant.mobile || null,
      address: applicant.address || null,
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
                {app.status === "Accepted" && (
                  <GhostButton
                    onClick={() => onStatusChange("Completed", remarks)}
                    title="Marks the physical process as finished — starts the 30-day clock for booking a follow-up appointment, if this service has a Next Service configured"
                  >
                    Mark Completed
                  </GhostButton>
                )}
                <DangerButton onClick={() => onStatusChange("Rejected", remarks)}>Reject</DangerButton>
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

  // mode === "customer": edit only customer-related details
  return (
    <Modal title={`Application — ${app.draft_code}`} onClose={onClose} size="md">
      <div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-500 mb-4 -mt-1">
          {!restricted && <span><span className="font-semibold text-slate-600 dark:text-slate-300">Dealer:</span> {dealerLabel(app.dealers) || "—"}</span>}
          <span><span className="font-semibold text-slate-600 dark:text-slate-300">Service:</span> {serviceLabel(app.services) || "—"}</span>
        </div>
        <Card title="Applicant Details" className="mb-4">
          <Field label="Name"><Input value={applicant.applicant_name} onChange={setApplicantField("applicant_name")} /></Field>
          <Field label="Father/Husband"><Input value={applicant.father_husband_name} onChange={setApplicantField("father_husband_name")} /></Field>
          <Field label="DOB"><Input type="text" placeholder="DD-MM-YYYY" value={applicant.date_of_birth} onChange={setApplicantField("date_of_birth")} /></Field>
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
          <Field label="Address"><Input value={applicant.address} onChange={setApplicantField("address")} /></Field>
          <PrimaryButton disabled={savingApplicant} onClick={saveApplicant}>
            {savingApplicant ? "Saving…" : "Save Applicant Details"}
          </PrimaryButton>
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
          {(app.docs || []).length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No documents uploaded</p>}
          {(app.docs || [])
            .filter((d) => !d.post_approval || app.status === "Accepted" || app.status === "Completed")
            .map((d) => (
              <div key={d.id}>
                {/learn/i.test(d.name) && app.application_no && (
                  <button
                    onClick={() => window.open(
                      `https://sarathi.parivahan.gov.in/sarathiservice/applicationredirect.do?q=${encodeURIComponent(app.application_no)}`,
                      "sarathi_popup", "width=900,height=700,noopener,noreferrer"
                    )}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-1"
                  >
                    ↗ Download Learning (opens Sarathi)
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
  );
}

const DOC_STATUS_STYLES = {
  Pending: "bg-amber-50 text-amber-700",
  Verified: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-rose-50 text-rose-700",
};

function DocumentRow({ doc, onChanged }) {
  const [busy, setBusy] = useState(false);

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
    </div>
  );
}

// A restricted view of the same Applications page for general staff — same
// list, same actions (status updates, chat, calling, document review), but
// locked to a column set that leaves out Amount, Dealer, Agency Fee, and
// Profit (see STAFF_VISIBLE_KEYS above). Wired up as its own nav tab in
// App.jsx so it's a distinct, bookmarkable view rather than a toggle.
export function StaffApplications({ canEdit = true, canApprove = true } = {}) {
  return <Applications restricted canEdit={canEdit} canApprove={canApprove} />;
}
