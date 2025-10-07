// src/pages/PublicShare.jsx
import React, { useEffect, useState, useMemo } from "react";
import { db } from "../Authentication/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useParams } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export default function PublicShare() {
  const { id } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [darkMode, setDarkMode] = useState(false); // optional: wire to theme or query

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "publicShares", id));
        if (!snap.exists()) {
          setState({ loading: false, data: null, error: "Not found" });
          return;
        }
        const d = snap.data();
        if (!d.isPublic) {
          setState({ loading: false, data: null, error: "This link is private." });
          return;
        }
        setState({ loading: false, data: d, error: null });
      } catch (e) {
        console.error(e);
        setState({ loading: false, data: null, error: "Failed to load." });
      }
    })();
  }, [id]);

  const share = state.data;

  // Robust Y domain (works even if curve is missing/short)
  const [yMin, yMax] = useMemo(() => {
    const curve = Array.isArray(share?.curve) ? share.curve : [];
    const hasBenchmark = !!share?.meta?.hasBenchmark;
    const nums = curve.flatMap((r) => [
      Number.isFinite(r.p) ? r.p : undefined,
      hasBenchmark && Number.isFinite(r.b) ? r.b : undefined,
    ]).filter((v) => typeof v === "number");

    if (!nums.length) return [90, 110];
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const pad = Math.max((max - min) * 0.06, 1);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [share]);

  if (state.loading) {
    return (
      <div className={`min-h-screen grid place-items-center ${darkMode ? "bg-gray-900 text-gray-100" : "bg-white text-gray-900"}`}>
        Loading…
      </div>
    );
  }
  if (state.error) {
    return (
      <div className={`min-h-screen grid place-items-center ${darkMode ? "bg-gray-900 text-gray-100" : "bg-white text-gray-900"}`}>
        {state.error}
      </div>
    );
  }

  const title = share?.title || "Performance";
  const curve = Array.isArray(share?.curve) ? share.curve : [];
  const hasBenchmark = !!share?.meta?.hasBenchmark;
  const holdings = Array.isArray(share?.holdings) ? share.holdings : [];
  const totalReturnPct = share?.summary?.totalReturnPct;
  const xirrPct = share?.summary?.xirrPct;

  return (
    <div className={`min-h-screen ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"} p-4 md:p-8`}>
      <div className="max-w-5xl mx-auto">
        <header className="mb-10">
          <h1 className="text-2xl md:text-3xl font-extrabold">{title}</h1>
          <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} text-sm`}>
            Read-onlySkeleton
          </p>
        </header>

        {/* Chart */}
        <section className={`rounded-xl ${darkMode ? "bg-gray-800 border-white/10" : "bg-white border-black/10"} border py-4 sm:p-6`}>
          <div className="h-[300px] md:h-[460px]">
            {curve.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curve} margin={{ top: 8, right: 12, bottom: 6, left: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={darkMode ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"}
                  />
                  <XAxis
                    dataKey="d"
                    tickFormatter={(t) => String(t).slice(5)} // MM-DD
                    minTickGap={24}
                    interval="preserveEnd"
                    tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    width={56}
                    tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }}
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
                    labelFormatter={(label) => label}
                    contentStyle={{
                      backgroundColor: darkMode ? "rgba(17,24,39,.95)" : "#fff",
                      border: `1px solid ${darkMode ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.1)"}`,
                      borderRadius: 8,
                    }}
                  />
                  <Line type="monotone" dataKey="p" name="Portfolio" stroke="#6366f1" strokeWidth={3} dot={false} />
                  {hasBenchmark && (
                    <Line type="monotone" dataKey="b" name="Benchmark" stroke="#10b981" strokeWidth={2} dot={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className={`${darkMode ? "text-gray-300" : "text-gray-600"} h-full grid place-items-center`}>
                No chart data.
              </div>
            )}
          </div>
        </section>

        {/* KPIs */}
        {(xirrPct != null) && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`rounded-lg border p-3 ${darkMode ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"}`}>
              <div className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-600"}`}>XIRR</div>
              <div className="text-xl font-extrabold">
                {xirrPct != null ? `${Number(xirrPct).toFixed(2)}%` : "—"}
              </div>
            </div>
          </div>
        )}

        {/* Anonymized Holdings */}
        {holdings.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Holdings (amounts hidden)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={darkMode ? "bg-gray-800" : "bg-gray-100"}>
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Amount</th>
                    <th className="text-right px-3 py-2">P/L %</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const pct = Number(h?.plPct || 0);
                    const good = pct >= 0;
                    return (
                      <tr key={i} className={darkMode ? "border-t border-white/10" : "border-t border-black/10"}>
                        <td className="px-3 py-2">{h?.name || "-"}</td>
                        <td className="px-3 py-2 tracking-widest select-none">******</td>
                        <td className={`px-3 py-2 text-right font-semibold ${good ? "text-emerald-600" : "text-rose-600"}`}>
                          {pct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <footer className={`mt-6 text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
          © {new Date().getFullYear()} — Shared snapshot. Values may differ from live portfolio.
        </footer>
      </div>
    </div>
  );
}
