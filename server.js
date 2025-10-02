import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
// ⛔ remove the hard import that crashes when package is missing
// import yahooFinance from "yahoo-finance2";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

const FEEDS = JSON.parse(fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf-8"));
const REFRESH_MS = Math.max(2, FEEDS.refreshMinutes || 10) * 60 * 1000;

const parser = new Parser({
  timeout: 15000,
  headers: {
    "user-agent": "Mozilla/5.0 (compatible; Informed360/1.0; +https://www.informed360.news)"
  }
});

let CACHE = { fetchedAt: 0, articles: [], byUrl: new Map() };

const domainFromUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./,""); } catch { return ""; } };
const extractImage = (item) => {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

const scoreSentiment = (text) => {
  const s = vader.SentimentIntensityAnalyzer.polarity_scores(text || "");
  const posP = Math.round((s.pos || 0) * 100);
  const negP = Math.round((s.neg || 0) * 100);
  const neuP = Math.max(0, 100 - posP - negP);
  const label = (s.compound ?? 0) >= 0.05 ? "positive" : (s.compound ?? 0) <= -0.05 ? "negative" : "neutral";
  return { ...s, posP, negP, neuP, label };
};

// ---- fetch & cache feeds (same as before) -----------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hostCounters = new Map(); const maxPerHost = 2;
const acquire = async (h) => { while((hostCounters.get(h)||0) >= maxPerHost) await sleep(150); hostCounters.set(h,(hostCounters.get(h)||0)+1); };
const release = (h) => hostCounters.set(h, Math.max(0,(hostCounters.get(h)||1)-1));
const withRetry = async (fn, tries=2) => { let e; for (let i=0;i<tries;i++){ try{return await fn();} catch(err){ e=err; await sleep(300+Math.random()*600);} } throw e; };

async function fetchFeed(url){
  const host = domainFromUrl(url);
  await acquire(host);
  try { return await withRetry(() => parser.parseURL(url), 2); }
  finally { release(host); }
}

const fetchAll = async () => {
  const articles = [];
  const byUrl = new Map();
  const allFeeds = [...(FEEDS.feeds || [])];

  await Promise.all(allFeeds.map(async (url) => {
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
        byUrl.set(link, true);
        articles.push({ title, link, source, description, image, publishedAt, sentiment });
      });
    } catch (e) {
      console.warn("[FEED ERR]", domainFromUrl(url), "->", e.statusCode ? `Status code ${e.statusCode}` : e.code || e.message);
    }
  }));

  articles.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  CACHE = { fetchedAt: Date.now(), articles, byUrl };
};
await fetchAll();
setInterval(fetchAll, REFRESH_MS);

// ---- topics clustering (same as before) -------------------------------------
const normalize = (t="") => t.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const topicKey = (title) => {
  const w = normalize(title).split(" ").filter(Boolean);
  const b = []; for (let i=0;i<w.length-1;i++) if (w[i].length>=3 && w[i+1].length>=3) b.push(`${w[i]} ${w[i+1]}`);
  return b.slice(0,3).join(" | ") || w.slice(0,3).join(" ");
};
const clusters = (arts) => {
  const map = new Map();
  for (const a of arts) {
    const k = topicKey(a.title); if (!k) continue;
    if (!map.has(k)) map.set(k, { key:k, count:0, pos:0, neg:0, neu:0, sources:new Set(), image:a.image });
    const c = map.get(k);
    c.count++; c.pos+=a.sentiment.posP; c.neg+=a.sentiment.negP; c.neu+=a.sentiment.neuP; c.sources.add(a.source);
  }
  return [...map.values()].map(c=>{
    const n=Math.max(1,c.count);
    return { title:c.key, count:c.count, sources:c.sources.size, sentiment:{ pos:Math.r
