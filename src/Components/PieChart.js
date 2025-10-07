import React, { useMemo, useState } from "react";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

// Palettes
const LIGHT = ["#6366F1","#22C55E","#F59E0B","#EF4444","#06B6D4","#A855F7","#84CC16","#F97316","#14B8A6","#3B82F6","#DB2777","#059669","#10B981","#2563EB","#7C3AED"];
const DARK  = ["#818CF8","#34D399","#FBBF24","#F87171","#22D3EE","#C084FC","#A3E635","#FB923C","#2DD4BF","#60A5FA","#F472B6","#34D399","#6EE7B7","#93C5FD","#A78BFA"];

const inrCompact = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e7)  return `${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5)  return `${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3)  return `${(n / 1e3).toFixed(1)} K`;
  return String(Math.round(n));
};

// Build series by Company
function useHoldingsSeries(rows, { labelKey = "Company", valueKey = "Current Value", topN = 12, minPct = 0.01 } = {}) {
  return useMemo(() => {
    const map = new Map();
    for (const r of rows || []) {
      const label = String(r?.[labelKey] ?? "Unknown").trim() || "Unknown";
      const val   = Number(r?.[valueKey] ?? 0);
      if (!isFinite(val) || val <= 0) continue;
      map.set(label, (map.get(label) || 0) + val);
    }
    const arr = Array.from(map, ([label, value]) => ({ label, value }))
      .sort((a,b) => b.value - a.value);

    const total = arr.reduce((s,d) => s + d.value, 0);
    const majors = [];
    let other = 0;
    arr.forEach((d,i) => {
      const pct = total ? d.value / total : 0;
      if (i < topN && pct >= minPct) majors.push(d);
      else other += d.value;
    });
    if (other > 0) majors.push({ label: "Other", value: other });
    return { series: majors, total };
  }, [rows, labelKey, valueKey, topN, minPct]);
}

const HoldingsDonut = ({
  data = [],
  darkMode = false,
  title = "Allocation by Holding",
  height = 360,
  labelKey = "Company",
  valueKey = "Current Value",
  topN = 12,
  minPct = 0.01,
}) => {
  const { series, total } = useHoldingsSeries(data, { labelKey, valueKey, topN, minPct });
  const [showAll, setShowAll] = useState(false);

  if (!series.length) {
    return (
      <section className={`rounded-xl border p-4 ${darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200"}`}>
        <div className={`text-sm ${darkMode ? "text-neutral-400" : "text-gray-500"}`}>No holdings to display.</div>
      </section>
    );
  }

  const labels  = series.map(s => s.label);
  const values  = series.map(s => s.value);
  const palette = darkMode ? DARK : LIGHT;
  const colors  = labels.map((_, i) => palette[i % palette.length]);
  const borderC = darkMode ? "#0B0F19" : "#FFFFFF";

  const chartData = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: colors,
      borderColor: borderC,
      borderWidth: 2,
      hoverOffset: 8,
      cutout: "72%", // larger hole => thicker ring, more chart visible
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { animateScale: true, animateRotate: true },
    plugins: {
      legend: { display: false }, // we'll render our own compact legend
      tooltip: {
        backgroundColor: darkMode ? "#0B0F19" : "#FFFFFF",
        borderColor: darkMode ? "#1F2937" : "#E5E7EB",
        borderWidth: 1,
        titleColor: darkMode ? "#9CA3AF" : "#6B7280",
        bodyColor: darkMode ? "#E5E7EB" : "#111827",
        displayColors: false,
        padding: 10,
        callbacks: {
          label: (ctx) => {
            const val = Number(ctx.raw || 0);
            const pct = total ? ((val / total) * 100).toFixed(2) : "0.00";
            return `  ₹${Number(val).toLocaleString("en-IN")}  (${pct}%)`;
          },
        },
      },
    },
  };

  const top = series[0];
  const topPct = total ? ((top.value / total) * 100).toFixed(1) : "0.0";
  const totalTextCompact = `₹${inrCompact(total)}`;

  // Legend items (compact, scrollable)
  const legendItems = series.map((s, i) => {
    const pct = total ? (s.value / total) * 100 : 0;
    return {
      label: s.label,
      value: s.value,
      pct,
      color: colors[i % colors.length],
    };
  });
  const maxToShow = 8;
  const itemsToRender = showAll ? legendItems : legendItems.slice(0, maxToShow);

  return (
    <section className={`rounded-xl border p-4 sm:p-6 shadow-sm ${darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200"}`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h3 className={`text-base font-semibold ${darkMode ? "text-neutral-100" : "text-gray-900"}`}>{title}</h3>
          <p className={`text-xs ${darkMode ? "text-neutral-400" : "text-gray-500"}`}>
            Top holding: <span className="font-medium">{top.label}</span> • {topPct}%
          </p>
        </div>
        <div className={`text-xs rounded-md px-2 py-1 ${darkMode ? "bg-neutral-800 text-neutral-300" : "bg-gray-100 text-gray-700"}`}>
          Total: <span className="font-semibold text-indigo-600">{totalTextCompact}</span>
        </div>
      </div>

      {/* Grid: Chart dominates, legend compact */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        {/* Chart (≈ 2/3) */}
        <div className="lg:col-span-8">
          <div className="relative" style={{ width: "100%", height }}>
            <Doughnut data={chartData} options={options} />
            {/* Small, subtle center label */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
              <div className="text-center">
                <div className={`text-[10px] ${darkMode ? "text-neutral-400" : "text-gray-500"}`}>Total</div>
                <div className={`font-semibold text-xs ${darkMode ? "text-neutral-100" : "text-gray-900"}`}>
                  {totalTextCompact}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Legend (≈ 1/3) */}
        <div className="lg:col-span-4">
          <ul className={`divide-y rounded-lg ${darkMode ? "divide-neutral-800 bg-neutral-900" : "divide-gray-100 bg-white"} border ${darkMode ? "border-neutral-800" : "border-gray-200"} max-h-64 overflow-auto`}>
            {itemsToRender.map((it, idx) => (
              <li key={idx} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.color }} />
                  <span className={`text-sm truncate ${darkMode ? "text-neutral-200" : "text-gray-800"}`} title={it.label}>
                    {it.label}
                  </span>
                </div>
                <div className={`text-xs whitespace-nowrap ${darkMode ? "text-neutral-400" : "text-gray-600"}`}>
                  {it.pct.toFixed(1)}%
                </div>
              </li>
            ))}
            {!showAll && legendItems.length > maxToShow && (
              <li className="px-3 py-2">
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Show all {legendItems.length}
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default HoldingsDonut;
