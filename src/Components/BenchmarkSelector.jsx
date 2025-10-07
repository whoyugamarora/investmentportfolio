import React from "react";

export default function BenchmarkSelector({ options, value, onChange, dark }) {
  return (
    <div className={`inline-flex flex-wrap gap-1 p-1 rounded-lg border
      ${dark ? "border-white/10 bg-white/10" : "border-black/10 bg-white"}`}>
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-3 sm:px-4 py-1.5 rounded-md text-sm font-medium transition-colors
              ${active
                ? "bg-indigo-600 text-white"
                : dark
                  ? "text-gray-200 hover:bg-white/10"
                  : "text-gray-700 hover:bg-gray-100"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
