import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";
import vader from "vader-sentiment";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "public", "data", "bootstrap.json");
const DATA_DIR = path.join(ROOT, "public", "data");
const SOURCE_REGISTRY_PATH = path.join(ROOT, "source-registry.json");
const SOURCE_HEALTH_PATH = path.join(DATA_DIR, "source-health.json");
const SNAPSHOT_FILES = {
  bootstrap: OUTPUT_PATH,
  homepage: path.join(DATA_DIR, "homepage.json"),
  latestNews: path.join(DATA_DIR, "latest-news.json"),
  sourceSentiment: path.join(DATA_DIR, "source-sentiment.json"),
  industrySentiment: path.join(DATA_DIR, "industry-sentiment.json"),
  usaNews: path.join(DATA_DIR, "usa-news.json"),
  potusNews: path.join(DATA_DIR, "potus-news.json"),
  trendingHistory: path.join(DATA_DIR, "trending-history.json")
};
const REMOTE_BASE = (process.env.BOOTSTRAP_SOURCE_BASE || "https://www.informed360.news").replace(/\/$/, "");
const VERSION = 1;
const SCHEMA_VERSION = 1;
const parser = new Parser({ timeout: 12000 });
const MIN_SOURCE_ARTICLES = 2;
const MIN_SECTION_ARTICLES = 8;
const SNAPSHOT_THRESHOLDS = {
  bootstrapArticlesMin: 24,
  homepageHeroMin: 3,
  homepageLatestMin: 18,
  latestNewsMin: 18,
  usaNewsMin: 12,
  potusNewsMin: 8,
  sourceRowsMin: 4,
  industryRowsMin: 4,
  trendingPointsMin: 4
};
const DEFAULT_IMAGE = "/img/placeholder-news.svg";
const SOURCE_LOGO_MAP = {
  "India Today": "/logo/indiatoday.png",
  "The Hindu": "/logo/thehindu.png",
  Scroll: "/logo/scroll.png",
  "Scroll.in": "/logo/scroll.png",
  News18: "/logo/news18.png",
  Reuters: "/logo/reuters.png",
  BBC: "/logo/bbc.png",
  "Fox News": "/logo/industry-communication.svg",
  CNN: "/logo/industry-communication.svg",
  CNBC: "/logo/industry-finance.svg",
  AP: "/logo/industry-generic.svg",
  NYT: "/logo/industry-generic.svg",
  "Washington Post": "/logo/industry-generic.svg",
  WSJ: "/logo/industry-finance.svg"
};

const USA_ONLY_SOURCES = [
  { name: "CNN", match: /cnn\.com$/i, feed: "https://rss.cnn.com/rss/cnn_latest.rss" },
  { name: "Fox News", match: /foxnews\.com$/i, feed: "https://moxie.foxnews.com/google-publisher/latest.xml" },
  { name: "Reuters", match: /reuters\.com$/i, feed: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "AP", match: /apnews\.com$/i, feed: "https://apnews.com/hub/apf-topnews?output=rss" },
  { name: "NYT", match: /nytimes\.com$/i, feed: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { name: "NBC News", match: /nbcnews\.com$/i, feed: "https://feeds.nbcnews.com/nbcnews/public/news" },
  { name: "CBS News", match: /cbsnews\.com$/i, feed: "https://www.cbsnews.com/latest/rss/main" },
  { name: "ABC News", match: /abcnews\.go\.com$/i, feed: "https://abcnews.go.com/abcnews/topstories" },
  { name: "CNBC", match: /cnbc\.com$/i, feed: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { name: "Washington Post", match: /washingtonpost\.com$/i, feed: "https://feeds.washingtonpost.com/rss/politics" },
  { name: "WSJ", match: /wsj\.com$/i, feed: "https://feeds.a.dj.com/rss/RSSWorldNews.xml" }
];

const fetchJson = async (endpoint, { timeoutMs = 12000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = endpoint.startsWith("http") ? endpoint : `${REMOTE_BASE}${endpoint}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "cache-control": "no-cache" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const readPrevious = async () => {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeSentiment = (sentiment = {}) => ({
  posP: asNumber(sentiment.posP ?? sentiment.pos),
  neuP: asNumber(sentiment.neuP ?? sentiment.neu),
  negP: asNumber(sentiment.negP ?? sentiment.neg),
  label: sentiment.label || sentiment.sentimentLabel || "neutral",
  confidence: asNumber(sentiment.confidence)
});

const pickArticle = (article = {}) => ({
  title: article.title || "",
  link: article.link || article.url || "",
  source: normalizeSourceName(article.source || article.sourceName || ""),
  sourceDomain: article.sourceDomain || "",
  sourceCredibility: article.sourceCredibility || "",
  industry: article.industry || "",
  description: article.description || "",
  image: article.image || article.imageUrl || "",
  imageUrl: article.imageUrl || article.image || "",
  publishedAt: article.publishedAt || "",
  sentiment: normalizeSentiment(article.sentiment || article.sentiment_scores || {}),
  category: article.category || "world"
});
const normalizeImageUrl = (value = "") => {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  if (candidate.startsWith("/")) return candidate;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return "";
};
const fallbackLogoForSource = (source = "") => SOURCE_LOGO_MAP[source] || "/logo/industry-generic.svg";
const enrichArticleMedia = (article = {}) => {
  const imageUrl = normalizeImageUrl(article.imageUrl || article.image || "");
  const fallbackImageUrl = fallbackLogoForSource(normalizeSourceName(article.source || ""));
  return {
    ...article,
    imageUrl: imageUrl || fallbackImageUrl || DEFAULT_IMAGE,
    image: imageUrl || fallbackImageUrl || DEFAULT_IMAGE,
    fallbackImageUrl: fallbackImageUrl || DEFAULT_IMAGE
  };
};

const normalizeSourceName = (source = "") => {
  const clean = String(source || "").trim();
  if (!clean) return "";
  const lowered = clean.toLowerCase();
  if (/(^|\b)associated press|\bap\b/.test(lowered)) return "AP";
  if (/(^|\b)new york times|\bnyt\b/.test(lowered)) return "NYT";
  if (/washington post/.test(lowered)) return "Washington Post";
  if (/wall street journal|\bwsj\b/.test(lowered)) return "WSJ";
  if (/fox/.test(lowered)) return "Fox News";
  if (/cbs/.test(lowered)) return "CBS News";
  if (/abc/.test(lowered)) return "ABC News";
  if (/nbc/.test(lowered)) return "NBC News";
  if (/cnn/.test(lowered)) return "CNN";
  if (/reuters/.test(lowered)) return "Reuters";
  if (/cnbc/.test(lowered)) return "CNBC";
  if (/\bbbc\b/.test(lowered)) return "BBC";
  if (/\btimes of india\b|\btoi\b/.test(lowered)) return "TOI";
  if (/\bndtv\b/.test(lowered)) return "NDTV";
  return clean;
};

const normalizeSourceFromDomain = (domain = "") => {
  const match = USA_ONLY_SOURCES.find((src) => src.match.test(domain || ""));
  return match ? match.name : "";
};

const domainFromUrl = (u = "") => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const SOURCE_SHORT_WHITELIST = new Set(["AP", "NYT", "WSJ", "BBC", "CNN", "TOI", "NDTV"]);
const SOURCE_PLACEHOLDER_REGEX = /^(unknown|source|news|n\/a|na|null|undefined|_|-+|"+|'+)$/i;
const cleanSourceLabel = (value = "") =>
  String(value || "")
    .replace(/[“”‘’"'`]/g, " ")
    .replace(/[|_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const titleCaseSourcePart = (value = "") =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
const publisherNameFromDomain = (domain = "") => {
  const safe = String(domain || "").toLowerCase().replace(/^www\./, "").trim();
  if (!safe) return "";
  const known = normalizeSourceFromDomain(safe);
  if (known) return known;
  if (/apnews\.com$/i.test(safe)) return "AP";
  if (/nytimes\.com$/i.test(safe)) return "NYT";
  if (/wsj\.com$/i.test(safe)) return "WSJ";
  if (/bbc\./i.test(safe)) return "BBC";
  if (/cnn\.com$/i.test(safe)) return "CNN";
  if (/timesofindia\.indiatimes\.com$/i.test(safe)) return "TOI";
  if (/ndtv\.com$/i.test(safe)) return "NDTV";
  const parts = safe.split(".").filter(Boolean);
  if (parts.length < 2) return "";
  const sld = parts[parts.length - 2] || "";
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(sld)) return "";
  if (["co", "com", "net", "org", "gov", "edu", "news", "media"].includes(sld)) return "";
  return titleCaseSourcePart(sld);
};
const validateSourceLabel = (source = "") => {
  const clean = cleanSourceLabel(source);
  if (!clean) return { valid: false, reason: "empty" };
  if (SOURCE_PLACEHOLDER_REGEX.test(clean)) return { valid: false, reason: "placeholder" };
  const alphaChars = (clean.match(/[A-Za-z]/g) || []).length;
  if (alphaChars === 0) return { valid: false, reason: "no_alpha" };
  const compact = clean.replace(/[^A-Za-z]/g, "");
  if (SOURCE_SHORT_WHITELIST.has(compact.toUpperCase())) return { valid: true, reason: "" };
  if (compact.length <= 2) return { valid: false, reason: "short_not_whitelisted" };
  if (alphaChars < 3) return { valid: false, reason: "insufficient_alpha" };
  return { valid: true, reason: "" };
};
const resolvePublisherIdentity = (article = {}) => {
  const domain = article.sourceDomain || domainFromUrl(article.link || "");
  const rawSource = cleanSourceLabel(article.source || "");
  const normalizedSource = normalizeSourceName(rawSource || publisherNameFromDomain(domain));
  const validation = validateSourceLabel(normalizedSource);
  if (validation.valid) {
    return { rawSource, normalizedSource, reason: "", domain, valid: true };
  }
  const fallbackDomainSource = normalizeSourceName(publisherNameFromDomain(domain));
  const fallbackValidation = validateSourceLabel(fallbackDomainSource);
  return {
    rawSource,
    normalizedSource: fallbackDomainSource,
    reason: fallbackValidation.valid ? "" : (fallbackValidation.reason || validation.reason),
    domain,
    valid: fallbackValidation.valid
  };
};

const dedupeArticles = (articles = []) => {
  const byUrl = new Set();
  const byTitle = new Set();
  const out = [];
  for (const article of articles) {
    const link = String(article.link || article.url || "").trim();
    const titleKey = String(article.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 12)
      .join(" ");
    if (link && byUrl.has(link)) continue;
    if (titleKey && byTitle.has(titleKey)) continue;
    if (link) byUrl.add(link);
    if (titleKey) byTitle.add(titleKey);
    out.push(article);
  }
  return out;
};
const tokenize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
const similarityScore = (a = {}, b = {}) => {
  const tokensA = new Set(tokenize(`${a.title || ""} ${a.description || ""}`));
  const tokensB = new Set(tokenize(`${b.title || ""} ${b.description || ""}`));
  if (!tokensA.size || !tokensB.size) return 0;
  let overlap = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) overlap += 1;
  });
  return overlap / Math.max(tokensA.size, tokensB.size);
};

const fallbackSentiment = (text = "") => {
  const score = vader.SentimentIntensityAnalyzer.polarity_scores(text || "");
  const posP = Number(((score.pos || 0) * 100).toFixed(2));
  const negP = Number(((score.neg || 0) * 100).toFixed(2));
  const neuP = Number(Math.max(0, 100 - posP - negP).toFixed(2));
  return {
    posP,
    negP,
    neuP,
    label: score.compound >= 0.2 ? "positive" : score.compound <= -0.2 ? "negative" : "neutral",
    confidence: Number(Math.min(1, Math.abs(score.compound || 0)).toFixed(2))
  };
};

const ingestUsaFeeds = async () => {
  const collected = [];
  await Promise.all(USA_ONLY_SOURCES.map(async (src) => {
    try {
      const feed = await parser.parseURL(src.feed);
      (feed.items || []).slice(0, 20).forEach((item) => {
        const title = String(item.title || "").trim();
        const description = String(item.contentSnippet || item.content || item.summary || "").trim();
        const link = String(item.link || item.guid || "").trim();
        if (!title || !link) return;
        const sentiment = fallbackSentiment(`${title}. ${description}`);
        collected.push({
          title,
          link,
          source: src.name,
          sourceDomain: domainFromUrl(link),
          sourceCredibility: "High",
          industry: "",
          description,
          image: "",
          imageUrl: "",
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
          sentiment,
          category: "usa"
        });
      });
    } catch (error) {
      console.error(`failed: usa-feed ${src.name} (${error?.message || error})`);
    }
  }));
  return dedupeArticles(collected);
};

const normalizeStory = (story = {}) => ({
  title: story.title || "",
  summary: story.summary || story.description || "",
  count: asNumber(story.count),
  sentiment: normalizeSentiment(story.sentiment || {}),
  articles: Array.isArray(story.articles) ? story.articles.slice(0, 4).map(pickArticle) : []
});

const sentimentAverage = (articles = []) => {
  const totals = articles.reduce((acc, article) => {
    const s = normalizeSentiment(article.sentiment || {});
    acc.pos += s.posP;
    acc.neu += s.neuP;
    acc.neg += s.negP;
    return acc;
  }, { pos: 0, neu: 0, neg: 0 });
  const n = Math.max(1, articles.length);
  return {
    pos: Number((totals.pos / n).toFixed(2)),
    neu: Number((totals.neu / n).toFixed(2)),
    neg: Number((totals.neg / n).toFixed(2)),
    count: articles.length
  };
};

const buildTimeline = (articles = []) => {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const buckets = Array.from({ length: 4 }, (_, i) => {
    const start = now - (4 - i) * HOUR;
    const end = start + HOUR;
    const selected = articles.filter((article) => {
      const ts = new Date(article.publishedAt || 0).getTime();
      return Number.isFinite(ts) && ts >= start && ts < end;
    });
    const avg = sentimentAverage(selected);
    return {
      label: new Date(start).toISOString(),
      pos: Math.round(avg.pos),
      neu: Math.round(avg.neu),
      neg: Math.round(avg.neg),
      count: selected.length
    };
  });
  return buckets;
};

const INDUSTRY_GROUPS = [
  "Energy",
  "Utilities",
  "Communication",
  "Healthcare",
  "Finance",
  "Technology",
  "Manufacturing",
  "Real Estate",
  "Information Tech",
  "Materials"
];

const INDUSTRY_KEYWORDS = {
  Energy: ["energy", "oil", "gas", "petrol", "diesel", "fuel", "renewable", "solar", "wind", "power"],
  Utilities: ["utilities", "grid", "electricity", "power supply", "water", "pipeline"],
  Communication: ["telecom", "communication", "wireless", "mobile", "broadband", "5g", "network"],
  Healthcare: ["health", "hospital", "pharma", "pharmaceutical", "medical", "vaccine", "drug"],
  Finance: ["bank", "banking", "finance", "financial", "nbfc", "loan", "lending", "stock", "market"],
  Technology: ["technology", "tech", "ai", "artificial intelligence", "software", "it", "chip", "semiconductor"],
  Manufacturing: ["manufacturing", "factory", "industrial", "production", "auto", "automobile", "vehicle"],
  "Real Estate": ["real estate", "property", "housing", "realty", "construction", "builder"],
  "Information Tech": ["information tech", "information technology", "it services", "software services"],
  Materials: ["materials", "steel", "metal", "cement", "mining", "coal", "aluminium"]
};

const scoreIndustries = (articles = []) => {
  const rows = INDUSTRY_GROUPS.map((name) => ({ name, pos: 0, neg: 0, neu: 0, n: 0 }));
  const byName = new Map(rows.map((row) => [row.name, row]));

  for (const article of articles) {
    const text = `${article.title || ""} ${article.description || ""}`.toLowerCase();
    const category = String(article.category || "").toLowerCase();
    const explicit = String(article.industry || "").trim();
    const matching = explicit && byName.has(explicit)
      ? [byName.get(explicit)]
      : rows.filter((row) => {
        const keywords = INDUSTRY_KEYWORDS[row.name] || [];
        return keywords.some((keyword) => text.includes(keyword) || category.includes(keyword));
      });

    for (const row of matching) {
      const s = normalizeSentiment(article.sentiment || {});
      row.n += 1;
      row.pos += s.posP;
      row.neg += s.negP;
      row.neu += s.neuP;
    }
  }

  return rows
    .filter((row) => row.n > 0)
    .map((row) => {
      const n = Math.max(1, row.n);
      const bias = (row.pos / n) - (row.neg / n);
      return { name: row.name, bias: Number(bias.toFixed(2)), count: row.n };
    })
    .sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias));
};

const buildIndustryLeaderboard = (articles = []) => {
  const scored = scoreIndustries(articles);
  const threshold = 2;
  const pos = scored.filter((item) => item.bias > threshold).slice(0, 3);
  const neg = scored.filter((item) => item.bias < -threshold).slice(0, 3);
  const neu = scored.filter((item) => !pos.includes(item) && !neg.includes(item)).slice(0, 3);
  const rows = scored.slice(0, 12);
  return { rows, pos, neu, neg };
};

const baseNews = (payload = {}) => ({
  articles: Array.isArray(payload.articles) ? payload.articles.map(pickArticle).slice(0, 120) : [],
  topics: Array.isArray(payload.topics) ? payload.topics.slice(0, 12) : [],
  stories: Array.isArray(payload.stories) ? payload.stories.map(normalizeStory).slice(0, 8) : [],
  engagedStories: Array.isArray(payload.engagedStories) ? payload.engagedStories.map(normalizeStory).slice(0, 8) : [],
  topStories: {
    indiaRecent: Array.isArray(payload.topStories?.indiaRecent) ? payload.topStories.indiaRecent.slice(0, 12).map(pickArticle) : [],
    indiaEngaged: Array.isArray(payload.topStories?.indiaEngaged) ? payload.topStories.indiaEngaged.slice(0, 12).map(pickArticle) : [],
    worldRecent: Array.isArray(payload.topStories?.worldRecent) ? payload.topStories.worldRecent.slice(0, 12).map(pickArticle) : [],
    worldEngaged: Array.isArray(payload.topStories?.worldEngaged) ? payload.topStories.worldEngaged.slice(0, 12).map(pickArticle) : []
  }
});


const USA_REGEX = [
  /\bunited states\b/i,
  /\bu\.?s\.?a?\b/i,
  /\bamerica(n)?\b/i,
  /\bwhite house\b/i,
  /\bcongress\b/i,
  /\bsenate\b/i,
  /\bhouse of representatives\b/i,
  /\bsupreme court\b/i,
  /\bfederal\b/i,
  /\bwashington\b/i,
  /\bcalifornia\b/i,
  /\btexas\b/i,
  /\bnew york\b/i,
  /\bflorida\b/i,
  /\bchicago\b/i,
  /\blos angeles\b/i
];
const POTUS_REGEX = [
  /\bpotus\b/i,
  /\bpresident trump\b/i,
  /\bdonald trump\b/i,
  /\btrump\b/i,
  /\bu\.?s\.? president\b/i,
  /\bpresident of the united states\b/i,
  /\bwhite house\b/i,
  /\boval office\b/i,
  /\btrump administration\b/i
];
const POTUS_CONTEXT_REGEX = [
  /\badministration\b/i,
  /\bexecutive order\b/i,
  /\bpresidency\b/i,
  /\bcampaign\b/i,
  /\bpress secretary\b/i
];
const POTUS_EXCLUDE_REGEX = [
  /\btrumpet\b/i
];
const NON_US_DOMESTIC_REGEX = [
  /\bindia\b/i,
  /\bindian\b/i,
  /\bdelhi\b/i,
  /\bmumbai\b/i,
  /\bbengaluru\b/i,
  /\bhyderabad\b/i,
  /\bkolkata\b/i,
  /\bchennai\b/i,
  /\bmaharashtra\b/i,
  /\bkerala\b/i,
  /\btelangana\b/i,
  /\bwest bengal\b/i
];
const POTUS_TOPICS = {
  Policy: ["policy","executive order","administration","regulation","bill"],
  Legal: ["court","judge","legal","lawsuit","trial","indictment"],
  Economy: ["economy","inflation","jobs","tax","trade","market"],
  "Foreign Policy": ["foreign","diplomacy","nato","china","russia","ukraine"],
  "Campaign / Politics": ["campaign","election","poll","republican","democrat","rally"],
  "Public Statements": ["statement","speech","remarks","interview","press"]
};
const articleText = (article = {}) =>
  `${article.title || ""} ${article.description || ""} ${article.source || ""}`;
const hasRegex = (text = "", patterns = []) => patterns.some((pattern) => pattern.test(text));
const usaScore = (article = {}) => {
  const text = articleText(article);
  let score = 0;
  if (hasRegex(text, POTUS_REGEX)) score += 3;
  if (hasRegex(text, USA_REGEX)) score += 2;
  if (hasRegex(text, NON_US_DOMESTIC_REGEX)) score -= 2;
  return score;
};
const filterUsaArticles = (articles = []) => articles.filter((article) => {
  const domain = article.sourceDomain || domainFromUrl(article.link || "");
  const sourceName = normalizeSourceName(article.source || normalizeSourceFromDomain(domain));
  if (USA_ONLY_SOURCES.some((src) => src.name === sourceName)) return true;
  const category = String(article.category || "").toLowerCase();
  if (category === "usa" || category === "potus") return true;
  return usaScore(article) >= 2;
});
const filterPotusArticles = (articles = []) => articles.filter((article) => {
  const category = String(article.category || "").toLowerCase();
  if (category === "potus") return true;
  const text = articleText(article);
  if (hasRegex(text, POTUS_EXCLUDE_REGEX)) return false;
  if (!hasRegex(text, POTUS_REGEX)) return false;
  if (/\btrump\b/i.test(text)) return true;
  if (/\b(white house|oval office|president of the united states|u\.?s\.? president)\b/i.test(text)) return true;
  return hasRegex(text, POTUS_CONTEXT_REGEX);
});
const classifyPotusTopic = (article = {}) => {
  const text = articleText(article).toLowerCase();
  for (const [topic, keys] of Object.entries(POTUS_TOPICS)) {
    if (keys.some((key) => text.includes(key))) return topic;
  }
  return "Campaign / Politics";
};
const buildSourceLeaderboard = (articles = []) => {
  const bySource = new Map();
  let acceptedArticles = 0;
  articles.forEach((article) => {
    const resolved = resolvePublisherIdentity(article);
    if (!resolved.valid || !resolved.normalizedSource) {
      console.info("[source-sentiment] drop", {
        rawSource: resolved.rawSource || article?.source || "",
        normalizedSource: resolved.normalizedSource || "",
        reasonDropped: resolved.reason || "invalid_source",
        domain: resolved.domain || ""
      });
      return;
    }
    acceptedArticles += 1;
    const source = resolved.normalizedSource;
    const row = bySource.get(source) || { source, pos: 0, neg: 0, neu: 0, n: 0 };
    const sent = normalizeSentiment(article.sentiment || {});
    row.pos += sent.posP;
    row.neg += sent.negP;
    row.neu += sent.neuP;
    row.n += 1;
    bySource.set(source, row);
  });
  const rows = [...bySource.values()]
  .filter((row) => row.n >= MIN_SOURCE_ARTICLES)
  .map((row) => {
    const n = Math.max(1, row.n);
    return { source: row.source, pos: Number((row.pos / n).toFixed(2)), neu: Number((row.neu / n).toFixed(2)), neg: Number((row.neg / n).toFixed(2)), count: row.n };
  }).sort((a,b) => b.count - a.count).slice(0, 12);
  console.info("[source-sentiment] accepted", {
    inputArticles: articles.length,
    acceptedArticles,
    acceptedRows: rows.length
  });
  return rows;
};
const buildPotusTopicSentiment = (articles = []) => {
  const buckets = new Map();
  articles.forEach((article) => {
    const topic = classifyPotusTopic(article);
    const row = buckets.get(topic) || { topic, pos: 0, neg: 0, neu: 0, n: 0 };
    const sent = normalizeSentiment(article.sentiment || {});
    row.pos += sent.posP;
    row.neg += sent.negP;
    row.neu += sent.neuP;
    row.n += 1;
    buckets.set(topic, row);
  });
  return [...buckets.values()].map((row) => {
    const n = Math.max(1, row.n);
    return { topic: row.topic, pos: Number((row.pos / n).toFixed(2)), neu: Number((row.neu / n).toFixed(2)), neg: Number((row.neg / n).toFixed(2)), count: row.n };
  }).sort((a,b) => b.count - a.count);
};

const isValidBootstrap = (payload) => {
  if (!payload || typeof payload !== "object") return false;
  if (!payload.generatedAt || Number.isNaN(new Date(payload.generatedAt).getTime())) return false;
  if (!payload.news || !Array.isArray(payload.news.articles)) return false;
  if (!payload.sentiment || typeof payload.sentiment !== "object") return false;
  if (!payload.plots || typeof payload.plots !== "object") return false;
  if (!payload.industryLeaderboard || typeof payload.industryLeaderboard !== "object") return false;
  return true;
};

const getCount = (value) => (Array.isArray(value) ? value.length : 0);
const addSnapshotMeta = (payload = {}, counts = {}) => ({
  ...payload,
  generatedAt: payload.generatedAt || new Date().toISOString(),
  counts
});
const bootstrapQuality = (payload = {}) => getCount(payload?.news?.articles);
const latestNewsQuality = (payload = {}) => getCount(payload?.articles);
const sourceSentimentQuality = (payload = {}) => getCount(payload?.rows);
const industrySentimentQuality = (payload = {}) => getCount(payload?.rows);
const usaNewsQuality = (payload = {}) => getCount(payload?.articles);
const potusNewsQuality = (payload = {}) => getCount(payload?.articles);
const trendingHistoryQuality = (payload = {}) => getCount(payload?.points);
const ensureBootstrapCounts = (payload = {}) => ({
  ...payload,
  generatedAt: payload.generatedAt || new Date().toISOString(),
  counts: payload.counts || {
    articles: getCount(payload?.news?.articles),
    topics: getCount(payload?.news?.topics),
    stories: getCount(payload?.news?.stories),
    usaArticles: getCount(payload?.usa?.dailyNews),
    potusArticles: getCount(payload?.potus?.dailyNews)
  }
});

const chooseSnapshot = ({ label, nextPayload, previousPayload, qualityFn, minThreshold }) => {
  const nextScore = qualityFn(nextPayload);
  const prevScore = qualityFn(previousPayload || {});
  const nextGood = nextScore >= minThreshold;
  const prevGood = prevScore >= minThreshold;
  if (nextGood || !prevGood) {
    if (!nextGood) {
      console.warn(`[snapshot:${label}] below threshold (${nextScore}/${minThreshold}); no prior strong snapshot found, writing new payload.`);
    }
    return { payload: nextPayload, retainedPrevious: false, score: nextScore };
  }
  console.warn(`[snapshot:${label}] weak run (${nextScore}/${minThreshold}); retaining previous strong snapshot (${prevScore}).`);
  return { payload: previousPayload, retainedPrevious: true, score: prevScore };
};

const buildSplitSnapshots = (snapshot) => {
  const allArticles = snapshot?.news?.articles || [];
  const latestArticles = allArticles.slice(0, 36);
  const sourceRows = (snapshot?.home?.leaderboards?.sources || []).slice(0, 20);
  const industryRows = (snapshot?.home?.leaderboards?.industry?.rows || []).slice(0, 20);
  const usaArticles = (snapshot?.usa?.dailyNews || []).slice(0, 36);
  const potusArticles = (snapshot?.potus?.dailyNews || []).slice(0, 30);
  const worldTimeline = snapshot?.plots?.worldSentimentTimeline || [];
  const indiaTimeline = snapshot?.plots?.indiaSentimentTimeline || [];
  const usaTimeline = snapshot?.usa?.plots?.sentimentTimeline || [];
  const points = [...worldTimeline, ...indiaTimeline, ...usaTimeline];
  const pointCount = points.length;
  return {
    latestNews: addSnapshotMeta({
      articles: latestArticles,
      topStories: (snapshot?.home?.topStories || []).slice(0, 12)
    }, { articles: latestArticles.length, topStories: getCount(snapshot?.home?.topStories) }),
    sourceSentiment: addSnapshotMeta({
      rows: sourceRows
    }, { rows: sourceRows.length }),
    industrySentiment: addSnapshotMeta({
      rows: industryRows,
      buckets: snapshot?.home?.leaderboards?.industry || { rows: [], pos: [], neu: [], neg: [] }
    }, { rows: industryRows.length }),
    usaNews: addSnapshotMeta({
      articles: usaArticles,
      topStories: (snapshot?.usa?.topStories || []).slice(0, 12),
      sentiment: snapshot?.usa?.sentiment || {}
    }, { articles: usaArticles.length, topStories: getCount(snapshot?.usa?.topStories) }),
    potusNews: addSnapshotMeta({
      articles: potusArticles,
      topStories: (snapshot?.potus?.topStories || []).slice(0, 12),
      sourceLeaderboard: snapshot?.potus?.sourceLeaderboard || [],
      topicSentiment: snapshot?.potus?.topicSentiment || []
    }, { articles: potusArticles.length, topStories: getCount(snapshot?.potus?.topStories) }),
    trendingHistory: addSnapshotMeta({
      points,
      world: worldTimeline,
      india: indiaTimeline,
      usa: usaTimeline
    }, { points: pointCount, world: worldTimeline.length, india: indiaTimeline.length, usa: usaTimeline.length })
  };
};
const heroSentimentSummary = (article = {}) => {
  const s = normalizeSentiment(article.sentiment || {});
  const label = s.posP > s.negP + 5 ? "positive" : s.negP > s.posP + 5 ? "negative" : "neutral";
  return { posP: s.posP, neuP: s.neuP, negP: s.negP, label };
};
const buildHeroSlides = (articles = []) => {
  const sorted = dedupeArticles(articles).slice(0, 24).map(enrichArticleMedia);
  const usedLinks = new Set();
  const slides = [];
  for (const primary of sorted) {
    if (slides.length >= 4) break;
    if (!primary?.link || usedLinks.has(primary.link)) continue;
    usedLinks.add(primary.link);
    const related = sorted
      .filter((candidate) => candidate.link && candidate.link !== primary.link && !usedLinks.has(candidate.link))
      .map((candidate) => ({ candidate, score: similarityScore(primary, candidate) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(({ candidate }) => {
        usedLinks.add(candidate.link);
        return {
          title: candidate.title || "",
          headline: candidate.title || "",
          source: normalizeSourceName(candidate.source || ""),
          link: candidate.link || "",
          url: candidate.link || "",
          publishedAt: candidate.publishedAt || "",
          imageUrl: candidate.imageUrl || candidate.image || DEFAULT_IMAGE,
          image: candidate.image || candidate.imageUrl || DEFAULT_IMAGE,
          fallbackImageUrl: candidate.fallbackImageUrl || DEFAULT_IMAGE,
          sentiment: heroSentimentSummary(candidate)
        };
      });
    slides.push({
      id: primary.link || `${slides.length}`,
      title: primary.title || "",
      source: normalizeSourceName(primary.source || ""),
      imageUrl: primary.imageUrl || primary.image || DEFAULT_IMAGE,
      fallbackImageUrl: primary.fallbackImageUrl || DEFAULT_IMAGE,
      sentimentSummary: heroSentimentSummary(primary),
      primary: {
        title: primary.title || "",
        source: normalizeSourceName(primary.source || ""),
        link: primary.link || "",
        url: primary.link || "",
        publishedAt: primary.publishedAt || "",
        imageUrl: primary.imageUrl || primary.image || DEFAULT_IMAGE,
        image: primary.image || primary.imageUrl || DEFAULT_IMAGE,
        fallbackImageUrl: primary.fallbackImageUrl || DEFAULT_IMAGE,
        sentiment: heroSentimentSummary(primary)
      },
      related
    });
  }
  return slides;
};
const buildHomepageSnapshot = (snapshot = {}) => {
  const latest = (snapshot?.news?.articles || []).slice(0, 36).map(pickArticle).map(enrichArticleMedia);
  const homeTopStories = (snapshot?.home?.topStories || [])
    .map(pickArticle)
    .filter((item) => (item?.title || "").trim() && (item?.link || "").trim());
  const heroSlides = buildHeroSlides(homeTopStories.length ? homeTopStories : latest);
  return {
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    version: VERSION,
    source: "daily-snapshot",
    metadata: {
      generatedAt: snapshot.generatedAt || new Date().toISOString(),
      source: "public/data/homepage.json",
      articleCount: latest.length
    },
    sections: {
      hero: { slides: heroSlides },
      latestNews: { articles: latest },
      sourceSentiment: { rows: (snapshot?.home?.leaderboards?.sources || []).slice(0, 20) },
      industrySentiment: {
        rows: (snapshot?.home?.leaderboards?.industry?.rows || []).slice(0, 20),
        buckets: snapshot?.home?.leaderboards?.industry || { rows: [], pos: [], neu: [], neg: [] }
      },
      trending: {
        preview: latest.slice(0, 8),
        points: [
          ...(snapshot?.plots?.worldSentimentTimeline || []),
          ...(snapshot?.plots?.indiaSentimentTimeline || []),
          ...(snapshot?.usa?.plots?.sentimentTimeline || [])
        ],
        world: snapshot?.plots?.worldSentimentTimeline || [],
        india: snapshot?.plots?.indiaSentimentTimeline || [],
        usa: snapshot?.usa?.plots?.sentimentTimeline || []
      },
      usa: {
        topStories: (snapshot?.usa?.topStories || []).slice(0, 12).map(pickArticle).map(enrichArticleMedia),
        articles: (snapshot?.usa?.dailyNews || []).slice(0, 36).map(pickArticle).map(enrichArticleMedia),
        sentiment: snapshot?.usa?.sentiment || {}
      },
      potus: {
        topStories: (snapshot?.potus?.topStories || []).slice(0, 12).map(pickArticle).map(enrichArticleMedia),
        articles: (snapshot?.potus?.dailyNews || []).slice(0, 30).map(pickArticle).map(enrichArticleMedia),
        sourceLeaderboard: snapshot?.potus?.sourceLeaderboard || [],
        topicSentiment: snapshot?.potus?.topicSentiment || []
      }
    },
    counts: {
      heroSlides: heroSlides.length,
      latestNews: latest.length,
      sourceRows: getCount(snapshot?.home?.leaderboards?.sources),
      industryRows: getCount(snapshot?.home?.leaderboards?.industry?.rows),
      trendingPoints: getCount(snapshot?.plots?.worldSentimentTimeline) + getCount(snapshot?.plots?.indiaSentimentTimeline) + getCount(snapshot?.usa?.plots?.sentimentTimeline),
      usaArticles: getCount(snapshot?.usa?.dailyNews),
      potusArticles: getCount(snapshot?.potus?.dailyNews)
    }
  };
};
const homepageQuality = (payload = {}) =>
  Math.min(getCount(payload?.sections?.hero?.slides), 4) * 5 +
  Math.min(getCount(payload?.sections?.latestNews?.articles), 24);

const main = async () => {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const previous = await readPrevious();
  const previousNews = baseNews(previous?.news || {});

  const endpoints = {
    news: "/api/news",
    topics: "/api/topics",
    stories: "/api/stories",
    engaged: "/api/engaged",
    topIndiaRecent: "/api/top-stories?scope=india&type=recent",
    topIndiaEngaged: "/api/top-stories?scope=india&type=engaged",
    topWorldRecent: "/api/top-stories?scope=world&type=recent",
    topWorldEngaged: "/api/top-stories?scope=world&type=engaged",
    markets: "/api/markets"
  };

  const collected = {};
  let successfulModules = 0;
  await Promise.all(Object.entries(endpoints).map(async ([key, endpoint]) => {
    try {
      const data = await fetchJson(endpoint);
      collected[key] = data;
      successfulModules += 1;
      console.log(`ok: ${key}`);
    } catch (error) {
      collected[key] = null;
      console.error(`failed: ${key} (${error?.message || error})`);
    }
  }));

  if (successfulModules === 0 && isValidBootstrap(previous)) {
    console.error("All modules failed. Re-publishing previous strong snapshot files.");
    const previousWithCounts = ensureBootstrapCounts(previous);
    const splitFromPrevious = buildSplitSnapshots(previousWithCounts);
    const homepageFromPrevious = buildHomepageSnapshot(previousWithCounts);
    await Promise.all([
      fs.writeFile(SNAPSHOT_FILES.bootstrap, `${JSON.stringify(previousWithCounts, null, 2)}\n`, "utf8"),
      fs.writeFile(SNAPSHOT_FILES.homepage, `${JSON.stringify(homepageFromPrevious, null, 2)}\n`, "utf8"),
      fs.writeFile(SNAPSHOT_FILES.latestNews, `${JSON.stringify(splitFromPrevious.latestNews, null, 2)}\n`, "utf8"),
      fs.writeFile(SNAPSHOT_FILES.sourceSentiment, `${JSON.stringify(splitFromPrevious.sourceSentiment, null, 2)}\n`, "utf8"),
      fs.writeFile(SNAPSHOT_FILES.industrySentiment, `${JSON.stringify(splitFromPrevious.industrySentiment, null, 2)}\n`, "utf8"),
      fs.writeFile(SNAPSHOT_FILES.usaNews, `${JSON.stringify(splitFromPrevious.usaNews, null, 2)}\n`, "utf8"),
      fs.writeFile(SNAPSHOT_FILES.potusNews, `${JSON.stringify(splitFromPrevious.potusNews, null, 2)}\n`, "utf8"),
      fs.writeFile(SNAPSHOT_FILES.trendingHistory, `${JSON.stringify(splitFromPrevious.trendingHistory, null, 2)}\n`, "utf8")
    ]);
    return;
  }

  const news = {
    articles: collected.news?.articles || previousNews.articles,
    topics: collected.topics?.topics || previousNews.topics,
    stories: collected.stories?.stories || previousNews.stories,
    engagedStories: collected.engaged?.stories || previousNews.engagedStories,
    topStories: {
      indiaRecent: collected.topIndiaRecent?.topStories || previousNews.topStories.indiaRecent,
      indiaEngaged: collected.topIndiaEngaged?.topStories || previousNews.topStories.indiaEngaged,
      worldRecent: collected.topWorldRecent?.topStories || previousNews.topStories.worldRecent,
      worldEngaged: collected.topWorldEngaged?.topStories || previousNews.topStories.worldEngaged
    }
  };

  const normalizedNews = baseNews(news);
  const allArticles = normalizedNews.articles;
  const indiaArticles = allArticles.filter((article) => article.category === "india");
  const worldArticles = allArticles.filter((article) => article.category !== "india");

  const feedUsaArticles = await ingestUsaFeeds();
  const usaArticles = dedupeArticles(filterUsaArticles([...allArticles, ...feedUsaArticles]));
  const potusArticles = dedupeArticles(filterPotusArticles(usaArticles));
  console.info("[potus] usa candidates:", usaArticles.length, "filtered:", potusArticles.length);

  const safeUsa = usaArticles.length >= MIN_SECTION_ARTICLES ? usaArticles : (Array.isArray(previous?.usa?.dailyNews) ? previous.usa.dailyNews : usaArticles);
  const safePotus = potusArticles.length >= MIN_SOURCE_ARTICLES ? potusArticles : (Array.isArray(previous?.potus?.dailyNews) ? previous.potus.dailyNews : potusArticles);
  if (!potusArticles.length && safePotus.length){
    console.info("[potus] using cached POTUS dailyNews fallback:", safePotus.length);
  }
  const nextUsaLeaderboard = buildSourceLeaderboard(safeUsa);
  const nextUsaIndustry = buildIndustryLeaderboard(safeUsa);
  const sourceRegistry = await readJson(SOURCE_REGISTRY_PATH);
  const sourceHealth = await readJson(SOURCE_HEALTH_PATH);
  const registryEntries = Object.values(sourceRegistry?.sources || {});
  const enabledSourceCount = registryEntries.filter((entry) => entry?.enabled !== false).length;
  const healthySourceCount = Number(sourceHealth?.healthySources || 0);
  const failedSources = Array.isArray(sourceHealth?.failedSources) ? sourceHealth.failedSources : [];

  const snapshot = {
    generatedAt: new Date().toISOString(),
    counts: {
      articles: allArticles.length,
      topics: normalizedNews.topics.length,
      stories: normalizedNews.stories.length,
      usaArticles: safeUsa.length,
      potusArticles: safePotus.length
    },
    version: VERSION,
    topStories: normalizedNews.topStories.worldRecent,
    news: normalizedNews,
    home: {
      topStories: normalizedNews.topStories.worldRecent.slice(0, 12),
      sentiment: {
        overall: sentimentAverage(allArticles),
        india: sentimentAverage(indiaArticles),
        world: sentimentAverage(worldArticles)
      },
      plots: {
        indiaSentimentTimeline: buildTimeline(indiaArticles),
        worldSentimentTimeline: buildTimeline(worldArticles)
      },
      leaderboards: {
        industry: buildIndustryLeaderboard(allArticles),
        sources: buildSourceLeaderboard(allArticles)
      }
    },
    usa: {
      topStories: safeUsa.slice(0, 12),
      dailyNews: safeUsa.slice(0, 24),
      sentiment: sentimentAverage(safeUsa),
      leaderboard: nextUsaLeaderboard.length ? nextUsaLeaderboard : (previous?.usa?.leaderboard || []),
      industryLeaderboard: nextUsaIndustry.rows?.length ? nextUsaIndustry : (previous?.usa?.industryLeaderboard || { rows: [], pos: [], neu: [], neg: [] }),
      plots: {
        sentimentTimeline: safeUsa.length ? buildTimeline(safeUsa) : (previous?.usa?.plots?.sentimentTimeline || buildTimeline([]))
      }
    },
    potus: {
      topStories: safePotus.slice(0, 12),
      dailyNews: safePotus.slice(0, 24),
      sentiment: sentimentAverage(safePotus),
      sourceLeaderboard: buildSourceLeaderboard(safePotus).length ? buildSourceLeaderboard(safePotus) : (previous?.potus?.sourceLeaderboard || []),
      topicSentiment: buildPotusTopicSentiment(safePotus).length ? buildPotusTopicSentiment(safePotus) : (previous?.potus?.topicSentiment || [])
    },
    sentiment: {
      overall: sentimentAverage(allArticles),
      india: sentimentAverage(indiaArticles),
      world: sentimentAverage(worldArticles)
    },
    plots: {
      indiaSentimentTimeline: buildTimeline(indiaArticles),
      worldSentimentTimeline: buildTimeline(worldArticles)
    },
    industryLeaderboard: buildIndustryLeaderboard(allArticles),
    meta: {
      source: "bootstrap-cache",
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceCount: registryEntries.length,
      enabledSourceCount,
      healthySourceCount,
      articleCount: allArticles.length,
      failedSources,
      thresholds: SNAPSHOT_THRESHOLDS,
      counts: {
        articles: allArticles.length,
        latestNews: Math.min(36, allArticles.length),
        usaArticles: safeUsa.length,
        potusArticles: safePotus.length,
        sourceRows: buildSourceLeaderboard(allArticles).length,
        industryRows: buildIndustryLeaderboard(allArticles).rows.length,
        trendingPoints: 12
      },
      markets: collected.markets?.quotes?.length
        ? collected.markets
        : (previous?.meta?.markets || { quotes: [], updatedAt: Date.now() })
    }
  };

  if (!isValidBootstrap(snapshot)) {
    throw new Error("Generated snapshot failed validation");
  }

  const previousFiles = {
    bootstrap: previous,
    homepage: await readJson(SNAPSHOT_FILES.homepage),
    latestNews: await readJson(SNAPSHOT_FILES.latestNews),
    sourceSentiment: await readJson(SNAPSHOT_FILES.sourceSentiment),
    industrySentiment: await readJson(SNAPSHOT_FILES.industrySentiment),
    usaNews: await readJson(SNAPSHOT_FILES.usaNews),
    potusNews: await readJson(SNAPSHOT_FILES.potusNews),
    trendingHistory: await readJson(SNAPSHOT_FILES.trendingHistory)
  };
  const split = buildSplitSnapshots(snapshot);
  const homepage = buildHomepageSnapshot(snapshot);
  const decisions = {
    bootstrap: chooseSnapshot({
      label: "bootstrap",
      nextPayload: ensureBootstrapCounts(snapshot),
      previousPayload: ensureBootstrapCounts(previousFiles.bootstrap || {}),
      qualityFn: bootstrapQuality,
      minThreshold: SNAPSHOT_THRESHOLDS.bootstrapArticlesMin
    }),
    homepage: chooseSnapshot({
      label: "homepage",
      nextPayload: homepage,
      previousPayload: previousFiles.homepage,
      qualityFn: homepageQuality,
      minThreshold: (SNAPSHOT_THRESHOLDS.homepageHeroMin * 5) + SNAPSHOT_THRESHOLDS.homepageLatestMin
    }),
    latestNews: chooseSnapshot({
      label: "latest-news",
      nextPayload: split.latestNews,
      previousPayload: previousFiles.latestNews,
      qualityFn: latestNewsQuality,
      minThreshold: SNAPSHOT_THRESHOLDS.latestNewsMin
    }),
    sourceSentiment: chooseSnapshot({
      label: "source-sentiment",
      nextPayload: split.sourceSentiment,
      previousPayload: previousFiles.sourceSentiment,
      qualityFn: sourceSentimentQuality,
      minThreshold: SNAPSHOT_THRESHOLDS.sourceRowsMin
    }),
    industrySentiment: chooseSnapshot({
      label: "industry-sentiment",
      nextPayload: split.industrySentiment,
      previousPayload: previousFiles.industrySentiment,
      qualityFn: industrySentimentQuality,
      minThreshold: SNAPSHOT_THRESHOLDS.industryRowsMin
    }),
    usaNews: chooseSnapshot({
      label: "usa-news",
      nextPayload: split.usaNews,
      previousPayload: previousFiles.usaNews,
      qualityFn: usaNewsQuality,
      minThreshold: SNAPSHOT_THRESHOLDS.usaNewsMin
    }),
    potusNews: chooseSnapshot({
      label: "potus-news",
      nextPayload: split.potusNews,
      previousPayload: previousFiles.potusNews,
      qualityFn: potusNewsQuality,
      minThreshold: SNAPSHOT_THRESHOLDS.potusNewsMin
    }),
    trendingHistory: chooseSnapshot({
      label: "trending-history",
      nextPayload: split.trendingHistory,
      previousPayload: previousFiles.trendingHistory,
      qualityFn: trendingHistoryQuality,
      minThreshold: SNAPSHOT_THRESHOLDS.trendingPointsMin
    })
  };

  await Promise.all([
    fs.writeFile(SNAPSHOT_FILES.bootstrap, `${JSON.stringify(decisions.bootstrap.payload, null, 2)}\n`, "utf8"),
    fs.writeFile(SNAPSHOT_FILES.homepage, `${JSON.stringify(decisions.homepage.payload, null, 2)}\n`, "utf8"),
    fs.writeFile(SNAPSHOT_FILES.latestNews, `${JSON.stringify(decisions.latestNews.payload, null, 2)}\n`, "utf8"),
    fs.writeFile(SNAPSHOT_FILES.sourceSentiment, `${JSON.stringify(decisions.sourceSentiment.payload, null, 2)}\n`, "utf8"),
    fs.writeFile(SNAPSHOT_FILES.industrySentiment, `${JSON.stringify(decisions.industrySentiment.payload, null, 2)}\n`, "utf8"),
    fs.writeFile(SNAPSHOT_FILES.usaNews, `${JSON.stringify(decisions.usaNews.payload, null, 2)}\n`, "utf8"),
    fs.writeFile(SNAPSHOT_FILES.potusNews, `${JSON.stringify(decisions.potusNews.payload, null, 2)}\n`, "utf8"),
    fs.writeFile(SNAPSHOT_FILES.trendingHistory, `${JSON.stringify(decisions.trendingHistory.payload, null, 2)}\n`, "utf8")
  ]);
  Object.entries(SNAPSHOT_FILES).forEach(([key, value]) => {
    const payload = decisions[key]?.payload;
    const counts = payload?.counts ? JSON.stringify(payload.counts) : "{}";
    console.log(`wrote ${value} counts=${counts}`);
  });
};

main().catch((error) => {
  console.error("bootstrap update failed", error);
  process.exit(1);
});
