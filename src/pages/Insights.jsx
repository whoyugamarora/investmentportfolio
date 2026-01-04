import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faClipboard,
  faCircleInfo,
  faTriangleExclamation,
  faShieldHalved,
  faChartPie,
  faScaleBalanced,
  faBolt,
  faChartLine,
  faCheck,
  faXmark,
  faWandMagicSparkles,
  faGears,
  faFlask,
  faBell,
  faSliders,
  faArrowUp,
  faArrowDown,
  faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import { format as formatIndianNumber } from "indian-number-format";

import { auth, db } from "../Authentication/firebase";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

/* ---------- helpers ---------- */
const money = (n) => "₹" + formatIndianNumber(Number(n || 0).toFixed(0));
const money0 = (n) => money(Number(n || 0));
const pct = (n) => Number(n || 0).toFixed(2) + "%";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function ymdLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function cacheKeyFor(pid) {
  // must match your Dashboard cache key
  return "dashboard:rows:v3:" + String(pid || "default");
}
function readCache(pid) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(pid));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.data)) return null;
    return obj.data;
  } catch {
    return null;
  }
}

function pickIdealWeightPct(row) {
  const candidates = [
    "Ideal %",
    "IdealPct",
    "Ideal Pct",
    "Target %",
    "TargetPct",
    "Target Weight",
    "Target Weight %",
    "Ideal Weight",
    "Ideal Weight %",
  ];
  for (let i = 0; i < candidates.length; i++) {
    const k = candidates[i];
    if (row && row[k] !== undefined && row[k] !== null && row[k] !== "") {
      const v = Number(row[k]);
      if (!isNaN(v)) return v;
    }
  }
  return null;
}

function isCashRow(r) {
  const name = String(r?.Company || "").toLowerCase();
  return name === "cash" || name.includes("cash ");
}

function normalizeRows(rows) {
  return (rows || []).map((item) => ({
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
}

function computeTotals(rows) {
  const t = { current: 0, buy: 0, pnl: 0, dayGain: 0, cash: 0 };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cv = Number(r["Current Value"] || 0);
    const bv = Number(r["Buy Value"] || 0);
    const pl = Number(r["Profit/Loss"] || 0);
    const dg = Number(r["Day Gain"] || 0);

    t.current += cv;
    t.buy += bv;
    t.pnl += pl;
    t.dayGain += dg;

    if (isCashRow(r)) t.cash += cv;
  }
  return t;
}

function weightPct(currentValue, totalCurrent) {
  if (!totalCurrent) return 0;
  return (Number(currentValue || 0) / totalCurrent) * 100;
}

function computeWeightedPE(rows) {
  let totalWeightedPE = 0;
  let totalValueForPE = 0;
  for (let i = 0; i < rows.length; i++) {
    const sv = Number(rows[i]["Current Value"] || 0);
    const pe = Number(rows[i]["PE"] || 0);
    if (sv && pe) {
      totalWeightedPE += pe * sv;
      totalValueForPE += sv;
    }
  }
  return totalValueForPE ? totalWeightedPE / totalValueForPE : 0;
}

/* ---------- health score engine ---------- */
function buildInsights(rows, opts = {}) {
  const {
    rulesEnabled = {
      concentration: true,
      cash: true,
      valuation: true,
      movers: true,
      drift: true,
      pe: true,
    },
  } = opts;

  const totals = computeTotals(rows);
  const totalCurrent = totals.current;

  if (!rows.length || !totalCurrent) {
    return {
      totals,
      weightedPE: "0.00",
      health: { score: 0, label: "No data", breakdown: [] },
      signals: {},
      insights: [
        {
          id: "no-data",
          severity: "info",
          icon: faCircleInfo,
          title: "No holdings found",
          message: "Open Dashboard once (so cache exists) or ensure your sheet API returns rows.",
          action: "Check your data fetch / sheet JSON output.",
          explain: { threshold: null, value: null, formula: null },
        },
      ],
      drift: { hasIdeal: false, driftAbsPct: null, driftScore10: null },
      rebalance: { hasIdeal: false, suggestions: [] },
      attribution: { topTotal: [], topToday: [] },
    };
  }

  // biggest position
  let biggest = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (isCashRow(r)) continue;
    if (!biggest || Number(r["Current Value"] || 0) > Number(biggest["Current Value"] || 0)) biggest = r;
  }
  const biggestPct = biggest ? weightPct(biggest["Current Value"] || 0, totalCurrent) : 0;

  // cash
  const cashPct = weightPct(totals.cash, totalCurrent);

  // valuation split
  let comfortableValue = 0;
  let uncomfortableValue = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cv = Number(r["Current Value"] || 0);
    if (r.Valuation === "Comfortable") comfortableValue += cv;
    if (r.Valuation === "Uncomfortable") uncomfortableValue += cv;
  }
  const uncomfortablePct = weightPct(uncomfortableValue, totalCurrent);
  const comfortablePct = weightPct(comfortableValue, totalCurrent);

  // top movers impact
  const totalAbsDay = rows.reduce((s, r) => s + Math.abs(Number(r["Day Gain"] || 0)), 0);
  const movers = [...rows]
    .map((r) => ({ r, v: Math.abs(Number(r["Day Gain"] || 0)) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);
  const top3Abs = movers.reduce((s, x) => s + x.v, 0);
  const top3ImpactPct = totalAbsDay ? (top3Abs / totalAbsDay) * 100 : 0;

  // drift score if ideal weights exist
  let driftAbsPct = null;
  let hasIdeal = false;
  let sumAbs = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (isCashRow(r)) continue;
    const ideal = pickIdealWeightPct(r);
    if (ideal !== null) {
      hasIdeal = true;
      const currentW = weightPct(r["Current Value"] || 0, totalCurrent);
      sumAbs += Math.abs(currentW - ideal);
    }
  }
  if (hasIdeal) driftAbsPct = sumAbs / 2;
  const driftScore10 = driftAbsPct === null ? null : clamp((driftAbsPct / 25) * 10, 0, 10);

  // rebalance suggestions
  let rebalanceSuggestions = [];
  if (hasIdeal) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (isCashRow(r)) continue;
      const ideal = pickIdealWeightPct(r);
      if (ideal === null) continue;

      const currentValue = Number(r["Current Value"] || 0);
      const targetValue = (ideal / 100) * totalCurrent;
      const delta = targetValue - currentValue; // + buy, - sell

      rebalanceSuggestions.push({
        Company: r.Company,
        delta,
        currentValue,
        targetValue,
        idealPct: ideal,
        currentPct: weightPct(currentValue, totalCurrent),
      });
    }
    rebalanceSuggestions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  // weighted PE + score
  const weightedPE = computeWeightedPE(rows);

  // penalties (only if rule enabled)
  const concPenalty = rulesEnabled.concentration ? clamp((biggestPct - 10) * 1.6, 0, 25) : 0;
  const cashPenalty = rulesEnabled.cash ? clamp((cashPct - 5) * 1.2, 0, 20) : 0;
  const uncomfortPenalty = rulesEnabled.valuation ? clamp(uncomfortablePct * 0.6, 0, 25) : 0;
  const driftPenalty = rulesEnabled.drift ? (driftScore10 === null ? 0 : clamp(driftScore10 * 2.0, 0, 20)) : 0;
  const pePenalty = rulesEnabled.pe ? clamp((weightedPE - 30) * 0.35, 0, 15) : 0;

  const rawScore = 100 - (concPenalty + cashPenalty + uncomfortPenalty + driftPenalty + pePenalty);
  const score = Math.round(clamp(rawScore, 0, 100));
  const scoreLabel = score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 50 ? "Caution" : "High Risk";

  const breakdown = [
    { label: "Concentration", value: Math.round(25 - concPenalty), max: 25, disabled: !rulesEnabled.concentration },
    { label: "Cash drag", value: Math.round(20 - cashPenalty), max: 20, disabled: !rulesEnabled.cash },
    { label: "Valuation mix", value: Math.round(25 - uncomfortPenalty), max: 25, disabled: !rulesEnabled.valuation },
    { label: "Drift", value: Math.round(20 - driftPenalty), max: 20, disabled: !rulesEnabled.drift, hidden: driftScore10 === null },
    { label: "P/E risk", value: Math.round(15 - pePenalty), max: 15, disabled: !rulesEnabled.pe },
  ].filter((x) => !x.hidden);

  const concentrationSeverity = biggestPct >= 25 ? "warn" : biggestPct >= 15 ? "info" : "good";
  const cashSeverity = cashPct >= 20 ? "warn" : cashPct >= 10 ? "info" : "good";
  const uncomfortSeverity = uncomfortablePct >= 35 ? "warn" : uncomfortablePct >= 20 ? "info" : "good";
  const moverSeverity = top3ImpactPct >= 70 ? "warn" : top3ImpactPct >= 50 ? "info" : "good";
  const driftSeverity = driftScore10 === null ? "info" : driftScore10 >= 7 ? "warn" : driftScore10 >= 4 ? "info" : "good";
  const peSeverity = weightedPE >= 60 ? "warn" : weightedPE >= 40 ? "info" : "good";

  const insights = [
    {
      id: "concentration",
      enabled: rulesEnabled.concentration,
      severity: concentrationSeverity,
      icon: faChartPie,
      title: "Concentration risk",
      message: `${biggest?.Company || "Top holding"} is ${pct(biggestPct)} of portfolio.`,
      action: biggestPct >= 25 ? "Consider trimming or adding smaller positions to diversify." : "Concentration looks manageable.",
      explain: {
        threshold: "INFO ≥ 15%, WARN ≥ 25% (largest holding weight)",
        value: `${pct(biggestPct)} (${biggest?.Company || "—"})`,
        formula: "weight% = (holding current value / total current value) × 100",
      },
    },
    {
      id: "cash",
      enabled: rulesEnabled.cash,
      severity: cashSeverity,
      icon: faShieldHalved,
      title: "Cash allocation",
      message: `Cash is ${pct(cashPct)} (${money(totals.cash)}).`,
      action: cashPct >= 20 ? "If unintentional, consider deploying gradually." : "Cash level looks fine.",
      explain: {
        threshold: "INFO ≥ 10%, WARN ≥ 20% (cash weight)",
        value: `${pct(cashPct)} (${money(totals.cash)})`,
        formula: "cash% = (cash current value / total current value) × 100",
      },
    },
    {
      id: "valuation",
      enabled: rulesEnabled.valuation,
      severity: uncomfortSeverity,
      icon: faTriangleExclamation,
      title: "Valuation exposure",
      message: `Uncomfortable holdings are ${pct(uncomfortablePct)} of value (Comfortable: ${pct(comfortablePct)}).`,
      action: uncomfortablePct >= 35 ? "Review overvalued names and tighten position sizing." : "Valuation mix looks acceptable.",
      explain: {
        threshold: "INFO ≥ 20%, WARN ≥ 35% (uncomfortable value weight)",
        value: `${pct(uncomfortablePct)} (Comfortable: ${pct(comfortablePct)})`,
        formula: "uncomfortable% = (sum current value where Valuation=Uncomfortable / total current) × 100",
      },
    },
    {
      id: "movers",
      enabled: rulesEnabled.movers,
      severity: moverSeverity,
      icon: faBolt,
      title: "Today’s movement concentration",
      message: `Top 3 movers explain ${pct(top3ImpactPct)} of today’s absolute change.`,
      action: top3ImpactPct >= 70 ? "Daily P/L dominated by a few names—watch sizing." : "Daily movement is reasonably distributed.",
      explain: {
        threshold: "INFO ≥ 50%, WARN ≥ 70% (top-3 share of absolute day move)",
        value: `${pct(top3ImpactPct)}`,
        formula: "top3% = (sum abs(dayGain) of top3 / sum abs(dayGain) of all) × 100",
      },
    },
    {
      id: "drift",
      enabled: rulesEnabled.drift,
      severity: driftSeverity,
      icon: faScaleBalanced,
      title: "Rebalance drift",
      message:
        driftScore10 === null
          ? "No target weights found (add Ideal % / Target % columns to enable drift scoring)."
          : `Drift score: ${driftScore10.toFixed(1)}/10 (approx drift ${pct(driftAbsPct)}).`,
      action:
        driftScore10 === null
          ? "Add an Ideal % column for each holding (optional)."
          : driftScore10 >= 7
            ? "Consider rebalancing soon."
            : "Drift looks under control.",
      explain: {
        threshold: driftScore10 === null ? "Needs Ideal % / Target % columns" : "WARN ≥ 7/10, INFO ≥ 4/10",
        value: driftScore10 === null ? "—" : `${driftScore10.toFixed(1)}/10 (drift≈${pct(driftAbsPct)})`,
        formula: "driftAbs% = (Σ|currentWeight - idealWeight|)/2 ; score10 = (driftAbs%/25)*10",
      },
    },
    {
      id: "pe",
      enabled: rulesEnabled.pe,
      severity: peSeverity,
      icon: faChartLine,
      title: "Valuation level (Weighted P/E)",
      message: `Weighted P/E is ${Number(weightedPE || 0).toFixed(2)}.`,
      action: weightedPE >= 60 ? "Be cautious on new adds; review margin of safety." : weightedPE >= 40 ? "Monitor valuations; prefer selective adds." : "P/E looks reasonable.",
      explain: {
        threshold: "INFO ≥ 40, WARN ≥ 60",
        value: Number(weightedPE || 0).toFixed(2),
        formula: "weightedPE = Σ(PEᵢ × currentValueᵢ) / Σ(currentValueᵢ), for rows where PE exists",
      },
    },
  ];

  // attribution
  const topTotal = [...rows]
    .filter((r) => !isCashRow(r))
    .map((r) => ({ Company: r.Company, v: Number(r["Profit/Loss"] || 0) }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 10);

  const topToday = [...rows]
    .filter((r) => !isCashRow(r))
    .map((r) => ({ Company: r.Company, v: Number(r["Day Gain"] || 0) }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 10);

  const signals = {
    biggestPct,
    biggestName: biggest?.Company || null,
    cashPct,
    uncomfortablePct,
    top3ImpactPct,
    driftScore10,
    driftAbsPct,
    weightedPE: Number(weightedPE || 0),
  };

  return {
    totals,
    weightedPE: Number(weightedPE || 0).toFixed(2),
    health: { score, label: scoreLabel, breakdown },
    signals,
    insights,
    drift: { hasIdeal, driftAbsPct, driftScore10 },
    rebalance: { hasIdeal, suggestions: rebalanceSuggestions },
    attribution: { topTotal, topToday },
  };
}

/* ---------- stress tests ---------- */
function runStressTests(rows) {
  const totals = computeTotals(rows);
  const totalCurrent = totals.current;

  const nonCash = rows.filter((r) => !isCashRow(r));
  const sortedByWeight = [...nonCash].sort((a, b) => Number(b["Current Value"] || 0) - Number(a["Current Value"] || 0));
  const top = sortedByWeight[0];

  const sortedByPnL = [...nonCash].sort((a, b) => Number(a["Profit/Loss"] || 0) - Number(b["Profit/Loss"] || 0));
  const worst3 = sortedByPnL.slice(0, 3);

  const tests = [];

  // top holding -10%
  if (top) {
    const hit = 0.10 * Number(top["Current Value"] || 0);
    tests.push({
      id: "top-10",
      title: `Top holding drops -10%`,
      subtitle: `${top.Company}`,
      loss: hit,
      lossPct: totalCurrent ? (hit / totalCurrent) * 100 : 0,
    });
  }

  // worst3 -15%
  if (worst3.length) {
    const base = worst3.reduce((s, r) => s + Number(r["Current Value"] || 0), 0);
    const hit = 0.15 * base;
    tests.push({
      id: "worst3-15",
      title: `Worst 3 holdings drop -15%`,
      subtitle: worst3.map((x) => x.Company).join(", "),
      loss: hit,
      lossPct: totalCurrent ? (hit / totalCurrent) * 100 : 0,
    });
  }

  // portfolio drawdown -5%
  tests.push({
    id: "all-5",
    title: `Whole portfolio drops -5%`,
    subtitle: `Broad market shock`,
    loss: 0.05 * totalCurrent,
    lossPct: 5,
  });

  // cash drag (if cash > 0) – opportunity cost (illustrative)
  const cashPct = totalCurrent ? (totals.cash / totalCurrent) * 100 : 0;
  if (totals.cash > 0) {
    const opp = 0.08 * totals.cash; // 8% annualized illustrative
    tests.push({
      id: "cash-opp",
      title: `Cash opportunity cost (8%/yr)`,
      subtitle: `Illustrative: not a guarantee`,
      loss: opp,
      lossPct: totalCurrent ? (opp / totalCurrent) * 100 : 0,
      tag: `Cash ${pct(cashPct)}`,
    });
  }

  return tests;
}

/* ---------- tiny UI primitives ---------- */
const Pill = ({ tone = "neutral", dark, children }) => {
  const map = {
    neutral: dark ? "bg-white/10 text-gray-200" : "bg-gray-100 text-gray-700",
    good: dark ? "bg-emerald-500/15 text-emerald-200" : "bg-emerald-50 text-emerald-700",
    info: dark ? "bg-indigo-500/15 text-indigo-200" : "bg-indigo-50 text-indigo-700",
    warn: dark ? "bg-amber-500/15 text-amber-200" : "bg-amber-50 text-amber-800",
    bad: dark ? "bg-rose-500/15 text-rose-200" : "bg-rose-50 text-rose-700",
  };
  return <span className={["inline-flex items-center px-2.5 py-1 rounded-full text-xs font-extrabold", map[tone]].join(" ")}>{children}</span>;
};

const Card = ({ dark, className = "", children }) => (
  <div className={["rounded-3xl border shadow-sm", dark ? "bg-white/5 border-white/10" : "bg-white border-black/10", className].join(" ")}>
    {children}
  </div>
);

const CardHeader = ({ dark, title, subtitle, right }) => (
  <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h2 className={["text-lg sm:text-xl font-extrabold", dark ? "text-white" : "text-gray-900"].join(" ")}>{title}</h2>
      {subtitle ? <p className={["mt-1 text-sm", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>{subtitle}</p> : null}
    </div>
    {right ? <div className="shrink-0">{right}</div> : null}
  </div>
);

const CardBody = ({ children }) => <div className="px-5 pb-5">{children}</div>;

function toneForSeverity(sev) {
  if (sev === "bad") return "bad";
  if (sev === "warn") return "warn";
  if (sev === "info") return "info";
  return "good";
}

function ScoreRing({ score, dark }) {
  const size = 120;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (score / 100) * c;

  const label = score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 50 ? "Caution" : "High Risk";

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={dark ? "rgba(99,102,241,0.9)" : "rgba(79,70,229,0.9)"}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className={dark ? "fill-white" : "fill-gray-900"} style={{ fontSize: 26, fontWeight: 900 }}>
          {score}
        </text>
      </svg>

      <div className="min-w-0">
        <div className={["text-sm font-extrabold", dark ? "text-white" : "text-gray-900"].join(" ")}>Portfolio Health</div>
        <div className={["mt-1 text-sm", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>{label}</div>
      </div>
    </div>
  );
}

function SparkLine({ values = [], dark }) {
  const w = 260;
  const h = 64;
  if (!values.length) {
    return <div className={["h-16 rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * (w - 12) + 6;
    const y = h - ((v - min) / span) * (h - 12) - 6;
    return `${x},${y}`;
  });

  return (
    <svg width={w} height={h} className={["rounded-2xl border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50"].join(" ")}>
      <polyline points={pts.join(" ")} fill="none" stroke={dark ? "rgba(99,102,241,0.95)" : "rgba(79,70,229,0.95)"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- alerts ---------- */
const DEFAULT_ALERTS = [
  { type: "cashPct", op: ">", value: 20, label: "Cash % > 20", enabled: true, severity: "warn" },
  { type: "biggestPct", op: ">", value: 25, label: "Largest holding % > 25", enabled: true, severity: "warn" },
  { type: "uncomfortablePct", op: ">", value: 30, label: "Uncomfortable % > 30", enabled: true, severity: "warn" },
  { type: "dayGain", op: "<", value: -5000, label: "Today P/L < -₹5,000", enabled: true, severity: "warn" },
  { type: "weightedPE", op: ">", value: 60, label: "Weighted P/E > 60", enabled: true, severity: "info" },
];

function evalAlert(alert, signals, totals) {
  const getVal = () => {
    if (alert.type === "cashPct") return Number(signals.cashPct || 0);
    if (alert.type === "biggestPct") return Number(signals.biggestPct || 0);
    if (alert.type === "uncomfortablePct") return Number(signals.uncomfortablePct || 0);
    if (alert.type === "dayGain") return Number(totals.dayGain || 0);
    if (alert.type === "weightedPE") return Number(signals.weightedPE || 0);
    return 0;
  };
  const v = getVal();
  const t = Number(alert.value);
  if (alert.op === ">") return v > t;
  if (alert.op === "<") return v < t;
  if (alert.op === ">=") return v >= t;
  if (alert.op === "<=") return v <= t;
  if (alert.op === "==") return v === t;
  return false;
}

function formatAlertValue(type, val) {
  if (type === "cashPct" || type === "biggestPct" || type === "uncomfortablePct") return pct(val);
  if (type === "dayGain") return money0(val);
  if (type === "weightedPE") return Number(val || 0).toFixed(2);
  return String(val);
}

/* ---------- main page ---------- */
export default function InsightsPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const pid = sp.get("pid") || "default";

  // get data from navigation OR cache fallback
  const navState = window.history.state?.usr || {};
  const dark = navState.darkMode !== undefined ? !!navState.darkMode : false;
  const dataFromState = Array.isArray(navState.data) ? navState.data : null;
  const cached = readCache(pid);

  const [rawRows] = useState(() => normalizeRows(Array.isArray(dataFromState) ? dataFromState : Array.isArray(cached) ? cached : []));
  const rows = rawRows;

  const [copied, setCopied] = useState(false);

  // rules toggles
  const [rulesEnabled, setRulesEnabled] = useState({
    concentration: true,
    cash: true,
    valuation: true,
    movers: true,
    drift: true,
    pe: true,
  });

  // Explain / modal
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainItem, setExplainItem] = useState(null);

  // History
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState("idle"); // idle|saving|saved|error

  // Alerts
  const [alerts, setAlerts] = useState([]);
  const [alertsStatus, setAlertsStatus] = useState("idle"); // loading|ready|error
  const [alertsPanel, setAlertsPanel] = useState(false);

  // What-if rebalance simulator
  const [simOpen, setSimOpen] = useState(false);
  const [simHolding, setSimHolding] = useState("");
  const [simAction, setSimAction] = useState("BUY"); // BUY | SELL
  const [simAmount, setSimAmount] = useState("");
  const [simCashMode, setSimCashMode] = useState("USE_CASH"); // USE_CASH | IGNORE_CASH

  // Stress tests
  const [stressOpen, setStressOpen] = useState(false);

  // view mode for Insights Engine
  const [mode, setMode] = useState("FULL"); // FULL | ONLY_RISKS | ONLY_GOOD

  const pack = useMemo(() => buildInsights(rows, { rulesEnabled }), [rows, rulesEnabled]);

  // ✅ Top Risks should ONLY show warn/bad
  const topRisks = useMemo(() => pack.insights.filter((x) => x.enabled && (x.severity === "warn" || x.severity === "bad")), [pack.insights]);
  const fullInsights = useMemo(() => pack.insights.filter((x) => x.enabled), [pack.insights]);

  const filteredInsights = useMemo(() => {
    if (mode === "ONLY_RISKS") return fullInsights.filter((x) => x.severity === "warn" || x.severity === "bad");
    if (mode === "ONLY_GOOD") return fullInsights.filter((x) => x.severity === "good");
    return fullInsights;
  }, [mode, fullInsights]);

  const stressTests = useMemo(() => runStressTests(rows), [rows]);

  // Attribution
  const topTotal = pack.attribution?.topTotal || [];
  const topToday = pack.attribution?.topToday || [];

  // Simulated pack
  const simPack = useMemo(() => {
    if (!simOpen) return null;

    const amt = Number(simAmount || 0);
    if (!amt || amt <= 0 || !simHolding) return null;

    const updated = rows.map((r) => ({ ...r }));

    // locate selected holding
    const idx = updated.findIndex((r) => String(r.Company || "") === simHolding);
    if (idx < 0) return null;

    // find cash row if exists
    const cashIdx = updated.findIndex((r) => isCashRow(r));
    const hasCash = cashIdx >= 0;

    const holding = updated[idx];
    const cv = Number(holding["Current Value"] || 0);

    const delta = simAction === "BUY" ? amt : -amt;
    holding["Current Value"] = Math.max(0, cv + delta);

    // keep Buy Value unchanged (this is a what-if; you can extend later)
    // approximate Day Gain/PnL unchanged (what-if is allocation not market move)

    if (simCashMode === "USE_CASH") {
      if (hasCash) {
        const cash = updated[cashIdx];
        const cashCv = Number(cash["Current Value"] || 0);
        cash["Current Value"] = Math.max(0, cashCv - (simAction === "BUY" ? amt : -amt));
      }
    }

    return buildInsights(updated, { rulesEnabled });
  }, [simOpen, simHolding, simAction, simAmount, simCashMode, rows, rulesEnabled]);

  const simDelta = useMemo(() => {
    if (!simPack) return null;
    return {
      score: simPack.health.score - pack.health.score,
      cashPct: (simPack.signals.cashPct || 0) - (pack.signals.cashPct || 0),
      biggestPct: (simPack.signals.biggestPct || 0) - (pack.signals.biggestPct || 0),
      uncomfortablePct: (simPack.signals.uncomfortablePct || 0) - (pack.signals.uncomfortablePct || 0),
    };
  }, [simPack, pack]);

  // Copy summary
  const copySummary = async () => {
    try {
      const lines = [];
      lines.push(`Portfolio Insights (pid: ${pid})`);
      lines.push(`Health Score: ${pack.health.score}/100 (${pack.health.label})`);
      lines.push(`Portfolio Value: ${money(pack.totals.current)}`);
      lines.push(`Invested: ${money(pack.totals.buy)}`);
      lines.push(`Total P/L: ${money(pack.totals.pnl)}`);
      lines.push(`Today P/L: ${money(pack.totals.dayGain)}`);
      lines.push(`Weighted P/E: ${pack.weightedPE}`);
      lines.push("");
      lines.push(`Top Risks (${topRisks.length}):`);
      if (!topRisks.length) lines.push("- None (no WARN/BAD triggered)");
      for (let i = 0; i < topRisks.length; i++) {
        const it = topRisks[i];
        lines.push(`- ${it.title}: ${it.message}`);
      }
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  // Keyboard: Esc closes panels
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        setExplainOpen(false);
        setAlertsPanel(false);
        setSimOpen(false);
        setStressOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------- History save + load (14 days) ---------------- */
  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        const u = auth.currentUser;
        if (!u?.uid) return;

        const dayKey = ymdLocal(new Date());
        const ref = doc(db, "portfolioInsights", `${u.uid}_${pid}_${dayKey}`);

        setHistoryStatus("saving");

        const existing = await getDoc(ref);
        if (!existing.exists()) {
          const payload = {
            uid: u.uid,
            pid,
            dayKey,
            createdAt: serverTimestamp(),
            healthScore: pack.health.score,
            healthLabel: pack.health.label,
            weightedPE: Number(pack.weightedPE || 0),
            signals: {
              cashPct: Number(pack.signals.cashPct || 0),
              biggestPct: Number(pack.signals.biggestPct || 0),
              uncomfortablePct: Number(pack.signals.uncomfortablePct || 0),
              top3ImpactPct: Number(pack.signals.top3ImpactPct || 0),
              driftScore10: pack.signals.driftScore10 === null ? null : Number(pack.signals.driftScore10 || 0),
            },
            totals: {
              current: Number(pack.totals.current || 0),
              buy: Number(pack.totals.buy || 0),
              pnl: Number(pack.totals.pnl || 0),
              dayGain: Number(pack.totals.dayGain || 0),
              cash: Number(pack.totals.cash || 0),
            },
          };
          await setDoc(ref, payload);
        }

        if (!alive) return;
        setHistoryStatus("saved");

        const qy = query(
          collection(db, "portfolioInsights"),
          where("uid", "==", u.uid),
          where("pid", "==", pid),
          orderBy("dayKey", "desc"),
          limit(14)
        );
        const snap = await getDocs(qy);
        const rowsH = [];
        snap.forEach((d) => rowsH.push({ id: d.id, ...d.data() }));
        rowsH.sort((a, b) => String(a.dayKey).localeCompare(String(b.dayKey)));
        if (!alive) return;
        setHistory(rowsH);
      } catch {
        if (!alive) return;
        setHistoryStatus("error");
      }
    }

    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, pack.health.score]);

  const historySeries = useMemo(() => {
    const score = history.map((h) => Number(h.healthScore || 0));
    const cashPct = history.map((h) => Number(h?.signals?.cashPct || 0));
    const biggestPct = history.map((h) => Number(h?.signals?.biggestPct || 0));
    const uncomfort = history.map((h) => Number(h?.signals?.uncomfortablePct || 0));
    return { score, cashPct, biggestPct, uncomfort };
  }, [history]);

  const changeSinceYesterday = useMemo(() => {
    if (!history || history.length < 2) return null;
    const prev = history[history.length - 2];
    const curr = history[history.length - 1];

    const dScore = Number(curr.healthScore || 0) - Number(prev.healthScore || 0);
    const dCash = Number(curr?.signals?.cashPct || 0) - Number(prev?.signals?.cashPct || 0);
    const dBig = Number(curr?.signals?.biggestPct || 0) - Number(prev?.signals?.biggestPct || 0);
    const dUnc = Number(curr?.signals?.uncomfortablePct || 0) - Number(prev?.signals?.uncomfortablePct || 0);

    return { dScore, dCash, dBig, dUnc, prevDay: prev.dayKey, currDay: curr.dayKey };
  }, [history]);

  /* ---------------- Alerts load + init ---------------- */
  useEffect(() => {
    let alive = true;

    async function loadAlerts() {
      try {
        const u = auth.currentUser;
        if (!u?.uid) return;

        setAlertsStatus("loading");

        const qy = query(collection(db, "portfolioAlerts"), where("uid", "==", u.uid), where("pid", "==", pid), orderBy("createdAt", "asc"));
        const snap = await getDocs(qy);

        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));

        // if empty, create defaults
        if (!list.length) {
          for (let i = 0; i < DEFAULT_ALERTS.length; i++) {
            const a = DEFAULT_ALERTS[i];
            await addDoc(collection(db, "portfolioAlerts"), {
              uid: u.uid,
              pid,
              ...a,
              createdAt: serverTimestamp(),
            });
          }
          const snap2 = await getDocs(qy);
          const list2 = [];
          snap2.forEach((d) => list2.push({ id: d.id, ...d.data() }));
          if (!alive) return;
          setAlerts(list2);
        } else {
          if (!alive) return;
          setAlerts(list);
        }

        if (!alive) return;
        setAlertsStatus("ready");
      } catch {
        if (!alive) return;
        setAlertsStatus("error");
      }
    }

    loadAlerts();
    return () => {
      alive = false;
    };
  }, [pid]);

  const triggeredAlerts = useMemo(() => {
    if (!alerts || !alerts.length) return [];
    return alerts
      .filter((a) => a.enabled)
      .map((a) => ({
        ...a,
        triggered: evalAlert(a, pack.signals, pack.totals),
      }))
      .filter((a) => a.triggered);
  }, [alerts, pack.signals, pack.totals]);

  async function toggleAlert(id, enabled) {
    try {
      await updateDoc(doc(db, "portfolioAlerts", id), { enabled: !!enabled });
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !!enabled } : a)));
    } catch {
      // ignore
    }
  }

  async function addAlert() {
    try {
      const u = auth.currentUser;
      if (!u?.uid) return;

      const base = { type: "cashPct", op: ">", value: 20, label: "Custom: Cash % > 20", enabled: true, severity: "warn" };
      const ref = await addDoc(collection(db, "portfolioAlerts"), { uid: u.uid, pid, ...base, createdAt: serverTimestamp() });
      setAlerts((prev) => [...prev, { id: ref.id, uid: u.uid, pid, ...base }]);
    } catch {
      // ignore
    }
  }

  async function removeAlert(id) {
    try {
      await deleteDoc(doc(db, "portfolioAlerts", id));
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // ignore
    }
  }

  async function updateAlertField(id, patch) {
    try {
      await updateDoc(doc(db, "portfolioAlerts", id), patch);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    } catch {
      // ignore
    }
  }

  /* ---------- derived UI helpers ---------- */
  const holdingsList = useMemo(() => rows.filter((r) => !isCashRow(r)).map((r) => String(r.Company || "")).filter(Boolean).sort(), [rows]);

  const openExplain = (it) => {
    setExplainItem(it);
    setExplainOpen(true);
  };

  function deltaBadge(v, suffix = "") {
    const pos = v > 0;
    const zero = Math.abs(v) < 1e-9;
    const tone = zero ? "neutral" : pos ? "good" : "bad";
    return (
      <Pill dark={dark} tone={tone}>
        <FontAwesomeIcon icon={zero ? faCircleInfo : pos ? faArrowUp : faArrowDown} className="mr-2" />
        {zero ? "0" : (pos ? "+" : "") + v.toFixed(2)}
        {suffix}
      </Pill>
    );
  }

  return (
    <div className={["min-h-screen", dark ? "bg-gray-950 text-gray-100" : "bg-gray-50 text-gray-900"].join(" ")}>
      {/* Top bar */}
      <div className={["border-b", dark ? "border-white/10" : "border-black/10"].join(" ")}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className={[
                "px-3 py-2 rounded-2xl text-sm font-extrabold border inline-flex items-center gap-2",
                dark ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200" : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faArrowLeft} />
              Back
            </button>

            <div className="min-w-0">
              <div className="text-2xl font-extrabold truncate">Insights</div>
              <div className={["text-sm", dark ? "text-gray-300" : "text-gray-600"].join(" ")}>
                Portfolio ID: <span className={dark ? "text-gray-200" : "text-gray-800"}>{pid}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Pill dark={dark} tone={historyStatus === "saved" ? "good" : historyStatus === "saving" ? "info" : historyStatus === "error" ? "warn" : "neutral"}>
              <FontAwesomeIcon icon={faRotateRight} className="mr-2" />
              {historyStatus === "saved" ? "History saved" : historyStatus === "saving" ? "Saving…" : historyStatus === "error" ? "History error" : "History"}
            </Pill>

            <button
              onClick={() => setAlertsPanel(true)}
              className={[
                "px-3 py-2 rounded-2xl text-sm font-extrabold border inline-flex items-center gap-2",
                triggeredAlerts.length ? (dark ? "bg-amber-500/20 border-amber-400/30" : "bg-amber-50 border-amber-200") : dark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-black/10 hover:bg-gray-50",
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faBell} />
              Alerts
              {triggeredAlerts.length ? <Pill dark={dark} tone="warn">{triggeredAlerts.length}</Pill> : null}
            </button>

            <button
              onClick={() => setSimOpen(true)}
              className={[
                "px-3 py-2 rounded-2xl text-sm font-extrabold border inline-flex items-center gap-2",
                dark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-black/10 hover:bg-gray-50",
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faWandMagicSparkles} />
              What-if
            </button>

            <button
              onClick={() => setStressOpen(true)}
              className={[
                "px-3 py-2 rounded-2xl text-sm font-extrabold border inline-flex items-center gap-2",
                dark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-black/10 hover:bg-gray-50",
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faFlask} />
              Stress Tests
            </button>

            <button
              onClick={copySummary}
              className={[
                "px-3 py-2 rounded-2xl text-sm font-extrabold border inline-flex items-center gap-2",
                dark ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200" : "bg-white border-black/10 hover:bg-gray-50 text-gray-800",
              ].join(" ")}
              title="Copy insights summary"
            >
              <FontAwesomeIcon icon={faClipboard} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {!rows.length ? (
          <Card dark={dark}>
            <CardHeader
              dark={dark}
              title="No data available"
              subtitle="Open this page from Dashboard OR ensure the dashboard cache exists for this pid."
              right={
                <Pill dark={dark} tone="info">
                  <FontAwesomeIcon icon={faCircleInfo} className="mr-2" />
                  Tip
                </Pill>
              }
            />
            <CardBody>
              <div className={["text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                Open Dashboard once so it caches holdings. Then Insights can load from cache too.
              </div>
            </CardBody>
          </Card>
        ) : (
          <>
            {/* Health + Breakdown + Trends */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card dark={dark} className="lg:col-span-2">
                <CardHeader
                  dark={dark}
                  title="Portfolio Health Score"
                  subtitle="Balanced score: concentration, cash drag, valuation mix, drift, and P/E risk."
                  right={<Pill dark={dark} tone={pack.health.score >= 65 ? "good" : pack.health.score >= 50 ? "warn" : "bad"}>{pack.health.score}/100</Pill>}
                />
                <CardBody>
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    <ScoreRing score={pack.health.score} dark={dark} />
                    <div className="flex-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {pack.health.breakdown.map((b) => (
                          <div
                            key={b.label}
                            className={[
                              "p-4 rounded-3xl border",
                              b.disabled
                                ? dark
                                  ? "bg-white/3 border-white/10 opacity-60"
                                  : "bg-gray-50 border-black/10 opacity-60"
                                : dark
                                  ? "bg-white/5 border-white/10"
                                  : "bg-gray-50 border-black/10",
                            ].join(" ")}
                          >
                            <div className={["text-xs uppercase tracking-wide font-extrabold", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>{b.label}</div>
                            <div className="mt-2 flex items-center justify-between">
                              <div className="text-lg font-extrabold">{b.value}/{b.max}</div>
                              {b.disabled ? <Pill dark={dark} tone="neutral">Rule off</Pill> : null}
                            </div>
                          </div>
                        ))}
                      </div>

                      {changeSinceYesterday ? (
                        <div className={["mt-4 p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                          <div className="font-extrabold flex items-center gap-2">
                            <FontAwesomeIcon icon={faBolt} />
                            What changed since yesterday
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Pill dark={dark} tone={changeSinceYesterday.dScore >= 0 ? "good" : "warn"}>
                              Score {changeSinceYesterday.dScore >= 0 ? "+" : ""}
                              {changeSinceYesterday.dScore}
                            </Pill>
                            {deltaBadge(changeSinceYesterday.dCash, "% cash")}
                            {deltaBadge(changeSinceYesterday.dBig, "% top holding")}
                            {deltaBadge(changeSinceYesterday.dUnc, "% uncomfortable")}
                          </div>
                          <div className={["mt-2 text-xs", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                            Comparing {changeSinceYesterday.prevDay} → {changeSinceYesterday.currDay}
                          </div>
                        </div>
                      ) : (
                        <div className={["mt-4 text-sm", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                          Not enough history yet for “since yesterday” (needs 2+ days).
                        </div>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>

              <Card dark={dark}>
                <CardHeader
                  dark={dark}
                  title="Trends (14 days)"
                  subtitle="Health + key risk metrics."
                  right={
                    <Pill dark={dark} tone="neutral">
                      <FontAwesomeIcon icon={faChartLine} className="mr-2" />
                      {history.length || 0} pts
                    </Pill>
                  }
                />
                <CardBody>
                  <div className="space-y-3">
                    <div>
                      <div className={["text-xs font-extrabold uppercase tracking-wide", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>Health score</div>
                      <SparkLine values={historySeries.score} dark={dark} />
                    </div>
                    <div>
                      <div className={["text-xs font-extrabold uppercase tracking-wide", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>Cash %</div>
                      <SparkLine values={historySeries.cashPct} dark={dark} />
                    </div>
                    <div>
                      <div className={["text-xs font-extrabold uppercase tracking-wide", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>Largest holding %</div>
                      <SparkLine values={historySeries.biggestPct} dark={dark} />
                    </div>
                    <div>
                      <div className={["text-xs font-extrabold uppercase tracking-wide", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>Uncomfortable %</div>
                      <SparkLine values={historySeries.uncomfort} dark={dark} />
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Top Risks */}
            <Card dark={dark}>
              <CardHeader
                dark={dark}
                title="Top Risks"
                subtitle="Only WARN/BAD items appear here."
                right={
                  <Pill dark={dark} tone={topRisks.length ? "warn" : "good"}>
                    <FontAwesomeIcon icon={topRisks.length ? faTriangleExclamation : faCheck} className="mr-2" />
                    {topRisks.length ? "Priority" : "All clear"}
                  </Pill>
                }
              />
              <CardBody>
                {topRisks.length === 0 ? (
                  <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                    <div className="font-extrabold flex items-center gap-2">
                      <FontAwesomeIcon icon={faCheck} className="text-emerald-500" />
                      No critical risks detected today
                    </div>
                    <div className={["mt-2 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                      Your current metrics don’t trigger any WARN/BAD rules. Check “Insights Engine” for INFO/GOOD notes.
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {topRisks.slice(0, 6).map((it) => (
                      <div key={it.id} className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-extrabold flex items-center gap-2">
                            <FontAwesomeIcon icon={it.icon} />
                            {it.title}
                          </div>
                          <Pill dark={dark} tone={toneForSeverity(it.severity)}>{String(it.severity || "").toUpperCase()}</Pill>
                        </div>
                        <div className={["mt-2 text-sm", dark ? "text-gray-200" : "text-gray-800"].join(" ")}>{it.message}</div>
                        {it.action ? (
                          <div className={["mt-2 text-sm", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                            <span className="font-extrabold">Action:</span> {it.action}
                          </div>
                        ) : null}
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => openExplain(it)}
                            className={[
                              "px-3 py-2 rounded-2xl text-xs font-extrabold border inline-flex items-center gap-2",
                              dark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-black/10 hover:bg-gray-50",
                            ].join(" ")}
                          >
                            <FontAwesomeIcon icon={faCircleInfo} />
                            Explain
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Insights Engine + Rule toggles */}
            <Card dark={dark}>
              <CardHeader
                dark={dark}
                title="Insights Engine"
                subtitle="Auto-generated observations with actions. You can filter and toggle rules."
                right={
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Pill dark={dark} tone="neutral">
                      <FontAwesomeIcon icon={faBolt} className="mr-2" />
                      Live
                    </Pill>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setMode("FULL")}
                        className={[
                          "px-3 py-2 rounded-2xl text-xs font-extrabold border",
                          mode === "FULL"
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : dark
                              ? "bg-white/5 border-white/10 hover:bg-white/10"
                              : "bg-white border-black/10 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setMode("ONLY_RISKS")}
                        className={[
                          "px-3 py-2 rounded-2xl text-xs font-extrabold border",
                          mode === "ONLY_RISKS"
                            ? "bg-amber-500 text-white border-amber-500"
                            : dark
                              ? "bg-white/5 border-white/10 hover:bg-white/10"
                              : "bg-white border-black/10 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        Risks
                      </button>
                      <button
                        onClick={() => setMode("ONLY_GOOD")}
                        className={[
                          "px-3 py-2 rounded-2xl text-xs font-extrabold border",
                          mode === "ONLY_GOOD"
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : dark
                              ? "bg-white/5 border-white/10 hover:bg-white/10"
                              : "bg-white border-black/10 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        Good
                      </button>
                    </div>
                  </div>
                }
              />
              <CardBody>
                {/* Rule toggles */}
                <div className={["p-4 rounded-3xl border mb-4", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-extrabold flex items-center gap-2">
                      <FontAwesomeIcon icon={faSliders} />
                      Rules
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { k: "concentration", label: "Concentration" },
                        { k: "cash", label: "Cash" },
                        { k: "valuation", label: "Valuation" },
                        { k: "movers", label: "Movers" },
                        { k: "drift", label: "Drift" },
                        { k: "pe", label: "P/E" },
                      ].map((r) => (
                        <button
                          key={r.k}
                          onClick={() => setRulesEnabled((p) => ({ ...p, [r.k]: !p[r.k] }))}
                          className={[
                            "px-3 py-2 rounded-2xl text-xs font-extrabold border",
                            rulesEnabled[r.k]
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : dark
                                ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-300"
                                : "bg-white border-black/10 hover:bg-gray-50 text-gray-700",
                          ].join(" ")}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={["mt-2 text-xs", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                    Turning off a rule removes its penalty from the score and hides that insight.
                  </div>
                </div>

                {/* Insights list */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredInsights.map((it) => (
                    <div key={it.id} className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-extrabold flex items-center gap-2">
                          <FontAwesomeIcon icon={it.icon} />
                          {it.title}
                        </div>
                        <Pill dark={dark} tone={toneForSeverity(it.severity)}>{String(it.severity || "").toUpperCase()}</Pill>
                      </div>
                      <div className={["mt-2 text-sm", dark ? "text-gray-200" : "text-gray-800"].join(" ")}>{it.message}</div>
                      {it.action ? (
                        <div className={["mt-2 text-sm", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                          <span className="font-extrabold">Action:</span> {it.action}
                        </div>
                      ) : null}

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => openExplain(it)}
                          className={[
                            "px-3 py-2 rounded-2xl text-xs font-extrabold border inline-flex items-center gap-2",
                            dark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-black/10 hover:bg-gray-50",
                          ].join(" ")}
                        >
                          <FontAwesomeIcon icon={faCircleInfo} />
                          Explain
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Attribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card dark={dark}>
                <CardHeader dark={dark} title="Attribution (Total P/L)" subtitle="Which holdings contributed most to total P/L (by absolute impact)." />
                <CardBody>
                  <div className="space-y-2">
                    {topTotal.length ? (
                      topTotal.map((x) => {
                        const pos = x.v >= 0;
                        return (
                          <div key={x.Company} className={["p-3 rounded-2xl border flex items-center justify-between gap-3", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                            <div className="font-extrabold truncate">{x.Company}</div>
                            <div className={["font-extrabold", pos ? "text-emerald-500" : "text-rose-500"].join(" ")}>{money0(x.v)}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className={dark ? "text-gray-400" : "text-gray-600"}>No attribution data.</div>
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card dark={dark}>
                <CardHeader dark={dark} title="Attribution (Today P/L)" subtitle="Which holdings contributed most to today’s move (by absolute impact)." />
                <CardBody>
                  <div className="space-y-2">
                    {topToday.length ? (
                      topToday.map((x) => {
                        const pos = x.v >= 0;
                        return (
                          <div key={x.Company} className={["p-3 rounded-2xl border flex items-center justify-between gap-3", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                            <div className="font-extrabold truncate">{x.Company}</div>
                            <div className={["font-extrabold", pos ? "text-emerald-500" : "text-rose-500"].join(" ")}>{money0(x.v)}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className={dark ? "text-gray-400" : "text-gray-600"}>No attribution data.</div>
                    )}
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Rebalance suggestions (if Ideal % exists) */}
            <Card dark={dark}>
              <CardHeader
                dark={dark}
                title="Rebalance Suggestions"
                subtitle="Based on Ideal/Target weights (if present)."
                right={
                  <Pill dark={dark} tone={pack.rebalance.hasIdeal ? "good" : "warn"}>
                    <FontAwesomeIcon icon={faGears} className="mr-2" />
                    {pack.rebalance.hasIdeal ? "Ready" : "Needs Ideal %"}
                  </Pill>
                }
              />
              <CardBody>
                {!pack.rebalance.hasIdeal ? (
                  <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                    <div className="font-extrabold">Add Ideal % / Target % column to enable rebalance scoring & suggestions.</div>
                    <div className={["mt-2 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                      Add a column named <span className="font-extrabold">Ideal %</span> (or <span className="font-extrabold">Target %</span>) in your sheet for each holding.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pack.rebalance.suggestions.slice(0, 10).map((s) => {
                      const buy = s.delta > 0;
                      return (
                        <div key={s.Company} className={["p-3 rounded-2xl border flex items-center justify-between gap-3", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                          <div className="min-w-0">
                            <div className="font-extrabold truncate">{s.Company}</div>
                            <div className={["text-xs", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                              Current {pct(s.currentPct)} → Target {pct(s.idealPct)}
                            </div>
                          </div>
                          <div className={["font-extrabold", buy ? "text-emerald-500" : "text-rose-500"].join(" ")}>
                            {buy ? "Buy " : "Sell "}
                            {money0(Math.abs(s.delta))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>

      {/* ---------- Explain Modal (render only when open) ---------- */}
      {explainOpen && (
        <div className="fixed inset-0 z-[90]">
          {/* Backdrop */}
          <div
            className={[dark ? "bg-black/70" : "bg-black/50", "absolute inset-0"].join(" ")}
            onClick={() => setExplainOpen(false)}
          />

          {/* Modal */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className={[
                "w-full max-w-2xl rounded-3xl border shadow-lg",
                dark ? "bg-gray-950 border-white/10" : "bg-white border-black/10",
              ].join(" ")}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="p-5 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FontAwesomeIcon icon={faCircleInfo} />
                  <div className="font-extrabold text-lg truncate">Explain: {explainItem?.title || "—"}</div>
                </div>

                <button
                  onClick={() => setExplainOpen(false)}
                  className={[
                    "px-3 py-2 rounded-xl text-sm font-extrabold inline-flex items-center gap-2",
                    dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200",
                  ].join(" ")}
                >
                  <FontAwesomeIcon icon={faXmark} />
                  Close
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                  <div className="font-extrabold mb-2">What it means</div>
                  <div className={["text-sm", dark ? "text-gray-200" : "text-gray-800"].join(" ")}>
                    {explainItem?.message || "—"}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                    <div className="font-extrabold mb-2">Threshold</div>
                    <div className={["text-sm", dark ? "text-gray-200" : "text-gray-800"].join(" ")}>
                      {explainItem?.explain?.threshold || "—"}
                    </div>
                  </div>

                  <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                    <div className="font-extrabold mb-2">Your value</div>
                    <div className={["text-sm", dark ? "text-gray-200" : "text-gray-800"].join(" ")}>
                      {explainItem?.explain?.value || "—"}
                    </div>
                  </div>
                </div>

                <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                  <div className="font-extrabold mb-2">Formula</div>
                  <div className={["text-sm font-mono whitespace-pre-wrap", dark ? "text-gray-200" : "text-gray-800"].join(" ")}>
                    {explainItem?.explain?.formula || "—"}
                  </div>
                </div>

                {explainItem?.action ? (
                  <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                    <div className="font-extrabold mb-2">Suggested action</div>
                    <div className={["text-sm", dark ? "text-gray-200" : "text-gray-800"].join(" ")}>
                      {explainItem.action}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ---------- Alerts Panel (render only when open) ---------- */}
{alertsPanel && (
  <div className="fixed inset-0 z-[90]">
    {/* Backdrop */}
    <div
      className={[dark ? "bg-black/70" : "bg-black/50", "absolute inset-0"].join(" ")}
      onClick={() => setAlertsPanel(false)}
    />

    {/* Modal */}
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div
        className={[
          "w-full max-w-3xl rounded-3xl border shadow-lg",
          dark ? "bg-gray-950 border-white/10" : "bg-white border-black/10",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FontAwesomeIcon icon={faBell} />
            <div className="font-extrabold text-lg truncate">Alerts & Rules</div>
            {alertsStatus === "loading" ? (
              <Pill dark={dark} tone="info">Loading…</Pill>
            ) : alertsStatus === "error" ? (
              <Pill dark={dark} tone="warn">Error</Pill>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={addAlert}
              className={[
                "px-3 py-2 rounded-xl text-sm font-extrabold inline-flex items-center gap-2 border",
                dark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-black/10 hover:bg-gray-50",
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faGears} />
              Add
            </button>

            <button
              onClick={() => setAlertsPanel(false)}
              className={[
                "px-3 py-2 rounded-xl text-sm font-extrabold inline-flex items-center gap-2",
                dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200",
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faXmark} />
              Close
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Triggered */}
          <div
            className={[
              "p-4 rounded-3xl border",
              triggeredAlerts.length
                ? dark
                  ? "bg-amber-500/10 border-amber-400/20"
                  : "bg-amber-50 border-amber-200"
                : dark
                ? "bg-white/5 border-white/10"
                : "bg-gray-50 border-black/10",
            ].join(" ")}
          >
            <div className="font-extrabold flex items-center gap-2">
              <FontAwesomeIcon icon={triggeredAlerts.length ? faTriangleExclamation : faCheck} />
              Triggered today: {triggeredAlerts.length}
            </div>

            {triggeredAlerts.length ? (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {triggeredAlerts.map((a) => (
                  <div key={a.id} className={["p-3 rounded-2xl border", dark ? "bg-white/5 border-white/10" : "bg-white border-black/10"].join(" ")}>
                    <div className="font-extrabold">{a.label}</div>
                    <div className={["mt-1 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                      Current:{" "}
                      <span className="font-extrabold">
                        {formatAlertValue(a.type, a.type === "dayGain" ? pack.totals.dayGain : pack.signals[a.type] || 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={["mt-2 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>No alerts triggered.</div>
            )}
          </div>

          {/* Alerts list */}
          <div className="space-y-3">
            {alerts.map((a) => (
              <div key={a.id} className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-extrabold truncate">{a.label || "Alert"}</div>
                      <Pill dark={dark} tone={a.severity === "warn" ? "warn" : a.severity === "bad" ? "bad" : "info"}>
                        {String(a.severity || "info").toUpperCase()}
                      </Pill>
                      {a.enabled ? <Pill dark={dark} tone="good">Enabled</Pill> : <Pill dark={dark} tone="neutral">Disabled</Pill>}
                    </div>
                    <div className={["mt-1 text-xs", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                      Type: {a.type} {a.op} {a.value}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAlert(a.id, !a.enabled)}
                      className={[
                        "px-3 py-2 rounded-2xl text-xs font-extrabold border",
                        a.enabled
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : dark
                          ? "bg-white/5 border-white/10 hover:bg-white/10"
                          : "bg-white border-black/10 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {a.enabled ? "On" : "Off"}
                    </button>

                    <button
                      onClick={() => removeAlert(a.id)}
                      className={[
                        "px-3 py-2 rounded-2xl text-xs font-extrabold border",
                        dark ? "bg-white/5 border-white/10 hover:bg-white/10 text-rose-200" : "bg-white border-black/10 hover:bg-gray-50 text-rose-700",
                      ].join(" ")}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input
                    value={a.label || ""}
                    onChange={(e) => updateAlertField(a.id, { label: e.target.value })}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                    placeholder="Label"
                  />

                  <select
                    value={a.type || "cashPct"}
                    onChange={(e) => updateAlertField(a.id, { type: e.target.value })}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                  >
                    <option value="cashPct">cashPct</option>
                    <option value="biggestPct">biggestPct</option>
                    <option value="uncomfortablePct">uncomfortablePct</option>
                    <option value="dayGain">dayGain</option>
                    <option value="weightedPE">weightedPE</option>
                  </select>

                  <select
                    value={a.op || ">"}
                    onChange={(e) => updateAlertField(a.id, { op: e.target.value })}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                  >
                    <option value=">">{">"}</option>
                    <option value="<">{"<"}</option>
                    <option value=">=">{">="}</option>
                    <option value="<=">{"<="}</option>
                    <option value="==">{"=="}</option>
                  </select>

                  <input
                    value={String(a.value ?? "")}
                    onChange={(e) => updateAlertField(a.id, { value: Number(e.target.value) })}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                    placeholder="Value"
                    type="number"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className={["text-xs flex items-center gap-2", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
            <FontAwesomeIcon icon={faCircleInfo} />
            Alerts are evaluated using today’s computed signals (cash%, concentration%, etc.).
          </div>
        </div>
      </div>
    </div>
  </div>
)}

      {/* ---------- What-if Simulator (render only when open) ---------- */}
      {simOpen && (
        <div className="fixed inset-0 z-[80]">
          {/* Backdrop */}
          <div
            className={[dark ? "bg-black/70" : "bg-black/50", "absolute inset-0"].join(" ")}
            onClick={() => setSimOpen(false)}
          />

          {/* Modal wrapper */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            {/* Panel */}
            <div
              className={[
                "w-full max-w-4xl rounded-3xl border shadow-lg",
                dark ? "bg-gray-950 border-white/10" : "bg-white border-black/10",
              ].join(" ")}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="p-5 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FontAwesomeIcon icon={faWandMagicSparkles} />
                  <div className="font-extrabold text-lg truncate">What-if Rebalance Simulator</div>
                </div>

                <button
                  onClick={() => setSimOpen(false)}
                  className={[
                    "px-3 py-2 rounded-xl text-sm font-extrabold inline-flex items-center gap-2",
                    dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200",
                  ].join(" ")}
                >
                  <FontAwesomeIcon icon={faXmark} />
                  Close
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                  <div className="font-extrabold flex items-center gap-2">
                    <FontAwesomeIcon icon={faCircleInfo} />
                    Notes
                  </div>
                  <div className={["mt-2 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                    This is allocation-only what-if: it adjusts <span className="font-extrabold">Current Value</span> for the selected holding (and optionally cash).
                    It does not model price/quantity changes (we can extend that later).
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <select
                    value={simHolding}
                    onChange={(e) => setSimHolding(e.target.value)}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none md:col-span-2",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                  >
                    <option value="">Select holding…</option>
                    {holdingsList.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>

                  <select
                    value={simAction}
                    onChange={(e) => setSimAction(e.target.value)}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>

                  <input
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                    placeholder="Amount ₹"
                    type="number"
                  />

                  <select
                    value={simCashMode}
                    onChange={(e) => setSimCashMode(e.target.value)}
                    className={[
                      "px-3 py-2 rounded-2xl text-sm border outline-none",
                      dark ? "bg-white/5 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900",
                    ].join(" ")}
                  >
                    <option value="USE_CASH">Use Cash row</option>
                    <option value="IGNORE_CASH">Ignore Cash</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className={["p-4 rounded-3xl border", dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                    <div className="font-extrabold">Before</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Pill dark={dark} tone="neutral">Score {pack.health.score}</Pill>
                      <Pill dark={dark} tone="neutral">Cash {pct(pack.signals.cashPct || 0)}</Pill>
                      <Pill dark={dark} tone="neutral">Top {pct(pack.signals.biggestPct || 0)}</Pill>
                      <Pill dark={dark} tone="neutral">Unc {pct(pack.signals.uncomfortablePct || 0)}</Pill>
                    </div>
                  </div>

                  <div className={["p-4 rounded-3xl border", simPack ? (dark ? "bg-indigo-500/10 border-indigo-400/20" : "bg-indigo-50 border-indigo-200") : dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10"].join(" ")}>
                    <div className="font-extrabold">After</div>
                    {!simPack ? (
                      <div className={["mt-2 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                        Pick a holding and amount to simulate.
                      </div>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Pill dark={dark} tone={simDelta.score >= 0 ? "good" : "warn"}>
                            Score {simPack.health.score} ({simDelta.score >= 0 ? "+" : ""}{simDelta.score})
                          </Pill>
                          <Pill dark={dark} tone="neutral">Cash {pct(simPack.signals.cashPct || 0)}</Pill>
                          <Pill dark={dark} tone="neutral">Top {pct(simPack.signals.biggestPct || 0)}</Pill>
                          <Pill dark={dark} tone="neutral">Unc {pct(simPack.signals.uncomfortablePct || 0)}</Pill>
                        </div>
                        <div className={["mt-3 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                          Deltas: {deltaBadge(simDelta.cashPct, "% cash")} {deltaBadge(simDelta.biggestPct, "% top")} {deltaBadge(simDelta.uncomfortablePct, "% unc")}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className={["text-xs", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                  Tip: Keep “Use Cash row” on if you maintain a Cash line item in holdings.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* ---------- Stress Tests (render only when open) ---------- */}
      {stressOpen && (
        <div className="fixed inset-0 z-[80]">
          {/* Backdrop */}
          <div
            className={[dark ? "bg-black/70" : "bg-black/50", "absolute inset-0"].join(" ")}
            onClick={() => setStressOpen(false)}
          />

          {/* Modal wrapper */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            {/* Panel */}
            <div
              className={[
                "w-full max-w-3xl rounded-3xl border shadow-lg",
                dark ? "bg-gray-950 border-white/10" : "bg-white border-black/10",
              ].join(" ")}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="p-5 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FontAwesomeIcon icon={faFlask} />
                  <div className="font-extrabold text-lg truncate">Stress Tests</div>
                </div>

                <button
                  onClick={() => setStressOpen(false)}
                  className={[
                    "px-3 py-2 rounded-xl text-sm font-extrabold inline-flex items-center gap-2",
                    dark ? "bg-white/10 hover:bg-white/15" : "bg-gray-100 hover:bg-gray-200",
                  ].join(" ")}
                >
                  <FontAwesomeIcon icon={faXmark} />
                  Close
                </button>
              </div>

              <div className="p-5 space-y-3">
                {stressTests.map((t) => (
                  <div
                    key={t.id}
                    className={[
                      "p-4 rounded-3xl border flex items-start justify-between gap-3",
                      dark ? "bg-white/5 border-white/10" : "bg-gray-50 border-black/10",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <div className="font-extrabold">{t.title}</div>
                      <div className={["mt-1 text-sm", dark ? "text-gray-300" : "text-gray-700"].join(" ")}>
                        {t.subtitle}
                      </div>
                      {t.tag ? (
                        <div className="mt-2">
                          <Pill dark={dark} tone="info">{t.tag}</Pill>
                        </div>
                      ) : null}
                    </div>

                    <div className="text-right">
                      <div className="font-extrabold text-rose-500">-{money0(t.loss)}</div>
                      <div className={["text-sm", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                        {pct(t.lossPct)} of portfolio
                      </div>
                    </div>
                  </div>
                ))}

                <div className={["text-xs flex items-center gap-2", dark ? "text-gray-400" : "text-gray-600"].join(" ")}>
                  <FontAwesomeIcon icon={faCircleInfo} />
                  Stress tests are simplified scenarios for intuition, not predictions.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
