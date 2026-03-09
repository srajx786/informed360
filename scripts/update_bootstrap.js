import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "public", "data", "bootstrap.json");
const REMOTE_BASE = (process.env.BOOTSTRAP_SOURCE_BASE || "https://www.informed360.news").replace(/\/$/, "");
const VERSION = 1;
const SCHEMA_VERSION = 1;

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
  source: article.source || "",
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

const isValidBootstrap = (payload) => {
  if (!payload || typeof payload !== "object") return false;
  if (!payload.generatedAt || Number.isNaN(new Date(payload.generatedAt).getTime())) return false;
  if (!payload.news || !Array.isArray(payload.news.articles)) return false;
  if (!payload.sentiment || typeof payload.sentiment !== "object") return false;
  if (!payload.plots || typeof payload.plots !== "object") return false;
  if (!payload.industryLeaderboard || typeof payload.industryLeaderboard !== "object") return false;
  return true;
};

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
    console.error("All modules failed. Keeping existing bootstrap.json intact.");
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

  const snapshot = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    topStories: normalizedNews.topStories.worldRecent,
    news: normalizedNews,
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
      markets: collected.markets?.quotes?.length
        ? collected.markets
        : (previous?.meta?.markets || { quotes: [], updatedAt: Date.now() })
    }
  };

  if (!isValidBootstrap(snapshot)) {
    throw new Error("Generated snapshot failed validation");
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`wrote ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error("bootstrap update failed", error);
  process.exit(1);
});
