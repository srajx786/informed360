import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
// Lazy ticker import so missing dependency never crashes the app
// import yahooFinance from "yahoo-finance2";
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

const parser = new Parser({
  timeout: 15000,
  headers: {
    "user-agent":
      "Mozilla/5.0 (compatible; Informed360/1.0; +https://www.informed360.news)"
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const domainFromUrl = (u = "") => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

const extractImage = (item) => {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

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

/* ---------- Category inference (keyword + URL heuristics) ---------- */
const CAT_RULES = [
  { name: "sports", patterns: [/sport/i, /cricket/i, /ipl/i, /football/i, /badminton/i, /hockey/i] },
  { name: "business", patterns: [/business/i, /market/i, /econom/i, /stock/i, /sensex/i, /nifty/i, /finance/i, /industry/i] },
  { name: "technology", patterns: [/tech/i, /technology/i, /software/i, /ai\b/i, /startup/i, /gadget/i, /iphone/i, /android/i] },
  { name: "entertainment", patterns: [/entertainment/i, /bollywood/i, /movie/i, /film/i, /music/i, /celebrity/i, /tv\b/i, /web series/i] },
  { name: "science", patterns: [/science/i, /space/i, /isro/i, /nasa/i, /research/i, /study/i, /astronom/i, /quantum/i] },
  { name: "health", patterns: [/health/i, /covid/i, /virus/i, /disease/i, /medical/i, /hospital/i, /vaccine/i, /wellness/i] },
  { name: "world", patterns: [/world/i, /international/i, /\bUS\b/i, /china/i, /pakistan/i, /\buk\b/i, /europe/i, /russia/i, /africa/i, /global/i, /middle[- ]east/i] },
  { name: "india", patterns: [/india/i, /indian/i, /delhi/i, /mumbai/i, /bengaluru/i, /hyderabad/i, /chennai/i, /maharashtra/i, /uttar pradesh/i, /gujarat/i, /kolkata/i, /punjab/i] }
];
function inferCategory({ title = "", link = "", source = "" }) {
  const hay = `${title} ${link} ${source}`.toLowerCase();
  for (const r of CAT_RULES) {
    if (r.patterns.some((p) => p.test(hay))) return r.name;
  }
  // If domain is Indian (.in), default to India
  if (/\.(in)(\/|$)/i.test(link)) return "india";
  return "india"; // safe default for this site
}

/* ---------- polite concurrency + retry (avoid WAFs) ---------- */
const hostCounters = new Map();
const MAX_PER_HOST = 2;
const acquire = async (host) => {
  while ((hostCounters.get(host) || 0) >= MAX_PER_HOST) await sleep(150);
  hostCounters.set(host, (hostCounters.get(host) || 0) + 1);
};
const release = (host) => hostCounters.set(host, Math.max(0, (hostCounters.get(host) || 1) - 1));
const withRetry = async (fn, tries = 2) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(300 + Math.random() * 600); }
  }
  throw last;
};

async function fetchFeed(url) {
  const host = domainFromUrl(url);
  await acquire(host);
  try { return await withRetry(() => parser.parseURL(url), 2); }
  finally { release(host); }
}

/* ---------- fetch lists (core & experimental separately) ---------- */
async function fetchList(urls) {
  const articles = [];
  const byUrl = new Map();

  await Promise.all(urls.map(async (url) => {
    try {
      const feed = await fetchFeed(url);
      (feed.items || []).slice(0, 30).forEach((item) => {
        const link = item.link || item.guid || "";
        if (!link || byUrl.has(link)) return;

        const title = item.title || "";
        const source = feed.title || domainFromUrl(link);
        const description = item.contentSnippet || item.summary || "";
        const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
        const image = extractImage(item);
        const sentiment = scoreSentiment(`${title}. ${description}`);
        const category = inferCategory({ title, link, source });

        byUrl.set(link, true);
        articles.push({ title, link, source, description, image, publishedAt, sentiment, category });
      });
    } catch (e) {
      const msg = e?.statusCode ? `Status code ${e.statusCode}` : e?.code || e?.message || "Unknown";
      console.warn("[FEED ERR]", domainFromUrl(url), "->", msg);
    }
  }));

  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { fetchedAt: Date.now(), articles, byUrl };
}

let CORE = { fetchedAt: 0, articles: [], byUrl: new Map() };
let EXP  = { fetchedAt: 0, articles: [], byUrl: new Map() };
const uniqueMerge = (a, b) => {
  const seen = new Set(), out = [];
  for (const x of [...a, ...b]) {
    const k = x.link || x.title;
    if (seen.has(k)) continue;
    seen.add(k); out.push(x);
  }
  return out;
};

async function refreshCore(){ CORE = await fetchList(FEEDS.feeds || []); }
async function refreshExp(){  EXP  = await fetchList(FEEDS.experimental || []); }
await refreshCore(); await refreshExp();
setInterval(refreshCore, REFRESH_MS);
setInterval(refreshExp, REFRESH_MS);

/* ---------- lazy ticker loader ---------- */
let yfModule = null;
async function loadYF(){
  try {
    if (yfModule) return yfModule;
    const mod = await import("yahoo-finance2");
    yfModule = mod?.default || mod;
    return yfModule;
  } catch { return null; }
}

/* ---------- Routes ---------- */
// /api/news?limit=200&sentiment=positive|neutral|negative&category=sports|world|...&experimental=1
app.get("/api/news", (req, res) => {
  const limit = Number(req.query.limit || 200);
  const sentiment = req.query.sentiment;
  const category  = (req.query.category || "").toLowerCase(); // home => no filter
  const includeExp = req.query.experimental === "1";

  let arts = includeExp ? uniqueMerge(CORE.articles, EXP.articles) : CORE.articles;
  if (category && category !== "home") arts = arts.filter(a => a.category === category);
  if (sentiment) arts = arts.filter(a => a.sentiment?.label === sentiment);

  res.json({ fetchedAt: Date.now(), articles: arts.slice(0, limit) });
});

// /api/topics?experimental=1
const normalize = (t = "") => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const topicKey = (title) => {
  const w = normalize(title).split(" ").filter(Boolean);
  const bi = []; for (let i=0;i<w.length-1;i++) if (w[i].length>=3 && w[i+1].length>=3) bi.push(`${w[i]} ${w[i+1]}`);
  return bi.slice(0,3).join(" | ") || w.slice(0,3).join(" ");
};
function buildClusters(arts){
  const map = new Map();
  for (const a of arts) {
    const k = topicKey(a.title); if (!k) continue;
    if (!map.has(k)) map.set(k, { key:k, count:0, pos:0, neg:0, neu:0, sources:new Set(), image:a.image });
    const c = map.get(k);
    c.count++; c.pos+=a.sentiment.posP; c.neg+=a.sentiment.negP; c.neu+=a.sentiment.neuP; c.sources.add(a.source);
  }
  return [...map.values()].map(c=>{
    const n = Math.max(1,c.count);
    return { title:c.key, count:c.count, sources:c.sources.size,
      sentiment:{ pos:Math.round(c.pos/n), neg:Math.round(c.neg/n), neu:Math.round(c.neu/n) }, image:c.image };
  }).sort((a,b)=>b.count-a.count).slice(0,20);
}
app.get("/api/topics", (req,res)=>{
  const includeExp = req.query.experimental === "1";
  const arts = includeExp ? uniqueMerge(CORE.articles, EXP.articles) : CORE.articles;
  res.json({ fetchedAt: Date.now(), topics: buildClusters(arts) });
});

app.get("/api/pinned", (req,res)=>{
  const pins = (FEEDS.pinned || []).map(u => u && (CORE.byUrl.get(u) || EXP.byUrl.get(u))).filter(Boolean).slice(0,3);
  res.json({ articles: pins });
});

app.get("/api/ticker", async (_req, res) => {
  try {
    const yf = await loadYF();
    if (!yf) return res.json({ updatedAt: Date.now(), quotes: [] });
    const symbols = ["^BSESN","^NSEI","^NYA"];
    const quotes = await yf.quote(symbols);
    const out = quotes.map(q=>({
      symbol:q.symbol, shortName:q.shortName, price:q.regularMarketPrice,
      change:q.regularMarketChange, changePercent:q.regularMarketChangePercent
    }));
    res.json({ updatedAt: Date.now(), quotes: out });
  } catch {
    res.json({ updatedAt: Date.now(), quotes: [] });
  }
});

app.get("/health", (_req,res)=> res.json({ ok:true, at:Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Informed360 running on :${PORT}`));
