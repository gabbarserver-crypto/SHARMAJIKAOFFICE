// src/pages/Applications.jsx
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { Card, StatusBadge, PrimaryButton, GhostButton, DangerButton, Field, Input, Select, Modal, Toast } from "../components/UI";

const STATUS_TABS = ["All", "Draft Submitted", "Under Review", "On Hold", "Rejected", "Accepted", "Completed"];

export default function Applications() {
  const [tab, setTab] = useState("All");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [dealerList, setDealerList] = useState([]);
  const [serviceList, setServiceList] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("applications")
      .select("*, dealers(name,code), services(parent_service,sub_service), staff:assigned_staff_id(full_name)")
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
      const { data: d } = await supabase.from("dealers").select("id, name, code").order("name");
      setDealerList(d || []);
      const { data: sv } = await supabase.from("services").select("id, parent_service, sub_service").order("parent_service");
      setServiceList(sv || []);
    })();
  }, []);

  const openDetail = async (row) => {
    const { data: docs } = await supabase.from("application_documents").select("*").eq("application_id", row.id);
    const { data: history } = await supabase
      .from("application_status_history")
      .select("*")
      .eq("application_id", row.id)
      .order("changed_at", { ascending: false });
    setSelected({ ...row, docs, history });
  };

  const updateStatus = async (newStatus, remarks) => {
    const { error } = await supabase
      .from("applications")
      .update({ status: newStatus, remarks })
      .eq("id", selected.id);
    if (error) {
      setToast("Failed: " + error.message);
      return;
    }
    setToast(`Marked as ${newStatus}`);
    setSelected(null);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Applications</h2>
          <p className="text-sm text-slate-400">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <PrimaryButton onClick={() => setShowNew(true)}>+ New Application</PrimaryButton>
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left font-medium px-4 py-3">Draft ID</th>
              <th className="text-left font-medium px-4 py-3">Dealer</th>
              <th className="text-left font-medium px-4 py-3">Applicant</th>
              <th className="text-left font-medium px-4 py-3">Service</th>
              <th className="text-left font-medium px-4 py-3">Assigned Staff</th>
              <th className="text-left font-medium px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium text-slate-700">{r.draft_code}</td>
                <td className="px-4 py-3 text-slate-600">{r.dealers?.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.applicant_name}</td>
                <td className="px-4 py-3 text-slate-600">{r.services?.parent_service} ({r.services?.sub_service})</td>
                <td className="px-4 py-3 text-slate-500">{r.staff?.full_name || "— Unassigned —"}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-right">
                  <GhostButton onClick={() => openDetail(r)}>Open</GhostButton>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-10">No applications in this status</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <ApplicationDetailModal
          app={selected}
          staffList={staffList}
          onClose={() => setSelected(null)}
          onStatusChange={updateStatus}
          onAssign={assignStaff}
          onDocsChanged={() => openDetail(selected)}
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

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function NewApplicationModal({ dealerList, serviceList, onClose, onCreate }) {
  const [form, setForm] = useState({
    dealer_id: "", service_id: "", applicant_name: "", father_husband_name: "",
    date_of_birth: "", mobile: "", address: "", status: "Draft Submitted",
  });
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const valid = form.dealer_id && form.service_id && form.applicant_name;

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
            {dealerList.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
          </Select>
        </Field>
        <Field label="Service" required>
          <Select value={form.service_id} onChange={set("service_id")}>
            <option value="">Select Service</option>
            {serviceList.map((s) => <option key={s.id} value={s.id}>{s.parent_service} ({s.sub_service})</option>)}
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
          <Input type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
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
      <PrimaryButton disabled={!valid} onClick={() => onCreate(form)}>Create Application</PrimaryButton>
    </Modal>
  );
}

function ApplicationDetailModal({ app, staffList, onClose, onStatusChange, onAssign, onDocsChanged }) {
  const [remarks, setRemarks] = useState(app.remarks || "");
  const [staffId, setStaffId] = useState(app.assigned_staff_id || "");

  return (
    <Modal title={`Application — ${app.draft_code}`} onClose={onClose} wide>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <Card title="Applicant Details" className="mb-4">
            <p className="text-sm"><span className="text-slate-400">Name:</span> {app.applicant_name}</p>
            <p className="text-sm"><span className="text-slate-400">Father/Husband:</span> {app.father_husband_name}</p>
            <p className="text-sm"><span className="text-slate-400">DOB:</span> {app.date_of_birth}</p>
            <p className="text-sm"><span className="text-slate-400">Mobile:</span> {app.mobile}</p>
            <p className="text-sm"><span className="text-slate-400">Address:</span> {app.address}</p>
          </Card>

          <Card title="Service Answers" className="mb-4">
            <pre className="text-xs text-slate-600 whitespace-pre-wrap">{JSON.stringify(app.service_answers, null, 2)}</pre>
          </Card>

          <Card title="Documents">
            {(app.docs || []).length === 0 && <p className="text-sm text-slate-400">No documents uploaded</p>}
            {(app.docs || []).map((d) => (
              <DocumentRow key={d.id} doc={d} onChanged={onDocsChanged} />
            ))}
          </Card>
        </div>

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

          <Card title="Update Status" className="mb-4">
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
              <PrimaryButton onClick={() => onStatusChange("Accepted", remarks)} className="!bg-emerald-600 hover:!bg-emerald-700">
                Accept
              </PrimaryButton>
              <DangerButton onClick={() => onStatusChange("Rejected", remarks)}>Reject</DangerButton>
            </div>
          </Card>

          <Card title="Status History">
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
