import express from "express";
import fetch from "node-fetch";
import Parser from "rss-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const parser = new Parser();

// serve static assets (logos folder etc.)
app.use(express.static(path.join(__dirname, "public")));

// --- LOGO FALLBACKS ---
const logoMap = {
  "thehindu": "/logos/thehindu.png",
  "indianexpress": "/logos/indianexpress.png",
  "hindustantimes": "/logos/hindustantimes.png",
  "toi": "/logos/toi.png",
  "ndtv": "/logos/ndtv.png",
  "pib": "/logos/pib.png",
  "news18": "/logos/news18.png",
  "livemint": "/logos/livemint.png",
  "businessstandard": "/logos/businessstandard.png",
  "thewire": "/logos/thewire.png",
  "theprint": "/logos/theprint.png",
  "scroll": "/logos/scroll.png",
  "deccanherald": "/logos/deccanherald.png",
  "firstpost": "/logos/firstpost.png",
  "indiatoday": "/logos/indiatoday.png",
  "economictimes": "/logos/economictimes.png",
  "reuters": "/logos/reuters.png",
  "bbc": "/logos/bbc.png",
  "aljazeera": "/logos/aljazeera.png",
  "guardian": "/logos/guardian.png"
};

function looksLikeFavicon(u = "") {
  const s = String(u).toLowerCase();
  return s.includes("favicon") || s.endsWith(".ico");
}
function fallbackLogoFor(id) {
  const key = id.split(":")[0]; // feed id like "thehindu:front"
  return logoMap[key] || null;
}

// Load feeds list
import feeds from "./rss-feeds.json" assert { type: "json" };

// Extract image from RSS item
function pickImageFromItem(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  return null;
}

// Fetch one feed
async function fetchFeed(src) {
  try {
    const feed = await parser.parseURL(src.url);
    return feed.items.map(it => {
      const link = it.link;
      let image_url = pickImageFromItem(it);

      if (!image_url || looksLikeFavicon(image_url)) {
        const logo = fallbackLogoFor(src.id || src.name.toLowerCase());
        if (logo) image_url = logo;
      }

      return {
        id: `${src.id}:${it.guid || it.link}`,
        title: it.title,
        url: link,
        source_name: src.name,
        source_domain: src.domain,
        published_at: it.isoDate || it.pubDate,
        image_url
      };
    });
  } catch (e) {
    console.error("Error fetching feed", src.url, e.message);
    return [];
  }
}

// Merge all feeds
async function fetchAll() {
  let all = [];
  for (const f of feeds) {
    const items = await fetchFeed(f);
    all = all.concat(it
