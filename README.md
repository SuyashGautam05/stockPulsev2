# StockPulse

Live, fundamentals-based stock outlook for any listed company (NSE, BSE, NYSE, NASDAQ, and most global exchanges on Yahoo Finance), plus a scanner that analyses a whole market.

## Run
```bash
npm install
npm start            # http://localhost:3000
DEBUG=1 npm start    # verbose Yahoo logs
```
Requires Node 22+.

## What it does
- **Analyze a stock** – search any company, get a 0–100 score from 5 years of annual financials (revenue, profit/loss, debt, equity, cash flow, interest, current assets/liabilities), P/E, and 1-year price trend. Price refreshes every 15s.
- **Scan the market** – Nifty 50, every NSE equity (~2,000+), every US stock (~6,000+), or your own list. Results stream in live, are sortable/filterable, export to CSV, and are cached in `data/cache.json` for 12h so re-scans are fast.

## Scoring (lib/analyze.js)
| Factor | Weight | Based on |
|---|---|---|
| Profitability | 22 | Net margin, ROE |
| Growth | 18 | Revenue & profit CAGR |
| Debt safety | 20 | Debt/Equity, interest cover, debt trend |
| Liquidity | 8 | Current ratio |
| Cash quality | 12 | Operating cash flow vs profit |
| Valuation | 8 | P/E, forward P/E (P/B for financials) |
| Momentum | 12 | 1Y return, 50/200-day averages |

Banks/NBFCs/insurers skip debt, liquidity and cash factors (borrowing is their business).
Tune weights and thresholds directly in `lib/analyze.js`.

## Notes
- Data source is Yahoo Finance via the unofficial `yahoo-finance2` package — no API key, but Yahoo can rate-limit or change its API. Keep `SCAN_CONCURRENCY` low (3).
- Full NSE scan ≈ 30–60 min on first run; US ≈ 2–3 h. Later runs use the cache.
- Symbols: NSE `TCS.NS`, BSE `500325.BO`, US `AAPL`.
- Nifty 50 list is hard-coded in `lib/universe.js`; update it when NSE rebalances.
- Scores are rules-based, not a guarantee of future price. Educational use only.
