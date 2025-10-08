import React, { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { Paper } from "@mui/material";
import PieChart from "../Components/PieChart";
import Heatmap from "../Components/Heatmap";
import HistoricalPerformance from "../Components/historicalperformance";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Link, useSearchParams } from "react-router-dom";
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
} from "@fortawesome/free-solid-svg-icons";
import ComparisonChart from "../Components/ComparisonChart";
import { signOut } from "firebase/auth";
import { auth, db } from "../Authentication/firebase";
import { useNavigate } from "react-router-dom";
import GoalSection from "../Components/GoalSection";
import DownloadPDF from "../Components/PortfolioPDF";
import { toPng } from "html-to-image";
import { format as formatIndianNumber } from "indian-number-format";
import TodayGainers from "../Components/Todaygainers";
import TodayLosers from "../Components/Todaylosers";
import PieChartSector from "../Components/PieChartSector";
import SiteHeader from "../Components/SiteHeader";
import MetricBadge from "../Components/MetricBadge";
import BenchmarkSelector from "../Components/BenchmarkSelector";
import { syncHoldingsToFirestore } from "../lib/syncHoldingsToFirestore";

/* ---------------- helpers: cache ---------------- */
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const nowMs = () => Date.now();

function cacheKeyFor(pid) {
  return "dashboard:rows:v1:" + String(pid || "default");
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
  } catch {}
}
function isFresh(ts) {
  return typeof ts === "number" && nowMs() - ts < TTL_MS;
}

/** ——— Small UI helpers ——— */
const Section = ({ title, subtitle, children, dark, className = "" }) => (
  <section className={`rounded-xl shadow-md ${dark ? "bg-gray-800 text-gray-100" : "bg-white"} p-4 sm:p-6 flex flex-col ${className}`}>
    {title && (
      <h2 className={`text-xl sm:text-2xl font-semibold mb-3 ${dark ? "text-gray-100" : "text-gray-900"}`}>
        {title}
      </h2>
    )}
    <div className="flex-1 min-h-0">{children}</div>
  </section>
);

const StatCard = ({ label, value, icon, tone = "neutral", dark }) => {
  const toneMap = {
    neutral: dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-gray-50 border-black/10 text-gray-900",
    good: dark ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-700",
    bad: dark ? "bg-rose-500/10 border-rose-400/30 text-rose-300" : "bg-rose-50 border-rose-200 text-rose-700",
  };
  return (
    <div className={`p-4 rounded-xl border ${toneMap[tone]} flex items-center gap-4`}>
      <div className={`h-10 w-10 rounded-lg grid place-items-center ${dark ? "bg-white/10" : "bg-white"} shadow-sm`} aria-hidden>
        <FontAwesomeIcon icon={icon} />
      </div>
      <div className="flex-1">
        <div className={`text-xs uppercase tracking-wide ${dark ? "text-gray-300" : "text-gray-500"}`}>{label}</div>
        <div className="text-lg sm:text-2xl font-extrabold">{value}</div>
      </div>
    </div>
  );
};

const TabButton = ({ active, children, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors
      ${active ? "bg-indigo-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-800"} 
      dark:${active ? "bg-indigo-500 text-white" : "bg-white/10 hover:bg-white/15 text-gray-200"}`}
  >
    {children}
  </button>
);

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

const Dashboard = () => {
  const [uid, setUid] = useState(null);
  const [appsRows, setAppsRows] = useState([]);
  const [data, setData] = useState([]);
  const [weightedPE, setWeightedPE] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [darkMode, setDarkMode] = useState(false);
  const pieChartRef = useRef(null);
  const comparisonChartRef = useRef(null);
  const [chartImages, setChartImages] = useState({ pie: "", comparison: "" });
  const [totalProfitValue, setTotalProfitValue] = useState(0);
  const [totalLossValue, setTotalLossValue] = useState(0);
  const [selectedChart, setSelectedChart] = useState("Stocks");

  const [lastUpdated, setLastUpdated] = useState(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  const GOOGLE_SHEETS_URL = process.env.REACT_APP_SPREADSHEET_URL;
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const pid = sp.get("pid") || "default";

  /* online/offline badge */
  useEffect(() => {
    function goOnline() { setOnline(true); }
    function goOffline() { setOnline(false); }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => auth.onAuthStateChanged(function (u) { setUid(u && u.uid ? u.uid : null); }), []);

  // Apps Script -> setAppsRows (unchanged)
  useEffect(() => {
    var alive = true;
    (async function () {
      try {
        const url = process.env.REACT_APP_SPREADSHEET_URL;
        const res = await fetch(url);
        const json = await res.json();
        if (!alive) return;
        setAppsRows(Array.isArray(json) ? json : []);
      } catch (e) {
        // ignore, this path is independent of main cache
      }
    })();
    return function () { alive = false; };
  }, []);

  // push into Firestore (unchanged)
  useEffect(() => {
    if (!uid || !appsRows.length) return;
    syncHoldingsToFirestore({ db, uid, pid, rows: appsRows });
  }, [uid, pid, appsRows]);

  /* ------------ metrics recompute helper ------------ */
  function recompute(rows) {
    // normalize numeric fields
    const cleaned = rows.map(function (item) {
      return {
        ...item,
        "Current Value": Number(item["Current Value"] || 0),
        "Profit/Loss": Number(item["Profit/Loss"] || 0),
        "Buy Value": Number(item["Buy Value"] || 0),
        Quantity: Number(item["Quantity"] || 0),
        PE: Number(item["PE"] || 0),
        PorLpercent: !isNaN(Number(item["PorLpercent"])) ? Number(item["PorLpercent"]) : 0,
        "Day Gain": !isNaN(Number(item["Day Gain"])) ? Number(item["Day Gain"]) : 0,
      };
    });
    setData(cleaned);

    // weighted PE
    var totalWeightedPE = 0;
    var totalValue = 0;
    for (var i = 0; i < cleaned.length; i++) {
      var sv = cleaned[i]["Current Value"];
      var pe = cleaned[i]["PE"];
      if (sv && pe) {
        totalWeightedPE += pe * sv;
        totalValue += sv;
      }
    }
    var wpe = totalValue ? totalWeightedPE / totalValue : 0;
    setWeightedPE(wpe.toFixed(2));

    // totals for seg bar
    var pos = 0, neg = 0;
    for (var j = 0; j < cleaned.length; j++) {
      var p = Number(cleaned[j]["Profit/Loss"] || 0);
      if (p >= 0) pos += p; else neg += p;
    }
    setTotalProfitValue(Number(pos.toFixed(0)));
    setTotalLossValue(Number((-1 * neg).toFixed(0)));
  }

  /* ------------ offline cache boot ------------ */
  useEffect(() => {
    const cached = readCache(pid);
    if (cached) {
      recompute(cached.data);
      setLastUpdated(new Date(cached.ts));
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    // fetch only if online and cache missing or stale
    const shouldFetch = online && (!cached || !isFresh(cached.ts));
    if (!shouldFetch) return;

    (async function () {
      try {
        const resp = await axios.get(GOOGLE_SHEETS_URL);
        const rows = Array.isArray(resp.data) ? resp.data : [];
        recompute(rows);
        setLastUpdated(new Date());
        writeCache(pid, rows);
      } catch (e) {
        // keep cache view; surface soft error if needed
        // console.error("Network fetch failed, showing cache.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [GOOGLE_SHEETS_URL, pid, online]);

  /* ------------ manual Refresh ------------ */
  async function refreshNow() {
    if (!online) return;
    setIsLoading(true);
    try {
      const resp = await axios.get(GOOGLE_SHEETS_URL);
      const rows = Array.isArray(resp.data) ? resp.data : [];
      recompute(rows);
      setLastUpdated(new Date());
      writeCache(pid, rows);
    } catch (e) {
      // show a small toast/console note and keep old cache
      // console.error("Refresh failed, showing cached data.");
    } finally {
      setIsLoading(false);
    }
  }

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  const calculateTotalValue = (key) => Number(data.reduce((sum, item) => sum + Number(item[key] || 0), 0).toFixed(0));

  const calculateProfitPercentage = () => {
    const totalProfit = Number(calculateTotalValue("Profit/Loss"));
    const totalInvested = Number(calculateTotalValue("Buy Value"));
    if (!totalInvested) return 0;
    return Number(((totalProfit / totalInvested) * 100).toFixed(2));
  };

  const todayReturnPct = () => {
    const dayGain = Number(calculateTotalValue("Day Gain"));
    const curr = Number(calculateTotalValue("Current Value"));
    if (!curr) return 0;
    return Number(((dayGain / curr) * 100).toFixed(2));
  };

  const generateChartImages = async () => {
    try {
      const pieImage = await toPng(pieChartRef.current, { cacheBust: true });
      const comparisonImage = await toPng(comparisonChartRef.current, { cacheBust: true });
      setChartImages({ pie: pieImage, comparison: comparisonImage });
    } catch (e) {
      // ignore
    }
  };

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

  const comfortableCompanies = useMemo(function () {
    return data.filter(function (c) { return c.Valuation === "Comfortable"; });
  }, [data]);
  const uncomfortableCompanies = useMemo(function () {
    return data.filter(function (c) { return c.Valuation === "Uncomfortable"; });
  }, [data]);

  const dark = darkMode;

  return (
    <div className={`min-h-screen ${dark ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"}`}>
      <div className="">
        <SiteHeader
          title="Portfolio Tracker"
          darkMode={dark}
          onToggleDarkMode={function () { setDarkMode(function (v) { return !v; }); }}
          onLogout={handleLogout}
        />
      </div>
      <div className="mx-4">
        <div className="max-w-7xl mx-auto  py-4">
          {/* Toolbar */}
          <div className="my-5 sm:mb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold">Overview</h1>
              <p className={`text-sm ${dark ? "text-gray-300" : "text-gray-600"}`}>
                {lastUpdated ? "Cached: " + lastUpdated.toLocaleString() : "—"}
                {!online && (
                  <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                    <FontAwesomeIcon icon={faPlugCircleExclamation} /> Offline
                  </span>
                )}
              </p>
            </div>

            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={refreshNow}
                disabled={!online}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
                  online
                    ? "border-indigo-600 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                    : "border-gray-300 text-gray-400 cursor-not-allowed"
                }`}
                title={online ? "Fetch latest and update cache" : "You are offline"}
              >
                <FontAwesomeIcon icon={faArrowRotateRight} />
                Refresh
              </button>

              <button
                onClick={generateChartImages}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white text-black dark:bg-white/10 hover:bg-gray-50 dark:hover:bg-white/15 text-sm font-medium"
                title="Prepare charts for export"
              >
                <FontAwesomeIcon icon={faDownload} />
                Prepare Charts
              </button>
              {/* PDF uses chartImages populated by the button above */}
              <DownloadPDF data={data} chartImages={chartImages} />
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <FontAwesomeIcon icon={faSpinner} className="fa-spin text-2xl" />
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard
                  dark={dark}
                  label="Total Portfolio Value"
                  value={"₹" + formatIndianNumber(calculateTotalValue("Current Value"))}
                  icon={faSackDollar}
                />
                <StatCard
                  dark={dark}
                  label="Total Invested"
                  value={"₹" + formatIndianNumber(calculateTotalValue("Buy Value"))}
                  icon={faMoneyBillWave}
                />
                <StatCard
                  dark={dark}
                  label="Total Profit/Loss"
                  value={"₹" + formatIndianNumber(calculateTotalValue("Profit/Loss"))}
                  icon={calculateTotalValue("Profit/Loss") >= 0 ? faArrowTrendUp : faArrowTrendDown}
                  tone={calculateTotalValue("Profit/Loss") >= 0 ? "good" : "bad"}
                />
                <StatCard
                  dark={dark}
                  label="Total Return"
                  value={calculateProfitPercentage() + "%"}
                  icon={faPercent}
                  tone={calculateProfitPercentage() >= 0 ? "good" : "bad"}
                />
              </div>

              {/* Today + PE + Export */}
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                <StatCard
                  dark={dark}
                  label="Today's Return"
                  value={"₹" + formatIndianNumber(calculateTotalValue("Day Gain"))}
                  icon={calculateTotalValue("Day Gain") >= 0 ? faArrowTrendUp : faArrowTrendDown}
                  tone={calculateTotalValue("Day Gain") >= 0 ? "good" : "bad"}
                />
                <StatCard
                  dark={dark}
                  label="Today's Return %"
                  value={todayReturnPct() + "%"}
                  icon={faPercent}
                  tone={todayReturnPct() >= 0 ? "good" : "bad"}
                />
                <StatCard
                  dark={dark}
                  label="Weighted P/E"
                  value={weightedPE}
                  icon={faChartSimple}
                  tone={Number(weightedPE) <= 50 ? "good" : "bad"}
                />
                <div className="hidden lg:block" />
              </div>

              {/* Profit vs Loss SegBar */}
              <div className="mb-8">
                <SegBar profit={Number(totalProfitValue)} loss={Number(totalLossValue)} />
              </div>

              {/* Holdings */}
              <Section dark={dark} title="Holdings" subtitle="Tap headers to sort">
                <div className="overflow-x-auto rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="sticky mb-2">
                      <tr className={`${dark ? "bg-gray-800 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                        {[
                          { label: "Asset", key: "Company" },
                          { label: "Qty", key: "Quantity" },
                          { label: "Buy ₹", key: "Buy Price" },
                          { label: "Current ₹", key: "Current Price" },
                          { label: "Buy Value", key: "Buy Value" },
                          { label: "Current Value", key: "Current Value" },
                          { label: "P/L ₹", key: "Profit/Loss" },
                          { label: "P/L %", key: "PorLpercent" },
                        ].map((h) => (
                          <th
                            key={h.key}
                            onClick={() => handleSort(h.key)}
                            className="px-3 py-3 font-semibold whitespace-nowrap cursor-pointer select-none"
                            title="Sort"
                          >
                            {h.label}
                            {sortConfig.key === h.key && (sortConfig.direction === "asc" ? " ▲" : " ▼")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((row, i) => {
                        const pos = Number(row["Profit/Loss"]) >= 0;
                        return (
                          <tr
                            key={i}
                            className={`border-t ${dark ? "border-white/10" : "border-black/5"} hover:bg-black/5 dark:hover:bg-white/5`}
                          >
                            <td className="px-3 py-3 font-medium whitespace-nowrap">
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
                                href={
                                  "https://www.screener.in/company/" +
                                  String(row["Company Code"] || "").replace("NSE:", "") +
                                  "/consolidated/"
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="px-1 text-green-700"
                                title="Open in Screener"
                              >
                                <FontAwesomeIcon icon={faChartSimple} />
                              </a>
                              <Link to={"/holding/" + row.Company + "?pid=" + encodeURIComponent(pid)}>
                                <FontAwesomeIcon
                                  icon={faClipboard}
                                  className={"mx-2 " + (dark ? "text-white" : "text-black")}
                                />
                              </Link>
                              <span className="ml-1">{row.Company}</span>
                            </td>
                            <td className="px-3 py-3 text-center">{row["Quantity"]}</td>
                            <td className="px-3 py-3 text-center">₹{Number(row["Buy Price"] || 0).toFixed(2)}</td>
                            <td className="px-3 py-3 text-center">₹{Number(row["Current Price"] || 0).toFixed(2)}</td>
                            <td className="px-3 py-3 text-center font-semibold">
                              ₹{formatIndianNumber(Number(row["Buy Value"] || 0).toFixed(0))}
                            </td>
                            <td className="px-3 py-3 text-center font-semibold">
                              ₹{formatIndianNumber(Number(row["Current Value"] || 0).toFixed(0))}
                            </td>
                            <td className={"px-3 py-3 text-center font-semibold " + (pos ? "text-emerald-600" : "text-rose-600")}>
                              ₹{formatIndianNumber(Number(row["Profit/Loss"] || 0).toFixed(0))}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <div className="inline-block scale-90">
                                <MetricBadge
                                  label=""
                                  value={Number(row.PorLpercent || 0).toFixed(2) + "%"}
                                  good={Number(row.PorLpercent || 0) >= 0}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 my-6">
                {/* Comparison */}
                <Section dark={dark} title="Portfolio vs CNX 500 (Normalized) — 3M">
                  <div ref={comparisonChartRef} className="h-[460px] md:h-[540px]">
                    <ComparisonChart darkMode={dark} />
                  </div>
                </Section>

                {/* Pie */}
                <Section dark={dark} title="Portfolio Distribution" className="">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-2">
                      <TabButton active={selectedChart === "Stocks"} onClick={function () { setSelectedChart("Stocks"); }}>
                        Stocks
                      </TabButton>
                      <TabButton active={selectedChart === "Sector"} onClick={function () { setSelectedChart("Sector"); }}>
                        Sector
                      </TabButton>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0">
                    <Paper
                      elevation={5}
                      ref={pieChartRef}
                      style={{
                        padding: "0.5rem",
                        borderRadius: "14px",
                        boxShadow: "0px 0px 1px rgba(0,0,0,0.08)",
                        textAlign: "center",
                        backgroundColor: dark ? "#1F2937" : "#FFFFFF",
                        height: "100%",
                      }}
                    >
                      <div style={{ width: "100%", height: "100%", overflow: "hidden", backgroundColor: dark ? "#1F2937" : "#FFFFFF", borderRadius: "10px" }}>
                        {selectedChart === "Stocks" ? (
                          <PieChart data={data} darkMode={dark} />
                        ) : (
                          <PieChartSector data={data} darkMode={dark} />
                        )}
                      </div>
                    </Paper>
                  </div>
                </Section>
              </div>

              {/* Heatmap & Historical */}
              <div className="grid  gap-6 mb-6">
                <Section dark={dark}>
                  <Heatmap data={data} darkMode={dark} onTileClick={function (t) { navigate("/holding/" + t.name); }} />
                </Section>
                <Section className="" dark={dark}>
                  <HistoricalPerformance />
                </Section>
              </div>

              {/* Gainers / Losers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <Section dark={dark} title="Today's Gainers">
                  <TodayGainers data={data} darkMode={dark} />
                </Section>
                <Section dark={dark} title="Today's Losers">
                  <TodayLosers data={data} darkMode={dark} />
                </Section>
              </div>

              {/* Valuation Buckets */}
              <Section dark={dark} title="Company Valuation">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className={`p-4 rounded-xl border ${dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"}`}>
                    <h3 className="font-bold text-lg mb-4">Comfortable</h3>
                    {comfortableCompanies.length ? (
                      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {comfortableCompanies.map(function (c, idx) {
                          return (
                            <li key={idx} className={`${dark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700"} text-center text-sm rounded-lg py-2 px-3`}>
                              {c.Company}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className={dark ? "text-gray-400" : "text-gray-600"}>No companies in this bucket.</p>
                    )}
                  </div>

                  <div className={`p-4 rounded-xl border ${dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"}`}>
                    <h3 className="font-bold text-lg mb-4">Uncomfortable</h3>
                    {uncomfortableCompanies.length ? (
                      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {uncomfortableCompanies.map(function (c, idx) {
                          return (
                            <li key={idx} className={`${dark ? "bg-rose-500/10 text-rose-300" : "bg-rose-50 text-rose-700"} text-center text-sm rounded-lg py-2 px-3`}>
                              {c.Company}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className={dark ? "text-gray-400" : "text-gray-600"}>No companies in this bucket.</p>
                    )}
                  </div>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
