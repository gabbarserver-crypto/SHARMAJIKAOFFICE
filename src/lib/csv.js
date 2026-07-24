// Minimal CSV parser — handles quoted fields (including embedded commas/
// newlines and "" escaped quotes) without pulling in an extra dependency.
// Returns an array of row objects keyed by the (trimmed) header row.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  // Normalize line endings, then walk character by character.
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") { pushField(); pushRow(); }
    else field += c;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  const nonEmptyRows = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!nonEmptyRows.length) return [];
  const headers = nonEmptyRows[0].map((h) => h.trim());
  return nonEmptyRows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
    return obj;
  });
}

// Looks a free-text CSV value up against a master list by name/short
// name/code, case-insensitively — used to resolve "Dealer", "Service",
// "RTO", "Agency" columns to their real IDs during import.
export function findByLabel(list, value, fields) {
  if (!value) return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return list.find((item) => fields.some((f) => item[f] && String(item[f]).trim().toLowerCase() === needle)) || null;
}

// Parses "DD-MM-YYYY" / "DD/MM/YYYY" (and passes already-ISO "YYYY-MM-DD"
// straight through) into an ISO date string. Used when a CSV import should
// backdate a record (e.g. a ledger entry) to the row's own date instead of
// defaulting to "now" at import time.
export function ddmmyyyyToISO(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const m = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed; // already ISO
  return null;
}
