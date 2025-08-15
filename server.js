// server.js  — no jsdom, fast & resilient

import express from "express";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import _ from "lodash";
import path from "path";
import { fileURLToPath } from "url";

// ----- ESM-safe dirname -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- App / static -----
const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ----- Config -----
const parser = new Parser({ timeout: 12000 });
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

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
  "sportstar.thehindu.com": "Center",
  "espncricinfo.com": "Center",
};

const PREFERRED_DOMAINS = new Set([
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "timesofindia.indiatimes.com",
  "ndtv.com",
  "news.abplive.com",
]);

// -------- utilities --------
function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

function inferCategory(title, fallback = "general") {
  const t = (title || "").toLowerCase();
  if (/(ipl|cricket|football|kabaddi|t20|odi|score|wicket)/i.test(t)) return "sports";
  if (/(bollywood|film|movie|trailer|actor|actress|ott)/i.test(t)) return "entertainment";
  if (/(sensex|nifty|ipo|rbi|inflation|gdp|gst|rupee|budget|bank|stock|market|gold|crypto|finance)/i.test(t)) return "business";
  if (/(election|govt|parliament|minister|bjp|congress|aap|lok sabha|rajya sabha|bill|ordinance)/i.test(t)) return "politics";
  if (/(ai|startup|app|iphone|android|gadgets|semiconductor|chip|5g|6g|data center)/i.test(t)) return "tech";
  return fallback;
}

function biasPercentages(title, domain) {
  const bias = biasMap[domain] || "Unknown";
  let L = 0.33, C = 0.34, R = 0.33;
  if (bias === "Left")       [L, C, R] = [0.70, 0.20, 0.10];
  if (bias === "Lean Left")  [L, C, R] = [0.55, 0.30, 0.15];
  if (bias === "Center")     [L, C, R] = [0.20, 0.60, 0.20];
  if (bias === "Lean Right") [L, C, R] = [0.15, 0.30, 0.55];
  if (bias === "Right")      [L, C, R] = [0.10, 0.20, 0.70];

  const leftCues  = /(climate|environment|equality|minority|rights|secular|labor|welfare|gender|lgbt|far-right|communal)/i;
  const rightCues = /(nationalism|border|illegal immigration|terror|law and order|heritage|tax cut|hindutva)/i;
  const t = (title || "").toLowerCase();
  if (leftCues.test(t))  { L += 0.08; C -= 0.04; R -= 0.04; }
  if (rightCues.test(t)) { R += 0.08; C -= 0.04; L -= 0.04; }

  const s = Math.max(0.0001, L + C + R);
  return { Left: L / s, Center: C / s, Right: R / s };
}

function absolutizeUrl(src, pageUrl) {
  try { return new URL(src, pageUrl).href; } catch { return src || null; }
}

function firstImgFromHtml(html, pageUrl) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? absolutizeUrl(m[1], pageUrl) : null;
}

function extractOgImage(html, pageUrl) {
  if (!html) return null;
  const tests = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const re of tests) {
    const m = html.match(re);
    if (m) return absolutizeUrl(m[1], pageUrl);
  }
  return null;
}

async function timedFetch(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ----- image selection from RSS/HTML + OG (regex only) -----
function pickImageFromItem(it, link) {
  const media = it["media:content"] || it["media:thumbnail"] || {};
  const enclosures = Array.isArray(it.enclosure) ? it.enclosure : [it.enclosure].filter(Boolean);
  const cands = [
    media.url,
    it.image?.url,
    it.thumbnail,
    it.enclosure?.url,
    ...enclosures.map(e => e?.url).filter(Boolean),
  ].filter(Boolean);
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

async function fetchOgImage(link) {
  try {
    const r = await timedFetch(link, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    }, 8000);
    if (!r.ok) return null;
    const html = await r.text();
    return extractOgImage(html, link);
  } catch {
    return null;
  }
}

// ----- fetch one feed -----
async function fetchFeed(src) {
  const feed = await parser.parseURL(src.url);
  const items = feed.items || [];
  const out = [];

  for (const it of items.slice(0, 30)) {
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

      let image_url = pickImageFromItem(it, link);
      if (!image_url) image_url = await fetchOgImage(link);

      out.push({
        id: `${src.id}:${link}`,
        title,
        url: link,
        published_at: it.isoDate || it.pubDate || null,
        source_domain: domain,
        source_name: src.name,
        category,
        policy: src.policy,
        image_url, // may be null; client will fallback to favicon
        summary: (src.policy === "OPEN" || (src.policy || "").startsWith("CC_"))
          ? (it.contentSnippet || it.summary || null) : null,
        sentiment,
        bias_pct: biasPercentages(title, domain),
      });
    } catch (e) {
      console.warn("Item parse error:", e?.message || e);
    }
  }
  return out;
}

function dedupe(articles) {
  const key = (t) =>
    _.deburr(String(t || "").toLowerCase()).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const m = new Map();
  for (const a of articles) {
    const k = key(a.title);
    if (!m.has(k)) m.set(k, a);
  }
  return [...m.values()];
}

async function getAllArticles() {
  const raw = fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf8");
  const feeds = JSON.parse(raw.replace(/^\uFEFF/, "").trim());
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const articles = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return dedupe(articles).sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
}

// ----- API: news -----
app.get("/api/news", async (_req, res) => {
  try {
    const all = await getAllArticles();
    if (!all.length) return res.json({ ok: true, generated_at: new Date().toISOString(), main: null, daily: [] });

    const main = all.find((a) => PREFERRED_DOMAINS.has(a.source_domain)) || all[0];

    const byCat = _.groupBy(all.filter((a) => a.id !== main.id), "category");
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
      daily = daily.concat(all.filter((a) => !used.has(a.id)).slice(0, 5 - daily.length));
    }

    res.json({ ok: true, generated_at: new Date().toISOString(), main, daily });
  } catch (e) {
    console.error("NEWS API ERROR:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----- API: stocks (NSE NIFTY50 + BSE Sensex) -----
let _stocksCache = null;
let _stocksAt = 0;

app.get("/api/stocks", async (_req, res) => {
  try {
    if (_stocksCache && Date.now() - _stocksAt < 60_000) {
      return res.json(_stocksCache);
    }
    const symbols = ["^NSEI", "^BSESN"];
    const url =
      "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
      symbols.map(encodeURIComponent).join(",");

    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("Quote fetch failed");
    const q = await r.json();
    const rows = q?.quoteResponse?.result || [];
    const bySym = Object.fromEntries(rows.map((o) => [o.symbol, o]));
    const nse = bySym["^NSEI"] || {};
    const bse = bySym["^BSESN"] || {};

    _stocksCache = {
      ok: true,
      nse: {
        price: nse.regularMarketPrice,
        change: nse.regularMarketChange,
        percent: nse.regularMarketChangePercent,
      },
      bse: {
        price: bse.regularMarketPrice,
        change: bse.regularMarketChange,
        percent: bse.regularMarketChangePercent,
      },
    };
    _stocksAt = Date.now();
    res.json(_stocksCache);
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ----- health -----
app.get("/healthz", (_req, res) => res.type("text").send("ok"));
app.get("/health", (_req, res) => res.type("text").send("ok"));

// ----- image proxy (so http images load on https) -----
app.get("/img", async (req, res) => {
  const u = req.query.u;
  if (!u) return res.status(400).send("Missing u");
  try {
    const r = await timedFetch(u, { headers: { "User-Agent": UA }, redirect: "follow" }, 10000);
    if (!r.ok) return res.status(502).send("Upstream image error");
    const type = r.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", type);
    res.set("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch {
    res.status(500).send("Image proxy error");
  }
});

// ----- start -----
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`Informed360 listening on ${HOST}:${PORT}`));
