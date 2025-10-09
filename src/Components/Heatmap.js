import React, { useMemo } from "react";

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function fmtIN(n) { return isFinite(n) ? Number(n).toLocaleString("en-IN") : n; }

function colorsFor(pct, scale, darkMode, intensity) {
  var p = clamp(pct, -scale, scale);
  var mag = Math.min(Math.abs(p) / scale, 1);
  var hue = p >= 0 ? 145 : 3;
  var sat = Math.round(75 + 20 * mag);
  var lightness = 25 + 15 * mag;
  var text = "#ffffff";

  var bg = "linear-gradient(135deg," +
    "hsl(" + hue + "," + sat + "%," + lightness + "%) 0%," +
    "hsl(" + hue + "," + (sat - 5) + "%," + (lightness - 3) + "%) 50%," +
    "hsl(" + hue + "," + (sat - 10) + "%," + (lightness - 6) + "%) 100%)";

  var glow = "inset 0 1px 2px hsla(" + hue + "," + sat + "%,60%,0.12)";
  var veil = "inset 0 0 40px rgba(0,0,0," + (0.12 + 0.2 * mag) + ")";
  var border = "hsl(" + hue + "," + (sat + 10) + "%," + (lightness + 18) + "%)";
  return { bg, border, text, veil, glow };
}

export default function Heatmap({
  data = [],
  darkMode = false,
  onTileClick,
  pctKey = "PorLpercent",
  valueKey = "Current Value",
  labelKey = "Company",
  codeKey = "Company Code",
  sectorKey = "Sector",
  clampPct = 12,
  sortBy = "magnitude",
  intensity = 0.88,
  // smaller by default
  minTilePx = 168,
  tileMinH = 96,            // fixed compact height
  tilePad = 10,             // tighter padding
}) {
  const tiles = useMemo(function () {
    const rows = Array.isArray(data) ? data : [];
    const cleaned = rows.map(function (r) {
      const pct = Number(r && r[pctKey] ? r[pctKey] : 0);
      const val = Number(r && r[valueKey] ? r[valueKey] : 0);
      const name = r && r[labelKey] != null ? String(r[labelKey]) : "";
      const code = r && r[codeKey] != null ? String(r[codeKey]) : "";
      const sector = sectorKey && r ? r[sectorKey] : null;
      return { pct, val, name, code, sector, raw: r };
    });

    if (sortBy === "value") cleaned.sort(function (a, b) { return b.val - a.val; });
    else if (sortBy === "alpha") cleaned.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else cleaned.sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); });

    return cleaned;
  }, [data, pctKey, valueKey, labelKey, codeKey, sectorKey, sortBy]);

  var totalVal = 0; for (var i = 0; i < tiles.length; i++) totalVal += tiles[i].val || 0;
  if (!totalVal) totalVal = 1;

  const legendText = darkMode ? "text-gray-300" : "text-gray-600";
  const bgColor = darkMode ? "bg-gray-900" : "bg-gray-50";

  return (
    <div className={bgColor + " rounded-2xl p-4 space-y-3"}>
      {/* mini legend */}
      <div className="flex items-center gap-2 text-[11px] font-medium">
        <span className={legendText}>Move</span>
        <div className="h-2 rounded-full flex-1"
             style={{background:"linear-gradient(90deg, hsla(0,75%,55%,.45) 0%, hsla(0,0%,50%,.10) 50%, hsla(145,75%,48%,.45) 100%)"}}/>
        <span className="tabular-nums text-rose-600">-{clampPct}%</span>
        <span className="tabular-nums text-gray-500">0%</span>
        <span className="tabular-nums text-emerald-600">+{clampPct}%</span>
      </div>

      {/* compact grid */}
      <div
        className="grid w-fit grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5"
      >
        {tiles.map(function (t, i) {
          const c = colorsFor(t.pct, clampPct, darkMode, intensity);
          const alloc = (t.val / totalVal) * 100;
          const isPositive = t.pct >= 0;

          return (
            <button
              key={i}
              onClick={onTileClick ? function () { onTileClick({ name: t.name, code: t.code, pct: t.pct, value: t.val, raw: t.raw }); } : undefined}
              className="relative rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:brightness-105 transition hover:scale-[1.02]"
              style={{
                border: "1px solid " + c.border,
                background: c.bg,
                color: c.text,
                padding: tilePad + "px",
                minHeight: tileMinH + "px",
                boxShadow: c.veil + ", " + c.glow,
              }}
              title={t.name + " • " + (isPositive ? "+" : "") + t.pct.toFixed(2) + "% • ₹" + fmtIN(t.val)}
            >
              <div className="flex h-full">
                {/* left: name + % (stacked) */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div className="min-w-0">
                    <div
                      className="font-semibold truncate leading-tight"
                      style={{ fontSize: "clamp(0.82rem, 1vw, 0.98rem)" }}
                      title={t.name}
                    >
                      {t.name}
                    </div>
                    {t.code ? (
                      <div className="text-[10px] opacity-80 truncate" title={t.code}>
                        {t.code}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="font-extrabold tabular-nums leading-none"
                    style={{ fontSize: "clamp(0.98rem, 1.3vw, 1.15rem)" }}
                  >
                    {isPositive ? "+" : ""}
                    {t.pct.toFixed(2)}%
                  </div>
                </div>

                {/* right: money + alloc */}
                <div className="text-right tabular-nums flex flex-col justify-between items-end ml-2 shrink-0">
                  <div
                    className="font-semibold"
                    style={{ fontSize: "clamp(0.8rem, 0.95vw, 0.95rem)" }}
                  >
                    ₹{fmtIN(Math.round(t.val))}
                  </div>
                  <div
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold opacity-95"
                    style={{ background: "rgba(0,0,0,0.22)" }}
                  >
                    {alloc.toFixed(1)}%
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
