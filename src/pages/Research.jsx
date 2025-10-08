import { faSun, faMoon, faArrowRotateRight, faChartLine, faChartSimple, faArrowUpWideShort, faArrowDownShortWide, faPlugCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../Authentication/firebase";
import axios from "axios";
import SiteHeader from "../Components/SiteHeader";

// ======== CACHE CONFIG ========
const CACHE_KEY = "research:v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const now = () => Date.now();
const isFresh = (ts) => typeof ts === "number" && now() - ts < CACHE_TTL_MS;

const readCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (data) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: now() }));
  } catch {}
};

const numberish = (v) => (typeof v === "number" ? v : (v && !isNaN(+v) ? +v : v));
const sortByKey = (arr, key, dir = "asc") => {
  if (!key) return arr;
  const s = [...arr].sort((a, b) => {
    const av = numberish(a[key]), bv = numberish(b[key]);
    if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
    return dir === "asc" ? String(av ?? "").localeCompare(String(bv ?? "")) : String(bv ?? "").localeCompare(String(av ?? ""));
  });
  return s;
};

export default function Research() {
  const [darkMode, setDarkMode] = useState(false);
  const [raw, setRaw] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [search, setSearch] = useState("");
  const [inPortfolio, setInPortfolio] = useState("All");
  const [priceLower, setPriceLower] = useState("All");
  const [minStars, setMinStars] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  const navigate = useNavigate();
  const RESEARCH_URL = process.env.REACT_APP_RESEARCH_URL;

  // track online/offline
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // initial load: try cache first, then (if online + stale/missing) fetch network
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setRaw(cached.data);
      setLastFetchedAt(new Date(cached.ts));
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    // only fetch if online and cache is missing/stale
    const shouldFetch = online && (!cached || !isFresh(cached.ts));
    if (!shouldFetch) return;

    (async () => {
      try {
        const res = await axios.get(RESEARCH_URL);
        const arr = Array.isArray(res.data) ? res.data : [];
        setRaw(arr);
        setLastFetchedAt(new Date());
        writeCache(arr);
        setError(null);
      } catch (e) {
        // keep whatever cache we showed; just surface error message
        setError("Failed to fetch latest research data.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [RESEARCH_URL, online]);

  const handleLogout = async () => {
    await signOut(auth);
    alert("Logged out!");
    navigate("/login");
  };

  // manual refresh (force network, if online)
  const refresh = async () => {
    if (!online) return; // do nothing offline
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get(RESEARCH_URL);
      const arr = Array.isArray(res.data) ? res.data : [];
      setRaw(arr);
      setLastFetchedAt(new Date());
      writeCache(arr);
    } catch (e) {
      setError("Refresh failed. Showing cached data.");
    } finally {
      setIsLoading(false);
    }
  };

  const headers = raw && raw.length > 0 ? Object.keys(raw[0]) : [];

  const filtered = useMemo(() => {
    let out = raw;
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));

    if (inPortfolio !== "All") out = out.filter((r) => String(r["In Portfolio?"] ?? "").toLowerCase() === inPortfolio.toLowerCase());
    if (priceLower !== "All") out = out.filter((r) => String(r["Is Current Price Lower?"] ?? "").toLowerCase() === priceLower.toLowerCase());

    if (minStars > 0) {
      const starKey = headers.find((h) => h.toLowerCase().includes("star"));
      if (starKey) out = out.filter((r) => Number(r[starKey] ?? 0) >= minStars);
    }

    out = sortByKey(out, sortConfig.key, sortConfig.direction);
    return out;
  }, [raw, search, inPortfolio, priceLower, minStars, sortConfig, headers]);

  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, currentPage, rowsPerPage]);

  const handleSort = (header) => {
    setSortConfig((prev) => (prev.key === header ? { key: header, direction: prev.direction === "asc" ? "desc" : "asc" } : { key: header, direction: "asc" }));
  };

  const getCellClass = (header, value) => {
    const h = header.toLowerCase();
    if (h.includes("star") && typeof value === "number") {
      if (value >= 4) return "bg-green-200/60 text-green-900 font-semibold";
      if (value >= 3) return "bg-green-100/70 text-green-900 font-semibold";
      if (value >= 2) return "bg-yellow-100 text-yellow-900 font-semibold";
      if (value >= 1) return "bg-orange-100 text-orange-900 font-semibold";
      return "bg-red-100 text-red-900 font-semibold";
    }
    if (h.includes("in portfolio?")) {
      return String(value) === "Yes" ? "bg-green-100 text-green-900 font-medium" : "bg-orange-100 text-orange-900 font-medium";
    }
    if (h.includes("is current price lower?")) {
      return String(value) === "Yes" ? "bg-green-100 text-green-900 font-medium" : "bg-orange-100 text-orange-900 font-medium";
    }
    return "";
  };

  const formatValue = (header, value) => {
    const h = String(header || "").toLowerCase();
    if (h.includes("star")) {
      if (typeof value === "number") return value.toFixed(1);
      return value ?? "";
    }
    if (h.includes("current allocation") && typeof value === "number") {
      return `${(value * 100).toFixed(2)}%`;
    }
    if (typeof value === "number") return value.toLocaleString("en-IN");
    return value ?? "";
  };

  const brandBox = darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200";
  const brandTextMuted = darkMode ? "text-neutral-400" : "text-gray-500";

  return (
    <div className={`min-h-screen ${darkMode ? "bg-neutral-950 text-neutral-100" : "bg-gray-50 text-gray-900"}`}>
      <SiteHeader
        title="Investment Portfolio"
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((v) => !v)}
        onLogout={handleLogout}
      />

      <main className="mx-auto px-3 sm:px-4 lg:px-6 py-4 space-y-4">
        {/* Toolbar */}
        <section className={`rounded-xl border ${brandBox} p-3 sm:p-4`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-sm ${brandTextMuted}`}>Research</span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-600/10 text-indigo-600">
                {totalRows.toLocaleString()} rows
              </span>
              {lastFetchedAt && (
                <span className={`text-xs ${brandTextMuted}`}>• Cached {lastFetchedAt.toLocaleTimeString()}</span>
              )}
              {!online && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600">
                  <FontAwesomeIcon icon={faPlugCircleExclamation} />
                  Offline
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search company / note / tags…"
                className={`pl-3 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${darkMode ? "bg-neutral-900 border-neutral-700 placeholder-neutral-500" : "bg-white border-gray-300 placeholder-gray-400"}`}
              />
              <select value={inPortfolio} onChange={(e) => { setInPortfolio(e.target.value); setPage(1); }}
                className={`text-sm rounded-lg border px-2 py-2 ${darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-gray-300"}`}>
                <option>All</option><option>Yes</option><option>No</option>
              </select>
              <select value={priceLower} onChange={(e) => { setPriceLower(e.target.value); setPage(1); }}
                className={`text-sm rounded-lg border px-2 py-2 ${darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-gray-300"}`}>
                <option>All</option><option>Yes</option><option>No</option>
              </select>
              <select value={minStars} onChange={(e) => { setMinStars(Number(e.target.value)); setPage(1); }}
                className={`text-sm rounded-lg border px-2 py-2 ${darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-gray-300"}`}>
                {[0,1,2,3,4,5].map(v => <option key={v} value={v}>⭐ Min {v}</option>)}
              </select>
              <button
                onClick={refresh}
                disabled={!online}
                className={`inline-flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${online ? "border-indigo-600 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20" : "border-gray-300 text-gray-400 cursor-not-allowed"}`}
                title={online ? "Fetch latest" : "You are offline"}
              >
                <FontAwesomeIcon icon={faArrowRotateRight} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {/* Table */}
        <section className={`overflow-x-auto rounded-2xl border shadow-sm ${brandBox}`}>
          {isLoading ? (
            <div className="p-10 text-center text-sm">Loading…</div>
          ) : error ? (
            <div className="p-10 text-center text-red-500">{error}</div>
          ) : (
            <table className={`min-w-full ${darkMode ? "bg-neutral-900" : "bg-white"}`}>
              <thead className="sticky top-0 z-10">
                <tr>
                  {headers.map((header) => (
                    <th
                      key={header}
                      onClick={() => handleSort(header)}
                      className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none border-b ${darkMode ? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border-neutral-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-200"}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {header}
                        {sortConfig.key === header && (
                          <FontAwesomeIcon icon={sortConfig.direction === "asc" ? faArrowUpWideShort : faArrowDownShortWide} className="opacity-70" />
                        )}
                      </span>
                    </th>
                  ))}
                  <th className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider border-b ${darkMode ? "bg-neutral-800 text-neutral-200 border-neutral-700" : "bg-gray-100 text-gray-700 border-gray-200"}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageData.map((row, idx) => (
                  <tr key={idx} className={`transition-colors duration-150 hover:bg-yellow-50 dark:hover:bg-neutral-800 ${idx % 2 === 0 ? (darkMode ? "bg-neutral-950" : "bg-white") : (darkMode ? "bg-neutral-900" : "bg-gray-50")}`}>
                    {headers.map((header) => (
                      <td
                        key={header}
                        className={`px-4 py-3 text-sm border-b ${darkMode ? "border-neutral-800" : "border-gray-100"} ${getCellClass(header, row[header])}`}
                        title={String(row[header] ?? "")}
                      >
                        {formatValue(header, row[header])}
                      </td>
                    ))}
                    <td className={`px-4 py-3 text-sm border-b ${darkMode ? "border-neutral-800" : "border-gray-100"}`}>
                      <div className="flex items-center gap-3">
                        <a
                          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(row["Company Code"] || "")}`}
                          target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"
                          title="Open in TradingView"
                        >
                          <FontAwesomeIcon icon={faChartLine} />
                          <span className="sr-only">TradingView</span>
                        </a>
                        <a
                          href={`https://www.screener.in/company/${encodeURIComponent(String(row["Company Code"] || "").replace(/^NSE:/, ""))}/consolidated/`}
                          target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline text-green-700 dark:text-green-400"
                          title="Open in Screener"
                        >
                          <FontAwesomeIcon icon={faChartSimple} />
                          <span className="sr-only">Screener</span>
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
                {pageData.length === 0 && (
                  <tr>
                    <td colSpan={headers.length + 1} className="px-4 py-6 text-center text-sm opacity-70">
                      No rows match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>

        {/* Pagination */}
        {!isLoading && !error && (
          <section className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className={`text-sm ${brandTextMuted}`}>
              Page <span className="font-semibold">{currentPage}</span> of <span className="font-semibold">{totalPages}</span> • {totalRows.toLocaleString()} results
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}
                className={`px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50 ${darkMode ? "border-neutral-700 hover:bg-neutral-800" : "border-gray-300 hover:bg-gray-100"}`}>
                Prev
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                className={`px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50 ${darkMode ? "border-neutral-700 hover:bg-neutral-800" : "border-gray-300 hover:bg-gray-100"}`}>
                Next
              </button>
              <select value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
                className={`ml-2 text-sm rounded-lg border px-2 py-1.5 ${darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-gray-300"}`}>
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
              </select>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
