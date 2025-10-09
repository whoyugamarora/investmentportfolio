// src/pages/HoldingDetail.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import SiteHeader from "../Components/SiteHeader";
import { auth, db, storage } from "../Authentication/firebase";
import {
  collection, doc, getDoc, getDocs, orderBy, query, addDoc,
  serverTimestamp, setDoc, updateDoc, where
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { onSnapshot } from "firebase/firestore";

/* ---------- Helpers ---------- */
function useAuthUid() {
  const [uid, setUid] = useState(null);
  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => setUid(u ? u.uid : null));
    return () => off();
  }, []);
  return uid;
}
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function pct(v) { return (v).toFixed(1) + "%"; }
function toNum(v) { return (v === "" || v == null) ? null : Number(v); }
function bytes(n) {
  if (!n && n !== 0) return "";
  const u = ["B", "KB", "MB", "GB"]; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + " " + u[i];
}
function fmtTs(ts) {
  try {
    if (ts?.toDate) return ts.toDate().toLocaleString();
    if (ts instanceof Date) return ts.toLocaleString();
  } catch { }
  return "";
}

/* ---------- Tiny Markdown Preview ---------- */
function Preview({ md }) {
  const html = useMemo(() => {
    if (!md) return "";
    let s = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/^### (.*)$/gm, "<h3 class='text-base font-semibold mt-4 mb-2'>$1</h3>");
    s = s.replace(/^## (.*)$/gm, "<h2 class='text-lg font-bold mt-5 mb-3'>$1</h2>");
    s = s.replace(/^# (.*)$/gm, "<h1 class='text-xl font-bold mt-6 mb-4'>$1</h1>");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong class='font-semibold'>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code class='px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[12px] font-mono'>$1</code>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="text-indigo-600 hover:text-indigo-700 underline decoration-indigo-300 hover:decoration-indigo-500" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/^(?:-|\*) (.*)$/gm, "<li class='mb-1'>$1</li>");
    s = s.replace(/(<li>.*<\/li>)/gs, "<ul class='list-disc pl-6 space-y-1 my-3'>$1</ul>");
    s = s.replace(/\n{2,}/g, "</p><p class='mb-3'>").replace(/\n/g, "<br/>");
    return "<div class='leading-relaxed'><p class='mb-3'>" + s + "</p></div>";
  }, [md]);
  return <div className="prose prose-sm max-w-none break-words text-gray-800" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ---------- Conviction UI ---------- */
const convictionLabels = ["", "Low", "Medium", "High", "Very High"];
const convictionColors = ["", "bg-rose-100 text-rose-700", "bg-amber-100 text-amber-700", "bg-emerald-100 text-emerald-700", "bg-green-100 text-green-700"];

function ConvictionStars({ value, onChange }) {
  const v = clamp(Number(value) || 1, 1, 4);
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Conviction">
      {[1, 2, 3, 4].map(n => (
        <button
          key={n}
          type="button"
          aria-checked={v === n}
          onClick={() => onChange(n)}
          className={"p-1 rounded " + (n <= v ? "text-yellow-500" : "text-gray-300")}
          title={convictionLabels[n]}
        >
          {/* star icon */}
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="m12 17.27 5.18 3.04-1.64-5.81 4.46-3.86-5.88-.5L12 4l-2.12 6.14-5.88.5 4.46 3.86-1.64 5.81z" /></svg>
        </button>
      ))}
      <span className="ml-2 text-xs text-gray-500">{convictionLabels[v]} ({v}/4)</span>
    </div>
  );
}

/* ---------- Live Price Hook ---------- */
const SHEET_URL = process.env.REACT_APP_SPREADSHEET_URL;

async function tryParseCSV(text) {
  // tiny CSV (no quotes/escapes). Good enough for published Sheets CSV
  const rows = text.trim().split(/\r?\n/).map(r => r.split(","));
  const headers = rows[0] || [];
  return rows.slice(1).map(r => Object.fromEntries(r.map((v, i) => [headers[i], v])));
}
function normSym(s) { return String(s || "").trim().toUpperCase(); }

function matchSymbol(row, symbol) {
  const s = normSym(symbol);
  const code = normSym(row["Company Code"]);
  const name = normSym(row["Company"]);
  const wanted = new Set([s, `NSE:${s}`, `BSE:${s}`]);
  if (wanted.has(code)) return true;
  if (code.endsWith(":" + s)) return true;
  if (name && name === s) return true;
  return false;
}

function pickFieldsFromRow(row) {
  // price
  let price = row["Current Price"];
  if (typeof price === "string") price = Number(price.replace(/[, ]/g, ""));
  if (!Number.isFinite(price)) price = null;

  // intraday change & percent
  let change = row["changetoday"];
  if (typeof change === "string") change = Number(change.replace(/[, ]/g, ""));
  if (!Number.isFinite(change)) change = null;

  let pct = row["pctchangetoday"];
  if (typeof pct === "string") pct = Number(pct.replace(/[, ]/g, ""));
  if (!Number.isFinite(pct)) pct = null;

  // PE + Sector
  let pe = row["PE"];
  if (typeof pe === "string") pe = Number(pe.replace(/[, ]/g, ""));
  if (!Number.isFinite(pe)) pe = null;

  const sector = (row["Sector"] ?? "") || null;

  return { price, change, pct, pe, sector, src: "Sheet" };
}

async function fetchFromSheet(symbol) {
  if (!SHEET_URL) return null;
  const res = await fetch(SHEET_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Sheet fetch failed: " + res.status);
  const data = await res.json(); // your endpoint is JSON array
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
  for (const r of rows) {
    if (matchSymbol(r, symbol)) return pickFieldsFromRow(r);
  }
  return null;
}

// ---- Yahoo fallback (adds price/change/% and sometimes PE) ----
async function fetchFromYahoo(symbol) {
  const url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbol);
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("Yahoo fetch failed: " + r.status);
  const j = await r.json();
  const q = j?.quoteResponse?.result?.[0];
  if (!q) return null;

  const price = q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice ?? null;
  const change = q?.regularMarketChange ?? null;
  const pct = q?.regularMarketChangePercent ?? null;
  const pe = (typeof q?.trailingPE === "number" && Number.isFinite(q.trailingPE)) ? q.trailingPE : null;

  if (price == null) return null;
  return { price: Number(price), change: Number(change ?? 0), pct: Number(pct ?? 0), pe, sector: null, src: "Yahoo" };
}

function useLivePrice(symbol, enabled) {
  const [state, setState] = React.useState({
    price: null, change: null, pct: null, pe: null, sector: null,
    src: null, at: null, err: null, busy: false
  });

  const refresh = React.useCallback(async () => {
    if (!enabled) return null;
    setState(s => ({ ...s, busy: true, err: null }));
    try {
      let data = null;
      try { data = await fetchFromSheet(symbol); } catch (_) { }
      if (!data) data = await fetchFromYahoo(symbol);
      if (!data) throw new Error("No price found");

      const next = {
        price: data.price ?? null,
        change: (data.change ?? null),
        pct: (data.pct ?? null),
        pe: (data.pe ?? null),
        sector: (data.sector ?? null),
        src: data.src || null,
        at: new Date(),
        err: null,
        busy: false
      };
      setState(next);
      return next; // <= allow caller to log into timeline
    } catch (e) {
      const fail = { price: null, change: null, pct: null, pe: null, sector: null, src: null, at: new Date(), err: String(e.message || e), busy: false };
      setState(fail);
      return fail;
    }
  }, [symbol, enabled]);

  return { ...state, refresh };
}



/* ---------- Mini Spreadsheet (Valuation Model) ---------- */
const COLS_INIT = 8;
const ROWS_INIT = 15;
const COL_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
function cellKey(r, c) { return COL_LETTERS[c] + (r + 1); }

function evalFormula(raw, get) {
  // Supports =A1 + B2 * 3, parentheses, and SUM(A1:A5) / SUM(A1,B2,C3)
  const f = String(raw).trim().replace(/^=/, "");
  // Replace SUM ranges
  let expr = f.replace(/SUM\(\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*\)/gi, (_, a, b) => {
    // build list inclusive
    const colA = COL_LETTERS.indexOf(a.match(/[A-Z]+/i)[0].toUpperCase());
    const rowA = parseInt(a.match(/\d+/)[0], 10) - 1;
    const colB = COL_LETTERS.indexOf(b.match(/[A-Z]+/i)[0].toUpperCase());
    const rowB = parseInt(b.match(/\d+/)[0], 10) - 1;
    const loC = Math.min(colA, colB), hiC = Math.max(colA, colB);
    const loR = Math.min(rowA, rowB), hiR = Math.max(rowA, rowB);
    const list = [];
    for (let r = loR; r <= hiR; r++) {
      for (let c = loC; c <= hiC; c++) {
        const v = Number(get(r, c) ?? 0);
        list.push(Number.isFinite(v) ? v : 0);
      }
    }
    return "(" + list.join("+") + ")";
  });
  // Replace SUM lists like SUM(A1,B2,C3)
  expr = expr.replace(/SUM\(\s*([A-Z]+\d+(?:\s*,\s*[A-Z]+\d+)*)\s*\)/gi, (_, list) => {
    const parts = list.split(",").map(s => s.trim());
    const nums = parts.map(cell => {
      const col = COL_LETTERS.indexOf(cell.match(/[A-Z]+/i)[0].toUpperCase());
      const row = parseInt(cell.match(/\d+/)[0], 10) - 1;
      const v = Number(get(row, col) ?? 0);
      return Number.isFinite(v) ? v : 0;
    });
    return "(" + nums.join("+") + ")";
  });
  // Replace plain refs
  expr = expr.replace(/([A-Z]+)(\d+)/gi, (_, col, row) => {
    const c = COL_LETTERS.indexOf(col.toUpperCase());
    const r = parseInt(row, 10) - 1;
    const v = get(r, c);
    return String(Number(v ?? 0));
  });
  // Safe eval
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (${expr})`);
  const out = fn();
  return Number.isFinite(out) ? out : "";
}

// Firestore can't store nested arrays. Encode rows (2D array) as map-of-maps.
function encodeRowsToDoc(rows) {
  const out = {};
  let maxCols = 0;
  rows.forEach((r, ri) => {
    const rowObj = {};
    r.forEach((v, ci) => {
      if (v !== "" && v != null) rowObj[ci] = v; // store only non-empty cells
    });
    out[ri] = rowObj;
    maxCols = Math.max(maxCols, r.length);
  });
  return { grid: out, maxCols };
}

function decodeRowsFromDoc(docData, fallbackRows) {
  // Accept existing doc shapes: {grid, maxCols} (new) OR legacy {rows} (if ever written)
  if (docData?.grid && typeof docData.grid === "object") {
    const rowKeys = Object.keys(docData.grid).map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
    if (rowKeys.length === 0) return fallbackRows;
    rowKeys.sort((a, b) => a - b);

    // determine max cols
    let maxCols = Number.isFinite(docData.maxCols) ? docData.maxCols : 0;
    for (const rk of rowKeys) {
      const rowObj = docData.grid[rk] || {};
      const cols = Object.keys(rowObj).map(n => parseInt(n, 10)).filter(Number.isFinite);
      const mc = (cols.length ? Math.max(...cols) + 1 : 0);
      maxCols = Math.max(maxCols, mc);
    }
    maxCols = Math.max(maxCols, fallbackRows[0]?.length || 0, COLS_INIT);

    // rebuild 2D array
    const out = rowKeys.map(rk => {
      const rowObj = docData.grid[rk] || {};
      const row = Array.from({ length: maxCols }, (_, c) => rowObj[c] ?? "");
      return row;
    });

    // Ensure at least ROWS_INIT rows
    while (out.length < Math.max(ROWS_INIT, rowKeys.length)) {
      out.push(Array.from({ length: maxCols }, () => ""));
    }
    return out;
  }

  // Legacy: if a previous doc somehow had rows: [] (array-of-arrays). Not expected (it errors),
  // but keep a safe path anyway.
  if (Array.isArray(docData?.rows)) {
    try {
      const rows = docData.rows;
      if (Array.isArray(rows[0])) return rows;
    } catch { }
  }

  return fallbackRows;
}


function vSheetDocRef(uid, pid, symbol) {
  // users/{uid}/portfolios/{pid}/holdings/{symbol}/valuationSheet/{docId}
  return doc(db, "users", uid, "portfolios", pid, "holdings", symbol, "valuationSheet", "main");
}

function ValuationSheet({ uid, pid, symbol }) {
  const storageKey = `vm:${uid}:${pid}:${symbol}`;
  const [rows, setRows] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved?.rows && Array.isArray(saved.rows)) return saved.rows;
    } catch { }
    return Array.from({ length: ROWS_INIT }, () => Array(COLS_INIT).fill(""));
  });
  const [calc, setCalc] = useState(() => rows.map(r => r.map(() => "")));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const get = useCallback((r, c) => {
    const v = rows[r]?.[c];
    if (typeof v === "string" && v.startsWith("=")) {
      try { return evalFormula(v, get); } catch { return ""; }
    }
    return v;
  }, [rows]);

  useEffect(() => {
    const computed = rows.map((r, ri) => r.map((v, ci) => {
      if (typeof v === "string" && v.trim().startsWith("=")) {
        try { return evalFormula(v, get); } catch { return ""; }
      }
      return v;
    }));
    setCalc(computed);
    try { localStorage.setItem(storageKey, JSON.stringify({ rows })); } catch { }
  }, [rows, get, storageKey]);

  function setCell(r, c, v) {
    setRows(prev => {
      const next = prev.map(x => x.slice());
      if (!next[r]) next[r] = [];
      next[r][c] = v;
      return next;
    });
  }
  function addRow() { setRows(prev => prev.concat([Array(prev[0]?.length || COLS_INIT).fill("")])) }
  function addCol() { setRows(prev => prev.map(r => r.concat([""]))) }
  function toCSV() {
    const all = rows.map(r => r.map(v => {
      const s = (v ?? "").toString();
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([all], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${symbol}-valuation.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  async function fromCSV(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.split(",").map(s => s.replace(/^"|"$/g, "").replace(/""/g, '"')));
    setRows(lines.map(r => r));
  }

  // Firestore save/load under holding/valuationSheet (single doc)
  async function saveToCloud() {
    setBusy(true); setErr(null);
    try {
      const docRef = vSheetDocRef(uid, pid, symbol);
      const enc = encodeRowsToDoc(rows);
      await setDoc(docRef, { rowsV: 2, ...enc, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  }

  async function loadFromCloud() {
    setBusy(true); setErr(null);
    try {
      const docRef = vSheetDocRef(uid, pid, symbol);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const d = snap.data();
        const restored = decodeRowsFromDoc(d, rows);
        setRows(restored);
      }
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  }

  function makeEmptyRows(rowsCount = ROWS_INIT, colsCount = COLS_INIT) {
    return Array.from({ length: rowsCount }, () => Array(colsCount).fill(""));
  }

  async function resetSheet() {
    const cols = Math.max(COLS_INIT, rows[0]?.length || COLS_INIT);
    const fresh = makeEmptyRows(ROWS_INIT, cols);

    // quick UI reset + local cache clear
    setRows(fresh);
    try { localStorage.removeItem(storageKey); } catch { }

    // optional cloud overwrite
    const doCloud = window.confirm("Also clear the valuation sheet stored in the cloud for this holding?");
    if (doCloud) {
      setBusy(true); setErr(null);
      try {
        const docRef = vSheetDocRef(uid, pid, symbol);
        // store a blank map-of-maps (no nested arrays)
        await setDoc(
          docRef,
          { rowsV: 2, grid: {}, maxCols: cols, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setBusy(false);
      }
    }
  }



  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Valuation Model (Spreadsheet)</h3>
        <div className="flex items-center gap-2">
          <button onClick={addRow} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">+ Row</button>
          <button onClick={addCol} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">+ Col</button>
          <button onClick={toCSV} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Export CSV</button>
          <label className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 cursor-pointer">
            Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) fromCSV(f); e.currentTarget.value = ""; }} />
          </label>
          <button onClick={saveToCloud} disabled={busy} className={"text-xs px-2 py-1 rounded border " + (busy ? "border-gray-200 text-gray-300" : "border-gray-300 hover:bg-gray-50")}>Save</button>
          <button onClick={loadFromCloud} disabled={busy} className={"text-xs px-2 py-1 rounded border " + (busy ? "border-gray-200 text-gray-300" : "border-gray-300 hover:bg-gray-50")}>Load</button>
          <button
            onClick={resetSheet}
            disabled={busy}
            className={"text-xs px-2 py-1 rounded border " + (busy ? "border-gray-200 text-gray-300" : "border-rose-300 text-rose-700 hover:bg-rose-50")}
            title="Reset sheet to blank (optionally clears cloud copy)"
          >
             Reset
          </button>
        </div>
      </div>
      {err && <div className="mb-2 text-xs text-rose-600">{err}</div>}
      <div className="overflow-auto border rounded-lg">
        <table className="min-w-[720px] w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-2 py-1 text-center w-10">#</th>
              {rows[0]?.map?.((_, c) => <th key={c} className="border px-2 py-1 text-center w-24">{COL_LETTERS[c]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                <td className="border px-2 py-1 text-center bg-gray-50">{ri + 1}</td>
                {r.map((v, ci) => (
                  <td key={ci} className="border p-0">
                    <input
                      value={v}
                      onChange={e => setCell(ri, ci, e.target.value)}
                      className="w-full px-2 py-1 outline-none focus:bg-indigo-50"
                      placeholder={calc[ri]?.[ci] ? String(calc[ri][ci]) : ""}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Tips: start formulas with <code>=</code> (e.g. <code>=A1*B2</code>, <code>=SUM(A1:A5)</code>). Values persist locally and can be saved to Firestore.
      </p>
    </section>
  );
}

/* ====================================================================== */
export default function HoldingDetail({ pid = "default" }) {
  const { symbol } = useParams();
  const [sp] = useSearchParams();
  const effectivePid = sp.get("pid") || pid;
  const uid = useAuthUid();

  /* state */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [savedTick, setSavedTick] = useState(false);

  const [thesis, setThesis] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [conviction, setConviction] = useState(3);
  const [tags, setTags] = useState([]);

  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");

  const [theses, setTheses] = useState([]);
  const [thFormTitle, setThFormTitle] = useState("");
  const [thFormBody, setThFormBody] = useState("");

  const [files, setFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [trades, setTrades] = useState([]);
  const [dividends, setDividends] = useState([]);

  const [manualOverride, setManualOverride] = useState(false);
  const [quoteEvents, setQuoteEvents] = useState([]);


  const docRef = useMemo(() => {
    return uid ? doc(db, "users", uid, "portfolios", effectivePid, "holdings", symbol) : null;
  }, [uid, effectivePid, symbol]);

  /* files live updates */
  useEffect(() => {
    if (!uid) return;
    const fCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "files");
    const qy = query(fCol, orderBy("createdAt", "desc"));
    const off = onSnapshot(qy, (snap) => {
      setFiles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => setErr(e.message));
    return off;
  }, [uid, effectivePid, symbol]);

  async function handleRefresh() {
    setManualOverride(false);
    const d = await live.refresh();          // use your existing useLivePrice hook
    if (d && d.price != null) {
      setQuoteEvents(prev => [
        { date: new Date(), price: d.price, src: d.src || "—", change: d.change, pct: d.pct },
        ...prev
      ]);
    }
  }

  const initialRef = useRef({ thesis: "", target: "", current: "", conviction: 3, tags: [] });
  const isDirty =
    thesis !== initialRef.current.thesis ||
    target !== initialRef.current.target ||
    current !== initialRef.current.current ||
    conviction !== initialRef.current.conviction ||
    JSON.stringify(tags) !== JSON.stringify(initialRef.current.tags);

  /* load doc + lists */
  const load = useCallback(async () => {
    if (!docRef) return;
    setErr(null); setLoading(true);
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const d = snap.data();
        const init = {
          thesis: d?.thesis ?? "",
          target: (d?.targetPrice != null) ? String(d.targetPrice) : "",
          current: (d?.currentPrice != null) ? String(d.currentPrice) : "",
          conviction: (typeof d?.conviction === "number") ? d.conviction : 3,
          tags: Array.isArray(d?.tags) ? d.tags : [],
        };
        setThesis(init.thesis);
        setTarget(init.target);
        setCurrent(init.current);
        setConviction(init.conviction);
        setTags(init.tags);
        initialRef.current = init;
      } else {
        await setDoc(docRef, {
          symbol,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          thesis: "",
          conviction: 3,
          tags: [],
        }, { merge: true });
        initialRef.current = { thesis: "", target: "", current: "", conviction: 3, tags: [] };
      }

      // txn & dividends
      const txCol = collection(db, "users", uid, "portfolios", effectivePid, "transactions");
      const divCol = collection(db, "users", uid, "portfolios", effectivePid, "dividends");
      const txQ = query(txCol, where("symbol", "==", symbol), orderBy("date", "desc"));
      const divQ = query(divCol, where("symbol", "==", symbol), orderBy("date", "desc"));
      const [txSnap, divSnap] = await Promise.all([getDocs(txQ), getDocs(divQ)]);
      setTrades(txSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setDividends(divSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // notes (latest first)
      const notesCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "notes");
      const notesQ = query(notesCol, orderBy("createdAt", "desc"));
      const notesSnap = await getDocs(notesQ);
      setNotes(notesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // theses
      const thCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "theses");
      const thQ = query(thCol, orderBy("createdAt", "desc"));
      const thSnap = await getDocs(thQ);
      setTheses(thSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // fallback current from latest trade
      if (!initialRef.current.current && txSnap.docs.length) {
        const latest = txSnap.docs[0].data();
        if (latest && latest.price != null) {
          setCurrent(String(latest.price));
          initialRef.current.current = String(latest.price);
        }
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [docRef, effectivePid, symbol, uid]);

  useEffect(() => { load(); }, [load]);

  /* Live price */
  const live = useLivePrice(symbol, !!uid);
  useEffect(() => {
    // Auto-load live price on first mount if there isn't a manual override/value already saved
    if (!manualOverride && !initialRef.current.current) {
      live.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!manualOverride && live.price != null) {
      setCurrent(String(live.price));
    }
  }, [live.price, manualOverride]);

  /* save core */
  async function saveCore() {
    if (!docRef) return;
    setSaving(true); setErr(null);
    try {
      await updateDoc(docRef, {
        thesis,
        targetPrice: toNum(target),
        currentPrice: toNum(current),
        conviction: Number(conviction),
        tags,
        updatedAt: serverTimestamp(),
      });
      initialRef.current = { thesis, target, current, conviction, tags };
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1400);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  /* keyboard: ⌘/Ctrl+S */
  useEffect(() => {
    function onKey(e) {
      const key = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        e.preventDefault();
        if (!saving && isDirty) saveCore();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, isDirty, thesis, target, current, conviction, tags]);

  /* tags */
  function onTagKey(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = (e.currentTarget.value || "").trim();
      if (v && !tags.includes(v)) setTags(tags.concat([v]));
      e.currentTarget.value = "";
    }
  }
  function removeTag(t) { setTags(tags.filter((x) => x !== t)); }

  /* timeline */
  const timeline = useMemo(() => {
    const rows = []
      .concat(trades.map(t => ({
        type: t.side || "TRADE",
        date: t.date?.toDate ? t.date.toDate() : new Date(t.date),
        note: (t.side || "") + " " + t.qty + " @ ₹" + t.price
      })))
      .concat(dividends.map(d => ({
        type: "DIV",
        date: d.date?.toDate ? d.date.toDate() : new Date(d.date),
        note: "Dividend ₹" + d.amount
      })))
      .concat(quoteEvents.map(q => ({
        type: "QUOTE",
        date: q.date,
        note: `Quote ₹${q.price.toLocaleString("en-IN")} (${q.src}${q.pct != null ? `, ${(q.pct > 0 ? "+" : "")}${q.pct.toFixed(2)}%` : ""})`
      })))
      .filter(x => x.date && !isNaN(x.date));
    rows.sort((a, b) => b.date - a.date);
    return rows;
  }, [trades, dividends, quoteEvents]);


  /* upside */
  const currentNum = toNum(current);
  const targetNum = toNum(target);
  const upside = (currentNum && targetNum) ? ((targetNum - currentNum) / currentNum) * 100 : null;

  /* notes */
  async function addNote() {
    const text = (noteText || "").trim();
    if (!text) return;
    const notesCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "notes");
    const refDoc = await addDoc(notesCol, { text, createdAt: serverTimestamp() });
    setNotes([{ id: refDoc.id, text, createdAt: new Date() }, ...notes]);
    setNoteText("");
  }

  /* thesis form */
  async function submitThesisForm() {
    const t = (thFormTitle || "").trim();
    const b = (thFormBody || "").trim();
    if (!t || !b) return;
    const thCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "theses");
    const refDoc = await addDoc(thCol, { title: t, body: b, createdAt: serverTimestamp() });
    setTheses([{ id: refDoc.id, title: t, body: b, createdAt: new Date() }, ...theses]);
    setThFormTitle(""); setThFormBody("");
  }

  /* uploads */
  function sanitizeName(name) { return name.replace(/[#[\]*?]/g, "_"); }
  async function onFiles(e) {
    const input = e.target;
    const list = Array.from(input.files || []);
    if (!list.length) return;
    if (!uid) { setErr("Please sign in first."); input.value = ""; return; }
    if (!storage) { setErr("Storage not initialized"); input.value = ""; return; }

    setUploadBusy(true); setUploadProgress(0); setErr(null);
    try {
      for (let k = 0; k < list.length; k++) {
        const f = list[k];
        const safe = Date.now() + "_" + sanitizeName(f.name);
        const path = "users/" + uid + "/portfolios/" + effectivePid + "/holdings/" + symbol + "/" + safe;
        const r = ref(storage, path);
        const meta = { contentType: f.type || "application/octet-stream" };

        await new Promise((resolve, reject) => {
          const task = uploadBytesResumable(r, f, meta);
          task.on("state_changed",
            (snap) => {
              const p = (snap.bytesTransferred / snap.totalBytes) * 100;
              setUploadProgress(Math.round(p));
            },
            (error) => { reject(error); },
            async () => {
              const url = await getDownloadURL(task.snapshot.ref);
              const fCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "files");
              const docData = { name: f.name, size: f.size, contentType: meta.contentType, url, storagePath: path, createdAt: serverTimestamp() };
              const created = await addDoc(fCol, docData);
              setFiles((prev) => [{ id: created.id, ...docData, createdAt: new Date() }, ...prev]);
              resolve();
            }
          );
        });
      }
    } catch (e) {
      setErr(typeof e.message === "string" ? e.message : String(e));
    } finally {
      setUploadBusy(false); setUploadProgress(0); input.value = "";
    }
  }

  if (!uid) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center">
          <p className="text-gray-600">Please sign in to view holding details.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />

      <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 min-h-screen">
        {/* sticky toolbar */}
        <div className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-indigo-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Link to="/insights" className="hover:underline">Portfolio</Link>
                <span>›</span>
                <span className="font-mono">{effectivePid}</span>
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{symbol}</h1>
                {savedTick && (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-semibold">Saved</span>
                )}
                {isDirty && !savedTick && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-xs font-semibold">Unsaved changes</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveCore}
                disabled={saving || !isDirty}
                className={
                  "px-5 py-2 rounded-xl font-semibold text-white transition-all " +
                  (saving || !isDirty
                    ? "bg-indigo-300 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700 shadow")
                }
                title="Ctrl/Cmd+S"
              >
                {saving ? "Saving…" : (isDirty ? "Save" : "Saved")}
              </button>
              <Link to="/dashboard" className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50">
                Back
              </Link>
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          {err && (
            <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-10 text-gray-500">Loading…</div>
          )}

          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Current</div>
              <div className="flex items-baseline gap-2">
                <div className="text-lg font-extrabold">
                  ₹{current ? Number(current).toLocaleString("en-IN") : "—"}
                </div>
                <button
                  onClick={handleRefresh}
                  className="text-[11px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50"
                  title="Refresh live price"
                >
                  Refresh
                </button>
              </div>

              {/* chips */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(live.change != null || live.pct != null) && (() => {
                  const sign = (live.change ?? 0) === 0 ? 0 : ((live.change ?? 0) > 0 ? 1 : -1);
                  const clr = sign > 0 ? "bg-emerald-100 text-emerald-700"
                    : sign < 0 ? "bg-rose-100 text-rose-700"
                      : "bg-gray-100 text-gray-600";
                  const ch = (live.change != null) ? (live.change > 0 ? "+" : "") + live.change.toFixed(2) : null;
                  const pc = (live.pct != null) ? (live.pct > 0 ? "+" : "") + live.pct.toFixed(2) + "%" : null;
                  return (
                    <span className={"px-2 py-0.5 rounded text-[11px] font-semibold " + clr}>
                      {ch}{ch && pc ? " • " : ""}{pc}
                    </span>
                  );
                })()}

                {live.pe != null && Number.isFinite(live.pe) && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700">
                    PE {live.pe.toFixed(2)}
                  </span>
                )}

                {live.sector && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-50 text-gray-700 border border-gray-200">
                    {live.sector}
                  </span>
                )}

                {live.src && (
                  <span className="px-2 py-0.5 rounded text-[11px] bg-gray-100 text-gray-600">
                    {live.src}
                  </span>
                )}
              </div>

              <div className="text-[11px] text-gray-500 mt-1.5">
                {live.busy ? "Fetching…" : (live.at ? `as of ${live.at.toLocaleTimeString()}` : "")}
                {live.err && <span className="text-rose-600"> • {live.err}</span>}
              </div>
            </div>

            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Target</div>
              <div className="text-lg font-extrabold">₹{target ? Number(target).toLocaleString("en-IN") : "—"}</div>
            </div>

            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Upside</div>
              <div className={"text-lg font-extrabold " + (upside != null && upside >= 0 ? "text-emerald-600" : "text-rose-600")}>
                {upside == null ? "—" : pct(upside)}
              </div>
            </div>

            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Conviction (Stars)</div>
              <div className="mt-1"><ConvictionStars value={conviction} onChange={(n) => setConviction(n)} /></div>
            </div>

            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Conviction (Slider)</div>
              <div className="flex items-center gap-2">
                <input
                  type="range" min="1" max="4" step="1" value={conviction}
                  onChange={(e) => setConviction(parseInt(e.target.value, 10))}
                  className="w-full mt-2 h-2 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background:
                      "linear-gradient(to right, rgb(79 70 229) 0%, rgb(79 70 229) " +
                      (((conviction - 1) / 3) * 100) + "%, rgb(229 231 235) " +
                      (((conviction - 1) / 3) * 100) + "%, rgb(229 231 235) 100%)"
                  }}
                />
                <span className={"px-2.5 py-0.5 rounded-full text-xs font-semibold " + convictionColors[conviction]}>
                  {convictionLabels[conviction]}
                </span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="grid md:grid-cols-5 gap-4">
            {/* Target */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Target Price</label>
              <div className="mt-2 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                <input
                  type="number"
                  className="w-full rounded-lg pl-8 pr-3 py-2.5 text-lg font-semibold bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={target}
                  onChange={(e) => { setTarget(e.target.value); }}
                  placeholder="2400"
                />
              </div>
            </div>

            {/* Current */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Current Price (manual override)</label>
              <div className="mt-2 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                <input
                  type="number"
                  className="w-full rounded-lg pl-8 pr-3 py-2.5 text-lg font-semibold bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={current}
                  onChange={(e) => { setManualOverride(true); setCurrent(e.target.value); }}
                  placeholder="Add current"
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                {manualOverride ? "Manual value active. Click Refresh to use live quote." : "You can override live quotes here."}
              </p>
            </div>

            {/* Upside */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Upside</label>
              <div className="mt-2 flex items-end justify-between">
                <div className="text-2xl font-extrabold">{upside == null ? "—" : pct(upside)}</div>
                <div className="text-xs text-gray-500 font-mono">
                  {(targetNum && currentNum) ? "(" + targetNum + " / " + currentNum + ")" : ""}
                </div>
              </div>
              <div className="mt-3 h-2 w-full rounded bg-gray-100 overflow-hidden">
                <div
                  className={"h-2 " + (upside != null && upside >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                  style={{ width: Math.min(Math.abs(upside || 0), 100) + "%" }}
                />
              </div>
            </div>

            {/* Tags */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 md:col-span-2">
              <label className="text-xs font-semibold text-gray-600">Tags</label>
              <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-indigo-200 text-indigo-700 bg-indigo-50">
                    {t}
                    <button className="ml-1" onClick={() => removeTag(t)} title="Remove">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text" onKeyDown={onTagKey}
                className="mt-2 w-full rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Type and press Enter"
              />
            </div>
          </div>

          {/* Notes / Thesis / Files */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Notes */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
              </div>
              <div className="flex gap-2">
                <input
                  value={noteText}
                  onChange={(e) => { setNoteText(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                  className="flex-1 rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  placeholder="Add a quick note (Enter to save)"
                />
                <button onClick={addNote} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
                  Add
                </button>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{notes.length} total</span>
                </div>
                <ul className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
                  {notes.map((n) => (
                    <li key={n.id} className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <div className="text-gray-800">{n.text}</div>
                      <div className="text-[11px] text-gray-500 mt-1">{fmtTs(n.createdAt)}</div>
                    </li>
                  ))}
                  {notes.length === 0 && <li className="text-sm text-gray-400">No notes yet.</li>}
                </ul>
              </div>
            </section>

            {/* Thesis form */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Add Investment Thesis</h3>
                <span className="text-xs text-gray-400">Stored in DB</span>
              </div>
              <input
                value={thFormTitle}
                onChange={(e) => { setThFormTitle(e.target.value); }}
                className="w-full rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm mb-2"
                placeholder="Title (e.g., FY27 rerating on margin expansion)"
              />
              <textarea
                value={thFormBody}
                onChange={(e) => { setThFormBody(e.target.value); }}
                className="w-full h-28 rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Summary, bull case, risks, catalysts…"
              />
              <div className="mt-3 flex justify-end">
                <button onClick={submitThesisForm} className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700">
                  Save Thesis
                </button>
              </div>

              <div className="mt-4 space-y-3 max-h-40 overflow-y-auto pr-1">
                {theses.map((t) => (
                  <div key={t.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-semibold text-gray-900 truncate">{t.title}</h4>
                      <span className="text-[11px] text-gray-500">{fmtTs(t.createdAt)}</span>
                    </div>
                    <div className="mt-2 text-sm text-gray-700 line-clamp-3">
                      <Preview md={t.body} />
                    </div>
                  </div>
                ))}
                {theses.length === 0 && <p className="text-sm text-gray-400">No theses yet.</p>}
              </div>
            </section>

            {/* Files & Research */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Files & Research</h3>
                <div className="text-xs text-gray-500">{files.length} files</div>
              </div>

              <label className="block">
                <div className={"border-2 border-dashed rounded-xl p-4 text-center " + (uploadBusy ? "border-indigo-300" : "border-gray-300 hover:border-indigo-400")}>
                  <div className="text-sm text-gray-600">Drag & drop or click to upload (PDFs, images, notes)</div>
                  <input type="file" multiple onChange={onFiles} className="hidden" />
                </div>
              </label>

              {uploadBusy && (
                <div className="mt-3 h-2 w-full bg-gray-100 rounded">
                  <div className="h-2 bg-indigo-600 rounded" style={{ width: uploadProgress + "%" }} />
                </div>
              )}

              <ul className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <a href={f.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-indigo-700 hover:underline truncate block">
                        {f.name}
                      </a>
                      <div className="text-[11px] text-gray-500">{(f.contentType || "")} • {bytes(f.size)}</div>
                    </div>
                    <a href={f.url} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100">Open</a>
                  </li>
                ))}
                {files.length === 0 && <li className="text-sm text-gray-400">No files yet.</li>}
              </ul>
            </section>
          </div>

          {/* Valuation Spreadsheet */}
          <ValuationSheet uid={uid} pid={effectivePid} symbol={symbol} />

          {/* Freeform Thesis + Preview */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600">Investment Thesis (Freeform)</label>
                <span className="text-xs text-gray-400">⌘/Ctrl + S</span>
              </div>
              <textarea
                className="w-full h-64 rounded-lg p-4 font-mono text-sm bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                value={thesis}
                onChange={(e) => { setThesis(e.target.value); }}
                placeholder={"# Why " + symbol + "?\n\n## Investment Case\n- Moat\n- Growth catalysts\n- Risks\n\n## Valuation\n- Target multiple\n- Comps"}
              />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5 overflow-hidden">
              <div className="text-xs font-semibold text-gray-600 mb-2">Preview</div>
              <div className="h-64 overflow-y-auto pr-2">
                {thesis ? <Preview md={thesis} /> : <div className="h-full grid place-items-center text-gray-400 text-sm">Start typing to see preview</div>}
              </div>
            </div>
          </div>

          {/* Activity Timeline */}
          <details className="bg-white rounded-xl border border-gray-200" open>
            <summary className="list-none p-5 cursor-pointer flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <h2 className="text-lg font-bold text-gray-900">Activity Timeline</h2>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">{timeline.length} events</span>
            </summary>

            <div className="p-5 pt-0">
              <div className="grid lg:grid-cols-3 gap-5">
                {/* Left: main timeline (2 cols on lg) */}
                <div className="lg:col-span-2">
                  {timeline.length === 0 ? (
                    <div className="py-8 text-center text-gray-600">No activity yet</div>
                  ) : (
                    <div className="relative pl-8 max-h-72 overflow-y-auto pr-2">
                      <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gradient-to-b from-indigo-200 via-purple-200 to-indigo-200" />
                      {timeline.map((e, i) => (
                        <div key={i} className="relative mb-4 last:mb-0">
                          <div className={
                            "absolute left-[-19px] mt-1 h-3 w-3 rounded-full " +
                            (e.type === "DIV" ? "bg-green-500 ring-4 ring-green-100"
                              : e.type === "QUOTE" ? "bg-amber-500 ring-4 ring-amber-100"
                                : "bg-indigo-600 ring-4 ring-indigo-100")
                          } />
                          <div className="bg-gray-50 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{e.note}</p>
                                <p className="text-xs text-gray-500">
                                  {e.date?.toLocaleString ? e.date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : String(e.date)}
                                </p>
                              </div>
                              <span className={
                                "flex-shrink-0 px-2 py-1 rounded text-[11px] font-semibold " +
                                (e.type === "DIV" ? "bg-green-100 text-green-700"
                                  : e.type === "QUOTE" ? "bg-amber-100 text-amber-700"
                                    : "bg-indigo-100 text-indigo-700")
                              }>
                                {e.type}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: Today panel */}
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-800">Today</h4>
                    <span className="text-[11px] text-gray-500">
                      {(() => {
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        const count = quoteEvents.filter(q => {
                          const d = new Date(q.date); d.setHours(0, 0, 0, 0);
                          return d.getTime() === today.getTime();
                        }).length;
                        return `${count} refresh${count === 1 ? "" : "es"}`;
                      })()}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {(() => {
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const todays = quoteEvents.filter(q => {
                        const d = new Date(q.date); d.setHours(0, 0, 0, 0);
                        return d.getTime() === today.getTime();
                      });
                      if (todays.length === 0) {
                        return <li className="text-xs text-gray-400">No refreshes logged today.</li>;
                      }
                      return todays.map((q, idx) => (
                        <li key={idx} className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">₹{q.price.toLocaleString("en-IN")}</span>
                            <span className="text-[10px] text-gray-500">{new Date(q.date).toLocaleTimeString()}</span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="px-1.5 py-0 rounded bg-gray-100 text-gray-600 text-[10px]">{q.src}</span>
                            {typeof q.pct === "number" && (
                              <span className={"px-1.5 py-0 rounded text-[10px] " + (q.pct > 0 ? "bg-emerald-100 text-emerald-700" : q.pct < 0 ? "bg-rose-100 text-rose-700" : "bg-gray-100 text-gray-600")}>
                                {(q.pct > 0 ? "+" : "") + q.pct.toFixed(2)}%
                              </span>
                            )}
                          </div>
                        </li>
                      ));
                    })()}
                  </ul>
                </div>
              </div>
            </div>

          </details>
        </main >
      </div >
    </>
  );
}
