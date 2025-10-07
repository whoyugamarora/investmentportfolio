import React, { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { format as formatIndianNumber } from "indian-number-format";

ChartJS.register(ArcElement, Tooltip, Legend);

const LIGHT_COLORS = [
  "#6366F1", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4",
  "#A855F7", "#84CC16", "#F97316", "#14B8A6", "#3B82F6"
];
const DARK_COLORS = [
  "#818CF8", "#34D399", "#FBBF24", "#F87171", "#22D3EE",
  "#C084FC", "#A3E635", "#FB923C", "#2DD4BF", "#60A5FA"
];

function useSectorSeries(
  rows,
  { groupBy = "Sector", valueKey = "Current Value", topN = 9, minPct = 0.02 } = {}
) {
  return useMemo(() => {
    const map = new Map();
    for (const row of rows || []) {
      const key = String(row?.[groupBy] ?? "Unknown").trim() || "Unknown";
      const val = Number(row?.[valueKey] ?? 0);
      if (!isFinite(val) || val <= 0) continue;
      map.set(key, (map.get(key) || 0) + val);
    }
    const arr = Array.from(map, ([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const total = arr.reduce((s, d) => s + d.value, 0);
    const majors = [];
    let other = 0;
    arr.forEach((d, i) => {
      const pct = total ? d.value / total : 0;
      if (i < topN && pct >= minPct) majors.push(d);
      else other += d.value;
    });
    if (other > 0) majors.push({ label: "Other", value: other });

    return { series: majors, total };
  }, [rows, groupBy, valueKey, topN, minPct]);
}

const PieChartSector = ({
  data = [],
  darkMode = false,
  title = "Allocation by Sector",
  height = 360,
  groupBy = "Sector",
  valueKey = "Current Value",
  topN = 9,
  minPct = 0.02,
}) => {
  const { series, total } = useSectorSeries(data, { groupBy, valueKey, topN, minPct });

  if (!series.length) {
    return (
      <section className={`rounded-xl border p-4 ${darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200"}`}>
        <div className={`text-sm ${darkMode ? "text-neutral-400" : "text-gray-500"}`}>No data available.</div>
      </section>
    );
  }

  const labels = series.map(s => s.label);
  const values = series.map(s => s.value);
  const palette = darkMode ? DARK_COLORS : LIGHT_COLORS;
  const colors = labels.map((_, i) => palette[i % palette.length]);
  const borderColor = darkMode ? "#0B0F19" : "#FFFFFF";

  const chartData = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderColor,
        borderWidth: 2,
        hoverOffset: 8,
        cutout: "58%", // donut look
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { animateScale: true, animateRotate: true },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: darkMode ? "#E5E7EB" : "#111827",
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 8,
          boxHeight: 8,
          padding: 14,
        },
      },
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
            return `  ₹${formatIndianNumber(Math.round(val))}  (${pct}%)`;
          },
        },
      },
    },
  };

  const top = series[0];
  const topPct = total ? ((top.value / total) * 100).toFixed(1) : "0.0";
  const totalText = `₹${formatIndianNumber(Math.round(total))}`;

  return (
    <section className={`rounded-xl border p-4 sm:p-6 shadow-sm ${darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200"}`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className={`text-base font-semibold ${darkMode ? "text-neutral-100" : "text-gray-900"}`}>{title}</h3>
          <p className={`text-xs ${darkMode ? "text-neutral-400" : "text-gray-500"}`}>
            Top sector: <span className="font-medium">{top.label}</span> • {topPct}%
          </p>
        </div>
        <div className={`text-xs rounded-md px-2 py-1 ${darkMode ? "bg-neutral-800 text-neutral-300" : "bg-gray-100 text-gray-700"}`}>
          Total: <span className="font-semibold text-indigo-600">{totalText}</span>
        </div>
      </div>

      {/* Chart + HTML center overlay (no plugins, no crashes) */}
      <div className="relative" style={{ width: "100%", height }}>
        <Doughnut data={chartData} options={options} />
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
          style={{ transform: "translateZ(0)" }}
        >
          <div className="text-center">
            <div className={`text-[11px] ${darkMode ? "text-neutral-400" : "text-gray-500"}`}>Total</div>
            <div className={`font-semibold text-sm ${darkMode ? "text-neutral-100" : "text-gray-900"}`}>
              {totalText}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PieChartSector;
