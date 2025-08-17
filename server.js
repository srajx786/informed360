// server.js — works with/without rss-feeds.json; India-focused defaults

import express from "express";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import _ from "lodash";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const parser = new Parser({ timeout: 12000 });
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/* ---------- Bias & helpers ---------- */
const biasMap = {
  "pib.gov.in": "Center",
  "thehindu.com": "Lean Left",
  "hindustantimes.com": "Center",
  "indianexpress.com": "Lean Left",
  "ndtv.com": "Lean Left",
  "timesofindia.indiatimes.com": "Center",
  "economictimes.indiatimes.com": "Center",
  "livemint.com": "Center",
  "moneycontrol.com": "Center",
  "news.abplive.com": "Center",
  "espncricinfo.com": "Center",
  "reuters.com": "Center",
  "mongabay.com": "Center",
  "bollywoodhungama.com": "Entertainment"
};

const PREFERRED_DOMAINS = new Set([
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "timesofindia.indiatimes.com",
  "ndtv.com",
  "news.abplive.com"
]);

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function inferCategory(title, fallback = "general") {
  const t = (title || "").toLowerCase();
  if (/(ipl|cricket|football|kabaddi|t20|odi|score|wicket|innings|bcci)/i.test(t)) return "sports";
  if (/(bollywood|film|movie|trailer|actor|actress|ott|box office)/i.test(t)) return "entertainment";
  if (/(sensex|nifty|ipo|rbi|inflation|gdp|gst|rupee|budget|bank|stock|market|gold|crypto|finance)/i.test(t)) return "business";
  if (/(election|govt|parliament|minister|bjp|congress|aap|lok sabha|rajya sabha|bill|ordinance)/i.test(t)) return "politics";
  if (/(ai|startup|app|iphone|android|gadgets|semiconductor|chip|5g|6g|data center)/i.test(t)) return "tech";
  return fallback;
}

function biasPercentages(title, domain) {
  const bias = biasMap[domain] || "Unknown";
  let L = 0.33, C = 0.34, R = 0.33;
  if (bias === "Left") [L, C, R] = [0.70, 0.20, 0.10];
  if (bias === "Lean Left") [L, C, R] = [0.55, 0.30, 0.15];
  if (bias === "Center") [L, C, R] = [0.20, 0.60, 0.20];
  if (bias === "Lean Right") [L, C, R] = [0.15, 0.30, 0.55];
  if (bias === "Right") [L, C, R] = [0.10, 0.20, 0.70];

  const leftCues = /(climate|environment|equality|minority|rights|secular|labor|welfare|gender|lgbt|far-right|communal)/i;
  const rightCues = /(nationalism|border|illegal immigration|terror|law and order|heritage|tax cut|hindutva)/i;
  const t = (title || "").toLowerCase();
  if (leftCues.test(t)) { L += 0.08; C -= 0.04; R -= 0.04; }
  if (rightCues.test(t)) { R += 0.08; C -= 0.04; L -= 0.04; }
  const s = Math.max(0.0001, L + C + R);
  return { Left: L / s, Center: C / s, Right: R / s };
}

function absolutizeUrl(u, base) { try { return new URL(u, base).href; } catch { return u || null; } }
function firstImgFromHtml(html, base) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? absolutizeUrl(m[1], base) : null;
}

async function timedFetch(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

function pickImageFromItem(it, link) {
  const media = it["media:content"] || it["media:thumbnail"] || {};
  const enclosures = Array.isArray(it.enclosure) ? it.enclosure : [it.enclosure].filter(Boolean);
  const cands = [media.url, it.image?.url, it.thumbnail, it.enclosure?.url, ...enclosures.map(e => e?.url).filter(Boolean)].filter(Boolean);
  for (const u of cands) {
    const abs = absolutizeUrl(u, link);
    if (abs) return abs;
  }
  const htmlBlocks = [it["content:encoded"], it.content, it.contentSnippet, it.summary, it.description];
  for (const html of htmlBlocks) {
    const u = firstImgFromHtml(html, link);
    if (u) return u;
  }
  return null;
}

/* ---------- Default feeds if rss-feeds.json is missing ---------- */
const DEFAULT_FEEDS = [
  { id: "thehindu:front",        name: "The Hindu — Front Page",     url: "https://www.thehindu.com/feeder/default.rss",              policy: "HEADLINE_ONLY", category: "general" },
  { id: "indianexpress:india",   name: "Indian Express — India",      url: "https://indianexpress.com/section/india/feed/",            policy: "HEADLINE_ONLY", category: "politics" },
  { id: "hindustantimes:india",  name: "Hindustan Times — India",     url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml", policy: "HEADLINE_ONLY", category: "politics" },
  { id: "ndtv:top",              name: "NDTV — Top Stories",          url: "https://feeds.feedburner.com/ndtvnews-top-stories",        policy: "HEADLINE_ONLY", category: "general" },
  { id: "toi:top",               name: "Times of India — Top",        url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms",     policy: "HEADLINE_ONLY", category: "general" },
  { id: "et:default",            name: "Economic Times — All",        url: "https://economictimes.indiatimes.com/rssfeedsdefault.cms",         policy: "HEADLINE_ONLY", category: "business" },
  { id: "livemint:home",         name: "LiveMint — Home",             url: "https://www.livemint.com/rss/homepage",                    policy: "HEADLINE_ONLY", category: "business" },
  { id: "moneycontrol:latest",   name: "Moneycontrol — Latest",       url: "https://www.moneycontrol.com/rss/latestnews.xml",          policy: "HEADLINE_ONLY", category: "business" },
  { id: "abp:india",             name: "ABP Live — India",            url: "https://news.abplive.com/news/india/feed",                 policy: "HEADLINE_ONLY", category: "general" },
  { id: "espn:cricinfo",         name: "ESPNcricinfo — Cricket",      url: "https://www.espncricinfo.com/rss/content/story/feeds/0.xml", policy: "HEADLINE_ONLY", category: "sports" },
  { id: "bollywoodhungama:all",  name: "Bollywood Hungama",           url: "https://www.bollywoodhungama.com/rss.xml",                 policy: "HEADLINE_ONLY", category: "entertainment" },
  { id: "mongabay:india",        name: "Mongabay India",              url: "https://india.mongabay.com/feed/",                         policy: "CC_BY_ND",      category: "general" },
  { id: "reuters:in-top",        name: "Reuters India — Top",         url: "https://feeds.reuters.com/reuters/INtopNews",              policy: "HEADLINE_ONLY", category: "general" }
];

function loadFeeds() {
  try {
    const f = path.join(__dirname, "rss-feeds.json");
    if (fs.existsSync(f)) {
      const raw = fs.readFileSync(f, "utf8");
      const feeds = JSON.parse(raw.replace(/^\uFEFF/, "").trim());
      if (Array.isArray(feeds) && feeds.length) return feeds;
    }
  } catch (_) {}
  return DEFAULT_FEEDS;
}

/* ---------- Fetch & build articles ---------- */
async function fetchFeed(src) {
  const feed = await parser.parseURL(src.url);
  const items = feed.items || [];
  const out = [];
  for (const it of items.slice(0, 40)) {
    try {
      const link = String(it.link || "");
      const title = String(it.title || "");
      if (!link || !title) continue;

      const domain = domainFromUrl(link);
      const category = src.category || inferCategory(title, "general");

      let text = title;
      if (src.policy !== "HEADLINE_ONLY") {
        const snip = String(it.contentSnippet || it.summary || "");
        text = (title + ". " + snip).slice(0, 600);
      }
      const { compound } = vader.SentimentIntensityAnalyzer.polarity_scores(text);
      const sentiment = Math.max(-1, Math.min(1, compound));

      const image_url = pickImageFromItem(it, link);

      out.push({
        id: `${src.id}:${link}`,
        title,
        url: link,
        published_at: it.isoDate || it.pubDate || null,
        source_domain: domain,
        source_name: src.name,
        category,
        policy: src.policy,
        image_url,
        summary:
          (src.policy === "OPEN" || (src.policy || "").startsWith("CC_"))
            ? (it.contentSnippet || it.summary || null)
            : null,
        sentiment,
        bias_pct: biasPercentages(title, domain),
      });
    } catch (_) {}
  }
  return out;
}

function dedupe(articles) {
  const key = (t) =>
    _.deburr(String(t || "").toLowerCase())
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const m = new Map();
  for (const a of articles) {
    const k = key(a.title);
    if (!m.has(k)) m.set(k, a);
  }
  return [...m.values()];
}

async function getAllArticles() {
  const feeds = loadFeeds();
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const articles = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return dedupe(articles).sort((a, b) =>
    (b.published_at || "").localeCompare(a.published_at || "")
  );
}

/* ---------- API: news ---------- */
app.get("/api/news", async (_req, res) => {
  try {
    const all = await getAllArticles();
    if (!all.length) return res.json({ ok: true, generated_at: new Date().toISOString(), main: null, daily: [], items: [] });

    const cutoff = Date.now() - 12 * 60 * 60 * 1000; // trending window
    const recent = all.filter((a) => {
      const t = Date.parse(a.published_at || "");
      return isNaN(t) ? true : t >= cutoff;
    });

    const main = recent.find((a) => PREFERRED_DOMAINS.has(a.source_domain)) || recent[0] || all[0];

    const byCat = _.groupBy(recent.filter((a) => a.id !== main.id), "category");
    let daily = [
      ...(byCat.politics || []).slice(0, 2),
      ...(byCat.business || []).slice(0, 2),
      ...(byCat.sports || []).slice(0, 1),
      ...(byCat.entertainment || []).slice(0, 1),
    ];
    const seen = new Set();
    daily = daily.filter((a) => a && !seen.has(a.id) && seen.add(a.id)).slice(0, 10);
    if (daily.length < 5) {
      const used = new Set(daily.map((a) => a.id).concat([main.id]));
      daily = daily.concat(recent.filter((a) => !used.has(a.id)).slice(0, 5 - daily.length));
    }

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      main,
      daily,
      items: recent.slice(0, 80),
    });
  } catch (e) {
    console.error("NEWS API ERROR:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ---------- API: quick check your feeds ---------- */
app.get("/api/feeds", (_req, res) => {
  try {
    const feeds = loadFeeds();
    res.json({ ok: true, count: feeds.length, feeds });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

/* ---------- API: markets (Nifty, Sensex, USD/INR) ---------- */
let _marketsCache = null, _marketsAt = 0;
app.get("/api/markets", async (_req, res) => {
  try {
    if (_marketsCache && Date.now() - _marketsAt < 60_000) return res.json(_marketsCache);
    const symbols = ["^NSEI", "^BSESN", "INR=X"];
    const url =
      "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
      symbols.map(encodeURIComponent).join(",");
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("Quote fetch failed");
    const q = await r.json();
    const rows = q?.quoteResponse?.result || [];
    const by = Object.fromEntries(rows.map((o) => [o.symbol, o]));
    const pack = (o) => ({
      price: o?.regularMarketPrice,
      change: o?.regularMarketChange,
      percent: o?.regularMarketChangePercent,
    });
    _marketsCache = {
      ok: true,
      nifty: pack(by["^NSEI"]),
      sensex: pack(by["^BSESN"]),
      usdinr: pack(by["INR=X"]),
    };
    _marketsAt = Date.now();
    res.json(_marketsCache);
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

/* ---------- Image proxy ---------- */
app.get("/img", async (req, res) => {
  const u = req.query.u;
  if (!u) return res.status(400).send("Missing u");
  try {
    const r = await timedFetch(u, { headers: { "User-Agent": UA }, redirect: "follow" }, 10000);
    if (!r.ok) return res.status(502).send("Upstream image error");
    res.set("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch {
    res.status(500).send("Image proxy error");
  }
});

/* ---------- Health ---------- */
app.get("/healthz", (_req, res) => res.type("text").send("ok"));
app.get("/health", (_req, res) => res.type("text").send("ok"));

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`Informed360 listening on ${HOST}:${PORT}`));
