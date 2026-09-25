// Buy/sell timing rules — same logic as the Watchlist tab, used by the AI agent.
const ok = (x) => x != null && isFinite(x);
const r2 = (x) => (ok(x) ? Math.round(x * 100) / 100 : null);

export function rsi(c, n = 14) {
  if (!c || c.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? (g += d) : (l -= d); }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

// d = output of getStock(); holding = { buy_price, quantity } if the user owns it
export function timing(d, holding) {
  const p = d.price, m = d.metrics || {}, a = m.ma50, b = m.ma200, sc = d.score;
  const closes = (d.recent || []).map((x) => x[1]);
  if (ok(p) && closes.length) closes[closes.length - 1] = p;
  const rs = rsi(closes);
  const ext = ok(a) && ok(p) ? (p / a - 1) * 100 : null;
  const down = ok(a) && ok(b) && p < b && a < b;
  const aTgt = ok(d.analyst?.target) ? d.analyst.target : null;
  const base = { rsi14: r2(rs), pct_from_50dma: r2(ext), ma50: r2(a), ma200: r2(b), trend: down ? 'downtrend' : ok(b) && p > b ? 'uptrend' : 'sideways/unclear' };
  if (!ok(p)) return { ...base, signal: 'NO DATA', reason: 'No live price' };

  if (holding && ok(holding.buy_price)) {
    const buy = holding.buy_price, pl = (p / buy - 1) * 100;
    let stop = buy * 0.9;
    if (pl > 10) stop = Math.max(stop, buy);
    if (ok(a) && a * 0.95 > stop && p > a) stop = a * 0.95;
    const tgt = aTgt && aTgt > buy ? aTgt : buy * 1.25;
    const o = { ...base, pnl_pct: r2(pl), stop_loss: r2(stop), target: r2(tgt) };
    if (p <= stop) return { ...o, signal: 'SELL', reason: 'Stop-loss hit' };
    if (down) return { ...o, signal: 'SELL', reason: 'Trend broken: below 50- and 200-day averages' };
    if (ok(sc) && sc < 40) return { ...o, signal: 'SELL', reason: `Fundamentals weak (score ${sc})` };
    if (p >= tgt) return { ...o, signal: 'BOOK PROFIT', reason: 'Target reached' };
    if (ok(rs) && rs > 75 && pl > 15) return { ...o, signal: 'BOOK PARTIAL', reason: 'Overbought with good gain' };
    if (ok(sc) && sc >= 60 && ok(ext) && ext > -3 && ext < 5 && !(ok(b) && p < b)) return { ...o, signal: 'HOLD / ADD', reason: 'Strong stock near 50-day average' };
    return { ...o, signal: 'HOLD', reason: 'Trend and fundamentals intact' };
  }

  const zone = ok(a) ? [r2(a * 0.97), r2(a * 1.05)] : null;
  const stop = ok(a) ? Math.max(a * 0.95, p * 0.9) : p * 0.9;
  const o = { ...base, buy_zone: zone, stop_loss_if_bought: r2(stop), analyst_target: r2(aTgt) };
  if (!ok(sc)) return { ...o, signal: 'WAIT', reason: 'Not enough data' };
  if (sc < 45) return { ...o, signal: 'AVOID', reason: `Weak fundamentals (score ${sc})` };
  if (down) return { ...o, signal: 'AVOID', reason: 'Downtrend' };
  if (sc >= 60 && ok(rs) && rs < 35 && (!ok(b) || p >= b * 0.97)) return { ...o, signal: 'BUY ON DIP', reason: 'Strong stock, oversold' };
  if (sc >= 60 && (!ok(b) || p > b) && ok(ext) && ext >= -3 && ext <= 8 && (!ok(rs) || rs < 68)) return { ...o, signal: 'BUY', reason: 'In buy zone near 50-day average, uptrend' };
  if ((ok(ext) && ext > 12) || (ok(rs) && rs > 70)) return { ...o, signal: 'WAIT', reason: 'Stretched/overbought — wait for pullback into buy zone' };
  return { ...o, signal: 'WAIT', reason: 'Not at a good entry yet' };
}