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

const TRANSFORMER_ENABLED = String(process.env.TRANSFORMER_ENABLED || "").toLowerCase();
const USE_TRANSFORMER = ["1", "true", "yes", "on"].includes(TRANSFORMER_ENABLED);
if (!USE_TRANSFORMER) {
  console.log("Transformer disabled (TRANSFORMER_ENABLED=0). Using VADER only.");
}
const TRANSFORMER_MODEL =
  process.env.TRANSFORMER_MODEL ||
  "Xenova/distilbert-base-uncased-finetuned-sst-2-english";
const TRANSFORMER_TIMEOUT_MS = Number(process.env.TRANSFORMER_TIMEOUT_MS || 1400);
const TRANSFORMER_MAX_TOKENS = Number(process.env.TRANSFORMER_MAX_TOKENS || 256);
const ARTICLE_CACHE_TTL = Number(process.env.ARTICLE_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const ARTICLE_CACHE_MAX = Number(process.env.ARTICLE_CACHE_MAX || 1200);
const EXPLANATION_CACHE_MAX = Number(
  process.env.EXPLANATION_CACHE_MAX || ARTICLE_CACHE_MAX
);
const STORY_CACHE_TTL = Number(process.env.STORY_CACHE_TTL_MS || 120000);
const STORY_CACHE_MAX = Number(process.env.STORY_CACHE_MAX || 6);
const GDELT_CACHE_TTL = Number(process.env.GDELT_CACHE_TTL_MS || 600000);
const GDELT_CACHE_MAX = Number(process.env.GDELT_CACHE_MAX || 80);
const TOP_STORY_RELATED_CACHE_MAX = Number(
  process.env.TOP_STORY_RELATED_CACHE_MAX || 200
);
const RELATED_COVERAGE_CACHE_MAX = Number(
  process.env.RELATED_COVERAGE_CACHE_MAX || 200
);
const COVERAGE_CACHE_MAX = Number(process.env.COVERAGE_CACHE_MAX || 200);
const OG_IMAGE_CACHE_MAX = Number(process.env.OG_IMAGE_CACHE_MAX || 400);
const MAX_ARTICLES_TOTAL = Number(process.env.MAX_ARTICLES_TOTAL || 200);
const MAX_ARTICLES_PER_FEED_PER_CYCLE = Number(
  process.env.MAX_ARTICLES_PER_FEED_PER_CYCLE || 20
);
const INGEST_CONCURRENCY = Math.max(
  1,
  Number(process.env.INGEST_CONCURRENCY || 4)
);
const INGEST_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.INGEST_TIMEOUT_MS || 10000)
);
const FALLBACK_MIN_INTERVAL_MS = Number(
  process.env.FALLBACK_MIN_INTERVAL_MS || 60 * 60 * 1000
);
const FEED_FALLBACK_COOLDOWN_MS = Number(
  process.env.FEED_FALLBACK_COOLDOWN_MS || 60 * 60 * 1000
);
const FALLBACK_SEEN_MAX = Number(process.env.FALLBACK_SEEN_MAX || 200);
const FINANCE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.FINANCE_ENABLED || "0").toLowerCase()
);
const OG_IMAGE_POSITIVE_TTL = 6 * 60 * 60 * 1000;
const OG_IMAGE_NEGATIVE_TTL = 30 * 60 * 1000;
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
const FALLBACK_RATE = new Map();
const FALLBACK_SEEN = new Map();
const FALLBACK_COOLDOWN = new Map();

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
const getOgImageCache = (url = "") => {
  const cached = ogImageCache.get(url);
  if (!cached) return null;
  if (Date.now() > cached.exp) {
    ogImageCache.delete(url);
    return null;
  }
  return cached;
};
const setOgImageCache = (url = "", image = "") => {
  if (!url) return;
  const ttl = image ? OG_IMAGE_POSITIVE_TTL : OG_IMAGE_NEGATIVE_TTL;
  ogImageCache.set(url, { image, exp: Date.now() + ttl });
  capMapSize(ogImageCache, OG_IMAGE_CACHE_MAX);
};
const absolutizeUrl = (candidate = "", pageUrl = "") => {
  const trimmed = String(candidate || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!pageUrl) return "";
  try {
    return new URL(trimmed, pageUrl).href;
  } catch {
    return "";
  }
};
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
const resolveOgImage = async (pageUrl = "") => {
  if (!pageUrl) return "";
  const cached = getOgImageCache(pageUrl);
  if (cached) return cached.image || "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360Bot/1.0"
      }
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const candidates = [
      /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i
    ];
    let image = "";
    for (const pattern of candidates) {
      const match = pattern.exec(html);
      if (!match?.[1]) continue;
      const absolute = absolutizeUrl(match[1], pageUrl);
      if (absolute) {
        image = absolute;
        break;
      }
    }
    setOgImageCache(pageUrl, image || "");
    return image || "";
  } catch {
    setOgImageCache(pageUrl, "");
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

const getBestImage = async (article = {}) => {
  const baseUrl = article.link || article.url || "";
  const explicit = cleanUrl(article.image || article.imageUrl || "", baseUrl);
  if (explicit && !isLogoImage(explicit)) return explicit;
  const extracted = extractImage(article);
  const cleaned = cleanUrl(extracted, baseUrl);
  if (cleaned && !isLogoImage(cleaned)) return cleaned;
  const og = await resolveOgImage(baseUrl);
  if (og) return og;
  return "/img/thumb-placeholder.svg";
};
const mapInChunks = async (items = [], size = 10, mapper) => {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const mapped = await Promise.all(chunk.map(mapper));
    results.push(...mapped);
  }
  return results;
};
const capMapSize = (map, max) => {
  if (!max || max <= 0) return;
  while (map.size > max) {
    map.delete(map.keys().next().value);
  }
};
const normalizeImageCandidate = (value = "", baseUrl = "") => {
  const cleaned = cleanUrl(value, baseUrl);
  if (!cleaned || isLogoImage(cleaned)) return "";
  return cleaned;
};
const ensureImageField = async (item = {}) => {
  const link = item.link || item.url || "";
  const candidate = normalizeImageCandidate(
    item.image || item.imageUrl || "",
    link
  );
  if (candidate) return { ...item, image: candidate, imageUrl: candidate };
  const image = await getBestImage({ ...item, link });
  return { ...item, image, imageUrl: image };
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
  if (!USE_TRANSFORMER) return null;
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

  if (!USE_TRANSFORMER) return fallback("transformer-disabled");
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
  entries.slice(0, removeCount).forEach(([key]) => {
    ARTICLE_CACHE.delete(key);
    EXPLANATION_CACHE.delete(key);
  });
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
  capMapSize(EXPLANATION_CACHE, EXPLANATION_CACHE_MAX);
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
  const xml = await fetchFeedXml(u);
  const parsed = await parseFeedXml(xml);
  return parsed;
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
    if (!shouldUseFallback(domain, url)) {
      return { title: domain, items: [] };
    }
    const g = await parseURL(gNewsForDomain(domain));
    g.title = g.title || domain;
    g.items = filterFallbackItems(domain, g.items || []);
    return g;
  } catch (e) {
    try {
      const cooldownKey = url || domain;
      FALLBACK_COOLDOWN.set(cooldownKey, Date.now() + FEED_FALLBACK_COOLDOWN_MS);
      if (!shouldUseFallback(domain, url)) {
        return { title: domain, items: [] };
      }
      const g = await parseURL(gNewsForDomain(domain));
      g.title = g.title || domain;
      g.items = filterFallbackItems(domain, g.items || []);
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

const shouldUseFallback = (domain = "", url = "") => {
  if (!domain) return false;
  const cooldownKey = url || domain;
  const cooldownUntil = FALLBACK_COOLDOWN.get(cooldownKey) || 0;
  if (Date.now() < cooldownUntil) return false;
  const last = FALLBACK_RATE.get(domain) || 0;
  if (Date.now() - last < FALLBACK_MIN_INTERVAL_MS) return false;
  FALLBACK_RATE.set(domain, Date.now());
  return true;
};

const filterFallbackItems = (domain = "", items = []) => {
  if (!domain) return items || [];
  const seen = FALLBACK_SEEN.get(domain) || new Map();
  const filtered = [];
  const now = Date.now();
  for (const item of items || []) {
    const rawLink = item.link || item.guid || "";
    const link = cleanUrl(rawLink, rawLink);
    if (!link) continue;
    const key = canonicalizeUrl(link) || link;
    if (seen.has(key)) continue;
    seen.set(key, now);
    filtered.push({ ...item, link });
  }
  FALLBACK_SEEN.set(domain, seen);
  capMapSize(seen, FALLBACK_SEEN_MAX);
  return filtered;
};

const fetchFeedXml = async (url = "") => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Informed360Bot/1.0",
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9"
    }
  });
  clearTimeout(timeout);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  return xml;
};

const parseFeedXml = async (xml = "") => {
  if (!xml) return { items: [] };
  return parser.parseString(xml);
};

const sanitizeFeedItem = (item = {}) => ({
  title: item.title || "",
  link: item.link || "",
  guid: item.guid || "",
  source: item.source || {},
  contentSnippet: item.contentSnippet || "",
  summary: item.summary || "",
  content: "",
  "content:encoded": "",
  enclosure: item.enclosure,
  "media:content": item["media:content"],
  "media:thumbnail": item["media:thumbnail"],
  isoDate: item.isoDate,
  pubDate: item.pubDate
});

function normalizeArticle(raw = {}) {
  try {
    const url = String(raw.url || raw.link || "").trim();
    const title = String(raw.title || "").trim();
    if (!url || !title) return null;
    const source = String(raw.source || "").trim().slice(0, 60);
    const summary = String(raw.summary || raw.description || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean).slice(0, 5) : [];
    const image = String(raw.image || raw.imageUrl || "").trim();
    const publishedAtRaw = String(raw.publishedAt || "").trim();
    let publishedAt = publishedAtRaw;
    if (!publishedAt || Number.isNaN(new Date(publishedAt).getTime())) {
      publishedAt = new Date().toISOString();
    } else {
      publishedAt = new Date(publishedAt).toISOString();
    }
    const idSeed = `${url}|${title}|${publishedAt}`;
    const id = crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 16);
    return {
      id,
      title: title.slice(0, 200),
      source,
      url,
      publishedAt,
      summary,
      sentiment: raw.sentiment || null,
      tags,
      image: image && image.length <= 300 ? image : ""
    };
  } catch {
    return null;
  }
}

const runWithConcurrency = async (items = [], limit = 4, worker) => {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
};

async function fetchList(urls) {
  const articles = [];
  const seen = new Set();

  await runWithConcurrency(urls, INGEST_CONCURRENCY, async (url) => {
    const domain = publisherDomainFromFeed(url);
    const feed = await fetchWithFallback(url);
    const items = (feed.items || [])
      .slice(0, MAX_ARTICLES_PER_FEED_PER_CYCLE)
      .map(sanitizeFeedItem);

    for (const item of items) {
      const rawLink = item.link || item.guid || "";
      const link = cleanUrl(rawLink, rawLink);
      const canonical = canonicalizeUrl(link) || link;
      if (!link || seen.has(canonical)) continue;

      const cached = getCachedArticle(link);
      if (cached) {
        let cachedLean = null;
        try {
          cachedLean = normalizeArticle({
            id: cached.link || cached.url || link,
            title: cached.title,
            source: cached.source,
            link: cached.link || link,
            publishedAt: cached.publishedAt,
            summary: cached.description || "",
            sentiment: cached.sentiment,
            tags: cached.top_phrases,
            image: cached.image || cached.imageUrl || ""
          });
        } catch {
          cachedLean = null;
        }
        if (!cachedLean) continue;
        seen.add(canonical);
        articles.push(cachedLean);
        continue;
      }

      const title = item.title || "";
      const sourceRaw = item.source?.title || feed.title || domain;
      const sourceInfo = lookupSourceInfo({ source: sourceRaw, link });
      const description = item.contentSnippet || item.summary || "";
      const publishedAt =
        item.isoDate || item.pubDate || new Date().toISOString();
      const image = await getBestImage(item);
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
      let leanArticle = null;
      try {
        leanArticle = normalizeArticle({
          id: article.link,
          title: article.title,
          source: article.source,
          link: article.link,
          publishedAt: article.publishedAt,
          summary: article.description,
          sentiment: article.sentiment,
          tags: article.top_phrases,
          image: article.image || article.imageUrl || ""
        });
      } catch {
        leanArticle = null;
      }
      if (!leanArticle) continue;

      seen.add(canonical);
      articles.push(leanArticle);
      setCachedArticle(link, article, explanation);
    }
  });

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
  applyGlobalArticleCap();
}
async function refreshExp() {
  EXP = await fetchList(FEEDS.experimental || []);
  STORY_CACHE.delete("exp");
  applyGlobalArticleCap();
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

const buildArticleKey = (article = {}) => {
  const link = article.link || article.url || "";
  return canonicalizeUrl(link) || link;
};

const applyGlobalArticleCap = () => {
  if (!MAX_ARTICLES_TOTAL) return;
  const combined = [...(CORE.articles || []), ...(EXP.articles || [])];
  const map = new Map();
  combined.forEach((article) => {
    const key = buildArticleKey(article);
    if (!key) return;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, article);
      return;
    }
    const existingDate = new Date(existing.publishedAt).getTime();
    const nextDate = new Date(article.publishedAt).getTime();
    if (nextDate > existingDate) map.set(key, article);
  });
  const sorted = [...map.values()].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const trimmed = sorted.slice(0, MAX_ARTICLES_TOTAL);
  const keepKeys = new Set(trimmed.map((article) => buildArticleKey(article)));
  CORE = {
    ...CORE,
    articles: (CORE.articles || [])
      .filter((a) => keepKeys.has(buildArticleKey(a)))
  };
  EXP = {
    ...EXP,
    articles: (EXP.articles || [])
      .filter((a) => keepKeys.has(buildArticleKey(a)))
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

// (rest of file continues unchanged from current repo)
