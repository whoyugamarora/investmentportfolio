// src/utils/xirr.js
// Cashflows expect: [{ date: Date | string, amount: number }]
// Convention: negatives = investments (outflow), positives = proceeds/valuation (inflow)

const asDate = (d) => (d instanceof Date ? d : new Date(d));

export function xnpv(rate, cashflows) {
  const t0 = asDate(cashflows[0].date);
  return cashflows.reduce((sum, cf) => {
    const t = asDate(cf.date);
    const years = (t - t0) / (365 * 24 * 3600 * 1000);
    return sum + cf.amount / Math.pow(1 + rate, years);
  }, 0);
}

export function xirr(cashflows, { guess = 0.1 } = {}) {
  // Need at least two flows on different dates.
  if (cashflows.length < 2) return null;

  const flows = [...cashflows].sort((a, b) => +asDate(a.date) - +asDate(b.date));
  if (asDate(flows[0].date).getTime() === asDate(flows[flows.length - 1].date).getTime()) return null;

  // Try to bracket a root between [-0.9999, 10]
  let low = -0.9999;
  let high = 10;
  let fLow = xnpv(low, flows);
  let fHigh = xnpv(high, flows);

  // If same sign, expand high until signs differ or cap iterations
  let expand = 0;
  while (fLow * fHigh > 0 && expand < 20) {
    high *= 1.5;
    fHigh = xnpv(high, flows);
    expand++;
  }
  if (fLow * fHigh > 0) {
    // No root found in range
    return null;
  }

  // Bisection (robust)
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const fMid = xnpv(mid, flows);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return (low + high) / 2;
}
