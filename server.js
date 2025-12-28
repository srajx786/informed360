import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

const FEEDS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf-8")
);
const SOURCE_REGISTRY = JSON.parse(
  fs.readFileSync(path.join(__dirname, "source-registry.json"), "utf-8")
);
const REFRESH_MS = Math.max(2, FEEDS.refreshMinutes || 10) * 60 * 1000;

const parser = new Parser({
  timeout: 15000,
  requestOptions: {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360Bot/1.0",
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
      Referer: "https://www.informed360.news/"
    }
  }
});

const SOURCE_MAP = new Map(
  Object.entries(SOURCE_REGISTRY.sources || {}).map(([domain, info]) => [
    domain,
    info
  ])
);

const TRANSFORMER_ENABLED = process.env.TRANSFORMER_ENABLED === "1";
const TRANSFORMER_MODEL =
  process.env.TRANSFORMER_MODEL ||
  "Xenova/distilbert-base-uncased-finetuned-sst-2-english";
const TRANSFORMER_TIMEOUT_MS = Number(process.env.TRANSFORMER_TIMEOUT_MS || 1400);
const TRANSFORMER_MAX_TOKENS = Number(process.env.TRANSFORMER_MAX_TOKENS || 256);
const ARTICLE_CACHE_TTL = Number(process.env.ARTICLE_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const ARTICLE_CACHE_MAX = Number(process.env.ARTICLE_CACHE_MAX || 1200);
const STORY_CACHE_TTL = Number(process.env.STORY_CACHE_TTL_MS || 120000);
const GDELT_CACHE_TTL = Number(process.env.GDELT_CACHE_TTL_MS || 600000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARTICLE_CACHE = new Map();
const EXPLANATION_CACHE = new Map();
const STORY_CACHE = new Map();
const GDELT_CACHE = new Map();
const FEED_HEALTH = new Map();

let transformerPipeline = null;
const domainFromUrl = (u = "") => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const cleanUrl = (u = "", base = "") => {
  if (!u) return "";
  const normalized = u
    .toString()
    .replace(/^\/\//, "https://")
    .replace(/^http:\/\//, "https://");
  try {
    return new URL(normalized, base || undefined).href;
  } catch {
    return normalized;
  }
};
const canonicalizeUrl = (u = "") => {
  if (!u) return "";
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    const pathName = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathName}`;
  } catch {
    return u;
  }
};
const firstImgInHtml = (html = "", base = "") => {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m ? cleanUrl(m[1], base) : "";
};
const findMetaContent = (html = "", attr = "", value = "") => {
  const patterns = [
    new RegExp(
      `<meta[^>]+${attr}=["']${value}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${value}["']`,
      "i"
    )
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return "";
};
const ogImageCache = new Map();
const pickUrls = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => x?.url || x).filter(Boolean);
  if (typeof v === "object" && v.url) return [v.url];
  return [];
};
const extractImage = (item) => {
  const candidates = [
    ...pickUrls(item.enclosure),
    ...pickUrls(item["media:content"]),
    ...pickUrls(item["media:thumbnail"])
  ];
  const htmlImg = firstImgInHtml(
    item["content:encoded"] || item.content || item.summary,
    item.link
  );
  if (htmlImg) candidates.push(htmlImg);

  const chosen =
    candidates
      .map((u) => cleanUrl(u, item.link))
      .find((u) => typeof u === "string" && u.startsWith("http")) || "";
  if (chosen) return chosen;

  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

const SOURCE_FALLBACKS = [
  { match: /reuters/i, domain: "reuters.com", name: "Reuters" },
  { match: /bbc/i, domain: "bbc.com", name: "BBC" },
  { match: /al jazeera/i, domain: "aljazeera.com", name: "Al Jazeera" }
];

const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","when","while","for","to","of",
  "in","on","at","by","from","with","without","over","under","into","onto","off",
  "up","down","out","about","as","is","are","was","were","be","been","being",
  "this","that","these","those","it","its","their","his","her","our","your","my",
  "not","no","yes","new","news","latest","live","update","updates","today",
  "report","reports","says","say","said","tells","told","after","before","amid",
  "reveals","reveal","announces","announce","breaking","liveblog","blog","watch",
  "video","photos","photo","gallery","exclusive","analysis","opinion","editorial"
]);

const tokenize = (text = "") =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token));

const countTokens = (text = "") => tokenize(text).length;

const extractTopPhrases = (text = "", max = 5) => {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const counts = new Map();
  const add = (phrase) =>
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  tokens.forEach((token) => add(token));
  for (let i = 0; i < tokens.length - 1; i++)
    add(`${tokens[i]} ${tokens[i + 1]}`);
  for (let i = 0; i < tokens.length - 2; i++)
    add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0].length - a[0].length;
    })
    .map(([phrase]) => phrase)
    .filter((phrase) => phrase.length >= 4)
    .slice(0, max);
};

const lookupSourceInfo = ({ source = "", link = "" }) => {
  const domain = domainFromUrl(link || "");
  if (domain && SOURCE_MAP.has(domain))
    return { domain, ...SOURCE_MAP.get(domain) };
  const fallback = SOURCE_FALLBACKS.find((f) => f.match.test(source));
  if (fallback) {
    const info = SOURCE_MAP.get(fallback.domain) || {};
    return { domain: fallback.domain, name: fallback.name, ...info };
  }
  return { domain, name: source || domain || "Unknown" };
};

const toSentimentLabel = (label = "") => {
  const normalized = label.toLowerCase();
  if (normalized.startsWith("pos")) return "Positive";
  if (normalized.startsWith("neg")) return "Negative";
  return "Neutral";
};

const scoreVader = (text = "") => {
  const s = vader.SentimentIntensityAnalyzer.polarity_scores(text || "") || {
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
  const confidence = Math.min(1, Math.abs(s.compound ?? 0));
  return {
    label,
    posP,
    negP,
    neuP,
    scores: { pos: posP, neu: neuP, neg: negP },
    confidence,
    model: "vader"
  };
};

const loadTransformer = async () => {
  if (!TRANSFORMER_ENABLED) return null;
  if (transformerPipeline) return transformerPipeline;
  transformerPipeline = await import("@xenova/transformers")
    .then(({ pipeline }) =>
      pipeline("sentiment-analysis", TRANSFORMER_MODEL, { quantized: true })
    )
    .catch(() => null);
  return transformerPipeline;
};

const normalizeTransformerScores = (output = {}) => {
  if (Array.isArray(output) && output.length === 1) output = output[0];
  if (Array.isArray(output) && output.length > 1) {
    const scores = output.map((o) => ({
      label: String(o.label || ""),
      score: Number(o.score || 0)
    }));
    const lookup = (key) =>
      scores.find((s) => s.label.toLowerCase().includes(key));
    const posScore = lookup("pos")?.score || 0;
    const negScore = lookup("neg")?.score || 0;
    const neuScore = lookup("neu")?.score || Math.max(0, 1 - posScore - negScore);
    return { posScore, negScore, neuScore, label: "neutral", confidence: Math.max(posScore, negScore, neuScore) };
  }
  const label = String(output.label || "");
  const score = Number(output.score || 0);
  if (label.toLowerCase().includes("pos"))
    return {
      posScore: score,
      negScore: Math.max(0, (1 - score) * 0.15),
      neuScore: Math.max(0, 1 - score - (1 - score) * 0.15),
      label,
      confidence: score
    };
  if (label.toLowerCase().includes("neg"))
    return {
      negScore: score,
      posScore: Math.max(0, (1 - score) * 0.15),
      neuScore: Math.max(0, 1 - score - (1 - score) * 0.15),
      label,
      confidence: score
    };
  return {
    neuScore: score,
    posScore: Math.max(0, (1 - score) * 0.5),
    negScore: Math.max(0, (1 - score) * 0.5),
    label,
    confidence: score
  };
};

const scoreSentiment = async (text = "", context = {}) => {
  const trimmed = String(text || "").trim();
  const tokenCount = countTokens(trimmed);
  const topPhrases = extractTopPhrases(trimmed, 6);
  const fallback = (reason) => {
    const vaderScore = scoreVader(trimmed);
    return {
      sentiment: vaderScore,
      explanation: {
        url: context.url || "",
        model: "vader",
        fallbackReason: reason,
        sentiment_label: toSentimentLabel(vaderScore.label),
        sentiment_scores: vaderScore.scores,
        confidence: vaderScore.confidence,
        top_phrases: topPhrases,
        text_sample: trimmed.slice(0, 220),
        generatedAt: new Date().toISOString()
      }
    };
  };

  if (tokenCount < 20) return fallback("text-too-short");
  const pipeline = await loadTransformer();
  if (!pipeline) return fallback("transformer-unavailable");

  try {
    const result = await Promise.race([
      pipeline(trimmed.slice(0, TRANSFORMER_MAX_TOKENS)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("transformer-timeout")), TRANSFORMER_TIMEOUT_MS)
      )
    ]);
    const normalized = normalizeTransformerScores(result);
    const posP = Math.round((normalized.posScore || 0) * 100);
    const negP = Math.round((normalized.negScore || 0) * 100);
    const neuP = Math.max(0, 100 - posP - negP);
    const label =
      posP > negP + 5 ? "positive" : negP > posP + 5 ? "negative" : "neutral";
    const sentiment = {
      label,
      posP,
      negP,
      neuP,
      scores: { pos: posP, neu: neuP, neg: negP },
      confidence: Math.min(1, normalized.confidence || 0),
      model: "transformer"
    };
    return {
      sentiment,
      explanation: {
        url: context.url || "",
        model: "transformer",
        sentiment_label: toSentimentLabel(label),
        sentiment_scores: sentiment.scores,
        confidence: sentiment.confidence,
        top_phrases: topPhrases,
        text_sample: trimmed.slice(0, 220),
        generatedAt: new Date().toISOString()
      }
    };
  } catch {
    return fallback("transformer-failed");
  }
};

const pruneCache = () => {
  if (ARTICLE_CACHE.size <= ARTICLE_CACHE_MAX) return;
  const entries = [...ARTICLE_CACHE.entries()].sort(
    (a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0)
  );
  const removeCount = Math.max(0, entries.length - ARTICLE_CACHE_MAX);
  entries.slice(0, removeCount).forEach(([key]) => ARTICLE_CACHE.delete(key));
};

const getCachedArticle = (link) => {
  const cached = ARTICLE_CACHE.get(link);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > ARTICLE_CACHE_TTL) {
    ARTICLE_CACHE.delete(link);
    return null;
  }
  return cached.article;
};

const setCachedArticle = (link, article, explanation) => {
  ARTICLE_CACHE.set(link, { article, updatedAt: Date.now() });
  if (explanation) EXPLANATION_CACHE.set(link, explanation);
  pruneCache();
};

const recordFeedHealth = (url, ok, message = "") => {
  const entry = FEED_HEALTH.get(url) || { failures: 0, lastFailedAt: 0, lastOkAt: 0 };
  if (ok) {
    entry.failures = 0;
    entry.lastOkAt = Date.now();
    entry.lastError = "";
  } else {
    entry.failures += 1;
    entry.lastFailedAt = Date.now();
    entry.lastError = message;
  }
  FEED_HEALTH.set(url, entry);
};

const shouldSkipFeed = (url) => {
  const entry = FEED_HEALTH.get(url);
  if (!entry) return false;
  if (entry.failures < 2) return false;
  return Date.now() - entry.lastFailedAt < 45 * 60 * 1000;
};

/* Category inference */
const CAT_RULES = [
  {
    name: "sports",
    patterns: [/sport/i, /cricket/i, /ipl/i, /football/i, /badminton/i, /hockey/i]
  },
  {
    name: "business",
    patterns: [
      /business/i,
      /market/i,
      /econom/i,
      /stock/i,
      /sensex/i,
      /nifty/i,
      /finance/i,
      /industry/i
    ]
  },
  {
    name: "technology",
    patterns: [
      /tech/i,
      /technology/i,
      /software/i,
      /\bai\b/i,
      /startup/i,
      /gadget/i,
      /iphone/i,
      /android/i
    ]
  },
  {
    name: "entertainment",
    patterns: [
      /entertainment/i,
      /bollywood/i,
      /movie/i,
      /film/i,
      /music/i,
      /celebrity/i,
      /\btv\b/i,
      /web series/i
    ]
  },
  {
    name: "science",
    patterns: [
      /science/i,
      /space/i,
      /isro/i,
      /nasa/i,
      /research/i,
      /study/i,
      /astronom/i,
      /quantum/i
    ]
  },
  {
    name: "health",
    patterns: [
      /health/i,
      /covid/i,
      /virus/i,
      /disease/i,
      /medical/i,
      /hospital/i,
      /vaccine/i,
      /wellness/i
    ]
  },
  {
    name: "world",
    patterns: [
      /world/i,
      /international/i,
      /\bUS\b/i,
      /china/i,
      /pakistan/i,
      /\buk\b/i,
      /europe/i,
      /russia/i,
      /africa/i,
      /global/i,
      /middle[- ]east/i
    ]
  },
  {
    name: "india",
    patterns: [
      /india/i,
      /indian/i,
      /delhi/i,
      /mumbai/i,
      /bengaluru/i,
      /hyderabad/i,
      /chennai/i,
      /kolkata/i,
      /maharashtra/i,
      /uttar pradesh/i,
      /gujarat/i,
      /punjab/i
    ]
  }
];
function inferCategory({ title = "", link = "", source = "" }) {
  const hay = `${title} ${link} ${source}`.toLowerCase();
  for (const r of CAT_RULES) if (r.patterns.some((p) => p.test(hay))) return r.name;
  if (/\.(in)(\/|$)/i.test(link)) return "india";
  return "india";
}

/* concurrency */
const hostCounters = new Map();
const MAX_PER_HOST = 2;
const acquire = async (host) => {
  while ((hostCounters.get(host) || 0) >= MAX_PER_HOST) await sleep(150);
  hostCounters.set(host, (hostCounters.get(host) || 0) + 1);
};
const release = (host) =>
  hostCounters.set(host, Math.max(0, (hostCounters.get(host) || 1) - 1));

async function parseURL(u) {
  return parser.parseURL(u);
}
const gNewsForDomain = (domain) =>
  `https://news.google.com/rss/search?q=site:${encodeURIComponent(
    domain
  )}&hl=en-IN&gl=IN&ceid=IN:en`;

async function fetchDirect(url) {
  const host = domainFromUrl(url);
  await acquire(host);
  try {
    return await parseURL(url);
  } finally {
    release(host);
  }
}
async function fetchWithFallback(url) {
  const domain = domainFromUrl(url);
  try {
    if (shouldSkipFeed(url)) {
      return { title: domain, items: [] };
    }
    const feed = await fetchDirect(url);
    recordFeedHealth(url, true);
    if (feed?.items?.length) return feed;
    const g = await parseURL(gNewsForDomain(domain));
    g.title = g.title || domain;
    return g;
  } catch (e) {
    try {
      const g = await parseURL(gNewsForDomain(domain));
      g.title = g.title || domain;
      recordFeedHealth(url, true);
      console.warn("[FEED Fallback]", domain, "-> Google News RSS");
      return g;
    } catch (e2) {
      const msg = e?.statusCode
        ? `Status ${e.statusCode}`
        : e?.code || e?.message || "Unknown";
      console.warn("[FEED ERR]", domain, "->", msg);
      recordFeedHealth(url, false, msg);
      return { title: domain, items: [] };
    }
  }
}

async function fetchList(urls) {
  const articles = [];
  const seen = new Set();

  await Promise.all(
    urls.map(async (url) => {
      const domain = domainFromUrl(url);
      const feed = await fetchWithFallback(url);
      const items = (feed.items || []).slice(0, 30);

      for (const item of items) {
        const rawLink = item.link || item.guid || "";
        const link = cleanUrl(rawLink, rawLink);
        if (!link || seen.has(link)) continue;

        const cached = getCachedArticle(link);
        if (cached) {
          seen.add(link);
          articles.push(cached);
          continue;
        }

        const title = item.title || "";
        const sourceRaw = item.source?.title || feed.title || domain;
        const sourceInfo = lookupSourceInfo({ source: sourceRaw, link });
        const description = item.contentSnippet || item.summary || "";
        const publishedAt =
          item.isoDate || item.pubDate || new Date().toISOString();
        const image = extractImage(item);
        const text = `${title}. ${description}`.trim();
        const { sentiment, explanation } = await scoreSentiment(text, {
          url: link
        });
        const category = inferCategory({
          title,
          link,
          source: sourceInfo.name
        });

        const article = {
          title,
          link,
          source: sourceInfo.name,
          sourceDomain: sourceInfo.domain,
          sourceCredibility: sourceInfo.credibility || null,
          industry: sourceInfo.industry || null,
          description,
          image,
          publishedAt,
          sentiment: {
            ...sentiment,
            sentimentLabel: explanation.sentiment_label,
            topPhrases: explanation.top_phrases,
            confidence: explanation.confidence
          },
          sentiment_label: explanation.sentiment_label,
          sentiment_scores: explanation.sentiment_scores,
          confidence: explanation.confidence,
          top_phrases: explanation.top_phrases,
          category
        };

        seen.add(link);
        articles.push(article);
        setCachedArticle(link, article, explanation);
      }
    })
  );

  articles.sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  return { fetchedAt: Date.now(), articles };
}

let CORE = { fetchedAt: 0, articles: [] };
let EXP = { fetchedAt: 0, articles: [] };
const uniqueMerge = (a, b) => {
  const set = new Set();
  const out = [];
  for (const x of [...a, ...b]) {
    const k = x.link || x.title;
    if (set.has(k)) continue;
    set.add(k);
    out.push(x);
  }
  return out;
};

async function refreshCore() {
  CORE = await fetchList(FEEDS.feeds || []);
  STORY_CACHE.delete("core");
}
async function refreshExp() {
  EXP = await fetchList(FEEDS.experimental || []);
  STORY_CACHE.delete("exp");
}
async function validateFeeds() {
  const urls = [...(FEEDS.feeds || []), ...(FEEDS.experimental || [])];
  await Promise.all(
    urls.map(async (url) => {
      if (shouldSkipFeed(url)) return;
      try {
        const feed = await fetchDirect(url);
        recordFeedHealth(url, Boolean(feed?.items?.length));
      } catch (e) {
        const msg = e?.code || e?.message || "Unknown";
        recordFeedHealth(url, false, msg);
      }
    })
  );
}
await refreshCore();
await refreshExp();
await validateFeeds();
setInterval(refreshCore, REFRESH_MS);
setInterval(refreshExp, REFRESH_MS);
setInterval(validateFeeds, 60 * 60 * 1000);

/* topics */
const normalize = (t = "") =>
  t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const topicKey = (title) => {
  const w = normalize(title).split(" ").filter(Boolean);
  const bi = [];
  for (let i = 0; i < w.length - 1; i++)
    if (w[i].length >= 3 && w[i + 1].length >= 3) bi.push(`${w[i]} ${w[i + 1]}`);
  return bi.slice(0, 3).join(" | ") || w.slice(0, 3).join(" ");
};
function buildClusters(arts) {
  const map = new Map();
  for (const a of arts) {
    const k = topicKey(a.title);
    if (!k) continue;
    if (!map.has(k))
      map.set(k, {
        key: k,
        count: 0,
        pos: 0,
        neg: 0,
        neu: 0,
        sources: new Set(),
        image: a.image
      });
    const c = map.get(k);
    c.count++;
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
    .slice(0, 12);
}

const storyTokens = (text = "") =>
  tokenize(text).filter((token) => token.length > 2);
const storySimilarity = (a, b) => {
  const tokensA = new Set(storyTokens(`${a.title} ${a.description}`));
  const tokensB = new Set(storyTokens(`${b.title} ${b.description}`));
  if (!tokensA.size || !tokensB.size) return 0;
  let overlap = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) overlap += 1;
  });
  return overlap / Math.max(tokensA.size, tokensB.size);
};
const weightedSentiment = (articles = []) => {
  const now = Date.now();
  let totalWeight = 0;
  const totals = { pos: 0, neu: 0, neg: 0 };
  const confidences = [];
  articles.forEach((article) => {
    const ageHours = Math.max(
      0.5,
      (now - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60)
    );
    const recencyWeight = 1 / ageHours;
    const confidence = Number(article.sentiment?.confidence ?? 0.4) || 0.4;
    const weight = recencyWeight * confidence;
    totalWeight += weight;
    totals.pos += (article.sentiment?.posP ?? 0) * weight;
    totals.neu += (article.sentiment?.neuP ?? 0) * weight;
    totals.neg += (article.sentiment?.negP ?? 0) * weight;
    confidences.push(confidence);
  });
  const denom = totalWeight || 1;
  return {
    sentiment: {
      pos: Math.round(totals.pos / denom),
      neu: Math.round(totals.neu / denom),
      neg: Math.round(totals.neg / denom)
    },
    confidence:
      confidences.reduce((acc, v) => acc + v, 0) / Math.max(1, confidences.length)
  };
};
const buildStories = (articles = []) => {
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const stories = [];
  const windowMs = 24 * 60 * 60 * 1000;

  sorted.forEach((article) => {
    const canonical = canonicalizeUrl(article.link || "");
    let match = stories.find((story) => {
      if (!story.articles.length) return false;
      const timeDiff =
        Math.abs(
          new Date(story.articles[0].publishedAt).getTime() -
            new Date(article.publishedAt).getTime()
        ) || 0;
      if (timeDiff > windowMs) return false;
      if (canonical && story.canonicalUrls.has(canonical)) return true;
      return storySimilarity(story.articles[0], article) >= 0.4;
    });
    if (!match) {
      match = {
        storyId: crypto
          .createHash("md5")
          .update(`${article.title}-${article.link}`)
          .digest("hex")
          .slice(0, 10),
        canonicalTitle: article.title || "Top story",
        canonicalUrls: new Set(canonical ? [canonical] : []),
        articles: []
      };
      stories.push(match);
    }
    if (canonical) match.canonicalUrls.add(canonical);
    match.articles.push(article);
  });

  return stories
    .map((story) => {
      const sortedArticles = story.articles.sort(
        (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
      );
      const featured = sortedArticles[0];
      const { sentiment, confidence } = weightedSentiment(sortedArticles);
      const phraseText = sortedArticles
        .map((a) => `${a.title} ${a.description}`)
        .join(" ");
      return {
        storyId: story.storyId,
        canonicalTitle: story.canonicalTitle,
        articles: sortedArticles,
        featured,
        storySentiment: sentiment,
        storyConfidence: Number(confidence.toFixed(2)),
        storyTopPhrases: extractTopPhrases(phraseText, 6)
      };
    })
    .sort((a, b) => new Date(b.featured?.publishedAt) - new Date(a.featured?.publishedAt))
    .slice(0, 12);
};

const buildEngagedStories = (articles = []) => {
  const stories = buildStories(articles);
  const scoreStory = (story) => {
    const sources = new Set(
      (story.articles || [])
        .map((article) => article.source || domainFromUrl(article.link || ""))
        .filter(Boolean)
    );
    return (story.articles || []).length + sources.size * 1.5;
  };
  return stories
    .map((story) => ({
      ...story,
      engagementScore: Number(scoreStory(story).toFixed(2))
    }))
    .sort((a, b) => b.engagementScore - a.engagementScore);
};

const gdeltBaseUrl = "https://api.gdeltproject.org/api/v2/doc/doc";
const gdeltQueryDefaults =
  '(India OR Indian OR "South Asia" OR world OR global OR international)';
const gdeltSortForMode = (mode = "") =>
  mode === "top" ? "HybridRel" : "DateDesc";
const fetchGdelt = async ({ query, mode = "latest", hours = 24 }) => {
  const safeMode = mode === "top" ? "top" : "latest";
  const safeHours = Math.min(72, Math.max(1, Number(hours || 24)));
  const finalQuery = query?.trim() || gdeltQueryDefaults;
  const cacheKey = `${finalQuery}|${safeMode}|${safeHours}`;
  const cached = GDELT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < GDELT_CACHE_TTL) return cached.payload;

  const params = new URLSearchParams({
    query: finalQuery,
    mode: "ArtList",
    maxrecords: "50",
    format: "json",
    timespan: `${safeHours}h`,
    sort: gdeltSortForMode(safeMode)
  });
  const url = `${gdeltBaseUrl}?${params.toString()}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    const articles = (data?.articles || []).map((item) => {
      const link = cleanUrl(item.url || "");
      const sourceInfo = lookupSourceInfo({
        source: item.sourceCountry || item.sourceName || item.domain || "",
        link
      });
      return {
        title: item.title || item.seendate || "Untitled",
        link,
        source: sourceInfo.name,
        sourceDomain: sourceInfo.domain,
        sourceCredibility: sourceInfo.credibility || null,
        industry: sourceInfo.industry || null,
        description: item.excerpt || item.snippet || "",
        image: item.image || "",
        publishedAt: item.seendate
          ? new Date(item.seendate).toISOString()
          : new Date().toISOString()
      };
    });
    const payload = { fetchedAt: Date.now(), articles };
    GDELT_CACHE.set(cacheKey, { at: Date.now(), payload });
    return payload;
  } catch (error) {
    const payload = { fetchedAt: Date.now(), articles: [], error: "gdelt-error" };
    GDELT_CACHE.set(cacheKey, { at: Date.now(), payload });
    return payload;
  }
};

app.get("/methodology", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "methodology.html"));
});

app.get("/api", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "api.html"));
});

app.get("/api/og-image", async (req, res) => {
  const target = (req.query.url || "").toString();
  if (!target) return res.status(400).json({ image: "" });
  if (ogImageCache.has(target))
    return res.json({ image: ogImageCache.get(target) });

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360Bot/1.0"
      }
    });
    const html = await response.text();
    const ogImage = cleanUrl(
      findMetaContent(html, "property", "og:image"),
      target
    );
    const twitterImage = cleanUrl(
      findMetaContent(html, "name", "twitter:image"),
      target
    );
    const fallback = firstImgInHtml(html, target);
    const image = ogImage || twitterImage || fallback || "";
    ogImageCache.set(target, image);
    return res.json({ image });
  } catch {
    ogImageCache.set(target, "");
    return res.json({ image: "" });
  }
});

app.get("/api/gdelt", async (req, res) => {
  const query = (req.query.query || "").toString();
  const mode = (req.query.mode || "latest").toString();
  const hours = Number(req.query.hours || 24);
  const gdelt = await fetchGdelt({ query, mode, hours });
  const enriched = await Promise.all(
    (gdelt.articles || []).map(async (article) => {
      if (!article.link) return article;
      const cached = getCachedArticle(article.link);
      if (cached) return cached;
      const text = `${article.title}. ${article.description}`.trim();
      const { sentiment, explanation } = await scoreSentiment(text, {
        url: article.link
      });
      const category = inferCategory({
        title: article.title,
        link: article.link,
        source: article.source
      });
      const enrichedArticle = {
        ...article,
        sentiment: {
          ...sentiment,
          sentimentLabel: explanation.sentiment_label,
          topPhrases: explanation.top_phrases,
          confidence: explanation.confidence
        },
        sentiment_label: explanation.sentiment_label,
        sentiment_scores: explanation.sentiment_scores,
        confidence: explanation.confidence,
        top_phrases: explanation.top_phrases,
        category
      };
      setCachedArticle(article.link, enrichedArticle, explanation);
      return enrichedArticle;
    })
  );
  res.json({ fetchedAt: gdelt.fetchedAt, articles: enriched });
});

app.get("/api/stories", (req, res) => {
  const includeExp = req.query.experimental === "1";
  const cacheKey = includeExp ? "exp" : "core";
  const cached = STORY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < STORY_CACHE_TTL)
    return res.json({ fetchedAt: cached.at, stories: cached.stories });
  const articles = includeExp
    ? uniqueMerge(CORE.articles, EXP.articles)
    : CORE.articles;
  const stories = buildStories(articles);
  STORY_CACHE.set(cacheKey, { at: Date.now(), stories });
  res.json({ fetchedAt: Date.now(), stories });
});

app.get("/api/engaged", (req, res) => {
  const includeExp = req.query.experimental === "1";
  const articles = includeExp
    ? uniqueMerge(CORE.articles, EXP.articles)
    : CORE.articles;
  const stories = buildEngagedStories(articles);
  res.json({ fetchedAt: Date.now(), stories });
});

app.get("/api/explain", (req, res) => {
  const target = (req.query.url || "").toString();
  if (!target) return res.status(400).json({ error: "missing-url" });
  const key = cleanUrl(target, target);
  const explanation = EXPLANATION_CACHE.get(key);
  if (!explanation)
    return res.status(404).json({ error: "explanation-not-found" });
  return res.json(explanation);
});

app.get("/api/news", (req, res) => {
  const limit = Number(req.query.limit || 200);
  const sentiment = req.query.sentiment;
  const category = (req.query.category || "").toLowerCase();
  const includeExp = req.query.experimental === "1";

  let arts = includeExp
    ? uniqueMerge(CORE.articles, EXP.articles)
    : CORE.articles;
  if (category && category !== "home")
    arts = arts.filter((a) => a.category === category);
  if (sentiment) arts = arts.filter((a) => a.sentiment?.label === sentiment);

  res.json({ fetchedAt: Date.now(), articles: arts.slice(0, limit) });
});

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    at: Date.now(),
    transformer: TRANSFORMER_ENABLED,
    cachedArticles: ARTICLE_CACHE.size,
    feeds: Object.fromEntries(FEED_HEALTH.entries())
  });
});

app.get("/api/topics", (req, res) => {
  const includeExp = req.query.experimental === "1";
  const arts = includeExp
    ? uniqueMerge(CORE.articles, EXP.articles)
    : CORE.articles;
  res.json({ fetchedAt: Date.now(), topics: buildClusters(arts) });
});

app.get("/api/pinned", (_req, res) => {
  res.json({ articles: CORE.articles.slice(0, 3) });
});

/* markets */
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
app.get("/api/markets", async (_req, res) => {
  try {
    const yf = await loadYF();
    const symbols = [
      { s: "^BSESN", pretty: "BSE Sensex" },
      { s: "^NSEI", pretty: "NSE Nifty" },
      { s: "GC=F", pretty: "Gold" },
      { s: "CL=F", pretty: "Crude Oil" },
      { s: "USDINR=X", pretty: "USD/INR" }
    ];
    if (!yf)
      return res.json({
        updatedAt: Date.now(),
        quotes: symbols.map((x) => ({
          symbol: x.s,
          pretty: x.pretty,
          price: null,
          change: null,
          changePercent: null
        }))
      });
    const quotes = await yf.quote(symbols.map((x) => x.s));
    const out = quotes.map((q, i) => ({
      symbol: q.symbol,
      pretty: symbols[i].pretty,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent
    }));
    res.json({ updatedAt: Date.now(), quotes: out });
  } catch {
    res.json({ updatedAt: Date.now(), quotes: [] });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, at: Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Informed360 running on :${PORT}`));
