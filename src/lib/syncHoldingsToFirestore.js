// src/lib/syncHoldingsToFirestore.js
import {
  collection, doc, serverTimestamp, writeBatch,
} from "firebase/firestore";

/** find first matching key in a row (case-insensitive, spaces tolerant) */
function pick(row, candidates = []) {
  const keys = Object.keys(row || {});
  for (const c of candidates) {
    const found = keys.find(k => k.toLowerCase().replace(/\s+/g, "") === c.toLowerCase().replace(/\s+/g, ""));
    if (found) return row[found];
  }
  return undefined;
}

/** sanitize doc id (symbol) – keep alnum + . _ - */
function sanitizeId(v) {
  return String(v || "UNKNOWN").trim().replace(/[^\w.\-]/g, "_").toUpperCase();
}

/** normalize one sheet row into our Firestore shape */
function normalizeHolding(row) {
  const symbol = pick(row, ["Symbol", "Ticker", "Code", "NSE", "BSE", "ISIN"]) || pick(row, ["Company"]);
  const company = pick(row, ["Company", "Name"]) || symbol;
  const sector = pick(row, ["Sector", "Industry"]);
  const qty = Number(pick(row, ["Quantity", "Qty", "Units"])) || 0;
  const avgPrice = Number(pick(row, ["Avg Price", "Average Price", "Buy Avg"])) || undefined;
  const currentPrice = Number(pick(row, ["Current Price", "LTP", "Price"])) || undefined;
  const currentValue = Number(pick(row, ["Current Value", "Value"])) || (qty && currentPrice ? qty * currentPrice : undefined);
  const pnlPct = Number(pick(row, ["PorLpercent", "P/L %", "PnL %", "Change %"])) || 0;
  let pnlAmt = Number(pick(row, ["PorLamount", "P/L", "PnL"])) || undefined;
  if (pnlAmt === undefined && currentValue !== undefined && pnlPct !== undefined) {
    pnlAmt = Math.round((currentValue * pnlPct) / 100);
  }
  const weightPct = Number(pick(row, ["Weight %", "Allocation %", "Portfolio %"])) || undefined;

  return {
    symbol: String(symbol || "").toUpperCase(),
    company: String(company || "").trim(),
    sector: sector ? String(sector) : null,
    qty,
    avgPrice: Number.isFinite(avgPrice) ? avgPrice : null,
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
    currentValue: Number.isFinite(currentValue) ? currentValue : null,
    pnlPct: Number.isFinite(pnlPct) ? pnlPct : 0,
    pnlAmt: Number.isFinite(pnlAmt) ? pnlAmt : null,
    weightPct: Number.isFinite(weightPct) ? weightPct : null,
    source: "apps_script",
  };
}

/** chunk helper for batching (Firestore batch limit = 500 ops) */
function chunk(arr, n = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Sync holdings array (from Apps Script) into Firestore.
 * Upserts under: users/{uid}/portfolios/{pid}/holdings/{symbol}
 */
export async function syncHoldingsToFirestore({ db, uid, pid, rows }) {
  if (!db || !uid || !pid || !Array.isArray(rows)) return;

  // normalize all rows first
  const normalized = rows
    .map(normalizeHolding)
    .filter(h => h.symbol && h.company);

  // optional: avoid hammering Firestore if data unchanged in last 10 min
  try {
    const sig = JSON.stringify(
      normalized.map(h => [h.symbol, h.company, h.currentValue, h.pnlPct])
    );
    const key = `holdings_sig_${uid}_${pid}`;
    const last = localStorage.getItem(key);
    if (last === sig) return; // unchanged
    localStorage.setItem(key, sig);
  } catch {
    // ignore signature issues
  }

  const baseCol = collection(db, "users", uid, "portfolios", pid, "holdings");
  const groups = chunk(normalized, 400);

  for (const group of groups) {
    const batch = writeBatch(db);
    for (const h of group) {
      const id = sanitizeId(h.symbol);
      const ref = doc(baseCol, id);
      batch.set(ref, { ...h, updatedAt: serverTimestamp(), isActive: true }, { merge: true });
    }
    await batch.commit();
  }

  // (optional) mark missing holdings as inactive
  //   If you want to flag docs that no longer appear in the sheet:
  //   - pass in the list of current symbols and compare; here’s the quick hook:
  // return normalized.map(h => h.symbol);
}
