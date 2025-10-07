import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../Authentication/firebase";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import SiteHeader from "../Components/SiteHeader";
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { format as inr } from "indian-number-format";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

/* ----------------------- Monte Carlo utils (same as before) ----------------------- */
const toMonthly = (muAnnual, sigmaAnnual) => {
    const dt = 1 / 12;
    const sigmaM = sigmaAnnual * Math.sqrt(dt);
    return { muM: muAnnual, sigmaM, dt };
};
const randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};
function simulatePaths({
    startCorpus = 0, monthlySIP = 0, years = 30, muAnnual = 0.12, sigmaAnnual = 0.18, inflationAnnual = 0.05, nPaths = 2000,
}) {
    const months = Math.max(1, Math.round(years * 12));
    const { sigmaM, dt } = toMonthly(muAnnual, sigmaAnnual);
    const inflM = Math.pow(1 + inflationAnnual, dt) - 1;

    const paths = Array.from({ length: months + 1 }, () => new Array(nPaths).fill(0));
    for (let p = 0; p < nPaths; p++) {
        let S = startCorpus;
        paths[0][p] = S;
        for (let t = 1; t <= months; t++) {
            const z = randn();
            const growth = Math.exp((muAnnual - 0.5 * sigmaM * sigmaM) * dt + sigmaM * z);
            S = S * growth + monthlySIP;
            paths[t][p] = S;
        }
    }
    const percentiles = (arr, q) => {
        const a = [...arr].sort((x, y) => x - y);
        const idx = Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))));
        return a[idx];
    };
    const timeline = [];
    let nominalInflator = 1;
    for (let t = 0; t <= months; t++) {
        if (t > 0) nominalInflator *= 1 + inflM;
        const row = paths[t];
        timeline.push({
            t, p10: percentiles(row, 0.10), p50: percentiles(row, 0.50), p90: percentiles(row, 0.90),
            inflator: nominalInflator, years: t / 12,
        });
    }
    return { timeline, months };
}
function toChartData(timeline) {
    const startDate = new Date();
    const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
    const data = timeline.map((r) => {
        const d = addMonths(startDate, r.t);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return { Date: label, p10: r.p10, p50: r.p50, p90: r.p90 };
    });
    const vals = data.flatMap((d) => [d.p10, d.p50, d.p90]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.08, 1);
    return { data, yMin: Math.floor(min - pad), yMax: Math.ceil(max + pad) };
}

/* ----------------------- Small UI helpers ----------------------- */
function Section({ title, right, children, className = "" }) {
    return (
        <section
            className={`rounded-xl bg-white dark:bg-gray-800 border border-black/10 dark:border-white/10 p-4 sm:p-6 min-w-0 overflow-hidden ${className}`}
        >
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="order-1 flex-1 min-w-0 text-lg sm:text-xl font-semibold truncate">{title}</h2>
                {right ? (
                    <div className="order-2 w-full md:w-auto flex items-center gap-2 flex-wrap justify-start md:justify-end">
                        {right}
                    </div>
                ) : null}
            </div>
            <div className="min-w-0">{children}</div>
        </section>
    );
};

function Labeled({ label, children, dark }) {
    return (
        <label className="block">
            <div className={`text-xs mb-1 ${dark ? "text-gray-300" : "text-gray-600"}`}>{label}</div>
            {children}
        </label>
    );
};

function NumberInput({ value, onChange, step = "1", min, placeholder, dark }) {
    return (
        <input
            type="number" value={value} onChange={(e) => onChange(e.target.value)}
            step={step} min={min} placeholder={placeholder}
            className={`w-full px-3 py-2 rounded-lg border ${dark ? "bg-gray-900 border-white/10 text-gray-100 placeholder-gray-400" : "bg-white border-black/10 text-gray-900 placeholder-gray-400"}`}
        />
    );
};

function Select({ value, onChange, options, dark }) {
    return (
        <select
            value={value} onChange={(e) => onChange(e.target.value)}
            className={`w-full px-3 py-2 rounded-lg border ${dark ? "bg-gray-900 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900"}`}
        >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
};

/* ----------------------- Page ----------------------- */
export default function GoalProjections() {
    const [darkMode, setDarkMode] = useState(false);
    const navigate = useNavigate();

    // Inputs (nominal) – keep as strings for inputs
    const [startCorpus, setStartCorpus] = useState("500000");
    const [monthlySIP, setMonthlySIP] = useState("25000");
    const [years, setYears] = useState("20");
    const [mu, setMu] = useState("12");
    const [sigma, setSigma] = useState("18");
    const [infl, setInfl] = useState("5");
    const [goalMode, setGoalMode] = useState("amount");
    const [goalToday, setGoalToday] = useState("20000000");
    const [nPaths, setNPaths] = useState("2000");

    const [uid, setUid] = useState(auth.currentUser?.uid || null);
    const [isSaving, setIsSaving] = useState(false);
    const [savedTick, setSavedTick] = useState(false);

    useEffect(() => {
        const unsub = auth.onAuthStateChanged((u) => setUid(u?.uid || null));
        return () => unsub();
    }, []);

    // Load saved preferences
    useEffect(() => {
        (async () => {
            if (!uid) return;
            const ref = doc(db, "users", uid, "settings", "goalProjections");
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const s = snap.data();
                if (s.darkMode != null) setDarkMode(!!s.darkMode);
                if (s.startCorpus != null) setStartCorpus(String(s.startCorpus));
                if (s.monthlySIP != null) setMonthlySIP(String(s.monthlySIP));
                if (s.years != null) setYears(String(s.years));
                if (s.mu != null) setMu(String(s.mu));
                if (s.sigma != null) setSigma(String(s.sigma));
                if (s.infl != null) setInfl(String(s.infl));
                if (s.goalMode) setGoalMode(s.goalMode);
                if (s.goalToday != null) setGoalToday(String(s.goalToday));
                if (s.nPaths != null) setNPaths(String(s.nPaths));
            }
        })();
    }, [uid]);

    const sim = useMemo(() => {
        const cfg = {
            startCorpus: Number(startCorpus) || 0,
            monthlySIP: Number(monthlySIP) || 0,
            years: Number(years) || 1,
            muAnnual: (Number(mu) || 0) / 100,
            sigmaAnnual: (Number(sigma) || 0) / 100,
            inflationAnnual: (Number(infl) || 0) / 100,
            nPaths: Math.max(100, Math.min(10000, Number(nPaths) || 2000)),
        };
        return simulatePaths(cfg);
    }, [startCorpus, monthlySIP, years, mu, sigma, infl, nPaths]);
    const chart = useMemo(() => toChartData(sim.timeline), [sim.timeline]);

    // Quick success-prob (re-simulate ends)
    const successProb = useMemo(() => {
        if (goalMode !== "amount") return null;
        const horizon = sim.timeline[sim.timeline.length - 1];
        if (!horizon) return null;
        const goalNominal = (Number(goalToday) || 0) * horizon.inflator;

        const months = sim.months;
        const cfg = {
            startCorpus: Number(startCorpus) || 0,
            monthlySIP: Number(monthlySIP) || 0,
            years: Number(years) || 1,
            muAnnual: (Number(mu) || 0) / 100,
            sigmaAnnual: (Number(sigma) || 0) / 100,
            nPaths: Math.max(200, Math.min(4000, Number(nPaths) || 2000)),
        };
        let success = 0;
        const { sigmaM, dt } = toMonthly(cfg.muAnnual, cfg.sigmaAnnual);
        for (let p = 0; p < cfg.nPaths; p++) {
            let S = cfg.startCorpus;
            for (let t = 1; t <= months; t++) {
                const z = randn();
                const growth = Math.exp((cfg.muAnnual - 0.5 * sigmaM * sigmaM) * dt + sigmaM * z);
                S = S * growth + cfg.monthlySIP;
            }
            if (S >= goalNominal) success++;
        }
        return success / cfg.nPaths;
    }, [goalMode, goalToday, sim, startCorpus, monthlySIP, years, mu, sigma, nPaths]);

    const handleLogout = async () => {
        await signOut(auth);
        navigate("/login");
    };
    const INR = (x) => `₹${inr(Math.max(0, Number(x) || 0).toFixed(0))}`;

    // SAVE preferences
    const savePrefs = async () => {
        if (!uid) return; // not signed in
        try {
            setIsSaving(true);
            const ref = doc(db, "users", uid, "settings", "goalProjections");
            await setDoc(
                ref,
                {
                    darkMode,
                    startCorpus: Number(startCorpus) || 0,
                    monthlySIP: Number(monthlySIP) || 0,
                    years: Number(years) || 1,
                    mu: Number(mu) || 0,
                    sigma: Number(sigma) || 0,
                    infl: Number(infl) || 0,
                    goalMode,
                    goalToday: Number(goalToday) || 0,
                    nPaths: Number(nPaths) || 2000,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
            setSavedTick(true);
            setTimeout(() => setSavedTick(false), 1500);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className={`min-h-screen ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"} `}>
            <div className="">
                <SiteHeader
                    title="Portfolio Tracker"
                    darkMode={darkMode}
                    onToggleDarkMode={() => setDarkMode((v) => !v)}
                    onLogout={handleLogout}
                />
            </div>
            <div className="max-w-7xl mx-auto p-2">
                <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 ">
                    {/* Inputs */}
                    <Section
                        dark={darkMode}
                        title="Inputs"
                        right={
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={savePrefs}
                                    disabled={!uid || isSaving}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium ${!uid || isSaving ? "opacity-60 cursor-not-allowed" : darkMode ? "bg-white/10 hover:bg-white/15" : "bg-white hover:bg-gray-50"} border ${darkMode ? "border-white/10" : "border-black/10"}`}
                                    title={!uid ? "Sign in to save" : "Save preferences"}
                                >
                                    {isSaving ? "Saving…" : "Save"}
                                </button>
                                {savedTick && <span className="text-xs opacity-80">Saved ✓</span>}
                            </div>
                        }
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Labeled dark={darkMode} label="Current Corpus (₹)">
                                <NumberInput dark={darkMode} value={startCorpus} onChange={setStartCorpus} min="0" />
                            </Labeled>
                            <Labeled dark={darkMode} label="Monthly SIP (₹)">
                                <NumberInput dark={darkMode} value={monthlySIP} onChange={setMonthlySIP} min="0" />
                            </Labeled>
                            <Labeled dark={darkMode} label="Horizon (Years)">
                                <NumberInput dark={darkMode} value={years} onChange={setYears} step="1" min="1" />
                            </Labeled>
                            <Labeled dark={darkMode} label="Expected Return p.a. (%)">
                                <NumberInput dark={darkMode} value={mu} onChange={setMu} step="0.1" />
                            </Labeled>
                            <Labeled dark={darkMode} label="Volatility p.a. (%)">
                                <NumberInput dark={darkMode} value={sigma} onChange={setSigma} step="0.1" />
                            </Labeled>
                            <Labeled dark={darkMode} label="Inflation p.a. (%)">
                                <NumberInput dark={darkMode} value={infl} onChange={setInfl} step="0.1" />
                            </Labeled>
                            <Labeled dark={darkMode} label="Simulations (paths)">
                                <NumberInput dark={darkMode} value={nPaths} onChange={setNPaths} step="100" min="100" />
                            </Labeled>
                            <Labeled dark={darkMode} label="Goal Mode">
                                <Select
                                    dark={darkMode}
                                    value={goalMode}
                                    onChange={setGoalMode}
                                    options={[
                                        { value: "amount", label: "Target Amount (today ₹)" },
                                        { value: "none", label: "No target — just project" },
                                    ]}
                                />
                            </Labeled>
                            {goalMode === "amount" && (
                                <Labeled dark={darkMode} label="Goal Amount (today ₹)">
                                    <NumberInput dark={darkMode} value={goalToday} onChange={setGoalToday} min="0" />
                                </Labeled>
                            )}
                        </div>
                    </Section>

                    {/* Chart */}
                    <Section dark={darkMode} title="Projection (Nominal ₹)">
                        <div className="h-[340px] md:h-[420px]">
                            {chart.data.length === 0 ? (
                                <div className={`${darkMode ? "text-gray-300" : "text-gray-600"} h-full grid place-items-center`}>No data</div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chart.data} margin={{ top: 8, right: 12, bottom: 6, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"} />
                                        <XAxis dataKey="Date" tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }} minTickGap={24} interval="preserveEnd" />
                                        <YAxis
                                            width={80}
                                            tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }}
                                            tickFormatter={(v) => `₹${inr(Number(v).toFixed(0))}`}
                                            domain={[chart.yMin, chart.yMax]}
                                        />
                                        <Tooltip
                                            formatter={(v, name) => [`₹${inr(Number(v).toFixed(0))}`, name]}
                                            contentStyle={{
                                                backgroundColor: darkMode ? "rgba(17,24,39,.95)" : "#fff",
                                                border: `1px solid ${darkMode ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.1)"}`,
                                                borderRadius: 8,
                                            }}
                                        />
                                        <Legend />
                                        <Area type="monotone" dataKey="p90" stroke="#34d399" fill="#34d399" fillOpacity={0.15} />
                                        <Area type="monotone" dataKey="p50" stroke="#6366f1" fill="none" strokeWidth={2} />
                                        <Area type="monotone" dataKey="p10" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.12} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </Section>

                    {/* Summary */}
                    <Section dark={darkMode} title="Summary" className="md:col-span-2 lg:col-span-3">
                        <div
                            className="
                                    grid gap-4 md:gap-6 lg:gap-8
                                    grid-cols-1 sm:grid-cols-2
                                    lg:[grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]
                                    items-stretch
                                    "
                        >
                            <div className={`h-full rounded-lg border ${darkMode ? "border-white/10" : "border-black/10"} p-3 flex flex-col`}>
                                <div className={`${darkMode ? "text-gray-300" : "text-gray-600"} text-sm`}>Inputs</div>
                                <div className="mt-1 text-sm">
                                    Corpus: <span className="font-semibold">{INR(startCorpus)}</span><br />
                                    SIP: <span className="font-semibold">{INR(monthlySIP)}/mo</span><br />
                                    Horizon: <span className="font-semibold">{years} yrs</span><br />
                                    Return: <span className="font-semibold">{mu}% p.a.</span> • Vol: <span className="font-semibold">{sigma}%</span> • Infl: <span className="font-semibold">{infl}%</span>
                                </div>
                            </div>

                            <div className={`h-full rounded-lg border ${darkMode ? "border-white/10" : "border-black/10"} p-3 flex flex-col`}>
                                <div className={`${darkMode ? "text-gray-300" : "text-gray-600"} text-sm`}>Percentiles at Horizon</div>
                                {chart.data.length ? (
                                    <div className="mt-1 space-y-1">
                                        <div>10th %ile: <span className="font-bold">₹{inr(chart.data.at(-1).p10.toFixed(0))}</span></div>
                                        <div>Median: <span className="font-bold">₹{inr(chart.data.at(-1).p50.toFixed(0))}</span></div>
                                        <div>90th %ile: <span className="font-bold">₹{inr(chart.data.at(-1).p90.toFixed(0))}</span></div>
                                    </div>
                                ) : (
                                    <div className={`${darkMode ? "text-gray-400" : "text-gray-500"} text-sm`}>—</div>
                                )}
                            </div>

                            {goalMode === "amount" && (
                                <div className={`h-full rounded-lg border ${darkMode ? "border-white/10" : "border-black/10"} p-3 flex flex-col`}>
                                    <div className={`${darkMode ? "text-gray-300" : "text-gray-600"} text-sm`}>Goal Success (at horizon)</div>
                                    <div className="text-2xl font-extrabold">
                                        {successProb == null ? "—" : `${(successProb * 100).toFixed(1)}%`}
                                    </div>
                                    <div className={`mt-2 text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                                        Goal is grown by inflation to horizon before checking success.
                                    </div>
                                </div>
                            )}
                        </div>
                    </Section>

                </div>
            </div>
        </div >
    );
}
