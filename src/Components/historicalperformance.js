import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot,
} from "recharts";
import axios from "axios";
import { format as formatIndianNumber } from "indian-number-format";

const HISTORICAL_PERFORMANCE_URL = process.env.REACT_APP_HISTORICAL_PERFORMANCE_URL;
const INDIGO = "#6366F1"; // indigo-500/600

const TIMEFRAMES = [
  { key: "3M", days: 90 },
  { key: "6M", days: 180 },
  { key: "1Y", days: 365 },
  { key: "YTD", days: "YTD" },
  { key: "MAX", days: Infinity },
];

/* ---------- detect dark by prop or closest('.dark') (fallback: <html>.dark) ---------- */
function useClosestDark(containerRef, propDark) {
  const [isDark, setIsDark] = useState(!!propDark);

  useEffect(() => {
    if (propDark !== undefined) {
      setIsDark(!!propDark);
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      // nearest ancestor with .dark OR html.dark
      const local = !!el.closest(".dark");
      const global = document.documentElement.classList.contains("dark");
      setIsDark(local || global);
    };

    compute();

    // observe class changes on html and up the tree from our container
    const htmlObserver = new MutationObserver(compute);
    htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // observe a few ancestors (cheap and sufficient)
    const observers = [htmlObserver];
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i++) {
      const mo = new MutationObserver(compute);
      mo.observe(node, { attributes: true, attributeFilter: ["class"] });
      observers.push(mo);
      node = node.parentElement;
    }
    return () => observers.forEach(o => o.disconnect());
  }, [containerRef, propDark]);

  return isDark;
}

/* --------------------------- helpers / formatters --------------------------- */
const parseDate = (d) => { const t = new Date(d); return isNaN(t) ? null : t; };
const inrCompact = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)} K`;
  return String(Math.round(n));
};
const fmtDateShort = (d) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!(dt instanceof Date) || isNaN(dt)) return "";
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()];
  return `${m} ${dt.getFullYear()}`;
};
const fmtDateFull = (d) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!(dt instanceof Date) || isNaN(dt)) return "";
  return dt.toISOString().slice(0, 10);
};
const downsample = (arr, maxPoints = 360) => {
  if (!arr || arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
};
const withPadding = (min, max, minPad = 10, pct = 0.12) => {
  const range = max - min;
  const pad = Math.max(minPad, range * pct);
  return [Math.floor(min - pad), Math.ceil(max + pad)];
};

/* --------------------------------- UI bits -------------------------------- */
const Skeleton = ({ isDark }) => (
  <div className="space-y-3">
    <div className={`h-5 w-40 rounded ${isDark ? "bg-neutral-700" : "bg-gray-200"}`} />
    <div className={`h-64 w-full rounded ${isDark ? "bg-neutral-800" : "bg-gray-100"}`} />
  </div>
);

function TooltipCard({ pal, payload }) {
  const p = payload?.[0]?.payload || {};
  const value = Number(p?.value || 0);
  const prev = Number(p?.prevValue || 0);
  const delta = prev ? value - prev : 0;
  const pct = prev ? (delta / prev) * 100 : 0;
  const pos = delta >= 0;

  return (
    <div
      style={{
        background: pal.tooltipBg,
        border: `1px solid ${pal.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        boxShadow: pal.shadow,
        minWidth: 180,
        color: pal.text,
      }}
    >
      <div style={{ color: pal.subtle, fontSize: 12, marginBottom: 6 }}>
        {fmtDateFull(p?.date)}
      </div>
      <div style={{ color: INDIGO, fontWeight: 700, fontSize: 14 }}>
        ₹{formatIndianNumber(Math.round(value))}
      </div>
      {prev ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: pos ? pal.deltaPos : pal.deltaNeg,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span>{pos ? "▲" : "▼"}</span>
          <span>{pos ? "+" : ""}{formatIndianNumber(Math.round(delta))}</span>
          <span>({pos ? "+" : ""}{pct.toFixed(2)}%)</span>
        </div>
      ) : null}
    </div>
  );
}

/* =============================== Component =============================== */
export default function HistoricalPerformance({ dark /* optional boolean */ }) {
  const containerRef = useRef(null);
  const isDark = useClosestDark(containerRef, dark);

  const pal = useMemo(
    () =>
      isDark
        ? {
            grid: "#1F2937", axisLine: "#374151", tick: "#9CA3AF", text: "#E5E7EB",
            card: "bg-neutral-900 border-neutral-800",
            pillWrap: "bg-neutral-800",
            pillActive: "bg-neutral-700 text-indigo-300 shadow-sm",
            pill: "text-neutral-300 hover:text-white",
            dotStroke: "#0B0F19",
            tooltipBg: "#0B0F19",
            border: "#1F2937",
            subtle: "#9CA3AF",
            shadow: "0 8px 20px rgba(0,0,0,0.35)",
            posChip: "bg-emerald-900/30 text-emerald-300",
            negChip: "bg-rose-900/30 text-rose-300",
            latestChip: "text-neutral-300 bg-neutral-800",
            title: "text-neutral-100",
            sub: "text-neutral-400",
            retryText: "text-red-400",
          }
        : {
            grid: "#E5E7EB", axisLine: "#E5E7EB", tick: "#6B7280", text: "#111827",
            card: "bg-white border-gray-200",
            pillWrap: "bg-gray-100",
            pillActive: "bg-white text-indigo-700 shadow-sm",
            pill: "text-gray-600 hover:text-gray-900",
            dotStroke: "#FFFFFF",
            tooltipBg: "#FFFFFF",
            border: "#E5E7EB",
            subtle: "#6B7280",
            shadow: "0 8px 20px rgba(0,0,0,0.06)",
            posChip: "bg-green-50 text-green-700",
            negChip: "bg-red-50 text-red-700",
            latestChip: "text-gray-600 bg-gray-100",
            title: "text-gray-900",
            sub: "text-gray-500",
            retryText: "text-red-600",
          },
    [isDark]
  );

  const [raw, setRaw] = useState([]);
  const [tf, setTf] = useState("1Y");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await axios.get(HISTORICAL_PERFORMANCE_URL);
      const cleaned = res.data
        .map((row) => ({ date: parseDate(row?.Date), value: Number(row?.Value) }))
        .filter((d) => d.date && isFinite(d.value))
        .sort((a, b) => a.date - b.date);
      setRaw(cleaned);
    } catch (e) {
      setErr("Failed to load performance data.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!raw.length) return [];
    const now = new Date();
    if (tf === "MAX") return raw;
    if (tf === "YTD") return raw.filter((d) => d.date.getFullYear() === now.getFullYear());
    const days = TIMEFRAMES.find((t) => t.key === tf)?.days ?? Infinity;
    if (!isFinite(days)) return raw;
    const since = new Date(now); since.setDate(since.getDate() - days);
    return raw.filter((d) => d.date >= since);
  }, [raw, tf]);

  const data = useMemo(() => {
    const ds = downsample(filtered, 360);
    for (let i = 1; i < ds.length; i++) ds[i].prevValue = ds[i - 1].value;
    return ds;
  }, [filtered]);

  if (loading) {
    return (
      <div ref={containerRef} className={`${pal.card} rounded-xl p-4 sm:p-6`}>
        <Skeleton isDark={isDark} />
      </div>
    );
  }
  if (err) {
    return (
      <div ref={containerRef} className={`${pal.card} rounded-xl p-4 sm:p-6`}>
        <div className="flex items-center justify-between">
          <p className={`text-sm ${pal.retryText}`}>{err}</p>
          <button
            onClick={fetchData}
            className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data.length) return null;

  const first = data[0]?.value ?? 0;
  const last = data[data.length - 1]?.value ?? 0;
  const totalReturnPct = first ? ((last / first - 1) * 100).toFixed(2) : "0.00";
  const latestLabel = `₹${formatIndianNumber(Math.round(last))}`;
  const [yMin, yMax] = (() => {
    const vals = data.map((d) => d.value);
    return withPadding(Math.min(...vals), Math.max(...vals), 10, 0.12);
  })();

  return (
    <section ref={containerRef} className={`${pal.card} rounded-xl p-4 sm:p-6 shadow-sm`}>
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h1 className={`text-base text-3xl font-bold ${pal.title}`}>Historical Performance</h1>
          <p className={`text-sm ${pal.sub}`}>Portfolio value over time</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs rounded-md px-2 py-1 ${pal.latestChip}`}>
            Latest: <span className="font-semibold text-indigo-500 ml-1">{latestLabel}</span>
          </span>
          <span className={`text-xs rounded-md px-2 py-1 ${Number(totalReturnPct) >= 0 ? pal.posChip : pal.negChip}`}>
            {Number(totalReturnPct) >= 0 ? "▲" : "▼"} {totalReturnPct}%
          </span>

          {/* timeframe pills */}
          <div className={`flex items-center gap-1 rounded-lg p-1 ${pal.pillWrap}`}>
            {TIMEFRAMES.map((t) => (
              <button
                key={t.key}
                onClick={() => setTf(t.key)}
                className={`text-xs px-2.5 py-1 rounded-md transition ${tf === t.key ? pal.pillActive : pal.pill}`}
              >
                {t.key}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* chart */}
      <div className="w-full">
        <ResponsiveContainer width="100%" height={360}>
          <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="indigoArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={INDIGO} stopOpacity={isDark ? 0.35 : 0.25} />
                <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={pal.grid} strokeDasharray="4 4" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDateShort}
              tick={{ fontSize: 12, fill: pal.tick }}
              axisLine={{ stroke: pal.axisLine }}
              tickLine={{ stroke: pal.axisLine }}
              minTickGap={28}
            />
            <YAxis
              width={64}
              tick={{ fontSize: 12, fill: pal.tick }}
              axisLine={{ stroke: pal.axisLine }}
              tickLine={{ stroke: pal.axisLine }}
              domain={[yMin, yMax]}
              tickFormatter={(v) => inrCompact(v)}
            />

            <Tooltip content={({ active, payload }) => (active ? <TooltipCard pal={pal} payload={payload} /> : null)} />

            <Area
              type="monotone"
              dataKey="value"
              stroke={INDIGO}
              strokeWidth={2}
              fill="url(#indigoArea)"
              activeDot={{ r: 4 }}
            />

            <ReferenceDot
              x={data[data.length - 1].date}
              y={data[data.length - 1].value}
              r={4}
              fill={INDIGO}
              stroke={pal.dotStroke}
              strokeWidth={2}
              ifOverflow="discard"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
