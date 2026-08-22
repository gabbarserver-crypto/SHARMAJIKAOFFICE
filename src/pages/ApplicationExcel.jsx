import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Filter, RefreshCw, Search, X } from "lucide-react";

const PAGE_SIZE = 50;

function dealerLabel(d) { return d?.short_name || d?.name || ""; }
function serviceLabel(s) { return s?.short_name || s?.parent_service || ""; }
function ddmmyyyy(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso);
}
function valueKey(value) {
  return value === null || value === undefined || value === "" ? "__BLANK__" : String(value);
}
function displayValue(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

const COLUMNS = [
  { key: "draftId", label: "Draft ID", get: r => r.draft_code },
  { key: "applicationDate", label: "Date", date: true, get: r => r.application_date || r.submitted_at },
  { key: "amount", label: "Amount", number: true, get: r => r.amount },
  { key: "dealer", label: "Dealer", get: r => dealerLabel(r.dealers) },
  { key: "service", label: "Service", get: r => serviceLabel(r.services) },
  { key: "applicant", label: "Applicant", get: r => r.applicant_name },
  { key: "dob", label: "DOB", date: true, get: r => r.date_of_birth },
  { key: "rtoFee", label: "Fee", number: true, get: r => r.rto_fee },
  { key: "pccFee", label: "PCC Fee", number: true, get: r => r.pcc_fee },
  { key: "agencyFee", label: "Agency Fee", number: true, get: r => r.agency_fee },
  { key: "application", label: "Application", get: r => r.application_no },
  { key: "lldl", label: "LL/DL No.", get: r => r.ll_dl_no },
  { key: "pccno", label: "PCC No", get: r => r.pcc_no },
  { key: "rto", label: "RTO", get: (r, lookups) => r.services?.pcc_required && !r.pcc_not_required ? "PCC" : (lookups.rto[r.rto_id] || "") },
  { key: "agency", label: "Agency", get: (r, lookups) => lookups.agency[r.agency_id] || "" },
  { key: "slot", label: "Slot", get: r => r.slot_time },
  { key: "mobile", label: "Mobile", get: r => r.mobile },
  { key: "remark", label: "Remark", get: r => r.remarks },
  { key: "status", label: "Status", get: r => r.status },
];

function ExcelHeader({ column, filter, setFilter, sortKey, sortDir, onSort, options }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const activeFilter = Array.isArray(filter) || (filter && (filter.from || filter.to));
  const visible = options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const sort = dir => {
    if (sortKey !== column.key) { onSort(column.key); if (dir === "desc") onSort(column.key); }
    else if (sortDir !== dir) onSort(column.key);
    setOpen(false);
  };
  const clear = () => { setFilter(undefined); setSearch(""); };
  const selectAll = () => setFilter(options.map(o => o.key));
  const toggle = key => {
    const current = Array.isArray(filter) ? filter : options.map(o => o.key);
    const next = current.includes(key) ? current.filter(x => x !== key) : [...current, key];
    setFilter(next);
  };

  return (
    <th ref={ref} className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-2 py-2 text-left whitespace-nowrap text-xs font-semibold text-slate-600 dark:text-slate-300">
      <div className="flex items-center gap-1">
        <span className={sortKey === column.key ? "text-blue-600 dark:text-blue-400" : ""}>{column.label}</span>
        <button onClick={() => setOpen(v => !v)} className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${activeFilter ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`} title="Sort / Filter">
          <ChevronDown size={13} />
        </button>
        {sortKey === column.key && (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
        {activeFilter && <Filter size={10} className="text-blue-600" />}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-2 text-xs font-normal text-slate-700 dark:text-slate-200">
          <div className="grid grid-cols-2 gap-1 mb-2">
            <button onClick={() => sort("asc")} className="rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800">↑ Sort A to Z</button>
            <button onClick={() => sort("desc")} className="rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800">↓ Sort Z to A</button>
          </div>
          {column.date && (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-2 mb-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Date filter</div>
              <div className="grid grid-cols-2 gap-1">
                <input type="date" value={filter?.from || ""} onChange={e => setFilter({ ...(filter && !Array.isArray(filter) ? filter : {}), from: e.target.value })} className="w-full rounded border px-1.5 py-1 bg-white dark:bg-slate-950" />
                <input type="date" value={filter?.to || ""} onChange={e => setFilter({ ...(filter && !Array.isArray(filter) ? filter : {}), to: e.target.value })} className="w-full rounded border px-1.5 py-1 bg-white dark:bg-slate-950" />
              </div>
            </div>
          )}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
            <div className="flex items-center gap-1 mb-2">
              <Search size={13} className="text-slate-400" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search values" className="min-w-0 flex-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5 bg-white dark:bg-slate-950 outline-none" />
            </div>
            <div className="flex gap-1 mb-1">
              <button onClick={selectAll} className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Select All</button>
              <button onClick={() => setFilter(["__BLANK__"])} className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Blanks</button>
              {activeFilter && <button onClick={clear} className="ml-auto px-2 py-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30">Clear</button>}
            </div>
            <div className="max-h-56 overflow-y-auto border-t border-slate-100 dark:border-slate-800 pt-1">
              {visible.map(o => {
                const checked = Array.isArray(filter) ? filter.includes(o.key) : true;
                return <label key={o.key} className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"><input type="checkbox" checked={checked} onChange={() => toggle(o.key)} /><span className="truncate">{o.label}</span></label>;
              })}
              {!visible.length && <div className="p-2 text-slate-400">No values found</div>}
            </div>
          </div>
        </div>
      )}
    </th>
  );
}

export default function ApplicationExcel({ isAdmin = false }) {
  const [rows, setRows] = useState([]);
  const [rto, setRto] = useState({});
  const [agency, setAgency] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [sortKey, setSortKey] = useState("applicationDate");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);

  const load = async () => {
    if (!isAdmin) return;
    setLoading(true); setError("");
    try {
      const [rtoRes, agencyRes] = await Promise.all([
        supabase.from("rtos").select("id,name"),
        supabase.from("agencies").select("id,name"),
      ]);
      const rtoMap = {}; (rtoRes.data || []).forEach(x => { rtoMap[x.id] = x.name; });
      const agencyMap = {}; (agencyRes.data || []).forEach(x => { agencyMap[x.id] = x.name; });
      setRto(rtoMap); setAgency(agencyMap);

      const all = [];
      const chunk = 1000;
      for (let from = 0; ; from += chunk) {
        const { data, error: qErr } = await supabase
          .from("applications")
          .select("id,draft_code,application_date,submitted_at,amount,applicant_name,date_of_birth,rto_fee,pcc_fee,agency_fee,application_no,ll_dl_no,pcc_no,rto_id,agency_id,slot_time,mobile,remarks,status,pcc_not_required,dealers(name,short_name),services(parent_service,short_name,pcc_required)")
          .order("submitted_at", { ascending: false })
          .range(from, from + chunk - 1);
        if (qErr) throw qErr;
        all.push(...(data || []));
        if (!data || data.length < chunk) break;
      }
      setRows(all);
    } catch (e) {
      setError(e?.message || "Couldn't load applications");
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [isAdmin]);
  useEffect(() => { setPage(1); }, [globalSearch, filters, sortKey, sortDir]);

  const columnValues = useMemo(() => {
    const out = {};
    for (const c of COLUMNS) {
      const seen = new Map();
      for (const row of rows) {
        const raw = c.get(row, { rto, agency });
        const key = valueKey(raw);
        if (!seen.has(key)) seen.set(key, raw === "" || raw == null ? "(Blanks)" : c.date ? ddmmyyyy(raw) : String(raw));
      }
      out[c.key] = [...seen.entries()].sort((a,b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: "base" })).map(([key,label]) => ({ key, label }));
    }
    return out;
  }, [rows, rto, agency]);

  const filtered = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    const result = rows.filter(row => {
      if (q) {
        const hay = COLUMNS.map(c => displayValue(c.get(row, { rto, agency }))).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return Object.entries(filters).every(([key, filter]) => {
        if (!filter) return true;
        const c = COLUMNS.find(x => x.key === key); if (!c) return true;
        const raw = c.get(row, { rto, agency });
        if (!Array.isArray(filter) && (filter.from || filter.to)) {
          const d = raw ? String(raw).slice(0, 10) : "";
          if (filter.from && (!d || d < filter.from)) return false;
          if (filter.to && (!d || d > filter.to)) return false;
          return true;
        }
        return Array.isArray(filter) ? filter.includes(valueKey(raw)) : true;
      });
    });
    const c = COLUMNS.find(x => x.key === sortKey);
    if (!c) return result;
    return [...result].sort((a,b) => {
      let av = c.get(a, { rto, agency }); let bv = c.get(b, { rto, agency });
      if (c.number) { av = Number(av || 0); bv = Number(bv || 0); }
      else { av = displayValue(av).toLowerCase(); bv = displayValue(bv).toLowerCase(); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, filters, globalSearch, sortKey, sortDir, rto, agency]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const toggleSort = key => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Application Excel</h1>
          <p className="text-sm text-slate-500 mt-1">Excel-style application sheet — filters and sorting stay inside the admin panel.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search all columns" className="w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-8 py-2 text-sm outline-none" />
            {globalSearch && <button onClick={() => setGlobalSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} /></button>}
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-500">
          <span>{loading ? "Loading applications…" : `${filtered.length.toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")} applications`}</span>
          <span>50 rows/page · Click ▼ in any header for Excel-style sort/filter</span>
        </div>
        <div className="overflow-auto max-h-[calc(100vh-235px)]">
          <table className="min-w-[1800px] w-full text-xs border-collapse">
            <thead>
              <tr>{COLUMNS.map(c => <ExcelHeader key={c.key} column={c} filter={filters[c.key]} setFilter={v => setFilters(prev => { const n = { ...prev }; if (v === undefined) delete n[c.key]; else n[c.key] = v; return n; })} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} options={columnValues[c.key] || []} />)}</tr>
            </thead>
            <tbody>
              {pageRows.map(row => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-blue-50/40 dark:hover:bg-slate-800/50">
                  {COLUMNS.map(c => {
                    const raw = c.get(row, { rto, agency });
                    return <td key={c.key} className="px-2 py-2 border-r border-slate-100 dark:border-slate-800 whitespace-nowrap text-slate-700 dark:text-slate-300">{c.date ? ddmmyyyy(raw) : c.number && raw != null && raw !== "" ? Number(raw).toLocaleString("en-IN") : displayValue(raw)}</td>;
                  })}
                </tr>
              ))}
              {!loading && pageRows.length === 0 && <tr><td colSpan={COLUMNS.length} className="py-12 text-center text-slate-400">No applications match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-xs">
          <span className="text-slate-500">Page {page} of {pages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded border disabled:opacity-40">Previous</button>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded border disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
