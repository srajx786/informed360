// ---- Simple stocks endpoint (NSE NIFTY50 + BSE Sensex) ----
let _stocksCache = null;
let _stocksAt = 0;

app.get("/api/stocks", async (_req, res) => {
  try {
    // 60s cache
    if (_stocksCache && Date.now() - _stocksAt < 60_000) {
      return res.json(_stocksCache);
    }

    const symbols = ["^NSEI","^BSESN"];
    const url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
      symbols.map(encodeURIComponent).join(",");

    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("Quote fetch failed");
    const q = await r.json();
    const rows = q?.quoteResponse?.result || [];

    const bySym = Object.fromEntries(rows.map(o => [o.symbol, o]));
    const nse = bySym["^NSEI"]  || {};
    const bse = bySym["^BSESN"] || {};

    _stocksCache = {
      ok: true,
      nse: {
        price: nse.regularMarketPrice,
        change: nse.regularMarketChange,
        percent: nse.regularMarketChangePercent
      },
      bse: {
        price: bse.regularMarketPrice,
        change: bse.regularMarketChange,
        percent: bse.regularMarketChangePercent
      }
    };
    _stocksAt = Date.now();
    res.json(_stocksCache);
  } catch (e) {
    res.json({ ok:false, error: String(e?.message||e) });
  }
});
