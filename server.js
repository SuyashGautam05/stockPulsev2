import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YahooFinance from 'yahoo-finance2';
import { analyze } from './lib/analyze.js';
import { loadUniverse, UNIVERSES } from './lib/universe.js';

const PORT = process.env.PORT || 3000;
const TTL = 12 * 3600 * 1000;          // re-fetch fundamentals every 12h
const SCAN_CONCURRENCY = 3;            // keep low: Yahoo rate-limits aggressive scanners
// Vercel's filesystem is read-only except /tmp
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.resolve('data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');

const quiet = () => {};
const DEBUG = !!process.env.DEBUG;
const yf = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  logger: { info: DEBUG ? console.log : quiet, debug: DEBUG ? console.log : quiet, dir: quiet, warn: DEBUG ? console.warn : quiet, error: DEBUG ? console.error : quiet }
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.use(express.static(PUBLIC_DIR));
// Explicit route so / works on Vercel even when static serving isn't picked up
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ---------- cache (persists across restarts) ----------
let cache = {};
try { cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch {}
let saveTimer = null;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
  }, 2000);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, tries = 3) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e?.message || e);
      if (i >= tries - 1 || /not found|No fundamentals|Quote not found|delisted/i.test(msg)) throw e;
      await sleep(1500 * (i + 1) * (/429|Too Many/i.test(msg) ? 4 : 1));
    }
  }
}
const toDate = (d) => (d instanceof Date ? d : new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d));

// ---------- core: fetch + analyse one stock ----------
async function getStock(symbol, { force = false } = {}) {
  symbol = symbol.toUpperCase();
  const hit = cache[symbol];
  if (!force && hit && Date.now() - hit.updated < TTL) return hit;

  const fiveY = new Date(); fiveY.setFullYear(fiveY.getFullYear() - 5);
  const oneY = new Date(); oneY.setFullYear(oneY.getFullYear() - 1);

  const [sumR, annR, chR, qR] = await Promise.allSettled([
    retry(() => yf.quoteSummary(symbol, { modules: ['price', 'financialData', 'defaultKeyStatistics', 'summaryDetail', 'assetProfile'] }, { validateResult: false })),
    retry(() => yf.fundamentalsTimeSeries(symbol, { period1: fiveY, type: 'annual', module: 'all' }, { validateResult: false })),
    retry(() => yf.chart(symbol, { period1: oneY, interval: '1d' }, { validateResult: false })),
    retry(() => yf.quote(symbol, {}, { validateResult: false }))
  ]);
  if (sumR.status === 'rejected') throw sumR.reason;
  const s = sumR.value;
  const q = qR.status === 'fulfilled' ? qR.value : {};

  const annual = (annR.status === 'fulfilled' ? annR.value : [])
    .map((r) => ({ ...r, date: toDate(r.date) }))
    .filter((r) => r.totalRevenue != null || r.netIncome != null)
    .sort((a, b) => a.date - b.date);
  const quotes = chR.status === 'fulfilled' ? chR.value.quotes.filter((x) => x.close != null) : [];
  const closes = quotes.map((x) => x.close);
  const price = q.regularMarketPrice ?? s.price?.regularMarketPrice;

  const a = analyze({
    annual, closes, price,
    fin: s.financialData || {}, detail: s.summaryDetail || {},
    stats: s.defaultKeyStatistics || {}, profile: s.assetProfile || {}
  });

  const step = Math.max(1, Math.floor(quotes.length / 150));
  const fd = s.financialData || {};
  const out = {
    symbol,
    name: s.price?.longName || s.price?.shortName || q.longName || symbol,
    exchange: s.price?.exchangeName || q.fullExchangeName || '',
    currency: s.price?.currency || q.currency || '',
    sector: s.assetProfile?.sector || '', industry: s.assetProfile?.industry || '',
    price, changePct: q.regularMarketChangePercent ?? null,
    marketCap: q.marketCap ?? s.price?.marketCap ?? null,
    annual: annual.map((r) => ({ year: r.date.getFullYear(), revenue: r.totalRevenue ?? null, profit: r.netIncome ?? null, debt: r.totalDebt ?? null })),
    history: quotes.filter((_, i) => i % step === 0 || i === quotes.length - 1).map((x) => [+toDate(x.date), +x.close.toFixed(2)]),
    analyst: {
      rating: fd.recommendationKey && fd.recommendationKey !== 'none' ? fd.recommendationKey : null,
      target: fd.targetMeanPrice ?? null, low: fd.targetLowPrice ?? null, high: fd.targetHighPrice ?? null,
      count: fd.numberOfAnalystOpinions ?? null
    },
    ...a,
    updated: Date.now()
  };
  cache[symbol] = out; persist();
  return out;
}

const row = (s) => ({
  symbol: s.symbol, name: s.name, sector: s.sector, currency: s.currency, price: s.price, changePct: s.changePct,
  score: s.score, label: s.label, confidence: s.confidence,
  pe: s.metrics?.pe ?? null, de: s.metrics?.de ?? null, revCagr: s.metrics?.revCagr ?? null, r1y: s.metrics?.r1y ?? null,
  upside: s.analyst?.target && s.price ? (s.analyst.target / s.price - 1) * 100 : null, marketCap: s.marketCap
});

// ---------- API ----------
app.get('/api/search', async (req, res) => {
  const qy = String(req.query.q || '').trim();
  if (!qy) return res.json([]);
  try {
    const r = await yf.search(qy, { quotesCount: 10, newsCount: 0 }, { validateResult: false });
    res.json((r.quotes || []).filter((x) => x.quoteType === 'EQUITY' && x.symbol)
      .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange })));
  } catch (e) { res.status(502).json({ error: 'Search failed: ' + e.message }); }
});

app.get('/api/stock/:symbol', async (req, res) => {
  try { res.json(await getStock(req.params.symbol, { force: req.query.refresh === '1' })); }
  catch (e) { res.status(404).json({ error: `Couldn't load ${req.params.symbol}: ${e.message}` }); }
});

// Live prices for up to 100 symbols at once
app.get('/api/quotes', async (req, res) => {
  const syms = String(req.query.symbols || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!syms.length) return res.json([]);
  try {
    const r = await yf.quote(syms, { fields: ['symbol', 'regularMarketPrice', 'regularMarketChangePercent', 'regularMarketTime', 'marketState'] }, { validateResult: false });
    res.json((Array.isArray(r) ? r : [r]).map((x) => ({
      symbol: x.symbol, price: x.regularMarketPrice, changePct: x.regularMarketChangePercent,
      time: x.regularMarketTime ? +toDate(x.regularMarketTime) : null, marketState: x.marketState
    })));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/universes', (_req, res) => {
  res.json(Object.entries(UNIVERSES).map(([id, u]) => ({ id, name: u.name })));
});

// Previously scanned results (from cache) for a universe
app.get('/api/results', async (req, res) => {
  try {
    const list = await loadUniverse(String(req.query.universe || 'nifty50'), String(req.query.custom || ''));
    res.json({ total: list.length, rows: list.map((s) => cache[s]).filter(Boolean).map(row) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Scan a whole universe, streaming each result as it arrives (Server-Sent Events)
app.get('/api/scan', async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  let stopped = false;
  req.on('close', () => { stopped = true; });

  let list;
  try { list = await loadUniverse(String(req.query.universe || 'nifty50'), String(req.query.custom || '')); }
  catch (e) { send('fatal', { error: e.message }); return res.end(); }

  const force = req.query.refresh === '1';
  send('start', { total: list.length });
  let i = 0, done = 0;
  const worker = async () => {
    while (!stopped && i < list.length) {
      const sym = list[i++];
      const wasCached = !force && cache[sym] && Date.now() - cache[sym].updated < TTL;
      try { send('row', row(await getStock(sym, { force }))); }
      catch (e) { send('fail', { symbol: sym, error: String(e.message || e).slice(0, 140) }); }
      send('progress', { done: ++done, total: list.length });
      if (!wasCached) await sleep(350);
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
  if (!stopped) { send('done', { total: list.length }); res.end(); }
});

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`StockPulse running → http://localhost:${PORT}`));

export default app;