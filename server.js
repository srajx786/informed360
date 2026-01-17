import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();

const OG_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAYAAABkW7XSAAAACXBIWXMAAAsSAAALEgHS3X78AAABc0lEQVR4nO3QQQ0AAAgDIN8/9K3hHBQ0m2gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4GgkAATx3cGQAAAAASUVORK5CYII=";

app.use((req, res, next) => {
  if (req.hostname === "informed360.news") {
    return res.redirect(301, `https://www.informed360.news${req.originalUrl}`);
  }
  return next();
});

app.get("/og-image.png", (req, res) => {
  try {
    const buf = Buffer.from(OG_IMAGE_PNG_BASE64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).send("og-image error");
  }
});
app.use(cors());
app.use(express.json());

const __dirname = path.resolve();
const LOGO_PATH = path.join(__dirname, "public", "logo.png");
const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
const absoluteUrl = (req, value = "") => {
  if (!value) return "";
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = `${req.protocol}://${req.get("host")}`;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return "";
  }
};

app.get("/logo.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(LOGO_PATH, (err) => {
    if (err) {
      res.status(404).send("logo not found");
    }
  });
});

app.get("/s", (req, res) => {
  const originalUrl = String(req.query.u || "").trim();
  const title = String(req.query.t || "").trim() || "Informed360";
  const source = String(req.query.src || "").trim();
  const imgParam = String(req.query.img || "").trim();
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const shareUrl = new URL(req.originalUrl, baseUrl).href;
  const ogImage = absoluteUrl(req, imgParam) || absoluteUrl(req, "/logo.png");
  const description = `${source ? `${source} · ` : ""}Informed360 — News + Sentiment`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeShareUrl = escapeHtml(shareUrl);
  const safeImage = escapeHtml(ogImage);
  const openUrl = originalUrl || baseUrl;
  const safeOpenUrl = escapeHtml(openUrl);
  res.type("html").send(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>${safeTitle}</title>
        <meta property="og:title" content="${safeTitle}"/>
        <meta property="og:description" content="${safeDescription}"/>
        <meta property="og:image" content="${safeImage}"/>
        <meta property="og:url" content="${safeShareUrl}"/>
        <meta property="og:site_name" content="Informed360"/>
        <meta name="twitter:card" content="summary_large_image"/>
        <style>
          body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;color:#0f172a;margin:0;padding:24px;}
          .card{max-width:520px;margin:32px auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e5e7eb;box-shadow:0 10px 24px rgba(16,24,40,.08);}
          .logo{height:40px;width:auto;margin-bottom:12px;}
          h1{font-size:1.2rem;margin:0 0 8px;}
          p{color:#64748b;margin:0 0 20px;}
          .btn{display:inline-block;background:#1f4fd6;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:600;}
        </style>
      </head>
      <body>
        <div class="card">
          <img class="logo" src="/logo.png" alt="Informed360 logo"/>
          <h1>${safeTitle}</h1>
          <p>${safeDescription}</p>
          <a class="btn" href="${safeOpenUrl}" target="_blank" rel="noopener">Open article</a>
        </div>
      </body>
    </html>`);
});

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
const SOURCE_NAME_MAP = new Map(
  Object.entries(SOURCE_REGISTRY.sources || {}).map(([domain, info]) => [
    info?.name?.toLowerCase?.() || "",
    domain
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
const OG_IMAGE_CACHE_TTL = Number(
  process.env.OG_IMAGE_CACHE_TTL_MS || 6 * 60 * 60 * 1000
);
const TOP_STORY_RELATED_CACHE_TTL = Number(
  process.env.TOP_STORY_RELATED_CACHE_TTL_MS || 10 * 60 * 1000
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARTICLE_CACHE = new Map();
const EXPLANATION_CACHE = new Map();
const STORY_CACHE = new Map();
const GDELT_CACHE = new Map();
const TOP_STORY_RELATED_CACHE = new Map();
const RELATED_COVERAGE_CACHE = new Map();
const COVERAGE_CACHE = new Map();
const FEED_HEALTH = new Map();

let transformerPipeline = null;
const domainFromUrl = (u = "") => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const publisherDomainFromFeed = (u = "") => {
  const host = domainFromUrl(u);
  if (!host) return "";
  if (!host.includes("feedburner.com")) return host;
  const lower = String(u || "").toLowerCase();
  if (lower.includes("ndtv")) return "ndtv.com";
  return host;
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
const isLogoImage = (url = "") => {
  const lower = String(url || "").toLowerCase();
  if (!lower) return true;
  if (lower.startsWith("data:image")) return true;
  if (lower.includes("logo.clearbit.com")) return true;
  if (lower.includes("/logo/")) return true;
  if (lower.includes("favicon")) return true;
  return lower.includes("logo.");
};
const getOgImageCache = (url = "") => {
  const cached = ogImageCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.ts > OG_IMAGE_CACHE_TTL) {
    ogImageCache.delete(url);
    return null;
  }
  return cached;
};
const setOgImageCache = (url = "", image = "") => {
  if (!url) return;
  ogImageCache.set(url, { image, ts: Date.now() });
};
const resolveOgImage = async (target = "") => {
  if (!target) return "";
  const cached = getOgImageCache(target);
  if (cached) return cached.image || "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(target, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360Bot/1.0"
      }
    });
    clearTimeout(timeout);
    const html = await response.text();
    const og = cleanUrl(findMetaContent(html, "property", "og:image"), target);
    const twitter = cleanUrl(findMetaContent(html, "name", "twitter:image"), target);
    const twitterSrc = cleanUrl(findMetaContent(html, "name", "twitter:image:src"), target);
    const fallback = firstImgInHtml(html, target);
    const image = og || twitter || twitterSrc || fallback || "";
    setOgImageCache(target, image);
    return image;
  } catch {
    setOgImageCache(target, "");
    return "";
  }
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

  return "";
};

const getBestImageForArticle = async (article = {}) => {
  const baseUrl = article.link || article.url || "";
  const explicit = cleanUrl(article.imageUrl || article.image || "", baseUrl);
  if (explicit && !isLogoImage(explicit)) return explicit;
  const extracted = extractImage(article);
  const cleaned = cleanUrl(extracted, baseUrl);
  if (cleaned && !isLogoImage(cleaned)) return cleaned;
  const og = await resolveOgImage(baseUrl);
  if (og && !isLogoImage(og)) return og;
  return "/img/thumb-placeholder.svg";
};

const LOCAL_LOGOS = {
  "indiatoday.in": "/logo/indiatoday.png",
  "thehindu.com": "/logo/thehindu.png",
  "scroll.in": "/logo/scroll.png",
  "news18.com": "/logo/news18.png",
  "deccanherald.com": "/logo/deccanherald.png",
  "theprint.in": "/logo/theprint.png",
  "hindustantimes.com": "/logo/hindustantimes.png",
  "timesofindia.indiatimes.com": "/logo/toi.png",
  "indiatoday.com": "/logo/indiatoday.png",
  "indianexpress.com": "/logo/indianexpress.png",
  "ndtv.com": "/logo/ndtv.png",
  "firstpost.com": "/logo/firstpost.png",
  "business-standard.com": "/logo/businessstandard.png",
  "economictimes.indiatimes.com": "/logo/economictimes.png",
  "reuters.com": "/logo/reuters.png",
  "bbc.com": "/logo/bbc.png",
  "aljazeera.com": "/logo/aljazeera.png",
  "thewire.in": "/logo/thewire.png",
  "livemint.com": "/logo/livemint.png",
  "theguardian.com": "/logo/guardian.png",
  "pib.gov.in": "/logo/pib.png"
};

const logoForDomain = (domain = "") => {
  if (!domain) return "";
  if (LOCAL_LOGOS[domain]) return LOCAL_LOGOS[domain];
  return `https://logo.clearbit.com/${domain}`;
};

const sourceDomainForArticle = (article = {}) => {
  const safeArticle = article || {};
  const fromArticle =
    safeArticle.sourceDomain ||
    domainFromUrl(safeArticle.link || "") ||
    SOURCE_NAME_MAP.get((safeArticle.source || "").toLowerCase());
  return fromArticle || "";
};

const logoForArticle = (article = {}) =>
  logoForDomain(sourceDomainForArticle(article));
const domainFromSourceName = (name = "") =>
  SOURCE_NAME_MAP.get(String(name || "").toLowerCase()) || "";

const pickStoryImage = (article = {}) => {
  const candidate = String(article.imageUrl || article.image || "").trim();
  if (!candidate) return "";
  if (isLogoImage(candidate)) return "";
  return candidate;
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
  const domain = domainFromUrl(link || "");
  const override = [
    { match: /bbc\.co\.uk$/i, category: "world" },
    { match: /bbc\.com$/i, category: "world" },
    { match: /reuters\.com$/i, category: "world" },
    { match: /aljazeera\.com$/i, category: "world" },
    { match: /theguardian\.com$/i, category: "world" },
    { match: /wsj\.com$/i, category: "world" },
    { match: /ft\.com$/i, category: "world" },
    { match: /techcrunch\.com$/i, category: "technology" }
  ].find((entry) => entry.match.test(domain));
  if (override) return override.category;
  if (domain.endsWith(".in")) return "india";
  return "world";
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
  const domain = publisherDomainFromFeed(url);
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
      const domain = publisherDomainFromFeed(url);
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
        const image = await getBestImageForArticle(item);
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
          imageUrl: image,
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

const countArticlesByDomain = (articles = []) => {
  const counts = new Map();
  articles.forEach((article) => {
    const domain = sourceDomainForArticle(article) || domainFromUrl(article.link || "");
    if (!domain) return;
    counts.set(domain, (counts.get(domain) || 0) + 1);
  });
  return counts;
};

const buildFeedStatus = (url, counts) => {
  const health = FEED_HEALTH.get(url) || {
    failures: 0,
    lastFailedAt: 0,
    lastOkAt: 0,
    lastError: ""
  };
  const domain = publisherDomainFromFeed(url);
  return {
    url,
    domain,
    health: {
      failures: health.failures || 0,
      lastOkAt: health.lastOkAt || 0,
      lastFailedAt: health.lastFailedAt || 0,
      lastError: health.lastError || null
    },
    recentCount: counts.get(domain) || 0
  };
};

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
const normalizeStoryTitleTokens = (title = "") =>
  tokenize(title).filter((token) => token.length > 2);
const strongTokenOverlap = (a = {}, b = {}) => {
  const tokensA = new Set(
    tokenize(`${a.title || ""} ${a.description || ""}`).filter((token) => token.length > 3)
  );
  const tokensB = new Set(
    tokenize(`${b.title || ""} ${b.description || ""}`).filter((token) => token.length > 3)
  );
  if (!tokensA.size || !tokensB.size) return false;
  let overlap = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) overlap += 1;
  });
  if (overlap >= 3) return true;
  const minSize = Math.max(1, Math.min(tokensA.size, tokensB.size));
  return overlap >= 2 && overlap / minSize >= 0.6;
};
const storySimilarity = (a, b) => {
  let tokensA = new Set(normalizeStoryTitleTokens(a.title));
  let tokensB = new Set(normalizeStoryTitleTokens(b.title));
  if (!tokensA.size || !tokensB.size) {
    tokensA = new Set(storyTokens(`${a.title} ${a.description}`));
    tokensB = new Set(storyTokens(`${b.title} ${b.description}`));
  }
  if (!tokensA.size || !tokensB.size) return 0;
  let overlap = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) overlap += 1;
  });
  const union = tokensA.size + tokensB.size - overlap;
  return union ? overlap / union : 0;
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
  const windowMs = 48 * 60 * 60 * 1000;

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
      return storySimilarity(story.articles[0], article) >= 0.34;
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

const buildRelatedLookup = (articles = []) => {
  const stories = buildStories(articles);
  const relatedMap = new Map();
  stories.forEach((story) => {
    const primary = pickPrimaryArticle(story.articles || []);
    if (!primary?.link) return;
    const related = [];
    const usedSources = new Set();
    const primarySource = sourceDomainForArticle(primary) || primary.source;
    if (primarySource) usedSources.add(primarySource);
    (story.articles || []).forEach((article) => {
      if (related.length >= 3) return;
      if (article.link === primary.link) return;
      const sourceKey = sourceDomainForArticle(article) || article.source;
      if (!sourceKey || usedSources.has(sourceKey)) return;
      usedSources.add(sourceKey);
      related.push(article);
    });
    relatedMap.set(primary.link, related);
  });
  return relatedMap;
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

const pickPrimaryArticle = (articles = []) => {
  const now = Date.now();
  let best = null;
  let bestScore = -Infinity;
  articles.forEach((article) => {
    const hasImage = Boolean(pickStoryImage(article));
    const ageHours = Math.max(
      0.5,
      (now - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60)
    );
    const recencyScore = 1 / ageHours;
    const confidence = Number(article?.sentiment?.confidence ?? 0.35) || 0.35;
    const score =
      (hasImage ? 3 : 0) +
      (article.description ? 1 : 0) +
      (article.title ? 1 : 0) +
      confidence * 2 +
      recencyScore;
    if (score > bestScore) {
      bestScore = score;
      best = article;
    }
  });
  return best || articles[0] || null;
};

const TOP_STORY_STOPWORDS = new Set([
  ...STOPWORDS,
  "live",
  "updates",
  "update",
  "breaking",
  "highlights",
  "recap",
  "explained",
  "watch"
]);
const TOP_STORY_DUPLICATE_THRESHOLD = 0.85;
const TOP_STORY_MIN_SIMILARITY = 0.2;
const TOP_STORY_LOOKBACK_HOURS = 24;
const normalizeTopStoryTitle = (title = "") => {
  const tokens = tokenize(title).filter((token) => !TOP_STORY_STOPWORDS.has(token));
  if (!tokens.length) return "";
  return tokens.slice(0, 8).join(" ");
};
const buildTopStoryQuery = (headline = "") => {
  const tokens = tokenize(headline).filter((token) => !TOP_STORY_STOPWORDS.has(token));
  if (!tokens.length) return "";
  const count = Math.min(10, Math.max(6, tokens.length));
  return tokens.slice(0, count).join(" ");
};
const buildHeadlineQuery = (headline = "") => {
  const tokens = tokenize(headline).filter((token) => !TOP_STORY_STOPWORDS.has(token));
  if (!tokens.length) return "";
  const counts = new Map();
  tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0].length - a[0].length;
  });
  const targetCount = Math.min(10, Math.max(6, sorted.length));
  return sorted.slice(0, targetCount).map(([token]) => token).join(" ");
};
const buildCoverageQueryFromHeadline = (headline = "") => {
  const words = String(headline || "").match(/[A-Za-z0-9]+/g) || [];
  if (!words.length) return "";
  const counts = new Map();
  const meta = new Map();
  words.forEach((word) => {
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower)) return;
    if (lower.length < 3) return;
    counts.set(lower, (counts.get(lower) || 0) + 1);
    const isProper = /^[A-Z][a-z]/.test(word) || /^[A-Z]{2,}$/.test(word);
    const existing = meta.get(lower);
    if (!existing || (isProper && !existing.isProper)) {
      meta.set(lower, { token: word, isProper });
    }
  });
  const ranked = [...counts.entries()]
    .map(([lower, count]) => {
      const info = meta.get(lower) || { token: lower, isProper: false };
      const score =
        count * 2 +
        (info.isProper ? 3 : 0) +
        Math.min(8, info.token.length) * 0.2;
      return { token: info.token, lower, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.token.length - a.token.length;
    });
  const sliceCount = Math.min(
    ranked.length,
    Math.max(4, Math.min(7, ranked.length))
  );
  return ranked.slice(0, sliceCount).map((item) => item.token).join(" ");
};
const normalizeRelatedTitle = (title = "") => {
  const tokens = tokenize(title).filter((token) => !TOP_STORY_STOPWORDS.has(token));
  if (!tokens.length) return "";
  return tokens.slice(0, 10).join(" ");
};
const normalizeTopStoryIdentity = (title = "") => {
  const tokens = tokenize(title).filter((token) => !TOP_STORY_STOPWORDS.has(token));
  if (!tokens.length) return "";
  return tokens.join(" ");
};
const storyTokenSet = (article = {}) => {
  const text = `${article.title || ""} ${article.description || ""}`.trim();
  return new Set(
    tokenize(text)
      .map((token) => token.trim())
      .filter(Boolean)
  );
};
const jaccardSimilarity = (setA, setB) => {
  if (!setA?.size || !setB?.size) return 0;
  let overlap = 0;
  setA.forEach((token) => {
    if (setB.has(token)) overlap += 1;
  });
  const union = setA.size + setB.size - overlap;
  return union ? overlap / union : 0;
};
const isDuplicateStory = (a, b, tokensA, tokensB) => {
  const canonicalA = canonicalizeUrl(a?.link || "");
  const canonicalB = canonicalizeUrl(b?.link || "");
  if (canonicalA && canonicalB && canonicalA === canonicalB) return true;
  const titleKeyA = normalizeTopStoryIdentity(a?.title || "");
  const titleKeyB = normalizeTopStoryIdentity(b?.title || "");
  if (titleKeyA && titleKeyB && titleKeyA === titleKeyB) return true;
  const similarity = jaccardSimilarity(tokensA || storyTokenSet(a), tokensB || storyTokenSet(b));
  return similarity >= TOP_STORY_DUPLICATE_THRESHOLD;
};
const getRelatedCache = (key = "") => {
  const cached = TOP_STORY_RELATED_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - cached.at > TOP_STORY_RELATED_CACHE_TTL) {
    TOP_STORY_RELATED_CACHE.delete(key);
    return null;
  }
  return cached.related || [];
};
const setRelatedCache = (key = "", related = []) => {
  TOP_STORY_RELATED_CACHE.set(key, { at: Date.now(), related });
};
const getRelatedCoverageCache = (key = "") => {
  if (!key) return null;
  const cached = RELATED_COVERAGE_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > TOP_STORY_RELATED_CACHE_TTL) {
    RELATED_COVERAGE_CACHE.delete(key);
    return null;
  }
  return cached.related || [];
};
const setRelatedCoverageCache = (key = "", related = []) => {
  if (!key) return;
  RELATED_COVERAGE_CACHE.set(key, { ts: Date.now(), related });
};
const getCoverageCache = (key = "") => {
  if (!key) return null;
  const cached = COVERAGE_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > TOP_STORY_RELATED_CACHE_TTL) {
    COVERAGE_CACHE.delete(key);
    return null;
  }
  return cached.related || [];
};
const setCoverageCache = (key = "", related = []) => {
  if (!key) return;
  COVERAGE_CACHE.set(key, { ts: Date.now(), related });
};

const buildTopStoryPrimary = (article = {}) => ({
  source: article.source || sourceDomainForArticle(article) || "Source",
  sourceDomain: article.sourceDomain || sourceDomainForArticle(article),
  sourceLogo: article.sourceLogo || logoForArticle(article || {}),
  publishedAt: article.publishedAt,
  url: article.link || "",
  title: article.title || "",
  headline: article.title || "",
  description: article.description || "",
  image: pickStoryImage(article),
  imageUrl: pickStoryImage(article) || article.imageUrl || "",
  sentiment: article.sentiment || { pos: 0, neu: 0, neg: 0 }
});

const buildTopStoryRelated = (article = {}) =>
  buildRelatedPayload(article, article.sentiment || { pos: 0, neu: 0, neg: 0 });

const normalizeTopStoryRelatedItem = (item = {}) => {
  const url = item.url || item.link || "";
  const sourceDomain =
    item.sourceDomain || sourceDomainForArticle(item) || domainFromUrl(url);
  const source = item.source || sourceDomain || "Source";
  const imageUrl =
    pickStoryImage(item) ||
    item.imageUrl ||
    item.image ||
    "/img/thumb-placeholder.svg";
  return {
    source,
    sourceDomain,
    sourceLogo: item.sourceLogo || logoForDomain(sourceDomain) || logoForArticle(item || {}),
    publishedAt: item.publishedAt,
    url,
    title: item.title || item.headline || "",
    headline: item.headline || item.title || "",
    imageUrl,
    sentiment: item.sentiment || { pos: 0, neu: 0, neg: 0 }
  };
};

const buildRelatedForPrimary = (primary = {}, candidates = [], limit = 3, tokensCache) => {
  const primaryTokens = tokensCache.get(primary.link) || storyTokenSet(primary);
  const primaryDomain = sourceDomainForArticle(primary);
  const usedDomains = new Set(primaryDomain ? [primaryDomain] : []);
  const usedTitles = new Set([normalizeTopStoryIdentity(primary.title || "")].filter(Boolean));
  const usedUrls = new Set();
  const canonicalPrimary = canonicalizeUrl(primary.link || "");
  if (canonicalPrimary) usedUrls.add(canonicalPrimary);

  const scored = candidates
    .filter((article) => article?.link && article.link !== primary.link)
    .map((article) => {
      const tokens = tokensCache.get(article.link) || storyTokenSet(article);
      const similarity = jaccardSimilarity(primaryTokens, tokens);
      return { article, similarity, tokens };
    })
    .filter(({ similarity }) => similarity >= TOP_STORY_MIN_SIMILARITY)
    .sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return new Date(b.article.publishedAt) - new Date(a.article.publishedAt);
    });

  const related = [];
  const tryAdd = ({ article, tokens }, allowSameDomain = false) => {
    const domain = sourceDomainForArticle(article) || article.source || "";
    if (!domain) return false;
    if (!allowSameDomain && usedDomains.has(domain)) return false;
    const canonical = canonicalizeUrl(article.link || "");
    if (canonical && usedUrls.has(canonical)) return false;
    const titleKey = normalizeTopStoryIdentity(article.title || "");
    if (titleKey && usedTitles.has(titleKey)) return false;
    if (isDuplicateStory(primary, article, primaryTokens, tokens)) return false;
    usedDomains.add(domain);
    if (canonical) usedUrls.add(canonical);
    if (titleKey) usedTitles.add(titleKey);
    related.push(buildTopStoryRelated(article));
    return true;
  };

  scored.forEach((entry) => {
    if (related.length >= limit) return;
    tryAdd(entry, false);
  });
  if (related.length < limit) {
    scored.forEach((entry) => {
      if (related.length >= limit) return;
      tryAdd(entry, true);
    });
  }
  return related.slice(0, limit);
};

const buildTopStories = (articles = [], { limit = 8, relatedLimit = 3, hours = TOP_STORY_LOOKBACK_HOURS } = {}) => {
  const now = Date.now();
  const recentCandidates = articles.filter((article) => {
    const time = new Date(article.publishedAt).getTime();
    if (Number.isNaN(time)) return false;
    return now - time <= hours * 60 * 60 * 1000;
  });
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const tokensCache = new Map();
  recentCandidates.forEach((article) => {
    if (article?.link) tokensCache.set(article.link, storyTokenSet(article));
  });
  const selected = [];
  const selectedTokens = [];
  const usedTitles = new Set();
  const usedUrls = new Set();

  for (const article of sorted) {
    if (selected.length >= limit) break;
    if (!article?.link) continue;
    const canonical = canonicalizeUrl(article.link || "");
    if (canonical && usedUrls.has(canonical)) continue;
    const titleKey = normalizeTopStoryIdentity(article.title || "");
    if (titleKey && usedTitles.has(titleKey)) continue;
    const tokens = tokensCache.get(article.link) || storyTokenSet(article);
    if (
      selectedTokens.some(
        (existing) => jaccardSimilarity(existing, tokens) >= TOP_STORY_DUPLICATE_THRESHOLD
      )
    )
      continue;
    const related = buildRelatedForPrimary(article, recentCandidates, relatedLimit, tokensCache);
    selected.push({
      primary: buildTopStoryPrimary(article),
      related
    });
    if (canonical) usedUrls.add(canonical);
    if (titleKey) usedTitles.add(titleKey);
    selectedTokens.push(tokens);
  }
  return selected;
};

const buildTopStoryClusters = (articles = []) => {
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const clusters = [];
  const clusterKeyMap = new Map();
  const windowMs = 36 * 60 * 60 * 1000;

  sorted.forEach((article) => {
    const canonical = canonicalizeUrl(article.link || "");
    const normalizedTitle = normalizeTopStoryTitle(article.title || "");
    let match = null;
    if (canonical) {
      match = clusters.find((cluster) => cluster.canonicalUrls.has(canonical));
    }
    if (!match && normalizedTitle && clusterKeyMap.has(normalizedTitle)) {
      const candidate = clusterKeyMap.get(normalizedTitle);
      const timeDiff =
        Math.abs(
          new Date(candidate.latestAt).getTime() -
            new Date(article.publishedAt).getTime()
        ) || 0;
      if (timeDiff <= windowMs) {
        match = candidate;
      }
    }
    if (!match) {
      match = clusters.find((cluster) => {
        if (!cluster.articles.length) return false;
        const timeDiff =
          Math.abs(
            new Date(cluster.latestAt).getTime() -
              new Date(article.publishedAt).getTime()
          ) || 0;
        if (timeDiff > windowMs) return false;
        if (canonical && cluster.canonicalUrls.has(canonical)) return true;
        if (normalizedTitle && cluster.keys.has(normalizedTitle)) return true;
        const similarity = storySimilarity(cluster.articles[0], article);
        if (similarity >= 0.35) return true;
        return strongTokenOverlap(cluster.articles[0], article);
      });
    }
    if (!match) {
      match = {
        storyId: crypto
          .createHash("md5")
          .update(`${article.title}-${article.link}`)
          .digest("hex")
          .slice(0, 10),
        canonicalTitle: article.title || "Top story",
        canonicalUrls: new Set(canonical ? [canonical] : []),
        keys: new Set(normalizedTitle ? [normalizedTitle] : []),
        latestAt: article.publishedAt,
        articles: []
      };
      clusters.push(match);
    }
    if (canonical) match.canonicalUrls.add(canonical);
    if (normalizedTitle) {
      match.keys.add(normalizedTitle);
      clusterKeyMap.set(normalizedTitle, match);
    }
    match.articles.push(article);
    if (new Date(article.publishedAt) > new Date(match.latestAt))
      match.latestAt = article.publishedAt;
  });

  return clusters.map((cluster) => {
    const articlesSorted = cluster.articles.sort(
      (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
    );
    const primary = pickPrimaryArticle(articlesSorted);
    const primaryDomain = sourceDomainForArticle(primary || {});
    const related = [];
    const usedSources = new Set(primaryDomain ? [primaryDomain] : []);
    articlesSorted.forEach((article) => {
      if (related.length >= 4) return;
      if (article.link === primary?.link) return;
      const sourceKey = sourceDomainForArticle(article) || article.source || "";
      if (!sourceKey || usedSources.has(sourceKey)) return;
      usedSources.add(sourceKey);
      related.push({
        source: article.source || sourceKey || "Source",
        sourceDomain: sourceDomainForArticle(article),
        sourceLogo: logoForArticle(article || {}),
        publishedAt: article.publishedAt,
        url: article.link,
        title: article.title || "",
        description: article.description || "",
        image: pickStoryImage(article),
        sentiment: article.sentiment || { pos: 0, neu: 0, neg: 0 }
      });
    });
    const { sentiment } = weightedSentiment(articlesSorted);
    const fallbackImage =
      pickStoryImage(primary) ||
      pickStoryImage(articlesSorted[0] || {}) ||
      "";
    return {
      storyId: cluster.storyId,
      headline: primary?.title || cluster.canonicalTitle,
      imageUrl: fallbackImage,
      sentiment,
      primary: {
        source: primary?.source || primaryDomain || "Source",
        sourceLogo: logoForArticle(primary || {}),
        publishedAt: primary?.publishedAt || cluster.latestAt,
        url: primary?.link || "",
        title: primary?.title || cluster.canonicalTitle,
        description: primary?.description || "",
        image: pickStoryImage(primary),
        sentiment: primary?.sentiment || sentiment
      },
      related,
      sourceCount: new Set(
        articlesSorted
          .map((article) => sourceDomainForArticle(article) || article.source)
          .filter(Boolean)
      ).size,
      articleCount: articlesSorted.length,
      latestAt: cluster.latestAt
    };
  });
};

const gdeltBaseUrl = "https://api.gdeltproject.org/api/v2/doc/doc";
const gdeltQueryDefaults =
  '(India OR Indian OR "South Asia" OR world OR global OR international)';
const gdeltSortForMode = (mode = "") =>
  mode === "top" ? "HybridRel" : "DateDesc";
const fetchGdelt = async ({
  query,
  mode = "latest",
  hours = 24,
  max = 50
}) => {
  const safeMode = mode === "top" ? "top" : "latest";
  const safeHours = Math.min(72, Math.max(1, Number(hours || 24)));
  const safeMax = Math.min(100, Math.max(5, Number(max || 50)));
  const finalQuery = query?.trim() || gdeltQueryDefaults;
  const cacheKey = `${finalQuery}|${safeMode}|${safeHours}|${safeMax}`;
  const cached = GDELT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < GDELT_CACHE_TTL) return cached.payload;

  const params = new URLSearchParams({
    query: finalQuery,
    mode: "ArtList",
    maxrecords: String(safeMax),
    format: "json",
    timespan: `${safeHours}h`,
    sort: gdeltSortForMode(safeMode)
  });
  const url = `${gdeltBaseUrl}?${params.toString()}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360Bot/1.0",
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9"
      }
    });
    clearTimeout(timeout);
    const bodyText = await response.text();
    if (!response.ok) {
      console.log("GDELT HTTP", response.status, url);
      const payload = {
        fetchedAt: Date.now(),
        articles: [],
        error: "gdelt-http",
        status: response.status,
        bodySnippet: bodyText.slice(0, 200)
      };
      GDELT_CACHE.set(cacheKey, { at: Date.now(), payload });
      return payload;
    }
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch (error) {
      console.log("GDELT JSON parse error", bodyText.slice(0, 200));
      const payload = {
        fetchedAt: Date.now(),
        articles: [],
        error: "gdelt-json",
        bodySnippet: bodyText.slice(0, 200)
      };
      GDELT_CACHE.set(cacheKey, { at: Date.now(), payload });
      return payload;
    }
    const rawArticles = data?.articles || data?.data?.articles || [];
    const articles = await Promise.all(
      rawArticles.map(async (item) => {
        const link = cleanUrl(item.url || "");
        const sourceInfo = lookupSourceInfo({
          source: item.sourceCountry || item.sourceName || item.domain || "",
          link
        });
        const image = await getBestImageForArticle({
          link,
          image: item.image || ""
        });
        return {
          title: item.title || item.seendate || "Untitled",
          link,
          source: sourceInfo.name,
          sourceDomain: sourceInfo.domain,
          sourceCredibility: sourceInfo.credibility || null,
          industry: sourceInfo.industry || null,
          description: item.excerpt || item.snippet || "",
          image,
          imageUrl: image,
          publishedAt: item.seendate
            ? new Date(item.seendate).toISOString()
            : new Date().toISOString()
        };
      })
    );
    const payload = { fetchedAt: Date.now(), articles };
    GDELT_CACHE.set(cacheKey, { at: Date.now(), payload });
    return payload;
  } catch (error) {
    const payload = {
      fetchedAt: Date.now(),
      articles: [],
      error: "gdelt-error"
    };
    GDELT_CACHE.set(cacheKey, { at: Date.now(), payload });
    return payload;
  }
};

const relatedSourceKey = (item = {}) =>
  sourceDomainForArticle({
    link: item.url || item.link || "",
    source: item.source || "",
    sourceDomain: item.sourceDomain || ""
  }) || domainFromUrl(item.url || item.link || "") || item.source || "";

const buildRelatedPayload = (article = {}, sentiment) => ({
  source: article.source || sourceDomainForArticle(article) || "Source",
  sourceDomain: article.sourceDomain || sourceDomainForArticle(article),
  sourceLogo: article.sourceLogo || logoForArticle(article || {}),
  publishedAt: article.publishedAt,
  url: article.link || "",
  title: article.title || "",
  headline: article.title || "",
  description: article.description || "",
  image: pickStoryImage(article),
  imageUrl: pickStoryImage(article) || article.imageUrl || "",
  sentiment: sentiment || article.sentiment || { pos: 0, neu: 0, neg: 0 }
});

const buildCoverageCacheKey = (headline = "", hours = 72, max = 20) =>
  `coverage:${normalize(headline)}:${hours}:${max}`;

const fetchCoverageForHeadline = async (
  headline = "",
  { hours = 72, max = 20 } = {}
) => {
  const query = buildCoverageQueryFromHeadline(headline);
  const cacheKey = buildCoverageCacheKey(headline, hours, max);
  const cached = getCoverageCache(cacheKey);
  if (cached) return cached;

  const merged = [];
  const usedDomains = new Set();
  const usedUrls = new Set();
  const tokens = new Set(tokenize(headline).filter((token) => token.length > 2));
  const now = Date.now();
  const windowMs = hours * 60 * 60 * 1000;

  const addCandidate = (item) => {
    if (!item?.url && !item?.link) return;
    const url = item.url || item.link;
    const domain = relatedSourceKey(item);
    const canonical = canonicalizeUrl(url);
    if (!domain) return;
    if (usedDomains.has(domain)) return;
    if (canonical && usedUrls.has(canonical)) return;
    usedDomains.add(domain);
    if (canonical) usedUrls.add(canonical);
    merged.push(item);
  };

  const localArticles = uniqueMerge(CORE.articles || [], EXP.articles || []);
  const localMatches = localArticles.filter((article) => {
    const publishedAt = new Date(article.publishedAt).getTime();
    if (!Number.isNaN(publishedAt) && now - publishedAt > windowMs) return false;
    const articleTokens = storyTokenSet(article);
    let overlap = 0;
    tokens.forEach((token) => {
      if (articleTokens.has(token)) overlap += 1;
    });
    return overlap >= 2;
  });
  localMatches.forEach((article) => {
    addCandidate(buildRelatedPayload(article, article.sentiment));
  });

  if (query) {
    const gdelt = await fetchGdelt({ query, hours, max });
    for (const article of gdelt.articles || []) {
      if (merged.length >= max) break;
      const enriched = await enrichRelatedCandidate({
        ...article,
        imageUrl: article.imageUrl || article.image
      });
      if (!enriched) continue;
      addCandidate(enriched);
    }
  }

  const limited = merged.slice(0, max);
  setCoverageCache(cacheKey, limited);
  return limited;
};

const GOOGLE_NEWS_HOST = "news.google.com";
const extractGoogleNewsTarget = (link = "") => {
  if (!link) return "";
  try {
    const url = new URL(link);
    if (!url.hostname.includes(GOOGLE_NEWS_HOST)) return link;
    const target = url.searchParams.get("url");
    if (target) return cleanUrl(target, target);
    return link;
  } catch {
    return link;
  }
};
const buildGoogleNewsSearchUrl = (query = "") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-IN&gl=IN&ceid=IN:en`;
const fetchGoogleNewsSearch = async (query = "") => {
  if (!query) return [];
  try {
    const feed = await parseURL(buildGoogleNewsSearchUrl(query));
    const items = feed.items || [];
    const enriched = await Promise.all(
      items.map(async (item) => {
        const link = cleanUrl(item.link || item.guid || "", item.link || "");
        const resolved = extractGoogleNewsTarget(link);
        const sourceUrl = item.source?.url || "";
        const image = await getBestImageForArticle({ ...item, link: resolved });
        return {
          title: item.title || "",
          link: resolved,
          source: item.source?.title || domainFromUrl(sourceUrl) || "Source",
          sourceDomain: domainFromUrl(sourceUrl || resolved),
          description: item.contentSnippet || item.summary || "",
          image,
          imageUrl: image,
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString()
        };
      })
    );
    return enriched;
  } catch {
    return [];
  }
};

const normalizeRelatedCacheKey = (headline = "") => normalize(headline);
const GDELT_EMPTY_LOGGED = new Set();
const uniqueRelatedByDomain = (items = []) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    const url = item?.url || item?.link || "";
    const domain = domainFromUrl(url);
    if (!domain) return false;
    if (seen.has(domain)) return false;
    seen.add(domain);
    return true;
  });
};
const shouldSkipRelatedCandidate = ({
  domain,
  primaryDomain,
  usedDomains,
  url,
  usedUrls,
  title,
  usedTitles
}) => {
  if (!domain || domain === GOOGLE_NEWS_HOST) return true;
  if (primaryDomain && domain === primaryDomain) return true;
  if (usedDomains.has(domain)) return true;
  const canonical = canonicalizeUrl(url || "");
  if (canonical && usedUrls.has(canonical)) return true;
  const normalizedTitle = normalizeRelatedTitle(title || "");
  if (normalizedTitle && usedTitles.has(normalizedTitle)) return true;
  return false;
};
const registerRelatedCandidate = ({
  domain,
  usedDomains,
  url,
  usedUrls,
  title,
  usedTitles
}) => {
  usedDomains.add(domain);
  const canonical = canonicalizeUrl(url || "");
  if (canonical) usedUrls.add(canonical);
  const normalizedTitle = normalizeRelatedTitle(title || "");
  if (normalizedTitle) usedTitles.add(normalizedTitle);
};
const enrichRelatedCandidate = async (article = {}) => {
  if (!article?.link) return null;
  const cachedArticle = getCachedArticle(article.link);
  if (cachedArticle) return buildRelatedPayload(cachedArticle, cachedArticle.sentiment);
  const text = `${article.title || ""}. ${article.description || ""}`.trim();
  const { sentiment, explanation } = await scoreSentiment(text, {
    url: article.link
  });
  const imageUrl = await getBestImageForArticle(article);
  const category = inferCategory({
    title: article.title,
    link: article.link,
    source: article.source
  });
  const enrichedArticle = {
    ...article,
    category,
    image: imageUrl,
    imageUrl,
    sentiment: {
      ...sentiment,
      sentimentLabel: explanation.sentiment_label,
      topPhrases: explanation.top_phrases,
      confidence: explanation.confidence
    }
  };
  setCachedArticle(article.link, enrichedArticle, explanation);
  return buildRelatedPayload(enrichedArticle, enrichedArticle.sentiment);
};

async function fillRelatedSources({
  headline = "",
  primaryUrl = "",
  primaryDomain = "",
  existingRelated = [],
  hours = 24
}) {
  const cacheKey = normalizeRelatedCacheKey(headline || primaryUrl || "");
  const cached = getRelatedCoverageCache(cacheKey);
  if (cached) return cached.slice(0, 2);

  const related = [];
  const usedDomains = new Set(primaryDomain ? [primaryDomain] : []);
  const usedTitles = new Set();
  const usedUrls = new Set();

  (existingRelated || []).forEach((item) => {
    if (related.length >= 2) return;
    const domain = relatedSourceKey(item);
    if (
      shouldSkipRelatedCandidate({
        domain,
        primaryDomain,
        usedDomains,
        url: item.url,
        usedUrls,
        title: item.title,
        usedTitles
      })
    )
      return;
    registerRelatedCandidate({
      domain,
      usedDomains,
      url: item.url,
      usedUrls,
      title: item.title,
      usedTitles
    });
    related.push(item);
  });

  if (related.length < 2) {
    const query = buildHeadlineQuery(headline);
    const gdelt = await fetchGdelt({ query, hours, max: 50 });
    const gdeltArticles = gdelt.articles || [];
    if (!gdeltArticles.length && query && !GDELT_EMPTY_LOGGED.has(query)) {
      console.warn("[Top Stories] GDELT returned 0", { query, count: 0 });
      GDELT_EMPTY_LOGGED.add(query);
    }
    for (const article of gdeltArticles.slice(0, 20)) {
      if (related.length >= 2) break;
      const domain = sourceDomainForArticle(article) || domainFromUrl(article.link || "");
      if (
        shouldSkipRelatedCandidate({
          domain,
          primaryDomain,
          usedDomains,
          url: article.link,
          usedUrls,
          title: article.title,
          usedTitles
        })
      )
        continue;
      const enriched = await enrichRelatedCandidate(article);
      if (!enriched) continue;
      registerRelatedCandidate({
        domain,
        usedDomains,
        url: enriched.url,
        usedUrls,
        title: enriched.title,
        usedTitles
      });
      related.push(enriched);
      if (related.length >= 2) break;
    }
  }

  if (related.length < 2) {
    const query = buildHeadlineQuery(headline);
    const rssArticles = await fetchGoogleNewsSearch(query);
    for (const article of rssArticles.slice(0, 20)) {
      if (related.length >= 2) break;
      if (!article?.link) continue;
      const domain = article.sourceDomain || domainFromUrl(article.link || "");
      if (
        shouldSkipRelatedCandidate({
          domain,
          primaryDomain,
          usedDomains,
          url: article.link,
          usedUrls,
          title: article.title,
          usedTitles
        })
      )
        continue;
      const enriched = await enrichRelatedCandidate(article);
      if (!enriched) continue;
      registerRelatedCandidate({
        domain,
        usedDomains,
        url: enriched.url,
        usedUrls,
        title: enriched.title,
        usedTitles
      });
      related.push(enriched);
      if (related.length >= 2) break;
    }
  }

  setRelatedCoverageCache(cacheKey, related.slice(0, 2));
  return related.slice(0, 2);
}

async function ensureRelatedSources(cluster = {}) {
  const primaryUrl = cluster.primary?.url || cluster.primary?.link || "";
  const primaryDomain =
    domainFromUrl(primaryUrl) || domainFromSourceName(cluster.primary?.source);
  const headline = cluster.headline || cluster.primary?.title || "";
  let related = (cluster.related || []).filter((item) => {
    const url = item?.url || item?.link || "";
    const domain = domainFromUrl(url);
    return domain && domain !== primaryDomain;
  });
  related = uniqueRelatedByDomain(related).slice(0, 2);
  let tried = ["rss"];

  if (related.length < 2) {
    const fetched = await fillRelatedSources({
      headline,
      primaryUrl,
      primaryDomain,
      existingRelated: related,
      hours: 24
    });
    related = uniqueRelatedByDomain([...(related || []), ...(fetched || [])]).slice(0, 2);
    tried = ["rss", "gdelt", "googlerss"];
  }

  if (related.length < 2) {
    cluster.relatedDebug = {
      primaryDomain,
      found: related.length,
      tried
    };
  }

  return related.slice(0, 2);
}

const buildGdeltRelated = async (headline = "") => {
  const query = buildTopStoryQuery(headline);
  if (!query) return [];
  const cached = getRelatedCache(query);
  if (cached) return cached;

  const gdelt = await fetchGdelt({ query, mode: "latest", hours: 24, max: 30 });
  const candidates = [];
  const seenTitles = new Set();
  const seenUrls = new Set();

  for (const article of gdelt.articles || []) {
    if (!article?.link) continue;
    const canonical = canonicalizeUrl(article.link);
    if (canonical && seenUrls.has(canonical)) continue;
    const normalizedTitle = normalizeRelatedTitle(article.title || "");
    if (normalizedTitle && seenTitles.has(normalizedTitle)) continue;
    if (canonical) seenUrls.add(canonical);
    if (normalizedTitle) seenTitles.add(normalizedTitle);
    candidates.push(article);
  }

  const enriched = [];
  for (const article of candidates) {
    const cachedArticle = getCachedArticle(article.link);
    if (cachedArticle) {
      enriched.push(buildRelatedPayload(cachedArticle, cachedArticle.sentiment));
      continue;
    }
    const text = `${article.title || ""}. ${article.description || ""}`.trim();
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
      category,
      sentiment: {
        ...sentiment,
        sentimentLabel: explanation.sentiment_label,
        topPhrases: explanation.top_phrases,
        confidence: explanation.confidence
      }
    };
    setCachedArticle(article.link, enrichedArticle, explanation);
    enriched.push(buildRelatedPayload(enrichedArticle, enrichedArticle.sentiment));
  }

  setRelatedCache(query, enriched);
  return enriched;
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
  const cached = getOgImageCache(target);
  if (cached) return res.json({ image: cached.image || "" });
  const image = await resolveOgImage(target);
  return res.json({ image });
});

app.get("/api/gdelt", async (req, res) => {
  const query = (req.query.q || req.query.query || "").toString();
  const mode = (req.query.mode || "latest").toString();
  const hours = Number(req.query.hours || 24);
  const max = Number(req.query.max || 50);
  const gdelt = await fetchGdelt({ query, mode, hours, max });
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
  res.json({
    fetchedAt: gdelt.fetchedAt,
    articles: enriched,
    error: gdelt.error,
    status: gdelt.status,
    bodySnippet: gdelt.bodySnippet
  });
});

app.get("/api/top-stories", async (req, res) => {
  const scope = (req.query.scope || "india").toString().toLowerCase();
  const type = (req.query.type || "recent").toString().toLowerCase();
  const includeExp = req.query.experimental === "1";
  let articles = includeExp
    ? uniqueMerge(CORE.articles, EXP.articles)
    : CORE.articles;
  if (scope === "world") {
    articles = articles.filter((article) => article.category === "world");
  } else if (scope === "india") {
    articles = articles.filter((article) => article.category === "india");
  }
  const topStories = buildTopStories(articles, {
    limit: 4,
    relatedLimit: 3,
    hours: TOP_STORY_LOOKBACK_HOURS
  });
  const enriched = [];
  for (const cluster of topStories) {
    const primary = cluster?.primary || {};
    const primaryUrl = primary.url || primary.link || "";
    const primaryDomain =
      primary.sourceDomain || sourceDomainForArticle(primary) || domainFromUrl(primaryUrl);
    const normalizedRelated = (cluster.related || []).map((item) =>
      normalizeTopStoryRelatedItem(item)
    );
    let related = [];
    const usedDomains = new Set(primaryDomain ? [primaryDomain] : []);
    const usedUrls = new Set();
    const canonicalPrimary = canonicalizeUrl(primaryUrl);
    if (canonicalPrimary) usedUrls.add(canonicalPrimary);
    const addRelated = (item) => {
      const url = item.url || item.link || "";
      const domain = item.sourceDomain || relatedSourceKey(item);
      if (!domain || usedDomains.has(domain)) return false;
      const canonical = canonicalizeUrl(url);
      if (canonical && usedUrls.has(canonical)) return false;
      usedDomains.add(domain);
      if (canonical) usedUrls.add(canonical);
      related.push(item);
      return true;
    };
    normalizedRelated.forEach((item) => {
      if (related.length >= 2) return;
      addRelated(item);
    });
    if (related.length < 2) {
      const coverage = await fetchCoverageForHeadline(primary?.title || "", {
        hours: 72,
        max: 20
      });
      coverage.map(normalizeTopStoryRelatedItem).forEach((item) => {
        if (related.length >= 2) return;
        addRelated(item);
      });
    }
    related = related.slice(0, 2);
    enriched.push({
      ...cluster,
      primary: {
        ...primary,
        imageUrl:
          pickStoryImage(primary) ||
          primary.imageUrl ||
          primary.image ||
          "/img/thumb-placeholder.svg"
      },
      related
    });
  }
  res.json({
    fetchedAt: Date.now(),
    topStories: enriched,
    mode: type
  });
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

  const relatedLookup = buildRelatedLookup(arts);
  const payload = arts.slice(0, limit).map((article) => {
    const related = relatedLookup.get(article.link);
    const imageUrl =
      article.imageUrl ||
      article.image ||
      pickStoryImage(article) ||
      "/img/thumb-placeholder.svg";
    const normalized = { ...article, imageUrl, image: imageUrl };
    return related?.length ? { ...normalized, related } : normalized;
  });

  res.json({ fetchedAt: Date.now(), articles: payload });
});

app.get("/api/sources", (_req, res) => {
  const counts = countArticlesByDomain(CORE.articles || []);
  res.json({
    refreshMinutes: FEEDS.refreshMinutes || 10,
    feeds: {
      core: (FEEDS.feeds || []).map((url) => buildFeedStatus(url, counts)),
      experimental: (FEEDS.experimental || []).map((url) =>
        buildFeedStatus(url, counts)
      )
    }
  });
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
const lastKnownQuotes = new Map();
const fs = require("fs");
const marketCachePath = "Backup/market_cache.json";
const readPersistedCache = () => {
  try {
    const raw = fs.readFileSync(marketCachePath, "utf8"); // persisted cache
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.quotes) ? parsed.quotes : [];
  } catch {
    return [];
  }
};
const writePersistedCache = (quotes) => {
  try {
    fs.writeFileSync(
      marketCachePath,
      JSON.stringify({ updatedAt: Date.now(), quotes }, null, 2)
    ); // persisted cache
  } catch {
    return null;
  }
};
const toNumber = (value) => {
  // robust numeric parsing
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
app.get("/api/markets", async (_req, res) => {
  const symbols = [
    { s: "^BSESN", pretty: "BSE Sensex" },
    { s: "^NSEI", pretty: "NSE Nifty" },
    { s: "GC=F", pretty: "Gold" },
    { s: "CL=F", pretty: "Crude Oil" },
    { s: "USDINR=X", pretty: "USD/INR" }
  ];
  const now = Date.now();
  const upstreamBase = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=";
  const upstreamUrl = `${upstreamBase}${encodeURIComponent(symbols.map((x) => x.s).join(","))}`;
  const seedPrices = {
    "USDINR=X": 83.0,
    "GC=F": 2000.0,
    "CL=F": 75.0
  };
  try {
    let fetched = [];
    let response;
    let bodyText = "";
    let contentType = "unknown";
    const persisted = readPersistedCache();
    const persistedBySymbol = new Map(
      persisted.filter((q) => q?.symbol).map((q) => [q.symbol, q])
    );
    try {
      response = await fetch(upstreamUrl);
      contentType = response.headers.get("content-type") || "unknown";
      bodyText = await response.text();
      const isHtmlBlocked = !contentType.includes("application/json") || bodyText.trim().startsWith("<"); // detect HTML block
      if (isHtmlBlocked) {
        symbols.forEach((x) => console.error("[markets upstream blocked]", { symbol: x.s, url: upstreamUrl, status: response.status, contentType, bodyHead: bodyText.slice(0, 200) })); // debug upstream failure
      } else {
        try {
          const parsed = JSON.parse(bodyText);
          fetched = Array.isArray(parsed?.quoteResponse?.result)
            ? parsed.quoteResponse.result
            : [];
        } catch {
          symbols.forEach((x) => console.error("[markets json parse fail]", { symbol: x.s, url: upstreamUrl, status: response.status, contentType, bodyHead: bodyText.slice(0, 200) })); // debug upstream failure
          fetched = [];
        }
      }
    } catch {
      symbols.forEach((x) => console.error("[markets upstream blocked]", { symbol: x.s, url: upstreamUrl, status: "fetch_error", contentType: "unknown", bodyHead: "" })); // debug upstream failure
      fetched = [];
    }
    let fxFallback = null;
    try {
      const fxResponse = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=INR");
      const fxBody = await fxResponse.json();
      fxFallback = toNumber(fxBody?.rates?.INR);
    } catch {
      fxFallback = null;
    }
    let teFallbacks = new Map();
    const teKey = process.env.TRADING_ECONOMICS_KEY;
    if (teKey) {
      try {
        const teResponse = await fetch(`https://api.tradingeconomics.com/markets/snapshots?c=${encodeURIComponent(teKey)}&f=json`);
        const teBody = await teResponse.json();
        if (Array.isArray(teBody)) {
          teFallbacks = new Map(
            teBody
              .filter((item) => item?.Symbol || item?.Ticker)
              .map((item) => [item.Symbol || item.Ticker, item])
          );
        }
      } catch {
        teFallbacks = new Map();
      }
    }
    const fetchedBySymbol = new Map(
      fetched
        .filter((q) => q?.symbol)
        .map((q) => [q.symbol, q])
    );
    let anyNumericPrice = false;
    const out = symbols.map((x) => {
      // Always return the fixed symbol set with cached fallbacks.
      const cached = lastKnownQuotes.get(x.s);
      const q = fetchedBySymbol.get(x.s);
      const price = toNumber(q?.regularMarketPrice);
      const hasValidPrice = Number.isFinite(price);
      const marketState = q?.marketState || q?.regularMarketState;
      const isClosed =
        typeof marketState === "string" &&
        marketState.toUpperCase() !== "REGULAR";
      if (hasValidPrice && !isClosed) {
        const liveQuote = {
          symbol: x.s,
          pretty: x.pretty,
          price,
          change: toNumber(q?.regularMarketChange),
          changePercent: toNumber(q?.regularMarketChangePercent) ?? 0,
          status: "live",
          updatedAt: now
        };
        lastKnownQuotes.set(x.s, liveQuote); // Cache only confirmed live prices.
        anyNumericPrice = true;
        return liveQuote;
      }
      if ((hasValidPrice && isClosed) || cached) {
        if (!hasValidPrice) {
          console.error("[markets no numeric price]", { symbol: x.s, parsedKeys: Object.keys(q || {}) }); // debug upstream failure
        }
        anyNumericPrice = true;
        return {
          symbol: x.s,
          pretty: x.pretty,
          price: cached?.price ?? (hasValidPrice ? price : null),
          change: cached?.change ?? toNumber(q?.regularMarketChange),
          changePercent: cached?.changePercent ?? (toNumber(q?.regularMarketChangePercent) ?? 0),
          status: isClosed ? "closed" : cached?.status || "live",
          updatedAt: cached?.updatedAt || now
        };
      }
      if (x.s === "USDINR=X" && Number.isFinite(fxFallback)) {
        anyNumericPrice = true;
        return {
          symbol: x.s,
          pretty: x.pretty,
          price: fxFallback, // API fallback
          change: null,
          changePercent: 0,
          status: "unavailable",
          updatedAt: now
        };
      }
      if ((x.s === "GC=F" || x.s === "CL=F") && teFallbacks.size) {
        const teItem = teFallbacks.get(x.s);
        const tePrice = toNumber(teItem?.Last || teItem?.Value || teItem?.Price);
        if (Number.isFinite(tePrice)) {
          anyNumericPrice = true;
          return {
            symbol: x.s,
            pretty: x.pretty,
            price: tePrice, // API fallback
            change: null,
            changePercent: 0,
            status: "unavailable",
            updatedAt: now
          };
        }
      }
      if (q && !hasValidPrice) {
        console.error("[markets no numeric price]", { symbol: x.s, parsedKeys: Object.keys(q || {}) }); // debug upstream failure
      }
      const seedPrice = seedPrices[x.s];
      return {
        symbol: x.s,
        pretty: x.pretty,
        price: seedPrice ?? null, // seed fallback to avoid cold-start blanks on Render restarts
        change: null,
        changePercent: 0,
        status: "unavailable",
        updatedAt: now
      };
    });
    const persistedFallback = out.map((quote) => {
      const cached = persistedBySymbol.get(quote.symbol);
      if (cached?.price != null) {
        return { ...quote, price: cached.price, change: cached.change ?? quote.change, changePercent: cached.changePercent ?? quote.changePercent, status: "closed", updatedAt: cached.updatedAt || now };
      }
      return quote;
    });
    const responseQuotes = anyNumericPrice ? out : persistedFallback;
    if (anyNumericPrice) {
      writePersistedCache(out.filter((q) => typeof q?.price === "number")); // persisted cache
    }
    res.json({ updatedAt: now, quotes: responseQuotes });
  } catch {
    const persisted = readPersistedCache();
    const persistedBySymbol = new Map(
      persisted.filter((q) => q?.symbol).map((q) => [q.symbol, q])
    );
    const fallback = symbols.map((x) => {
      const cached = lastKnownQuotes.get(x.s);
      const persistedQuote = persistedBySymbol.get(x.s);
      if (cached) {
        return { ...cached, pretty: x.pretty, status: cached.status || "live" };
      }
      if (persistedQuote) {
        return { ...persistedQuote, pretty: x.pretty, status: "closed" };
      }
      return {
        symbol: x.s,
        pretty: x.pretty,
        price: seedPrices[x.s] ?? null,
        change: null,
        changePercent: 0,
        status: "unavailable",
        updatedAt: now
      };
    });
    res.json({ updatedAt: now, quotes: fallback });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, at: Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Informed360 running on :${PORT}`));
