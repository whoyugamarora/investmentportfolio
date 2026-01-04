import React, { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { Paper } from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import {
  faSpinner,
  faChartLine,
  faChartSimple,
  faDownload,
  faArrowTrendUp,
  faArrowTrendDown,
  faSackDollar,
  faMoneyBillWave,
  faPercent,
  faClipboard,
  faArrowRotateRight,
  faPlugCircleExclamation,
  faMagnifyingGlass,
  faFilter,
  faCircleInfo,
  faXmark,
  faKeyboard,
  faBolt,
  faFileCsv,
  faChevronLeft,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";

import ComparisonChart from "../Components/ComparisonChart";
import PieChart from "../Components/PieChart";
import PieChartSector from "../Components/PieChartSector";
import Heatmap from "../Components/Heatmap";
import HistoricalPerformance from "../Components/historicalperformance";
import TodayGainers from "../Components/Todaygainers";
import TodayLosers from "../Components/Todaylosers";
import SiteHeader from "../Components/SiteHeader";
import MetricBadge from "../Components/MetricBadge";
import DownloadPDF from "../Components/PortfolioPDF";
import RebalanceSection from "../Components/RebalanceSection";
import { toPng } from "html-to-image";
import { format as formatIndianNumber } from "indian-number-format";

import { signOut } from "firebase/auth";
import { auth, db } from "../Authentication/firebase";
import { syncHoldingsToFirestore } from "../lib/syncHoldingsToFirestore";
import { faLightbulb } from "@fortawesome/free-solid-svg-icons";


/* ---------------- helpers: cache ---------------- */
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const nowMs = () => Date.now();

function cacheKeyFor(pid) {
  return "dashboard:rows:v3:" + String(pid || "default");
}
function readCache(pid) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(pid));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.data)) return null;
    return obj;
  } catch {
    return null;
  }
}
function writeCache(pid, data) {
  try {
    localStorage.setItem(cacheKeyFor(pid), JSON.stringify({ ts: nowMs(), data }));
  } catch { }
}
function isFresh(ts) {
  return typeof ts === "number" && nowMs() - ts < TTL_MS;
}

/* ---------------- small UI primitives ---------------- */
const Card = ({ dark, className = "", children }) => (
  <div
    className={[
      "rounded-2xl border shadow-sm",
      dark ? "bg-white/5 border-white/10" : "bg-white border-black/10",
      className,
    ].join(" ")}
  >
    {children}
  </div>
);

const CardHeader = ({ title, subtitle, right, dark }) => (
  <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-4">
    <div className="min-w-0">
      {title && (
        <h2 className={["text-lg sm:text-xl font-semibold", dark ? "text-white" : "text-gray-900"].join(" ")}>
          {title}
        </h2>
      )}
      {subtitle && (
        <p className={["mt-1 text-sm", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>
          {subtitle}
        </p>
      )}
    </div>
    {right ? <div className="shrink-0">{right}</div> : null}
  </div>
);

const CardBody = ({ className = "", children }) => <div className={["px-5 pb-5", className].join(" ")}>{children}</div>;

const Pill = ({ tone = "neutral", children, dark }) => {
  const map = {
    neutral: dark ? "bg-white/10 text-gray-200" : "bg-gray-100 text-gray-700",
    good: dark ? "bg-emerald-500/15 text-emerald-200" : "bg-emerald-50 text-emerald-700",
    bad: dark ? "bg-rose-500/15 text-rose-200" : "bg-rose-50 text-rose-700",
    warn: dark ? "bg-amber-500/15 text-amber-200" : "bg-amber-50 text-amber-700",
    info: dark ? "bg-indigo-500/15 text-indigo-200" : "bg-indigo-50 text-indigo-700",
  };
  return (
    <span className={["inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold", map[tone]].join(" ")}>
      {children}
    </span>
  );
};

const StatTile = ({ label, value, icon, tone = "neutral", dark }) => {
  const toneMap = {
    neutral: dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10",
    good: dark ? "bg-emerald-500/10 border-emerald-400/20" : "bg-emerald-50 border-emerald-200",
    bad: dark ? "bg-rose-500/10 border-rose-400/20" : "bg-rose-50 border-rose-200",
  };
  const labelCls = dark ? "text-gray-300" : "text-gray-600";
  const valCls = dark ? "text-white" : "text-gray-900";

  return (
    <div className={["p-4 rounded-2xl border", toneMap[tone]].join(" ")}>
      <div className="flex items-center gap-3">
        <div className={["h-10 w-10 rounded-xl grid place-items-center", dark ? "bg-white/10" : "bg-white border border-black/5"].join(" ")}>
          <FontAwesomeIcon icon={icon} />
        </div>
        <div className="min-w-0">
          <div className={["text-xs uppercase tracking-wide font-semibold", labelCls].join(" ")}>{label}</div>
          <div className={["text-xl sm:text-2xl font-extrabold leading-tight", valCls].join(" ")}>{value}</div>
        </div>
      </div>
    </div>
  );
};

const SegBar = ({ profit, loss }) => {
  const total = profit + loss;
  const pPct = total ? (profit / total) * 100 : 0;
  const lPct = total ? (loss / total) * 100 : 0;
  return (
    <div className="w-full rounded-full h-9 bg-gray-200 dark:bg-white/10 overflow-hidden flex">
      {profit > 0 && (
        <div className="h-full bg-emerald-500 text-white text-sm font-bold grid place-items-center" style={{ width: pPct + "%" }}>
          {pPct.toFixed(1)}%
        </div>
      )}
      {loss > 0 && (
        <div className="h-full bg-rose-500 text-white text-sm font-bold grid place-items-center" style={{ width: lPct + "%" }}>
          {lPct.toFixed(1)}%
        </div>
      )}
    </div>
  );
};

const TabButton = ({ active, children, onClick }) => (
  <button
    onClick={onClick}
    className={[
      "px-3 sm:px-4 py-2 rounded-xl text-sm font-semibold transition-colors",
      active
        ? "bg-indigo-600 text-white"
        : "bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-white/10 dark:hover:bg-white/15 dark:text-gray-200",
    ].join(" ")}
  >
    {children}
  </button>
);

const SkeletonBlock = ({ className = "" }) => (
  <div className={["animate-pulse rounded-2xl", className].join(" ")} />
);

/* ---------------- tiny toast ---------------- */
const Toast = ({ dark, toast, onClose }) => {
  if (!toast) return null;
  const tone =
    toast.type === "success"
      ? dark
        ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-100"
        : "bg-emerald-50 border-emerald-200 text-emerald-900"
      : toast.type === "error"
        ? dark
          ? "bg-rose-500/15 border-rose-400/30 text-rose-100"
          : "bg-rose-50 border-rose-200 text-rose-900"
        : dark
          ? "bg-white/10 border-white/15 text-gray-100"
          : "bg-white border-black/10 text-gray-900";

  return (
    <div className="fixed bottom-5 right-5 z-[80]">
      <div className={["max-w-sm rounded-2xl border shadow-lg px-4 py-3 flex items-start gap-3", tone].join(" ")}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-extrabold">{toast.title || "Notice"}</div>
          {toast.message ? <div className={["mt-0.5 text-sm", dark ? "text-gray-200" : "text-gray-700"].join(" ")}>{toast.message}</div> : null}
        </div>
        <button
          onClick={onClose}
          className={["shrink-0 px-2 py-1 rounded-xl text-sm font-bold", dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200"].join(" ")}
          title="Close"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
    </div>
  );
};

/* ---------------- CSV export ---------------- */
function toCsvValue(v) {
  const s = v === null || v === undefined ? "" : String(v);
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}
function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/* ---------------- main ---------------- */
const Dashboard = () => {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const pid = sp.get("pid") || "default";
  const GOOGLE_SHEETS_URL = process.env.REACT_APP_SPREADSHEET_URL;

  const [uid, setUid] = useState(null);

  // Apps Script rows (for Firestore sync)
  const [appsRows, setAppsRows] = useState([]);

  // Dashboard rows
  const [data, setData] = useState([]);
  const [weightedPE, setWeightedPE] = useState("0.00");

  const [isLoading, setIsLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  const [lastUpdated, setLastUpdated] = useState(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  const pieChartRef = useRef(null);
  const comparisonChartRef = useRef(null);
  const [chartImages, setChartImages] = useState({ pie: "", comparison: "" });

  const [selectedChart, setSelectedChart] = useState("Stocks");

  // Pro UX
  const [q, setQ] = useState("");
  const [showOnly, setShowOnly] = useState("ALL"); // ALL | GAINERS | LOSERS | COMFORTABLE | UNCOMFORTABLE
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // NEW: pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // NEW: toast
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (t) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const openHolding = (row) => {
    setSelectedHolding(row);
    setDrawerOpen(true);
  };
  const closeHolding = () => setDrawerOpen(false);

  const money = (n) => "₹" + formatIndianNumber(Number(n || 0).toFixed(0));
  const pct = (n) => Number(n || 0).toFixed(2) + "%";

  /* online/offline */
  useEffect(() => {
    function goOnline() {
      setOnline(true);
      showToast({ type: "info", title: "Back online", message: "You can refresh to fetch latest data." });
    }
    function goOffline() {
      setOnline(false);
      showToast({ type: "info", title: "Offline", message: "Showing cached data (if available)." });
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* auth */
  useEffect(() => auth.onAuthStateChanged((u) => setUid(u?.uid || null)), []);

  /* Apps Script -> rows (for Firestore sync) */
  useEffect(() => {
    let alive = true;
    (async function () {
      try {
        const url = process.env.REACT_APP_SPREADSHEET_URL;
        const res = await fetch(url);
        const json = await res.json();
        if (!alive) return;
        setAppsRows(Array.isArray(json) ? json : []);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* push into Firestore */
  useEffect(() => {
    if (!uid || !appsRows.length) return;
    syncHoldingsToFirestore({ db, uid, pid, rows: appsRows });
  }, [uid, pid, appsRows]);

  /* recompute */
  function recompute(rows) {
    const cleaned = rows.map((item) => ({
      ...item,
      "Current Value": Number(item["Current Value"] || 0),
      "Profit/Loss": Number(item["Profit/Loss"] || 0),
      "Buy Value": Number(item["Buy Value"] || 0),
      Quantity: Number(item["Quantity"] || 0),
      PE: Number(item["PE"] || 0),
      PorLpercent: !isNaN(Number(item["PorLpercent"])) ? Number(item["PorLpercent"]) : 0,
      "Day Gain": !isNaN(Number(item["Day Gain"])) ? Number(item["Day Gain"]) : 0,
      "Buy Price": Number(item["Buy Price"] || item["Buy price"] || 0),
      "Current Price": Number(item["Current Price"] || item["Current price"] || 0),
    }));
    setData(cleaned);

    // weighted PE
    let totalWeightedPE = 0;
    let totalValue = 0;
    for (let i = 0; i < cleaned.length; i++) {
      const sv = cleaned[i]["Current Value"];
      const pe = cleaned[i]["PE"];
      if (sv && pe) {
        totalWeightedPE += pe * sv;
        totalValue += sv;
      }
    }
    const wpe = totalValue ? totalWeightedPE / totalValue : 0;
    setWeightedPE(wpe.toFixed(2));
  }

  /* cache boot + fetch */
  useEffect(() => {
    const cached = readCache(pid);
    if (cached) {
      recompute(cached.data);
      setLastUpdated(new Date(cached.ts));
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    const shouldFetch = online && (!cached || !isFresh(cached.ts));
    if (!shouldFetch) return;

    (async function () {
      try {
        const resp = await axios.get(GOOGLE_SHEETS_URL);
        const rows = Array.isArray(resp.data) ? resp.data : [];
        recompute(rows);
        setLastUpdated(new Date());
        writeCache(pid, rows);
      } catch {
        // keep cache view
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [GOOGLE_SHEETS_URL, pid, online]);

  async function refreshNow() {
    if (!online) {
      showToast({ type: "error", title: "You’re offline", message: "Connect to internet to refresh." });
      return;
    }
    setIsLoading(true);
    try {
      const resp = await axios.get(GOOGLE_SHEETS_URL);
      const rows = Array.isArray(resp.data) ? resp.data : [];
      recompute(rows);
      setLastUpdated(new Date());
      writeCache(pid, rows);
      showToast({ type: "success", title: "Refreshed", message: "Latest data fetched and cached." });
    } catch {
      showToast({ type: "error", title: "Refresh failed", message: "Keeping cached data." });
    } finally {
      setIsLoading(false);
    }
  }

  const generateChartImages = async () => {
    try {
      const pieImage = await toPng(pieChartRef.current, { cacheBust: true });
      const comparisonImage = await toPng(comparisonChartRef.current, { cacheBust: true });
      setChartImages({ pie: pieImage, comparison: comparisonImage });
      showToast({ type: "success", title: "Charts ready", message: "You can export PDF now." });
    } catch {
      showToast({ type: "error", title: "Export prep failed", message: "Could not capture chart images." });
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  /* keyboard shortcuts:
     / focus search
     r refresh
     e prepare charts
     esc close drawer/modals
     ? toggle shortcuts
  */
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || e.target?.isContentEditable;

      if (e.key === "Escape") {
        closeHolding();
        setShowShortcuts(false);
        return;
      }

      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        const el = document.getElementById("holdings-search");
        if (el) el.focus();
      }
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
      if (e.key.toLowerCase() === "r") refreshNow();
      if (e.key.toLowerCase() === "e") generateChartImages();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  /* derived totals */
  const totals = useMemo(() => {
    const t = {
      current: 0,
      buy: 0,
      pnl: 0,
      dayGain: 0,
      pos: 0,
      negAbs: 0,
      count: data.length,
      cash: 0,
    };
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const cv = Number(r["Current Value"] || 0);
      const bv = Number(r["Buy Value"] || 0);
      const pl = Number(r["Profit/Loss"] || 0);
      const dg = Number(r["Day Gain"] || 0);
      t.current += cv;
      t.buy += bv;
      t.pnl += pl;
      t.dayGain += dg;
      if (pl >= 0) t.pos += pl;
      else t.negAbs += Math.abs(pl);

      const name = String(r.Company || "").toLowerCase();
      const isCash = name === "cash" || name.includes("cash ");
      if (isCash) t.cash += cv;
    }
    return {
      ...t,
      current0: Number(t.current.toFixed(0)),
      buy0: Number(t.buy.toFixed(0)),
      pnl0: Number(t.pnl.toFixed(0)),
      dayGain0: Number(t.dayGain.toFixed(0)),
      cash0: Number(t.cash.toFixed(0)),
    };
  }, [data]);

  const totalReturnPct = useMemo(() => {
    if (!totals.buy) return 0;
    return Number(((totals.pnl / totals.buy) * 100).toFixed(2));
  }, [totals.buy, totals.pnl]);

  const todayReturnPct = useMemo(() => {
    if (!totals.current) return 0;
    return Number(((totals.dayGain / totals.current) * 100).toFixed(2));
  }, [totals.dayGain, totals.current]);

  const comfortableCompanies = useMemo(() => data.filter((c) => c.Valuation === "Comfortable"), [data]);
  const uncomfortableCompanies = useMemo(() => data.filter((c) => c.Valuation === "Uncomfortable"), [data]);

  /* insights */
  const insights = useMemo(() => {
    if (!data.length) {
      return {
        topDayGainer: null,
        topDayLoser: null,
        biggest: null,
        biggestPct: 0,
        cashPct: 0,
      };
    }
    let g = null;
    let l = null;
    let b = null;

    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const dg = Number(r["Day Gain"] || 0);
      const cv = Number(r["Current Value"] || 0);

      if (!g || dg > Number(g["Day Gain"] || 0)) g = r;
      if (!l || dg < Number(l["Day Gain"] || 0)) l = r;
      if (!b || cv > Number(b["Current Value"] || 0)) b = r;
    }

    const biggestPct = totals.current ? Number(((Number(b?.["Current Value"] || 0) / totals.current) * 100).toFixed(2)) : 0;
    const cashPct = totals.current ? Number(((totals.cash / totals.current) * 100).toFixed(2)) : 0;

    return { topDayGainer: g, topDayLoser: l, biggest: b, biggestPct, cashPct };
  }, [data, totals.current, totals.cash]);

  /* filtered table */
  const filteredHoldings = useMemo(() => {
    const term = q.trim().toLowerCase();
    let rows = data;

    if (term) rows = rows.filter((r) => String(r.Company || "").toLowerCase().includes(term));

    if (showOnly === "GAINERS") rows = rows.filter((r) => Number(r["Profit/Loss"] || 0) >= 0);
    if (showOnly === "LOSERS") rows = rows.filter((r) => Number(r["Profit/Loss"] || 0) < 0);
    if (showOnly === "COMFORTABLE") rows = rows.filter((r) => r.Valuation === "Comfortable");
    if (showOnly === "UNCOMFORTABLE") rows = rows.filter((r) => r.Valuation === "Uncomfortable");

    return rows;
  }, [data, q, showOnly]);

  // NEW: reset pagination when filters/search/pageSize change
  useEffect(() => {
    setPage(1);
  }, [q, showOnly, pageSize]);

  const pageCount = useMemo(() => {
    return Math.max(1, Math.ceil(filteredHoldings.length / pageSize));
  }, [filteredHoldings.length, pageSize]);

  const pagedHoldings = useMemo(() => {
    const p = Math.min(page, pageCount);
    const start = (p - 1) * pageSize;
    return filteredHoldings.slice(start, start + pageSize);
  }, [filteredHoldings, page, pageSize, pageCount]);

  const handleSort = (key) => {
    const direction = sortConfig.key === key && sortConfig.direction === "asc" ? "desc" : "asc";
    const sorted = [...data].sort((a, b) => {
      if (a[key] < b[key]) return direction === "asc" ? -1 : 1;
      if (a[key] > b[key]) return direction === "asc" ? 1 : -1;
      return 0;
    });
    setData(sorted);
    setSortConfig({ key, direction });
  };

  // NEW: export CSV for filtered holdings (respects search + quick filters)
  const exportCsv = () => {
    try {
      const rows = filteredHoldings;
      const headers = [
        "Company",
        "Company Code",
        "Quantity",
        "Buy Price",
        "Current Price",
        "Buy Value",
        "Current Value",
        "Profit/Loss",
        "PorLpercent",
        "Day Gain",
        "PE",
        "Valuation",
      ];

      const lines = [];
      lines.push(headers.map(toCsvValue).join(","));

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const line = [
          r.Company,
          r["Company Code"],
          r.Quantity ?? r["Quantity"],
          r["Buy Price"],
          r["Current Price"],
          r["Buy Value"],
          r["Current Value"],
          r["Profit/Loss"],
          r.PorLpercent,
          r["Day Gain"],
          r.PE,
          r.Valuation,
        ].map(toCsvValue);
        lines.push(line.join(","));
      }

      const filename = `holdings_${pid}_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadTextFile(filename, lines.join("\n"), "text/csv;charset=utf-8");
      showToast({ type: "success", title: "CSV exported", message: `${rows.length} rows exported.` });
    } catch {
      showToast({ type: "error", title: "CSV export failed", message: "Could not generate CSV." });
    }
  };

  const dark = darkMode;

  return (
    <div className={["min-h-screen", dark ? "bg-gray-950 text-gray-100" : "bg-gray-50 text-gray-900"].join(" ")}>
      <SiteHeader title="Portfolio Tracker" darkMode={dark} onToggleDarkMode={() => setDarkMode((v) => !v)} onLogout={handleLogout} />

      <Toast dark={dark} toast={toast} onClose={() => setToast(null)} />

      {/* HERO */}
      <div className={["border-b", dark ? "border-white/10" : "border-black/10"].join(" ")}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="rounded-3xl overflow-hidden relative">
            <div
              className={[
                "absolute inset-0",
                dark ? "bg-gradient-to-r from-indigo-600/30 via-cyan-500/15 to-emerald-500/10" : "bg-gradient-to-r from-indigo-600/15 via-cyan-500/10 to-emerald-500/10",
              ].join(" ")}
            />
            <div className={["relative p-5 sm:p-7", dark ? "bg-white/5" : "bg-white"].join(" ")}>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl sm:text-3xl font-extrabold">Dashboard</h1>
                    <Pill tone={online ? "good" : "warn"} dark={dark}>
                      {online ? "Online" : "Offline"}
                      {!online && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <FontAwesomeIcon icon={faPlugCircleExclamation} />
                        </span>
                      )}
                    </Pill>
                    {insights.cashPct > 0 ? <Pill tone="info" dark={dark}>Cash {insights.cashPct}%</Pill> : null}
                  </div>

                  <p className={["mt-1 text-sm", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>
                    {lastUpdated ? "Last update: " + lastUpdated.toLocaleString() : "—"} · Portfolio ID:{" "}
                    <span className={dark ? "text-gray-200" : "text-gray-800"}>{pid}</span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowShortcuts(true)}
                    className={[
                      "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-semibold",
                      dark ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-black/10 bg-white hover:bg-gray-50",
                    ].join(" ")}
                    title="Shortcuts (?)"
                  >
                    <FontAwesomeIcon icon={faKeyboard} />
                    Shortcuts
                  </button>

                  <button
                    onClick={refreshNow}
                    disabled={!online}
                    className={[
                      "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-semibold",
                      online ? "border-indigo-600 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20" : "border-gray-300 text-gray-400 cursor-not-allowed",
                    ].join(" ")}
                    title={online ? "Fetch latest and update cache (R)" : "You are offline"}
                  >
                    <FontAwesomeIcon icon={faArrowRotateRight} />
                    Refresh
                  </button>

                  <button
                    onClick={() =>
                      navigate("/insights?pid=" + encodeURIComponent(pid), {
                        state: { data, darkMode: dark },
                      })
                    }
                    className={[
                      "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-semibold",
                      dark ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-black/10 bg-white hover:bg-gray-50",
                    ].join(" ")}
                    title="Open Insights"
                  >
                    <FontAwesomeIcon icon={faLightbulb} />
                    Insights
                  </button>


                  <button
                    onClick={generateChartImages}
                    className={[
                      "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-semibold",
                      dark ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-black/10 bg-white hover:bg-gray-50",
                    ].join(" ")}
                    title="Prepare charts for export (E)"
                  >
                    <FontAwesomeIcon icon={faDownload} />
                    Prepare Charts
                  </button>

                  <DownloadPDF data={data} chartImages={chartImages} />
                </div>
              </div>

              {/* KPI grid */}
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile dark={dark} label="Portfolio Value" value={"₹" + formatIndianNumber(totals.current0)} icon={faSackDollar} />
                <StatTile dark={dark} label="Invested" value={"₹" + formatIndianNumber(totals.buy0)} icon={faMoneyBillWave} />
                <StatTile
                  dark={dark}
                  label="Total P/L"
                  value={"₹" + formatIndianNumber(totals.pnl0)}
                  icon={totals.pnl0 >= 0 ? faArrowTrendUp : faArrowTrendDown}
                  tone={totals.pnl0 >= 0 ? "good" : "bad"}
                />
                <StatTile dark={dark} label="Total Return" value={totalReturnPct + "%"} icon={faPercent} tone={totalReturnPct >= 0 ? "good" : "bad"} />
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
                <StatTile
                  dark={dark}
                  label="Today P/L"
                  value={"₹" + formatIndianNumber(totals.dayGain0)}
                  icon={totals.dayGain0 >= 0 ? faArrowTrendUp : faArrowTrendDown}
                  tone={totals.dayGain0 >= 0 ? "good" : "bad"}
                />
                <StatTile dark={dark} label="Today %" value={todayReturnPct + "%"} icon={faPercent} tone={todayReturnPct >= 0 ? "good" : "bad"} />
                <StatTile dark={dark} label="Weighted P/E" value={weightedPE} icon={faChartSimple} tone={Number(weightedPE) <= 50 ? "good" : "bad"} />
              </div>

              {/* Profit vs Loss */}
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className={["text-sm font-semibold", dark ? "text-gray-200" : "text-gray-700"].join(" ")}>
                    Profit vs Loss distribution
                  </div>
                  <div className="inline-flex items-center gap-2 text-xs">
                    <Pill dark={dark} tone="good">Profit {money(Math.round(totals.pos))}</Pill>
                    <Pill dark={dark} tone="bad">Loss {money(Math.round(totals.negAbs))}</Pill>
                  </div>
                </div>
                <SegBar profit={Number(totals.pos)} loss={Number(totals.negAbs)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Command Bar */}
      <div className={["sticky top-0 z-30", dark ? "bg-gray-950/70" : "bg-gray-50/70"].join(" ")}>
        <div className={["backdrop-blur border-b", dark ? "border-white/10" : "border-black/10"].join(" ")}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill dark={dark} tone="neutral">
                <FontAwesomeIcon icon={faBolt} className="mr-2" />
                Command Bar
              </Pill>
              <Pill dark={dark} tone="neutral">/ Search</Pill>
              <Pill dark={dark} tone="neutral">R Refresh</Pill>
              <Pill dark={dark} tone="neutral">E Export</Pill>
              <Pill dark={dark} tone="neutral">Esc Close</Pill>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowShortcuts(true)}
                className={[
                  "px-3 py-2 rounded-xl text-sm font-bold border",
                  dark ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200" : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
                ].join(" ")}
              >
                <FontAwesomeIcon icon={faKeyboard} className="mr-2" />
                Shortcuts (?)
              </button>
              <button
                onClick={refreshNow}
                disabled={!online}
                className={[
                  "px-3 py-2 rounded-xl text-sm font-bold border",
                  online
                    ? dark
                      ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200"
                      : "bg-white border-black/10 hover:bg-gray-50 text-gray-800"
                    : "border-gray-300 text-gray-400 cursor-not-allowed bg-transparent",
                ].join(" ")}
              >
                <FontAwesomeIcon icon={faArrowRotateRight} className="mr-2" />
                Refresh
              </button>
              <button
                onClick={generateChartImages}
                className={[
                  "px-3 py-2 rounded-xl text-sm font-bold border",
                  dark ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200" : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
                ].join(" ")}
              >
                <FontAwesomeIcon icon={faDownload} className="mr-2" />
                Prepare Charts
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {isLoading ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <SkeletonBlock className={dark ? "bg-white/10 h-24" : "bg-black/5 h-24"} />
              <SkeletonBlock className={dark ? "bg-white/10 h-24" : "bg-black/5 h-24"} />
              <SkeletonBlock className={dark ? "bg-white/10 h-24" : "bg-black/5 h-24"} />
              <SkeletonBlock className={dark ? "bg-white/10 h-24" : "bg-black/5 h-24"} />
            </div>
            <SkeletonBlock className={dark ? "bg-white/10 h-72" : "bg-black/5 h-72"} />
            <div className="flex justify-center items-center h-24">
              <FontAwesomeIcon icon={faSpinner} className="fa-spin text-2xl" />
            </div>
          </>
        ) : (
          <>
            {/* Holdings */}
            <Card dark={dark}>
              <CardHeader
                dark={dark}
                title="Holdings"
                subtitle="Click any row for a quick details drawer."
                right={
                  <div className="flex items-center gap-2">
                    <Pill dark={dark} tone="neutral">
                      <FontAwesomeIcon icon={faCircleInfo} className="mr-2" />
                      {filteredHoldings.length}/{data.length} shown
                    </Pill>

                    {/* NEW: CSV export */}
                    <button
                      onClick={exportCsv}
                      className={[
                        "px-3 py-2 rounded-xl text-sm font-extrabold border inline-flex items-center gap-2",
                        dark ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200" : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
                      ].join(" ")}
                      title="Export filtered holdings as CSV"
                    >
                      <FontAwesomeIcon icon={faFileCsv} />
                      CSV
                    </button>
                  </div>
                }
              />
              <CardBody>
                <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between mb-4">
                  {/* Search */}
                  <div className="w-full lg:max-w-md">
                    <div className={["flex items-center gap-2 px-3 py-2 rounded-2xl border", dark ? "bg-white/5 border-white/10" : "bg-white border-black/10"].join(" ")}>
                      <FontAwesomeIcon icon={faMagnifyingGlass} className={dark ? "text-gray-300" : "text-gray-500"} />
                      <input
                        id="holdings-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search holdings… (press /)"
                        className={["w-full bg-transparent outline-none text-sm", dark ? "placeholder:text-gray-500" : "placeholder:text-gray-400"].join(" ")}
                      />
                      {q ? (
                        <button
                          onClick={() => setQ("")}
                          className={["text-xs font-semibold px-2 py-1 rounded-lg", dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200"].join(" ")}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Quick filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={["inline-flex items-center gap-2 text-xs font-semibold", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>
                      <FontAwesomeIcon icon={faFilter} /> Quick filters
                    </span>

                    {[
                      { key: "ALL", label: "All" },
                      { key: "GAINERS", label: "Gainers" },
                      { key: "LOSERS", label: "Losers" },
                      { key: "COMFORTABLE", label: "Comfortable" },
                      { key: "UNCOMFORTABLE", label: "Uncomfortable" },
                    ].map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setShowOnly(f.key)}
                        className={[
                          "px-3 py-2 rounded-xl text-xs font-bold border transition-colors",
                          showOnly === f.key
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : dark
                              ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200"
                              : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
                        ].join(" ")}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table */}
                <div className={["overflow-x-auto rounded-2xl border", dark ? "border-white/10" : "border-black/10"].join(" ")}>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className={dark ? "bg-gray-900/80 text-gray-300" : "bg-gray-50 text-gray-600"}>
                        {[
                          { label: "Asset", key: "Company", align: "left" },
                          { label: "Qty", key: "Quantity", align: "center" },
                          { label: "Buy ₹", key: "Buy Price", align: "right" },
                          { label: "Current ₹", key: "Current Price", align: "right" },
                          { label: "Buy Value", key: "Buy Value", align: "right" },
                          { label: "Current Value", key: "Current Value", align: "right" },
                          { label: "P/L ₹", key: "Profit/Loss", align: "right" },
                          { label: "P/L %", key: "PorLpercent", align: "center" },
                        ].map((h) => (
                          <th
                            key={h.key}
                            onClick={() => handleSort(h.key)}
                            className={[
                              "px-3 py-3 font-extrabold whitespace-nowrap cursor-pointer select-none",
                              h.align === "right" ? "text-right" : h.align === "center" ? "text-center" : "text-left",
                            ].join(" ")}
                            title="Sort"
                          >
                            {h.label}
                            {sortConfig.key === h.key && (sortConfig.direction === "asc" ? " ▲" : " ▼")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedHoldings.length === 0 ? (
                        <tr>
                          <td colSpan={8} className={["px-4 py-10 text-center", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>
                            No matches. Try clearing search or changing filters.
                          </td>
                        </tr>
                      ) : (
                        pagedHoldings.map((row, i) => {
                          const pos = Number(row["Profit/Loss"]) >= 0;
                          const zebra = i % 2 === 0;
                          return (
                            <tr
                              key={i}
                              onClick={() => openHolding(row)}
                              className={[
                                "cursor-pointer border-t",
                                dark ? "border-white/10" : "border-black/5",
                                dark ? (zebra ? "bg-white/[0.03]" : "bg-transparent") : zebra ? "bg-white" : "bg-gray-50/40",
                                "hover:bg-black/5 dark:hover:bg-white/5",
                              ].join(" ")}
                            >
                              <td className="px-3 py-3 font-semibold whitespace-nowrap">
                                <span onClick={(e) => e.stopPropagation()}>
                                  <a
                                    href={"https://www.tradingview.com/chart/?symbol=" + (row["Company Code"] || "")}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-1"
                                    title="Open in TradingView"
                                  >
                                    <FontAwesomeIcon icon={faChartLine} />
                                  </a>
                                  <a
                                    href={"https://www.screener.in/company/" + String(row["Company Code"] || "").replace("NSE:", "") + "/consolidated/"}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-1 text-green-700"
                                    title="Open in Screener"
                                  >
                                    <FontAwesomeIcon icon={faChartSimple} />
                                  </a>
                                  <Link to={"/holding/" + row.Company + "?pid=" + encodeURIComponent(pid)} title="Open holding page">
                                    <FontAwesomeIcon icon={faClipboard} className={"mx-2 " + (dark ? "text-white" : "text-black")} />
                                  </Link>
                                </span>

                                <span className="ml-1">{row.Company}</span>

                                {row.Valuation ? (
                                  <span className="ml-2">
                                    <Pill dark={dark} tone={row.Valuation === "Comfortable" ? "good" : row.Valuation === "Uncomfortable" ? "bad" : "neutral"}>
                                      {row.Valuation}
                                    </Pill>
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-3 text-center">{row["Quantity"]}</td>
                              <td className="px-3 py-3 text-right">₹{Number(row["Buy Price"] || 0).toFixed(2)}</td>
                              <td className="px-3 py-3 text-right">₹{Number(row["Current Price"] || 0).toFixed(2)}</td>
                              <td className="px-3 py-3 text-right font-extrabold">₹{formatIndianNumber(Number(row["Buy Value"] || 0).toFixed(0))}</td>
                              <td className="px-3 py-3 text-right font-extrabold">₹{formatIndianNumber(Number(row["Current Value"] || 0).toFixed(0))}</td>
                              <td className={["px-3 py-3 text-right font-extrabold", pos ? "text-emerald-600" : "text-rose-600"].join(" ")}>
                                ₹{formatIndianNumber(Number(row["Profit/Loss"] || 0).toFixed(0))}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <div className="inline-block scale-95">
                                  <MetricBadge label="" value={Number(row.PorLpercent || 0).toFixed(2) + "%"} good={Number(row.PorLpercent || 0) >= 0} />
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* NEW: Pagination controls */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={["text-xs font-bold", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>Rows</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className={[
                        "px-3 py-2 rounded-xl text-sm font-bold border outline-none",
                        dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                      ].join(" ")}
                    >
                      {[25, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>

                    <span className={["text-xs", dark ? "text-gray-400" : "text-gray-500"].join(" ")}>
                      Page {Math.min(page, pageCount)} / {pageCount}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className={[
                        "px-3 py-2 rounded-xl text-sm font-extrabold border inline-flex items-center gap-2",
                        page <= 1
                          ? dark
                            ? "bg-white/5 border-white/10 text-gray-500 cursor-not-allowed"
                            : "bg-gray-100 border-black/10 text-gray-400 cursor-not-allowed"
                          : dark
                            ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200"
                            : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
                      ].join(" ")}
                    >
                      <FontAwesomeIcon icon={faChevronLeft} />
                      Prev
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={page >= pageCount}
                      className={[
                        "px-3 py-2 rounded-xl text-sm font-extrabold border inline-flex items-center gap-2",
                        page >= pageCount
                          ? dark
                            ? "bg-white/5 border-white/10 text-gray-500 cursor-not-allowed"
                            : "bg-gray-100 border-black/10 text-gray-400 cursor-not-allowed"
                          : dark
                            ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200"
                            : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
                      ].join(" ")}
                    >
                      Next
                      <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card dark={dark}>
                <CardHeader dark={dark} title="Portfolio vs CNX 500 (Normalized) — 3M" subtitle="Performance relative to benchmark (normalized)." />
                <CardBody>
                  <div ref={comparisonChartRef} className="h-[460px] md:h-[520px]">
                    <ComparisonChart darkMode={dark} />
                  </div>
                </CardBody>
              </Card>

              <Card dark={dark}>
                <CardHeader
                  dark={dark}
                  title="Portfolio Distribution"
                  subtitle="Switch between stock and sector allocation."
                  right={
                    <div className="flex gap-2">
                      <TabButton active={selectedChart === "Stocks"} onClick={() => setSelectedChart("Stocks")}>
                        Stocks
                      </TabButton>
                      <TabButton active={selectedChart === "Sector"} onClick={() => setSelectedChart("Sector")}>
                        Sector
                      </TabButton>
                    </div>
                  }
                />
                <CardBody>
                  <Paper
                    elevation={0}
                    ref={pieChartRef}
                    style={{
                      padding: "0.5rem",
                      borderRadius: "18px",
                      boxShadow: "none",
                      textAlign: "center",
                      backgroundColor: dark ? "rgba(255,255,255,0.04)" : "#FFFFFF",
                      border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
                      height: "520px",
                    }}
                  >
                    <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: "14px" }}>
                      {selectedChart === "Stocks" ? <PieChart data={data} darkMode={dark} /> : <PieChartSector data={data} darkMode={dark} />}
                    </div>
                  </Paper>
                </CardBody>
              </Card>
            </div>

            {/* Heatmap + Historical */}
            <div className="grid grid-cols-1 gap-6">
              <Card dark={dark}>
                <CardHeader dark={dark} title="Heatmap" subtitle="Quick scan for concentration and movers. Click tiles for details." />
                <CardBody>
                  <Heatmap data={data} darkMode={dark} onTileClick={(t) => navigate("/holding/" + t.name)} />
                </CardBody>
              </Card>

              <Card dark={dark}>
                <CardHeader dark={dark} title="Historical Performance" subtitle="Longer-term view of portfolio progress." />
                <CardBody>
                  <HistoricalPerformance />
                </CardBody>
              </Card>
            </div>

            {/* Gainers / Losers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card dark={dark}>
                <CardHeader dark={dark} title="Today's Gainers" subtitle="Top positive contributors." />
                <CardBody>
                  <TodayGainers data={data} darkMode={dark} />
                </CardBody>
              </Card>

              <Card dark={dark}>
                <CardHeader dark={dark} title="Today's Losers" subtitle="Top negative contributors." />
                <CardBody>
                  <TodayLosers data={data} darkMode={dark} />
                </CardBody>
              </Card>
            </div>

            {/* Rebalance */}
            <Card dark={dark}>
              <CardHeader dark={dark} title="Rebalance (Ideal vs Current)" subtitle="See drift and suggested moves." />
              <CardBody>
                <RebalanceSection data={data} darkMode={dark} />
              </CardBody>
            </Card>

            {/* Valuation buckets */}
            <Card dark={dark}>
              <CardHeader dark={dark} title="Valuation Buckets" subtitle="Quick segmentation using your Comfortable/Uncomfortable tags." />
              <CardBody>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className={["p-4 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-extrabold text-lg">Comfortable</h3>
                      <Pill dark={dark} tone="good">{comfortableCompanies.length}</Pill>
                    </div>
                    {comfortableCompanies.length ? (
                      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {comfortableCompanies.map((c, idx) => (
                          <li
                            key={idx}
                            className={["text-center text-sm rounded-xl py-2 px-3 font-semibold", dark ? "bg-emerald-500/10 text-emerald-200" : "bg-emerald-50 text-emerald-700"].join(" ")}
                          >
                            {c.Company}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={dark ? "text-gray-400" : "text-gray-600"}>No companies in this bucket.</p>
                    )}
                  </div>

                  <div className={["p-4 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-extrabold text-lg">Uncomfortable</h3>
                      <Pill dark={dark} tone="bad">{uncomfortableCompanies.length}</Pill>
                    </div>
                    {uncomfortableCompanies.length ? (
                      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {uncomfortableCompanies.map((c, idx) => (
                          <li
                            key={idx}
                            className={["text-center text-sm rounded-xl py-2 px-3 font-semibold", dark ? "bg-rose-500/10 text-rose-200" : "bg-rose-50 text-rose-700"].join(" ")}
                          >
                            {c.Company}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={dark ? "text-gray-400" : "text-gray-600"}>No companies in this bucket.</p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          </>
        )}
      </div>

      {/* Drawer Backdrop */}
      <div
        className={[
          "fixed inset-0 z-40 transition-opacity",
          drawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
          dark ? "bg-black/60" : "bg-black/40",
        ].join(" ")}
        onClick={closeHolding}
      />

      {/* Drawer Panel */}
      <div
        className={[
          "fixed top-0 right-0 h-full z-50 w-full sm:w-[480px] transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "translate-x-full",
          dark ? "bg-gray-950 border-l border-white/10" : "bg-white border-l border-black/10",
        ].join(" ")}
      >
        <div className="h-full flex flex-col">
          <div className="p-5 border-b border-black/10 dark:border-white/10 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Holding details</div>
              <div className="text-xl font-extrabold truncate">{selectedHolding?.Company || "—"}</div>
              <div className="mt-2 flex gap-2 flex-wrap">
                {selectedHolding?.Valuation ? (
                  <Pill dark={dark} tone={selectedHolding.Valuation === "Comfortable" ? "good" : selectedHolding.Valuation === "Uncomfortable" ? "bad" : "neutral"}>
                    {selectedHolding.Valuation}
                  </Pill>
                ) : null}
                <Pill dark={dark} tone="neutral">Esc to close</Pill>
              </div>
            </div>

            <button
              onClick={closeHolding}
              className={[
                "px-3 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2",
                dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200",
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faXmark} />
              Close
            </button>
          </div>

          <div className="p-5 flex-1 overflow-auto space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Buy Price</div>
                <div className="text-lg font-extrabold">₹{Number(selectedHolding?.["Buy Price"] || 0).toFixed(2)}</div>
              </div>
              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Current Price</div>
                <div className="text-lg font-extrabold">₹{Number(selectedHolding?.["Current Price"] || 0).toFixed(2)}</div>
              </div>

              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Buy Value</div>
                <div className="text-lg font-extrabold">{money(selectedHolding?.["Buy Value"])}</div>
              </div>
              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Current Value</div>
                <div className="text-lg font-extrabold">{money(selectedHolding?.["Current Value"])}</div>
              </div>

              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">P/L</div>
                <div className={["text-lg font-extrabold", Number(selectedHolding?.["Profit/Loss"] || 0) >= 0 ? "text-emerald-500" : "text-rose-500"].join(" ")}>
                  {money(selectedHolding?.["Profit/Loss"])}
                </div>
              </div>
              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">P/L %</div>
                <div className="text-lg font-extrabold">{pct(selectedHolding?.PorLpercent)}</div>
              </div>

              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Day Gain</div>
                <div className={["text-lg font-extrabold", Number(selectedHolding?.["Day Gain"] || 0) >= 0 ? "text-emerald-500" : "text-rose-500"].join(" ")}>
                  {money(selectedHolding?.["Day Gain"])}
                </div>
              </div>
              <div className={["p-3 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">P/E</div>
                <div className="text-lg font-extrabold">{Number(selectedHolding?.PE || 0).toFixed(2)}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <a
                className={["px-4 py-3 rounded-2xl font-extrabold text-center", dark ? "bg-indigo-500 hover:bg-indigo-400 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"].join(" ")}
                href={"https://www.tradingview.com/chart/?symbol=" + (selectedHolding?.["Company Code"] || "")}
                target="_blank"
                rel="noreferrer"
              >
                Open in TradingView
              </a>

              <a
                className={["px-4 py-3 rounded-2xl font-extrabold text-center", dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200"].join(" ")}
                href={"https://www.screener.in/company/" + String(selectedHolding?.["Company Code"] || "").replace("NSE:", "") + "/consolidated/"}
                target="_blank"
                rel="noreferrer"
              >
                Open in Screener
              </a>

              {selectedHolding?.Company ? (
                <button
                  className={["px-4 py-3 rounded-2xl font-extrabold text-center", dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200"].join(" ")}
                  onClick={() => navigate("/holding/" + selectedHolding.Company + "?pid=" + encodeURIComponent(pid))}
                >
                  Open Holding Page
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Shortcuts modal (the fixed version you already liked) */}
      {showShortcuts && (
        <div
          className={["fixed inset-0 z-[70]", dark ? "bg-black/70" : "bg-black/50", "flex items-center justify-center px-4"].join(" ")}
          onClick={() => setShowShortcuts(false)}
        >
          <div role="dialog" aria-modal="true" className="w-[92vw] max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className={["rounded-3xl border shadow-lg", dark ? "bg-gray-950 border-white/10" : "bg-white border-black/10"].join(" ")}>
              <div className="p-5 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FontAwesomeIcon icon={faKeyboard} />
                  <div className="font-extrabold text-lg">Keyboard Shortcuts</div>
                </div>
                <button
                  onClick={() => setShowShortcuts(false)}
                  className={["px-3 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2", dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200"].join(" ")}
                >
                  <FontAwesomeIcon icon={faXmark} />
                  Close
                </button>
              </div>

              <div className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { k: "/", d: "Focus holdings search" },
                    { k: "R", d: "Refresh data" },
                    { k: "E", d: "Prepare charts for export" },
                    { k: "Esc", d: "Close drawer / modal" },
                    { k: "?", d: "Toggle this panel" },
                  ].map((x) => (
                    <div key={x.k} className={["p-4 rounded-2xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                      <div className={["text-xs uppercase tracking-wide font-semibold", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>Key</div>
                      <div className="mt-1 text-xl font-extrabold">{x.k}</div>
                      <div className={["mt-1 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>{x.d}</div>
                    </div>
                  ))}
                </div>

                <div className={["mt-4 text-xs flex items-center gap-2", dark ? "text-gray-400" : "text-gray-500"].join(" ")}>
                  <FontAwesomeIcon icon={faCircleInfo} />
                  Shortcuts won’t trigger while you’re typing in an input.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
