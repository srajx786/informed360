import express from "express";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import _ from "lodash";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";

// ---------- ESM-safe __dirname / app ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ---------- Config ----------
const parser = new Parser({ timeout: 15000 });
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

const ALLOWED_DOMAINS = new Set(Object.keys(biasMap));
const PREFERRED_DOMAINS = new Set([
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "timesofindia.indiatimes.com",
  "ndtv.com",
  "news.abplive.com",
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
  if (bias === "Left") [L, C, R] = [0.7, 0.2, 0.1];
  if (bias === "Lean Left") [L, C, R] = [0.55, 0.3, 0.15];
  if (bias === "Center") [L, C, R] = [0.2, 0.6, 0.2];
  if (bias === "Lean Right") [L, C, R] = [0.15, 0.3, 0.55];
  if (bias === "Right") [L, C, R] = [0.1, 0.2, 0.7];

  const leftCues = /(climate|environment|equality|minority|rights|secular|labor|welfare|gender|lgbt|far-right|communal)/i;
  const rightCues = /(nationalism|border|illegal immigration|terror|law and order|heritage|tax cut|hindutva)/i;
  const t = (title || "").toLowerCase();
  if (leftCues.test(t)) {
    L += 0.08;
    C -= 0.04;
    R -= 0.04;
  }
  if (rightCues.test(t)) {
    R += 0.08;
    C -= 0.04;
    L -= 0.04;
  }
  const s = Math.max(0.0001, L + C + R);
  return { Left: L / s, Center: C / s, Right: R / s };
}

// ---------- Image helpers ----------
function absolutizeUrl(src, pageUrl) {
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return src || null;
  }
}

function firstImgFromHtml(html, pageUrl) {
  try {
    if (!html) return null;
    const dom = new JSDOM(html);
    const img = dom.window.document.querySelector("img");
    if (!img) return null;
    const u = img.getAttribute("src") || img.getAttribute("data-src");
    return u ? absolutizeUrl(u, pageUrl) : null;
  } catch {
    const m = String(html || "").match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? absolutizeUrl(m[1], pageUrl) : null;
  }
}

function pickImageUrl(item, pageUrl) {
  const media = item["media:content"] || item["media:thumbnail"] || {};
  const enclosures = Array.isArray(item.enclosure) ? item.enclosure : [item.enclosure].filter(Boolean);
  const candidates = [
    media.url,
    item.image?.url,
    item.thumbnail,
    item.enclosure?.url,
    ...enclosures.map((e) => e?.url).filter(Boolean),
  ].filter(Boolean);

  for (const u of candidates) {
    const abs = absolutizeUrl(u, pageUrl);
    if (abs) return abs;
  }
  const htmlBlocks = [item["content:encoded"], item.content, item.contentSnippet, item.summary, item.description];
  for (const html of htmlBlocks) {
    const u = firstImgFromHtml(html, pageUrl);
    if (u) return u;
  }
  return null;
}

// Fetch the article page and read og:image/twitter:image
async function fetchOgImage(pageUrl) {
  try {
    const r = await timedFetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    }, 8000);
    if (!r.ok) return null;
    const html = await r.text();
    const dom = new JSDOM(html);
    const d = dom.window.document;
    const meta = (sel) => d.querySelector(sel)?.getAttribute("content");
    const og = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || d.querySelector('link[rel="image_src"]')?.getAttribute("href");
    return og ? absolutizeUrl(og, pageUrl) : null;
  } catch {
    return null;
  }
}

async function timedFetch(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------- Fetch feeds ----------
async function fetchFeed(src) {
  const feed = await parser.parseURL(src.url);
  const items = feed.items || [];
  const out = [];

  for (const it of items.slice(0, 30)) {
    const link = String(it.link || "");
    const title = String(it.title || "");
    if (!link || !title) continue;

    const domain = domainFromUrl(link);
    if (!ALLOWED_DOMAINS.has(domain)) continue;

    const category = src.category || inferCategory(title, "general");

    // sentiment text (respect policy)
    let textForSent = title;
    if (src.policy !== "HEADLINE_ONLY") {
      const snippet = String(it.contentSnippet || it.summary || "");
      textForSent = (title + ". " + snippet).slice(0, 600);
    }
    const { compound } = vader.SentimentIntensityAnalyzer.polarity_scores(textForSent);
    const sentiment = Math.max(-1, Math.min(1, compound));

    // image: RSS -> HTML -> OG fallback
    let image_url = pickImageUrl(it, link);
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
      image_url,
      summary:
        src.policy === "OPEN" || (src.policy || "").startsWith("CC_")
          ? it.contentSnippet || it.summary || null
          : null,
      sentiment,
      bias_pct: biasPercentages(title, domain),
    });
  }
  return out;
}

function dedupe(articles) {
  const key = (t) =>
    _.deburr(String(t || "").toLowerCase()).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const map = new Map();
  for (const a of articles) {
    const k = key(a.title);
    if (!map.has(k)) map.set(k, a);
  }
  return [...map.values()];
}

async function getAllArticles() {
  const raw = fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf8");
  const feeds = JSON.parse(raw.replace(/^\uFEFF/, "").trim());

  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const articles = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const clean = dedupe(articles).sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
  return clean;
}

// ---------- API ----------
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

// Health
app.get("/healthz", (_req, res) => res.type("text").send("ok"));
app.get("/health", (_req, res) => res.type("text").send("ok"));

// ---------- Image proxy (secure) ----------
app.get("/img", async (req, res) => {
  const u = req.query.u;
  if (!u) return res.status(400).send("Missing u param");
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

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`Informed360 listening on ${HOST}:${PORT}`);
});
