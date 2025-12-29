import React, { useMemo, useState } from "react";
import { format as formatIndianNumber } from "indian-number-format";

const pct = (n) => ((Number(n) || 0) * 100).toFixed(2) + "%";
const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function RebalanceSection({ data = [], darkMode = false }) {
  const [sector, setSector] = useState("All");
  const [onlyActions, setOnlyActions] = useState(true);
  const [sortBy, setSortBy] = useState("absDrift"); // absDrift | tradeValue | company

  const isCashRow = (r) => {
    const name = String(r?.Company || "").trim().toLowerCase();
    const code = String(r?.["Company Code"] || "").trim().toLowerCase();
    const sector = String(r?.Sector || "").trim().toLowerCase();
    return (
      name === "cash" ||
      name.includes("cash") ||
      code.includes("cash") ||
      sector === "cash"
    );
  };

  const computed = useMemo(() => {
    // find cash row (if exists)
    const cashRow = (data || []).find(isCashRow) || null;
    const freeCash = cashRow ? safeNum(cashRow["Current Value"]) : 0;

    // use NON-cash rows for rebalancing math
    const investRows = (data || []).filter((r) => !isCashRow(r));
    const total = investRows.reduce((s, r) => s + safeNum(r["Current Value"]), 0);

    const rows = investRows.map((r) => {
      const currentValue = safeNum(r["Current Value"]);
      const idealAlloc = safeNum(r["Ideal Allocation"]); // decimal like 0.08
      const currentAlloc = total ? currentValue / total : 0;
      const drift = currentAlloc - idealAlloc;

      const sharesRequired = Math.trunc(safeNum(r["Shares Required"]));
      const currentPrice = safeNum(r["Current Price"]);
      const tradeValue = sharesRequired * currentPrice;

      let action = "OK";
      if (sharesRequired > 0) action = "BUY";
      if (sharesRequired < 0) action = "SELL";

      return {
        ...r,
        _total: total,
        _currentAlloc: currentAlloc,
        _drift: drift,
        _sharesRequired: sharesRequired,
        _tradeValue: tradeValue,
        _action: action,
      };
    });

    return { total, rows, freeCash, cashRow };
  }, [data]);


  const sectors = useMemo(() => {
    const s = new Set((computed.rows || []).map((r) => r.Sector).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [computed.rows]);

  const filtered = useMemo(() => {
    let rows = computed.rows || [];

    if (sector !== "All") rows = rows.filter((r) => r.Sector === sector);
    if (onlyActions) rows = rows.filter((r) => r._action !== "OK");

    if (sortBy === "absDrift") {
      rows = [...rows].sort((a, b) => Math.abs(b._drift) - Math.abs(a._drift));
    } else if (sortBy === "tradeValue") {
      rows = [...rows].sort((a, b) => Math.abs(b._tradeValue) - Math.abs(a._tradeValue));
    } else {
      rows = [...rows].sort((a, b) => String(a.Company || "").localeCompare(String(b.Company || "")));
    }

    return rows;
  }, [computed.rows, sector, onlyActions, sortBy]);

  const summary = useMemo(() => {
    let buyCash = 0;
    let sellCash = 0;

    (computed.rows || []).forEach((r) => {
      if (r._tradeValue > 0) buyCash += r._tradeValue;
      if (r._tradeValue < 0) sellCash += Math.abs(r._tradeValue);
    });

    return {
      totalValue: computed.total || 0,
      freeCash: computed.freeCash || 0,
      buyCash,
      sellCash,
      netCash: buyCash - sellCash,
    };
  }, [computed.rows, computed.total, computed.freeCash]);


  const box = darkMode ? "border-white/10 bg-white/5" : "border-black/10 bg-gray-50";
  const head = darkMode ? "bg-gray-800 text-gray-300" : "bg-gray-100 text-gray-600";

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className={`p-4 rounded-xl border ${box}`}>
          <div className="text-xs opacity-70">Total Portfolio (ex-cash)</div>
          <div className="text-xl font-extrabold">
            ₹{formatIndianNumber(Number(summary.totalValue || 0).toFixed(0))}
          </div>
        </div>

        <div className={`p-4 rounded-xl border ${box}`}>
          <div className="text-xs opacity-70">Free Cash</div>
          <div className="text-xl font-extrabold">
            ₹{formatIndianNumber(Number(summary.freeCash || 0).toFixed(0))}
          </div>
        </div>

        <div className={`p-4 rounded-xl border ${box}`}>
          <div className="text-xs opacity-70">Buy cash needed</div>
          <div className="text-xl font-extrabold">
            ₹{formatIndianNumber(Number(summary.buyCash || 0).toFixed(0))}
          </div>
        </div>

        <div className={`p-4 rounded-xl border ${box}`}>
          <div className="text-xs opacity-70">Cash freed by sells</div>
          <div className="text-xl font-extrabold">
            ₹{formatIndianNumber(Number(summary.sellCash || 0).toFixed(0))}
          </div>
        </div>

        <div className={`p-4 rounded-xl border ${box}`}>
          <div className="text-xs opacity-70">Net cash needed</div>
          <div className="text-xl font-extrabold">
            ₹{formatIndianNumber(Number(summary.netCash || 0).toFixed(0))}
          </div>
        </div>
      </div>


      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm opacity-70">Sector</span>
          <select
            className="rounded-xl border px-3 py-2 text-sm bg-transparent"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
          >
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <label className="ml-2 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyActions} onChange={(e) => setOnlyActions(e.target.checked)} />
            Show only BUY/SELL
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm opacity-70">Sort</span>
          <select
            className="rounded-xl border px-3 py-2 text-sm bg-transparent"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="absDrift">Largest drift</option>
            <option value="tradeValue">Largest trade</option>
            <option value="company">Company A–Z</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        <table className="w-full text-sm min-w-[1050px]">
          <thead>
            <tr className={head}>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Company</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Sector</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Current Value</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Current %</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Ideal %</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Drift</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Shares Req</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Trade Value</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const driftPct = (r._drift * 100).toFixed(2) + "%";
              const action = r._action;

              const actionStyle =
                action === "BUY"
                  ? darkMode
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-400/30"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : action === "SELL"
                    ? darkMode
                      ? "bg-rose-500/10 text-rose-300 border-rose-400/30"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                    : darkMode
                      ? "bg-white/5 text-gray-200 border-white/10"
                      : "bg-gray-100 text-gray-700 border-black/10";

              return (
                <tr
                  key={(r["Company Code"] || r.Company || "") + ":" + idx}
                  className={`border-t ${darkMode ? "border-white/10" : "border-black/5"} hover:bg-black/5 dark:hover:bg-white/5`}
                >
                  <td className="px-3 py-3 font-medium whitespace-nowrap">
                    <div>{r.Company}</div>
                    <div className="text-xs opacity-60">{r["Company Code"]}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.Sector || "-"}</td>
                  <td className="px-3 py-3 whitespace-nowrap font-semibold">
                    ₹{formatIndianNumber(Number(r["Current Value"] || 0).toFixed(0))}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{pct(r._currentAlloc)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{pct(r["Ideal Allocation"])}</td>
                  <td className="px-3 py-3 whitespace-nowrap font-semibold">{driftPct}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r._sharesRequired}</td>
                  <td className="px-3 py-3 whitespace-nowrap font-semibold">
                    ₹{formatIndianNumber(Number(r._tradeValue || 0).toFixed(0))}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold ${actionStyle}`}>
                      {action}
                    </span>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-sm opacity-70">
                  Nothing to rebalance with current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs opacity-60">
        Uses your sheet fields: <span className="font-semibold">Ideal Allocation</span> (decimal, e.g. 0.08) and{" "}
        <span className="font-semibold">Shares Required</span> (positive = BUY, negative = SELL).
      </p>
    </div>
  );
}
