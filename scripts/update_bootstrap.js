import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "public", "data", "bootstrap.json");
const REMOTE_BASE = process.env.BOOTSTRAP_SOURCE_BASE || "https://www.informed360.news";
const VERSION = 1;

const fetchJson = async (endpoint, { timeoutMs = 12000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = endpoint.startsWith("http") ? endpoint : `${REMOTE_BASE}${endpoint}`;
    const response = await fetch(url, { signal: controller.signal, headers: { "cache-control": "no-cache" } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const readPrevious = async () => {
  try {
    return JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  } catch {
    return null;
  }
};

const computeSentimentSummary = (articles = []) => {
  const totals = articles.reduce((acc, article) => {
    const s = article?.sentiment || {};
    acc.pos += Number(s.posP ?? s.pos ?? 0) || 0;
    acc.neu += Number(s.neuP ?? s.neu ?? 0) || 0;
    acc.neg += Number(s.negP ?? s.neg ?? 0) || 0;
    return acc;
  }, { pos: 0, neu: 0, neg: 0 });
  const n = Math.max(1, articles.length);
  return {
    average: {
      pos: Number((totals.pos / n).toFixed(2)),
      neu: Number((totals.neu / n).toFixed(2)),
      neg: Number((totals.neg / n).toFixed(2))
    },
    articleCount: articles.length
  };
};

const computePlotData = (articles = []) => {
  const now = Date.now();
  const bucketMs = 60 * 60 * 1000;
  const points = Array.from({ length: 4 }).map((_, i) => {
    const start = new Date(now - (4 - i) * bucketMs);
    const end = new Date(start.getTime() + bucketMs);
    const matches = articles.filter((a) => {
      const ts = new Date(a?.publishedAt || 0).getTime();
      return Number.isFinite(ts) && ts >= start.getTime() && ts < end.getTime();
    });
    const summary = computeSentimentSummary(matches).average;
    return { start: start.toISOString(), end: end.toISOString(), ...summary, count: matches.length };
  });
  return { sentimentTimeline: points };
};

const computeIndustryLeaderboard = (articles = []) => {
  const groups = new Map();
  for (const article of articles) {
    const key = String(article?.industry || "Other").trim() || "Other";
    const s = article?.sentiment || {};
    const score = (Number(s.posP ?? s.pos ?? 0) || 0) - (Number(s.negP ?? s.neg ?? 0) || 0);
    const entry = groups.get(key) || { name: key, score: 0, count: 0 };
    entry.score += score;
    entry.count += 1;
    groups.set(key, entry);
  }
  return {
    rows: [...groups.values()]
      .map((row) => ({ ...row, bias: Number((row.score / Math.max(1, row.count)).toFixed(2)) }))
      .sort((a, b) => b.bias - a.bias)
      .slice(0, 12)
  };
};

const normalize = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  if (!payload.news || !Array.isArray(payload.news.articles)) return null;
  return payload;
};

const main = async () => {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const previous = await readPrevious();

  const fallbackNews = previous?.news || {};
  const fallbackMeta = previous?.meta || {};

  const tasks = [
    ["news", "/api/news"],
    ["topics", "/api/topics"],
    ["stories", "/api/stories"],
    ["engaged", "/api/engaged"],
    ["topIndiaRecent", "/api/top-stories?scope=india&type=recent"],
    ["topIndiaEngaged", "/api/top-stories?scope=india&type=engaged"],
    ["topWorldRecent", "/api/top-stories?scope=world&type=recent"],
    ["topWorldEngaged", "/api/top-stories?scope=world&type=engaged"],
    ["markets", "/api/markets"]
  ];

  const collected = {};
  for (const [key, endpoint] of tasks) {
    try {
      collected[key] = await fetchJson(endpoint);
      console.log(`ok: ${key}`);
    } catch (error) {
      console.error(`failed: ${key} (${error?.message || error})`);
      collected[key] = null;
    }
  }

  const articles = collected.news?.articles || fallbackNews.articles || [];

  const snapshot = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    news: {
      articles,
      topics: collected.topics?.topics || fallbackNews.topics || [],
      stories: collected.stories?.stories || fallbackNews.stories || [],
      engagedStories: collected.engaged?.stories || fallbackNews.engagedStories || [],
      topStories: {
        indiaRecent: collected.topIndiaRecent?.topStories || fallbackNews?.topStories?.indiaRecent || [],
        indiaEngaged: collected.topIndiaEngaged?.topStories || fallbackNews?.topStories?.indiaEngaged || [],
        worldRecent: collected.topWorldRecent?.topStories || fallbackNews?.topStories?.worldRecent || [],
        worldEngaged: collected.topWorldEngaged?.topStories || fallbackNews?.topStories?.worldEngaged || []
      }
    },
    sentiment: computeSentimentSummary(articles),
    plots: computePlotData(articles),
    industryLeaderboard: computeIndustryLeaderboard(articles),
    meta: {
      source: "bootstrap-cache",
      schemaVersion: 1,
      markets: collected.markets?.quotes?.length ? collected.markets : (fallbackMeta.markets || { quotes: [], updatedAt: Date.now() })
    }
  };

  const valid = normalize(snapshot);
  if (!valid) {
    throw new Error("Bootstrap payload invalid");
  }

  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  await fs.writeFile(OUTPUT_PATH, text, "utf8");
  console.log(`wrote ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error("bootstrap update failed", error);
  process.exit(1);
});
