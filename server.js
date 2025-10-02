import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

const FEEDS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf-8")
);
const REFRESH_MS = Math.max(2, FEEDS.refreshMinutes || 10) * 60 * 1000;

/* RSS parser with stronger headers (reduces 403/timeout) */
const parser = new Parser({
  timeout: 15000,
  requestOptions: {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360Bot/1.0",
      "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
      "Referer": "https://www.informed360.news/"
    }
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const domainFromUrl = (u = "") => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};
const faviconForDomain = (d) => d ? `https://logo.clearbit.com/${d}` : "";

/* Sentiment */
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

/* Category inference */
const CAT_RULES = [
  { name: "sports", patterns: [/sport/i, /cricket/i, /ipl/i, /football/i, /badminton/i, /hockey/i] },
  { name: "business", patterns: [/business/i, /market/i, /econom/i, /stock/i, /sensex/i, /nifty/i, /finance/i, /industry/i] },
  { name: "technology", patterns: [/tech/i, /technology/i, /software/i, /ai\b/i, /startup/i, /gadget/i, /iphone/i, /android/i] },
  { name: "entertainment", patterns: [/entertainment/i, /bollywood/i, /movie/i, /film/i, /music/i, /celebrity/i, /\btv\b/i, /web series/i] },
  { name: "science", patterns: [/science/i, /space/i, /isro/i, /nasa/i, /research/i, /study/i, /astronom/i, /quantum/i] },
  { name: "health", patterns: [/health/i, /covid/i, /virus/i, /disease/i, /medical/i, /hospital/i, /vaccine/i, /wellness/i] },
  { name: "world", patterns: [/world/i, /international/i, /\bUS\b/i, /china/i, /pakistan/i, /\buk\b/i, /europe/i, /russia/i, /africa/i, /global/i, /middle[- ]east/i] },
  { name: "india", patterns: [/india/i, /indian/i, /delhi/i, /mumbai/i, /bengaluru/i, /hyderabad/i, /chennai/i, /kolkata/i, /maharashtra/i, /uttar pradesh/i, /gujarat/i, /punjab/i] }
];
function inferCategory({ title = "", link = "", source = "" }) {
  const hay = `${title} ${link} ${source}`.toLowerCase();
  for (const r of CAT_RULES) if (r.patterns.some((p) => p.test(hay))) return r.name;
  if (/\.(in)(\/|$)/i.test(link)) return "india";
  return "india";
}

/* Image extraction */
const extractImage = (item) => {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

/* Polite per-host concurrency */
const hostCounters = new Map();
const MAX_PER_HOST = 2;
const acquire = async (host) => {
  while ((hostCounters.get(host) || 0) >= MAX_PER_HOST) await sleep(150);
  hostCounters.set(host, (hostCounters.get(host) || 0) + 1);
};
const release = (host) => hostCounters.set(host, Math.max(0, (hostCounters.get(host) || 1) - 1));

async function parseURL(u){ return parser.parseURL(u); }

/* Google News helpers */
const gNewsSearch = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
const gNewsForDomain = (domain) =>
  `https://news.google.com/rss/search?q=site:${encodeURIComponent(domain)}&hl=en-IN&gl=IN&ceid=IN:en`;

async function fetchDirect(url) {
  const host = domainFromUrl(url);
  await acquire(host);
  try { return await parseURL(url); }
  finally { release(host); }
}

/* Fetch with fallback to Google News site:domain */
async function fetchWithFallback(url) {
  const domain = domainFromUrl(url);
  try {
    const feed = await fetchDirect(url);
    if (feed?.items?.length) return feed;
    const g = await parseURL(gNewsForDomain(domain));
    g.title = g.title || domain;
    return g;
  } catch (e) {
    try {
      const g = await parseURL(gNewsForDomain(domain));
      g.title = g.title || domain;
      console.warn("[FEED Fallback]", domain, "-> Google News RSS");
      return g;
    } catch (e2) {
      const msg = e?.statusCode ? `Status ${e.statusCode}` : (e?.code || e?.message || "Unknown");
      console.warn("[FEED ERR]", domain, "->", msg);
      return { title: domain, items: [] };
    }
  }
}

/* Fetch core lists */
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
      articles.push({ title, link, source, sourceIcon, description, image, publishedAt, sentiment, category });
    });
  }));

  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { fetchedAt: Date.now(), articles };
}

let CORE = { fetchedAt: 0, articles: [] };
let EXP  = { fetchedAt: 0, articles: [] };
const uniqueMerge = (a, b) => {
  const set = new Set(); const out = [];
  for (const x of [...a, ...b]) {
    const k = x.link || x.title; if (set.has(k)) continue;
    set.add(k); out.push(x);
  }
  return out;
};

async function refreshCore(){ CORE = await fetchList(FEEDS.feeds || []); }
async function refreshExp(){  EXP  = await fetchList(FEEDS.experimental || []); }
await refreshCore(); await refreshExp();
setInterval(refreshCore, REFRESH_MS);
setInterval(refreshExp, REFRESH_MS);

/* ---------- Google Trends (India) → build trending topics ---------- */
async function fetchGoogleTrendsIN(limit = 8) {
  // Daily trending searches RSS for India
  const url = "https://trends.google.com/trends/trendingsearches/daily/rss?geo=IN";
  try {
    const feed = await parseURL(url);
    // Each item.title = query
    const queries = (feed.items || []).map(i => i.title).filter(Boolean);
    return queries.slice(0, limit);
  } catch (e) {
    console.warn("[Trends ERR]", e?.message || e);
    return [];
  }
}

async function buildTrendingFromTrends(limit = 8) {
  const queries = await fetchGoogleTrendsIN(limit);
  if (!queries.length) return [];

  // Fetch 4–5 news items per query from Google News
  const results = await Promise.all(
    queries.map(async (q) => {
      try { return await parseURL(gNewsSearch(q)); }
      catch { return { items: [] }; }
    })
  );

  const topics = results.map((feed, idx) => {
    const q = queries[idx];
    const items = (feed.items || []).slice(0, 6);
    let pos = 0, neg = 0, neu = 0, count = 0;
    const domains = new Set();
    let image = "";

    for (const it of items) {
      const t = it.title || "";
      const d = it.contentSnippet || it.summary || "";
      const s = scoreSentiment(`${t}. ${d}`);
      pos += s.posP; neg += s.negP; neu += s.neuP; count++;
      const dm = domainFromUrl(it.link || "");
      if (dm) domains.add(dm);
      if (!image) image = extractImage(it);
    }

    if (!count) {
      return { title: q, count: 0, sources: 0, sentiment: { pos: 0, neu: 100, neg: 0 }, icons: [], image: "" };
    }
    const avg = {
      pos: Math.round(pos / count),
      neu: Math.round(neu / count),
      neg: Math.round(neg / count)
    };
    const icons = [...domains].slice(0, 4).map(faviconForDomain);
    return { title: q, count, sources: domains.size, sentiment: avg, icons, image };
  });

  return topics;
}

/* ---------- Endpoints ---------- */
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

app.get("/api/topics", async (req,res)=>{
  try {
    // Prefer Google Trends-driven topics
    const topics = await buildTrendingFromTrends(8);
    if (topics.length) return res.json({ fetchedAt: Date.now(), topics });
  } catch {}
  // Fallback: simple clustering over current articles
  const arts = CORE.articles;
  const normalize = (t = "") => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const topicKey = (title) => {
    const w = normalize(title).split(" ").filter(Boolean);
    const bi = []; for (let i=0;i<w.length-1;i++) if (w[i].length>=3 && w[i+1].length>=3) bi.push(`${w[i]} ${w[i+1]}`);
    return bi.slice(0,3).join(" | ") || w.slice(0,3).join(" ");
  };
  const map = new Map();
  for (const a of arts) {
    const k = topicKey(a.title); if (!k) continue;
    if (!map.has(k)) map.set(k, { key:k, count:0, pos:0, neg:0, neu:0, sources:new Set(), icons:new Set() });
    const c = map.get(k);
    c.count++; c.pos+=a.sentiment.posP; c.neg+=a.sentiment.negP; c.neu+=a.sentiment.neuP;
    const dm = domainFromUrl(a.link || ""); if (dm) { c.sources.add(dm); c.icons.add(faviconForDomain(dm)); }
  }
  const topics = [...map.values()].map(c=>{
    const n = Math.max(1,c.count);
    return { title:c.key, count:c.count, sources:c.sources.size,
      sentiment:{ pos:Math.round(c.pos/n), neg:Math.round(c.neg/n), neu:Math.round(c.neu/n) },
      icons:[...c.icons].slice(0,4) };
  }).sort((a,b)=>b.count-a.count).slice(0,8);
  res.json({ fetchedAt: Date.now(), topics });
});

app.get("/api/pinned", (_req,res)=>{
  res.json({ articles: CORE.articles.slice(0,3) });
});

/* Markets endpoint (unchanged) */
let yfModule = null;
async function loadYF(){
  try { if (yfModule) return yfModule; const mod = await import("yahoo-finance2"); yfModule = mod?.default || mod; return yfModule; }
  catch { return null; }
}
app.get("/api/markets", async (_req, res) => {
  try {
    const yf = await loadYF();
    const symbols = [
      { s: "^BSESN", pretty: "BSE Sensex" },
      { s: "^NSEI",  pretty: "NSE Nifty" },
      { s: "GC=F",   pretty: "Gold" },
      { s: "CL=F",   pretty: "Crude Oil" },
      { s: "USDINR=X", pretty: "USD/INR" }
    ];
    if (!yf) return res.json({ updatedAt: Date.now(), quotes: symbols.map(x => ({ symbol:x.s, pretty:x.pretty, price:null, change:null, changePercent:null })) });
    const quotes = await yf.quote(symbols.map(x => x.s));
    const out = quotes.map((q, i) => ({
      symbol: q.symbol, pretty: symbols[i].pretty,
      price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent
    }));
    res.json({ updatedAt: Date.now(), quotes: out });
  } catch { res.json({ updatedAt: Date.now(), quotes: [] }); }
});

app.get("/health", (_req,res)=> res.json({ ok:true, at:Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Informed360 running on :${PORT}`));
