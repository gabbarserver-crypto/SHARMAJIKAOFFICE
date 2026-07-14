// src/pages/Masters.jsx
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, Input, Select, PrimaryButton, GhostButton, Modal, Toast } from "../components/UI";

const TABS = ["RTO", "Staff", "Service", "Dealer", "Agency"];

export default function Masters() {
  const [tab, setTab] = useState("RTO");
  const [toast, setToast] = useState(null);

  const notify = (msg) => setToast(msg);

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-800 mb-4">Masters</h2>
      <div className="flex gap-2 mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
              tab === t ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "RTO" && <RTOMaster notify={notify} />}
      {tab === "Staff" && <StaffMaster notify={notify} />}
      {tab === "Service" && <ServiceMaster notify={notify} />}
      {tab === "Dealer" && <DealerMaster notify={notify} />}
      {tab === "Agency" && <AgencyMaster notify={notify} />}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

/* ---------------- Generic list table ---------------- */
function ListTable({ rows, columns, onEdit, onDelete, onAdd, addLabel }) {
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryButton onClick={onAdd}>{addLabel}</PrimaryButton>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {columns.map((c) => <th key={c.key} className="text-left font-medium px-4 py-3">{c.label}</th>)}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                {columns.map((c) => <td key={c.key} className="px-4 py-3 text-slate-700">{c.render ? c.render(r) : r[c.key]}</td>)}
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <GhostButton onClick={() => onEdit(r)} className="mr-2">Edit</GhostButton>
                  <GhostButton onClick={() => onDelete(r)} className="!text-rose-500">Delete</GhostButton>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={columns.length + 1} className="text-center text-slate-400 py-8">No records yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- RTO Master ---------------- */
function RTOMaster({ notify }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("rtos").select("*").order("name");
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    const payload = { name: form.name, code: form.code, type: form.type, address: form.address, phone: form.phone, slot_booking: form.slot_booking, status: form.status };
    const { error } = editing
      ? await supabase.from("rtos").update(payload).eq("id", editing.id)
      : await supabase.from("rtos").insert(payload);
    if (error) { notify("Failed: " + error.message); return; }
    notify("RTO saved");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (row) => {
    if (!confirm(`Delete ${row.name}?`)) return;
    await supabase.from("rtos").delete().eq("id", row.id);
    notify("Deleted"); load();
  };

  return (
    <>
      <ListTable
        rows={rows}
        columns={[
          { key: "name", label: "RTO Name" }, { key: "code", label: "Code" },
          { key: "type", label: "Type" }, { key: "status", label: "Status" },
        ]}
        onAdd={() => { setEditing(null); setOpen(true); }}
        onEdit={(r) => { setEditing(r); setOpen(true); }}
        onDelete={remove}
        addLabel="Add RTO"
      />
      {open && <RTOForm initial={editing} onSave={save} onClose={() => setOpen(false)} />}
    </>
  );
}

function RTOForm({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial || { name: "", code: "", type: "RTO Office", address: "", phone: "", slot_booking: true, status: "Active" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal title={initial ? "Edit RTO" : "Create New RTO"} onClose={onClose}>
      <Field label="RTO Name" required><Input value={f.name} onChange={set("name")} /></Field>
      <Field label="RTO Code" required><Input value={f.code} onChange={set("code")} /></Field>
      <Field label="Type">
        <Select value={f.type} onChange={set("type")}>
          <option>RTO Office</option><option>Track / Test Center</option><option>Sub-Regional Office</option>
        </Select>
      </Field>
      <Field label="Address"><Input value={f.address} onChange={set("address")} /></Field>
      <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Status">
        <Select value={f.status} onChange={set("status")}><option>Active</option><option>Inactive</option></Select>
      </Field>
      <PrimaryButton onClick={() => onSave(f)}>Save RTO</PrimaryButton>
    </Modal>
  );
}

/* ---------------- Staff Master ---------------- */
function StaffMaster({ notify }) {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("staff").select("*, roles(role_name)").order("full_name");
    setRows(data || []);
    const { data: r } = await supabase.from("roles").select("*");
    setRoles(r || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    const payload = {
      full_name: form.full_name, role: form.role, role_id: form.role_id || null, mobile: form.mobile,
      email: form.email, joining_date: form.joining_date || null, username: form.username,
      grant_app_access: form.grant_app_access, allow_ledger_view: form.allow_ledger_view,
    };
    const { error } = editing
      ? await supabase.from("staff").update(payload).eq("id", editing.id)
      : await supabase.from("staff").insert(payload);
    if (error) { notify("Failed: " + error.message); return; }
    notify("Staff saved — link their login separately once they've signed up");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (row) => {
    if (!confirm(`Delete ${row.full_name}?`)) return;
    await supabase.from("staff").delete().eq("id", row.id);
    notify("Deleted"); load();
  };

  return (
    <>
      <ListTable
        rows={rows}
        columns={[
          { key: "full_name", label: "Name" }, { key: "role", label: "Designation" },
          { key: "roles", label: "Permission Role", render: (r) => r.roles?.role_name || "—" },
          { key: "mobile", label: "Mobile" }, { key: "username", label: "Username" },
        ]}
        onAdd={() => { setEditing(null); setOpen(true); }}
        onEdit={(r) => { setEditing(r); setOpen(true); }}
        onDelete={remove}
        addLabel="Add Staff"
      />
      {open && <StaffForm initial={editing} roles={roles} onSave={save} onClose={() => setOpen(false)} />}
    </>
  );
}

function StaffForm({ initial, roles, onSave, onClose }) {
  const [f, setF] = useState(initial || {
    full_name: "", role: "", role_id: "", mobile: "", email: "", joining_date: "",
    username: "", grant_app_access: true, allow_ledger_view: true,
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const [linkEmail, setLinkEmail] = useState("");

  const linkAccount = async () => {
    if (!initial?.id || !linkEmail) return;
    const { error } = await supabase.rpc("link_staff_account", { p_staff_id: initial.id, p_email: linkEmail });
    alert(error ? "Failed: " + error.message : "Account linked");
  };

  return (
    <Modal title={initial ? "Edit Staff" : "Create New Staff"} onClose={onClose}>
      <Field label="Full Name" required><Input value={f.full_name} onChange={set("full_name")} /></Field>
      <Field label="Designation"><Input value={f.role} onChange={set("role")} placeholder="e.g. Manager" /></Field>
      <Field label="Permission Role">
        <Select value={f.role_id} onChange={set("role_id")}>
          <option value="">— None —</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.role_name}</option>)}
        </Select>
      </Field>
      <Field label="Mobile"><Input value={f.mobile} onChange={set("mobile")} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Joining Date"><Input type="date" value={f.joining_date || ""} onChange={set("joining_date")} /></Field>
      <Field label="Username"><Input value={f.username} onChange={set("username")} /></Field>
      <PrimaryButton onClick={() => onSave(f)}>Save Staff</PrimaryButton>

      {initial && (
        <div className="mt-5 pt-4 border-t border-slate-200">
          <p className="text-xs text-slate-500 mb-2">
            Link this profile to a Supabase Auth login (they must have signed up first, e.g. via a Dashboard invite).
          </p>
          <div className="flex gap-2">
            <Input placeholder="their-login@email.com" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} />
            <GhostButton onClick={linkAccount}>Link</GhostButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Service Master ---------------- */
function ServiceMaster({ notify }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("services").select("*").order("parent_service");
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form, documents, steps) => {
    const payload = {
      parent_service: form.parent_service, sub_service: form.sub_service, short_name: form.short_name,
      pcc_required: form.pcc_required, slot_booking_required: form.slot_booking_required,
      test_rto_required: form.test_rto_required, previous_ll_required: form.previous_ll_required,
      otp_required: form.otp_required, chat_in_app: form.chat_in_app, allow_draft: form.allow_draft,
      gov_fee: parseFloat(form.gov_fee) || 0, processing_charges: parseFloat(form.processing_charges) || 0,
      other_charges: parseFloat(form.other_charges) || 0, pcc_fee: parseFloat(form.pcc_fee) || 0,
      post_timing: form.post_timing,
    };
    let serviceId = editing?.id;
    if (editing) {
      const { error } = await supabase.from("services").update(payload).eq("id", editing.id);
      if (error) { notify("Failed: " + error.message); return; }
    } else {
      const { data, error } = await supabase.from("services").insert(payload).select().single();
      if (error) { notify("Failed: " + error.message); return; }
      serviceId = data.id;
    }

    await supabase.from("service_documents").delete().eq("service_id", serviceId);
    if (documents.length) {
      await supabase.from("service_documents").insert(documents.map((d) => ({ service_id: serviceId, name: d.name, mandatory: d.mandatory })));
    }

    await supabase.from("service_workflow_steps").delete().eq("service_id", serviceId);
    if (steps.length) {
      await supabase.from("service_workflow_steps").insert(
        steps.map((s, i) => ({ service_id: serviceId, step_order: i + 1, step_name: s, is_terminal: i === steps.length - 1 }))
      );
    }

    notify("Service saved");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (row) => {
    if (!confirm(`Delete ${row.parent_service} (${row.sub_service})?`)) return;
    await supabase.from("services").delete().eq("id", row.id);
    notify("Deleted"); load();
  };

  return (
    <>
      <ListTable
        rows={rows}
        columns={[
          { key: "parent_service", label: "Parent Service" }, { key: "sub_service", label: "Sub Service" },
          { key: "short_name", label: "Short Name" },
          { key: "total", label: "Total Fee", render: (r) => `₹${(Number(r.gov_fee||0)+Number(r.processing_charges||0)+Number(r.other_charges||0)).toLocaleString("en-IN")}` },
        ]}
        onAdd={() => { setEditing(null); setOpen(true); }}
        onEdit={(r) => { setEditing(r); setOpen(true); }}
        onDelete={remove}
        addLabel="Add Service"
      />
      {open && <ServiceForm initial={editing} onSave={save} onClose={() => setOpen(false)} />}
    </>
  );
}

function ServiceForm({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial || {
    parent_service: "", sub_service: "", short_name: "", pcc_required: true, slot_booking_required: true,
    test_rto_required: false, previous_ll_required: false, otp_required: false, chat_in_app: false, allow_draft: false,
    gov_fee: "", processing_charges: "", other_charges: "", pcc_fee: "", post_timing: "After Approval",
  });
  const [documents, setDocuments] = useState([{ name: "Aadhaar Card", mandatory: true }, { name: "Photo", mandatory: true }, { name: "Signature", mandatory: true }]);
  const [steps, setSteps] = useState(["Submitted", "Documents Check", "Fee Paid", "Approved", "Completed"]);
  const [newDoc, setNewDoc] = useState("");
  const [newStep, setNewStep] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.checked }));

  useEffect(() => {
    if (initial?.id) {
      (async () => {
        const { data: docs } = await supabase.from("service_documents").select("*").eq("service_id", initial.id);
        if (docs?.length) setDocuments(docs.map((d) => ({ name: d.name, mandatory: d.mandatory })));
        const { data: st } = await supabase.from("service_workflow_steps").select("*").eq("service_id", initial.id).order("step_order");
        if (st?.length) setSteps(st.map((s) => s.step_name));
      })();
    }
  }, [initial]);

  return (
    <Modal title={initial ? "Edit Service" : "Create New Service"} onClose={onClose} wide>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <Card title="Basic Information" className="mb-4">
            <Field label="Parent Service" required><Input value={f.parent_service} onChange={set("parent_service")} /></Field>
            <Field label="Sub Service" required><Input value={f.sub_service} onChange={set("sub_service")} /></Field>
            <Field label="Short Name"><Input value={f.short_name} onChange={set("short_name")} /></Field>
          </Card>
          <Card title="Fees">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Govt Fee (₹)"><Input type="number" value={f.gov_fee} onChange={set("gov_fee")} /></Field>
              <Field label="Processing (₹)"><Input type="number" value={f.processing_charges} onChange={set("processing_charges")} /></Field>
              <Field label="Other (₹)"><Input type="number" value={f.other_charges} onChange={set("other_charges")} /></Field>
            </div>
            {f.pcc_required && (
              <Field label="PCC Fee (₹)">
                <Input type="number" value={f.pcc_fee} onChange={set("pcc_fee")} placeholder="Fee charged for Police Clearance Certificate" />
              </Field>
            )}
          </Card>
        </div>

        <div>
          <Card title="Workflow Rules" className="mb-4">
            {[["pcc_required","PCC Required"],["slot_booking_required","Slot Booking Required"],["test_rto_required","Test RTO Required"],["previous_ll_required","Previous LL Required"],["otp_required","OTP Verification"],["chat_in_app","Chat in Application"],["allow_draft","Allow Draft"]].map(([k,label]) => (
              <label key={k} className="flex items-center justify-between text-sm text-slate-600 py-1">
                {label}<input type="checkbox" checked={f[k]} onChange={toggle(k)} className="w-4 h-4 accent-blue-600" />
              </label>
            ))}
          </Card>

          <Card title="Required Documents" className="mb-4">
            {documents.map((d, i) => (
              <div key={i} className="flex justify-between text-sm py-1">
                <span>{d.name}</span>
                <button onClick={() => setDocuments(documents.filter((_, idx) => idx !== i))} className="text-rose-500 text-xs">Remove</button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <Input value={newDoc} onChange={(e) => setNewDoc(e.target.value)} placeholder="Document name" />
              <GhostButton onClick={() => { if (newDoc.trim()) { setDocuments([...documents, { name: newDoc.trim(), mandatory: true }]); setNewDoc(""); } }}>Add</GhostButton>
            </div>
          </Card>

          <Card title="Workflow Steps (in order)">
            {steps.map((s, i) => (
              <div key={i} className="flex justify-between text-sm py-1">
                <span>{i + 1}. {s}</span>
                <button onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} className="text-rose-500 text-xs">Remove</button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <Input value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Step name" />
              <GhostButton onClick={() => { if (newStep.trim()) { setSteps([...steps, newStep.trim()]); setNewStep(""); } }}>Add Step</GhostButton>
            </div>
          </Card>
        </div>
      </div>
      <div className="mt-5">
        <PrimaryButton onClick={() => onSave(f, documents, steps)}>Save Service</PrimaryButton>
      </div>
    </Modal>
  );
}

/* ---------------- Dealer Master ---------------- */
function DealerMaster({ notify }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("dealers").select("*").order("name");
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    const payload = {
      name: form.name, code: form.code, short_name: form.short_name || null, contact_name: form.contact_name, mobile: form.mobile, email: form.email,
      address: form.address, city: form.city, state: form.state, pincode: form.pincode,
      credit_limit: parseFloat(form.credit_limit) || 0,
    };
    const { error } = editing
      ? await supabase.from("dealers").update(payload).eq("id", editing.id)
      : await supabase.from("dealers").insert(payload);
    if (error) { notify("Failed: " + error.message); return; }
    notify("Dealer saved");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (row) => {
    if (!confirm(`Delete ${row.name}?`)) return;
    await supabase.from("dealers").delete().eq("id", row.id);
    notify("Deleted"); load();
  };

  return (
    <>
      <ListTable
        rows={rows}
        columns={[
          { key: "name", label: "Dealer Name" }, { key: "short_name", label: "Short Name", render: (r) => r.short_name || "—" }, { key: "code", label: "Code" }, { key: "contact_name", label: "Contact" },
          { key: "wallet_balance", label: "Wallet", render: (r) => `₹${Number(r.wallet_balance||0).toLocaleString("en-IN")}` },
          { key: "credit_limit", label: "Credit Limit", render: (r) => `₹${Number(r.credit_limit||0).toLocaleString("en-IN")}` },
        ]}
        onAdd={() => { setEditing(null); setOpen(true); }}
        onEdit={(r) => { setEditing(r); setOpen(true); }}
        onDelete={remove}
        addLabel="Add Dealer"
      />
      {open && <DealerForm initial={editing} onSave={save} onClose={() => setOpen(false)} />}
    </>
  );
}

function DealerForm({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial || { name: "", code: "", short_name: "", contact_name: "", mobile: "", email: "", address: "", city: "", state: "", pincode: "", credit_limit: "" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal title={initial ? "Edit Dealer" : "Create New Dealer"} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Dealer Name" required><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Dealer Code" required><Input value={f.code} onChange={set("code")} /></Field>
        <Field label="Short Name"><Input value={f.short_name} onChange={set("short_name")} placeholder="Shown in Applications list" /></Field>
        <Field label="Contact Name"><Input value={f.contact_name} onChange={set("contact_name")} /></Field>
        <Field label="Mobile"><Input value={f.mobile} onChange={set("mobile")} /></Field>
      </div>
      <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Address"><Input value={f.address} onChange={set("address")} /></Field>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Input value={f.city} onChange={set("city")} placeholder="City" />
        <Input value={f.state} onChange={set("state")} placeholder="State" />
        <Input value={f.pincode} onChange={set("pincode")} placeholder="Pincode" />
      </div>
      <Field label="Credit Limit (₹)"><Input type="number" value={f.credit_limit} onChange={set("credit_limit")} /></Field>
      <PrimaryButton onClick={() => onSave(f)}>Save Dealer</PrimaryButton>
    </Modal>
  );
}

/* ---------------- Agency Master ---------------- */
function AgencyMaster({ notify }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("agencies").select("*").order("name");
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    const payload = {
      name: form.name, code: form.code, contact_person: form.contact_person, mobile: form.mobile, status: form.status,
      opening_balance: parseFloat(form.opening_balance) || 0, default_processing_charges: parseFloat(form.default_processing_charges) || 0,
      payment_terms: form.payment_terms,
    };
    const { error } = editing
      ? await supabase.from("agencies").update(payload).eq("id", editing.id)
      : await supabase.from("agencies").insert(payload);
    if (error) { notify("Failed: " + error.message); return; }
    notify("Agency saved");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (row) => {
    if (!confirm(`Delete ${row.name}?`)) return;
    await supabase.from("agencies").delete().eq("id", row.id);
    notify("Deleted"); load();
  };

  return (
    <>
      <ListTable
        rows={rows}
        columns={[
          { key: "name", label: "Agency Name" }, { key: "code", label: "Code" },
          { key: "contact_person", label: "Contact Person" }, { key: "status", label: "Status" },
        ]}
        onAdd={() => { setEditing(null); setOpen(true); }}
        onEdit={(r) => { setEditing(r); setOpen(true); }}
        onDelete={remove}
        addLabel="Add Agency"
      />
      {open && <AgencyForm initial={editing} onSave={save} onClose={() => setOpen(false)} />}
    </>
  );
}

function AgencyForm({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial || { name: "", code: "", contact_person: "", mobile: "", status: "Active", opening_balance: "", default_processing_charges: "", payment_terms: "7 Days" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal title={initial ? "Edit Agency" : "Create New Agency"} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Agency Name" required><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Agency Code" required><Input value={f.code} onChange={set("code")} /></Field>
        <Field label="Contact Person"><Input value={f.contact_person} onChange={set("contact_person")} /></Field>
        <Field label="Mobile"><Input value={f.mobile} onChange={set("mobile")} /></Field>
      </div>
      <Field label="Status">
        <Select value={f.status} onChange={set("status")}><option>Active</option><option>Inactive</option></Select>
      </Field>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Opening Balance (₹)"><Input type="number" value={f.opening_balance} onChange={set("opening_balance")} /></Field>
        <Field label="Default Processing Charges (₹)"><Input type="number" value={f.default_processing_charges} onChange={set("default_processing_charges")} /></Field>
      </div>
      <Field label="Payment Terms">
        <Select value={f.payment_terms} onChange={set("payment_terms")}>
          <option>7 Days</option><option>15 Days</option><option>30 Days</option><option>Immediate</option>
        </Select>
      </Field>
      <PrimaryButton onClick={() => onSave(f)}>Save Agency</PrimaryButton>
    </Modal>
  );
}
