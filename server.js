// server.js — Informed360 API (English-only filter + VADER sentiment; Node 18 safe)

import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

/* CORS: allow ONLY your site */
const ALLOWED = [
  "https://www.informed360.news",
  "https://informed360.news"
];
app.use(cors({ origin: ALLOWED }));

/* Static files (optional: /public/logos, /public/images) */
app.use(express.static(path.join(__dirname, "public")));

/* rss-parser with polite UA */
const parser = new Parser({
  requestOptions: {
    headers: { "User-Agent": "Informed360/1.0 (+https://www.informed360.news)" },
    timeout: 15000
  }
});

/* ---------- Language filter: keep only English ---------- */
/* We filter out Devanagari and other major Indic scripts, and require a healthy Latin ratio. */
const NON_LATIN_BLOCKS = [
  /[\u0900-\u097F]/, // Devanagari (Hindi/Marathi/etc.)
  /[\u0980-\u09FF]/, // Bengali
  /[\u0A00-\u0A7F]/, // Gurmukhi
  /[\u0A80-\u0AFF]/, // Gujarati
  /[\u0B00-\u0B7F]/, // Oriya/Odia
  /[\u0B80-\u0BFF]/, // Tamil
  /[\u0C00-\u0C7F]/, // Telugu
  /[\u0C80-\u0CFF]/, // Kannada
  /[\u0D00-\u0D7F]/, // Malayalam
  /[\u0D80-\u0DFF]/  // Sinhala (just in case)
];

function looksIndic(text = "") {
  return NON_LATIN_BLOCKS.some(rx => rx.test(text));
}
function latinRatio(text = "") {
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters / Math.max(text.length, 1);
}
/* Final predicate: “is English enough” */
function isEnglish(text = "") {
  if (!text) return false;
  if (looksIndic(text)) return false;
  return latinRatio(text) >= 0.35; // require at least ~35% Latin letters
}

/* ---------- Image helpers ---------- */
function looksLikeFavicon(u = "") {
  const s = String(u || "").toLowerCase();
  return s.includes("favicon") || s.endsWith(".ico") || s.includes("google.com/s2/favicons");
}
function firstImgFromHtml(html = "") {
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}
function placeholderSVG(label="News") {
  const txt = encodeURIComponent(label.slice(0, 14));
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>
      <defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
        <stop stop-color='#F3F4F6' offset='0'/><stop stop-color='#E5E7EB' offset='1'/>
      </linearGradient></defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
      <text x='50%' y='50%' font-family='Inter,Arial,sans-serif' font-size='42' font-weight='700'
        fill='#111' text-anchor='middle' dominant-baseline='middle'>${txt}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* Optional: local logos you can place in /public/logos */
const logoMap = {
  thehindu: "/logos/thehindu.svg",
  indianexpress: "/logos/indianexpress.svg",
  hindustantimes: "/logos/hindustantimes.svg",
  toi: "/logos/toi.svg",
  ndtv: "/logos/ndtv.svg",
  economictimes: "/logos/economictimes.svg",
  livemint: "/logos/livemint.svg",
  moneycontrol: "/logos/moneycontrol.svg",
  businessstandard: "/logos/businessstandard.svg",
  businessline: "/logos/businessline.svg",
  financialexpress: "/logos/financialexpress.svg",
  abplive: "/logos/abplive.svg",
  indiatoday: "/logos/indiatoday.svg",
  news18: "/logos/news18.svg",
  scroll: "/logos/scroll.svg",
  telegraph: "/logos/telegraph.svg",
  reutersin: "/logos/reuters.svg",
  bbcindia: "/logos/bbc.svg",
  theprint: "/logos/theprint.svg",
  thewire: "/logos/thewire.svg",
  firstpost: "/logos/firstpost.svg",
  cnbctv18: "/logos/cnbctv18.svg",
  espncricinfo: "/logos/espncricinfo.svg",
  bollywoodhungama: "/logos/bollywoodhungama.svg",
  mongabayindia: "/logos/mongabayindia.svg",
  pib: "/logos/pib.svg"
};
function logoFor(feedId, feedName){
  const key = (feedId||"").split(":")[0];
  return logoMap[key] || placeholderSVG(feedName||"News");
}

/* ---------- Load feeds JSON (Node 18 safe) ---------- */
const feedsPath = path.join(__dirname, "rss-feeds.json");
let feeds = [];
try { feeds = JSON.parse(fs.readFileSync(feedsPath, "utf8")); }
catch (e) { console.error("Failed to read rss-feeds.json:", e.message); feeds = []; }
const FEEDS = (Array.isArray(feeds) ? feeds : []).filter(f => f && f.id && f.url);

/* ---------- VADER sentiment ---------- */
function scoreSentiment(it){
  const text = [
    it.title || "",
    it.contentSnippet || "",
    it.summary || ""
  ].join(". ").replace(/\s+/g," ").trim();

  if (!text) return 0;

  // If the text is not English enough, return neutral to avoid garbage scores.
  if (!isEnglish(text)) return 0;

  const r = vader.SentimentIntensityAnalyzer.polarity_scores(text);
  return Math.max(-1, Math.min(1, r.compound));
}

/* ---------- Image extraction ---------- */
function pickImage(feed, item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  if (item["content:encoded"]) {
    const u = firstImgFromHtml(item["content:encoded"]);
    if (u) return u;
  }
  if (item.content) {
    const u = firstImgFromHtml(item.content);
    if (u) return u;
  }
  return logoFor(feed.id, feed.name);
}

/* ---------- Fetch one feed & FILTER TO ENGLISH ---------- */
async function fetchFeed(feed) {
  try {
    const data = await parser.parseURL(feed.url);
    const items = (data.items || [])
      // Keep only English titles (quick + reliable)
      .filter(it => isEnglish(it.title || ""))
      .map(it => {
        let img = pickImage(feed, it);
        if (!img || looksLikeFavicon(img)) img = logoFor(feed.id, feed.name);

        return {
          id: `${feed.id}:${it.guid || it.link || it.pubDate || Math.random()}`,
          title: it.title || "(untitled)",
          url: it.link || it.guid || "",
          source_id: feed.id,
          source_name: feed.name || feed.id,
          source_domain: feed.domain || "",
          published_at: it.isoDate || it.pubDate || new Date().toISOString(),
          sentiment: scoreSentiment(it),
          image_url: img,
          contentSnippet: it.contentSnippet || ""
        };
      });

    return items;
  } catch (e) {
    console.warn(`[FEED ERR] ${feed.id} -> ${e.message}`);
    return [];
  }
}

/* ---------- Merge, sort, dedupe ---------- */
async function fetchAll() {
  const arrays = await Promise.all(FEEDS.map(fetchFeed));
  let all = arrays.flat();

  // newest first
  all.sort((a,b)=> new Date(b.published_at) - new Date(a.published_at));

  // de-dup by URL/title
  const seen = new Set();
  all = all.filter(it => {
    const key = (it.url || it.title).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return all;
}

/* ---------- API ---------- */
app.get("/api/news", async (_req, res) => {
  try {
    const items = await fetchAll();
    res.json({ ok: true, main: items[0] || null, items });
  } catch (e) {
    const now = new Date().toISOString();
    const mk=(i)=>({
      id:`demo:${i}`, title:`Demo article #${i}`, url:"https://example.com",
      source_id:"demo", source_name:"Demo", source_domain:"example.com",
      published_at:now, sentiment:0, image_url: placeholderSVG("Informed360")
    });
    const items=[mk(1),mk(2),mk(3),mk(4),mk(5)];
    res.json({ ok:true, main:items[0], items });
  }
});

app.get("/api/markets", (_req, res) => {
  res.json({
    ok: true,
    nifty:  { price: 24650.25, percent: 0.34 },
    sensex: { price: 81234.10, percent: -0.12 },
    usdinr: { price: 83.20 }
  });
});

/* Optional diagnostics */
app.get("/api/news/sources", async (_req, res) => {
  const items = await fetchAll();
  const counts = {};
  for (const it of items) counts[it.source_id] = (counts[it.source_id] || 0) + 1;
  res.json({ ok:true, counts });
});

/* ---------- Boot ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Informed360 API (English-only) on ${PORT}`));
