// // StockPulse AI agent — Claude + tools that read live market data from this app.
// import { timing } from './signals.js';

// const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
// const MAX_STEPS = 10;
// const ok = (x) => x != null && isFinite(x);
// const r2 = (x) => (ok(x) ? Math.round(x * 100) / 100 : null);

// const TOOLS = [
//   {
//     name: 'search_stocks',
//     description: 'Find the exchange symbol for a company name. Indian NSE stocks end in .NS, BSE in .BO, US stocks have no suffix.',
//     input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
//   },
//   {
//     name: 'analyze_stock',
//     description: 'Full live analysis of one stock: price, fundamentals score (0-100) with factor breakdown, strengths/risks, valuation, trend (50/200-day averages, RSI, 1m/3m/6m/1y returns, 52-week range), analyst target, last 4 years of revenue/profit/debt, and a rules-based timing signal (BUY / BUY ON DIP / WAIT / AVOID, or HOLD / SELL / BOOK PROFIT if holding is given) with buy zone, stop-loss and target levels.',
//     input_schema: {
//       type: 'object',
//       properties: {
//         symbol: { type: 'string', description: 'Exact symbol, e.g. TCS.NS, RELIANCE.NS, AAPL' },
//         holding: { type: 'object', description: 'Only if the user owns it', properties: { buy_price: { type: 'number' }, quantity: { type: 'number' } } }
//       },
//       required: ['symbol']
//     }
//   },
//   {
//     name: 'find_buy_picks',
//     description: 'Screen a group of stocks and return the strongest ones with their timing signal, sorted best first. Use for "which share should I buy". universe "nifty50" = Nifty 50; or pass up to 60 symbols (e.g. a sector list you built with search_stocks).',
//     input_schema: {
//       type: 'object',
//       properties: {
//         universe: { type: 'string', enum: ['nifty50', 'custom'] },
//         symbols: { type: 'array', items: { type: 'string' } },
//         min_score: { type: 'number', description: 'Default 60' },
//         limit: { type: 'number', description: 'Default 8' }
//       },
//       required: ['universe']
//     }
//   },
//   {
//     name: 'get_live_quotes',
//     description: 'Latest price and today % change for up to 50 symbols. Cheap; use for quick price checks.',
//     input_schema: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'] }
//   }
// ];

// function ret(history, days) {
//   if (!history?.length) return null;
//   const last = history.at(-1), cut = last[0] - days * 864e5;
//   const past = history.find((x) => x[0] >= cut);
//   return past ? r2((last[1] / past[1] - 1) * 100) : null;
// }

// function brief(d, holding) {
//   const m = d.metrics || {};
//   return {
//     symbol: d.symbol, name: d.name, sector: d.sector, industry: d.industry, currency: d.currency,
//     price: d.price, change_today_pct: r2(d.changePct), market_cap: d.marketCap,
//     score: d.score, verdict: d.label, outlook: d.outlook, data_confidence_pct: d.confidence,
//     factors: (d.factors || []).map((f) => ({ name: f.name, score: f.score, detail: f.detail })),
//     strengths: d.pos, risks: d.neg,
//     pe: r2(m.pe), forward_pe: r2(m.fpe), debt_to_equity: r2(m.de), roe_pct: r2(m.roe), net_margin_pct: r2(m.margin), revenue_growth_pct_per_yr: r2(m.revCagr),
//     returns_pct: { '1m': ret(d.history, 30), '3m': ret(d.history, 91), '6m': ret(d.history, 182), '1y': r2(m.r1y) },
//     week52: { low: r2(d.low52), high: r2(d.high52) },
//     analyst: d.analyst,
//     annual: d.annual,
//     timing: timing(d, holding)
//   };
// }

// export function createAgent({ getStock, getQuotes, searchStocks, nifty50 }) {
//   async function findPicks({ universe, symbols = [], min_score = 60, limit = 8 }, emit) {
//     const list = (universe === 'custom' ? symbols : await nifty50()).slice(0, 60);
//     const out = []; let i = 0, done = 0;
//     const worker = async () => {
//       while (i < list.length) {
//         const s = list[i++];
//         try { out.push(await getStock(s)); } catch {}
//         emit('progress', { label: `Screening ${++done}/${list.length}` });
//       }
//     };
//     await Promise.all(Array.from({ length: 4 }, worker));
//     const picks = out
//       .filter((d) => ok(d.score) && d.score >= min_score && (d.confidence ?? 0) >= 60)
//       .map((d) => ({ d, t: timing(d) }))
//       .sort((x, y) => (['BUY', 'BUY ON DIP'].includes(y.t.signal) - ['BUY', 'BUY ON DIP'].includes(x.t.signal)) || y.d.score - x.d.score)
//       .slice(0, Math.min(limit, 15))
//       .map(({ d, t }) => ({ symbol: d.symbol, name: d.name, sector: d.sector, price: d.price, score: d.score, verdict: d.label, pe: r2(d.metrics?.pe), return_1y_pct: r2(d.metrics?.r1y), analyst_target: d.analyst?.target, top_strength: d.pos?.[0], top_risk: d.neg?.[0] || null, timing: t }));
//     return { screened: list.length, analysed: out.length, passed: picks.length, picks };
//   }

//   const run = {
//     search_stocks: ({ query }) => searchStocks(query),
//     analyze_stock: async ({ symbol, holding }, emit) => { const d = await getStock(symbol); emit('stock', { symbol: d.symbol, name: d.name, price: d.price, currency: d.currency, score: d.score, signal: timing(d, holding).signal }); return brief(d, holding); },
//     find_buy_picks: findPicks,
//     get_live_quotes: ({ symbols }) => getQuotes(symbols.slice(0, 50))
//   };

//   const label = (name, input) => ({
//     search_stocks: `Searching “${input.query}”`,
//     analyze_stock: `Analysing ${input.symbol}`,
//     find_buy_picks: input.universe === 'nifty50' ? 'Screening Nifty 50' : `Screening ${input.symbols?.length || 0} stocks`,
//     get_live_quotes: `Checking live prices`
//   }[name] || name);

//   function system(watchlist) {
//     const now = new Date();
//     const ist = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
//     return `You are StockPulse AI, a stock research assistant inside the StockPulse app, used by an Indian retail investor.
// Current time: ${ist} IST. NSE trades Mon–Fri 9:15 AM–3:30 PM IST.

// How to work:
// - Always use tools for anything stock-specific. Never quote prices, financials or targets from memory. Default to NSE (.NS) for Indian companies unless the user says otherwise.
// - "Which share should I buy?" → find_buy_picks (Nifty 50 unless they name a sector or list), then name the top 2–4 with why.
// - "When to buy?" → answer with price levels and conditions from the timing data: buy zone, "buy if it pulls back to ₹X", "wait until RSI cools below 60", "only if it holds above the 200-day average ₹Y".
// - "When to sell?" → stop-loss and target levels, and what would turn the signal to SELL.
// - "Will it go up or down?" → nobody can know future prices. Give the more likely direction with reasons (trend, momentum, fundamentals, valuation, analyst target) and the levels that would confirm or cancel that view. Use words like likely/unlikely; never promise, never give dates for price moves, never state percentages as certain forecasts.
// - Point out the single biggest risk for any stock you recommend.

// Style:
// - Reply in the user's language — if they write Hinglish, reply in Hinglish (Roman script).
// - Be direct and short: lead with the answer, then 3–6 bullets. Use a small markdown table only when comparing several stocks. Use ₹ for INR.
// - End with one short line that this is a rules-based view, not investment advice.

// User's watchlist (from the app; "own" means they hold it, buy/qty given):
// ${watchlist?.length ? JSON.stringify(watchlist.map((w) => ({ symbol: w.symbol, name: w.name, own: !!w.own, buy_price: w.buy ?? null, quantity: w.qty ?? null, their_target: w.target ?? null, their_stop: w.stop ?? null }))) : 'empty'}
// When they ask about "my stocks/watchlist/portfolio", analyse those symbols (pass holding for owned ones).`;
//   }

//   async function callClaude(body) {
//     const key = process.env.ANTHROPIC_API_KEY;
//     if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.');
//     const r = await fetch('https://api.anthropic.com/v1/messages', {
//       method: 'POST',
//       headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
//       body: JSON.stringify({ model: MODEL, max_tokens: 2000, ...body })
//     });
//     const j = await r.json().catch(() => ({}));
//     if (!r.ok) throw new Error(j.error?.message || `Claude API error ${r.status}`);
//     return j;
//   }

//   return async function ask({ messages, watchlist }, emit) {
//     const msgs = messages.map((m) => ({ role: m.role, content: String(m.content) }));
//     const sys = system(watchlist);
//     for (let step = 0; step < MAX_STEPS; step++) {
//       const res = await callClaude({ system: sys, tools: TOOLS, messages: msgs });
//       msgs.push({ role: 'assistant', content: res.content });
//       const uses = res.content.filter((b) => b.type === 'tool_use');
//       if (res.stop_reason !== 'tool_use' || !uses.length) {
//         return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
//       }
//       const results = await Promise.all(uses.map(async (u) => {
//         emit('tool', { label: label(u.name, u.input || {}) });
//         try {
//           const out = await run[u.name](u.input || {}, emit);
//           return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) };
//         } catch (e) {
//           return { type: 'tool_result', tool_use_id: u.id, content: 'Error: ' + (e.message || e), is_error: true };
//         }
//       }));
//       msgs.push({ role: 'user', content: results });
//     }
//     return 'I needed too many steps for that question. Try asking about fewer stocks at once.';
//   };
// }



// StockPulse AI agent — an LLM + tools that read live market data from this app.
// Provider: Google Gemini (free tier) if GEMINI_API_KEY is set, else Anthropic Claude if ANTHROPIC_API_KEY is set.
import { timing } from './signals.js';

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_STEPS = 10;
const ok = (x) => x != null && isFinite(x);
const r2 = (x) => (ok(x) ? Math.round(x * 100) / 100 : null);

const TOOLS = [
  {
    name: 'search_stocks',
    description: 'Find the exchange symbol for a company name. Indian NSE stocks end in .NS, BSE in .BO, US stocks have no suffix.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'analyze_stock',
    description: 'Full live analysis of one stock: price, fundamentals score (0-100) with factor breakdown, strengths/risks, valuation, trend (50/200-day averages, RSI, 1m/3m/6m/1y returns, 52-week range), analyst target, last 4 years of revenue/profit/debt, and a rules-based timing signal (BUY / BUY ON DIP / WAIT / AVOID, or HOLD / SELL / BOOK PROFIT if holding is given) with buy zone, stop-loss and target levels.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Exact symbol, e.g. TCS.NS, RELIANCE.NS, AAPL' },
        holding: { type: 'object', description: 'Only if the user owns it', properties: { buy_price: { type: 'number' }, quantity: { type: 'number' } } }
      },
      required: ['symbol']
    }
  },
  {
    name: 'find_buy_picks',
    description: 'Screen a group of stocks and return the strongest ones with their timing signal, sorted best first. Use for "which share should I buy". universe "nifty50" = Nifty 50; or pass up to 60 symbols (e.g. a sector list you built with search_stocks).',
    input_schema: {
      type: 'object',
      properties: {
        universe: { type: 'string', enum: ['nifty50', 'custom'] },
        symbols: { type: 'array', items: { type: 'string' } },
        min_score: { type: 'number', description: 'Default 60' },
        limit: { type: 'number', description: 'Default 8' }
      },
      required: ['universe']
    }
  },
  {
    name: 'get_live_quotes',
    description: 'Latest price and today % change for up to 50 symbols. Cheap; use for quick price checks.',
    input_schema: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'] }
  }
];

function ret(history, days) {
  if (!history?.length) return null;
  const last = history.at(-1), cut = last[0] - days * 864e5;
  const past = history.find((x) => x[0] >= cut);
  return past ? r2((last[1] / past[1] - 1) * 100) : null;
}

function brief(d, holding) {
  const m = d.metrics || {};
  return {
    symbol: d.symbol, name: d.name, sector: d.sector, industry: d.industry, currency: d.currency,
    price: d.price, change_today_pct: r2(d.changePct), market_cap: d.marketCap,
    score: d.score, verdict: d.label, outlook: d.outlook, data_confidence_pct: d.confidence,
    factors: (d.factors || []).map((f) => ({ name: f.name, score: f.score, detail: f.detail })),
    strengths: d.pos, risks: d.neg,
    pe: r2(m.pe), forward_pe: r2(m.fpe), debt_to_equity: r2(m.de), roe_pct: r2(m.roe), net_margin_pct: r2(m.margin), revenue_growth_pct_per_yr: r2(m.revCagr),
    returns_pct: { '1m': ret(d.history, 30), '3m': ret(d.history, 91), '6m': ret(d.history, 182), '1y': r2(m.r1y) },
    week52: { low: r2(d.low52), high: r2(d.high52) },
    analyst: d.analyst,
    annual: d.annual,
    timing: timing(d, holding)
  };
}

export function createAgent({ getStock, getQuotes, searchStocks, nifty50 }) {
  async function findPicks({ universe, symbols = [], min_score = 60, limit = 8 }, emit) {
    const list = (universe === 'custom' ? symbols : await nifty50()).slice(0, 60);
    const out = []; let i = 0, done = 0;
    const worker = async () => {
      while (i < list.length) {
        const s = list[i++];
        try { out.push(await getStock(s)); } catch {}
        emit('progress', { label: `Screening ${++done}/${list.length}` });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    const picks = out
      .filter((d) => ok(d.score) && d.score >= min_score && (d.confidence ?? 0) >= 60)
      .map((d) => ({ d, t: timing(d) }))
      .sort((x, y) => (['BUY', 'BUY ON DIP'].includes(y.t.signal) - ['BUY', 'BUY ON DIP'].includes(x.t.signal)) || y.d.score - x.d.score)
      .slice(0, Math.min(limit, 15))
      .map(({ d, t }) => ({ symbol: d.symbol, name: d.name, sector: d.sector, price: d.price, score: d.score, verdict: d.label, pe: r2(d.metrics?.pe), return_1y_pct: r2(d.metrics?.r1y), analyst_target: d.analyst?.target, top_strength: d.pos?.[0], top_risk: d.neg?.[0] || null, timing: t }));
    return { screened: list.length, analysed: out.length, passed: picks.length, picks };
  }

  const run = {
    search_stocks: ({ query }) => searchStocks(query),
    analyze_stock: async ({ symbol, holding }, emit) => { const d = await getStock(symbol); emit('stock', { symbol: d.symbol, name: d.name, price: d.price, currency: d.currency, score: d.score, signal: timing(d, holding).signal }); return brief(d, holding); },
    find_buy_picks: findPicks,
    get_live_quotes: ({ symbols }) => getQuotes(symbols.slice(0, 50))
  };

  const label = (name, input) => ({
    search_stocks: `Searching “${input.query}”`,
    analyze_stock: `Analysing ${input.symbol}`,
    find_buy_picks: input.universe === 'nifty50' ? 'Screening Nifty 50' : `Screening ${input.symbols?.length || 0} stocks`,
    get_live_quotes: `Checking live prices`
  }[name] || name);

  function system(watchlist) {
    const now = new Date();
    const ist = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    return `You are StockPulse AI, a stock research assistant inside the StockPulse app, used by an Indian retail investor.
Current time: ${ist} IST. NSE trades Mon–Fri 9:15 AM–3:30 PM IST.

How to work:
- Always use tools for anything stock-specific. Never quote prices, financials or targets from memory. Default to NSE (.NS) for Indian companies unless the user says otherwise.
- "Which share should I buy?" → find_buy_picks (Nifty 50 unless they name a sector or list), then name the top 2–4 with why.
- "When to buy?" → answer with price levels and conditions from the timing data: buy zone, "buy if it pulls back to ₹X", "wait until RSI cools below 60", "only if it holds above the 200-day average ₹Y".
- "When to sell?" → stop-loss and target levels, and what would turn the signal to SELL.
- "Will it go up or down?" → nobody can know future prices. Give the more likely direction with reasons (trend, momentum, fundamentals, valuation, analyst target) and the levels that would confirm or cancel that view. Use words like likely/unlikely; never promise, never give dates for price moves, never state percentages as certain forecasts.
- Point out the single biggest risk for any stock you recommend.

Style:
- Reply in the user's language — if they write Hinglish, reply in Hinglish (Roman script).
- Be direct and short: lead with the answer, then 3–6 bullets. Use a small markdown table only when comparing several stocks. Use ₹ for INR.
- End with one short line that this is a rules-based view, not investment advice.

User's watchlist (from the app; "own" means they hold it, buy/qty given):
${watchlist?.length ? JSON.stringify(watchlist.map((w) => ({ symbol: w.symbol, name: w.name, own: !!w.own, buy_price: w.buy ?? null, quantity: w.qty ?? null, their_target: w.target ?? null, their_stop: w.stop ?? null }))) : 'empty'}
When they ask about "my stocks/watchlist/portfolio", analyse those symbols (pass holding for owned ones).`;
  }

  async function exec(name, input, emit) {
    emit('tool', { label: label(name, input || {}) });
    if (!run[name]) throw new Error('Unknown tool ' + name);
    return run[name](input || {}, emit);
  }

  // ---------- Anthropic Claude ----------
  async function claudeLoop(sys, messages, emit) {
    const key = process.env.ANTHROPIC_API_KEY;
    const msgs = messages.map((m) => ({ role: m.role, content: String(m.content) }));
    for (let step = 0; step < MAX_STEPS; step++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, system: sys, tools: TOOLS, messages: msgs })
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error?.message || `Claude API error ${r.status}`);
      msgs.push({ role: 'assistant', content: res.content });
      const uses = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const results = await Promise.all(uses.map(async (u) => {
        try { return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await exec(u.name, u.input, emit)).slice(0, 60000) }; }
        catch (e) { return { type: 'tool_result', tool_use_id: u.id, content: 'Error: ' + (e.message || e), is_error: true }; }
      }));
      msgs.push({ role: 'user', content: results });
    }
    return null;
  }

  // ---------- Google Gemini (free tier) ----------
  const toGem = (sc) => {
    if (!sc || typeof sc !== 'object') return sc;
    const o = {};
    for (const [k, v] of Object.entries(sc)) {
      if (k === 'type') o.type = String(v).toUpperCase();
      else if (k === 'properties') o.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGem(pv)]));
      else if (k === 'items') o.items = toGem(v);
      else o[k] = v;
    }
    return o;
  };
  const GEM_TOOLS = [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: toGem(t.input_schema) })) }];

  async function geminiLoop(sys, messages, emit) {
    const key = process.env.GEMINI_API_KEY;
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));
    for (let step = 0; step < MAX_STEPS; step++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, tools: GEM_TOOLS, generationConfig: { maxOutputTokens: 4096, temperature: 0.3 } })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 429) throw new Error('Gemini free-tier limit reached. Wait a minute and try again.');
        throw new Error(j.error?.message || `Gemini API error ${r.status}`);
      }
      const cand = j.candidates?.[0];
      const parts = cand?.content?.parts || [];
      if (!parts.length) throw new Error('Gemini returned no answer' + (cand?.finishReason ? ` (${cand.finishReason})` : '') + '. Try rephrasing.');
      contents.push({ role: 'model', parts });   // keep parts as-is (incl. thought signatures)
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length) return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
      const results = await Promise.all(calls.map(async ({ functionCall: fc }) => {
        const base = { name: fc.name, ...(fc.id ? { id: fc.id } : {}) };
        try { const out = await exec(fc.name, fc.args, emit); return { functionResponse: { ...base, response: { result: out ?? null } } }; }
        catch (e) { return { functionResponse: { ...base, response: { error: String(e.message || e) } } }; }
      }));
      contents.push({ role: 'user', parts: results });
    }
    return null;
  }

  return async function ask({ messages, watchlist }, emit) {
    const sys = system(watchlist);
    let answer;
    if (process.env.GEMINI_API_KEY) answer = await geminiLoop(sys, messages, emit);
    else if (process.env.ANTHROPIC_API_KEY) answer = await claudeLoop(sys, messages, emit);
    else throw new Error('No AI key set. Add GEMINI_API_KEY (free, from aistudio.google.com) to .env locally or to Vercel → Settings → Environment Variables, then restart/redeploy.');
    return answer || 'I needed too many steps for that question. Try asking about fewer stocks at once.';
  };
}