import express from "express";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import _ from "lodash";
import path from "path";
import { fileURLToPath } from "url";

// ---- ESM-safe __dirname -----------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- App & static files -----------------------------------------------------
const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ---- Config / helpers -------------------------------------------------------
const parser = new Parser({ timeout: 15000 });

// Simple outlet bias map (tweak if you like)
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
  "espncricinfo.com": "Center"
};

// India-only allowlist (keeps the site focused and avoids legal issues)
const ALLOWED_DOMAINS = new Set(Object.keys(biasMap));

// Prefer these for the main story slot (big brands)
const PREFERRED_DOMAINS = new Set([
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "timesofindia.indiatimes.com",
  "ndtv.com",
  "news.abplive.com"
]);

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

function inferCategory(title, fallback = "general") {
  const t = (title || "").toLowerCase();
  if (/(ipl|cricket|football|kabaddi|match|t20|odi|score|wicket|innings|bcci|series)/i.test(t)) return "sports";
  if (/(bollywood|film|movie|box office|trailer|actor|actress|ott|bigg boss)/i.test(t)) return "entertainment";
  if (/(sensex|nifty|ipo|rbi|inflation|gdp|gst|rupee|budget|bank|mutual fund|stock|market|bond|yield|gold|crypto|finance)/i.test(t)) return "business";
  if (/(election|govt|government|parliament|minister|ministry|bjp|congress|aap|lok sabha|rajya sabha|bill|ordinance)/i.test(t)) return "politics";
  if (/(ai|startup|app|iphone|android|gadgets|semiconductor|chip|5g|6g|data center)/i.test(t)) return "tech";
  return fallback;
}

function biasPercentages(title, domain) {
  const bias = biasMap[domain] || "Unknown";
  let L = 0.33, C = 0.34, R = 0.33;
  if (bias === "Left")        [L, C, R] = [0.70, 0.20, 0.10];
  if (bias === "Lean Left")   [L, C, R] = [0.55, 0.30, 0.15];
  if (bias === "Center")      [L, C, R] = [0.20, 0.60, 0.20];
  if (bias === "Lean Right")  [L, C, R] = [0.15, 0.30, 0.55];
  if (bias === "Right")       [L, C, R] = [0.10, 0.20, 0.70];

  // small headline cue nudges
  const leftCues  = /(climate|environment|equality|minority|rights|secular|labor|welfare|gender|lgbt|far-right|communal)/i;
  const rightCues = /(nationalism|border|illegal immigration|terror|law and order|heritage|tax cut|hindutva)/i;
  const t = (title || "").toLowerCase();
  if (leftCues.test(t))  { L += 0.08; C -= 0.04; R -= 0.04; }
  if (rightCues.test(t)) { R += 0.08; C -= 0.04; L -= 0.04; }

  const s = Math.max(0.0001, L + C + R);
  return { Left: L / s, Center: C / s, Right: R / s };
}

async function fetchFeed(src) {
  const feed = await parser.parseURL(src.url);
  const items = feed.items || [];
  const out = [];

  for (const it of items.slice(0, 30)) {
    const link  = String(it.link || "");
    const title = String(it.title || "");
    if (!link || !title) continue;

    const domain = domainFromUrl(link);
    if (!ALLOWED_DOMAINS.has(domain)) continue; // India-only

    const category = src.category || inferCategory(title, "general");

    // Sentiment: title only for HEADLINE_ONLY; title+snippet when allowed
    let textForSent = title;
    if (src.policy !== "HEADLINE_ONLY") {
      const snippet = String(it.contentSnippet || it.summary || "");
      textForSent = (title + ". " + snippet).slice(0, 600);
    }
    const { compound } = vader.SentimentIntensityAnalyzer.polarity_scores(textForSent);
    const sentiment = Math.max(-1, Math.min(1, compound));

    out.push({
      id: `${src.id}:${link}`,
      title,
      url: link,
      published_at: it.isoDate || it.pubDate || null,
      source_domain: domain,
      source_name: src.name,
      category,
      policy: src.policy,                       // HEADLINE_ONLY | OPEN | CC_*
      image_url: it?.enclosure?.url || it?.["media:content"]?.url || null,
      summary: (src.policy === "OPEN" || src.policy?.startsWith("CC_"))
                ? (it.contentSnippet || it.summary || null) : null,
      sentiment,
      bias_pct: biasPercentages(title, domain)
    });
  }
  return out;
}

function dedupe(articles) {
  const key = t => _.deburr(String(t || "").toLowerCase())
                    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const map = new Map();
  for (const a of articles) {
    const k = key(a.title);
    if (!map.has(k)) map.set(k, a);
  }
  return [...map.values()];
}

async function getAllArticles() {
  // Read feeds list (keep this file at repo root)
  const raw = fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf8");
  const feeds = JSON.parse(raw.replace(/^\uFEFF/, "").trim());

  const results  = await Promise.allSettled(feeds.map(fetchFeed));
  const articles = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
  const clean    = dedupe(articles)
                    .sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
  return clean;
}

// ---- API --------------------------------------------------------------------
app.get("/api/news", async (_req, res) => {
  try {
    const all = await getAllArticles();
    if (!all.length) {
      return res.json({ ok: true, generated_at: new Date().toISOString(), main: null, daily: [], topics: {} });
    }

    // Pick main
    const main = all.find(a => PREFERRED_DOMAINS.has(a.source_domain)) || all[0];

    // Build Daily Briefing (min 5 items, no duplicates, skip main)
    const byCat = _.groupBy(all.filter(a => a.id !== main.id), "category");
    let daily = [
      ...(byCat.politics || []).slice(0, 2),
      ...(byCat.business || []).slice(0, 2),
      ...(byCat.sports   || []).slice(0, 1),
      ...(byCat.entertainment || []).slice(0, 1)
    ];
    // de-dup + cap
    const seen = new Set();
    daily = daily.filter(a => a && !seen.has(a.id) && seen.add(a.id)).slice(0, 10);
    // top-up to at least 5
    if (daily.length < 5) {
      const used = new Set(daily.map(a => a.id).concat([main.id]));
      const fillers = all.filter(a => !used.has(a.id));
      daily = daily.concat(fillers.slice(0, 5 - daily.length));
    }

    // Simple topic meters (avg sentiment by keyword across main+daily)
    const pool = [main, ...daily].filter(Boolean);
    const avgSentiment = (kw) => {
      const k = kw.toLowerCase();
      const hits = pool.filter(a => (a.title || "").toLowerCase().includes(k));
      if (!hits.length) return null;
      const avg = hits.reduce((s, a) => s + (a.sentiment || 0), 0) / hits.length;
      return { count: hits.length, avg };
    };
    const topics = { Modi: avgSentiment("Modi"), Sensex: avgSentiment("Sensex") };

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      main, daily, topics
    });
  } catch (e) {
    console.error("NEWS API ERROR:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// basic health endpoint for uptime checks
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// ---- Start (Render-compatible) ---------------------------------------------
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`Informed360 listening on ${HOST}:${PORT}`);
});
