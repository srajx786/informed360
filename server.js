// v25 — robust multi-source fetch + per-source diagnostics + safe logo fallback

import express from "express";
import Parser from "rss-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static assets (so /logos/* and /images/* work)
app.use(express.static(path.join(__dirname, "public")));

// ---- Configure rss-parser with a polite User-Agent (prevents many 403s) ----
const parser = new Parser({
  requestOptions: {
    headers: {
      "User-Agent": "Informed360/1.0 (+https://example.com) RSS Reader",
      "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8"
    },
    timeout: 15000
  }
});

// ---- FEEDS ----
import feeds from "./rss-feeds.json" assert { type: "json" };

// Validate feeds (must have id, name, url)
const FEEDS = (Array.isArray(feeds) ? feeds : []).filter(f => f && f.id && f.url);

// ---- LOGO MAP keyed by feed id (not domain) ----
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

function looksLikeFavicon(u = "") {
  const s = String(u || "").toLowerCase();
  return s.includes("favicon") || s.endsWith(".ico") || s.includes("google.com/s2/favicons");
}
function logoForFeedId(feedId = "") {
  const key = String(feedId).split(":")[0]; // id may be like 'thehindu:front'
  return logoMap[key] || null;
}

// ---- IMAGE PICKERS ----
function firstImgFromHtml(html = "") {
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}
function pickImageFromItem(item) {
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
  return null;
}

// ---- FETCH A SINGLE FEED WITH DIAGNOSTICS ----
async function fetchFeed(src) {
  const start = Date.now();
  try {
    const feed = await parser.parseURL(src.url);
    const items = (feed.items || []).map(it => {
      const link = it.link || it.guid || "";
      let image_url = pickImageFromItem(it);
      // Only if missing/bad → use our crisp logo keyed by feed id
      if (!image_url || looksLikeFavicon(image_url)) {
        const logo = logoForFeedId(src.id);
        if (logo) image_url = logo;
      }
      return {
        id: `${src.id}:${it.guid || it.link || it.pubDate || Math.random()}`,
        title: it.title || "(untitled)",
        url: link,
        source_id: src.id,
        source_name: src.name || src.id,
        source_domain: src.domain || "",
        published_at: it.isoDate || it.pubDate || new Date().toISOString(),
        image_url
      };
    });

    console.log(`[FEED OK] ${src.id.padEnd(16)} items=${items.length.toString().padStart(3)}  (${Date.now()-start}ms)`);
    return items;
  } catch (e) {
    console.warn(`[FEED ERR] ${src.id}  ${src.url}  -> ${e.message}`);
    return [];
  }
}

// ---- FETCH ALL FEEDS ----
async function fetchAll() {
  const arrays = await Promise.all(FEEDS.map(fetchFeed));
  let all = arrays.flat();

  // Sort newest first
  all.sort((a,b)=> new Date(b.published_at) - new Date(a.published_at));

  // Optional: de-duplicate by normalized URL (some feeds repeat)
  const seen = new Set();
  all = all.filter(it => {
    const key = (it.url || it.title).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return all;
}

// ---- API: NEWS (main + items) ----
app.get("/api/news", async (_req, res) => {
  const items = await fetchAll();
  res.json({ ok: true, main: items[0] || null, items });
});

// ---- API: SOURCE BREAKDOWN (debug) ----
app.get("/api/news/sources", async (_req, res) => {
  const items = await fetchAll();
  const counts = {};
  for (const it of items) {
    counts[it.source_id] = (counts[it.source_id] || 0) + 1;
  }
  // return top 50 with sample titles per source (helps eyeball variety)
  const byCount = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const samples = {};
  for (const [sid] of byCount) {
    samples[sid] = items.filter(x=>x.source_id===sid).slice(0,3).map(x=>x.title);
  }
  res.json({ ok: true, counts: Object.fromEntries(byCount), samples });
});

// ---- API: MARKETS (placeholder) ----
app.get("/api/markets", async (_req,res)=>{
  res.json({ ok:true, nifty:{percent:0.18}, sensex:{percent:-0.11}, usdinr:{price:83.20} });
});

// ---- BOOT ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Informed360 server running on ${PORT}`));
