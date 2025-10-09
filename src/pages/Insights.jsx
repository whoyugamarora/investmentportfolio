// src/pages/Insights.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import SiteHeader from "../Components/SiteHeader";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

const HOLDINGS_URL = process.env.REACT_APP_SPREADSHEET_URL;
const COLORS = ["#4f46e5", "#16a34a", "#dc2626", "#0ea5e9", "#f59e0b", "#a855f7", "#06b6d4", "#ef4444", "#22c55e", "#8b5cf6", "#14b8a6", "#f97316"];

const fmtPct = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : "—");
const fmtCurr = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

/* -------------------- parsing helpers -------------------- */
const clean = (s) => String(s ?? "").trim();

function toNumber(x) {
  if (x == null) return 0;
  if (typeof x === "number") return x;
  const v = parseFloat(String(x).replace(/[,₹$()% ]/g, ""));
  return Number.isFinite(v) ? v : 0;
}

// CSV/TSV (tolerant): auto-detect delimiter, skip empty/comment lines, skip blank leading lines
function parseDelimited(text) {
  const trimmed = text.replace(/^\uFEFF/, ""); // strip BOM
  const lines = trimmed.split(/\r?\n/).filter(l => l && !/^\s*(#|;)/.test(l));
  if (lines.length < 2) return [];

  // Try to detect header line (skip leading garbage)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (/,|\t|;/.test(lines[i])) { headerIdx = i; break; }
  }

  const headerLine = lines[headerIdx];
  const delim = headerLine.includes(",") ? "," : headerLine.includes("\t") ? "\t" : ";";
  const headers = headerLine.split(delim).map(h => clean(h));

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(c => clean(c));
    if (cols.every(c => c === "")) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx]; });
    rows.push(obj);
  }
  return rows;
}


function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function normalizeRows(raw) {
  return raw.map(r => {
    // lower-case keys once
    const low = {};
    for (const k of Object.keys(r)) low[k.toLowerCase()] = r[k];

    // symbol: prefer ticker in "company code" (e.g., "NSE:NEULANDLAB"), else company/name
    const companyCode = pick(low, ["company code", "code", "ticker"]);
    let symbol =
      pick(low, ["symbol", "ticker", "name", "scrip", "code", "company"]) ||
      companyCode ||
      "";

    // If we got something like "NSE:NEULANDLAB", keep the right side as symbol
    if (companyCode && String(companyCode).includes(":")) {
      const afterColon = String(companyCode).split(":").pop();
      if (afterColon) symbol = afterColon;
    }

    // qty
    const qty = toNumber(pick(low, ["qty", "quantity", "shares", "units", "q"]));

    // price: prefer current price; fallbacks
    const price = toNumber(
      pick(low, ["current price", "price", "ltp", "last", "rate", "buy price"])
    );

    // value: prefer current value; fallbacks to qty*price
    const value = toNumber(
      pick(low, ["current value", "value", "marketvalue", "mv"])
    ) || (qty * price);

    // change % today (if present)
    const changePct = toNumber(
      pick(low, ["pctchangetoday", "changepct", "change %", "change%", "change", "chg", "ret%"])
    );

    const sector = pick(low, ["sector", "industry"]) || "Unknown";
    const country = pick(low, ["country", "region"]) || "Unknown";
    const cap = pick(low, ["cap", "marketcap", "mcap", "size"]) || "Unknown";

    return {
      symbol: clean(symbol).toUpperCase(),
      qty, price, value, changePct,
      sector, country, cap
    };
  }).filter(x => x.symbol && x.value > 0);
}

// Google “gviz” JSON → rows
function parseGviz(text) {
  const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);?/);
  if (!m) return [];
  const json = JSON.parse(m[1]);
  if (!json?.table?.cols || !json?.table?.rows) return [];
  const labels = json.table.cols.map(c => c?.label || c?.id || "").map(clean);
  return json.table.rows.map(r => {
    const obj = {};
    (r.c || []).forEach((cell, i) => {
      obj[labels[i] || `col${i}`] = cell?.f ?? cell?.v ?? "";
    });
    return obj;
  });
}

function groupSum(rows, key, valueKey = "value") {
  const m = new Map();
  rows.forEach(r => {
    const k = (r[key] || "Unknown") || "Unknown";
    m.set(k, (m.get(k) || 0) + (r[valueKey] || 0));
  });
  return [...m.entries()].map(([name, value]) => ({ name, value }));
}


/* -------------------- UI bits -------------------- */
function SkeletonCard({ h = 260 }) {
  return <div className="w-full" style={{ height: h }}>
    <div className="h-full rounded-2xl bg-gray-100 animate-pulse border" />
  </div>;
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-1">
      <span className="text-sm text-gray-500">{label}</span>
      <div className="text-2xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

/* -------------------- Page -------------------- */
export default function Insights() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [rows, setRows] = useState([]);
  const [rawPreview, setRawPreview] = useState("");
  const [sortBy, setSortBy] = useState({ key: "value", dir: "desc" });
  const [showDebug, setShowDebug] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      if (!HOLDINGS_URL) throw new Error("REACT_APP_SPREADSHEET_URL is not set.");
      const res = await fetch(HOLDINGS_URL, { cache: "no-store", mode: "cors" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const text = await res.text();
      setRawPreview(text.slice(0, 600));

      let parsed = [];
      // Try strict JSON first
      try {
        const asJson = JSON.parse(text);
        if (Array.isArray(asJson)) parsed = asJson;
        else if (Array.isArray(asJson?.data)) parsed = asJson.data;
      } catch { /* fallthrough */ }

      // Try GVIZ
      if (parsed.length === 0) {
        const gviz = parseGviz(text);
        if (gviz.length) parsed = gviz;
      }

      // Try delimited (CSV/TSV/semicolon)
      if (parsed.length === 0) {
        const del = parseDelimited(text);
        if (del.length) parsed = del;
      }

      const norm = normalizeRows(parsed);
      if (norm.length === 0) {
        throw new Error("No usable rows found after parsing (headers or values didn’t match).");
      }
      setRows(norm);
    } catch (e) {
      setErr(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const total = useMemo(() => rows.reduce((a, b) => a + (b.value || 0), 0), [rows]) || 1;

  const sector = useMemo(() => groupSum(rows, "sector").map(x => ({ ...x, pct: (x.value / total) * 100 }))
    .sort((a, b) => b.value - a.value), [rows, total]);

  const country = useMemo(() => groupSum(rows, "country").map(x => ({ ...x, pct: (x.value / total) * 100 }))
    .sort((a, b) => b.value - a.value), [rows, total]);

  const cap = useMemo(() => groupSum(rows, "cap").map(x => ({ ...x, pct: (x.value / total) * 100 }))
    .sort((a, b) => b.value - a.value), [rows, total]);

  const attribution = useMemo(() => {
    if (!rows.length) return { top: [], bottom: [] };
    const list = rows.map(h => ({
      symbol: h.symbol,
      contributionPct: (h.value / total) * (h.changePct / 100) * 100
    }));
    const sorted = list.sort((a, b) => b.contributionPct - a.contributionPct);
    return { top: sorted.slice(0, 5), bottom: sorted.slice(-5).reverse() };
  }, [rows, total]);

  const pieify = (arr) => arr.map((d, i) => ({
    name: d.name,
    value: Math.max(0, d.pct ?? (d.value / total) * 100),
    fill: COLORS[i % COLORS.length]
  }));

  const sortedHoldings = useMemo(() => {
    const copy = [...rows];
    const { key, dir } = sortBy;
    copy.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (typeof va === "string" || typeof vb === "string") {
        return dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      }
      return dir === "asc" ? (va - vb) : (vb - va);
    });
    return copy;
  }, [rows, sortBy]);

  const onSort = (key) => {
    setSortBy((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  };

  return (
    <>
      <SiteHeader />
      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold">Insights</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="px-3 py-1.5 rounded-lg border hover:bg-gray-50 active:scale-[.98]"
            >
              Refresh
            </button>
            <button
              onClick={() => setShowDebug(s => !s)}
              className="px-3 py-1.5 rounded-lg border hover:bg-gray-50"
            >
              {showDebug ? "Hide Debug" : "Show Debug"}
            </button>
          </div>
        </div>

        {err && (
          <div className="mb-4 rounded-2xl border p-4 bg-red-50 text-red-700">
            <div className="font-medium mb-1">Couldn’t load your data</div>
            <div className="text-sm">{err}</div>
            <div className="mt-3 text-sm text-red-800">
              • Make sure the URL returns CSV/TSV or Google “gviz” JSON without auth.<br />
              • Expected columns (any casing): <code>symbol/ticker/name</code>, <code>qty/quantity/shares</code>, <code>price/ltp</code>, <code>value</code> (optional), <code>sector</code>, <code>country</code>, <code>cap/marketcap</code>, <code>changePct/change/chg</code> (optional).
            </div>
          </div>
        )}

        {showDebug && (
          <div className="mb-6 rounded-2xl border p-4 bg-gray-50 text-gray-800">
            <div className="font-medium mb-2">Debug (first 600 chars of response)</div>
            <pre className="text-xs overflow-auto max-h-48 whitespace-pre-wrap">{rawPreview || "(empty)"}</pre>
            <div className="text-xs mt-2">Parsed rows: <b>{rows.length}</b></div>
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            <SkeletonCard /><SkeletonCard /><SkeletonCard />
            <SkeletonCard h={320} />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border p-6 text-gray-600">
            No rows after parsing. Open Debug above to see the raw response.
          </div>
        ) : (
          <>
            {/* Summary */}
            <section className="grid gap-4 md:grid-cols-4 mb-6">
              <StatCard label="Portfolio Value" value={`$${fmtCurr(total)}`} />
              <StatCard label="Holdings" value={rows.length} />
              <StatCard label="Top Sector" value={sector[0]?.name ?? "—"} hint={sector[0] ? fmtPct(sector[0].pct) : ""} />
              <StatCard label="Top Country" value={country[0]?.name ?? "—"} hint={country[0] ? fmtPct(country[0].pct) : ""} />
            </section>

            {/* Allocation pies */}
            <section className="grid gap-6 md:grid-cols-3 mb-8">
              {[
                { title: "Sector Allocation", data: pieify(sector) },
                { title: "Country Allocation", data: pieify(country) },
                { title: "Market Cap Allocation", data: pieify(cap) },
              ].map((block, idx) => (
                <div key={idx} className="rounded-2xl border p-4">
                  <h2 className="font-semibold mb-2">{block.title}</h2>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={block.data} dataKey="value" nameKey="name" outerRadius={90} label={(e) => `${e.name} ${e.value.toFixed(1)}%`} />
                      <RTooltip formatter={(v, name, p) => [`${Number(v).toFixed(2)}%`, p?.payload?.name]} />
                      <Legend />
                      {block.data.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </section>

            {/* Attribution */}
            {(attribution.top.length || attribution.bottom.length) ? (
              <section className="rounded-2xl border p-4 mb-8">
                <h2 className="font-semibold mb-2">Performance Attribution</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Uses <code>weight × return%</code> based on your sheet’s <code>changePct</code> (or <code>change/chg</code>).
                </p>
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="font-medium mb-2">Top Contributors</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={attribution.top}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="symbol" /><YAxis tickFormatter={(v) => `${v.toFixed(1)}%`} />
                        <RTooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                        <Bar dataKey="contributionPct" name="Contribution (%)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">Bottom Contributors</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={attribution.bottom}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="symbol" /><YAxis tickFormatter={(v) => `${v.toFixed(1)}%`} />
                        <RTooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                        <Bar dataKey="contributionPct" name="Contribution (%)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Holdings table */}
            <section className="rounded-2xl border">
              <div className="p-4 border-b">
                <h2 className="font-semibold">Holdings</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {[
                        ["symbol", "Symbol"],
                        ["sector", "Sector"],
                        ["country", "Country"],
                        ["cap", "Cap"],
                        ["qty", "Qty"],
                        ["price", "Price"],
                        ["value", "Value"],
                        ["changePct", "Δ%"]
                      ].map(([k, label]) => (
                        <th
                          key={k}
                          onClick={() => onSort(k)}
                          className="text-left px-4 py-3 cursor-pointer select-none whitespace-nowrap"
                        >
                          {label}{/* sort caret */}
                          <span className="ml-1 text-gray-400">
                            {sortBy.key === k ? (sortBy.dir === "asc" ? "▲" : "▼") : ""}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHoldings.map((h, i) => (
                      <tr key={h.symbol + i} className="border-t">
                        <td className="px-4 py-2 font-medium">{h.symbol}</td>
                        <td className="px-4 py-2">{h.sector}</td>
                        <td className="px-4 py-2">{h.country}</td>
                        <td className="px-4 py-2">{h.cap}</td>
                        <td className="px-4 py-2">{fmtCurr(h.qty)}</td>
                        <td className="px-4 py-2">${fmtCurr(h.price)}</td>
                        <td className="px-4 py-2">${fmtCurr(h.value)}</td>
                        <td className={`px-4 py-2 ${h.changePct > 0 ? "text-emerald-600" : h.changePct < 0 ? "text-red-600" : ""}`}>
                          {fmtPct(h.changePct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
