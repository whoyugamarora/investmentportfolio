// src/pages/WhatIf.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SiteHeader from "../Components/SiteHeader";
import { auth, db } from "../Authentication/firebase";
import { collection, getDocs, query, doc, getDoc } from "firebase/firestore";

/* ----------------- helpers ----------------- */
const toNum = (v) => {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s);
  if (neg) s = s.slice(1, -1);
  s = s.replace(/[₹$,]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};
const inr = (n) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const pct = (x) => `${(x * 100).toFixed(2)}%`;

const deep = (obj, path) =>
  path.split(".").reduce((o, k) => (o != null ? o[k] : undefined), obj);
const pick = (obj, keys) => {
  for (const k of keys) {
    const v = k.includes(".") ? deep(obj, k) : obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

/* ----------------- CSV + GVIZ parsers ----------------- */
function parseCSV(text) {
  // tiny CSV (handles quotes and commas)
  const rows = [];
  let i = 0, cur = "", inQ = false, row = [];
  const push = () => { row.push(cur); cur = ""; };
  const endRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") push();
      else if (c === "\n" || c === "\r") {
        // handle CRLF/LF
        if (c === "\r" && text[i + 1] === "\n") i++;
        push(); endRow();
      } else cur += c;
    }
    i++;
  }
  if (cur.length || row.length) { push(); endRow(); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(x => (x ?? "").toString().trim() !== ""))
    .map(r => Object.fromEntries(headers.map((h, idx) => [h, r[idx]])));
}

function parseGVizJSON(text) {
  // gviz returns: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const start = text.indexOf("setResponse(");
  const end = text.lastIndexOf(")");
  if (start === -1 || end === -1) return [];
  const json = JSON.parse(text.slice(start + "setResponse(".length, end));
  const cols = json.table.cols.map(c => c.label || c.id);
  return json.table.rows.map(r => {
    const o = {};
    r.c.forEach((cell, i) => {
      o[cols[i]] = cell ? (cell.f ?? cell.v) : "";
    });
    return o;
  });
}

/* ----------------- normalize from SHEET row ----------------- */
function normalizeFromSheet(r) {
  // your exact keys
  const qty = toNum(r["Quantity"]);
  let avgCost = toNum(r["Buy Price"]);
  // derive if needed
  if ((!Number.isFinite(avgCost) || avgCost <= 0) && qty > 0) {
    const invested = toNum(r["Buy Value"]);
    if (invested > 0) avgCost = invested / qty;
  }
  let lastPrice = toNum(r["Current Price"]);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) lastPrice = avgCost;

  // symbol/name
  const rawCode = r["Company Code"] || r["Ticker"] || r["Symbol"] || r["Company"] || "";
  const ticker = typeof rawCode === "string" && rawCode.includes(":")
    ? rawCode.split(":")[1]
    : rawCode;
  const symbol = (ticker || r["Company"] || "UNKNOWN").toString();
  const name = (r["Company"] || symbol || "—").toString();

  return {
    id: `${symbol}-${Math.random().toString(36).slice(2,7)}`,
    symbol,
    name,
    qty,
    avgCost,
    lastPrice,
    _src: "sheet",
  };
}

/* ----------------- normalize from FIRESTORE doc (fallback) ----------------- */
function normalizeFromFirestore(h) {
  const qty = toNum(pick(h, [
    "Quantity","qty","quantity","shares","units","valuation.qty","valuationSheet.main.qty"
  ]));
  let avgCost = toNum(pick(h, [
    "Buy Price","avgPrice","averagePrice","avg_cost","average_cost","avgCost",
    "buyPrice","buy_price","buy","buyINR","valuationSheet.main.avgPrice","valuationSheet.main.buyPrice"
  ]));
  if ((!Number.isFinite(avgCost) || avgCost <= 0) && qty > 0) {
    const invested = toNum(pick(h, ["Buy Value","buyValue","invested","totalCost","cost","valuation.invested"]));
    if (invested > 0) avgCost = invested / qty;
  }
  let lastPrice = toNum(pick(h, [
    "Current Price","lastPrice","price","currentPrice","ltp","close","valuation.price","valuationSheet.main.price"
  ]));
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) lastPrice = avgCost;

  const rawCode = pick(h, ["Company Code","symbol","ticker","code","name"]) ?? "";
  const ticker = typeof rawCode === "string" && rawCode.includes(":")
    ? rawCode.split(":")[1] : rawCode;
  const symbol = (ticker || pick(h, ["Company","name","symbol"]) || "UNKNOWN").toString();
  const name = (pick(h, ["Company","name"]) ?? symbol ?? "—").toString();

  return {
    id: h.id ?? `${symbol}-${Math.random().toString(36).slice(2,7)}`,
    symbol, name, qty, avgCost, lastPrice, _src: "firestore",
  };
}

/* ----------------- de-dupe ----------------- */
function groupHoldings(list) {
  const map = new Map();
  for (const h of list) {
    const key = (h.symbol || h.name || h.id).toString().trim().toUpperCase();
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...h, symbol: key }); continue; }
    const q1 = toNum(cur.qty), q2 = toNum(h.qty);
    const qty = q1 + q2;
    const avg = qty > 0
      ? (toNum(cur.avgCost) * q1 + toNum(h.avgCost) * q2) / qty
      : (toNum(cur.avgCost) || toNum(h.avgCost) || 0);
    map.set(key, {
      ...cur,
      qty,
      avgCost: avg,
      lastPrice: toNum(h.lastPrice) || toNum(cur.lastPrice) || 0,
      name: cur.name?.length >= h.name?.length ? cur.name : h.name,
    });
  }
  return Array.from(map.values());
}

/* ============================================================ */

export default function WhatIf() {
  const [uid, setUid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [liveHoldings, setLiveHoldings] = useState([]);
  const [scenario, setScenario] = useState([]);
  const [move, setMove] = useState(0);
  const [baseCurrency] = useState("₹");

  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => setUid(u?.uid || null));
    return () => off();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Try the Google Sheet first
        const url = process.env.REACT_APP_SPREADSHEET_URL;
        if (!url) throw new Error("REACT_APP_SPREADSHEET_URL is missing");

        const res = await fetch(url, { headers: { "x-requested-with": "portfolio-app" } });
        if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
        const ct = res.headers.get("content-type") || "";

        let rows = [];
        const text = await res.text();

        if (ct.includes("application/json")) {
          // plain JSON array or object with .data
          let data = JSON.parse(text);
          rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        } else if (text.includes("setResponse(")) {
          rows = parseGVizJSON(text);
        } else {
          rows = parseCSV(text);
        }

        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error("Sheet parsed but returned 0 rows");
        }

        const normalized = rows.map(normalizeFromSheet);
        const merged = groupHoldings(normalized);
        setLiveHoldings(merged);
        setScenario(merged.map(x => ({ ...x })));
      } catch (sheetErr) {
        console.warn("[WhatIf] Sheet fetch failed; falling back to Firestore:", sheetErr);

        // 2) Fallback: Firestore (optional—remove if you don't want it)
        if (!uid) throw sheetErr;
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        const portfolioId =
          userSnap.exists() && userSnap.data()?.activePortfolio
            ? userSnap.data().activePortfolio
            : "default";

        const hSnap = await getDocs(
          query(collection(db, "users", uid, "portfolios", portfolioId, "holdings"))
        );
        const list = hSnap.docs.map(d => normalizeFromFirestore({ id: d.id, ...d.data() }));
        const merged = groupHoldings(list);
        setLiveHoldings(merged);
        setScenario(merged.map(x => ({ ...x })));
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  /* ---------- computed ---------- */
  const computed = useMemo(() => {
    const factor = 1 + move / 100;
    const rows = scenario.map((r) => {
      const price = toNum(r.lastPrice) * factor;
      const cost = toNum(r.avgCost) * toNum(r.qty);
      const value = price * toNum(r.qty);
      const pl = value - cost;
      const ret = toNum(r.avgCost) > 0 ? (price - toNum(r.avgCost)) / toNum(r.avgCost) : 0;
      return { ...r, price, cost, value, pl, ret };
    });

    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalPL = totalValue - totalCost;
    const totalRet = totalCost > 0 ? totalPL / totalCost : 0;

    const withWeights = rows.map((r) => ({
      ...r,
      wCost: totalCost > 0 ? r.cost / totalCost : 0,
      wValue: totalValue > 0 ? r.value / totalValue : 0,
      contribPL: totalValue !== 0 ? r.pl / totalValue : 0,
    }));

    return { rows: withWeights, totalCost, totalValue, totalPL, totalRet };
  }, [scenario, move]);

  /* ---------- actions ---------- */
  const resetToLive = () => { setMove(0); setScenario(liveHoldings.map(x => ({ ...x }))); };
  const addRow = () => setScenario(s => [...s, { id: `new-${Math.random().toString(36).slice(2,7)}`, symbol:"", name:"", qty:0, avgCost:0, lastPrice:0 }]);
  const removeRow = (id) => setScenario(s => s.filter(r => r.id !== id));
  const updateRow = (id, patch) => setScenario(s => s.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const saveScenarioLocal = () => {
    try { localStorage.setItem("whatif:last", JSON.stringify({ at: new Date().toISOString(), move, scenario })); alert("Saved locally."); }
    catch { alert("Could not save to localStorage."); }
  };
  const loadScenarioLocal = () => {
    try {
      const raw = localStorage.getItem("whatif:last");
      if (!raw) return alert("No saved scenario found.");
      const parsed = JSON.parse(raw);
      setMove(parsed.move ?? 0);
      setScenario(Array.isArray(parsed.scenario) ? parsed.scenario : []);
    } catch { alert("Failed to load saved scenario."); }
  };
  const exportCSV = () => {
    const headers = ["Symbol","Name","Qty","AvgCost","BasePrice","AppliedMove(%)","ScenarioPrice","Cost","Value","P/L","Return(%)","Weight(Value)"];
    const lines = [headers.join(",")];
    computed.rows.forEach(r => {
      lines.push([
        r.symbol, r.name, r.qty, r.avgCost, r.lastPrice, move,
        r.price.toFixed(4), r.cost.toFixed(2), r.value.toFixed(2), r.pl.toFixed(2),
        (r.ret*100).toFixed(2), (r.wValue*100).toFixed(2),
      ].join(","));
    });
    lines.push(["TOTAL","","","","","", "", computed.totalCost.toFixed(2), computed.totalValue.toFixed(2), computed.totalPL.toFixed(2), (computed.totalRet*100).toFixed(2), "100.00"].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `whatif_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!uid) {
    return (
      <>
        <SiteHeader />
        <div className="p-6 max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold mb-2">What-If</h1>
          <p>Please sign in to load your holdings.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-xl sm:text-2xl font-bold">What-If Scenario</h1>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 rounded bg-neutral-800 text-white" onClick={resetToLive} disabled={loading}>Reset to Live</button>
            <button className="px-3 py-1.5 rounded border" onClick={saveScenarioLocal}>Save</button>
            <button className="px-3 py-1.5 rounded border" onClick={loadScenarioLocal}>Load</button>
            <button className="px-3 py-1.5 rounded border" onClick={exportCSV}>Export CSV</button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mb-4">
          <div className="p-3 rounded border">
            <div className="text-sm text-neutral-500">Total Cost</div>
            <div className="text-2xl font-semibold">₹{inr(computed.totalCost)}</div>
          </div>
          <div className="p-3 rounded border">
            <div className="text-sm text-neutral-500">Total Value (What-If)</div>
            <div className="text-2xl font-semibold">₹{inr(computed.totalValue)}</div>
          </div>
          <div className="p-3 rounded border">
            <div className="text-sm text-neutral-500">P/L (What-If)</div>
            <div className={`text-2xl font-semibold ${computed.totalPL >= 0 ? "text-emerald-600" : "text-rose-600"}`}>₹{inr(computed.totalPL)} ({pct(computed.totalRet)})</div>
          </div>
        </div>

        <div className="p-4 rounded border mb-4">
          <label className="block text-sm font-medium mb-2">Global Price Move: {move > 0 ? `+${move}%` : `${move}%`}</label>
          <input type="range" min="-50" max="50" step="1" value={move} onChange={(e) => setMove(+e.target.value)} className="w-full" />
          <p className="text-sm text-neutral-500 mt-1">Applies a uniform move to all <em>current prices</em> (not avg cost).</p>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left p-2">Symbol</th>
                <th className="text-left p-2">Name</th>
                <th className="text-right p-2">Qty</th>
                <th className="text-right p-2">Avg Cost</th>
                <th className="text-right p-2">Price (base)</th>
                <th className="text-right p-2">Scenario Price</th>
                <th className="text-right p-2">Cost</th>
                <th className="text-right p-2">Value</th>
                <th className="text-right p-2">P/L</th>
                <th className="text-right p-2">Return</th>
                <th className="text-right p-2">Weight</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {computed.rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2"><input className="w-28 border rounded px-2 py-1" value={r.symbol} onChange={(e) => updateRow(r.id, { symbol: e.target.value })} /></td>
                  <td className="p-2"><input className="w-40 border rounded px-2 py-1" value={r.name} onChange={(e) => updateRow(r.id, { name: e.target.value })} /></td>
                  <td className="p-2 text-right"><input className="w-24 border rounded px-2 py-1 text-right" type="number" step="any" value={r.qty} onChange={(e) => updateRow(r.id, { qty: toNum(e.target.value) })} /></td>
                  <td className="p-2 text-right"><input className="w-28 border rounded px-2 py-1 text-right" type="number" step="any" value={r.avgCost} onChange={(e) => updateRow(r.id, { avgCost: toNum(e.target.value) })} /></td>
                  <td className="p-2 text-right"><input className="w-28 border rounded px-2 py-1 text-right" type="number" step="any" value={r.lastPrice} onChange={(e) => updateRow(r.id, { lastPrice: toNum(e.target.value) })} title="Base (pre-move) price" /></td>
                  <td className="p-2 text-right tabular-nums">{inr(r.price)}</td>
                  <td className="p-2 text-right tabular-nums">{inr(r.cost)}</td>
                  <td className="p-2 text-right tabular-nums">{inr(r.value)}</td>
                  <td className={`p-2 text-right tabular-nums ${r.pl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{inr(r.pl)}</td>
                  <td className="p-2 text-right tabular-nums">{pct(r.ret)}</td>
                  <td className="p-2 text-right tabular-nums">{pct(r.wValue)}</td>
                  <td className="p-2 text-right"><button className="px-2 py-1 rounded border" onClick={() => removeRow(r.id)}>Remove</button></td>
                </tr>
              ))}
              {computed.rows.length === 0 && !loading && (
                <tr><td className="p-4 text-center text-neutral-500" colSpan={12}>No rows</td></tr>
              )}
              {loading && (
                <tr><td className="p-4 text-center text-neutral-500" colSpan={12}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3"><button className="px-3 py-1.5 rounded border" onClick={addRow}>Add Holding</button></div>
        <div className="mt-8 text-sm text-neutral-500">Tip: tweak base price or use the global slider for quick scenarios.</div>
        <div className="mt-8"><Link to="/dashboard" className="underline">← Back to Dashboard</Link></div>
      </div>
    </>
  );
}
