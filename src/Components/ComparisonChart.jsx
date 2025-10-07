import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// ===== ENV =====
// REACT_APP_COMPARISON_CHART  -> PF sheet with { Date, "PF Value", [Close] }
const PF_URL = process.env.REACT_APP_COMPARISON_CHART;

// Optional extra benchmarks (each must return array of { Date, Close })
const ENV_BENCHMARKS = [
  { key: "NIFTY50",  label: "NIFTY 50",         env: "REACT_APP_BM_NIFTY50_URL" },
  { key: "NN50",     label: "NIFTY Next 50",    env: "REACT_APP_BM_NN50_URL" },
  { key: "MID150",   label: "NIFTY Midcap 150", env: "REACT_APP_BM_MID150_URL" },
];

// ——— helpers ———
const isUsableUrl = (v) => typeof v === "string" && v.trim() && !/^<.*>$/.test(v.trim());

const dayKeyLocal = (input) => {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

function Selector({ options, value, onChange, dark }) {
  if (!options.length) return null;
  return (
    <div className={`inline-flex flex-wrap gap-1 p-1 rounded-lg border ${
      dark ? "border-white/10 bg-white/10" : "border-black/10 bg-white"
    }`}>
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-3 sm:px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active
                ? "bg-indigo-600 text-white"
                : dark
                ? "text-gray-200 hover:bg-white/10"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Props:
 * - darkMode?: boolean
 * - windowDays?: number (default 90; set 0 for full history)
 */
export default function ComparisonChart({ darkMode = false, windowDays = 90 }) {
  // PF (portfolio) & fallback NIFTY500 from PF.Close
  const [pfSeries, setPfSeries] = useState([]);    // [{Date, Value}] from "PF Value"
  const [nifty500, setNifty500] = useState([]);    // [{Date, Value}] from "Close" in PF sheet

  // Benchmarks that successfully fetched (key -> series)
  const [bmData, setBmData] = useState({});        // { key: [{Date, Value}], ... }
  const [bmList, setBmList] = useState([]);        // [{key,label}], only those with data

  const [selected, setSelected] = useState(null);
  const [loadingPF, setLoadingPF] = useState(true);
  const [loadingBM, setLoadingBM] = useState(false);
  const [errorPF, setErrorPF] = useState("");

  // 1) Fetch PF once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!isUsableUrl(PF_URL)) {
          setErrorPF("PF URL missing");
          return;
        }
        const { data } = await axios.get(PF_URL);
        if (!Array.isArray(data)) {
          setErrorPF("PF response not an array");
          return;
        }

        const pf = data
          .filter((r) => r?.Date && r["PF Value"] != null)
          .map((r) => ({ Date: r.Date, Value: Number(r["PF Value"]) || 0 }));

        const n500 = data
          .filter((r) => r?.Date && r.Close != null)
          .map((r) => ({ Date: r.Date, Value: Number(r.Close) || 0 }));

        if (!mounted) return;
        setPfSeries(pf);
        setNifty500(n500);

        // If we have Close in PF, we already have working NIFTY500
        if (n500.length) {
          setBmList([{ key: "NIFTY500", label: "NIFTY 500" }]);
          setBmData({ NIFTY500: n500 });
          setSelected("NIFTY500");
        }
      } catch (e) {
        if (mounted) setErrorPF(e?.message || "PF fetch failed");
      } finally {
        if (mounted) setLoadingPF(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // 2) Probe extra benchmarks; add only ones that return usable data
  useEffect(() => {
    let mounted = true;
    (async () => {
      const configs = ENV_BENCHMARKS
        .map(({ key, label, env }) => ({ key, label, url: process.env[env] }))
        .filter((c) => isUsableUrl(c.url));

      if (!configs.length) return;
      setLoadingBM(true);

      const newList = [...bmList];
      const newData = { ...bmData };

      for (const cfg of configs) {
        try {
          const { data } = await axios.get(cfg.url);
          const rows = (data || []).filter((r) => r?.Date && r.Close != null);
          const series = rows.map((r) => ({ Date: r.Date, Value: Number(r.Close) || 0 }));
          if (mounted && series.length) {
            if (!newList.find((x) => x.key === cfg.key)) {
              newList.push({ key: cfg.key, label: cfg.label });
            }
            newData[cfg.key] = series;
          }
        } catch {
          // ignore; button will not be shown
        }
      }

      if (!mounted) return;

      // Keep NIFTY500 first when present
      newList.sort((a, b) =>
        a.key === "NIFTY500" ? -1 : b.key === "NIFTY500" ? 1 : a.label.localeCompare(b.label)
      );

      setBmList(newList);
      setBmData(newData);

      // Ensure a valid default selection
      if (!selected && newList.length) setSelected(newList[0].key);

      setLoadingBM(false);
    })();
    return () => { mounted = false; };
  }, [bmList.length, selected]); // run once after PF load + when list is initially seeded

  // 3) Build normalized + intersected dataset
  const chart = useMemo(() => {
    if (!pfSeries.length) return { data: [], yMin: 0, yMax: 0, bmLabel: "" };

    // Build maps
    const pMap = new Map(
      pfSeries
        .map((d) => [dayKeyLocal(d.Date), Number(d.Value)])
        .filter(([k, v]) => k && Number.isFinite(v))
    );

    const bmArr = selected ? bmData[selected] || [] : [];
    const bmLabel = bmList.find((b) => b.key === selected)?.label || "";
    const bMap = new Map(
      bmArr
        .map((d) => [dayKeyLocal(d.Date), Number(d.Value)])
        .filter(([k, v]) => k && Number.isFinite(v))
    );

    // Determine the date set
    let dates = Array.from(
      new Set(selected ? [...pMap.keys()].filter((d) => bMap.has(d)) : [...pMap.keys()])
    ).sort();

    if (!dates.length) return { data: [], yMin: 0, yMax: 0, bmLabel };

    // Apply window
    if (windowDays && windowDays > 0) {
      const last = new Date(dates[dates.length - 1]);
      const cut = new Date(last);
      cut.setDate(cut.getDate() - windowDays);
      dates = dates.filter((d) => new Date(d) >= cut);
      if (!dates.length) return { data: [], yMin: 0, yMax: 0, bmLabel };
    }

    // Normalize both to the FIRST date in the visible set
    const baseP = pMap.get(dates[0]) || 1;
    const baseB = selected ? bMap.get(dates[0]) : null;

    const rows = dates.map((d) => {
      const pVal = pMap.get(d);
      const out = {
        Date: d,
        Portfolio: Number.isFinite(pVal) ? (pVal / baseP) * 100 : undefined,
      };
      if (selected && Number.isFinite(baseB)) {
        const bVal = bMap.get(d);
        if (Number.isFinite(bVal)) out[bmLabel] = (bVal / baseB) * 100;
      }
      return out;
    });

    // Y domain
    const nums = rows.flatMap((r) =>
      [r.Portfolio, selected ? r[bmLabel] : undefined].filter((v) => Number.isFinite(v))
    );
    if (!nums.length) return { data: [], yMin: 0, yMax: 0, bmLabel };

    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const pad = Math.max((max - min) * 0.08, 2);
    return { data: rows, yMin: Math.floor(min - pad), yMax: Math.ceil(max + pad), bmLabel };
  }, [pfSeries, bmData, bmList, selected, windowDays]);

  const hasPF = pfSeries.length > 0;
  const hasChart = chart.data.length > 0;

  return (
    <div className="h-full w-full flex flex-col">
      {/* Benchmark buttons: only for APIs that returned valid data */}
      {bmList.length > 0 && (
        <div className="mb-3 flex flex-wrap justify-center items-center gap-2">
          <Selector options={bmList} value={selected} onChange={setSelected} dark={darkMode} />
          {loadingBM && (
            <span className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>loading…</span>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0" style={{ minHeight: 320 }}>
        {loadingPF ? (
          <div className={`h-full w-full grid place-items-center ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
            Loading…
          </div>
        ) : !hasPF ? (
          <div className={`h-full w-full grid place-items-center ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
            {errorPF || "No portfolio data"}
          </div>
        ) : !hasChart ? (
          <div className={`h-full w-full grid place-items-center ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
            No benchmark overlap in selected window
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart.data} margin={{ top: 8, right: 12, bottom: 6, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={darkMode ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"}
              />
              <XAxis
                dataKey="Date"
                tickFormatter={(t) => String(t).slice(5, 10)}
                minTickGap={24}
                interval="preserveEnd"
                tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }}
              />
              <YAxis
                domain={[chart.yMin, chart.yMax]}
                width={60}
                tickCount={6}
                allowDecimals={false}
                tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }}
                tickFormatter={(v) => `${Number(v).toFixed(0)}`}
                label={{
                  value: "Normalized (100 = start)",
                  angle: -90,
                  position: "insideLeft",
                  fill: darkMode ? "#cbd5e1" : "#334155",
                  fontSize: 12,
                }}
              />
              <Tooltip
                formatter={(val, name) => [`${Number(val).toFixed(2)}%`, name]}
                labelFormatter={(label) => String(label).slice(0, 10)}
                contentStyle={{
                  backgroundColor: darkMode ? "rgba(17,24,39,.95)" : "#fff",
                  border: `1px solid ${darkMode ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.1)"}`,
                  borderRadius: 8,
                }}
              />
              <Line type="monotone" dataKey="Portfolio" stroke="#6366f1" strokeWidth={2} dot={false} />
              {selected && chart.bmLabel && (
                <Line type="monotone" dataKey={chart.bmLabel} stroke="#10b981" strokeWidth={2} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
