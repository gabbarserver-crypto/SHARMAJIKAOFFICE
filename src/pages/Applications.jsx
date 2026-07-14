// src/pages/Applications.jsx
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { Card, StatusBadge, PrimaryButton, GhostButton, DangerButton, Field, Input, Select, Modal, Toast } from "../components/UI";

const PCC_STATUS_API_BASE = import.meta.env.VITE_PCC_STATUS_API_BASE || "http://localhost:5000";

const STATUS_TABS = ["All", "Draft Submitted", "Under Review", "On Hold", "Rejected", "Accepted", "Completed"];

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

function EditableCell({ value, onSave, type = "text", width = "w-24", placeholder = "" }) {
  const [val, setVal] = useState(value ?? "");
  useEffect(() => { setVal(value ?? ""); }, [value]);
  return (
    <input
      type={type}
      value={val}
      placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (String(val) !== String(value ?? "")) onSave(val); }}
      className={`${width} rounded border border-slate-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400`}
    />
  );
}

function EditableSelect({ value, options, onSave, width = "w-32", placeholder = "Select" }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onSave(e.target.value)}
      className={`${width} rounded border border-slate-300 px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400`}
    >
      <option value="">{placeholder}</option>
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
        <div className="absolute z-30 mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-lg w-60 overflow-hidden text-xs">
          <table className="w-full">
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="bg-slate-50 px-2.5 py-2 font-semibold text-slate-500 w-16 align-middle">pcc no</td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={localNo}
                    onChange={(e) => setLocalNo(e.target.value)}
                    placeholder="DLSB-PCC/…"
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
              </tr>
              <tr>
                <td className="bg-slate-50 px-2.5 py-2 font-semibold text-slate-500 align-middle">status</td>
                <td className="px-2 py-1.5">
                  <select
                    value={localStatus}
                    onChange={(e) => setLocalStatus(e.target.value)}
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
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
            className="w-full text-left px-2.5 py-1.5 text-[11px] text-blue-600 hover:bg-slate-50 border-b border-slate-100"
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
              className="flex-1 rounded-r-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
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
          <p className="text-sm text-slate-400 py-4 text-center">No matching application found.</p>
        )}

        {application && (
          <div className="mt-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm">
                <div className="text-xs text-slate-400">Application Number</div>
                <div className="font-semibold text-slate-700">{applicationNumber}</div>
              </div>
              <div className="text-sm">
                <div className="text-xs text-slate-400">Applicant Name</div>
                <div className="font-semibold text-slate-700">{application.applicantName}</div>
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
              <p className="text-xs text-slate-400 mt-1.5">
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
                <h4 className="font-semibold text-slate-700 mt-5 mb-3">Application Progress</h4>
                <ul>
                  {steps.map((s) => (
                    <li key={s.label} className="flex items-start gap-2 py-1.5 text-sm">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                        s.done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"
                      }`}>
                        {s.done ? "✓" : ""}
                      </span>
                      <div>
                        <div className={s.done ? "text-slate-800 font-medium" : "text-slate-400"}>{s.label}</div>
                        {s.timestamp && <div className="text-xs text-blue-600">{s.timestamp}</div>}
                        {s.description && <div className="text-xs text-slate-400">{s.description}</div>}
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
  return s.short_name || `${s.parent_service}${s.sub_service ? ` (${s.sub_service})` : ""}`;
}
function dealerLabel(d) {
  if (!d) return "";
  return d.short_name || d.name;
}

// Builds the description text for a dealer ledger line auto-posted from an
// application's Amount field.
function dealerLedgerDescription(app) {
  const parts = [
    app.applicant_name ? `Customer: ${app.applicant_name}` : null,
    `Service: ${serviceLabel(app.services) || "—"}`,
    app.application_no ? `App No: ${app.application_no}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : `Application ${app.draft_code}`;
}

// Builds the description text for an agency ledger line auto-posted from an
// application's Agency Fee field.
function agencyLedgerDescription(app, agencyList) {
  const agencyName = agencyList.find((a) => a.id === app.agency_id)?.name;
  const parts = [
    `Agency fee — ${app.draft_code}`,
    app.applicant_name ? `Customer: ${app.applicant_name}` : null,
    `Service: ${serviceLabel(app.services) || "—"}`,
    agencyName ? `Agency: ${agencyName}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

// Keeps a single ledger line per application in sync with a field on that
// application (Amount → dealer ledger, Agency Fee → agency ledger). Each
// application gets at most one line per side, identified by its draft_code
// as the voucher number, so editing the amount later updates that same line
// instead of piling up duplicates. If the linked dealer/agency is switched,
// the old line is removed and a fresh one posted under the new one. If the
// amount is cleared to zero/blank, the posted line is removed entirely.
async function syncLedgerLine({ table, matchField, entityId, previousEntityId, voucherNo, type, amount, description }) {
  if (previousEntityId && previousEntityId !== entityId) {
    const { error: delErr } = await supabase
      .from(table)
      .delete()
      .eq(matchField, previousEntityId)
      .eq("voucher_no", voucherNo)
      .eq("type", type);
    if (delErr) throw new Error(delErr.message);
  }

  if (!entityId) return; // no dealer/agency chosen yet — nothing to post

  const { data: existing, error: findErr } = await supabase
    .from(table)
    .select("id")
    .eq(matchField, entityId)
    .eq("voucher_no", voucherNo)
    .eq("type", type)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);

  const numericAmount = Number(amount) || 0;

  if (numericAmount <= 0) {
    if (existing) {
      const { error: delErr } = await supabase.from(table).delete().eq("id", existing.id);
      if (delErr) throw new Error(delErr.message);
    }
    return;
  }

  if (existing) {
    const { error: updErr } = await supabase.from(table).update({ amount: numericAmount, description }).eq("id", existing.id);
    if (updErr) throw new Error(updErr.message);
  } else {
    const { error: insErr } = await supabase
      .from(table)
      .insert({ [matchField]: entityId, type, amount: numericAmount, voucher_no: voucherNo, description });
    if (insErr) throw new Error(insErr.message);
  }
}

export default function Applications() {
  const [tab, setTab] = useState("All");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState(null); // "customer" | "status"
  const [staffList, setStaffList] = useState([]);
  const [dealerList, setDealerList] = useState([]);
  const [serviceList, setServiceList] = useState([]);
  const [rtoList, setRtoList] = useState([]);
  const [agencyList, setAgencyList] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState(null);
  const [pccCheckRow, setPccCheckRow] = useState(null);

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterDealer, setFilterDealer] = useState("");
  const [filterRto, setFilterRto] = useState("");
  const [filterAgency, setFilterAgency] = useState("");
  const [filterService, setFilterService] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("applications")
      .select("*, dealers(name,code,short_name), services(parent_service,sub_service,short_name,pcc_required), staff:assigned_staff_id(full_name)")
      .order("submitted_at", { ascending: false });
    if (tab !== "All") query = query.eq("status", tab);
    const { data } = await query;
    setRows(data || []);
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("staff").select("id, full_name");
      setStaffList(s || []);
      const { data: d } = await supabase.from("dealers").select("id, name, code, short_name").order("name");
      setDealerList(d || []);
      const { data: sv } = await supabase.from("services").select("id, parent_service, sub_service, short_name").order("parent_service");
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

    try {
      await syncDealerLedgerForRow({ ...app, application_date: applicationDate }, app.dealer_id, descriptionParts.join(" · "));
    } catch (e) {
      return { ok: false, message: "Status updated, but ledger entry failed: " + e.message };
    }

    return {
      ok: true,
      message: `Accepted on ${isoToDDMMYYYY(applicationDate)} — ₹${Number(app.amount || 0).toLocaleString("en-IN")} debited to dealer ledger`,
    };
  };

  // Quick, one-click approve straight from the table's Status column — no need
  // to open the full status modal first.
  const quickApprove = async (row) => {
    if (row.status === "Accepted") return;
    const ok = window.confirm(
      `Approve ${row.applicant_name || row.draft_code}? ₹${Number(row.amount || 0).toLocaleString("en-IN")} will be debited to ${dealerLabel(row.dealers) || "the dealer"}'s ledger.`
    );
    if (!ok) return;
    const result = await approveApplication(row);
    setToast(result.message);
    if (result.ok) load();
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

  // Posts/updates this application's dealer ledger line from its current
  // Amount. descriptionOverride lets the Accept flow use its richer summary
  // instead of the lighter one used for plain inline edits.
  const syncDealerLedgerForRow = async (row, prevDealerId, descriptionOverride) => {
    await syncLedgerLine({
      table: "ledger_transactions",
      matchField: "dealer_id",
      entityId: row.dealer_id,
      previousEntityId: prevDealerId && prevDealerId !== row.dealer_id ? prevDealerId : null,
      voucherNo: row.draft_code,
      type: "debit",
      amount: row.amount,
      description: descriptionOverride || dealerLedgerDescription(row),
    });
  };

  // Posts/updates this application's agency ledger line from its current
  // Agency Fee.
  const syncAgencyLedgerForRow = async (row, prevAgencyId) => {
    await syncLedgerLine({
      table: "agency_ledger_transactions",
      matchField: "agency_id",
      entityId: row.agency_id,
      previousEntityId: prevAgencyId && prevAgencyId !== row.agency_id ? prevAgencyId : null,
      voucherNo: row.draft_code,
      type: "credit",
      amount: row.agency_fee,
      description: agencyLedgerDescription(row, agencyList),
    });
  };

  const updateRowField = async (id, field, value) => {
    const prevRow = rows.find((r) => r.id === id);
    const { error } = await supabase.from("applications").update({ [field]: value }).eq("id", id);
    if (error) {
      setToast("Failed to update: " + error.message);
      return;
    }
    const updatedRow = { ...prevRow, [field]: value };
    setRows((rs) => rs.map((r) => (r.id === id ? updatedRow : r)));

    // Auto-post to the ledgers the moment Amount / Agency Fee (or the
    // dealer/agency they're linked to) is filled in — no need to wait for
    // the application to be Accepted.
    try {
      if (field === "amount" || field === "dealer_id") {
        await syncDealerLedgerForRow(updatedRow, prevRow?.dealer_id);
      }
      if (field === "agency_fee" || field === "agency_id") {
        await syncAgencyLedgerForRow(updatedRow, prevRow?.agency_id);
      }
    } catch (e) {
      setToast("Saved, but ledger sync failed: " + e.message);
    }
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

  const createApplication = async (form) => {
    const draftCode = "DFT" + Math.floor(1000 + Math.random() * 9000);
    const { error } = await supabase.from("applications").insert({
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
    });
    if (error) {
      setToast("Failed to create: " + error.message);
      return;
    }
    setToast(`Created ${draftCode}`);
    setShowNew(false);
    load();
  };

  const filteredRows = rows.filter((r) => {
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
        r.dealers?.name, r.dealers?.short_name, r.services?.parent_service, r.services?.sub_service, r.services?.short_name,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const profitOf = (r) => Number(r.amount || 0) - Number(r.rto_fee || 0) - Number(r.pcc_fee || 0) - Number(r.agency_fee || 0);

  const exportCSV = () => {
    const headers = [
      "Draft ID", "Amount", "RTO Fee", "PCC Fee", "Agency Fee", "Profit", "Dealer", "Service",
      "Applicant", "DOB", "Application No", "LL/DL No", "PCC No", "PCC Status", "RTO", "Agency",
      "Slot", "Mobile", "Remark", "Application Date", "Status", "Submitted At",
    ];
    const escapeCsv = (val) => {
      const s = val === null || val === undefined ? "" : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    filteredRows.forEach((r) => {
      lines.push([
        r.draft_code, r.amount, r.rto_fee, r.pcc_fee, r.agency_fee, profitOf(r),
        dealerLabel(r.dealers), serviceLabel(r.services), r.applicant_name, isoToDDMMYYYY(r.date_of_birth),
        r.application_no, r.ll_dl_no, r.pcc_no, r.pcc_status,
        rtoList.find((x) => x.id === r.rto_id)?.name, agencyList.find((x) => x.id === r.agency_id)?.name,
        r.slot_time, r.mobile, r.remarks, r.application_date ? isoToDDMMYYYY(r.application_date) : "", r.status, r.submitted_at,
      ].map(escapeCsv).join(","));
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
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Applications</h2>
          <p className="text-sm text-slate-400">
            {filteredRows.length} record{filteredRows.length !== 1 ? "s" : ""}
            {filteredRows.length !== rows.length && ` (of ${rows.length})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GhostButton onClick={exportCSV}>⬇ Export CSV</GhostButton>
          <PrimaryButton onClick={() => setShowNew(true)}>+ New Application</PrimaryButton>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
              tab === t ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, mobile, draft ID, application no…"
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        </div>
        <GhostButton onClick={() => setShowFilters((s) => !s)}>
          Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </GhostButton>
        {(search || activeFilterCount > 0) && (
          <button
            onClick={() => { setSearch(""); clearFilters(); }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            Clear all
          </button>
        )}
      </div>

      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          <Select value={filterDealer} onChange={(e) => setFilterDealer(e.target.value)}>
            <option value="">All Dealers</option>
            {dealerList.map((d) => <option key={d.id} value={d.id}>{dealerLabel(d)}</option>)}
          </Select>
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
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Submitted From</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Submitted To</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Draft ID</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Amount</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Dealer</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Service</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Applicant</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">DOB</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">RTO Fee</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">PCC Fee</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Agency Fee</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Profit</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Application</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">LL/DL No.</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">PCC No</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">RTO</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Agency</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Slot</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Mobile</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Remark</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Application Date</th>
              <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">{r.draft_code}</td>
                <td className="px-4 py-3">
                  <EditableCell type="number" width="w-20" value={r.amount} onSave={(v) => updateRowField(r.id, "amount", v === "" ? null : parseFloat(v))} />
                </td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dealerLabel(r.dealers)}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{serviceLabel(r.services)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button onClick={() => openDetail(r, "customer")} className="text-blue-600 font-semibold hover:underline text-left">
                    {r.applicant_name}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{isoToDDMMYYYY(r.date_of_birth)}</td>
                <td className="px-4 py-3">
                  <EditableCell type="number" width="w-20" value={r.rto_fee} onSave={(v) => updateRowField(r.id, "rto_fee", v === "" ? null : parseFloat(v))} />
                </td>
                <td className="px-4 py-3">
                  {r.services?.pcc_required ? (
                    <EditableCell
                      type="number"
                      width="w-20"
                      value={r.pcc_fee}
                      onSave={(v) => updateRowField(r.id, "pcc_fee", v === "" ? null : parseFloat(v))}
                    />
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <EditableCell type="number" width="w-20" value={r.agency_fee} onSave={(v) => updateRowField(r.id, "agency_fee", v === "" ? null : parseFloat(v))} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`font-semibold ${profitOf(r) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    ₹{profitOf(r).toLocaleString("en-IN")}
                  </span>
                </td>
                <td className="px-4 py-3">
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
                <td className="px-4 py-3">
                  <EditableCell width="w-24" value={r.ll_dl_no} onSave={(v) => updateRowField(r.id, "ll_dl_no", v || null)} placeholder="LL/DL No." />
                </td>
                <td className="px-4 py-3">
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
                          className="text-slate-400 hover:text-blue-600 text-xs shrink-0"
                        >
                          ⟳
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <EditableSelect
                    width="w-32"
                    value={r.rto_id}
                    options={rtoList}
                    placeholder="Select RTO"
                    onSave={(v) => updateRowField(r.id, "rto_id", v || null)}
                  />
                </td>
                <td className="px-4 py-3">
                  <EditableSelect
                    width="w-32"
                    value={r.agency_id}
                    options={agencyList}
                    placeholder="Select Agency"
                    onSave={(v) => updateRowField(r.id, "agency_id", v || null)}
                  />
                </td>
                <td className="px-4 py-3">
                  <EditableCell width="w-28" value={r.slot_time} onSave={(v) => updateRowField(r.id, "slot_time", v || null)} placeholder="e.g. 15-07 11AM" />
                </td>
                <td className="px-4 py-3">
                  <EditableCell width="w-28" value={r.mobile} onSave={(v) => updateRowField(r.id, "mobile", v || null)} />
                </td>
                <td className="px-4 py-3">
                  <EditableCell width="w-36" value={r.remarks} onSave={(v) => updateRowField(r.id, "remarks", v || null)} />
                </td>
                <td className="px-4 py-3">
                  <EditableCell
                    width="w-24"
                    value={r.application_date ? isoToDDMMYYYY(r.application_date) : ""}
                    placeholder="DD-MM-YYYY"
                    onSave={(v) => updateRowField(r.id, "application_date", ddmmyyyyToISO(v) || null)}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openDetail(r, "status")}
                      title="Assign staff, update status, view history"
                      className="hover:opacity-80"
                    >
                      <StatusBadge status={r.status} />
                    </button>
                    {r.status !== "Accepted" && r.status !== "Completed" && (
                      <button
                        onClick={() => quickApprove(r)}
                        title="Approve — debits the application amount to the dealer's ledger"
                        className="px-2 py-0.5 rounded-full text-xs font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                      >
                        Approve
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={20} className="text-center text-slate-400 py-10">No applications match your search / filters</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {selected && (
        <ApplicationDetailModal
          app={selected}
          mode={modalMode}
          staffList={staffList}
          onClose={closeDetail}
          onStatusChange={updateStatus}
          onAssign={assignStaff}
          onSaveAnswers={updateAnswers}
          onSaveApplicant={updateApplicantDetails}
          onDocsChanged={() => openDetail(selected, modalMode)}
        />
      )}

      {showNew && (
        <NewApplicationModal
          dealerList={dealerList}
          serviceList={serviceList}
          onClose={() => setShowNew(false)}
          onCreate={createApplication}
        />
      )}

      {pccCheckRow && (
        <PCCStatusCheckModal row={pccCheckRow} onClose={() => setPccCheckRow(null)} />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
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
      <p className="text-xs text-slate-500 mb-4">
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
          <Select value={form.service_id} onChange={set("service_id")}>
            <option value="">Select Service</option>
            {serviceList.map((s) => <option key={s.id} value={s.id}>{serviceLabel(s)}</option>)}
          </Select>
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
            <option>Draft Submitted</option>
            <option>Under Review</option>
            <option>Accepted</option>
          </Select>
        </Field>
      </div>

      <Field label="Address">
        <Input value={form.address} onChange={set("address")} />
      </Field>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Additional Details <span className="text-slate-400 font-normal">(Learner No, PCC No, Application No, etc.)</span>
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

function ApplicationDetailModal({ app, mode = "customer", staffList, onClose, onStatusChange, onAssign, onSaveAnswers, onSaveApplicant, onDocsChanged }) {
  const [remarks, setRemarks] = useState(app.remarks || "");
  const [staffId, setStaffId] = useState(app.assigned_staff_id || "");
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
          <span className="text-sm text-slate-500">Current status:</span>
          <StatusBadge status={app.status} />
          {app.application_date && (
            <span className="text-xs text-slate-400 ml-2">
              Accepted on {isoToDDMMYYYY(app.application_date)}
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
                  title="Debits the application amount to the dealer's ledger"
                >
                  Approve
                </PrimaryButton>
                <DangerButton onClick={() => onStatusChange("Rejected", remarks)}>Reject</DangerButton>
              </div>
            </Card>
          </div>

          <div>
            <Card title="Application History">
              {(app.history || []).length === 0 && <p className="text-sm text-slate-400">No history yet</p>}
              {(app.history || []).map((h) => (
                <div key={h.id} className="text-xs text-slate-500 py-1.5 border-b border-slate-100 last:border-0">
                  <span className="font-semibold text-slate-700">{h.status}</span> — {new Date(h.changed_at).toLocaleString()}
                  {h.remarks && <div className="text-slate-400 mt-0.5">{h.remarks}</div>}
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
    <Modal title={`Application — ${app.draft_code}`} onClose={onClose} wide>
      <div className="max-w-2xl">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 mb-4 -mt-1">
          <span><span className="font-semibold text-slate-600">Dealer:</span> {dealerLabel(app.dealers) || "—"}</span>
          <span><span className="font-semibold text-slate-600">Service:</span> {serviceLabel(app.services) || "—"}</span>
        </div>
        <Card title="Applicant Details" className="mb-4">
          <Field label="Name"><Input value={applicant.applicant_name} onChange={setApplicantField("applicant_name")} /></Field>
          <Field label="Father/Husband"><Input value={applicant.father_husband_name} onChange={setApplicantField("father_husband_name")} /></Field>
          <Field label="DOB"><Input type="text" placeholder="DD-MM-YYYY" value={applicant.date_of_birth} onChange={setApplicantField("date_of_birth")} /></Field>
          <Field label="Mobile"><Input value={applicant.mobile} onChange={setApplicantField("mobile")} /></Field>
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
          {(app.docs || []).length === 0 && <p className="text-sm text-slate-400">No documents uploaded</p>}
          {(app.docs || []).map((d) => (
            <DocumentRow key={d.id} doc={d} onChanged={onDocsChanged} />
          ))}
        </Card>
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
    <div className="py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700">{doc.name}</span>
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
