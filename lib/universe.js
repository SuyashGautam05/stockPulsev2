import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve('data');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'text/csv,text/plain,*/*' };
const WEEK = 7 * 24 * 3600 * 1000;

// Nifty 50 constituents change a few times a year — edit this list if NSE rebalances.
const NIFTY50 = ['ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK', 'BAJAJ-AUTO', 'BAJFINANCE', 'BAJAJFINSV', 'BEL', 'BHARTIARTL',
  'CIPLA', 'COALINDIA', 'DRREDDY', 'EICHERMOT', 'ETERNAL', 'GRASIM', 'HCLTECH', 'HDFCBANK', 'HDFCLIFE', 'HINDALCO', 'HINDUNILVR', 'ICICIBANK',
  'INDIGO', 'INFY', 'ITC', 'JIOFIN', 'JSWSTEEL', 'KOTAKBANK', 'LT', 'M&M', 'MARUTI', 'MAXHEALTH', 'NESTLEIND', 'NTPC', 'ONGC', 'POWERGRID',
  'RELIANCE', 'SBILIFE', 'SBIN', 'SHRIRAMFIN', 'SUNPHARMA', 'TATACONSUM', 'TATASTEEL', 'TCS', 'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'WIPRO'
].map((s) => s + '.NS');

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

async function cached(file, loader) {
  const f = path.join(DATA, file);
  try {
    const st = await fs.stat(f);
    if (Date.now() - st.mtimeMs < WEEK) return JSON.parse(await fs.readFile(f, 'utf8'));
  } catch {}
  try {
    const list = await loader();
    if (list.length) { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(f, JSON.stringify(list)); }
    return list;
  } catch (e) {
    try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch {}   // stale copy is better than nothing
    throw e;
  }
}

// Every equity listed on NSE (EQ series), from NSE's official list.
async function nseAll() {
  return cached('nse-all.json', async () => {
    const r = await fetch('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', { headers: UA });
    if (!r.ok) throw new Error('NSE list download failed: HTTP ' + r.status);
    const lines = (await r.text()).split(/\r?\n/).filter(Boolean);
    const head = splitCsv(lines[0]).map((h) => h.toUpperCase());
    const iS = head.indexOf('SYMBOL'), iSer = head.findIndex((h) => h.includes('SERIES'));
    return lines.slice(1).map(splitCsv).filter((c) => c[iS] && (iSer < 0 || c[iSer] === 'EQ')).map((c) => c[iS] + '.NS');
  });
}

// Every common stock on NASDAQ, NYSE and other US exchanges, from Nasdaq Trader's symbol directory.
async function usAll() {
  return cached('us-all.json', async () => {
    const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error('US list download failed: HTTP ' + r.status); return (await r.text()).split(/\r?\n/); };
    const [nq, ot] = await Promise.all([
      get('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'),
      get('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt')
    ]);
    const pick = (lines, symCol, etfCol, testCol) => lines.slice(1).map((l) => l.split('|'))
      .filter((c) => c.length > testCol && c[etfCol] === 'N' && c[testCol] === 'N' && !/File Creation/.test(c[0]))
      .map((c) => c[symCol].replace('.', '-'))
      .filter((s) => /^[A-Z-]{1,6}$/.test(s));
    return [...new Set([...pick(nq, 0, 6, 3), ...pick(ot, 0, 4, 6)])];
  });
}

export const UNIVERSES = {
  nifty50: { name: 'Nifty 50', load: async () => NIFTY50 },
  nse: { name: 'All NSE stocks', load: nseAll },
  us: { name: 'All US stocks (NYSE + NASDAQ)', load: usAll }
};

export async function loadUniverse(id, custom = '') {
  if (id === 'custom') {
    return [...new Set(custom.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  }
  const u = UNIVERSES[id];
  if (!u) throw new Error('Unknown universe: ' + id);
  return u.load();
}
