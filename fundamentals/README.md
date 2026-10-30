# fundamentals/ – public company data (no portfolio data)
* `../fundamentals.json` – read by the app's stock sheet (הון עצמי למניה / P/B / Free Float / בטא). Written daily by `.github/workflows/fundamentals.yml` (`scripts/fetch-fundamentals.cjs`).
  Row = `[BVPS, balance-sheet date, filing date, 1=10-K 0=10-Q, shares outstanding, float shares, float as-of, float source (Y=Yahoo, S=SEC-derived), beta 5Y monthly]`.
* `state.json` – bookkeeping for the incremental run (which SEC filing each company is on, when it was last checked, last float refresh).
* Universe: every Nasdaq / NYSE / Cboe ticker in SEC's `company_tickers_exchange.json` – *not* the app user's holdings or watchlist. BVPS = (StockholdersEquity – preferred) / cover-page shares of the latest 10-Q/10-K; multi-class companies are summed from the filing's XBRL instance.
* SEC asks for a contact in the User-Agent: set the repository variable `SEC_UA` (Settings → Variables), e.g. `SavageTracker you@example.com`.
* Run by hand: Actions → fundamentals → Run workflow (optionally `only` = `META,TSLA` for a test that records nothing).
