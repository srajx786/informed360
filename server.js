import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
// Do NOT hard-import yahoo-finance2; we lazy-load it so the app never crashes
// import yahooFinance from "yahoo-finance2";
import fs from "fs";
import path from "path";

// -----------------------------------------------------------------------------
// App & static
// -----------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// -----------------------------------------------------------------------------
// Config & parser
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const domainFromUrl = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const extractImage = (item) => {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

const scoreSentiment = (text) => {
  const s =
    vader.SentimentIntensityAnalyzer.polarity_scores(text || "") || {
      pos: 0,
      neg: 0,
      neu: 1,
      compound: 0
    };
  const posP = Math.round((s.pos || 0) * 100);
  const negP = Math.round((s.neg || 0) * 100);
  const neuP = Math.max(0, 100 - posP - negP);
  const label =
    (s.compound ?? 0) >= 0.05
      ? "positive"
      : (s.compound ?? 0) <= -0.05
      ? "negative"
      : "neutral";
  return { ...s, posP, negP, neuP, label };
};

// polite concurrency per-host to avoid WAFs
const hostCounters = new Map();
const MAX_PER_HOST = 2;
const acquire = async (host) => {
  while ((hostCounters.get(host) || 0) >= MAX_PER_HOST) {
    await sleep(150);
  }
  hostCounters.set(host, (hostCounters.get(host) || 0) + 1);
};
const release = (host) =>
  hostCounters.set(host, Math.max(0, (hostCounters.get(host) || 1) - 1));

const withRetry = async (fn, tries = 2) => {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(300 + Math.random() * 600);
    }
  }
  throw lastErr;
};

async function fetchFeed(url) {
  const host = domainFromUrl(url);
  await acquire(host);
  try {
    return await withRetry(() => parser.parseURL(url), 2);
  } finally {
    release(host);
  }
}

function normalize(t = "") {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function topicKey(title) {
  const w = normalize(title).split(" ").filter(Boolean);
  const bi = [];
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i].length >= 3 && w[i + 1].length >= 3) bi.push(`${w[i]} ${w[i + 1]}`);
  }
  return bi.slice(0, 3).join(" | ") || w.slice(0, 3).join(" ");
}

function buildClusters(arts) {
  const map = new Map();
  for (const a of arts) {
    const k = topicKey(a.title);
    if (!k) continue;
    if (!map.has(k)) {
      map.set(k, {
        key: k,
        count: 0,
        pos: 0,
        neg: 0,
        neu: 0,
        sources: new Set(),
        image: a.image
      });
    }
    const c = map.get(k);
    c.count += 1;
    c.pos += a.sentiment.posP;
    c.neg += a.sentiment.negP;
    c.neu += a.sentiment.neuP;
    c.sources.add(a.source);
  }
  return [...map.values()]
    .map((c) => {
      const n = Math.max(1, c.count);
      return {
        title: c.key,
        count: c.count,
        sources: c.sources.size,
        sentiment: {
          pos: Math.round(c.pos / n),
          neg: Math.round(c.neg / n),
          neu: Math.round(c.neu / n)
        },
        image: c.image
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function uniqueMerge(core, extra) {
  const seen = new Set();
  const out = [];
  for (const a of [...core, ...extra]) {
    const key = a.link || a.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Caches: we keep core and experimental separately
// -----------------------------------------------------------------------------
let CORE = { fetchedAt: 0, articles: [], byUrl: new Map() };
let EXP  = { fetchedAt: 0, articles: [], byUrl: new Map() };

async function fetchList(urls) {
  const articles = [];
  const byUrl = new Map();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const feed = await fetchFeed(url);
        (feed.items || []).slice(0, 30).forEach((item) => {
          const link = item.link || item.guid || "";
          if (!link || byUrl.has(link)) return;

          const title = item.title || "";
          const source = feed.title || domainFromUrl(link);
          const description = item.contentSnippet || item.summary || "";
          const publishedAt =
            item.isoDate || item.pubDate || new Date().toISOString();
          const image = extractImage(item);
          const sentiment = scoreSentiment(`${title}. ${description}`);

          byUrl.set(link, true);
          articles.push({
            title,
            link,
            source,
            description,
            image,
            publishedAt,
            sentiment
          });
        });
      } catch (e) {
        const code = e?.statusCode
          ? `Status code ${e.statusCode}`
          : e?.code || e?.message || "Unknown";
        console.warn("[FEED ERR]", domainFromUrl(url), "->", code);
      }
    })
  );

  articles.sort(
    (a, b) => new Date(b.publishedAt).valueOf() - new Date(a.publishedAt).valueOf()
  );
  return { fetchedAt: Date.now(), articles, byUrl };
}

async function refreshCore() {
  CORE = await fetchList(FEEDS.feeds || []);
}
async function refreshExp() {
  EXP = await fetchList(FEEDS.experimental || []);
}

await refreshCore();
await refreshExp();
setInterval(refreshCore, REFRESH_MS);
setInterval(refreshExp, REFRESH_MS);

// -----------------------------------------------------------------------------
// Lazy ticker loader (safe if module is missing)
// -----------------------------------------------------------------------------
let yfModule = null;
async function loadYF() {
  try {
    if (yfModule) return yfModule;
    const mod = await import("yahoo-finance2");
    yfModule = mod?.default || mod;
    return yfModule;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------
// GET /api/news?limit=200&sentiment=positive|neutral|negative&experimental=1
app.get("/api/news", (req, res) => {
  const limit = Number(req.query.limit || 200);
  const sentiment = req.query.sentiment;
  const includeExp = req.query.experimental === "1";

  let arts = includeExp ? uniqueMerge(CORE.articles, EXP.articles) : CORE.articles;
  if (sentiment) arts = arts.filter((a) => a.sentiment?.label === sentiment);
  res.json({ fetchedAt: Date.now(), articles: arts.slice(0, limit) });
});

// GET /api/topics?experimental=1
app.get("/api/topics", (req, res) => {
  const includeExp = req.query.experimental === "1";
  const arts = includeExp ? uniqueMerge(CORE.articles, EXP.articles) : CORE.articles;
  res.json({ fetchedAt: Date.now(), topics: buildClusters(arts) });
});

// GET /api/pinned
app.get("/api/pinned", (req, res) => {
  const pins = (FEEDS.pinned || [])
    .map((u) => u && (CORE.byUrl.get(u) || EXP.byUrl.get(u)))
    .filter(Boolean)
    .slice(0, 3);
  res.json({ articles: pins });
});

// GET /api/ticker
app.get("/api/ticker", async (_req, res) => {
  try {
    const yf = await loadYF();
    if (!yf) return res.json({ updatedAt: Date.now(), quotes: [] });
    const symbols = ["^BSESN", "^NSEI", "^NYA"];
    const quotes = await yf.quote(symbols);
    const out = quotes.map((q) => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent
    }));
    res.json({ updatedAt: Date.now(), quotes: out });
  } catch {
    res.json({ updatedAt: Date.now(), quotes: [] });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, at: Date.now() });
});

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Informed360 running on :${PORT}`);
});
