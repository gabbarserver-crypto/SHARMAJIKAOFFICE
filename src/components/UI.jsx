// src/components/UI.jsx
import React from "react";

export const colors = {
  navy: "#0f1b3d",
  blue: "#2f6fed",
  green: "#16a34a",
  amber: "#d97706",
  rose: "#e11d48",
  bg: "#f4f6fa",
  border: "#e2e6ee",
  text: "#1a2233",
  muted: "#64748b",
};

export const STATUS_STYLES = {
  "Draft Submitted": "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  "Under Review": "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  "On Hold": "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  Rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  Accepted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  Completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
};

// Stored status values stay as-is everywhere (filters, DB writes, etc.) —
// this only swaps the *displayed* text. "Accepted" is what the Approve
// action writes to the DB, but staff/dealers should see it read as
// "Approved" wherever a status badge is shown.
export const STATUS_DISPLAY_LABELS = {
  Accepted: "Approved",
};

export function StatusBadge({ status }) {
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[status] || "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
      {STATUS_DISPLAY_LABELS[status] || status}
    </span>
  );
}

export function Card({ title, children, className = "" }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 ${className}`}>
      {title && <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

export function PrimaryButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 transition-colors"
    >
      {children}
    </button>
  );
}

export function DangerButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Field({ label, required, children }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const NO_UPPERCASE_TYPES = new Set(["password", "email", "number", "date", "time", "file", "tel", "url", "search"]);

export function Input({ preserveCase, onChange, type, as, ...props }) {
  const shouldUppercase = !preserveCase && !NO_UPPERCASE_TYPES.has(type);

  const handleChange = (e) => {
    if (shouldUppercase) {
      const pos = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase();
      // Restore cursor position — assigning .value moves it to the end otherwise.
      if (pos !== null && e.target.setSelectionRange) e.target.setSelectionRange(pos, pos);
    }
    onChange?.(e);
  };

  const baseClass = "w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";

  if (as === "textarea") {
    return (
      <textarea
        {...props}
        onChange={handleChange}
        className={`${baseClass} ${props.className || ""}`}
      />
    );
  }

  return (
    <input
      {...props}
      type={type}
      onChange={handleChange}
      className={`${baseClass} ${props.className || ""}`}
    />
  );
}

export function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
    >
      {children}
    </select>
  );
}

export function Modal({ title, onClose, children, wide, size }) {
  const width = size === "md" ? "max-w-2xl" : wide || size === "wide" ? "max-w-3xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-slate-900 rounded-xl w-full ${width} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message, onDone }) {
  React.useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 right-6 bg-slate-900 dark:bg-slate-700 text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg z-50">
      {message}
    </div>
  );
}
