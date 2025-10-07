// src/pages/Insights.jsx
import React, { useEffect, useMemo, useState } from "react";
import SiteHeader from "../Components/SiteHeader";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

const HOLDINGS_URL = process.env.REACT_APP_SPREADSHEET_URL; // <— primary
const COLORS = ["#4f46e5","#16a34a","#dc2626","#0ea5e9","#f59e0b","#a855f7","#06b6d4","#ef4444","#22c55e"];

// --- utils ---
const pct = (n, d) => (d ? (n / d) * 100 : 0);

function csvToRows(text) {
  // very small CSV fallback (no quotes/commas-in-fields handling)
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map(h => h.trim());
  return lines.map(line => {
    const cols = line.split(",").map(c => c.trim());
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i]));
    return obj;
  });
}

function toNumber(x) {
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return x;
  const s = String(x).replace(/[,₹$ ]/g, "");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
}

function groupSum(rows, key) {
  const m = new Map();
  rows.forEach(r => {
    const k = r[key] || "Unknown";
    m.set(k, (m.get(k) || 0) + (r.value || 0));
  });
  return [...m.entries()].map(([name, value]) => ({ name, value }));
}

export default function Insights() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [holdings, setHoldings] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!HOLDINGS_URL) throw new Error("REACT_APP_SPREADSHEET_URL not set");

        const res = await fetch(HOLDINGS_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

        // Try JSON first, fallback to CSV
        let raw;
        const text = await res.text();
        try { raw = JSON.parse(text); }
        catch { raw = csvToRows(text); }

        // Expected columns (case-insensitive friendly):
        // symbol | qty | quantity | shares
        // price | ltp
        // value (optional, else price*qty)
        // sector | country | cap (Large/Mid/Small)
        // changePct (for attribution; optional)
        const norm = raw.map(r => {
          const obj = {};
          // normalize keys to lowercase
          for (const k of Object.keys(r)) obj[k.toLowerCase()] = r[k];

          const symbol = obj.symbol || obj.ticker || obj.name || "";
          const qty = toNumber(obj.qty ?? obj.quantity ?? obj.shares);
          const price = toNumber(obj.price ?? obj.ltp);
          const value = toNumber(obj.value) || qty * price;
          return {
            symbol,
            qty,
            price,
            value,
            sector: obj.sector || "Unknown",
            country: obj.country || "Unknown",
            cap: obj.cap || obj.marketcap || "Unknown",
            changePct: toNumber(obj.changepct), // e.g., "2.4" => 2.4%
          };
        }).filter(x => x.symbol && x.value > 0);

        if (!alive) return;
        setHoldings(norm);
      } catch (e) {
        if (!alive) return;
        setErr(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const total = useMemo(
    () => holdings.reduce((a, b) => a + (b.value || 0), 0) || 1,
    [holdings]
  );

  const sector = useMemo(
    () => groupSum(holdings, "sector").map(x => ({ ...x, pct: +pct(x.value, total).toFixed(2) })),
    [holdings, total]
  );
  const country = useMemo(
    () => groupSum(holdings, "country").map(x => ({ ...x, pct: +pct(x.value, total).toFixed(2) })),
    [holdings, total]
  );
  const cap = useMemo(
    () => groupSum(holdings, "cap").map(x => ({ ...x, pct: +pct(x.value, total).toFixed(2) })),
    [holdings, total]
  );

  const attribution = useMemo(() => {
    if (!holdings.length) return { top: [], bottom: [] };
    const rows = holdings.map(h => ({
      symbol: h.symbol,
      contributionPct: +(((h.value / total) * (h.changePct / 100)) * 100).toFixed(2) // weight × return%
    }));
    const sorted = rows.sort((a, b) => b.contributionPct - a.contributionPct);
    return { top: sorted.slice(0, 5), bottom: sorted.slice(-5).reverse() };
  }, [holdings, total]);

  const pieify = (arr) => arr.map((d, i) => ({
    name: d.name, value: d.pct || d.value || 0, fill: COLORS[i % COLORS.length]
  }));

  return (
    <>
      <SiteHeader />
      <main className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Insights</h1>

        {err && <div className="mb-4 rounded-lg bg-red-50 text-red-700 p-3">{err}</div>}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
            <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
            <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
            <div className="h-64 rounded-xl bg-gray-100 animate-pulse md:col-span-3" />
          </div>
        ) : (
          <>
            {/* Allocation Pies */}
            <section className="grid gap-6 md:grid-cols-3 mb-8">
              <div className="card p-4 rounded-2xl border">
                <h2 className="font-semibold mb-2">Sector Allocation</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieify(sector)} dataKey="value" nameKey="name" outerRadius={90} label />
                    <RTooltip /><Legend />
                    {pieify(sector).map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="card p-4 rounded-2xl border">
                <h2 className="font-semibold mb-2">Country Allocation</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieify(country)} dataKey="value" nameKey="name" outerRadius={90} label />
                    <RTooltip /><Legend />
                    {pieify(country).map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="card p-4 rounded-2xl border">
                <h2 className="font-semibold mb-2">Market Cap Allocation</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieify(cap)} dataKey="value" nameKey="name" outerRadius={90} label />
                    <RTooltip /><Legend />
                    {pieify(cap).map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Performance Attribution */}
            <section className="card p-4 rounded-2xl border mb-8">
              <h2 className="font-semibold mb-2">Performance Attribution (period ≈ today)</h2>
              <p className="text-sm text-gray-600 mb-4">
                Calculates <code>weight × return%</code> using your sheet’s <code>changePct</code> column if present.
              </p>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="font-medium mb-2">Top Contributors</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={attribution.top}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="symbol" /><YAxis /><RTooltip />
                      <Bar dataKey="contributionPct" name="Contribution (%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Bottom Contributors</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={attribution.bottom}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="symbol" /><YAxis /><RTooltip />
                      <Bar dataKey="contributionPct" name="Contribution (%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
