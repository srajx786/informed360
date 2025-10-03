import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vaderCjs from "vader-sentiment";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

/* ---------- Static & Config ---------- */
const __dirname = path.resolve();
const PUBLIC_DIR = path.join(__dirname, "public");
const FEEDS_PATH = path.join(__dirname, "rss-feeds.json");

app.use(express.static(PUBLIC_DIR));

if (!fs.existsSync(FEEDS_PATH)) {
  console.error("[BOOT] rss-feeds.json not found at", FEEDS_PATH);
  process.exit(1);
}

const FEEDS = JSON.parse(fs.readFileSync(FEEDS_PATH, "utf-8"));
const REFRESH_MS = Math.max(2, FEEDS.refreshMinutes || 10) * 60 * 1000;

/* ---------- RSS Parser (resilient) ---------- */
const parser = new Parser({
  timeout: 15000,
  requestOptions: {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360/1.0",
      "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
      "Referer": "https://www.informed360.news/"
    }
  }
});
const parseURL = async (u) => parser.parseURL(u);

/* ---------- Helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const domainFromUrl = (u = "") => {
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch { return ""; }
};
const faviconForDomain = (d) => (d ? `https://logo.clearbit.com/${d}` : "");

/* Gentle per-host concurrency (avoid hammering one origin) */
const hostCounters = new Map();
const MAX_PER_HOST = 2;
const acquire = async (host) => {
  while ((hostCounters.get(host) || 0) >= MAX_PER_HOST) await sleep(150);
  hostCounters.set(host, (hostCounters.get(host) || 0) + 1);
};
const release = (host) =>
  hostCounters.set(host, Math.max(0, (hostCounters.get(host) || 1) - 1));

/* ---------- VADER (CJS compat) ---------- */
const vader =
  vaderCjs?.SentimentIntensityAnalyzer ? vaderCjs : (vaderCjs?.default || vaderCjs);

const scoreSentiment = (text) => {
  const s = vader.SentimentIntensityAnalyzer.polarity_scores(text || "") || {
    pos: 0, neg: 0, neu: 1, compound: 0
  };
  const posP = Math.round((s.pos || 0) * 100);
  const negP = Math.round((s.neg || 0) * 100);
  const neuP = Math.max(0, 100 - posP - negP);
  const label =
    (s.compound ?? 0) >= 0.05 ? "positive" :
    (s.compound ?? 0) <= -0.05 ? "negative" : "neutral";
  return { ...s, posP, negP, neuP, label };
};

/* ---------- Category inference (simple rules) ---------- */
const CAT_RULES = [
  { name: "sports", patterns: [/sport/i, /cricket/i, /ipl/i, /football/i, /hockey/i] },
  { name: "business", patterns: [/business/i, /econom/i, /market/i, /stock/i, /sensex/i, /nifty/i, /finance/i] },
  { name: "technology", patterns: [/tech/i, /technology/i, /software/i, /\bai\b/i, /gadget/i] },
  { name: "entertainment", patterns: [/entertainment/i, /bollywood/i, /movie/i, /film/i, /music/i, /\btv\b/i] },
  { name: "science", patterns: [/science/i, /space/i, /isro/i, /nasa/i, /research/i, /study/i, /astro/i] },
  { name: "health", patterns: [/health/i, /covid/i, /virus/i, /medical/i, /hospital/i, /vaccine/i] },
  { name: "world", patterns: [/world/i, /international/i, /\bUS\b/i, /china/i, /pakistan/i, /\buk\b/i, /europe/i, /russia/i, /middle[- ]east/i] },
  { name: "india", patterns: [/india/i, /indian/i, /delhi/i, /mumbai/i, /bengaluru/i, /hyderabad/i, /chennai/i, /kolkata/i, /maharashtra/i] }
];
function inferCategory({ title = "", link = "", source = "" }) {
  const hay = `${title} ${link} ${source}`.toLowerCase();
  for (const r of CAT_RULES) {
    if (r.patterns.some((p) => p.test(hay))) return r.name;
  }
  if (/\.(in)(\/|$)/i.test(link)) return "india";
  return "india";
}

/* ---------- Image extraction ---------- */
const extractImage = (item) => {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

/* ---------- Google News helpers ---------- */
const gNewsSearch = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
const gNewsForDomain = (domain) =>
  `https://news.google.com/rss/search?q=site:${encodeURIComponent(domain)}&hl=en-IN&gl=IN&ceid=IN:en`;

/* Try direct RSS, then fall back to a Google News site: query */
async function fetchDirect(url) {
  const host = domainFromUrl(url);
  await acquire(host);
  try { return await parseURL(url); }
  finally { release(host); }
}
async function fetchWithFallback(url) {
  const domain = domainFromUrl(url);
  try {
    const feed = await fetchDirect(url);
    if (feed?.items?.length) return feed;
    const g = await parseURL(gNewsForDomain(domain));
    g.title = g.title || domain;
    return g;
  } catch {
    try {
      const g = await parseURL(gNewsForDomain(domain));
      g.title = g.title || domain;
      console.warn("[FEED Fallback]", domain, "-> Google News RSS");
      return g;
    } catch (e2) {
      console.warn("[FEED ERR]", domain, "->", e2?.message || e2);
      return { title: domain, items: [] };
    }
  }
}

/* ---------- Build general news list from rss-feeds.json ---------- */
async function fetchList(urls) {
  const articles = [];
  const seen = new Set();

  await Promise.all(urls.map(async (url) => {
    const domain = domainFromUrl(url);
    const feed = await fetchWithFallback(url);

    (feed.items || []).slice(0, 30).forEach((item) => {
      const link = item.link || item.guid || "";
      if (!link || seen.has(link)) return;

      const title = item.title || "";
      const source = item.source?.title || feed.title || domain;
      const description = item.contentSnippet || item.summary || "";
      const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
      const image = extractImage(item);
      const sentiment = scoreSentiment(`${title}. ${description}`);
      const category = inferCategory({ title, link, source });
      const sdom = domainFromUrl(link);
      const sourceIcon = faviconForDomain(sdom);

      seen.add(link);
      articles.push({
        title, link, source, sourceIcon, description,
        image, publishedAt, sentiment, category
      });
    });
  }));

  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { fetchedAt: Date.now(), articles };
}

/* ---------- Caches for core & experimental feeds ---------- */
let CORE = { fetchedAt: 0, articles: [] };
let EXP  = { fetchedAt: 0, articles: [] };

const uniqueMerge = (a, b) => {
  const set = new Set(); const out = [];
  for (const x of [...a, ...b]) {
    const k = x.link || x.title;
    if (set.has(k)) continue;
    set.add(k); out.push(x);
  }
  return out;
};

async function refreshCore(){ CORE = await fetchList(FEEDS.feeds || []); }
async function refreshExp(){  EXP  = await fetchList(FEEDS.experimental || []); }

await refreshCore();
await refreshExp();
setInterval(refreshCore, REFRESH_MS);
setInterval(refreshExp, REFRESH_MS);

/* ---------- Google Trends (India) → Trending Topics ---------- */
/* Daily trending searches RSS (maps to trends UI you shared) */
async function fetchGoogleTrendsIN(limit = 8) {
  const url = "https://trends.google.com/trends/trendingsearches/daily/rss?geo=IN";
  try {
    const feed = await parseURL(url);
    const queries = (feed.items || []).map(i => i.title).filter(Boolean);
    return queries.slice(0, limit);
  } catch (e) {
    console.warn("[Trends ERR]", e?.message || e);
    return [];
  }
}

/* For each trend:
   - Fetch Google News RSS for the query
   - Compute VADER per article
   - Aggregate per source (equal-weight averaging)
   - Then overall = mean of per-source percentages
*/
async function buildTrendingFromTrends(limit = 8) {
  const queries = await fetchGoogleTrendsIN(limit);
  if (!queries.length) return [];

  const results = await Promise.all(
    queries.map(async (q) => {
      try { return await parseURL(gNewsSearch(q)); }
      catch { return { items: [] }; }
    })
  );

  const topics = results.map((feed, idx) => {
    const q = queries[idx];
    const items = (feed.items || []).slice(0, 12);

    const perSource = new Map(); // domain -> {count, pos, neu, neg}
    let totalArticles = 0;

    for (const it of items) {
      const title = it.title || "";
      const desc = it.contentSnippet || it.summary || "";
      const s = scoreSentiment(`${title}. ${desc}`);

      const dm = domainFromUrl(it.link || "");
      if (!dm) continue;

      if (!perSource.has(dm)) perSource.set(dm, { count:0, pos:0, neu:0, neg:0 });
      const p = perSource.get(dm);
      p.count += 1; p.pos += s.posP; p.neu += s.neuP; p.neg += s.negP;
      totalArticles += 1;
    }

    // Average per source
    const breakdown = [];
    for (const [dm, v] of perSource.entries()) {
      const n = Math.max(1, v.count);
      breakdown.push({
        domain: dm,
        articles: v.count,
        pos: Math.round(v.pos / n),
        neu: Math.round(v.neu / n),
        neg: Math.round(v.neg / n),
        icon: faviconForDomain(dm)
      });
    }

    // Overall = mean of per-source percentages (equal weight)
    let pos=0, neu=0, neg=0;
    const N = Math.max(1, breakdown.length);
    breakdown.forEach(b => { pos += b.pos; neu += b.neu; neg += b.neg; });
    const overall = { pos: Math.round(pos/N), neu: Math.round(neu/N), neg: Math.round(neg/N) };

    const icons = breakdown.slice(0,4).map(b => b.icon).filter(Boolean);
    const explain = `Trend: “${q}”. Articles pulled from Google News across ${breakdown.length} sources. `
      + `We run VADER on each article (title + snippet) → average per source → average across sources equally.`;

    return {
      title: q,
      count: totalArticles,
      sources: breakdown.length,
      sentiment: overall,
      icons,
      breakdown, // for UI tooltip list
      explain
    };
  });

  return topics;
}

/* ---------- Markets (BSE/NSE/Gold/Oil/USDINR) ---------- */
/* Optional dependency; we won’t crash if it’s unavailable. */
let yfModule = null;
async function loadYF(){
  try {
    if (yfModule) return yfModule;
    const mod = await import("yahoo-finance2"); // ESM-aware
    yfModule = mod?.default || mod;
    return yfModule;
  } catch (e) {
    console.warn("[MARKETS] yahoo-finance2 not available:", e?.message || e);
    return null;
  }
}

/* ---------- API Routes ---------- */
app.get("/api/news", (req, res) => {
  const limit = Number(req.query.limit || 200);
  const sentiment = req.query.sentiment;
  const category  = (req.query.category || "").toLowerCase();
  const includeExp = req.query.experimental === "1";

  let arts = includeExp ? uniqueMerge(CORE.articles, EXP.articles) : CORE.articles;
  if (category && category !== "home") arts = arts.filter(a => a.category === category);
  if (sentiment) arts = arts.filter(a => a.sentiment?.label === sentiment);

  res.json({ fetchedAt: Date.now(), articles: arts.slice(0, limit) });
});

app.get("/api/topics", async (_req,res)=>{
  try {
    const topics = await buildTrendingFromTrends(8);
    return res.json({ fetchedAt: Date.now(), topics });
  } catch (e) {
    console.warn("[/api/topics]", e?.message || e);
    res.json({ fetchedAt: Date.now(), topics: [] });
  }
});

app.get("/api/markets", async (_req, res) => {
  try {
    const yf = await loadYF();
    const symbols = [
      { s: "^BSESN",    pretty: "BSE Sensex" },
      { s: "^NSEI",     pretty: "NSE Nifty" },
      { s: "GC=F",      pretty: "Gold" },
      { s: "CL=F",      pretty: "Crude Oil" },
      { s: "USDINR=X",  pretty: "USD/INR" }
    ];

    if (!yf) {
      return res.json({
        updatedAt: Date.now(),
        quotes: symbols.map(x => ({
          symbol: x.s, pretty: x.pretty, price: null, change: null, changePercent: null
        }))
      });
    }

    const quotes = await yf.quote(symbols.map(x => x.s));
    const out = quotes.map((q, i) => ({
      symbol: q.symbol,
      pretty: symbols[i].pretty,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent
    }));

    res.json({ updatedAt: Date.now(), quotes: out });
  } catch (e) {
    console.warn("[/api/markets]", e?.message || e);
    res.json({ updatedAt: Date.now(), quotes: [] });
  }
});

app.get("/health", (_req,res)=> res.json({ ok:true, at:Date.now() }));

/* ---------- Boot ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Informed360 server started on http://localhost:${PORT}`);
});
