// src/pages/NewsPage.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { auth, db } from "../Authentication/firebase";
import { collection, getDocs, query } from "firebase/firestore";
import SiteHeader from "../Components/SiteHeader";

/* -------------------- helpers -------------------- */
// We’ll try proxies in this order:
const PROXIES = [
    { name: "allorigins-get", wrap: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, parse: async (r) => (await r.json()).contents },
    { name: "allorigins-raw", wrap: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, parse: async (r) => r.text() },
    // r.jina.ai mirrors content with permissive CORS
    { name: "jina-http", wrap: (u) => `https://r.jina.ai/http://${u.replace(/^https?:\/\//, "")}`, parse: async (r) => r.text() },
    { name: "jina-https", wrap: (u) => `https://r.jina.ai/https://${u.replace(/^https?:\/\//, "")}`, parse: async (r) => r.text() },
    // generic lightweight proxy
    { name: "isomorphic", wrap: (u) => `https://cors.isomorphic-git.org/${u}`, parse: async (r) => r.text() },
];

async function fetchRssViaProxies(url) {
    let lastErr;
    for (const p of PROXIES) {
        try {
            const proxied = p.wrap(url);
            const res = await fetch(proxied, { headers: { "x-requested-with": "portfolio-app" } });
            if (!res.ok) throw new Error(`${p.name} ${res.status}`);
            const text = await p.parse(res);
            if (!text || typeof text !== "string") throw new Error(`${p.name} empty`);
            // sanity check: should contain <item>
            if (!/<item[\s>]/i.test(text)) {
                // still return; some feeds may be atom. We handle later.
            }
            return text;
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("All proxies failed");
}

const timeAgo = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleString();
};

const googleNewsRss = (q, { hl = "en-IN", gl = "IN", ceid = "IN:en" } = {}) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

const stripHtml = (html = "") => {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    } catch {
        return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
};

const normalizeLink = (link) => {
    try {
        const u = new URL(link);
        const real = u.searchParams.get("url") || u.searchParams.get("u");
        return real ? decodeURIComponent(real) : link;
    } catch {
        return link;
    }
};
const firstHrefFromDesc = (html = "") => {
    const m = html.match(/<a[^>]+href="([^"]+)"/i);
    return m ? m[1] : null;
};

// also supports Atom (entry) if Google decides to serve that
const parseRss = (xmlText) => {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    let items = Array.from(doc.getElementsByTagName("item"));
    if (!items.length) {
        // try Atom
        items = Array.from(doc.getElementsByTagName("entry"));
        if (items.length) {
            return items.map((item) => {
                const title = item.getElementsByTagName("title")[0]?.textContent || "";
                const linkEl = item.getElementsByTagName("link")[0];
                const link = normalizeLink(linkEl?.getAttribute("href") || "");
                const src = item.getElementsByTagName("source")[0]?.textContent || "";
                const pubEl = item.getElementsByTagName("updated")[0] || item.getElementsByTagName("published")[0];
                const pub = pubEl?.textContent || "";
                const summary = item.getElementsByTagName("summary")[0]?.textContent || "";
                return {
                    title,
                    link,
                    source: src,
                    publishedAt: pub ? new Date(pub).toISOString() : null,
                    snippet: stripHtml(summary),
                };
            });
        }
    }
    return items.map((item) => {
        const get = (tag) => item.getElementsByTagName(tag)[0]?.textContent || "";
        const link = normalizeLink(get("link"));
        const descHtml = get("description");
        const realFromDesc = firstHrefFromDesc(descHtml);
        const pub = get("pubDate");
        const src = item.getElementsByTagName("source")[0]?.textContent || "";
        return {
            title: get("title"),
            link: realFromDesc || link,
            source: src,
            publishedAt: pub ? new Date(pub).toISOString() : null,
            snippet: stripHtml(descHtml),
        };
    });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runWithLimit(tasks, limit = 6, onStep) {
    const out = [];
    let i = 0, done = 0;
    async function worker() {
        while (true) {
            const idx = i++;
            if (idx >= tasks.length) break;
            out[idx] = await tasks[idx]();
            done++; onStep?.(done, tasks.length);
            await sleep(60);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return out;
}

// 10-min per-symbol cache
const CACHE_TTL_MS = 10 * 60 * 1000;
const cacheKey = (sym) => `news_symbol_${sym}`;
const getCache = (sym) => {
    try {
        const raw = localStorage.getItem(cacheKey(sym));
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (Date.now() - obj.t > CACHE_TTL_MS) return null;
        return obj.items;
    } catch { return null; }
};
const setCache = (sym, items) => { try { localStorage.setItem(cacheKey(sym), JSON.stringify({ t: Date.now(), items })); } catch { } };

/* ----- query builder with progressive fallbacks (India-focused) ----- */
const SOURCE_HINT =
    "(site:moneycontrol.com OR site:economictimes.com OR site:livemint.com OR " +
    "site:reuters.com OR site:bloomberg.com OR site:business-standard.com OR " +
    "site:financialexpress.com OR site:businesstoday.in OR site:thehindubusinessline.com OR " +
    "site:cnbctv18.com OR site:ndtvprofit.com OR site:yahoo.com/finance OR site:marketscreener.com)";

function queriesFor(name, symbol) {
    const cleanName = String(name)
        .replace(/\b(limited|ltd|inc|corp|plc)\.?$/i, "")
        .trim();
    const lastResort = `${symbol} (NSE OR BSE OR shares OR stock)`;
    return [
        `("${cleanName}" OR ${symbol}) (results OR earnings OR quarterly OR Q1 OR Q2 OR Q3 OR Q4 OR stock OR shares OR NSE OR BSE) ${SOURCE_HINT}`,
        `("${cleanName}" OR ${symbol}) (results OR earnings OR quarterly OR stock OR shares OR NSE OR BSE)`,
        `${cleanName} (results OR earnings OR stock OR shares OR NSE OR BSE)`,
        lastResort,
    ];
}
/* ------------------ end helpers ------------------ */

export default function NewsPage({ defaultPid = "default" }) {
    
    const [sp] = useSearchParams();
    const pid = sp.get("pid") || defaultPid;

    const [uid, setUid] = useState(null);
    useEffect(() => auth.onAuthStateChanged((u) => setUid(u?.uid || null)), []);

    const [darkMode, setDarkMode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [items, setItems] = useState([]);
    const [symbolList, setSymbolList] = useState([]);
    const [symbolFilter, setSymbolFilter] = useState("ALL");
    const [ignoreCache, setIgnoreCache] = useState(false);

    // knobs
    const MAX_PER_SYMBOL = 5;
    const CONCURRENCY = 5;

    const loadNews = useCallback(async () => {
        if (!uid) return;
        setLoading(true);
        setErr("");
        setProgress({ done: 0, total: 0 });

        try {
            // 1) holdings
            const hCol = collection(db, "users", uid, "portfolios", pid, "holdings");
            const snap = await getDocs(query(hCol));
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

            // 2) clean + dedupe
            const seen = new Set();
            const holdings = [];
            for (const h of rows) {
                const symbol = String(h.symbol || h.id || h.Company || h.company || "").trim().toUpperCase();
                const name = String(h.name || h.company || h.Company || symbol).trim();
                if (!symbol || seen.has(symbol)) continue;
                seen.add(symbol);
                holdings.push({ symbol, name, currentValue: Number(h.currentValue || h["Current Value"] || 0) });
            }
            if (!holdings.length) { setItems([]); setSymbolList([]); return; }

            holdings.sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
            setSymbolList(holdings.map((h) => h.symbol));

            // 3) per-holding tasks with fallbacks, via proxy chain
            const tasks = holdings.map(({ symbol, name }) => async () => {
                if (!ignoreCache) {
                    const cached = getCache(symbol);
                    if (cached) return cached.map((x) => ({ ...x, symbol, name }));
                }

                const qList = queriesFor(name, symbol);
                let picked = [];
                for (const q of qList) {
                    try {
                        const url = googleNewsRss(q);
                        const xml = await fetchRssViaProxies(url);   // <— CORS-safe
                        const parsed = parseRss(xml)
                            .filter((it) => it.link && it.title)
                            .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
                        picked = parsed.slice(0, MAX_PER_SYMBOL);
                        if (picked.length) break;
                    } catch {
                        // try next fallback
                    }
                }

                if (!ignoreCache) setCache(symbol, picked);
                return picked.map((x) => ({ ...x, symbol, name }));
            });

            setProgress({ done: 0, total: tasks.length });
            const perSymbol = await runWithLimit(tasks, CONCURRENCY, (done, total) => setProgress({ done, total }));
            const flat = perSymbol.flat();

            // 4) global dedupe + sort
            const seenKey = new Set();
            const uniq = [];
            for (const n of flat) {
                const key = (n.link || "") + "|" + (n.title || "");
                if (!seenKey.has(key)) { seenKey.add(key); uniq.push(n); }
            }
            uniq.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
            setItems(uniq);
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, [uid, pid, ignoreCache]);

    const symbols = useMemo(() => ["ALL", ...symbolList], [symbolList]);
    const filtered = symbolFilter === "ALL" ? items : items.filter((i) => i.symbol === symbolFilter);

    if (!uid) {
        return (
            <div className="mx-auto max-w-6xl p-4 sm:p-6 text-sm text-gray-500 dark:text-neutral-400">
                Please sign in to view news.
            </div>
        );
    }

    return (
        <div className={`min-h-screen ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"} `}>
            <div className="">
                <SiteHeader
                    title="Portfolio Tracker"
                    darkMode={darkMode}
                    onToggleDarkMode={() => setDarkMode(v => !v)}
                />
            </div>
            <div className="mx-auto max-w-6xl p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 dark:text-neutral-100">News</h1>
                        <p className="text-sm text-gray-500 dark:text-neutral-400">Google News for your holdings</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <select
                            value={symbolFilter}
                            onChange={(e) => setSymbolFilter(e.target.value)}
                            className="rounded-lg border px-3 py-2 text-sm bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 text-gray-800 dark:text-neutral-200"
                        >
                            {symbols.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>

                        <button
                            onClick={() => { setIgnoreCache(false); loadNews(); }}
                            disabled={loading}
                            className={`px-3 py-2 rounded-lg text-white text-sm transition
              ${loading ? "bg-indigo-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"}`}
                            title="Fetch latest news (uses 10-min cache)"
                        >
                            {loading ? `Fetching ${progress.done}/${progress.total}` : "Fetch latest"}
                        </button>

                        <button
                            onClick={() => { setIgnoreCache(true); loadNews(); }}
                            disabled={loading}
                            className={`px-3 py-2 rounded-lg text-indigo-700 text-sm border border-indigo-600 dark:border-indigo-400
              ${loading ? "opacity-50 cursor-not-allowed" : "hover:bg-indigo-50 dark:hover:bg-neutral-800"}`}
                            title="Ignore cache and refetch everything"
                        >
                            Refresh (ignore cache)
                        </button>
                    </div>
                </div>

                {err && (
                    <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm dark:bg-red-950 dark:text-red-200 mb-3">
                        {err}
                    </div>
                )}

                {!loading && items.length === 0 && (
                    <div className="text-sm text-gray-500 dark:text-neutral-400">No articles yet. Click “Fetch latest”.</div>
                )}

                <ul className="grid gap-4 md:grid-cols-2">
                    {filtered.map((n, i) => {
                        let host = "";
                        try { host = new URL(n.link).hostname.replace(/^www\./, ""); } catch { }
                        return (
                            <li
                                key={`${n.link}-${i}`}
                                className="rounded-2xl border bg-white border-gray-200 shadow-sm p-4 hover:shadow-md transition dark:bg-neutral-900 dark:border-neutral-800"
                            >
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-400">{n.symbol}</span>
                                    <span className="text-xs text-gray-500 dark:text-neutral-400">{timeAgo(n.publishedAt)}</span>
                                </div>
                                <a
                                    href={n.link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block text-sm sm:text-base font-semibold text-gray-900 hover:underline dark:text-neutral-100"
                                >
                                    {n.title}
                                </a>
                                {n.snippet && (
                                    <p className="mt-1 text-sm text-gray-600 line-clamp-2 dark:text-neutral-300">{n.snippet}</p>
                                )}
                                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-400">
                                    {host && (
                                        <img
                                            alt=""
                                            className="h-4 w-4"
                                            src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
                                        />
                                    )}
                                    <span className="truncate">{host}</span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
