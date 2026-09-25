// Scores a stock 0-100 from fundamentals + price momentum.
// Weights: profitability 22, growth 18, debt 20, liquidity 8, cash 12, valuation 8, momentum 12.

const lin = (x, a, b) => Math.round(Math.max(0, Math.min(1, (x - a) / (b - a))) * 100);
const avg = (a) => { a = a.filter((x) => x != null && isFinite(x)); return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null; };
const f1 = (x, d = 1) => Number(x).toFixed(d);
const ok = (x) => x != null && isFinite(x);

export function verdict(s) {
  if (s >= 75) return { label: 'Strong', outlook: 'Strong fundamentals and trend. Likely to outperform over 1–3 years if results hold.' };
  if (s >= 60) return { label: 'Stable', outlook: 'Sound business with some soft spots. Expect steady, market-like performance.' };
  if (s >= 45) return { label: 'Mixed', outlook: 'Strengths and risks roughly balance. Likely to move sideways; watch the next results.' };
  if (s >= 30) return { label: 'Weak', outlook: 'Profit, debt or trend issues outweigh strengths. Higher risk of underperformance.' };
  return { label: 'High risk', outlook: 'Losses, heavy debt, cash burn or a falling trend. Significant downside risk.' };
}

export function analyze({ annual = [], fin = {}, detail = {}, stats = {}, profile = {}, closes = [], price }) {
  const rows = annual.slice(-4);
  const col = (k) => rows.map((r) => (ok(r[k]) ? r[k] : null));
  const rev = col('totalRevenue'), np = col('netIncome'), debt = col('totalDebt'), eq = col('stockholdersEquity');
  const ocf = col('operatingCashFlow'), it = col('interestExpense'), ca = col('currentAssets'), cl = col('currentLiabilities');
  const L = rows.length - 1;
  const at = (arr) => (L >= 0 ? arr[L] : null);
  const isFin = /financial/i.test(profile.sector || '');
  const pos = [], neg = [], F = [];
  const m = {};

  // ---- Profitability
  m.margin = ok(at(rev)) && at(rev) > 0 && ok(at(np)) ? (at(np) / at(rev)) * 100 : ok(fin.profitMargins) ? fin.profitMargins * 100 : null;
  m.roe = ok(at(eq)) && at(eq) > 0 && ok(at(np)) ? (at(np) / at(eq)) * 100 : ok(fin.returnOnEquity) ? fin.returnOnEquity * 100 : null;
  const negEq = ok(at(eq)) && at(eq) <= 0;
  F.push({ key: 'profit', name: 'Profitability', w: 22,
    score: avg([ok(m.margin) ? lin(m.margin, -5, 20) : null, negEq ? 0 : ok(m.roe) ? lin(m.roe, 0, 20) : null]),
    detail: [ok(m.margin) && `Net margin ${f1(m.margin)}%`, ok(m.roe) && `ROE ${f1(m.roe)}%`].filter(Boolean).join(', ') || 'No data' });
  if (ok(at(np)) && at(np) < 0) neg.push('Made a net loss in the latest year.');
  else if (m.margin >= 12) pos.push(`Strong net margin of ${f1(m.margin)}%.`);
  else if (ok(m.margin) && m.margin < 4 && !isFin) neg.push(`Thin net margin (${f1(m.margin)}%).`);
  if (negEq) neg.push('Shareholders’ equity is negative.');
  else if (m.roe >= 18) pos.push(`High return on equity (${f1(m.roe)}%).`);

  // ---- Growth
  let sG = null, gD = 'No history';
  const i0 = rev.findIndex((x) => ok(x) && x > 0);
  if (i0 > -1 && i0 < L && at(rev) > 0) {
    const n = L - i0;
    m.revCagr = (Math.pow(at(rev) / rev[i0], 1 / n) - 1) * 100;
    let sPr = null; const p0 = np[i0], p1 = at(np);
    if (ok(p0) && ok(p1)) {
      if (p0 <= 0 && p1 > 0) { sPr = 100; pos.push('Turned from loss to profit.'); }
      else if (p0 > 0 && p1 <= 0) { sPr = 0; neg.push('Slipped from profit into loss.'); }
      else if (p0 > 0) {
        m.profitCagr = (Math.pow(p1 / p0, 1 / n) - 1) * 100; sPr = lin(m.profitCagr, -10, 25);
        if (m.profitCagr >= 15) pos.push(`Profit growing ~${f1(m.profitCagr, 0)}% a year.`);
        else if (m.profitCagr < 0) neg.push(`Profit shrinking ~${f1(-m.profitCagr, 0)}% a year.`);
      } else { sPr = p1 > p0 ? 35 : 5; neg.push(p1 > p0 ? 'Losses narrowing but still loss-making.' : 'Losses widening.'); }
    }
    sG = Math.round(sPr == null ? lin(m.revCagr, -5, 20) : lin(m.revCagr, -5, 20) * 0.55 + sPr * 0.45);
    gD = `Revenue ${m.revCagr >= 0 ? '+' : ''}${f1(m.revCagr)}%/yr over ${n}y`;
    if (m.revCagr >= 15) pos.push(`Revenue growing fast (~${f1(m.revCagr, 0)}% a year).`);
    else if (m.revCagr < 0) neg.push(`Revenue falling (~${f1(-m.revCagr, 0)}% a year).`);
  } else if (ok(fin.revenueGrowth)) {
    m.revCagr = fin.revenueGrowth * 100; sG = lin(m.revCagr, -5, 20); gD = `Revenue ${f1(m.revCagr)}% YoY`;
  }
  F.push({ key: 'growth', name: 'Growth', w: 18, score: sG, detail: gD });

  // ---- Debt safety (skipped for banks/NBFCs: borrowing is their raw material)
  let sD = null; const dP = [];
  if (isFin) dP.push('Skipped for financial companies');
  else {
    let s1 = null;
    if (negEq) { s1 = 0; dP.push('Equity ≤ 0'); }
    else if (ok(at(debt)) && ok(at(eq))) m.de = at(debt) / at(eq);
    else if (ok(fin.debtToEquity)) m.de = fin.debtToEquity / 100;
    if (ok(m.de)) {
      s1 = lin(m.de, 2.5, 0.3); dP.push(`D/E ${f1(m.de, 2)}`);
      if (m.de > 1.5) neg.push(`Heavy debt (${f1(m.de, 1)}× equity).`);
      else if (m.de < 0.1) pos.push('Nearly debt-free.');
      else if (m.de < 0.3) pos.push(`Low debt (D/E ${f1(m.de, 2)}).`);
    }
    let s2 = null;
    if (ok(at(it)) && ok(at(np))) {
      if (at(it) > 0) {
        m.cover = (at(np) + at(it)) / at(it); s2 = lin(m.cover, 1, 8); dP.push(`interest cover ~${f1(m.cover)}×`);
        if (m.cover < 2) neg.push(`Earnings barely cover interest (~${f1(m.cover)}×).`);
      } else s2 = 100;
    }
    sD = avg([s1, s2]);
    const j = debt.findIndex((x) => ok(x) && x > 0);
    if (sD != null && j > -1 && j < L && ok(at(debt))) {
      const dg = (at(debt) / debt[j] - 1) * 100, rg = rev[j] > 0 && ok(at(rev)) ? (at(rev) / rev[j] - 1) * 100 : 0;
      if (dg > 30 && dg > rg) { sD = Math.max(0, sD - 15); neg.push(`Debt up ${f1(dg, 0)}% while revenue grew ${f1(rg, 0)}%.`); }
      else if (dg < -15) pos.push(`Debt cut by ${f1(-dg, 0)}%.`);
    }
  }
  F.push({ key: 'debt', name: 'Debt safety', w: 20, score: sD, detail: dP.join(', ') || 'No data' });

  // ---- Liquidity
  let sL = null, lD = isFin ? 'Skipped for financial companies' : 'No data';
  if (!isFin) {
    m.cr = ok(at(ca)) && at(cl) > 0 ? at(ca) / at(cl) : ok(fin.currentRatio) ? fin.currentRatio : null;
    if (ok(m.cr)) {
      sL = lin(m.cr, 0.8, 2); lD = `Current ratio ${f1(m.cr, 2)}`;
      if (m.cr < 1) neg.push(`Short-term dues exceed short-term assets (current ratio ${f1(m.cr, 2)}).`);
    }
  }
  F.push({ key: 'liq', name: 'Liquidity', w: 8, score: sL, detail: lD });

  // ---- Cash quality
  let sC = null, cD = isFin ? 'Skipped for financial companies' : 'No data';
  const o = ok(at(ocf)) ? at(ocf) : ok(fin.operatingCashflow) ? fin.operatingCashflow : null;
  const p = ok(at(np)) ? at(np) : null;
  if (!isFin && ok(o) && ok(p)) {
    if (p > 0) {
      m.cashConv = o / p; sC = lin(m.cashConv, 0, 1.1); cD = `Operating cash ${f1(m.cashConv, 2)}× profit`;
      if (m.cashConv >= 1) pos.push('Profits backed by real cash flow.');
      else if (m.cashConv < 0.5) neg.push('Profit not converting into cash.');
    } else { sC = o > 0 ? 55 : 5; cD = o > 0 ? 'Cash positive despite loss' : 'Burning cash'; if (o < 0) neg.push('Operations burning cash.'); }
  }
  F.push({ key: 'cash', name: 'Cash quality', w: 12, score: sC, detail: cD });

  // ---- Valuation
  m.pe = ok(detail.trailingPE) ? detail.trailingPE : null;
  m.fpe = ok(detail.forwardPE) ? detail.forwardPE : ok(stats.forwardPE) ? stats.forwardPE : null;
  m.pb = ok(stats.priceToBook) ? stats.priceToBook : null;
  let sV = null; const vP = [];
  if (ok(m.pe) && m.pe > 0) {
    sV = lin(m.pe, 60, 12); vP.push(`P/E ${f1(m.pe)}`);
    if (ok(m.fpe) && m.fpe > 0) {
      vP.push(`forward ${f1(m.fpe)}`);
      if (m.fpe < m.pe * 0.85) { sV = Math.min(100, sV + 10); pos.push('Earnings expected to rise (forward P/E below trailing).'); }
    }
    if (m.pe > 60) neg.push(`Expensive at P/E ${f1(m.pe, 0)}.`);
    else if (m.pe < 15 && (F[0].score ?? 0) > 50) pos.push(`Reasonably priced at P/E ${f1(m.pe)}.`);
  } else if (ok(at(np)) && at(np) < 0) { sV = 10; vP.push('Loss-making, P/E not meaningful'); }
  if (isFin && ok(m.pb) && m.pb > 0) { const s = lin(m.pb, 5, 1); sV = sV == null ? s : Math.round((sV + s) / 2); vP.push(`P/B ${f1(m.pb, 2)}`); }
  F.push({ key: 'val', name: 'Valuation', w: 8, score: sV, detail: vP.join(', ') || 'No data' });

  // ---- Momentum (price trend)
  let sM = null, mD = 'No price history';
  if (closes.length >= 60) {
    const last = ok(price) ? price : closes.at(-1);
    const ma = (n) => { const s = closes.slice(-n); return s.reduce((a, x) => a + x, 0) / s.length; };
    m.r1y = (last / closes[0] - 1) * 100;
    m.ma50 = ma(50); m.ma200 = closes.length >= 190 ? ma(200) : null;
    const parts = [lin(m.r1y, -30, 40), last > m.ma50 ? 70 : 30];
    if (ok(m.ma200)) parts.push(last > m.ma200 ? 75 : 20, m.ma50 > m.ma200 ? 70 : 30);
    sM = avg(parts);
    mD = `1Y ${m.r1y >= 0 ? '+' : ''}${f1(m.r1y)}%` + (ok(m.ma200) ? `, ${last > m.ma200 ? 'above' : 'below'} 200-day avg` : '');
    if (ok(m.ma200) && last < m.ma200 && m.ma50 < m.ma200) neg.push('Price in a downtrend (below 50- and 200-day averages).');
    else if (ok(m.ma200) && last > m.ma200 && m.ma50 > m.ma200) pos.push('Price in an uptrend (above 50- and 200-day averages).');
  }
  F.push({ key: 'mom', name: 'Momentum', w: 12, score: sM, detail: mD });

  let tw = 0, ts = 0, all = 0;
  for (const f of F) { all += f.w; if (f.score != null) { tw += f.w; ts += f.w * f.score; } }
  if (!tw) return { score: null, confidence: 0, label: 'No data', outlook: 'Not enough data to score this stock.', factors: F, pos, neg, metrics: m, isFin };
  const score = Math.round(ts / tw);
  return { score, confidence: Math.round((tw / all) * 100), ...verdict(score), factors: F, pos, neg, metrics: m, isFin };
}
