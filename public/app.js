/* helpers */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
const PIN_STORAGE_KEY = "i360_pins_v2";
const LEGACY_PIN_STORAGE_KEY = "i360_pins";
const CREDIBILITY_STORAGE_KEY = "i360_credibility_badges";
const NEWS_CACHE_KEY = "informed360_news_cache";
const STORIES_CACHE_KEY = "informed360_stories_cache";
const BOOTSTRAP_CACHE_KEY = "informed360_bootstrap_cache";
const SENTIMENT_CACHE_KEY = "informed360_sentiment_cache";
const SNAPSHOT_SPLIT_CACHE_KEY = "informed360_snapshot_split_cache";
const HOMEPAGE_CACHE_KEY = "informed360_homepage_cache";
const HERO_SNAPSHOT_KEY = "informed360_hero_snapshot_v1";
const APP_VERSION_STORAGE_KEY = "informed360_app_version";
const APP_VERSION = String(window.__APP_VERSION__ || "dev");
const FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STALE_DATA_MESSAGE = "Live data is temporarily unavailable, and the latest snapshot is older than 24 hours.";
const SNAPSHOT_CACHE_KEYS = [
  NEWS_CACHE_KEY,
  STORIES_CACHE_KEY,
  BOOTSTRAP_CACHE_KEY,
  SENTIMENT_CACHE_KEY,
  SNAPSHOT_SPLIT_CACHE_KEY,
  HOMEPAGE_CACHE_KEY,
  HERO_SNAPSHOT_KEY
];
const USA_CATEGORY = "usa";
const POTUS_CATEGORY = "potus";
const POLITICAL_INTEL_CATEGORY = "political-intelligence";
const PREMIUM_PREVIEW_KEY = "i360_premium_preview";
const MIN_SOURCE_ARTICLES = 2;
const USA_SECTION_SOURCES = new Set([
  "CNN",
  "Fox News",
  "Reuters",
  "AP",
  "NYT",
  "NBC News",
  "CBS News",
  "ABC News",
  "CNBC",
  "Washington Post",
  "WSJ"
]);
const PRICING_MAILTO =
  "mailto:info.shrirajnair@gmail.com?subject=Informed360%20Demo%20Request&body=Hi%20Informed360%20team%2C%0A%0AWe%20would%20like%20a%20demo%20of%20the%20PR%2FTeams%20tier.%0ACompany%3A%0AUse%20case%3A%0AExpected%20seats%3A%0APreferred%20time%3A%0A%0AThanks!";
const normalizeApiBase = (value = "") =>
  String(value || "").trim().replace(/\/$/, "");
let API_BASE = "";
const FALLBACK_API_BASE = normalizeApiBase(window.__API_BASE__ || "");
const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";
const buildApiUrl = (path = "", base = API_BASE) => {
  const cleanPath = String(path || "");
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
  const cleanBase = normalizeApiBase(base);
  if (!cleanBase) return cleanPath;
  return `${cleanBase}${cleanPath.startsWith("/") ? "" : "/"}${cleanPath}`;
};
const logApiError = (error, endpoint) => {
  const status = error?.status ?? "unknown";
  console.error("API request failed", { endpoint, status, error });
};
const countOf = (value) => Array.isArray(value) ? value.length : 0;
async function fetchJSON(path){
  const url = buildApiUrl(path);
  let r;
  try{
    r = await fetch(url);
  }catch(error){
    const err = new Error(`Network error for ${url}`);
    err.status = 0;
    err.endpoint = url;
    err.cause = error;
    throw err;
  }
  if (!r.ok){
    const err = new Error(await r.text());
    err.status = r.status;
    err.endpoint = url;
    throw err;
  }
  return r.json();
}
const readLocalCache = (key) => {
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch{
    return null;
  }
};
const writeLocalCache = (key, value) => {
  try{
    localStorage.setItem(key, JSON.stringify(value));
  }catch{
    // ignore storage quota errors
  }
};
const parseTimestampMs = (value) => {
  if (!value) return 0;
  const ts = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
};
const evaluateFreshness = (payload, { maxAgeMs = FALLBACK_MAX_AGE_MS } = {}) => {
  const ts = parseTimestampMs(payload?.generatedAt || payload?.updatedAt);
  if (!ts) return { fresh: false, reason: "missing-or-invalid-timestamp", timestampMs: 0 };
  const ageMs = Date.now() - ts;
  if (ageMs > maxAgeMs) return { fresh: false, reason: "older-than-24h", timestampMs: ts, ageMs };
  return { fresh: true, reason: "within-24h", timestampMs: ts, ageMs };
};
const extractPayloadTimestamp = (payload) =>
  payload?.generatedAt ||
  payload?.updatedAt ||
  payload?._meta?.generatedAt ||
  payload?._meta?.updatedAt ||
  "";
const runCacheVersionGuard = () => {
  try{
    const cachedVersion = localStorage.getItem(APP_VERSION_STORAGE_KEY);
    if (cachedVersion === APP_VERSION) return;
    SNAPSHOT_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(APP_VERSION_STORAGE_KEY, APP_VERSION);
    console.info("[cache-version] rotated snapshot cache keys", { from: cachedVersion || "none", to: APP_VERSION });
  }catch{
    // ignore storage access failures
  }
};
runCacheVersionGuard();
const HERO_QUALITY_RANK = {
  empty: 0,
  weak: 1,
  strong: 2
};
const heroQualityRank = (quality = "empty") => HERO_QUALITY_RANK[quality] ?? 0;
const getHeroPrimary = (cluster = {}) => {
  if (cluster?.primary && typeof cluster.primary === "object") return cluster.primary;
  return cluster || {};
};
function normalizeHeroCluster(cluster = {}){
  const normalized = normalizeTopStoryCluster(cluster || {});
  const primary = getHeroPrimary(normalized);
  const fallbackLogo = logoFor(primary?.url || primary?.link || "", primary?.source || "");
  const imageUrl = primary?.imageUrl || primary?.image || normalized?.imageUrl || fallbackLogo || THUMB_PLACEHOLDER;
  const nextPrimary = {
    ...primary,
    imageUrl,
    image: primary?.image || imageUrl
  };
  return {
    ...normalized,
    primary: nextPrimary,
    related: safeArray(normalized?.related)
  };
}
function evaluateHeroPayloadQuality(clusters = []){
  const list = safeArray(clusters).map(normalizeHeroCluster);
  if (!list.length){
    return { quality: "empty", usableCount: 0, total: 0 };
  }
  let usableCount = 0;
  list.forEach((cluster) => {
    const primary = getHeroPrimary(cluster);
    const hasTitle = Boolean(String(primary?.title || cluster?.headline || "").trim());
    const hasSource = Boolean(String(primary?.source || "").trim());
    const hasUrl = Boolean(String(primary?.url || primary?.link || "").trim());
    const hasImage = Boolean(String(primary?.imageUrl || primary?.image || "").trim());
    if (hasTitle && hasSource && hasUrl && hasImage){
      usableCount += 1;
    }
  });
  if (usableCount >= 1){
    return { quality: "strong", usableCount, total: list.length };
  }
  return { quality: "weak", usableCount, total: list.length };
}
const readHeroSnapshot = () => {
  const cached = readLocalCache(HERO_SNAPSHOT_KEY);
  const legacyClusters = safeArray(cached);
  if (legacyClusters.length){
    console.info("[freshness] snapshot rejected", { key: HERO_SNAPSHOT_KEY, reason: "legacy-missing-timestamp" });
    return [];
  }
  const freshness = evaluateFreshness(cached || {});
  if (!freshness.fresh){
    console.info("[freshness] snapshot rejected", { key: HERO_SNAPSHOT_KEY, reason: freshness.reason });
    return [];
  }
  return safeArray(cached?.clusters).map(normalizeHeroCluster);
};
const debugState = {
  files: {},
  sections: {},
  degraded: []
};
const setDebugFile = (file, meta = {}) => {
  if (!DEBUG_MODE) return;
  debugState.files[file] = meta;
};
const setDebugSection = (section, source, detail = {}) => {
  if (!DEBUG_MODE) return;
  debugState.sections[section] = { source, ...detail };
};
const pushDegradedReason = (section, reason) => {
  if (!DEBUG_MODE) return;
  debugState.degraded.push({ section, reason, at: new Date().toISOString() });
};
const renderDebugPanel = () => {
  if (!DEBUG_MODE) return;
  let el = document.getElementById("debugPanel");
  if (!el){
    el = document.createElement("pre");
    el.id = "debugPanel";
    el.style.cssText = "position:fixed;right:8px;bottom:8px;max-width:38vw;max-height:45vh;overflow:auto;background:#0b1220;color:#dbeafe;padding:10px;border-radius:8px;font:12px/1.4 ui-monospace,monospace;z-index:9999;white-space:pre-wrap;";
    document.body.appendChild(el);
  }
  el.textContent = JSON.stringify(debugState, null, 2);
};
const hasHealthySnapshotData = () =>
  countOf(state?.splitSnapshots?.latestNews?.articles) > 0 ||
  countOf(state?.splitSnapshots?.sourceSentiment?.rows) > 0 ||
  countOf(state?.splitSnapshots?.industrySentiment?.rows) > 0 ||
  countOf(state?.splitSnapshots?.trendingHistory?.points) > 0 ||
  countOf(state?.allArticles) > 0;
const EMPTY_STATE_MESSAGE = "Data temporarily unavailable. Please check back soon.";
const SNAPSHOT_FALLBACK_MESSAGE = "Data temporarily unavailable. Showing latest available snapshot.";
const POTUS_EMPTY_STATE_MESSAGE = "No recent POTUS-specific stories available right now. Please check back soon.";
const safeArray = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const getSafeSentiment = (sentiment = {}) => ({
  posP: Number(sentiment?.posP ?? sentiment?.pos ?? 0) || 0,
  neuP: Number(sentiment?.neuP ?? sentiment?.neu ?? 0) || 0,
  negP: Number(sentiment?.negP ?? sentiment?.neg ?? 0) || 0
});
const formatLastUpdated = (value) => {
  const ts = typeof value === "number" ? value : new Date(value || 0).getTime();
  if (!ts || Number.isNaN(ts)) return "";
  return new Date(ts).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};
const isValidBootstrapSnapshot = (payload) => {
  if (!payload || typeof payload !== "object") return false;
  if (!payload.generatedAt || Number.isNaN(new Date(payload.generatedAt).getTime())) return false;
  if (!payload.news || !Array.isArray(payload.news.articles)) return false;
  if (!payload.sentiment || typeof payload.sentiment !== "object") return false;
  if (!payload.plots || typeof payload.plots !== "object") return false;
  if (!payload.industryLeaderboard || typeof payload.industryLeaderboard !== "object") return false;
  return true;
};
const isValidHomepageSnapshot = (payload) => {
  if (!payload || typeof payload !== "object") return false;
  if (!payload.generatedAt || Number.isNaN(new Date(payload.generatedAt).getTime())) return false;
  const sections = payload.sections || {};
  return (
    Array.isArray(sections?.hero?.slides) &&
    Array.isArray(sections?.latestNews?.articles) &&
    sections?.sourceSentiment &&
    sections?.industrySentiment &&
    sections?.trending &&
    sections?.usa &&
    sections?.potus
  );
};
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
const POTUS_TOPIC_BUCKETS = {
  Policy: ["policy","executive order","administration","regulation","bill","reform"],
  Legal: ["court","judge","lawsuit","legal","indictment","trial","supreme court"],
  Economy: ["economy","inflation","jobs","trade","tax","market","fed"],
  "Foreign Policy": ["foreign","diplomacy","nato","china","russia","ukraine","middle east"],
  "Campaign / Politics": ["campaign","election","poll","republican","democrat","rally"],
  "Public Statements": ["said","statement","speech","remarks","interview","press"],
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
const isUsaArticle = (article = {}) => {
  const category = String(article.category || "").toLowerCase();
  if (category === USA_CATEGORY || category === POTUS_CATEGORY) return true;
  return usaScore(article) >= 2;
};
const isPotusArticle = (article = {}) => {
  const category = String(article.category || "").toLowerCase();
  if (category === POTUS_CATEGORY) return true;
  const text = articleText(article);
  if (hasRegex(text, POTUS_EXCLUDE_REGEX)) return false;
  const hasPrimary = hasRegex(text, POTUS_REGEX);
  if (!hasPrimary) return false;
  if (/\btrump\b/i.test(text)) return true;
  if (/\b(white house|oval office|president of the united states|u\.?s\.? president)\b/i.test(text)){
    return true;
  }
  return hasRegex(text, POTUS_CONTEXT_REGEX);
};
const resolvePotusArticles = ({ liveArticles = [], splitSnapshots = {}, bootstrapPotus = null } = {}) => {
  const liveCandidates = safeArray(liveArticles);
  const liveFiltered = liveCandidates.filter(isPotusArticle);
  const snapshotPotus = safeArray(splitSnapshots?.potusNews?.articles);
  const bootstrapDaily = safeArray(bootstrapPotus?.dailyNews);
  const bootstrapArticles = safeArray(bootstrapPotus?.articles);
  const fallbackArticles = snapshotPotus.length
    ? snapshotPotus
    : (bootstrapDaily.length ? bootstrapDaily : bootstrapArticles);
  const resolved = liveFiltered.length ? liveFiltered : fallbackArticles;
  const usedFallback = !liveFiltered.length && fallbackArticles.length > 0;
  console.info("[potus] candidates:", liveCandidates.length, "filtered:", liveFiltered.length, "fallbackUsed:", usedFallback);
  return {
    articles: resolved,
    hasLiveArticles: liveFiltered.length > 0,
    hasFallbackArticles: fallbackArticles.length > 0,
    usedFallback
  };
};
const classifyPotusTopic = (article = {}) => {
  const text = articleText(article).toLowerCase();
  for (const [label, keywords] of Object.entries(POTUS_TOPIC_BUCKETS)) {
    if (keywords.some((kw) => text.includes(kw))) return label;
  }
  return "Campaign / Politics";
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
const SOURCE_SHORT_WHITELIST = new Set(["AP", "NYT", "WSJ", "BBC", "CNN", "TOI", "NDTV"]);
const isStrongSourceLabel = (source = "") => {
  const clean = String(source || "").trim();
  if (!clean) return false;
  if (/^(unknown|source|news|n\/a|na|null|undefined|_|-+|"+|'+)$/i.test(clean)) return false;
  const alphaChars = (clean.match(/[A-Za-z]/g) || []).length;
  if (!alphaChars) return false;
  const compact = clean.replace(/[^A-Za-z]/g, "");
  if (SOURCE_SHORT_WHITELIST.has(compact.toUpperCase())) return true;
  return compact.length >= 3 && alphaChars >= 3;
};
const isValidTimeline = (timeline) =>
  Array.isArray(timeline) && timeline.length === 4 && timeline.every(point =>
    point && typeof point === "object" &&
    ["pos", "neu", "neg"].every((key) => Number.isFinite(Number(point[key])))
  );
const bootstrapTime = (payload) => new Date(payload?.generatedAt || 0).getTime() || 0;
function applyBootstrapSnapshot(snapshot, { persist = false, source = "snapshot" } = {}){
  if (!isValidBootstrapSnapshot(snapshot)) return false;
  const freshness = evaluateFreshness(snapshot);
  if (source !== "live" && !freshness.fresh){
    console.info("[freshness] snapshot rejected", { source, key: BOOTSTRAP_CACHE_KEY, reason: freshness.reason });
    return false;
  }
  console.info(`[freshness] ${source === "live" ? "live accepted" : "snapshot accepted"}`, {
    source,
    generatedAt: snapshot.generatedAt || ""
  });
  const news = snapshot.news || {};
  state.allArticles = Array.isArray(news.articles) ? news.articles : [];
  state.articles = state.allArticles.slice();
  state.indiaArticles = state.allArticles.filter(a => a.category === "india");
  state.topics = Array.isArray(news.topics)
    ? selectTrendingTopics(news.topics, state.allArticles)
    : [];
  state.stories = Array.isArray(news.stories) ? news.stories : [];
  state.engagedStories = Array.isArray(news.engagedStories) ? news.engagedStories : [];
  state.topStories = {
    indiaRecent: news.topStories?.indiaRecent || [],
    indiaEngaged: news.topStories?.indiaEngaged || [],
    worldRecent: news.topStories?.worldRecent || [],
    worldEngaged: news.topStories?.worldEngaged || []
  };
  syncHeroSnapshot(`bootstrap:${source}`);
  state.newsEmptyMessage = state.allArticles.length
    ? ""
    : "No news available right now. Please check back soon.";
  state.bootstrapSentiment = snapshot.sentiment || null;
  state.bootstrapPlots = snapshot.plots || null;
  state.bootstrapIndustryLeaderboard = snapshot.industryLeaderboard || null;
  state.bootstrapGeneratedAt = snapshot.generatedAt || "";
  state.bootstrapUsa = snapshot.usa || null;
  state.bootstrapPotus = snapshot.potus || null;
  state.usingFallbackSnapshot = source !== "live";
  state.isStaleMode = false;
  state.fallbackUpdatedAt = snapshot.generatedAt || state.fallbackUpdatedAt || "";
  state.fallbackMessage = state.usingFallbackSnapshot ? SNAPSHOT_FALLBACK_MESSAGE : "";

  if (snapshot?.meta?.markets?.quotes?.length){
    writeMarketCache(snapshot.meta.markets);
  }
  if (persist){
    writeLocalCache(BOOTSTRAP_CACHE_KEY, snapshot);
  }
  hasCachedContent = Boolean(
    state.allArticles.length || state.stories.length || state.topics.length
  );
  syncPinsWithArticles();
  renderPinnedChips();
  renderAll();
  return hasCachedContent;
}
function applyBootstrapCache(){
  const cached = readLocalCache(BOOTSTRAP_CACHE_KEY);
  if (!isValidBootstrapSnapshot(cached)) return false;
  return applyBootstrapSnapshot(cached, { source: "local-cache" });
}
async function applyStaticBootstrapSnapshot(){
  try{
    const response = await fetch(`/data/bootstrap.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const snapshot = await response.json();
    return applyBootstrapSnapshot(snapshot, { persist: true, source: "static-cache" });
  }catch{
    return false;
  }
}
async function refreshBootstrapSnapshot(){
  const endpoint = `/data/bootstrap.json?t=${Date.now()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try{
    const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const incoming = await response.json();
    if (!isValidBootstrapSnapshot(incoming)) return false;
    const current = readLocalCache(BOOTSTRAP_CACHE_KEY);
    if (!isValidBootstrapSnapshot(current) || bootstrapTime(incoming) > bootstrapTime(current)){
      applyBootstrapSnapshot(incoming, { persist: true, source: "live" });
      return true;
    }
    return false;
  }catch{
    return false;
  }finally{
    clearTimeout(timeout);
  }
}
const isUsefulSplitPayload = (payload, key) => {
  if (!payload || typeof payload !== "object" || !payload.generatedAt) return false;
  if (!evaluateFreshness(payload).fresh) return false;
  if (["latestNews", "usaNews", "potusNews"].includes(key)) return Array.isArray(payload.articles) && payload.articles.length > 0;
  if (["sourceSentiment", "industrySentiment"].includes(key)) return Array.isArray(payload.rows) && payload.rows.length > 0;
  if (key === "trendingHistory") return Array.isArray(payload.points) && payload.points.length > 0;
  return true;
};
async function loadSplitSnapshots(){
  const files = {
    latestNews: "/data/latest-news.json",
    sourceSentiment: "/data/source-sentiment.json",
    industrySentiment: "/data/industry-sentiment.json",
    usaNews: "/data/usa-news.json",
    potusNews: "/data/potus-news.json",
    trendingHistory: "/data/trending-history.json"
  };
  const next = {};
  await Promise.all(Object.entries(files).map(async ([key, file]) => {
    try{
      const response = await fetch(`${file}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok){
        setDebugFile(file, { loaded: false, status: response.status });
        return;
      }
      const payload = await response.json();
      if (key === "potusNews" && !safeArray(payload?.articles).length && safeArray(payload?.dailyNews).length){
        payload.articles = safeArray(payload.dailyNews);
      }
      if (isUsefulSplitPayload(payload, key)){
        if (key === "latestNews"){
          const existingTopStories = safeArray(state.splitSnapshots?.latestNews?.topStories);
          const incomingTopStories = safeArray(payload?.topStories);
          const incomingQuality = evaluateHeroPayloadQuality(incomingTopStories.map(asTopStoryCluster));
          const existingQuality = evaluateHeroPayloadQuality(existingTopStories.map(asTopStoryCluster));
          if (heroQualityRank(incomingQuality.quality) < heroQualityRank(existingQuality.quality)){
            payload.topStories = existingTopStories;
            logHeroUpdate(`split:${key}`, incomingQuality, existingQuality, false, "kept-existing-stronger-split");
          } else if (!incomingTopStories.length && existingTopStories.length){
            payload.topStories = existingTopStories;
            logHeroUpdate(`split:${key}`, incomingQuality, existingQuality, false, "kept-existing-non-empty-split");
          }
        }
        next[key] = payload;
        setDebugFile(file, {
          loaded: true,
          generatedAt: payload.generatedAt || "",
          counts: payload.counts || {},
          source: "snapshot-file"
        });
      } else {
        setDebugFile(file, { loaded: false, reason: "invalid-or-empty-payload" });
      }
    }catch(error){
      setDebugFile(file, { loaded: false, reason: error?.message || "fetch-failed" });
    }
  }));
  if (Object.keys(next).length){
    state.splitSnapshots = { ...(state.splitSnapshots || {}), ...next };
    syncHeroSnapshot("split-snapshot:merge");
    writeLocalCache(SNAPSHOT_SPLIT_CACHE_KEY, state.splitSnapshots);
    return state.splitSnapshots;
  }
  const cached = readLocalCache(SNAPSHOT_SPLIT_CACHE_KEY);
  if (cached && typeof cached === "object"){
    const filtered = Object.fromEntries(
      Object.entries(cached).filter(([key, payload]) => isUsefulSplitPayload(payload, key))
    );
    if (!Object.keys(filtered).length){
      console.info("[freshness] snapshot rejected", { source: "local-cache", key: SNAPSHOT_SPLIT_CACHE_KEY, reason: "all-sections-stale" });
      return state.splitSnapshots;
    }
    state.splitSnapshots = filtered;
    syncHeroSnapshot("split-snapshot:cache");
    Object.entries(files).forEach(([, file]) => {
      setDebugFile(file, { loaded: true, source: "local-cache" });
    });
  }
  return state.splitSnapshots;
}
function applyHomepageSnapshot(snapshot, { persist = false, source = "homepage" } = {}){
  if (!isValidHomepageSnapshot(snapshot)) return false;
  const freshness = evaluateFreshness(snapshot);
  if (source !== "live" && !freshness.fresh){
    console.info("[freshness] snapshot rejected", { source, key: HOMEPAGE_CACHE_KEY, reason: freshness.reason });
    return false;
  }
  console.info(`[freshness] ${source === "live" ? "live accepted" : "snapshot accepted"}`, {
    source,
    generatedAt: snapshot.generatedAt || ""
  });
  const sections = snapshot.sections || {};
  const splitFromHomepage = {
    latestNews: {
      generatedAt: snapshot.generatedAt,
      articles: safeArray(sections.latestNews?.articles),
      topStories: safeArray(sections.hero?.slides)
    },
    sourceSentiment: {
      generatedAt: snapshot.generatedAt,
      rows: safeArray(sections.sourceSentiment?.rows)
    },
    industrySentiment: {
      generatedAt: snapshot.generatedAt,
      rows: safeArray(sections.industrySentiment?.rows),
      buckets: sections.industrySentiment?.buckets || { rows: [], pos: [], neu: [], neg: [] }
    },
    trendingHistory: {
      generatedAt: snapshot.generatedAt,
      points: safeArray(sections.trending?.points),
      world: safeArray(sections.trending?.world),
      india: safeArray(sections.trending?.india),
      usa: safeArray(sections.trending?.usa)
    },
    usaNews: {
      generatedAt: snapshot.generatedAt,
      articles: safeArray(sections.usa?.articles),
      topStories: safeArray(sections.usa?.topStories),
      sentiment: sections.usa?.sentiment || {}
    },
    potusNews: {
      generatedAt: snapshot.generatedAt,
      articles: safeArray(sections.potus?.articles).length
        ? safeArray(sections.potus?.articles)
        : safeArray(sections.potus?.dailyNews),
      topStories: safeArray(sections.potus?.topStories),
      sourceLeaderboard: safeArray(sections.potus?.sourceLeaderboard),
      topicSentiment: safeArray(sections.potus?.topicSentiment)
    }
  };
  state.splitSnapshots = { ...(state.splitSnapshots || {}), ...splitFromHomepage };
  syncHeroSnapshot(`homepage:${source}`);
  state.fallbackUpdatedAt = snapshot.generatedAt || state.fallbackUpdatedAt;
  state.usingFallbackSnapshot = source !== "live";
  state.isStaleMode = false;
  state.fallbackMessage = state.usingFallbackSnapshot ? SNAPSHOT_FALLBACK_MESSAGE : "";
  hasCachedContent = hasCachedContent || hasHealthySnapshotData();
  if (persist){
    writeLocalCache(HOMEPAGE_CACHE_KEY, snapshot);
    writeLocalCache(SNAPSHOT_SPLIT_CACHE_KEY, state.splitSnapshots);
  }
  syncPinsWithArticles();
  renderPinnedChips();
  renderAll();
  return true;
}
function applyHomepageCache(){
  const cached = readLocalCache(HOMEPAGE_CACHE_KEY);
  if (!isValidHomepageSnapshot(cached)) return false;
  return applyHomepageSnapshot(cached, { source: "local-homepage-cache" });
}
async function applyStaticHomepageSnapshot(){
  try{
    const response = await fetch(`/data/homepage.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const snapshot = await response.json();
    return applyHomepageSnapshot(snapshot, { persist: true, source: "static-homepage" });
  }catch{
    return false;
  }
}
const fetchWithRetry = async (
  path,
  { timeoutMs = 5000, retries = 3, backoffMs = [250, 750, 1500] } = {}
) => {
  const url = buildApiUrl(path);
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1){
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try{
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }catch(error){
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries - 1){
        const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
};
const isNonEmptyArray = (v) => Array.isArray(v) && v.length > 0;

const readSentimentLocalCache = () => {
  const cached = readLocalCache(SENTIMENT_CACHE_KEY);
  return cached && typeof cached === "object" ? cached : null;
};

const writeSentimentLocalCache = (payload) => {
  if (!payload || typeof payload !== "object") return;
  writeLocalCache(SENTIMENT_CACHE_KEY, payload);
};

const normalizeSentimentPayload = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  const worldTimeline = isNonEmptyArray(payload?.timelines?.world) ? payload.timelines.world : null;
  const indiaTimeline = isNonEmptyArray(payload?.timelines?.india) ? payload.timelines.india : null;
  const sourceLeaderboard = isNonEmptyArray(payload?.sourceLeaderboard) ? payload.sourceLeaderboard : [];
  const industrySentiment = isNonEmptyArray(payload?.industrySentiment) ? payload.industrySentiment : [];
  const industryBuckets = payload?.industryBuckets && typeof payload.industryBuckets === "object"
    ? payload.industryBuckets
    : { minTaggedArticles: 2, bucketTaggedCounts: { pos: 0, neu: 0, neg: 0 }, hasEnoughTaggedArticles: false, pos: [], neu: [], neg: [] };
  const topicSentiment = isNonEmptyArray(payload?.topicSentiment) ? payload.topicSentiment : [];
  if (!worldTimeline && !indiaTimeline && !sourceLeaderboard.length && !industrySentiment.length) return null;
  const staleDataTimestamp = Number(
    payload?._meta?.staleDataTimestamp ||
    payload?.fetchedAt ||
    new Date(payload?.generatedAt || 0).getTime() ||
    Date.now()
  );
  return {
    ...payload,
    timelines: {
      world: worldTimeline || [],
      india: indiaTimeline || []
    },
    sourceLeaderboard,
    industrySentiment,
    industryBuckets: {
      ...industryBuckets,
      pos: isNonEmptyArray(industryBuckets?.pos) ? industryBuckets.pos : [],
      neu: isNonEmptyArray(industryBuckets?.neu) ? industryBuckets.neu : [],
      neg: isNonEmptyArray(industryBuckets?.neg) ? industryBuckets.neg : [],
      bucketTaggedCounts: industryBuckets?.bucketTaggedCounts || { pos: 0, neu: 0, neg: 0 }
    },
    topicSentiment,
    staleDataTimestamp,
    staleDataTimestampISO:
      payload?._meta?.staleDataTimestampISO ||
      new Date(staleDataTimestamp).toISOString(),
    message: payload.message || "Collecting enough articles for sentiment calculation"
  };
};

async function loadSentimentData(){
  const localCached = normalizeSentimentPayload(readSentimentLocalCache());
  try{
    const live = normalizeSentimentPayload(await fetchJSON('/api/sentiment'));
    if (live){
      state.sentimentData = live;
      state.sentimentStaleDataTimestamp = Number(live.staleDataTimestamp || 0);
      state.sentimentStaleDataTimestampISO = live.staleDataTimestampISO || "";
      writeSentimentLocalCache(live);
      return live;
    }
  }catch{}
  for (const staticPath of ["/data/sentiment_cache.json"]){
    try{
      const response = await fetch(`${staticPath}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) continue;
      const staticPayload = normalizeSentimentPayload(await response.json());
      if (!staticPayload) continue;
      state.sentimentData = staticPayload;
      state.sentimentStaleDataTimestamp = Number(staticPayload.staleDataTimestamp || 0);
      state.sentimentStaleDataTimestampISO = staticPayload.staleDataTimestampISO || "";
      writeSentimentLocalCache(staticPayload);
      return staticPayload;
    }catch{}
  }
  if (localCached){
    state.sentimentData = localCached;
    state.sentimentStaleDataTimestamp = Number(localCached.staleDataTimestamp || 0);
    state.sentimentStaleDataTimestampISO = localCached.staleDataTimestampISO || "";
    return localCached;
  }
  state.sentimentData = {
    message: "Collecting enough articles for sentiment calculation",
    timelines: { world: [], india: [] },
    sourceLeaderboard: [],
    industrySentiment: [],
    topicSentiment: [],
    staleDataTimestamp: Date.now(),
    staleDataTimestampISO: new Date().toISOString()
  };
  state.sentimentStaleDataTimestamp = state.sentimentData.staleDataTimestamp;
  state.sentimentStaleDataTimestampISO = state.sentimentData.staleDataTimestampISO;
  return state.sentimentData;
}

const domainFromUrl = (u = "") => {
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch { return ""; }
};

/* Canonical domains for clean logos */
const LOGO_DOMAIN_MAP = {
  "India Today":"indiatoday.in",
  "The Hindu":"thehindu.com",
  "Scroll.in":"scroll.in","Scroll":"scroll.in",
  "News18":"news18.com","NEWS18":"news18.com",
  "Deccan Herald":"deccanherald.com","DH":"deccanherald.com",
  "ThePrint":"theprint.in","Mint":"livemint.com",
  "Hindustan Times":"hindustantimes.com",
  "Times of India":"timesofindia.indiatimes.com","TOI":"timesofindia.indiatimes.com",
  "Indian Express":"indianexpress.com","The Indian Express":"indianexpress.com",
  "NDTV":"ndtv.com",
  "Firstpost":"firstpost.com",
  "Business Standard":"business-standard.com",
  "The Economic Times":"economictimes.indiatimes.com",
  "Moneycontrol":"moneycontrol.com",
  "Reuters":"reuters.com",
  "BBC":"bbc.com",
  "Al Jazeera":"aljazeera.com",
  "The Wire":"thewire.in",
  "The Quint":"thequint.com",
  "Deccan Chronicle":"deccanchronicle.com",
  "LiveMint":"livemint.com",
  "Guardian":"theguardian.com",
  "PIB":"pib.gov.in"
};
const CANONICAL_SOURCE_BY_DOMAIN = {
  "thehindu.com": "The Hindu",
  "indianexpress.com": "The Indian Express",
  "hindustantimes.com": "Hindustan Times",
  "indiatoday.in": "India Today",
  "ndtv.com": "NDTV",
  "livemint.com": "Mint",
  "business-standard.com": "Business Standard",
  "economictimes.indiatimes.com": "The Economic Times",
  "moneycontrol.com": "Moneycontrol",
  "cnbctv18.com": "CNBC-TV18",
  "news18.com": "News18",
  "deccanherald.com": "Deccan Herald",
  "scroll.in": "Scroll",
  "timesofindia.indiatimes.com": "Times of India",
  "theprint.in": "ThePrint",
  "financialexpress.com": "Financial Express",
  "firstpost.com": "Firstpost",
  "aninews.in": "ANI News",
  "wionews.com": "WION",
  "reuters.com": "Reuters",
  "apnews.com": "AP",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC Sport",
  "aljazeera.com": "Al Jazeera",
  "cnn.com": "CNN",
  "foxnews.com": "Fox News",
  "nbcnews.com": "NBC News",
  "cbsnews.com": "CBS News",
  "abcnews.go.com": "ABC News",
  "cnbc.com": "CNBC",
  "washingtonpost.com": "Washington Post",
  "wsj.com": "WSJ",
  "nytimes.com": "NYT",
  "bloomberg.com": "Bloomberg",
  "theguardian.com": "The Guardian",
  "politico.com": "Politico",
  "axios.com": "Axios",
  "npr.org": "NPR",
  "usatoday.com": "USA Today",
  "latimes.com": "Los Angeles Times",
  "techcrunch.com": "TechCrunch",
  "theverge.com": "The Verge",
  "arstechnica.com": "Ars Technica",
  "wired.com": "Wired",
  "engadget.com": "Engadget",
  "technologyreview.com": "MIT Technology Review",
  "sciencedaily.com": "ScienceDaily",
  "newscientist.com": "New Scientist",
  "medicalxpress.com": "Medical Xpress",
  "espncricinfo.com": "ESPN Cricinfo",
  "espn.com": "ESPN",
  "skysports.com": "Sky Sports",
  "goal.com": "Goal",
  "statnews.com": "STAT"
};
const normalizeSourceKey = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const SOURCE_NAME_TO_DOMAIN = (() => {
  const map = new Map();
  Object.entries(CANONICAL_SOURCE_BY_DOMAIN).forEach(([domain, name]) => {
    map.set(normalizeSourceKey(name), domain);
  });
  Object.entries(LOGO_DOMAIN_MAP).forEach(([name, domain]) => {
    map.set(normalizeSourceKey(name), domain);
  });
  return map;
})();
const SOURCE_ALIAS_TO_DOMAIN = {
  ani: "aninews.in",
  wion: "wionews.com",
  news18: "news18.com",
  toi: "timesofindia.indiatimes.com",
  et: "economictimes.indiatimes.com",
  nyt: "nytimes.com",
  wsj: "wsj.com",
  ap: "apnews.com",
  bbc: "bbc.com",
  ndtv: "ndtv.com"
};

const LOCAL_LOGOS = {
  "indiatoday.in":"/logo/indiatoday.png",
  "thehindu.com":"/logo/thehindu.png",
  "scroll.in":"/logo/scroll.png",
  "news18.com":"/logo/news18.png",
  "deccanherald.com":"/logo/deccanherald.png",
  "theprint.in":"/logo/theprint.png",
  "hindustantimes.com":"/logo/hindustantimes.png",
  "timesofindia.indiatimes.com":"/logo/toi.png",
  "indiatoday.com":"/logo/indiatoday.png",
  "indianexpress.com":"/logo/indianexpress.png",
  "ndtv.com":"/logo/ndtv.png",
  "firstpost.com":"/logo/firstpost.png",
  "business-standard.com":"/logo/businessstandard.png",
  "economictimes.indiatimes.com":"/logo/economictimes.png",
  "reuters.com":"/logo/reuters.png",
  "bbc.com":"/logo/bbc.png",
  "aljazeera.com":"/logo/aljazeera.png",
  "thewire.in":"/logo/thewire.png",
  "livemint.com":"/logo/livemint.png",
  "theguardian.com":"/logo/guardian.png",
  "pib.gov.in":"/logo/pib.png"
};

const inferDomainFromSourceText = (value = "") => {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const decoded = decodeURIComponent(clean);
  const siteMatch = decoded.match(/site:([a-z0-9.-]+\.[a-z]{2,})/i);
  if (siteMatch?.[1]) return siteMatch[1].toLowerCase().replace(/^www\./, "");
  const hostMatch = decoded.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i);
  if (hostMatch?.[1]) return hostMatch[1].toLowerCase().replace(/^www\./, "");
  return "";
};
const resolveDomainFromSourceName = (sourceName = "") => {
  const normalizedSource = normalizeSourceName(sourceName) || sourceName;
  const key = normalizeSourceKey(normalizedSource);
  if (!key) return "";
  const direct = SOURCE_NAME_TO_DOMAIN.get(key);
  if (direct) return direct;
  const compact = key.replace(/\s+/g, "");
  if (SOURCE_ALIAS_TO_DOMAIN[compact]) return SOURCE_ALIAS_TO_DOMAIN[compact];
  return "";
};
const getSourceLogoUrl = (sourceDomain = "", sourceName = "", { allowRemote = false } = {}) => {
  const cleanDomain = String(sourceDomain || "").trim().toLowerCase().replace(/^www\./, "");
  const mapDom = LOGO_DOMAIN_MAP[String(sourceName || "").trim()]
    || resolveDomainFromSourceName(sourceName)
    || "";
  const inferredDomain = inferDomainFromSourceText(sourceName);
  const d = cleanDomain && cleanDomain !== "news.google.com"
    ? cleanDomain
    : (mapDom || inferredDomain || domainFromUrl(sourceName) || "");
  if (LOCAL_LOGOS[d]) return LOCAL_LOGOS[d];
  if (d && CANONICAL_SOURCE_BY_DOMAIN[d]) return `/logo/sources/${d}.svg`;
  return "";
};
const logoFor = (link = "", source = "") =>
  getSourceLogoUrl(domainFromUrl(link), source, { allowRemote: false });

const PLACEHOLDER = "/img/placeholder-news.svg";
const THUMB_PLACEHOLDER = "/icon-512.png";
const LEGACY_THUMB_PLACEHOLDER = "thumb-placeholder.svg";
const LOGO_PLACEHOLDER =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>
       <rect width='64' height='64' rx='12' ry='12' fill='#f5f7fb'/>
       <rect x='16' y='18' width='32' height='24' rx='6' ry='6' fill='none' stroke='#9fb3c8' stroke-width='4'/>
       <circle cx='28' cy='30' r='4' fill='none' stroke='#9fb3c8' stroke-width='3'/>
       <path d='M22 40 L30 32 L42 42' fill='none' stroke='#9fb3c8' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/>
     </svg>`
  );

const ogImageCache = new Map();
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|#|$)/i;
const IMAGE_HOST_HINTS = [
  "images",
  "img",
  "cdn",
  "media",
  "static",
  "cloudfront.net",
  "akamai",
  "gstatic.com",
  "googleusercontent.com",
  "twimg.com",
  "fbcdn.net",
  "unsplash.com",
  "wp-content",
  "imgur.com"
];
const IMAGE_REJECT_FRAGMENTS = ["/sitemap/", "/archive/"];
const isFallbackLogo = (url = "") => {
  const lower = String(url || "").toLowerCase();
  if (!lower) return true;
  if (lower.startsWith("data:image")) return true;
  if (lower.includes("logo.clearbit.com")) return true;
  if (lower.includes("/logo/")) return true;
  if (lower.includes("favicon")) return true;
  return lower.includes("logo.");
};
const normalizeDailyThumbSrc = (value = "") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  const decoded = decodeURIComponent(cleaned).toLowerCase();
  if (decoded.includes(LEGACY_THUMB_PLACEHOLDER)) return THUMB_PLACEHOLDER;
  if (cleaned.startsWith("/")) return cleaned;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return "";
};
const isLikelyImageUrl = (url = "") => {
  const cleaned = String(url || "").trim();
  if (!cleaned) return false;
  if (cleaned.length > 220) return false;
  if (/\s/.test(cleaned)) return false;
  const lower = cleaned.toLowerCase();
  if (lower.includes(LEGACY_THUMB_PLACEHOLDER)) return false;
  if (IMAGE_REJECT_FRAGMENTS.some(fragment => lower.includes(fragment))) return false;
  let parsed;
  try{
    parsed = new URL(cleaned);
  }catch{
    return false;
  }
  if (IMAGE_EXT_RE.test(parsed.pathname)) return true;
  const host = parsed.hostname.toLowerCase();
  if (IMAGE_HOST_HINTS.some(hint => host.includes(hint) || lower.includes(`/${hint}/`)))
    return true;
  return lower.includes("og:image");
};
const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

const ARTICLE_DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata"
});
const HERO_TREND_TIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata"
});

function formatArticleDate(value){
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const raw = typeof value === "string" ? value : "";
  const hasTime = raw ? /(\d{1,2}:\d{2})/.test(raw) || /T\d{2}:\d{2}/.test(raw) : true;
  const parts = ARTICLE_DATE_FORMATTER.formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  if (!parts.month || !parts.day || !parts.year) return "";
  if (!hasTime || !parts.hour || !parts.minute){
    return `${parts.month} ${parts.day}, ${parts.year}, IST`;
  }
  return `${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute} IST`;
}
function formatTrendTime(value){
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return HERO_TREND_TIME_FORMATTER.format(date);
}

const TOPIC_STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","when","while","for","to","of",
  "in","on","at","by","from","with","without","over","under","into","onto","off",
  "up","down","out","about","as","is","are","was","were","be","been","being",
  "this","that","these","those","it","its","their","his","her","our","your","my",
  "not","no","yes","new","news","latest","live","update","updates","today","day",
  "http","https","www","com","net","org","site","archive","sitemap","sends","legal",
  "report","reports","says","say","said","tells","told","after","before","amid",
  "reveals","reveal","announces","announce","breaking","liveblog","blog","watch",
  "video","photos","photo","gallery","exclusive","analysis","opinion","editorial"
]);
const TOPIC_BLACKLIST = new Set([
  "search results",
  "producer sends",
  "colluded with",
  "breaking news",
  "latest news",
  "live updates",
  "news update",
  "news updates",
  "read more",
  "click here",
  "full story"
]);
const ALLOWED_ACRONYMS = new Set([
  "AI","BJP","RSS","IPL","ISRO","GDP","NASA","PM","UPI","RBI","SEBI","NSE","BSE",
  "US","UK","UAE","UN","EU","IMF","WHO"
]);
const TOPIC_URL_TOKENS = new Set([
  "http","https","www","com","net","org","site","archive","sitemap","frontline"
]);
const TOPIC_VERBS = new Set([
  "announce","announces","announced","approve","approves","approved","ban","bans",
  "ban","banned","boost","boosts","boosted","call","calls","called","crack",
  "cracks","curb","curbs","curbed","cut","cuts","cutting","demand","demands",
  "discuss","discusses","discussed","drop","drops","dropped","faces","face",
  "fight","fights","fought","file","files","filed","focus","focuses","focused",
  "launch","launches","launched","lift","lifts","lifted","meet","meets","met",
  "move","moves","moved","probe","probes","probed","raise","raises","raised",
  "seek","seeks","sought","sets","set","sign","signs","signed","slam","slams",
  "target","targets","targeted","warn","warns","warned","win","wins","won"
]);
const PREFERRED_TOPICS_KEY = "preferredTopics";
const TOPIC_OPTIONS = [
  "India","World","Business","Technology","Entertainment","Sports","Science",
  "Health","Politics","Economy","Crime","Climate","AI","Markets","Startups"
];
const TOPIC_KEYWORDS = {
  india: ["india","indian","bharat","delhi","mumbai","bengaluru"],
  world: ["world","global","international","foreign","overseas"],
  business: ["business","corporate","company","industry","enterprise"],
  technology: ["technology","tech","software","internet","gadget","digital"],
  entertainment: ["entertainment","bollywood","hollywood","film","music","celebrity"],
  sports: ["sport","sports","cricket","football","match","tournament","ipl"],
  science: ["science","research","space","nasa","isro","laboratory"],
  health: ["health","medical","hospital","disease","wellness","covid"],
  politics: ["politics","election","government","minister","parliament","bjp","congress"],
  economy: ["economy","gdp","inflation","fiscal","growth","policy"],
  crime: ["crime","police","arrest","murder","fraud","scam","assault"],
  climate: ["climate","environment","weather","carbon","emissions","flood"],
  ai: ["ai","artificial intelligence","machine learning","automation"],
  markets: ["market","markets","stocks","shares","nifty","trading"],
  startups: ["startup","start-up","founder","venture","funding","seed","series"]
};
const POSITIVE_CUES = [
  "win","growth","record","breakthrough","approval","peace","success","boost",
  "deal","launch","surge","recovery","investment","expansion","milestone"
];
const NEGATIVE_CUES = [
  "rape","death","killed","attack","crash","violence","fraud","scam","crisis",
  "war","conflict","accused","assault","arrest","collapse","shooting","terror"
];
const normalizeTopicText = (t = "") =>
  t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const formatTopicTokens = (tokens = []) =>
  tokens.map(word => {
    if (!word) return "";
    const upper = word.toUpperCase();
    if (ALLOWED_ACRONYMS.has(upper)) return upper;
    if (word.toUpperCase() === word) return word;
    if (/[a-z][A-Z]/.test(word)) return word;
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ").trim();
const looksLikeUrl = (t = "") =>
  /https?:\/\//i.test(t) ||
  /www\./i.test(t) ||
  /\b[a-z0-9-]+\.(com|net|org|in|co|gov|edu|io|info)\b/i.test(t) ||
  /\/(sitemap|archive)\//i.test(t);

function filterTopicTokens(tokens = []){
  const cleaned = tokens.filter(Boolean);
  if (!cleaned.length) return [];
  const allSingle = cleaned.every(token => token.length === 1);
  if (allSingle){
    const acronym = cleaned.join("").toUpperCase();
    return ALLOWED_ACRONYMS.has(acronym) ? [acronym] : [];
  }
  return cleaned.filter(token => {
    const upper = token.toUpperCase();
    if (token.length === 1) return false;
    if (token.length <= 2 && token === upper){
      return ALLOWED_ACRONYMS.has(upper);
    }
    return true;
  });
}

function scoreTopicSegment(segment = ""){
  const normalized = normalizeTopicText(segment);
  if (!normalized) return { score: -100, title: "" };
  if (looksLikeUrl(segment) || TOPIC_BLACKLIST.has(normalized)) return { score: -100, title: "" };
  const rawTokens = segment.match(/[A-Za-z0-9]+/g) || [];
  if (rawTokens.length < 2) return { score: -100, title: "" };
  const lowerTokens = rawTokens.map(t => t.toLowerCase());
  const cleanedTokens = rawTokens.filter((t, i) => !TOPIC_STOPWORDS.has(lowerTokens[i]));
  const filteredTokens = filterTopicTokens(cleanedTokens);
  const cleanedLower = filteredTokens.map(t => t.toLowerCase());
  if (filteredTokens.length < 2) return { score: -100, title: "" };
  const startsWithVerb =
    TOPIC_VERBS.has(cleanedLower[0]) && !/^[A-Z]/.test(filteredTokens[0]);
  if (startsWithVerb) return { score: -100, title: "" };
  const hasProper =
    filteredTokens.some(token => /^[A-Z][a-z]/.test(token) || /^[A-Z]{2,}$/.test(token) || /\d/.test(token));
  const meaningful = filteredTokens.filter(t => !TOPIC_URL_TOKENS.has(t.toLowerCase()));
  if (!meaningful.length) return { score: -100, title: "" };
  const trimmed = meaningful.slice(0, 4);
  if (trimmed.length < 2 && !ALLOWED_ACRONYMS.has(trimmed[0]?.toUpperCase())) return { score: -100, title: "" };
  const title = formatTopicTokens(trimmed);
  if (title.length < 6 && !ALLOWED_ACRONYMS.has(title.toUpperCase())) return { score: -100, title: "" };
  let score = trimmed.length * 2;
  if (!hasProper) score -= 2;
  if (normalized.length < 4) score -= 4;
  score += filteredTokens.filter(word => /^[A-Z][a-z]/.test(word)).length;
  return { score, title };
}

function scoreTopic(topic){
  const segments = String(topic.title || "")
    .split("|")
    .map(s => s.trim())
    .filter(Boolean);
  const best = segments.reduce((acc, seg) => {
    const scored = scoreTopicSegment(seg);
    return scored.score > acc.score ? scored : acc;
  }, { score: -100, title: "" });
  if (!best.title) return null;
  let score = best.score;
  score += Math.min(topic.count || 0, 20);
  score += Math.min(topic.sources || 0, 10) * 1.5;
  return { ...topic, displayTitle: best.title, qualityScore: score };
}

function scoreTopicCandidate(topic){
  const base = scoreTopicSegment(topic.displayTitle || topic.title || "");
  if (!base.title) return null;
  let score = base.score;
  score += Math.min(topic.count || 0, 20);
  score += Math.min(topic.sources || 0, 10) * 1.5;
  if ((topic.count || 0) >= 3) score += 2;
  return { ...topic, displayTitle: base.title, qualityScore: score };
}

function topicTokens(topic){
  const normalized = normalizeTopicText(topic.displayTitle || topic.title || "");
  return normalized.split(" ").filter(t => t && !TOPIC_STOPWORDS.has(t));
}

function aggregateSentiment(list = []){
  return list.reduce((acc, a) => {
    const s = a.sentiment || {};
    acc.pos += Number(s.posP ?? s.pos ?? 0);
    acc.neu += Number(s.neuP ?? s.neu ?? 0);
    acc.neg += Number(s.negP ?? s.neg ?? 0);
    return acc;
  }, { pos: 0, neu: 0, neg: 0 });
}

function getTopicArticles(topic, articles){
  const tokens = topicTokens(topic);
  if (!tokens.length) return [];
  return (articles || []).filter(a => {
    const title = normalizeTopicText(a.title || "");
    return tokens.every(t => title.includes(t));
  });
}

function extractHeadlinePhrases(articles = []){
  const results = new Map();
  articles.forEach(article => {
    const title = (article.title || "").replace(/\s+/g, " ").trim();
    if (!title) return;
    const segments = title.split(/[|:–—\-·•]/).map(s => s.trim()).filter(Boolean);
    segments.forEach(segment => {
      if (!segment || looksLikeUrl(segment)) return;
      const rawTokens = segment.match(/[A-Za-z0-9]+/g) || [];
      if (rawTokens.length < 2) return;
      const lowerTokens = rawTokens.map(t => t.toLowerCase());
      const filtered = rawTokens.filter((t, i) => !TOPIC_STOPWORDS.has(lowerTokens[i]));
      const cleaned = filterTopicTokens(filtered);
      const filteredLower = cleaned.map(t => t.toLowerCase());
      if (cleaned.length < 2) return;
      for (let len = 2; len <= 3; len++){
        for (let i = 0; i <= cleaned.length - len; i++){
          const windowTokens = cleaned.slice(i, i + len);
          const windowLower = filteredLower.slice(i, i + len);
          if (windowLower.some(t => TOPIC_URL_TOKENS.has(t))) continue;
          const startsWithVerb =
            TOPIC_VERBS.has(windowLower[0]) && !/^[A-Z]/.test(windowTokens[0]);
          if (startsWithVerb) continue;
          const hasProper =
            windowTokens.some(token => /^[A-Z][a-z]/.test(token) || /^[A-Z]{2,}$/.test(token) || /\d/.test(token));
          if (!hasProper && len < 3) continue;
          const titleText = formatTopicTokens(windowTokens);
          const normalized = normalizeTopicText(titleText);
          if (!normalized || TOPIC_BLACKLIST.has(normalized)) continue;
          if (titleText.length < 6 && !ALLOWED_ACRONYMS.has(titleText.toUpperCase())) continue;
          const entry = results.get(normalized) || {
            title: titleText,
            count: 0,
            sources: new Set()
          };
          entry.count += 1;
          if (article.source) entry.sources.add(article.source);
          results.set(normalized, entry);
        }
      }
    });
  });
  return [...results.values()].map(entry => ({
    title: entry.title,
    count: entry.count,
    sources: entry.sources.size
  }));
}

function buildTopicSparklineBuckets(articles = [], bucketMinutes = 15){
  const now = Date.now();
  const windowMs = 4 * 60 * 60 * 1000;
  const bucketMs = bucketMinutes * 60 * 1000;
  const bucketCount = Math.ceil(windowMs / bucketMs);
  const buckets = Array.from({ length: bucketCount }, () => ({
    pos: 0,
    neg: 0,
    neu: 0,
    c: 0
  }));
  articles.forEach(a => {
    const ts = new Date(a.publishedAt).getTime();
    const age = now - ts;
    if (Number.isNaN(ts) || age < 0 || age > windowMs) return;
    const idx = Math.min(bucketCount - 1, Math.floor(age / bucketMs));
    const slot = (bucketCount - 1) - idx;
    const s = a.sentiment || {};
    buckets[slot].pos += Number(s.posP ?? s.pos ?? 0);
    buckets[slot].neu += Number(s.neuP ?? s.neu ?? 0);
    buckets[slot].neg += Number(s.negP ?? s.neg ?? 0);
    buckets[slot].c += 1;
  });
  const scores = buckets.map(bucket => bucket.c ? (bucket.pos - bucket.neg) / bucket.c : 0);
  const ranges = buckets.map((bucket, i) => {
    const end = now - (bucketCount - i - 1) * bucketMs;
    const start = end - bucketMs;
    const n = Math.max(1, bucket.c);
    return {
      start,
      end,
      pos: Math.round(bucket.pos / n),
      neu: Math.round(bucket.neu / n),
      neg: Math.round(bucket.neg / n),
      c: bucket.c
    };
  });
  return { scores, buckets: ranges, bucketMinutes };
}

function computeTopicTrend(topic, articles){
  const pos = Number(topic.sentiment?.pos ?? 0);
  const neg = Number(topic.sentiment?.neg ?? 0);
  const threshold = 5;
  const tone =
    pos > neg + threshold ? "pos" :
    neg > pos + threshold ? "neg" : "neu";
  const { scores, buckets, bucketMinutes } = buildTopicSparklineBuckets(articles);
  return { tone, scores, buckets, bucketMinutes };
}

function selectTrendingTopics(topics = [], articles = []){
  const extracted = extractHeadlinePhrases(articles).map(scoreTopicCandidate).filter(Boolean);
  const combined = new Map();
  topics.map(scoreTopic).filter(Boolean).forEach(topic => {
    const key = normalizeTopicText(topic.displayTitle || topic.title || "");
    combined.set(key, topic);
  });
  extracted.forEach(topic => {
    const key = normalizeTopicText(topic.displayTitle || topic.title || "");
    if (!combined.has(key)){
      combined.set(key, topic);
      return;
    }
    const existing = combined.get(key);
    combined.set(key, {
      ...existing,
      count: (existing.count || 0) + (topic.count || 0),
      sources: Math.max(existing.sources || 0, topic.sources || 0)
    });
  });

  return [...combined.values()]
    .map(topic => {
      const matches = getTopicArticles(topic, articles);
      const sentiment = matches.length ? aggregateSentiment(matches) : (topic.sentiment || { pos: 0, neu: 0, neg: 0 });
      const sources = matches.length
        ? new Set(matches.map(a => a.source).filter(Boolean)).size
        : (topic.sources || 0);
      const count = matches.length || topic.count || 0;
      return { ...topic, sentiment, sources, count };
    })
    .map(scoreTopicCandidate)
    .filter(Boolean)
    .sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return (b.count || 0) - (a.count || 0);
    })
    .slice(0, 7)
    .map(topic => ({
      ...topic,
      trend: computeTopicTrend(topic, getTopicArticles(topic, articles))
    }));
}

/* sentiment meter */
function formatSentimentLabel(label = ""){
  if (!label) return "Neutral";
  const lower = String(label).toLowerCase();
  if (lower.startsWith("pos")) return "Positive";
  if (lower.startsWith("neg")) return "Negative";
  return "Neutral";
}
function buildWhyPayload(sentiment = {}, context = "", pos = 0, neg = 0){
  const phrases = sentiment.topPhrases || sentiment.top_phrases || [];
  const confidence = Number(sentiment.confidence ?? 0);
  const label = formatSentimentLabel(sentiment.sentimentLabel || sentiment.label);
  const model = sentiment.model || "vader";
  const summary = buildSentimentExplanation(context || "", pos, neg);
  return { label, confidence, phrases, model, summary };
}
function renderSentiment(s, slim = false, context = "", variant = ""){
  const pos = Math.max(0, Number(s.posP ?? s.pos ?? 0));
  const neu = Math.max(0, Number(s.neuP ?? s.neu ?? 0));
  const neg = Math.max(0, Number(s.negP ?? s.neg ?? 0));
  const classes = ["sentiment", slim ? "slim" : "", variant].filter(Boolean).join(" ");
  const why = buildWhyPayload(s, context, pos, neg);
  const whyAttr = why ? ` data-why="${encodeURIComponent(JSON.stringify(why))}"` : "";
  return `
    <div class="${classes}" data-context="${escapeHtml(context)}" data-pos="${pos}" data-neu="${neu}" data-neg="${neg}"${whyAttr}>
      <div class="bar">
        <span class="segment pos" style="width:${pos}%"></span>
        <span class="segment neu" style="width:${neu}%"></span>
        <span class="segment neg" style="width:${neg}%"></span>
      </div>
      <div class="sentiment-line">
        Positive ${fmtPct(pos)} · Neutral ${fmtPct(neu)} · Negative ${fmtPct(neg)}
      </div>
    </div>`;
}

function renderInfoButton(sentiment = {}, context = "", extraClass = ""){
  const pos = Math.max(0, Number(sentiment.posP ?? sentiment.pos ?? 0));
  const neu = Math.max(0, Number(sentiment.neuP ?? sentiment.neu ?? 0));
  const neg = Math.max(0, Number(sentiment.negP ?? sentiment.neg ?? 0));
  const why = buildWhyPayload(sentiment, context, pos, neg);
  const whyAttr = why ? ` data-why="${encodeURIComponent(JSON.stringify(why))}"` : "";
  const classes = ["tile-info", extraClass].filter(Boolean).join(" ");
  return `
    <button class="${classes}" type="button" aria-label="Why this score"
      data-context="${escapeHtml(context)}" data-pos="${pos}" data-neu="${neu}" data-neg="${neg}"${whyAttr}>
      i
    </button>`;
}

function normalizeShareImage(value = ""){
  if (!value) return "";
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const decoded = decodeURIComponent(trimmed).toLowerCase();
  if (decoded.includes(LEGACY_THUMB_PLACEHOLDER)){
    return new URL(THUMB_PLACEHOLDER, window.location.origin).href;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")){
    return new URL(trimmed, window.location.origin).href;
  }
  return "";
}

function buildShareUrl({ url = "", title = "", image = "", source = "" } = {}){
  if (!url) return "";
  const shareUrl = new URL("/s", window.location.origin);
  shareUrl.searchParams.set("u", url);
  if (title) shareUrl.searchParams.set("t", title);
  if (image) shareUrl.searchParams.set("img", image);
  if (source) shareUrl.searchParams.set("src", source);
  return shareUrl.toString();
}

function renderShareButton(article = {}, imageOverride = "", extraClass = ""){
  const url = article?.url || article?.link || "";
  if (!url || url === "#") return "";
  const title = article?.title || "";
  const source = article?.source || "";
  const image = normalizeShareImage(imageOverride || article?.image || article?.imageUrl || article?.thumbnail || article?.imageUrl1 || "");
  const shareUrl = buildShareUrl({ url, title, image, source });
  const classes = ["share-btn", extraClass].filter(Boolean).join(" ");
  return `
    <button class="${classes}" type="button" data-share-url="${escapeHtml(shareUrl)}"
      data-share-title="${escapeHtml(title)}" data-share-text="${escapeHtml(source)}" aria-label="Share">
      <span>Share</span>
    </button>`;
}

/* state */
const state = {
  category: "home",
  filter: "all",
  experimental: false,
  query: "",
  articles: [],
  allArticles: [],
  indiaArticles: [],
  stories: [],
  topics: [],
  engagedStories: [],
  topStories: {
    indiaRecent: [],
    indiaEngaged: [],
    worldRecent: [],
    worldEngaged: []
  },
  topStoriesTrendHistory: [],
  newsEmptyMessage: "",
  pins: loadPins(),
  profile: loadProfile(),
  theme: localStorage.getItem("theme") || "light",
  preferredTopics: loadPreferredTopics(),
  showCredibilityBadges: loadCredibilitySetting(),
  lastLeaderboardAt: 0,
  weatherLocationName: "",
  bootstrapSentiment: null,
  bootstrapPlots: null,
  bootstrapIndustryLeaderboard: null,
  bootstrapGeneratedAt: "",
  bootstrapUsa: null,
  bootstrapPotus: null,
  sentimentData: null,
  sentimentStaleDataTimestamp: 0,
  sentimentStaleDataTimestampISO: "",
  usingFallbackSnapshot: false,
  isStaleMode: false,
  fallbackUpdatedAt: "",
  fallbackMessage: "",
  splitSnapshots: readLocalCache(SNAPSHOT_SPLIT_CACHE_KEY) || {},
  currentHeroSnapshot: readHeroSnapshot(),
  currentHeroQuality: "empty",
  politicalIntelSnapshot: null
};
let hasCachedContent = false;
function logHeroUpdate(source, incoming, current, accepted, reason = ""){
  console.debug("[hero-update]", {
    source,
    incoming: incoming.quality,
    incomingUsable: `${incoming.usableCount}/${incoming.total}`,
    current: current.quality,
    currentUsable: `${current.usableCount}/${current.total}`,
    accepted,
    reason
  });
}
function updateCurrentHeroSnapshot(clusters = [], { source = "unknown", persist = true } = {}){
  const normalized = safeArray(clusters).map(normalizeHeroCluster);
  const incomingQuality = evaluateHeroPayloadQuality(normalized);
  const currentQuality = evaluateHeroPayloadQuality(state.currentHeroSnapshot);
  const incomingRank = heroQualityRank(incomingQuality.quality);
  const currentRank = heroQualityRank(currentQuality.quality);
  if (currentRank > incomingRank){
    logHeroUpdate(source, incomingQuality, currentQuality, false, "blocked-weaker-overwrite");
    return false;
  }
  if (!normalized.length && state.currentHeroSnapshot.length){
    logHeroUpdate(source, incomingQuality, currentQuality, false, "blocked-empty-overwrite");
    return false;
  }
  state.currentHeroSnapshot = normalized;
  state.currentHeroQuality = incomingQuality.quality;
  if (persist && incomingRank >= HERO_QUALITY_RANK.strong){
    writeLocalCache(HERO_SNAPSHOT_KEY, {
      updatedAt: state.fallbackUpdatedAt || state.bootstrapGeneratedAt || new Date().toISOString(),
      clusters: normalized
    });
  }
  logHeroUpdate(source, incomingQuality, currentQuality, true, currentRank === incomingRank ? "equal-or-better" : "upgrade");
  return true;
}
function getHomeHeroCandidates(){
  const topStories = state.topStories || {};
  const splitTop = safeArray(state.splitSnapshots?.latestNews?.topStories).map(asTopStoryCluster);
  if (splitTop.length) return splitTop;
  return safeArray(topStories.indiaRecent).length
    ? safeArray(topStories.indiaRecent).map(asTopStoryCluster)
    : safeArray(topStories.worldRecent).map(asTopStoryCluster);
}
function syncHeroSnapshot(source = "state-sync"){
  updateCurrentHeroSnapshot(getHomeHeroCandidates(), { source, persist: true });
}
state.currentHeroQuality = evaluateHeroPayloadQuality(state.currentHeroSnapshot).quality;

function loadProfile(){
  try{
    const raw = JSON.parse(localStorage.getItem("i360_profile") || "{}");
    if (!Array.isArray(raw.pinnedTopics)) raw.pinnedTopics = [];
    return raw;
  }catch{
    return { pinnedTopics: [] };
  }
}
function loadCredibilitySetting(){
  try{
    const raw = localStorage.getItem(CREDIBILITY_STORAGE_KEY);
    return raw === "1";
  }catch{
    return false;
  }
}
function saveCredibilitySetting(value){
  const flag = value ? "1" : "0";
  localStorage.setItem(CREDIBILITY_STORAGE_KEY, flag);
  state.showCredibilityBadges = value;
}
function saveProfile(p){
  localStorage.setItem("i360_profile", JSON.stringify(p || {}));
  state.profile = p || {};
}
function loadLegacyPinnedTopics(){
  try{
    const raw = JSON.parse(localStorage.getItem(LEGACY_PIN_STORAGE_KEY) || "null");
    if (Array.isArray(raw)) return raw;
  }catch{}
  try{
    const profile = JSON.parse(localStorage.getItem("i360_profile") || "{}");
    if (Array.isArray(profile.pinnedTopics)) return profile.pinnedTopics;
  }catch{}
  return [];
}
function normalizePin(pin){
  if (!pin || !pin.type) return null;
  const value = typeof pin.value === "string" ? pin.value.trim() : "";
  if (!value) return null;
  return {
    type: pin.type,
    value,
    lastArticle: pin.lastArticle || null,
    lastSeenAt: pin.lastSeenAt || null
  };
}
function loadPins(){
  try{
    const raw = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || "null");
    if (Array.isArray(raw)){
      const normalized = raw.map(normalizePin).filter(Boolean).slice(0,2);
      return normalized;
    }
  }catch{}
  const legacy = loadLegacyPinnedTopics();
  if (legacy.length){
    const pins = legacy
      .map(topic => normalizePin({ type:"topic", value: topic }))
      .filter(Boolean)
      .slice(0,2);
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
    return pins;
  }
  return [];
}
function savePins(list){
  const cleaned = (list || []).map(normalizePin).filter(Boolean).slice(0,2);
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(cleaned));
  state.pins = cleaned;
}
function applyTheme(){
  document.body.classList.toggle("theme-dark", state.theme === "dark");
}
function loadPreferredTopics(){
  try{
    const raw = JSON.parse(localStorage.getItem(PREFERRED_TOPICS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  }catch{
    return [];
  }
}
function savePreferredTopics(list){
  const cleaned = (list || []).filter(Boolean);
  localStorage.setItem(PREFERRED_TOPICS_KEY, JSON.stringify(cleaned));
  state.preferredTopics = cleaned;
}
function getPins(){
  return Array.isArray(state.pins) ? state.pins.slice(0,2) : [];
}
function getTopicPins(){
  return getPins().filter(pin => pin.type === "topic").map(pin => pin.value);
}
function snapshotArticle(a){
  if (!a) return null;
  return {
    title: a.title,
    link: a.link,
    source: a.source,
    publishedAt: a.publishedAt,
    sentiment: a.sentiment,
    image: a.image,
    description: a.description
  };
}
function getArticleContext(a){
  if (!a) return "";
  return `${a.title || ""} ${a.description || ""}`.trim();
}
function shuffleArticles(list = []){
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function showPinToast(message){
  const toast = $("#pinToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showPinToast.timer);
  showPinToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}
function matchesTopic(a, topic){
  if (!a || !topic) return false;
  const hay =
    `${a.title || ""} ${a.source || ""} ${a.description || ""}`.toLowerCase();
  return hay.includes(topic.toLowerCase());
}
function normalizePreferredTopic(topic){
  return String(topic || "").trim().toLowerCase();
}
function getPreferredTopicKeywords(topic){
  const key = normalizePreferredTopic(topic);
  return TOPIC_KEYWORDS[key] || [key];
}
function articleMatchesPreferredTopic(article, topic){
  if (!article || !topic) return false;
  const key = normalizePreferredTopic(topic);
  if (!key) return false;
  const tags = Array.isArray(article.tags)
    ? article.tags.join(" ")
    : (article.tags || "");
  const haystack = [
    article.category,
    article.section,
    article.topic,
    article.title,
    article.description,
    tags
  ].filter(Boolean).join(" ").toLowerCase();
  return getPreferredTopicKeywords(key).some(keyword =>
    haystack.includes(keyword.toLowerCase())
  );
}
function timeAgo(ts){
  if (!ts) return "";
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 60) return `${minutes || 1}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* date + weather */
const BRIEFING_DATE_PARTS = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short"
});
const BRIEFING_TIME_PARTS = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short"
});
const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const formatBriefingDateTime = (date = new Date()) => {
  const dateParts = BRIEFING_DATE_PARTS.formatToParts(date);
  const weekday = dateParts.find(part => part.type === "weekday")?.value || "";
  const day = dateParts.find(part => part.type === "day")?.value || "";
  const month = dateParts.find(part => part.type === "month")?.value || "";
  const timeParts = BRIEFING_TIME_PARTS.formatToParts(date);
  const hour = timeParts.find(part => part.type === "hour")?.value || "";
  const minute = timeParts.find(part => part.type === "minute")?.value || "";
  const dayPeriod = timeParts.find(part => part.type === "dayPeriod")?.value || "";
  const rawTimeZone = timeParts.find(part => part.type === "timeZoneName")?.value || "";
  const timeZone =
    LOCAL_TIMEZONE === "Asia/Kolkata" && /GMT\+5:30/.test(rawTimeZone)
      ? "IST"
      : rawTimeZone;
  const timeLabel = `${hour}:${minute} ${dayPeriod.toUpperCase()} ${timeZone}`.trim();
  return `${weekday}, ${day} ${month} · ${timeLabel}`.replace(/\s+/g, " ").trim();
};
const updateBriefingDateTime = () => {
  const el = $("#briefingDate");
  if (!el) return;
  el.textContent = formatBriefingDateTime();
};

const WEATHER_LOCATION_KEY = "i360_weather_location";
const WEATHER_CACHE_KEY = "i360_weather_cache_v1";
const WEATHER_CACHE_TTL = 1000 * 60 * 10;
const DEFAULT_WEATHER = {
  tempC: 28,
  condition: "Clear",
  icon: "☀️",
  location: "India"
};

function getCachedWeatherLocation(){
  if (state.weatherLocationName) return state.weatherLocationName;
  try{
    const stored = localStorage.getItem(WEATHER_LOCATION_KEY) || "";
    const trimmed = stored.trim();
    if (!trimmed) return "";
    if (trimmed.toLowerCase() === "india") return "India";
    if (!trimmed.includes(",")) return `${trimmed}, IN`;
    return trimmed;
  }catch{
    return "";
  }
}
function setCachedWeatherLocation(name){
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  state.weatherLocationName = trimmed;
  try{
    localStorage.setItem(WEATHER_LOCATION_KEY, trimmed);
  }catch{}
}

function getCachedWeather(){
  try{
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || !parsed?.data) return null;
    if (Date.now() - parsed.timestamp > WEATHER_CACHE_TTL) return null;
    return parsed.data;
  }catch{
    return null;
  }
}

function setCachedWeather(data){
  try{
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  }catch{}
}

function getWeatherPresentation(code = 0, isDay = true){
  const dayIcon = (iconDay, iconNight) => (isDay ? iconDay : iconNight);
  if (code === 0) return { condition: "Clear", icon: dayIcon("☀️", "🌙") };
  if (code >= 1 && code <= 3) return { condition: "Cloudy", icon: dayIcon("⛅", "☁️") };
  if (code >= 45 && code <= 48) return { condition: "Fog", icon: dayIcon("🌫️", "🌫️") };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    return { condition: "Rain", icon: dayIcon("🌧️", "🌧️") };
  if (code >= 71 && code <= 77) return { condition: "Snow", icon: dayIcon("❄️", "❄️") };
  if (code >= 95) return { condition: "Thunderstorm", icon: dayIcon("⛈️", "⛈️") };
  return { condition: "Clear", icon: dayIcon("☀️", "🌙") };
}

function renderWeatherCard(data){
  const el = $("#weatherCard");
  if (!el) return;
  const location = escapeHtml(data.location || DEFAULT_WEATHER.location);
  const condition = escapeHtml(data.condition || DEFAULT_WEATHER.condition);
  const tempC = Number.isFinite(data.tempC) ? Math.round(data.tempC) : DEFAULT_WEATHER.tempC;
  const icon = data.icon || DEFAULT_WEATHER.icon;
  el.innerHTML =
    `<div class="wx-icon">${icon}</div>
     <div>
       <div class="wx-city">${location}</div>
       <div class="wx-temp">${tempC}°C · ${condition}</div>
     </div>`;
}

async function getWeather(){
  const cached = getCachedWeather();
  renderWeatherCard(cached || DEFAULT_WEATHER);
  try{
    const coords = await new Promise((res)=>{
      if (!navigator.geolocation)
        return res({ latitude:19.0760, longitude:72.8777, allowed:false });
      navigator.geolocation.getCurrentPosition(
        p => res({ latitude:p.coords.latitude, longitude:p.coords.longitude, allowed:true }),
        () => res({ latitude:19.0760, longitude:72.8777, allowed:false }),
        { timeout: 6000, maximumAge: 60000 }
      );
    });

    const wx = await fetchJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}` +
      `&longitude=${coords.longitude}` +
      `&current=temperature_2m,weather_code,is_day&timezone=auto`
    );

    let locationLabel = coords.allowed ? getCachedWeatherLocation() : "India";
    if (coords.allowed && !state.profile?.city){
      try{
        const rev = await fetchJSON(
          `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${coords.latitude}` +
          `&longitude=${coords.longitude}&language=en`
        );
        const locationName = rev?.results?.[0]?.name;
        const countryCode = rev?.results?.[0]?.country_code;
        if (locationName){
          const normalizedCountry = String(countryCode || "IN").toUpperCase();
          locationLabel = `${locationName}, ${normalizedCountry}`;
          setCachedWeatherLocation(locationLabel);
        }
      }catch{}
    }

    if (!locationLabel){
      locationLabel = coords.allowed ? "India" : "India";
    }

    const tempC = Number(wx?.current?.temperature_2m ?? DEFAULT_WEATHER.tempC);
    const code = Number(wx?.current?.weather_code ?? 0);
    const isDay = wx?.current?.is_day === 1;
    const presentation = getWeatherPresentation(code, isDay);
    const payload = {
      tempC,
      condition: presentation.condition,
      icon: presentation.icon,
      location: coords.allowed ? locationLabel : "India"
    };
    renderWeatherCard(payload);
    setCachedWeather(payload);
  }catch{
    renderWeatherCard(cached || DEFAULT_WEATHER);
  }
}

/* markets – Grid 3 ticker */
function normalizeMarketSymbol(value){
  if (!value) return "";
  return String(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}
function readMarketCache(){
  try{
    return JSON.parse(localStorage.getItem("i360_market_cache") || "null");
  }catch{
    return null;
  }
}
function writeMarketCache(payload){
  localStorage.setItem("i360_market_cache", JSON.stringify({
    updatedAt: payload?.updatedAt || "",
    quotes: payload.quotes || [],
    niftyHistory: Array.isArray(payload?.niftyHistory) ? payload.niftyHistory : []
  }));
}

function getNiftyHistoryPoints(payload){
  if (!payload || !Array.isArray(payload.niftyHistory)) return [];
  return payload.niftyHistory
    .map((point) => ({
      timestamp: Number(point?.timestamp) || 0,
      value: Number(point?.value)
    }))
    .filter((point) => point.timestamp > 0 && Number.isFinite(point.value))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildNiftyTimelineFromHistory(history = [], nowMs = Date.now()){
  if (!Array.isArray(history) || !history.length) return [];
  const slotTimestamps = [3, 2, 1, 0].map((h) => nowMs - (h * 60 * 60 * 1000));
  const hourly = slotTimestamps.map((slotTs) => {
    const match = history.reduce((best, point) => {
      if (point.timestamp > slotTs) return best;
      if (!best || point.timestamp > best.timestamp) return point;
      return best;
    }, null);
    return match ? Number(match.value) : null;
  });
  if (!hourly.some((value) => Number.isFinite(value))) return [];
  return hourly;
}

const formatVisitorMetric = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—");
function renderVisitorStats(payload = {}){
  const wrap = $("#visitorStats");
  const todayEl = $("#visitorStatsToday");
  const last7El = $("#visitorStatsLast7");
  if (!todayEl || !last7El) return;
  const hasAny =
    Number.isFinite(Number(payload?.today?.unique)) ||
    Number.isFinite(Number(payload?.today?.visits)) ||
    Number.isFinite(Number(payload?.last7Days?.unique)) ||
    Number.isFinite(Number(payload?.last7Days?.visits));
  if (!hasAny){
    if (wrap) wrap.hidden = true;
    return;
  }
  if (wrap) wrap.hidden = false;
  const todayUnique = formatVisitorMetric(payload?.today?.unique);
  const todayVisits = formatVisitorMetric(payload?.today?.visits);
  const last7Unique = formatVisitorMetric(payload?.last7Days?.unique);
  const last7Visits = formatVisitorMetric(payload?.last7Days?.visits);
  todayEl.textContent = `Today: ${todayUnique} unique • ${todayVisits} visits`;
  last7El.textContent = `Last 7 days: ${last7Unique} unique • ${last7Visits} visits`;
}
async function loadVisitorStats(){
  renderVisitorStats();
  const endpoint = `/api/visitor-stats?t=${Date.now()}`;
  try{
    const data = await fetchJSON(endpoint);
    renderVisitorStats(data);
  }catch(error){
    logApiError(error, error?.endpoint || endpoint);
    renderVisitorStats();
  }
}

async function loadMarkets(){
  const el = $("#marketTicker");
  if (!el) return;

  const instruments = [
    { label: "NSE Nifty", symbol: "^NSEI" },
    { label: "Gold", symbol: "GC=F" },
    { label: "Crude Oil", symbol: "CL=F" },
    { label: "USD/INR", symbol: "USDINR=X" }
  ];

  const renderMarkets = (data, logMissing) => {
    const updatedTs = parseTimestampMs(data?.updatedAt);
    const updatedAt = updatedTs ? new Date(updatedTs) : null;
    const statusText = updatedAt
      ? `Website updated on ${updatedAt.toLocaleDateString()} · ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Website update time unavailable";
    const updatedEl = $("#updatedAt");
    if (updatedEl){
      updatedEl.textContent = statusText;
    }

    const items = instruments.map(inst => {
      const match = (Array.isArray(data?.quotes) ? data.quotes : [])
        .find(q => normalizeMarketSymbol(q?.symbol) === normalizeMarketSymbol(inst.symbol));
      if (!match && logMissing){
        console.warn("[markets] missing instrument:", inst.label);
      }
      const priceValue = match?.price;
      const hasPrice = typeof priceValue === "number" || (typeof priceValue === "string" && priceValue.trim() !== "");
      const pctValue = Number(match?.changePercent);
      const hasPct = Number.isFinite(pctValue);
      const cls = hasPct ? (pctValue >= 0 ? "up" : "down") : "";
      const sign = pctValue >= 0 ? "▲" : "▼";
      const pctTxt = hasPct ? `${sign} ${Math.abs(pctValue).toFixed(2)}%` : "Updating";
      const changeTxt = typeof match?.change === "number"
        ? match.change.toLocaleString(undefined,{ maximumFractionDigits:2 })
        : null;
      const pTxt = hasPrice
        ? (typeof priceValue === "number"
          ? priceValue.toLocaleString(undefined,{ maximumFractionDigits:2 })
          : priceValue)
        : "Updating";
      return `
        <div class="qpill">
          <span class="sym">${inst.label}</span>
          <span class="price">${pTxt}${changeTxt ? ` (${changeTxt})` : ""}</span>
          <span class="chg ${cls}">${pctTxt}</span>
        </div>`;
    }).join("");
    el.innerHTML = `
      <div class="ticker-row" role="list">${items}</div>`;
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const fetchMarkets = async () => {
    const endpoint = `/api/markets?t=${Date.now()}`;
    const backoffs = [0, 300, 800];
    let lastError;
    for (let i = 0; i < backoffs.length; i += 1){
      if (backoffs[i]){
        await sleep(backoffs[i]);
      }
      try{
        return await fetchJSON(endpoint);
      }catch(error){
        logApiError(error, error?.endpoint || endpoint);
        const shouldRetry =
          API_BASE === "" &&
          FALLBACK_API_BASE &&
          (error?.status === 0 || error?.status === 404);
        if (shouldRetry){
          API_BASE = FALLBACK_API_BASE;
          try{
            return await fetchJSON(endpoint);
          }catch(nextError){
            logApiError(nextError, nextError?.endpoint || endpoint);
            lastError = nextError;
          }
        }else{
          lastError = error;
        }
      }
    }
    throw lastError;
  };

  try{
    const data = await fetchMarkets();
    console.info("[markets] received quotes:", data?.quotes?.map(q => q.symbol || q.pretty || q.name));
    if (Array.isArray(data?.quotes) && data.quotes.length){
      renderMarkets(data, true);
      writeMarketCache(data);
      return;
    }
    throw new Error("Invalid market payload");
  }catch{
    const cached = readMarketCache();
    if (cached?.quotes?.length){
      renderMarkets(cached, true);
      return;
    }
    const fallbackStatus = "Website update time unavailable";
    const updatedEl = $("#updatedAt");
    if (updatedEl){
      updatedEl.textContent = fallbackStatus;
    }
    el.innerHTML = `
      <div class="ticker-row" role="list">${instruments.map(inst => `
        <div class="qpill">
          <span class="sym">${inst.label}</span>
          <span class="price">—</span>
          <span class="chg">—</span>
        </div>`).join("")}</div>
      `;
  }
}

/* pins (Grid 5) */
function pinLabel(pin){
  if (pin.type === "topic") return pin.value;
  const title = pin.lastArticle?.title || "Article";
  return title.length > 26 ? `${title.slice(0,26)}…` : title;
}
function isArticlePinned(link){
  return getPins().some(p => p.type === "article" && p.value === link);
}
function findLatestTopicMatch(topic, articles, usedLinks){
  const t = topic.toLowerCase();
  return articles.reduce((latest, a) => {
    if (!a || usedLinks.has(a.link)) return latest;
    if (!matchesTopic(a, t)) return latest;
    if (!latest) return a;
    const latestTime = new Date(latest.publishedAt || 0).getTime();
    const nextTime = new Date(a.publishedAt || 0).getTime();
    return nextTime > latestTime ? a : latest;
  }, null);
}
function syncPinsWithArticles(){
  const pins = getPins();
  const usedLinks = new Set();
  const articles = state.articles || [];

  pins.forEach(pin => {
    if (pin.type === "article"){
      const match = articles.find(a => a.link === pin.value);
      if (match){
        pin.lastArticle = snapshotArticle(match);
        pin.lastSeenAt = Date.now();
        usedLinks.add(match.link);
      }
    }
  });

  pins.forEach(pin => {
    if (pin.type !== "topic") return;
    const match = findLatestTopicMatch(pin.value, articles, usedLinks);
    if (match){
      pin.lastArticle = snapshotArticle(match);
      pin.lastSeenAt = Date.now();
      usedLinks.add(match.link);
    }
  });

  savePins(pins);
}
function renderPinnedChips(){
  const wrap = $("#pinnedChips");
  if (!wrap) return;
  const pins = getPins();
  if (!pins.length){
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = pins.map((pin,i) => `
    <button class="pin-chip" type="button" data-i="${i}">
      <span>${pinLabel(pin)}</span>
      <span class="x">✕</span>
    </button>`).join("");

  wrap.querySelectorAll(".pin-chip").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.i);
      const pins = getPins();
      pins.splice(i,1);
      savePins(pins);
      renderPinnedChips();
      renderPinned();
      updatePinButtons();
    });
  });
}

function setApiBanner(visible, message = SNAPSHOT_FALLBACK_MESSAGE){
  const banner = $("#apiBanner");
  if (!banner) return;
  const allowBanner = visible && !hasHealthySnapshotData();
  const updatedAt = formatLastUpdated(state.fallbackUpdatedAt);
  banner.textContent = allowBanner && updatedAt
    ? `${message} Last updated: ${updatedAt}`
    : message;
  banner.classList.toggle("show", allowBanner);
  banner.hidden = !allowBanner;
  if (visible && !allowBanner){
    setDebugSection("banner", "suppressed", { reason: "healthy-snapshot-data-available" });
  } else if (allowBanner){
    setDebugSection("banner", "shown", { reason: message });
    pushDegradedReason("banner", message);
  }
}

function applyCachedContent(){
  const cachedNews = readLocalCache(NEWS_CACHE_KEY);
  const cachedStories = readLocalCache(STORIES_CACHE_KEY);
  const cacheMatchesState = (cache) => {
    if (!cache) return false;
    if (cache.category && cache.category !== state.category) return false;
    if (cache.filter && cache.filter !== state.filter) return false;
    if (typeof cache.experimental === "boolean" && cache.experimental !== state.experimental)
      return false;
    return true;
  };
  const safeNewsCache = cacheMatchesState(cachedNews) ? cachedNews : null;
  const safeStoriesCache = cacheMatchesState(cachedStories) ? cachedStories : null;
  const newsFreshness = evaluateFreshness({ updatedAt: safeNewsCache?.payloadUpdatedAt });
  const storiesFreshness = evaluateFreshness({ updatedAt: safeStoriesCache?.payloadUpdatedAt });
  const useNewsCache = Boolean(safeNewsCache && newsFreshness.fresh);
  const useStoriesCache = Boolean(safeStoriesCache && storiesFreshness.fresh);
  if (safeNewsCache && !useNewsCache){
    console.info("[freshness] snapshot rejected", { source: "local-cache", key: NEWS_CACHE_KEY, reason: newsFreshness.reason });
  }
  if (safeStoriesCache && !useStoriesCache){
    console.info("[freshness] snapshot rejected", { source: "local-cache", key: STORIES_CACHE_KEY, reason: storiesFreshness.reason });
  }
  if (!useNewsCache && !useStoriesCache){
    return false;
  }
  const newsPayload = useNewsCache ? safeNewsCache?.payload : null;
  const storiesPayload = useStoriesCache ? safeStoriesCache?.payload : null;
  if (!newsPayload && !storiesPayload) return false;
  if (newsPayload?.articles?.length){
    state.allArticles = newsPayload.articles || [];
    state.articles = state.allArticles.slice();
    state.indiaArticles = state.allArticles.filter(a => a.category === "india");
    state.newsEmptyMessage = "";
  }
  if (storiesPayload?.stories?.length){
    state.stories = storiesPayload.stories || [];
  }
  if (state.category === "showcase"){
    state.articles = shuffleArticles(state.allArticles || []).slice(0, 20);
  }
  hasCachedContent = Boolean(state.allArticles.length || state.stories.length);
  if (hasCachedContent){
    state.usingFallbackSnapshot = true;
    state.isStaleMode = false;
    state.fallbackUpdatedAt = safeNewsCache?.payloadUpdatedAt || safeStoriesCache?.payloadUpdatedAt || state.bootstrapGeneratedAt || state.fallbackUpdatedAt;
    state.fallbackMessage = SNAPSHOT_FALLBACK_MESSAGE;
    setApiBanner(true, state.fallbackMessage);
    syncPinsWithArticles();
    renderPinnedChips();
    renderAll();
  }
  return hasCachedContent;
}

async function checkHealthWithRetry(){
  try{
    await fetchWithRetry("/api/health");
  }catch{
    setTimeout(() => {
      checkHealthWithRetry();
    }, 5000);
  }
}

/* load news + topics */
async function loadAll(){
  state.newsEmptyMessage = "";
  state.usingFallbackSnapshot = false;
  state.isStaleMode = false;
  state.fallbackMessage = "";
  setApiBanner(false);
  if (state.category === POLITICAL_INTEL_CATEGORY){
    await loadPoliticalIntelSnapshot();
    renderAll();
    return;
  }
  await loadSentimentData();
  try{
    const qs = new URLSearchParams();
    if (state.filter !== "all") qs.set("sentiment", state.filter);
    if (state.experimental) qs.set("experimental", "1");
    if (state.category && !["home","foryou","local","showcase","following",USA_CATEGORY,POTUS_CATEGORY].includes(state.category))
      qs.set("category", state.category);

    const needsIndiaFetch = !["home", "india", USA_CATEGORY, POTUS_CATEGORY].includes(state.category);
    const indiaQs = new URLSearchParams();
    if (state.filter !== "all") indiaQs.set("sentiment", state.filter);
    if (state.experimental) indiaQs.set("experimental", "1");
    if (needsIndiaFetch) indiaQs.set("category", "india");

    const newsEndpoint = `/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`;
    let news;
    try{
      news = await fetchJSON(newsEndpoint);
    }catch(error){
      logApiError(error, error?.endpoint || newsEndpoint);
      const shouldRetry =
        API_BASE === "" &&
        FALLBACK_API_BASE &&
        (error?.status === 0 || error?.status === 404);
      if (shouldRetry){
        API_BASE = FALLBACK_API_BASE;
        try{
          news = await fetchJSON(newsEndpoint);
        }catch(retryError){
          logApiError(retryError, retryError?.endpoint || newsEndpoint);
          if (!hasCachedContent) setApiBanner(true);
          throw retryError;
        }
      }else{
        if (!hasCachedContent && (error?.status === 0 || error?.status === 404)){
          setApiBanner(true);
        }
        throw error;
      }
    }

    const topStoriesQs = state.experimental ? "&experimental=1" : "";
    const [topics, india, stories, engaged, topIndiaRecent, topIndiaEngaged, topWorldRecent, topWorldEngaged] = await Promise.all([
      fetchJSON(`/api/topics${state.experimental ? "?experimental=1" : ""}`)
        .catch(() => ({ topics: [] })),
      needsIndiaFetch
        ? fetchJSON(`/api/news${indiaQs.toString() ? ("?" + indiaQs.toString()) : ""}`)
          .catch(() => ({ articles: [] }))
        : Promise.resolve(null),
      fetchJSON(`/api/stories${state.experimental ? "?experimental=1" : ""}`)
        .catch(() => ({ stories: [] })),
      fetchJSON(`/api/engaged${state.experimental ? "?experimental=1" : ""}`)
        .catch(() => ({ stories: [] })),
      fetchJSON(`/api/top-stories?scope=india&type=recent${topStoriesQs}`)
        .catch(() => ({ topStories: [] })),
      fetchJSON(`/api/top-stories?scope=india&type=engaged${topStoriesQs}`)
        .catch(() => ({ topStories: [] })),
      fetchJSON(`/api/top-stories?scope=world&type=recent${topStoriesQs}`)
        .catch(() => ({ topStories: [] })),
      fetchJSON(`/api/top-stories?scope=world&type=engaged${topStoriesQs}`)
        .catch(() => ({ topStories: [] }))
    ]);

    state.allArticles = news.articles || [];
    state.articles = state.allArticles.slice();
    state.stories = stories?.stories || [];
    state.engagedStories = engaged?.stories || [];
    state.topStories = {
      indiaRecent: topIndiaRecent?.topStories || [],
      indiaEngaged: topIndiaEngaged?.topStories || [],
      worldRecent: topWorldRecent?.topStories || [],
      worldEngaged: topWorldEngaged?.topStories || []
    };
    syncHeroSnapshot("live-api:top-stories");
    state.topics   = selectTrendingTopics(topics.topics || [], state.allArticles);
    if (needsIndiaFetch){
      state.indiaArticles = india?.articles || [];
    } else {
      state.indiaArticles = state.allArticles.filter(a => a.category === "india");
    }

    const usaSnapshotArticles = safeArray(state.splitSnapshots?.usaNews?.articles);
    const usaCandidates = state.allArticles.filter(isUsaArticle);
    const potusResolution = resolvePotusArticles({
      liveArticles: state.allArticles,
      splitSnapshots: state.splitSnapshots,
      bootstrapPotus: state.bootstrapPotus
    });
    const potusCandidates = potusResolution.articles;
    if (state.category === USA_CATEGORY){
      state.articles = usaCandidates.length ? usaCandidates : (usaSnapshotArticles.length ? usaSnapshotArticles : state.allArticles);
      state.newsEmptyMessage = state.articles.length ? "" : "Showing broader coverage while USA-specific stories refresh.";
    } else if (state.category === POTUS_CATEGORY){
      state.articles = potusCandidates;
      state.newsEmptyMessage = state.articles.length ? "" : POTUS_EMPTY_STATE_MESSAGE;
      if (potusResolution.usedFallback){
        console.info("[potus] using cached snapshot/bootstrap articles");
      }
    } else if (state.category === "local" && state.profile?.city){
      const c = state.profile.city.toLowerCase();
      state.articles = state.articles.filter(a =>
        (a.title || "").toLowerCase().includes(c) ||
        (a.link  || "").toLowerCase().includes(c)
      );
    } else if (state.category === "showcase"){
      state.articles = shuffleArticles(state.allArticles || []).slice(0, 20);
    } else if (["foryou","following"].includes(state.category)){
      const topics = state.preferredTopics || [];
      if (topics.length){
        state.articles = state.articles.filter(article =>
          topics.some(topic => articleMatchesPreferredTopic(article, topic))
        );
      } else if (state.category === "following"){
        state.articles = [];
      }
    }

    if (!state.allArticles.length && state.category !== POTUS_CATEGORY){
      state.newsEmptyMessage = "No news available right now. Please check back soon.";
    }

    syncPinsWithArticles();
    renderPinnedChips();
    renderAll();
    writeLocalCache(NEWS_CACHE_KEY, {
      payload: news,
      payloadUpdatedAt: extractPayloadTimestamp(news),
      cachedAt: Date.now(),
      category: state.category,
      filter: state.filter,
      experimental: state.experimental
    });
    writeLocalCache(STORIES_CACHE_KEY, {
      payload: stories,
      payloadUpdatedAt: extractPayloadTimestamp(stories),
      cachedAt: Date.now(),
      category: state.category,
      filter: state.filter,
      experimental: state.experimental
    });
    state.usingFallbackSnapshot = false;
    state.isStaleMode = false;
    state.fallbackMessage = "";
    state.fallbackUpdatedAt = "";
    setApiBanner(false);
    hasCachedContent = true;
  }catch(error){
    if (!hasCachedContent){
      state.allArticles = [];
      state.articles = [];
      state.stories = [];
      state.engagedStories = [];
      state.topStories = {
        indiaRecent: [],
        indiaEngaged: [],
        worldRecent: [],
        worldEngaged: []
      };
      syncHeroSnapshot("live-api:error-empty");
      state.indiaArticles = [];
      state.topics = [];
      state.newsEmptyMessage = EMPTY_STATE_MESSAGE;
    }
    if (hasCachedContent){
      state.usingFallbackSnapshot = true;
      state.isStaleMode = false;
      state.fallbackMessage = SNAPSHOT_FALLBACK_MESSAGE;
      state.fallbackUpdatedAt = state.fallbackUpdatedAt || state.bootstrapGeneratedAt || "";
      setApiBanner(true, state.fallbackMessage);
    } else {
      state.isStaleMode = true;
      state.fallbackMessage = STALE_DATA_MESSAGE;
      state.fallbackUpdatedAt = "";
      setApiBanner(true, STALE_DATA_MESSAGE);
    }
    logApiError(error, error?.endpoint || "/api/news");
    if (!hasCachedContent && (error?.status === 0 || error?.status === 404)){
      setApiBanner(true, STALE_DATA_MESSAGE);
    }
    renderPinnedChips();
    renderAll();
  }
}

async function loadPoliticalIntelSnapshot(){
  const fallback = {
    sample: true,
    generatedAt: new Date().toISOString(),
    partyToneBuckets: [
      { label: "Favorable", value: 38, count: 380, color: "#1f9d63" },
      { label: "Neutral", value: 34, count: 340, color: "#7c8aa5" },
      { label: "Critical", value: 28, count: 280, color: "#e4572e" }
    ],
    partyToneTrends: { buckets: ["May 1", "May 2", "May 3", "May 4", "May 5", "May 6"], series: [] },
    sourcePartyMatrix: [], shareOfVoice: [], issueNarratives: [], regionalSignals: [], politicalHeadlines: []
  };
  try{ state.politicalIntelSnapshot = await fetchJSON('/data/political-intel-snapshot.json'); }
  catch{ state.politicalIntelSnapshot = fallback; }
}

function renderPoliticalIntelligence(){ renderPoliticalIntelligencePage(); }

function renderPoliticalIntelligencePage(){
  const wrap = document.getElementById('politicalIntelPage');
  const layout = document.querySelector('main.layout');
  if (!wrap || !layout) return;
  const active = state.category === POLITICAL_INTEL_CATEGORY;
  wrap.hidden = !active;
  layout.style.display = active ? 'none' : '';
  if (!active) return;

  const data = state.politicalIntelSnapshot || {};
  const filter = data.activeToneFilter || 'All';
  const states = safeArray(data.states);

  wrap.innerHTML = `
    <section class="pi-shell">
      <div class="pi-filter-row">${['All','Positive','Neutral','Negative'].map(t=>`<button class="pi-filter-pill ${t===filter?'active':''}" type="button">${t}</button>`).join('')}</div>
      <div class="pi-dashboard">${states.map(renderStateDashboardRow).join('')}</div>
      ${renderSourceComparisonBoard(data.sourceComparison || [])}
    </section>`;
}

function renderStateDashboardRow(st){
  return `<section class="pi-row">
    ${renderStateElectionSummaryCard(st)}
    ${renderStateSentimentAnalysisCard(st)}
    ${renderIssueNarrativeCard(st)}
    <div class="pi-trends-stack">${safeArray(st.partyTrends).map(renderPartyTrendMiniCard).join('')}</div>
    ${renderTrendingPoliticalNewsCard(st.trendingPoliticalNews || [])}
  </section>`;
}

function renderStateElectionSummaryCard(st){
  const sum = st.electionSummary || {};
  const segs = safeArray(sum.arcSegments);
  const total = segs.reduce((a,b)=>a+(Number(b.value)||0),0)||1;
  let a=-180;
  const parts = segs.map(seg=>{const v=(Number(seg.value)||0)/total*180; const d=describeArc(110,112,84,a,a+v); a+=v; return `<path d="${d}" stroke="${seg.color||'#6b7280'}" stroke-width="9" fill="none" stroke-linecap="round"/>`;}).join('');
  return `<article class="pi-card pi-election"><h3>${escapeHtml(st.name||'State')}</h3>${st.preview?'<span class="pi-preview-chip">Preview data</span>':''}<svg viewBox="0 0 220 140" class="pi-seat-arc">${parts}</svg><table class="pi-result-table"><thead><tr><th>Party</th><th>Won</th><th>Lost</th><th>Lead</th></tr></thead><tbody>${safeArray(sum.tableRows).map(r=>`<tr><td>${escapeHtml(r.party||'')}</td><td>${Number(r.won||0)}</td><td>${Number(r.lost||0)}</td><td>${Number(r.lead||0)}</td></tr>`).join('')}</tbody></table></article>`;
}
function polarToCartesian(cx, cy, r, angle){const rad=(angle-90)*Math.PI/180; return {x:cx+r*Math.cos(rad),y:cy+r*Math.sin(rad)};}
function describeArc(cx,cy,r,start,end){const s=polarToCartesian(cx,cy,r,end), e=polarToCartesian(cx,cy,r,start); const large=end-start<=180?0:1; return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;}

function renderStateSentimentAnalysisCard(st){
  const s=st.sentimentAnalysis||{};
  const markers=safeArray(s.partyMarkers).map(m=>`<div class="pi-party-marker" style="left:${m.lane*33.3+16.65}%;bottom:${Math.max(0,Math.min(100,m.value||0))}%"><span>${escapeHtml(m.abbr||'P')}</span></div>`).join('');
  return `<article class="pi-card pi-sentiment"><h4>${escapeHtml(st.name||'State')} Sentiment Analysis</h4><div class="pi-sentiment-body"><div class="pi-scale"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="pi-lanes"><div class="pi-lane neg"></div><div class="pi-lane neu"></div><div class="pi-lane pos"></div>${markers}</div></div><div class="pi-lane-legend"><span>Negative</span><span>Neutral</span><span>Positive</span></div></article>`;
}

function renderIssueNarrativeCard(st){
  return `<article class="pi-card pi-issues"><h4>${escapeHtml(st.name||'State')} Issue and Public Narrative</h4>${safeArray(st.issueNarratives).map(i=>`<div class="pi-issue-row"><label>${escapeHtml(i.issue||'')}</label><div class="pi-issue-bar"><b style="width:${i.negative||20}%;background:#ef4444"></b><b style="width:${i.neutral||40}%;background:#9ca3af"></b><b style="width:${i.positive||40}%;background:#eab308"></b></div></div>`).join('')}</article>`;
}

function renderPartyTrendMiniCard(p){
  const w=250,h=74,pts=safeArray(p.points); const max=Math.max(...pts,1),min=Math.min(...pts,0); const X=i=>i*(w/Math.max(1,pts.length-1)); const Y=v=>h-((v-min)/(max-min||1))*h;
  return `<article class="pi-card pi-mini"><h4>${escapeHtml(p.party||'Political Party')}</h4><svg viewBox="0 0 ${w} ${h}"><path d="${pts.map((v,i)=>`${i?'L':'M'} ${X(i)} ${Y(v)}`).join(' ')}"/></svg><div class="pi-mini-meta">Positive ${p.positive||0}% · Neutral ${p.neutral||0}% · Negative ${p.negative||0}%</div></article>`;
}

function renderTrendingPoliticalNewsCard(items){
  return `<article class="pi-card pi-news"><h4>Trending News : Last 4 Hrs</h4>${safeArray(items).map(n=>`<div class="pi-news-row"><strong>${escapeHtml(n.topic||'')}</strong><small>${n.articles||0} articles · ${n.sources||0} sources</small><div class="pi-mini-meta">Positive ${n.positive||0}% · Neutral ${n.neutral||0}% · Negative ${n.negative||0}%</div></div>`).join('')}</article>`;
}

function renderSourceComparisonBoard(rows){
  return `<section class="pi-card pi-source-board"><div class="pi-source-grid">${safeArray(rows).map(r=>`<div class="pi-source-row"><div class="pi-source-name">${escapeHtml(r.source||'')}</div><div class="pi-source-lane"><span style="width:${r.negative||30}%" class="neg"></span><span style="width:${r.neutral||30}%" class="neu"></span><span style="width:${r.positive||40}%" class="pos"></span></div><div class="pi-source-party">${escapeHtml((r.partyFocus||[]).join(' · '))}</div></div>`).join('')}</div></section>`;
}


/* image helpers */
async function fetchOgImage(link = ""){
  const key = link.trim();
  if (!key) return "";
  if (ogImageCache.has(key)) return ogImageCache.get(key);
  try{
    const data = await fetchJSON(`/api/og-image?url=${encodeURIComponent(key)}`);
    const image = (data?.image || "").trim();
    ogImageCache.set(key, image);
    return image;
  }catch{
    ogImageCache.set(key, "");
    return "";
  }
}

function heroImgTag(article, index){
  const fallbackLogo = logoFor(article.link, article.source);
  const fallback = fallbackLogo || PLACEHOLDER;
  const candidate = (article.image || "").trim();
  const primary = isLikelyImageUrl(candidate) ? candidate : fallback;
  const useLogoThumb =
    Boolean(fallbackLogo) &&
    (primary === fallback || primary === PLACEHOLDER || isFallbackLogo(primary));
  const classNames = ["hero-photo", useLogoThumb ? "logo-thumb" : ""]
    .filter(Boolean)
    .join(" ");
  const encodedLink = encodeURIComponent(article.link || "");

  return `<img class="${classNames}" src="${primary}" loading="lazy"
              data-hero-link="${encodedLink}"
              data-fallback="${fallback}" data-placeholder="${PLACEHOLDER}"
              onerror="if(this.dataset.errored){this.onerror=null;this.classList.add('logo-thumb');this.src=this.dataset.placeholder;this.alt='';}else{this.dataset.errored='1';this.classList.add('logo-thumb');this.src=this.dataset.fallback || this.dataset.placeholder;this.alt='';}" alt="">`;
}

function heroSourceLogo(article, extraClass = ""){
  const source = (article?.source || "").trim();
  const mappedDomain = LOGO_DOMAIN_MAP[source] || "";
  const domain = mappedDomain || domainFromUrl(article?.link || "");
  const logo = (article?.sourceLogo || "").trim()
    || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : "");
  const initial = (source || domain || "?").trim().charAt(0).toUpperCase() || "?";
  const safeInitial = escapeHtml(initial);
  const className = extraClass ? ` ${extraClass}` : "";

  if (!logo){
    return `<span class="ts-source-logo fallback${className}">${safeInitial}</span>`;
  }
  return `<img class="ts-source-logo${className}" src="${logo}" alt="" loading="lazy"
              data-fallback="${safeInitial}"
              onerror="const span=document.createElement('span');span.className='ts-source-logo fallback${className}';span.textContent=this.dataset.fallback||'?';this.replaceWith(span);">`;
}

function renderCredibilityBadge(article, extraClass = ""){
  if (!state.showCredibilityBadges) return "";
  const cred = (article?.sourceCredibility || "").trim();
  if (!cred) return "";
  const tone = cred.toLowerCase().replace(/\s+/g, "-");
  const cls = extraClass ? ` ${extraClass}` : "";
  return `<span class="cred-badge ${escapeHtml(tone)}${cls}">${escapeHtml(cred)}</span>`;
}

function renderHeroMeta(article){
  const sourceName = escapeHtml(article?.source || domainFromUrl(article?.link || "") || "Source");
  return `
    <div class="hero-meta ts-meta">
      <div class="ts-meta-row1">
        <span class="hero-source ts-source">
          ${heroSourceLogo(article)}
          <span class="hero-source-name">${sourceName}</span>
          ${renderCredibilityBadge(article)}
        </span>
      </div>
      <div class="ts-meta-row2">
        <span class="hero-time ts-date">${formatArticleDate(article?.publishedAt)}</span>
      </div>
    </div>`;
}

function buildHeroTrendBuckets(articles = [], bucketMinutes = 30){
  const { scores, buckets, bucketMinutes: minutes } =
    buildTopicSparklineBuckets(articles, bucketMinutes);
  const hasData = buckets.some(bucket => bucket.c > 0);
  if (hasData) return { scores, buckets, bucketMinutes: minutes };

  const base = aggregateSentiment(articles);
  const count = Math.max(1, articles.length);
  const avg = {
    pos: Math.round(base.pos / count),
    neu: Math.round(base.neu / count),
    neg: Math.round(base.neg / count)
  };
  const bucketCount = Math.max(4, buckets.length || 8);
  const bucketMs = minutes * 60 * 1000;
  const now = Date.now();
  const fallbackBuckets = Array.from({ length: bucketCount }, (_, i) => {
    const end = now - (bucketCount - i - 1) * bucketMs;
    const start = end - bucketMs;
    return { start, end, pos: avg.pos, neu: avg.neu, neg: avg.neg, c: 0 };
  });
  const flatScore = avg.pos - avg.neg;
  return {
    scores: Array.from({ length: bucketCount }, () => flatScore),
    buckets: fallbackBuckets,
    bucketMinutes: minutes
  };
}

function formatHeroTrendTooltip(bucket){
  const time = formatTrendTime(bucket.start) || "--:--";
  return `${time} — Positive ${fmtPct(bucket.pos)} · Neutral ${fmtPct(bucket.neu)} · Negative ${fmtPct(bucket.neg)}`;
}

function formatTrendPercent(value){
  const rounded = Math.round(Number(value) || 0);
  const clamped = Math.max(-100, Math.min(100, rounded));
  return `${clamped}%`;
}

function selectTrendBuckets(buckets = [], minPoints = 4, maxPoints = 6){
  if (!buckets.length) return [];
  if (buckets.length <= maxPoints) return buckets;
  const target = Math.min(maxPoints, Math.max(minPoints, buckets.length));
  const picks = new Map();
  if (target === 1) return [buckets[0]];
  for (let i = 0; i < target; i += 1){
    const idx = Math.round((buckets.length - 1) * (i / (target - 1)));
    picks.set(idx, buckets[idx]);
  }
  return [...picks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, bucket]) => bucket);
}

function dominantTone(bucket){
  const pos = Number(bucket.pos || 0);
  const neg = Number(bucket.neg || 0);
  const threshold = 4;
  if (pos > neg + threshold) return "pos";
  if (neg > pos + threshold) return "neg";
  return "neu";
}

function trendSegmentTone(current, next){
  if (next > current && next > 0) return "green";
  if (next < current && next < 0) return "red";
  if (current > 0 && next > 0) return "green";
  if (current < 0 && next < 0) return "red";
  return "gray";
}

function renderRightStoryMeta(article){
  const sourceName = escapeHtml(article?.source || domainFromUrl(article?.link || "") || "Source");
  const datetime = escapeHtml(formatArticleDate(article?.publishedAt) || "");
  return `
    <div class="topstories-meta ts-meta">
      <div class="ts-meta-row1">
        <span class="source ts-source">${sourceName}${renderCredibilityBadge(article, "inline")}</span>
      </div>
      <div class="ts-meta-row2">
        <span class="datetime ts-date">${datetime}</span>
      </div>
    </div>`;
}

function renderHeroTrendChart(cluster, index){
  const articles = [cluster.featured, ...(cluster.related || [])].filter(Boolean);
  const { buckets } = buildHeroTrendBuckets(articles, 30);
  const selectedBuckets = selectTrendBuckets(buckets, 4, 6);
  const W = 520;
  const H = 140;
  const padX = 30;
  const padTop = 18;
  const padBottom = 28;
  const chartTop = padTop;
  const chartBottom = H - padBottom;
  const chartHeight = chartBottom - chartTop;
  const mid = chartTop + (chartHeight / 2);
  const amplitude = chartHeight / 2;
  const values = selectedBuckets.map(bucket => (Number(bucket.pos || 0) - Number(bucket.neg || 0)));
  const maxAbs = Math.max(12, ...values.map(value => Math.abs(value)));
  const steps = Math.max(1, selectedBuckets.length - 1);
  const xStep = (W - padX * 2) / steps;
  const clamp = value => Math.max(-maxAbs, Math.min(maxAbs, value));
  const points = selectedBuckets.map((bucket, i) => {
    const value = values[i] ?? 0;
    return {
      t: formatTrendTime(bucket.start) || "--:--",
      v: value,
      bucket,
      x: padX + (xStep * i),
      y: mid - (clamp(value) / maxAbs) * amplitude
    };
  });

  const gridLines = points.map(point =>
    `<line class="grid" x1="${point.x}" y1="${chartTop}" x2="${point.x}" y2="${chartBottom}" />`
  );
  const segments = points.slice(0, -1).map((point, i) => {
    const next = points[i + 1];
    const tone = trendSegmentTone(point.v, next.v);
    return `<path class="line-${tone}" d="M ${point.x} ${point.y} L ${next.x} ${next.y}" />`;
  });
  const percentLabels = points.map(point => {
    const label = escapeHtml(formatTrendPercent(point.v));
    const offset = point.v >= 0 ? -8 : 14;
    const y = Math.max(chartTop + 10, Math.min(chartBottom - 8, point.y + offset));
    return `<text x="${point.x}" y="${y}" text-anchor="middle">${label}</text>`;
  });
  const timeLabels = points.map(point =>
    `<text x="${point.x}" y="${H - 8}" text-anchor="middle">${escapeHtml(point.t)}</text>`
  );
  const hitWidth = steps ? xStep : (W - padX * 2);
  const hitAreas = points.map((point, i) => {
    const x = Math.max(0, point.x - hitWidth / 2);
    const tip = escapeHtml(formatHeroTrendTooltip(point.bucket));
    return `<rect class="trend-hit" x="${x}" y="0" width="${hitWidth}" height="${H}" data-tip="${tip}"></rect>`;
  });

  return `
    <div class="topstories-trend" data-slide="${index}">
      <div class="trend-title">Trend (Last 4h)</div>
      <div class="trend-chart-wrap">
        <svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
          role="img" aria-label="Trend curve for last 4 hours">
          ${gridLines.join("")}
          ${segments.join("")}
          ${percentLabels.join("")}
          ${timeLabels.join("")}
          ${hitAreas.join("")}
        </svg>
        <div class="trend-tooltip" role="tooltip" aria-hidden="true"></div>
      </div>
    </div>`;
}

function storySentimentObject(story){
  const base = story?.storySentiment || {};
  const pos = Number(base.pos ?? 0);
  const neu = Number(base.neu ?? 0);
  const neg = Number(base.neg ?? 0);
  const label =
    pos > neg + 5 ? "positive" : neg > pos + 5 ? "negative" : "neutral";
  return {
    posP: pos,
    neuP: neu,
    negP: neg,
    label,
    confidence: Number(story?.storyConfidence ?? 0),
    topPhrases: story?.storyTopPhrases || []
  };
}

function recentArticlesWithin(articles = [], hours){
  const now = Date.now();
  const windowMs = hours * 60 * 60 * 1000;
  return (articles || []).filter(article => {
    const ts = new Date(article.publishedAt).getTime();
    if (Number.isNaN(ts)) return false;
    const age = now - ts;
    return age >= 0 && age <= windowMs;
  });
}

function sortByPublishedDesc(list = []){
  return [...list].sort((a, b) =>
    new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

function normalizeSimilarityText(text = ""){
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(token => token && !TOPIC_STOPWORDS.has(token));
}

function similarityScore(a, b){
  const tokensA = new Set(normalizeSimilarityText(`${a.title || ""} ${a.description || ""}`));
  const tokensB = new Set(normalizeSimilarityText(`${b.title || ""} ${b.description || ""}`));
  if (!tokensA.size || !tokensB.size) return 0;
  let overlap = 0;
  tokensA.forEach(token => {
    if (tokensB.has(token)) overlap += 1;
  });
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function pickRelatedArticles(featured, candidates = [], { maxItems = 2, minItems = 2, prevLinks = new Set() } = {}){
  const scored = candidates.map(article => ({
    article,
    score: similarityScore(featured, article)
  }));
  const primary = scored
    .filter(item => item.score >= 0.18)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.article.publishedAt).getTime() - new Date(a.article.publishedAt).getTime();
    })
    .map(item => item.article);
  const fallback = sortByPublishedDesc(candidates);
  const selected = [];
  const usedLinks = new Set([featured.link]);
  const usedSources = new Set([featured.source]);

  const pushUnique = (article, allowPrev) => {
    if (!article || usedLinks.has(article.link)) return false;
    if (!allowPrev && prevLinks.has(article.link)) return false;
    if (usedSources.has(article.source)) return false;
    selected.push(article);
    usedLinks.add(article.link);
    if (article.source) usedSources.add(article.source);
    return true;
  };

  primary.forEach(article => {
    if (selected.length >= maxItems) return;
    pushUnique(article, false);
  });
  primary.forEach(article => {
    if (selected.length >= maxItems) return;
    pushUnique(article, true);
  });
  fallback.forEach(article => {
    if (selected.length >= maxItems) return;
    pushUnique(article, false);
  });

  if (selected.length >= minItems) return selected.slice(0, maxItems);
  return selected.slice(0, Math.min(maxItems, selected.length));
}

function buildRecentCluster(articles = [], prevLinks = new Set()){
  const windows = [4, 8, 12, 24];
  let candidates = [];
  for (const hours of windows){
    candidates = recentArticlesWithin(articles, hours);
    if (candidates.length >= 3) break;
  }
  if (!candidates.length) candidates = articles.slice();
  const sorted = sortByPublishedDesc(candidates);
  const fallbackSorted = sortByPublishedDesc(articles);
  const featured =
    sorted.find(article => article && !prevLinks.has(article.link)) ||
    fallbackSorted.find(article => article && !prevLinks.has(article.link)) ||
    sorted[0];
  const relatedCandidates = sorted.filter(article => article && article.link !== featured?.link);
  const related = featured
    ? pickRelatedArticles(featured, relatedCandidates, { maxItems: 2, minItems: 2, prevLinks })
    : [];
  return { mode: "Recent News", featured, related };
}

function buildEngagedTopics(articles = []){
  const candidates = extractHeadlinePhrases(articles)
    .map(scoreTopicCandidate)
    .filter(Boolean);
  const topics = candidates.map(topic => {
    const matches = getTopicArticles(topic, articles);
    if (!matches.length) return null;
    const sentiment = aggregateSentiment(matches);
    const sources = new Set(matches.map(a => a.source).filter(Boolean)).size;
    const count = matches.length;
    const polarization = Math.abs(sentiment.pos - sentiment.neg);
    let score = (count * 2) + (sources * 3) + (polarization * 1.5);
    const domains = matches.map(a => domainFromUrl(a.link)).filter(Boolean);
    if (domains.length){
      const domainCounts = domains.reduce((acc, domain) => {
        acc[domain] = (acc[domain] || 0) + 1;
        return acc;
      }, {});
      const maxShare = Math.max(...Object.values(domainCounts)) / domains.length;
      if (maxShare > 0.6) score *= 0.7;
    }
    return { topic, matches, score };
  }).filter(Boolean);
  return topics.sort((a, b) => b.score - a.score);
}

function buildEngagedCluster(articles = [], prevLinks = new Set()){
  const windows = [12, 24];
  let candidates = [];
  for (const hours of windows){
    candidates = recentArticlesWithin(articles, hours);
    if (candidates.length >= 3) break;
  }
  if (!candidates.length) candidates = articles.slice();
  const rankedTopics = buildEngagedTopics(candidates);
  let featured = null;
  let related = [];
  let selectedMatches = [];

  for (const entry of rankedTopics){
    const matches = sortByPublishedDesc(entry.matches);
    const candidateFeatured = matches.find(article => !prevLinks.has(article.link));
    if (!candidateFeatured) continue;
    featured = candidateFeatured;
    selectedMatches = matches.filter(article => article.link !== featured.link);
    break;
  }

  if (!featured){
    const sorted = sortByPublishedDesc(candidates);
    const fallbackSorted = sortByPublishedDesc(articles);
    featured =
      sorted.find(article => !prevLinks.has(article.link)) ||
      fallbackSorted.find(article => !prevLinks.has(article.link)) ||
      sorted[0];
    selectedMatches = sorted.filter(article => article.link !== featured?.link);
  }

  if (featured){
    related = pickRelatedArticles(featured, selectedMatches, { maxItems: 2, minItems: 2, prevLinks });
    if (related.length < 2){
      const fallback = sortByPublishedDesc(candidates).filter(article => article.link !== featured.link);
      const supplemental = pickRelatedArticles(featured, fallback, { maxItems: 2, minItems: 2, prevLinks });
      related = supplemental.length ? supplemental : related;
    }
  }

  return { mode: "Most Engaged", featured, related };
}

function buildLegacyHeroSlides(articles = []){
  const sorted = sortByPublishedDesc(articles);
  const usedLinks = new Set();
  const slides = [];

  const nextUnused = (predicate) => {
    for (const article of sorted){
      if (!article || usedLinks.has(article.link)) continue;
      if (predicate && !predicate(article)) continue;
      return article;
    }
    return null;
  };

  const pickRightItem = (usedSources) => {
    let candidate = nextUnused(article => !usedSources.has(article.source));
    if (!candidate) candidate = nextUnused();
    return candidate;
  };

  while (slides.length < 4){
    const featured = nextUnused();
    if (!featured) break;
    usedLinks.add(featured.link);
    const usedSources = new Set([featured.source].filter(Boolean));
    const related = [];

    for (let i = 0; i < 2; i += 1){
      const item = pickRightItem(usedSources);
      if (!item) break;
      related.push(item);
      usedLinks.add(item.link);
      if (item.source) usedSources.add(item.source);
    }

    slides.push({ mode: "Recent News", featured, related });
  }

  return slides;
}

function buildHeroSlides(stories = [], articles = []){
  if (stories && stories.length){
    return stories.slice(0, 4).map(story => {
      const storyArticles = Array.isArray(story.articles) ? story.articles : [];
      const featured = story.featured || storyArticles[0] || {};
      const related = storyArticles
        .filter(item => item.link && item.link !== featured.link)
        .slice(0, 4);
      return {
        ...story,
        featured,
        related,
        mode: story.mode || "Top Story"
      };
    });
  }
  return buildLegacyHeroSlides(articles);
}

function safeImgTag(src, link, source, cls){
  const fallbackLogo = logoFor(link, source);
  const candidate = (src || "").trim();
  const primary = isLikelyImageUrl(candidate) ? candidate : "";
  const fallback = fallbackLogo || "";
  const fallbackText = escapeHtml(source || domainFromUrl(link) || "Source");
  if (!primary && !fallback){
    return `<div class="thumb-fallback ${cls || ""}">${fallbackText}</div>`;
  }
  const initialSrc = primary || fallback;
  const useLogoThumb = (!primary || primary === fallback) && Boolean(fallbackLogo);
  const classNames = [cls, useLogoThumb ? "logo-thumb" : ""]
    .filter(Boolean)
    .join(" ");

  return `<img class="${classNames}" src="${initialSrc}" loading="lazy"
              data-fallback="${fallback}" data-fallback-text="${fallbackText}"
              onerror="if(this.dataset.errored){const text=this.dataset.fallbackText||'Source';const div=document.createElement('div');div.className='thumb-fallback ${cls || ""}';div.textContent=text;this.replaceWith(div);}else{this.dataset.errored='1';if(this.dataset.fallback){this.classList.add('logo-thumb');this.src=this.dataset.fallback;this.alt='';}else{const text=this.dataset.fallbackText||'Source';const div=document.createElement('div');div.className='thumb-fallback ${cls || ""}';div.textContent=text;this.replaceWith(div);}}" alt="">`;
}

function resolveDailyThumbnail(article = {}){
  const candidates = [article.imageUrl, article.image, article.thumbnail, article.imageUrl1];
  const primary = candidates
    .map(value => normalizeDailyThumbSrc(value))
    .find(value => value && !isFallbackLogo(value) && (isLikelyImageUrl(value) || value === THUMB_PLACEHOLDER))
    || "";
  const thumb = primary || THUMB_PLACEHOLDER;
  return { primary, thumb };
}

function safeNewsThumbTag({ primary = "", thumb = "", cls = "" } = {}){
  const placeholder = THUMB_PLACEHOLDER;
  const initialSrc = thumb || primary || placeholder;
  const usePlaceholder = !primary;
  const classNames = [cls, usePlaceholder ? "placeholder-thumb" : ""]
    .filter(Boolean)
    .join(" ");

  return `<img class="${classNames}" src="${initialSrc}" loading="lazy"
              data-placeholder="${placeholder}"
              onerror="const placeholder=this.dataset.placeholder||'';if(placeholder && this.src!==placeholder){this.classList.add('placeholder-thumb');this.src=placeholder;this.alt='';}" alt="">`;
}

/* card renderers */
function card(a){
  const { primary, thumb } = resolveDailyThumbnail(a || {});
  const context = getArticleContext(a);
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener" data-article-link="${a.link}">
      <div class="news-side">
        ${safeNewsThumbTag({ primary, thumb, cls: "thumb" })}
        <div class="card-actions">
          ${renderShareButton(a, primary)}
          <button class="pin-toggle" type="button" data-link="${a.link}" aria-pressed="false">Pin</button>
        </div>
      </div>
      <div class="news-body">
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="source">${a.source}${renderCredibilityBadge(a, "inline")}</span>
          · <span class="meta-time">${formatArticleDate(a.publishedAt)}</span>
        </div>
        ${renderSentiment(a.sentiment, false, context)}
      </div>
      ${renderInfoButton(a.sentiment, context)}
    </a>`;
}

function renderPinned(){
  const container = $("#pinned");
  if (!container) return;
  const list = getPins();
  if (!list.length){
    container.innerHTML =
      `<div class="pinned-empty">
         Pin a topic or article to keep it handy here.
       </div>`;
    return;
  }
  container.innerHTML = list.map(pin => {
    const article = pin.lastArticle;
    const hasMatch = pin.type === "article"
      ? state.articles.some(a => a.link === pin.value)
      : state.articles.some(a => matchesTopic(a, pin.value));
    const isStale = !hasMatch;
    const topicLabel = pin.type === "topic"
      ? `<div class="pin-topic">Tracking: ${pin.value}</div>`
      : `<div class="pin-topic">Pinned article</div>`;
    if (!article){
      return `
        <div class="row">
          ${topicLabel}
          <div class="row-title">No recent match yet.</div>
        </div>`;
    }
    const ageLine = isStale && pin.lastSeenAt
      ? `<div class="pin-age">Last updated ${timeAgo(pin.lastSeenAt)}</div>`
      : "";
    const context = getArticleContext(article);
    return `
      <div class="row">
        ${topicLabel}
        <a class="row-title" href="${article.link}" target="_blank" rel="noopener">${article.title}</a>
        <div class="row-meta">
          <span class="source">${article.source}${renderCredibilityBadge(article, "inline")}</span>
          · <span>${formatArticleDate(article.publishedAt)}</span>
        </div>
        ${ageLine}
        ${renderSentiment(article.sentiment, true, context)}
        ${renderShareButton(article, article.image || article.imageUrl || "", "tile-share")}
        ${renderInfoButton(article.sentiment, context)}
      </div>`;
  }).join("");
  attachInfoButtons();
  attachShareButtons();
}

function collectActiveSources(articles = []){
  const names = new Set();
  const normalizeDomain = (value = "") => String(value || "").trim().toLowerCase().replace(/^www\./, "");
  const inferDomainFromSourceLabel = (label = "") => {
    const clean = String(label || "").trim();
    if (!clean) return "";
    const decoded = decodeURIComponent(clean);
    const siteMatch = decoded.match(/site:([a-z0-9.-]+\.[a-z]{2,})/i);
    if (siteMatch?.[1]) return normalizeDomain(siteMatch[1]);
    const hostMatch = decoded.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i);
    if (hostMatch?.[1]) return normalizeDomain(hostMatch[1]);
    return "";
  };
  const canonicalSourceName = (article = {}) => {
    const rawSource = String(article?.source || "").trim();
    const sourceDomain = normalizeDomain(article?.sourceDomain || "");
    const linkDomain = normalizeDomain(domainFromUrl(article?.link || article?.url || ""));
    const normalized = normalizeSourceName(rawSource);
    const noisyGoogleLabel = /google\s*news/i.test(rawSource) || /^site:/i.test(rawSource);
    const sourceLabelDomain = inferDomainFromSourceLabel(rawSource);
    const domainCandidate = [sourceDomain, linkDomain, sourceLabelDomain]
      .map(normalizeDomain)
      .find((domain) => domain && domain !== "news.google.com" && domain !== "google.com");
    if (domainCandidate && CANONICAL_SOURCE_BY_DOMAIN[domainCandidate]) {
      return CANONICAL_SOURCE_BY_DOMAIN[domainCandidate];
    }
    if (!noisyGoogleLabel && isStrongSourceLabel(normalized)) return normalized;
    return "";
  };
  articles.forEach(article => {
    const source = canonicalSourceName(article);
    if (source) names.add(source);
  });
  return [...names].sort((a, b) => a.localeCompare(b));
}

function updateActiveSources(){
  const el = $("#activeSources");
  if (!el) return;
  const sources = collectActiveSources(state.allArticles || []);
  if (!sources.length){
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `Current News Sources: ${sources.join(", ")}`;
}

function updatePinButtons(){
  $$(".pin-toggle").forEach(btn => {
    const link = btn.dataset.link;
    const pinned = isArticlePinned(link);
    btn.classList.toggle("active", pinned);
    btn.setAttribute("aria-pressed", String(pinned));
    btn.textContent = pinned ? "Pinned" : "Pin";
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const article = state.articles.find(a => a.link === link)
        || getPins().find(p => p.value === link)?.lastArticle;
      if (!article) return;
      toggleArticlePin(article);
    });
  });
}

function toggleArticlePin(article){
  const pins = getPins();
  const idx = pins.findIndex(p => p.type === "article" && p.value === article.link);
  if (idx >= 0){
    pins.splice(idx, 1);
    savePins(pins);
    renderPinnedChips();
    renderPinned();
    updatePinButtons();
    return;
  }
  if (pins.length >= 2){
    showPinToast("Limit reached (2). Unpin one first.");
    return;
  }
  pins.push({
    type: "article",
    value: article.link,
    lastArticle: snapshotArticle(article),
    lastSeenAt: Date.now()
  });
  savePins(pins);
  renderPinnedChips();
  renderPinned();
  updatePinButtons();
}

/* Grid 9: only 4 main news stories */
function renderNews(){
  const list = $("#newsList");
  if (state.newsEmptyMessage){
    list.innerHTML = `<div class="news-empty">${escapeHtml(state.newsEmptyMessage)}</div>`;
    return;
  }
  if (state.category === "following" && !(state.preferredTopics || []).length){
    list.innerHTML = `
      <div class="news-empty">
        Choose topics to build your Following feed.
        <div><button type="button" id="chooseTopicsBtn">Choose topics</button></div>
      </div>`;
    return;
  }
  const homeArticles = state.category === "home"
    ? safeArray(state.splitSnapshots?.latestNews?.articles).concat(safeArray(state.articles))
    : safeArray(state.articles);
  setDebugSection("news", state.category === "home" && safeArray(state.splitSnapshots?.latestNews?.articles).length ? "snapshot:latest-news" : "live-or-bootstrap", { articles: homeArticles.length });
  const cards = state.category === POTUS_CATEGORY
    ? homeArticles.slice(0, 5)
    : homeArticles.slice(4, 9);
  list.innerHTML = cards.length
    ? cards.map(card).join("")
    : `<div class="news-empty">${escapeHtml(state.category === POTUS_CATEGORY ? POTUS_EMPTY_STATE_MESSAGE : (state.usingFallbackSnapshot ? SNAPSHOT_FALLBACK_MESSAGE : EMPTY_STATE_MESSAGE))}</div>`;
  if (!cards.length){
    pushDegradedReason("news", state.category === POTUS_CATEGORY ? POTUS_EMPTY_STATE_MESSAGE : (state.usingFallbackSnapshot ? SNAPSHOT_FALLBACK_MESSAGE : EMPTY_STATE_MESSAGE));
  }
}
function renderDaily(){
  const daily = $("#daily");
  if (!daily) return;
  const homeArticles = state.category === "home"
    ? safeArray(state.splitSnapshots?.latestNews?.articles).concat(safeArray(state.articles))
    : safeArray(state.articles);
  if (state.category === POTUS_CATEGORY){
    console.info("[potus] frontend daily articles:", homeArticles.length);
  }
  setDebugSection("daily", state.category === "home" && safeArray(state.splitSnapshots?.latestNews?.articles).length ? "snapshot:latest-news" : "live-or-bootstrap", { articles: homeArticles.length });
  const cards = state.category === POTUS_CATEGORY
    ? homeArticles.slice(0, 6)
    : homeArticles.slice(12, 18);
  daily.innerHTML = cards.length
    ? cards.map(card).join("")
    : `<div class="news-empty">${escapeHtml(state.category === POTUS_CATEGORY ? POTUS_EMPTY_STATE_MESSAGE : (state.usingFallbackSnapshot ? SNAPSHOT_FALLBACK_MESSAGE : EMPTY_STATE_MESSAGE))}</div>`;
}

/* HERO */
function renderHero(){
  const container = $("#heroCarousels");
  if (!container) return;
  if (state.isStaleMode){
    container.innerHTML = `<div class="topstories-empty">${escapeHtml(STALE_DATA_MESSAGE)}</div>`;
    pushDegradedReason("hero", STALE_DATA_MESSAGE);
    setDebugSection("hero", "stale-blocked");
    return;
  }
  syncHeroSnapshot("render:preflight");
  const sections = buildTopStoriesSections();
  if (!sections.length){
    const message = state.usingFallbackSnapshot ? SNAPSHOT_FALLBACK_MESSAGE : EMPTY_STATE_MESSAGE;
    const updatedAt = formatLastUpdated(state.fallbackUpdatedAt || state.bootstrapGeneratedAt);
    container.innerHTML = `<div class="topstories-empty">${escapeHtml(message)}${updatedAt ? `<div class="hero-fallback-updated">Last updated: ${escapeHtml(updatedAt)}</div>` : ""}</div>`;
    pushDegradedReason("hero", message);
    setDebugSection("hero", "fallback-empty");
    return;
  }
  setDebugSection("hero", safeArray(state.splitSnapshots?.latestNews?.topStories).length ? "snapshot:latest-news/bootstrap" : "live-or-bootstrap", { sections: sections.length });
  container.innerHTML = sections.map(renderTopStoriesSection).join("");

  bindTopStoriesCarousels();
}

function asTopStoryCluster(article = {}){
  const safe = article || {};
  if (safe?.primary){
    return {
      ...safe,
      primary: {
        ...safe.primary,
        imageUrl: safe.primary.imageUrl || safe.primary.image || safe.imageUrl || THUMB_PLACEHOLDER,
        image: safe.primary.image || safe.primary.imageUrl || safe.imageUrl || THUMB_PLACEHOLDER
      },
      related: safeArray(safe.related)
    };
  }
  return {
    headline: safe.title || "",
    primary: {
      title: safe.title || "",
      source: safe.source || "",
      publishedAt: safe.publishedAt || "",
      url: safe.link || safe.url || "#",
      link: safe.link || safe.url || "#",
      imageUrl: safe.imageUrl || safe.image || THUMB_PLACEHOLDER,
      image: safe.image || safe.imageUrl || THUMB_PLACEHOLDER,
      sentiment: safe.sentiment || { posP: 0, neuP: 100, negP: 0 }
    },
    related: []
  };
}

function normalizeTopStoryCluster(cluster = {}){
  if (cluster?.primary) return cluster;
  return asTopStoryCluster(cluster);
}

function buildTopStoriesSections(){
  const safe = (clusters = [], backup = []) =>
    Array.isArray(clusters) && clusters.length ? clusters : (backup || []);
  if (state.category === USA_CATEGORY){
    const usaTop = state.splitSnapshots?.usaNews?.topStories || state.bootstrapUsa?.topStories || (state.articles || []).slice(0, 12);
    return [{ id: "usa-recent", clusters: usaTop.map(asTopStoryCluster) }];
  }
  if (state.category === POTUS_CATEGORY){
    const potusTop = state.splitSnapshots?.potusNews?.topStories || state.bootstrapPotus?.topStories || (state.articles || []).slice(0, 12);
    return [{ id: "potus-recent", clusters: potusTop.map(asTopStoryCluster) }];
  }
  const topStories = state.topStories || {};
  const splitTop = safeArray(state.splitSnapshots?.latestNews?.topStories).map(asTopStoryCluster);
  const fallbackRecent = (splitTop.length ? splitTop : safe(topStories.indiaRecent, topStories.worldRecent)).map(normalizeTopStoryCluster);
  const preservedRecent = safeArray(state.currentHeroSnapshot).map(normalizeTopStoryCluster);
  const recent = preservedRecent.length ? preservedRecent : fallbackRecent;
  const sections = [
    {
      id: "recent",
      clusters: recent
    }
  ];
  if (!sections.some(section => (section.clusters || []).length)){
    return [];
  }
  return [
    ...sections
  ];
}

function renderTopStoriesSection(section){
  const slides = section.clusters || [];
  const slidesToRender = slides.slice(0, 4);
  const hasSlides = slidesToRender.length > 0;
  const dots = slidesToRender.length > 1
    ? `<div class="topstories-dots" role="tablist">
        ${slidesToRender.map((_, i) =>
          `<button data-i="${i}" aria-label="Go to slide ${i + 1}"></button>`
        ).join("")}
      </div>`
    : "";
  const controls = slidesToRender.length > 1
    ? `<button class="nav-btn topstories-prev" type="button" aria-label="Previous">‹</button>
       <button class="nav-btn topstories-next" type="button" aria-label="Next">›</button>`
    : `<span class="nav-btn spacer" aria-hidden="true"></span>
       <span class="nav-btn spacer" aria-hidden="true"></span>`;
  return `
    <div class="topstories-carousel-shell" data-carousel="${escapeHtml(section.id)}">
      <div class="topstories-carousel">
        <div class="topstories-carousel-body">
          <div class="topstories-track">
            ${hasSlides ? slidesToRender.map(cluster => `
              <div class="topstories-slide">
                ${renderTopStoriesCluster(cluster)}
              </div>`).join("") : `<div class="topstories-slide"><div class="topstories-empty">No stories yet.</div></div>`}
          </div>
          <div class="topstories-nav">
            ${controls}
          </div>
          ${dots}
        </div>
      </div>
    </div>`;
}

function resolveTopStoryImage(url = ""){
  const candidate = String(url || "").trim();
  if (!candidate) return "";
  if (candidate.startsWith("/")) return candidate;
  if (!isLikelyImageUrl(candidate)) return "";
  if (isFallbackLogo(candidate)) return "";
  return candidate;
}

function renderTopStoryMedia({
  imageUrl,
  fallbackLogo,
  fallbackText,
  className = "",
  fallbackClass = "topstories-thumb-fallback",
  logoClass = "topstories-cluster-logo"
} = {}){
  const image = resolveTopStoryImage(imageUrl);
  const safeText = escapeHtml(fallbackText || "Source");
  const safeLogo = String(fallbackLogo || "").trim();
  const imgClass = className ? ` ${className}` : "";
  if (image){
    return `<img class="${imgClass.trim()}" src="${image}" loading="lazy" alt=""
      data-fallback-logo="${safeLogo}"
      data-fallback-text="${safeText}"
      onerror="const logo=this.dataset.fallbackLogo; if(logo){this.src=logo; this.classList.add('logo-fallback'); this.onerror=null;} else {const div=document.createElement('div');div.className='${fallbackClass}';div.textContent=this.dataset.fallbackText||'Source';this.replaceWith(div);}">`;
  }
  return renderClusterLogoFallback(safeLogo, safeText, fallbackClass, logoClass);
}

function renderTopStoriesCluster(cluster){
  const primary = cluster?.primary || {};
  const headline = escapeHtml(primary?.title || cluster?.headline || "");
  const related = (cluster?.related || []).slice(0, 2);
  const sourceName = escapeHtml(primary?.source || "Source");
  const time = escapeHtml(formatArticleDate(primary?.publishedAt) || "");
  const primaryUrl = primary?.url || primary?.link || "#";
  const imageUrl = primary?.imageUrl || primary?.image || cluster?.imageUrl || THUMB_PLACEHOLDER;
  const sourceLogo = (primary?.sourceLogo || logoFor(primary?.url || primary?.link, primary?.source || "")).trim();
  const imageMarkup = renderTopStoryMedia({
    imageUrl,
    fallbackLogo: sourceLogo,
    fallbackText: sourceName,
    className: "topstories-cluster-image hero-thumbnail"
  });
  const context = getArticleContext(primary);

  return `
    <article class="topstories-cluster topStoriesGrid">
      <div class="heroCard">
        <div class="tile-action-group">
          ${renderShareButton(primary, imageUrl, "icon-only")}
          ${renderInfoButton(primary?.sentiment || cluster?.sentiment || {}, context)}
        </div>
        <a class="topstories-cluster-link heroLink" href="${primaryUrl}" target="_blank" rel="noopener">
          <div class="topstories-cluster-media heroMedia">
            ${imageMarkup}
          </div>
          <div class="topstories-cluster-sentiment heroSentiment">
            ${renderSentiment(primary?.sentiment || cluster?.sentiment || {}, true, context)}
          </div>
          <div class="topstories-cluster-headline heroHeadline">${headline}</div>
          <div class="topstories-cluster-meta heroMeta">
            <div class="topstories-cluster-meta-row">
              <span class="source">${sourceName}</span>
            </div>
            <div class="topstories-cluster-meta-row datetime">${time}</div>
          </div>
        </a>
      </div>
      <div class="relatedList">
        <div class="topstories-related-title">Related stories</div>
        <div class="topstories-related-list relatedItems">
          ${related.length
            ? related.map(item => renderTopStoriesRelated(item)).join("")
            : `<div class="topstories-related-empty">No other coverage found yet</div>`}
        </div>
      </div>
    </article>`;
}

function renderTopStoriesRelated(item){
  const sourceName = escapeHtml(item?.source || "Source");
  const time = escapeHtml(formatArticleDate(item?.publishedAt) || "");
  const headline = escapeHtml(item?.headline || item?.title || "");
  const itemUrl = item?.url || item?.link || "";
  const logo = (item?.sourceLogo || logoFor(itemUrl, item?.source || "")).trim();
  const isPinned = Boolean(itemUrl && isArticlePinned(itemUrl));
  const pinBadge = isPinned ? `<span class="ts-pin">Pinned</span>` : "";
  const safeLogo = logo || LOGO_PLACEHOLDER;
  const context = getArticleContext(item);
  return `
    <a class="topstories-related-row relatedItem" href="${item?.url || item?.link || "#"}" target="_blank" rel="noopener">
      <div class="tile-action-group">
        ${renderShareButton(item, item?.imageUrl || "", "icon-only")}
        ${renderInfoButton(item?.sentiment || {}, context)}
      </div>
      <div class="topstories-related-body">
        <div class="topstories-related-meta">
          <div class="topstories-related-meta-row">
            <img class="topstories-related-logo" src="${safeLogo}" alt="${sourceName} logo" loading="lazy"
              data-placeholder="${LOGO_PLACEHOLDER}"
              onerror="this.onerror=null;this.src=this.dataset.placeholder;">
            <span class="source">${sourceName}</span>
            <span class="topstories-related-time">${time}</span>
          </div>
          ${pinBadge ? `<div class="topstories-related-pin">${pinBadge}</div>` : ""}
        </div>
        <div class="topstories-related-headline">${headline}</div>
        ${renderSentiment(item?.sentiment || {}, true, context, "mini")}
      </div>
    </a>`;
}

function renderClusterLogoFallback(logo, sourceName, fallbackClass = "topstories-thumb-fallback", logoClass = "topstories-cluster-logo"){
  if (logo){
    return `
      <div class="${fallbackClass}">
        <img class="${logoClass}" src="${logo}" loading="lazy" alt="${sourceName} logo"
          data-fallback-text="${sourceName}"
          onerror="this.closest('.${fallbackClass}').textContent=this.dataset.fallbackText||'Source';">
      </div>`;
  }
  return `<div class="${fallbackClass}">${sourceName}</div>`;
}

function bindTopStoriesCarousels(){
  $$(".topstories-carousel-shell").forEach(carousel => {
    if (carousel.dataset.bound) return;
    carousel.dataset.bound = "1";
    const track = carousel.querySelector(".topstories-track");
    const slides = [...carousel.querySelectorAll(".topstories-slide")];
    const dots = [...carousel.querySelectorAll(".topstories-dots button")];
    const update = (next) => {
      if (!slides.length) return;
      const total = slides.length;
      const nextIndex = Math.max(0, Math.min(next, total - 1));
      carousel.dataset.index = String(nextIndex);
      track.style.transform = `translateX(-${nextIndex * 100}%)`;
      dots.forEach((dot, idx) => dot.classList.toggle("active", idx === nextIndex));
    };
    carousel.querySelector(".topstories-prev")?.addEventListener("click", () =>
      update((Number(carousel.dataset.index) || 0) - 1)
    );
    carousel.querySelector(".topstories-next")?.addEventListener("click", () =>
      update((Number(carousel.dataset.index) || 0) + 1)
    );
    dots.forEach(dot => {
      dot.addEventListener("click", () => update(Number(dot.dataset.i || 0)));
    });
    update(0);
  });
}

/* Trending topics */
function renderTopicSparkline(scores = []){
  const safeScores = scores.length ? scores : [0, 0, 0, 0];
  const W = 72, H = 24, pad = 2;
  const maxAbs = 20;
  const steps = Math.max(1, safeScores.length - 1);
  const xStep = (W - pad * 2) / steps;
  const mid = H / 2;
  const amplitude = (H / 2) - pad;
  const clamp = value => Math.max(-maxAbs, Math.min(maxAbs, value));
  const colorFor = value => {
    if (value > 2) return "var(--pos)";
    if (value < -2) return "var(--neg)";
    return "#94a3b8";
  };
  const points = safeScores.map((score, i) => ({
    x: pad + (xStep * i),
    y: mid - (clamp(score) / maxAbs) * amplitude
  }));
  const segments = points.slice(0, -1).map((point, i) => {
    const next = points[i + 1];
    const color = colorFor(safeScores[i]);
    return `<path d="M${point.x.toFixed(1)} ${point.y.toFixed(1)} L${next.x.toFixed(1)} ${next.y.toFixed(1)}" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }).join("");
  return `
    <svg class="trend-sparkline" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
      ${segments}
    </svg>`;
}

function getTrendTooltip(){
  let tooltip = document.querySelector(".trend-tooltip");
  if (!tooltip){
    tooltip = document.createElement("div");
    tooltip.className = "trend-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function formatTrendBucketTime(start, end){
  const opts = { hour: "2-digit", minute: "2-digit", hour12: false };
  const startLabel = new Date(start).toLocaleTimeString("en-IN", opts);
  const endLabel = new Date(end).toLocaleTimeString("en-IN", opts);
  return `${startLabel}–${endLabel}`;
}

function clampTooltipPosition(x, y, tooltip){
  const padding = 12;
  const rect = tooltip.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - padding;
  const maxY = window.innerHeight - rect.height - padding;
  return {
    x: Math.min(maxX, Math.max(padding, x)),
    y: Math.min(maxY, Math.max(padding, y))
  };
}

function attachTrendTooltips(){
  const tooltip = getTrendTooltip();
  const trendEls = $$(".topic-trend");
  trendEls.forEach(el => {
    if (el.dataset.tooltipBound) return;
    el.dataset.tooltipBound = "1";
    el.addEventListener("mousemove", (event) => {
      const bucketsRaw = el.dataset.buckets;
      if (!bucketsRaw) return;
      let buckets = [];
      try{
        buckets = JSON.parse(bucketsRaw);
      }catch{
        return;
      }
      if (!buckets.length) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
      const idx = Math.min(buckets.length - 1, Math.floor(ratio * buckets.length));
      const bucket = buckets[idx];
      if (!bucket) return;
      tooltip.innerHTML = `
        <div class="trend-tooltip-time">${formatTrendBucketTime(bucket.start, bucket.end)}</div>
        <div class="trend-tooltip-values">
          <span class="pos">Positive ${fmtPct(bucket.pos)}</span>
          <span class="neu">Neutral ${fmtPct(bucket.neu)}</span>
          <span class="neg">Negative ${fmtPct(bucket.neg)}</span>
        </div>`;
      tooltip.style.display = "block";
      const position = clampTooltipPosition(event.clientX + 12, event.clientY + 12, tooltip);
      tooltip.style.left = `${position.x}px`;
      tooltip.style.top = `${position.y}px`;
    });
    el.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });
}

function renderTopicSourceLogos(matches = []){
  const sourceMap = new Map();
  matches.forEach(article => {
    if (!article?.source || sourceMap.has(article.source)) return;
    sourceMap.set(article.source, article.link || "");
  });
  const entries = [...sourceMap.entries()];
  const max = 4;
  const extra = Math.max(0, entries.length - max);
  const items = entries.slice(0, max).map(([source, link]) => {
    const logo = getSourceLogoUrl(domainFromUrl(link), source, { allowRemote: false });
    const placeholder = LOGO_PLACEHOLDER;
    const classNames = ["topic-logo", logo ? "" : "topic-logo-fallback"]
      .filter(Boolean)
      .join(" ");
    return `<img class="${classNames}" src="${logo || placeholder}" alt="${escapeHtml(source)}" loading="lazy"
      data-placeholder="${placeholder}"
      onerror="this.onerror=null;this.classList.add('topic-logo-fallback');this.src=this.dataset.placeholder;">`;
  }).join("");
  const extraBadge = extra ? `<span class="logo-count">+${extra}</span>` : "";
  return `<span class="topic-logos">${items}${extraBadge}</span>`;
}

// Compatibility shim for stale runtime callers still invoking removed hero autoplay hooks.
function startHeroAuto(){
  return;
}
function getTopicContext(topic, matches = []){
  const base = topic?.displayTitle || topic?.title || "";
  const sample = matches[0];
  return `${base} ${sample?.title || ""} ${sample?.description || ""}`.trim();
}

function getSentimentTooltip(){
  let tooltip = document.querySelector(".sentiment-tooltip");
  if (!tooltip){
    tooltip = document.createElement("div");
    tooltip.className = "sentiment-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}
function sentimentTone(pos, neg){
  const threshold = 5;
  if (pos > neg + threshold) return "pos";
  if (neg > pos + threshold) return "neg";
  return "neu";
}
function findCue(text, cues){
  const lower = text.toLowerCase();
  return cues.find(cue => lower.includes(cue)) || "";
}
function buildSentimentExplanation(text, pos, neg){
  const tone = sentimentTone(pos, neg);
  if (tone === "pos"){
    const cue = findCue(text || "", POSITIVE_CUES);
    return cue
      ? `Positive cues like “${cue}” suggest upbeat framing.`
      : "Positive framing with growth or success language.";
  }
  if (tone === "neg"){
    const cue = findCue(text || "", NEGATIVE_CUES);
    return cue
      ? `Negative cues like “${cue}” suggest concerning framing.`
      : "Negative framing with crisis or conflict language.";
  }
  return "Mostly factual/neutral language with few emotional cues.";
}
function formatSentimentTooltip(el, context, pos, neg, includeTitle = true){
  const encoded = el.dataset.why || "";
  if (encoded){
    try{
      const data = JSON.parse(decodeURIComponent(encoded));
      const label = escapeHtml(data.label || "Neutral");
      const confidence = Number(data.confidence ?? 0);
      const confText = Number.isFinite(confidence)
        ? `${Math.round(confidence * 100)}% confidence`
        : "";
      const phrases = Array.isArray(data.phrases) ? data.phrases : [];
      const phraseList = phrases.slice(0, 6)
        .map(phrase => `<span>${escapeHtml(phrase)}</span>`)
        .join("");
      const summary = escapeHtml(data.summary || buildSentimentExplanation(context, pos, neg));
      return `
        ${includeTitle ? `<div class="tooltip-title">Why this score</div>` : ""}
        <div class="tooltip-sub">${label}${confText ? ` · ${confText}` : ""}</div>
        ${phraseList
          ? `<div class="tooltip-phrases">${phraseList}</div>`
          : `<div class="tooltip-phrases"><span>Not enough keywords yet</span></div>`}
        <div class="tooltip-summary">${summary}</div>
      `;
    }catch{
      const summary = context ? buildSentimentExplanation(context, pos, neg) : "Explanation coming soon.";
      return `
        ${includeTitle ? `<div class="tooltip-title">Why this score</div>` : ""}
        <div class="tooltip-summary">${escapeHtml(summary)}</div>
      `;
    }
  }
  const summary = context ? buildSentimentExplanation(context, pos, neg) : "Explanation coming soon.";
  return `
    ${includeTitle ? `<div class="tooltip-title">Why this score</div>` : ""}
    <div class="tooltip-summary">${escapeHtml(summary)}</div>
  `;
}
function attachSentimentTooltips(){
  const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!supportsHover) return;
  const tooltip = getSentimentTooltip();
  $$(".sentiment").forEach(el => {
    if (el.dataset.tooltipBound) return;
    el.dataset.tooltipBound = "1";
    const show = (event) => {
      const context = el.dataset.context || "";
      const pos = Number(el.dataset.pos || 0);
      const neg = Number(el.dataset.neg || 0);
      tooltip.innerHTML = formatSentimentTooltip(el, context, pos, neg, true);
      tooltip.style.display = "block";
      const position = clampTooltipPosition(event.clientX + 12, event.clientY + 12, tooltip);
      tooltip.style.left = `${position.x}px`;
      tooltip.style.top = `${position.y}px`;
    };
    el.addEventListener("mousemove", show);
    el.addEventListener("click", show);
    el.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });
}

function getSentimentSheet(){
  return {
    sheet: $("#sentimentSheet"),
    overlay: $("#sentimentSheetOverlay"),
    content: $("#sentimentSheetContent"),
    closeBtn: $("#sentimentSheetClose")
  };
}

function openSentimentSheet(el){
  const { sheet, overlay, content } = getSentimentSheet();
  if (!sheet || !overlay || !content) return;
  const context = el.dataset.context || "";
  const pos = Number(el.dataset.pos || 0);
  const neg = Number(el.dataset.neg || 0);
  content.innerHTML = formatSentimentTooltip(el, context, pos, neg, false);
  overlay.classList.add("show");
  sheet.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  sheet.setAttribute("aria-hidden", "false");
}

function closeSentimentSheet(){
  const { sheet, overlay } = getSentimentSheet();
  if (!sheet || !overlay) return;
  overlay.classList.remove("show");
  sheet.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
  sheet.setAttribute("aria-hidden", "true");
}

function attachInfoButtons(){
  const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const tooltip = getSentimentTooltip();
  $$(".tile-info").forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!supportsHover) openSentimentSheet(btn);
    });
    if (!supportsHover) return;
    const show = (event) => {
      const context = btn.dataset.context || "";
      const pos = Number(btn.dataset.pos || 0);
      const neg = Number(btn.dataset.neg || 0);
      tooltip.innerHTML = formatSentimentTooltip(btn, context, pos, neg, true);
      tooltip.style.display = "block";
      const position = clampTooltipPosition(event.clientX + 12, event.clientY + 12, tooltip);
      tooltip.style.left = `${position.x}px`;
      tooltip.style.top = `${position.y}px`;
    };
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("mousemove", show);
    btn.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });
}

async function copyShareLink(link){
  if (!link) return false;
  try{
    if (navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(link);
      return true;
    }
  }catch{}
  try{
    const temp = document.createElement("textarea");
    temp.value = link;
    temp.setAttribute("readonly", "");
    temp.style.position = "fixed";
    temp.style.top = "-9999px";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    return true;
  }catch{
    return false;
  }
}

function flashCopied(btn){
  if (!btn) return;
  const isIconOnly = btn.classList.contains("icon-only");
  const original = btn.textContent;
  btn.classList.add("copied");
  if (!isIconOnly) btn.textContent = "Copied";
  window.setTimeout(() => {
    btn.classList.remove("copied");
    if (!isIconOnly) btn.textContent = original || "Share";
  }, 1500);
}

function attachShareButtons(){
  const allowWebShare = navigator.share && window.matchMedia("(pointer: coarse)").matches;
  $$(".share-btn").forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = btn.dataset.shareUrl || "";
      const title = btn.dataset.shareTitle || "Informed360";
      const textSource = btn.dataset.shareText || "";
      const text = textSource
        ? `${textSource} · Informed360 — News + Sentiment`
        : "Informed360 — News + Sentiment";
      if (allowWebShare){
        try{
          await navigator.share({ title, text, url });
          return;
        }catch{}
      }
      const copied = await copyShareLink(url);
      if (copied) flashCopied(btn);
    });
  });
}

function renderTopics(){
  const topicsList = $("#topicsList");
  if (!topicsList) return;
  if (!safeArray(state.topics).length){
    topicsList.innerHTML = `<div class="news-empty">${escapeHtml(state.usingFallbackSnapshot ? SNAPSHOT_FALLBACK_MESSAGE : EMPTY_STATE_MESSAGE)}</div>`;
    return;
  }
  topicsList.innerHTML = state.topics.map(t => {
    const total =
      (t.sentiment.pos || 0) +
      (t.sentiment.neu || 0) +
      (t.sentiment.neg || 0);
    const sent = {
      posP: total ? (t.sentiment.pos/total)*100 : 0,
      neuP: total ? (t.sentiment.neu/total)*100 : 0,
      negP: total ? (t.sentiment.neg/total)*100 : 0
    };
    const matches = getTopicArticles(t, state.allArticles);
    const trend = t.trend || computeTopicTrend(t, matches);
    const trendLabel = "Sentiment trend (last 4 hours)";
    const sparkline = renderTopicSparkline(trend.scores || []);
    const logos = renderTopicSourceLogos(matches);
    const context = getTopicContext(t, matches);
    return `
      <div class="row">
        <div class="row-title">
          <span class="topic-title-text">${escapeHtml(t.displayTitle || t.title.split("|")[0])}</span>
          <span class="topic-trend ${trend.tone}" aria-label="${trendLabel}"
            data-buckets='${JSON.stringify(trend.buckets || [])}'>
            ${sparkline}
          </span>
        </div>
        <div class="row-meta">
          <span>${t.count} articles</span>
          · <span>${t.sources} sources</span>
          ${logos}
        </div>
        ${renderSentiment(sent, true, context)}
      </div>`;
  }).join("");
  attachTrendTooltips();
}

/* ===== 4-hour sentiment chart – single band + lines like your reference ===== */
function renderSentimentTimeline({ sparkEl, summaryEl, titleEl, title, articles, timelineOverride = null, nowMs = Date.now() }){
  const now = nowMs;
  const fourHrs = 4 * 60 * 60 * 1000;
  let pts;
  if (isValidTimeline(timelineOverride)){
    pts = timelineOverride.map(point => ({
      pos: Math.round(Number(point.pos) || 0),
      neg: Math.round(Number(point.neg) || 0),
      neu: Math.round(Number(point.neu) || 0)
    }));
  } else {
    const recent = (articles || []).filter(
      a => now - new Date(a.publishedAt).getTime() <= fourHrs
    );

    const buckets = [0,1,2,3].map(() => ({ pos:0, neg:0, neu:0, c:0 }));
    recent.forEach(a => {
      const dt  = now - new Date(a.publishedAt).getTime();
      const idx = Math.min(3, Math.floor(dt / (60 * 60 * 1000))); // 0..3
      const bi  = 3 - idx; // oldest on the left
      buckets[bi].pos += a.sentiment.posP;
      buckets[bi].neg += a.sentiment.negP;
      buckets[bi].neu += a.sentiment.neuP;
      buckets[bi].c++;
    });

    pts = buckets.map(b => {
      const n = Math.max(1, b.c);
      return {
        pos: Math.round(b.pos / n),
        neg: Math.round(b.neg / n),
        neu: Math.round(b.neu / n)
      };
    });
  }

  const svg = typeof sparkEl === "string" ? $(sparkEl) : sparkEl;
  if (!svg) return;
  const summary = typeof summaryEl === "string" ? $(summaryEl) : summaryEl;
  const titleNode = typeof titleEl === "string" ? $(titleEl) : titleEl;
  if (titleNode && title) titleNode.textContent = title;

  const W = 300, H = 120;
  const padL = 34, padR = 10, padT = 18, padB = 24;
  const mid  = H / 2;

  const x = i => padL + i * ((W - padL - padR) / 3);
  const scale = (H/2 - padT - 10) / 30; // compress amplitude

  const yPos = p => mid - Math.min(30, Math.max(0, p)) * scale;
  const yNeg = p => mid + Math.min(30, Math.max(0, p)) * scale;

  const tickLabels = [3,2,1,0].map(h => {
    const d = new Date(now - h*60*60*1000);
    return d.toLocaleTimeString([],{
      hour:"2-digit", minute:"2-digit"
    });
  });

  const grid = [0,1,2,3].map(i =>
    `<line x1="${x(i)}" y1="${padT}" x2="${x(i)}" y2="${H-padB}"
            stroke="#d1d5db" stroke-dasharray="4 4"
            stroke-width="1" opacity=".8"></line>`
  ).join("");

  const labels = [0,1,2,3].map(i =>
    `<text x="${x(i)}" y="${H-4}" text-anchor="middle"
           font-size="10" fill="#6b7280">${tickLabels[i]}</text>`
  ).join("");

  const pPath = pts.map((p,i) => `${i ? "L" : "M"} ${x(i)} ${yPos(p.pos)}`).join(" ");
  const nPath = pts.map((p,i) => `${i ? "L" : "M"} ${x(i)} ${yNeg(p.neg)}`).join(" ");

  const pDots = pts.map((p,i) =>
    `<circle cx="${x(i)}" cy="${yPos(p.pos)}" r="2.6" fill="#22c55e"></circle>
     <text x="${x(i)}" y="${yPos(p.pos)-6}" text-anchor="middle"
           font-size="11" fill="#22c55e">${p.pos}%</text>`
  ).join("");

  const nDots = pts.map((p,i) =>
    `<circle cx="${x(i)}" cy="${yNeg(p.neg)}" r="2.6" fill="#ef4444"></circle>
     <text x="${x(i)}" y="${yNeg(p.neg)+11}" text-anchor="middle"
           font-size="11" fill="#ef4444">${p.neg}%</text>`
  ).join("");

  svg.innerHTML = `
    <rect x="${padL-8}" y="${mid-9}"
          width="${W-padL-padR+16}" height="18"
          fill="#e5e7eb" opacity="0.9"></rect>
    ${grid}
    <path d="${pPath}" fill="none" stroke="#22c55e" stroke-width="2.4"></path>
    <path d="${nPath}" fill="none" stroke="#ef4444" stroke-width="2.4"></path>
    ${pDots}
    ${nDots}
    ${labels}
  `;

  const avg = pts.reduce(
    (a,p) => ({
      pos: a.pos + p.pos,
      neu: a.neu + p.neu,
      neg: a.neg + p.neg
    }),
    { pos:0, neu:0, neg:0 }
  );
  const n = pts.length || 1;
  if (summary){
    summary.innerHTML =
      `<span class="sentiment-label pos">Positive</span> ${fmtPct(avg.pos/n)} · ` +
      `<span class="sentiment-label neu">Neutral</span> ${fmtPct(avg.neu/n)} · ` +
      `<span class="sentiment-label neg">Negative</span> ${fmtPct(avg.neg/n)}`;
  }
}

function renderNiftyMicroStrip(summaryEl, marketPayload, timeline){
  if (!summaryEl || !Array.isArray(timeline) || !timeline.some((v) => Number.isFinite(v))) return;
  const quote = safeArray(marketPayload?.quotes).find((q) => normalizeMarketSymbol(q?.symbol) === normalizeMarketSymbol("^NSEI"));
  const isClosed = quote?.status === "closed";
  const label = isClosed ? "Nifty — last session" : "Nifty — today";
  const points = timeline
    .map((value, i) => ({ i, value: Number(value) }))
    .filter((point) => Number.isFinite(point.value));
  if (!points.length) return;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const range = Math.max(1, max - min);
  const W = 120;
  const H = 16;
  const x = (i) => i * ((W - 2) / Math.max(1, timeline.length - 1)) + 1;
  const y = (value) => (H - 1) - (((value - min) / range) * (H - 2));
  const d = points.map((point, idx) => `${idx ? "L" : "M"} ${x(point.i)} ${y(point.value)}`).join(" ");
  summaryEl.insertAdjacentHTML("beforeend", `
    <div class="mood-nifty-strip">
      <span class="mood-nifty-label">${escapeHtml(label)}</span>
      <svg class="mood-nifty-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <path d="${d}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </div>
  `);
}

function getActiveCategoryLabel(){
  const active = $(".gn-tabs .tab.active");
  if (!active) return "World";
  if (active.dataset.cat === "home") return "World";
  return (active.textContent || "World").trim();
}

function formatSentimentTitle(label){
  if (!label) return "World's Sentiment";
  if (label.toLowerCase() === "for you") return "For You Sentiment";
  const possessive = label.endsWith("s") ? `${label}'` : `${label}'s`;
  return `${possessive} Sentiment`;
}

function getIndiaSentimentArticles(){
  if (state.category === "home"){
    return (state.allArticles || []).filter(a => a.category === "india");
  }
  if (state.category === "india") return state.articles || [];
  return state.indiaArticles || [];
}

function getWorldSentimentArticles(){
  if (state.category === "home"){
    return (state.allArticles || []).filter(a => a.category === "world");
  }
  if (state.category === USA_CATEGORY){
    return (state.articles || []).filter(isUsaArticle);
  }
  if (state.category === POTUS_CATEGORY){
    return state.articles || [];
  }
  return state.articles || [];
}

function renderIndiaSentiment(){
  const chartNow = Date.now();
  const timeline = state.category === "home"
    ? (state.sentimentData?.timelines?.india || state.bootstrapPlots?.indiaSentimentTimeline)
    : null;
  const marketPayload = readMarketCache();
  const niftyHistory = getNiftyHistoryPoints(marketPayload);
  const niftyTimeline = buildNiftyTimelineFromHistory(niftyHistory, chartNow);
  const summaryEl = $("#moodSummary");
  renderSentimentTimeline({
    sparkEl: "#moodSpark",
    summaryEl,
    titleEl: "#moodIndiaTitle",
    title: "India's Sentiment",
    articles: getIndiaSentimentArticles(),
    timelineOverride: timeline,
    nowMs: chartNow
  });
  renderNiftyMicroStrip(summaryEl, marketPayload, niftyTimeline);
}

function renderWorldSentiment(){
  const splitTimeline = state.splitSnapshots?.trendingHistory?.world;
  const timeline = state.category === "home"
    ? (splitTimeline || state.sentimentData?.timelines?.world || state.bootstrapPlots?.worldSentimentTimeline)
    : null;
  setDebugSection("trending", splitTimeline ? "snapshot:trending-history" : "live-or-bootstrap", { points: countOf(splitTimeline || timeline || []) });
  renderSentimentTimeline({
    sparkEl: "#moodWorldSpark",
    summaryEl: "#moodWorldSummary",
    titleEl: "#moodWorldTitle",
    title: formatSentimentTitle(getActiveCategoryLabel()),
    articles: getWorldSentimentArticles(),
    timelineOverride: timeline
  });
}

/* ===== Sentiment Leaderboard ===== */
function getLeaderboardArticles(){
  if (state.category === USA_CATEGORY){
    const fromBootstrap = Array.isArray(state.bootstrapUsa?.dailyNews) ? state.bootstrapUsa.dailyNews : [];
    return fromBootstrap.length ? fromBootstrap : (state.articles || []).filter(isUsaArticle);
  }
  if (state.category === POTUS_CATEGORY){
    const fromBootstrap = Array.isArray(state.bootstrapPotus?.dailyNews) ? state.bootstrapPotus.dailyNews : [];
    return fromBootstrap.length ? fromBootstrap : (state.articles || []).filter(isPotusArticle);
  }
  return state.articles || [];
}

function computeLeaderboard(){
  const MAX_VISIBLE_LOGOS = 15;
  const PER_BUCKET_LIMIT = Math.max(1, Math.floor(MAX_VISIBLE_LOGOS / 3));
  const rankScore = (row) => {
    const count = Number(row.count || 0);
    const confidence = Number(row.confidence || 0);
    const freshness = row.publishedAt ? Math.max(0, 1 - ((Date.now() - new Date(row.publishedAt).getTime()) / (6 * 60 * 60 * 1000))) : 0;
    return count + (confidence * 2) + freshness;
  };
  const splitRows = safeArray(state.splitSnapshots?.sourceSentiment?.rows);
  if (splitRows.length){
    const arr = splitRows.map((row) => {
      const rawSource = String(row.source || "").trim();
      const source = normalizeSourceName(rawSource);
      const pos = Number(row.pos || 0);
      const neg = Number(row.neg || 0);
      return {
        rawSource,
        source,
        sourceDomain: String(row.sourceDomain || "").trim(),
        articleDomain: domainFromUrl(row.link || ""),
        pos,
        neu: Number(row.neu || 0),
        neg,
        bias: pos - neg,
        logo: getSourceLogoUrl("", source, { allowRemote: false }),
        count: Number(row.count || MIN_SOURCE_ARTICLES)
      };
    }).filter((row) => row.source && isStrongSourceLabel(row.source));
    return {
      pos: arr.filter(x => x.bias > 3).sort((a,b) => rankScore(b) - rankScore(a) || b.bias - a.bias).slice(0, PER_BUCKET_LIMIT),
      neu: arr.slice().sort((a,b) => rankScore(b) - rankScore(a) || Math.abs(a.bias) - Math.abs(b.bias)).slice(0, PER_BUCKET_LIMIT),
      neg: arr.filter(x => x.bias < -3).sort((a,b) => rankScore(b) - rankScore(a) || a.bias - b.bias).slice(0, PER_BUCKET_LIMIT),
      activeSourceCount: arr.length
    };
  }
  const bySource = new Map();
  getLeaderboardArticles().forEach(a => {
    const key = normalizeSourceName(a.source || "");
    if (!key) return;
    if (state.category === USA_CATEGORY && !USA_SECTION_SOURCES.has(key)) return;
    if (state.category === POTUS_CATEGORY && !USA_SECTION_SOURCES.has(key)) return;
    const s = bySource.get(key) || {
      n:0, pos:0, neg:0, neu:0, link:a.link
    };
    const sentiment = getSafeSentiment(a.sentiment);
    s.n++;
    s.pos += sentiment.posP;
    s.neg += sentiment.negP;
    s.neu += sentiment.neuP;
    s.link = a.link || s.link;
    bySource.set(key, s);
  });

  const arr = [...bySource.entries()].map(([src,v]) => {
    const n = Math.max(1, v.n);
    const pos = v.pos/n, neg = v.neg/n, neu = v.neu/n;
    const bias = pos - neg;
    const logo = getSourceLogoUrl(domainFromUrl(v.link || ""), src, { allowRemote: false });
    return {
      rawSource: src,
      source: src,
      sourceDomain: "",
      articleDomain: domainFromUrl(v.link || ""),
      pos, neg, neu, bias, logo, count: v.n
    };
  }).filter(x => (x.pos + x.neg + x.neu) > 0.1 && x.count >= MIN_SOURCE_ARTICLES && isStrongSourceLabel(x.source));

  if (!arr.length){
    const splitRows = state.splitSnapshots?.sourceSentiment?.rows;
    const fallback = state.category === USA_CATEGORY
      ? (state.bootstrapUsa?.leaderboard || splitRows)
      : state.category === POTUS_CATEGORY
        ? (state.bootstrapPotus?.sourceLeaderboard || splitRows)
        : (splitRows || state.sentimentData?.sourceLeaderboard || null);
    if (Array.isArray(fallback) && fallback.length){
      fallback.forEach((row) => {
        const source = normalizeSourceName(row.source || "");
        if (!source || !isStrongSourceLabel(source)) return;
        const bias = Number(row.pos || 0) - Number(row.neg || 0);
        arr.push({
          rawSource: row.source || "",
          source,
          sourceDomain: String(row.sourceDomain || "").trim(),
          articleDomain: domainFromUrl(row.link || ""),
          pos: Number(row.pos || 0),
          neu: Number(row.neu || 0),
          neg: Number(row.neg || 0),
          bias,
          logo: getSourceLogoUrl("", source, { allowRemote: false }),
          count: Number(row.count || MIN_SOURCE_ARTICLES)
        });
      });
    }
  }

  const pos = arr.filter(x => x.bias > 3)
    .sort((a,b) => rankScore(b) - rankScore(a) || b.bias - a.bias).slice(0,PER_BUCKET_LIMIT);
  const neg = arr.filter(x => x.bias < -3)
    .sort((a,b) => rankScore(b) - rankScore(a) || a.bias - b.bias).slice(0,PER_BUCKET_LIMIT);
  const neu = arr.slice()
    .sort((a,b) => rankScore(b) - rankScore(a) || Math.abs(a.bias) - Math.abs(b.bias))
    .slice(0,PER_BUCKET_LIMIT);

  return { pos, neu, neg, activeSourceCount: arr.length };
}

function loadImage(src){
  if (!src) return Promise.resolve(false);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

let sourceLogoManifestMapPromise = null;
async function getSourceLogoManifestMap(){
  if (sourceLogoManifestMapPromise) return sourceLogoManifestMapPromise;
  sourceLogoManifestMapPromise = fetch("/data/source-logo-manifest.json", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then((json) => {
      const sources = json?.sources && typeof json.sources === "object" ? json.sources : {};
      const map = new Map();
      Object.entries(sources).forEach(([domain, entry]) => {
        const key = String(domain || "").trim().toLowerCase().replace(/^www\./, "");
        const path = String(entry?.logoPath || "").trim();
        if (key && path) map.set(key, path);
      });
      return map;
    })
    .catch(() => new Map());
  return sourceLogoManifestMapPromise;
}

async function renderSourceSentimentV2(){
  const grid = $("#sourceSentimentV2");
  if (!grid) return;
  console.log("SOURCE_SENTIMENT_V2_ONLY_ACTIVE");
  const colPos = grid.querySelector(".col-pos");
  const colNeu = grid.querySelector(".col-neu");
  const colNeg = grid.querySelector(".col-neg");
  const empty = grid.querySelector(".board-empty");

  const { pos, neu, neg } = computeLeaderboard();
  const existingLogos = grid.querySelectorAll("img.source-sentiment-v2-logo").length;
  if (!pos.length && !neu.length && !neg.length && existingLogos > 0){
    console.log("SOURCE_SENTIMENT_V2_LAYOUT_FIXED_SKIP_EMPTY_REFRESH", { existingLogos });
    return;
  }
  grid.querySelectorAll(".badge").forEach((node) => node.remove());
  [colPos, colNeu, colNeg].forEach(c => c && (c.innerHTML = ""));
  const debugSources = new URLSearchParams(window.location.search).get("debugSources") === "1";
  const PER_LANE_MAX = 4;
  const sourceLogoManifest = await getSourceLogoManifestMap();

  const resolveDomain = (row = {}) => {
    const sourceDomain = String(row.sourceDomain || "").trim().toLowerCase().replace(/^www\./, "");
    const articleDomain = String(row.articleDomain || "").trim().toLowerCase().replace(/^www\./, "");
    return sourceDomain
      || resolveDomainFromSourceName(row.source || "")
      || inferDomainFromSourceText(row.rawSource || row.source || "")
      || articleDomain;
  };

  const rowScore = (row = {}) => {
    const contribution = Number(row?.contribution ?? row?.score ?? row?.weight ?? NaN);
    if (Number.isFinite(contribution)) return contribution;
    return Number.NaN;
  };
  const sortLaneRows = (list = []) => {
    const allHaveContribution = list.every((row) => Number.isFinite(rowScore(row)));
    if (!allHaveContribution) return list.slice();
    return list.slice().sort((a, b) => rowScore(b) - rowScore(a));
  };

  async function place(col, list){
    if (!col) return;
    col.innerHTML = "";
    const laneList = document.createElement("div");
    laneList.className = "source-sentiment-v2-lane-list";
    const laneRows = sortLaneRows(list);
    const seenDomains = new Set();
    let placed = 0;
    for (const row of laneRows){
      if (placed >= PER_LANE_MAX) break;
    const laneRows = sortLaneRows(list).slice(0, PER_LANE_MAX);
    for (const row of laneRows){
      const domain = resolveDomain(row);
      if (!domain || seenDomains.has(domain)) continue;
      const logoPath = String(sourceLogoManifest.get(domain) || "").trim();
      if (!logoPath || !logoPath.startsWith('/')) continue;
      const ok = await loadImage(logoPath);
      if (!ok) continue;
      seenDomains.add(domain);

      const wrap = document.createElement("div");
      wrap.className = "source-sentiment-v2-item";

      const img = document.createElement("img");
      img.className = "source-sentiment-v2-logo";
      img.src = logoPath;
      img.alt = "";
      img.loading = "lazy";
      wrap.appendChild(img);
      if (debugSources){
        const label = document.createElement("span");
        label.className = "source-sentiment-v2-debug-label";
        label.textContent = row.source || domain;
        wrap.appendChild(label);
      }
      laneList.appendChild(wrap);
      placed++;
    }
    col.appendChild(laneList);
  }

  await Promise.all([place(colPos, pos), place(colNeu, neu), place(colNeg, neg)]);
  const renderedPositive = colPos?.querySelectorAll("img.source-sentiment-v2-logo").length || 0;
  const renderedNeutral = colNeu?.querySelectorAll("img.source-sentiment-v2-logo").length || 0;
  const renderedNegative = colNeg?.querySelectorAll("img.source-sentiment-v2-logo").length || 0;
  console.log("SOURCE_SENTIMENT_V2_LAYOUT_FIXED", {
    positiveCount: pos.length,
    neutralCount: neu.length,
    negativeCount: neg.length,
    renderedPositive,
    renderedNeutral,
    renderedNegative
  });

  const hasLogos = grid.querySelectorAll("img.source-sentiment-v2-logo").length > 0;
  if (!hasLogos && empty) {
    setDebugSection("sourceSentiment", "fallback-empty", { rows: countOf(state.splitSnapshots?.sourceSentiment?.rows) });
    const updatedAt = formatLastUpdated(state.fallbackUpdatedAt || state.sentimentStaleDataTimestampISO || state.bootstrapGeneratedAt);
    empty.textContent = updatedAt && state.usingFallbackSnapshot
      ? `${SNAPSHOT_FALLBACK_MESSAGE} Last updated: ${updatedAt}`
      : (state.sentimentData?.message || EMPTY_STATE_MESSAGE);
    pushDegradedReason("sourceSentiment", empty.textContent);
  } else {
    setDebugSection("sourceSentiment", countOf(state.splitSnapshots?.sourceSentiment?.rows) ? "snapshot:source-sentiment" : "live-or-bootstrap", { logos: grid.querySelectorAll("img.source-sentiment-v2-logo").length });
  }
  empty?.classList.toggle("show", !hasLogos);
  state.lastLeaderboardAt = Date.now();
}

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

const INDUSTRY_ICON_MAP = {
  Healthcare: "/logo/industry-healthcare.svg",
  Finance: "/logo/industry-finance.svg",
  Technology: "/logo/industry-technology.svg",
  "Information Tech": "/logo/industry-technology.svg",
  Energy: "/logo/industry-energy.svg",
  Utilities: "/logo/industry-utilities.svg",
  Communication: "/logo/industry-communication.svg",
  Manufacturing: "/logo/industry-manufacturing.svg",
  "Real Estate": "/logo/industry-realestate.svg",
  Materials: "/logo/industry-materials.svg"
};
const GENERIC_INDUSTRY_ICON = "/logo/industry-generic.svg";
const industryIconFor = (name = "") =>
  INDUSTRY_ICON_MAP[name] || GENERIC_INDUSTRY_ICON;
const INDUSTRY_LABEL_MAP = {
  Healthcare: "Health",
  Finance: "Finance",
  Technology: "Tech",
  "Information Tech": "Tech",
  Energy: "Energy",
  Utilities: "Infra",
  Communication: "Comms",
  Manufacturing: "Mfg",
  "Real Estate": "Real Estate",
  Materials: "Materials"
};
const industryLabelFor = (name = "") =>
  INDUSTRY_LABEL_MAP[name] || "Other";

const INDUSTRY_KEYWORDS = {
  Energy: ["energy","oil","gas","petrol","diesel","fuel","renewable","solar","wind","power"],
  Utilities: ["utilities","grid","electricity","power supply","water","pipeline"],
  Communication: ["telecom","communication","wireless","mobile","broadband","5g","network"],
  Healthcare: ["health","hospital","pharma","pharmaceutical","medical","vaccine","drug"],
  Finance: ["bank","banking","finance","financial","nbfc","loan","lending","stock","market"],
  Technology: ["technology","tech","ai","artificial intelligence","software","it","chip","semiconductor"],
  Manufacturing: ["manufacturing","factory","industrial","production","auto","automobile","vehicle"],
  "Real Estate": ["real estate","property","housing","realty","construction","builder"],
  "Information Tech": ["information tech","information technology","it services","software services"],
  Materials: ["materials","steel","metal","cement","mining","coal","aluminium"]
};

function scoreIndustries(){
  const rows = INDUSTRY_GROUPS.map(name => ({ name, pos:0, neg:0, neu:0, n:0 }));
  const byName = new Map(rows.map(r => [r.name, r]));

  const source = getLeaderboardArticles();
  const inScope = state.category === USA_CATEGORY
    ? source.filter((a) => USA_SECTION_SOURCES.has(normalizeSourceName(a.source || "")))
    : source;
  inScope.forEach(a => {
    const text = `${a.title} ${a.description}`.toLowerCase();
    const category = String(a.category || "").toLowerCase();
    const sourceIndustry = String(a.industry || "").trim();
    const matches = sourceIndustry && byName.has(sourceIndustry)
      ? [byName.get(sourceIndustry)]
      : rows.filter(r => {
        const keywords = INDUSTRY_KEYWORDS[r.name] || [];
        return keywords.some(k => text.includes(k)) || (category && keywords.some(k => category.includes(k)));
      });
    if (!matches.length) return;
    matches.forEach(r => {
      const sentiment = getSafeSentiment(a.sentiment);
      r.n++;
      r.pos += sentiment.posP;
      r.neg += sentiment.negP;
      r.neu += sentiment.neuP;
    });
  });

  return rows
    .map(r => {
      const n = Math.max(1, r.n);
      const pos = r.pos/n, neg = r.neg/n, neu = r.neu/n;
      const bias = pos - neg;
      return { name:r.name, pos, neg, neu, bias, n:r.n };
    })
    .filter(r => r.n > 0)
    .sort((a,b) => {
      if (Math.abs(b.bias) !== Math.abs(a.bias))
        return Math.abs(b.bias) - Math.abs(a.bias);
      return (b.n || 0) - (a.n || 0);
    });
}

function renderPotusTopicBoard(){
  const grid = $("#industryBoard");
  if (!grid) return;
  const colPos = grid.querySelector(".col-pos");
  const colNeu = grid.querySelector(".col-neu");
  const colNeg = grid.querySelector(".col-neg");
  const empty = grid.querySelector(".board-empty");
  [colPos, colNeu, colNeg].forEach(c => c.innerHTML = "");

  const articles = (state.articles || []).filter(isPotusArticle);
  const buckets = new Map();
  articles.forEach((article) => {
    const name = classifyPotusTopic(article);
    const row = buckets.get(name) || { name, pos: 0, neg: 0, neu: 0, n: 0 };
    row.n += 1;
    row.pos += article.sentiment?.posP || 0;
    row.neg += article.sentiment?.negP || 0;
    row.neu += article.sentiment?.neuP || 0;
    buckets.set(name, row);
  });

  const scored = [...buckets.values()].map((row) => {
    const n = Math.max(1, row.n);
    return { ...row, bias: (row.pos / n) - (row.neg / n) };
  }).sort((a,b) => Math.abs(b.bias) - Math.abs(a.bias));

  if (!scored.length){
    if (empty) {
      const updatedAt = formatLastUpdated(state.fallbackUpdatedAt || state.bootstrapGeneratedAt);
      empty.textContent = updatedAt && state.usingFallbackSnapshot
        ? `${SNAPSHOT_FALLBACK_MESSAGE} Last updated: ${updatedAt}`
        : EMPTY_STATE_MESSAGE;
    }
    empty?.classList.add("show");
    return;
  }

  const pos = scored.filter((x) => x.bias > 3).slice(0, 3);
  const neg = scored.filter((x) => x.bias < -3).slice(0, 3);
  const neu = scored.filter((x) => !pos.includes(x) && !neg.includes(x)).slice(0, 3);
  const TIERS = [0.3, 0.55, 0.8];
  const place = (col, list) => list.forEach((item, idx) => {
    const badge = document.createElement("div");
    badge.className = "badge icon-badge";
    badge.style.left = "50%";
    badge.style.top = `${TIERS[Math.min(idx, TIERS.length - 1)] * 100}%`;
    const caption = document.createElement("span");
    caption.className = "icon-label";
    caption.textContent = item.name;
    badge.appendChild(caption);
    col.appendChild(badge);
  });

  place(colPos, pos);
  place(colNeu, neu);
  place(colNeg, neg);
  empty?.classList.toggle("show", grid.querySelectorAll(".badge").length === 0);
}

function renderIndustryBoard(){
  const grid = $("#industryBoard");
  if (!grid) return;
  if (state.category === POTUS_CATEGORY){
    const title = document.querySelector("#industryWrap .leader-title");
    if (title) title.textContent = "POTUS Topic Sentiment";
    const subtitle = document.querySelector("#industryWrap .leader-sub");
    if (subtitle) subtitle.textContent = "Updated every hour";
    const empty = grid.querySelector(".board-empty");
    if (empty) empty.textContent = "Waiting for enough POTUS-tagged news.";
    renderPotusTopicBoard();
    return;
  }
  const title = document.querySelector("#industryWrap .leader-title");
  if (title) title.textContent = "Industry Sentiment";
  const subtitle = document.querySelector("#industryWrap .leader-sub");
  if (subtitle) subtitle.textContent = "Updated every hour";
  const emptyText = grid.querySelector(".board-empty");
  if (emptyText) emptyText.textContent = state.sentimentData?.message || EMPTY_STATE_MESSAGE;
  const colPos = grid.querySelector(".col-pos");
  const colNeu = grid.querySelector(".col-neu");
  const colNeg = grid.querySelector(".col-neg");
  const empty = grid.querySelector(".board-empty");
  [colPos, colNeu, colNeg].forEach(c => c.innerHTML = "");

  const minTaggedArticles = Number(state.sentimentData?.industryBuckets?.minTaggedArticles || 2);
  const taggedCounts = state.sentimentData?.industryBuckets?.bucketTaggedCounts || { pos: 0, neu: 0, neg: 0 };
  const hasEnoughTagged = Number(taggedCounts.pos || 0) >= minTaggedArticles
    || Number(taggedCounts.neu || 0) >= minTaggedArticles
    || Number(taggedCounts.neg || 0) >= minTaggedArticles;
  const splitIndustryRows = safeArray(state.splitSnapshots?.industrySentiment?.rows);

  if (splitIndustryRows.length){
    const toBucketRows = (items = []) => ({
      pos: safeArray(items).filter((item) => Number(item?.bias ?? (Number(item?.pos || 0) - Number(item?.neg || 0))) > 3).slice(0, 3),
      neu: safeArray(items).filter((item) => Math.abs(Number(item?.bias ?? (Number(item?.pos || 0) - Number(item?.neg || 0)))) <= 3).slice(0, 3),
      neg: safeArray(items).filter((item) => Number(item?.bias ?? (Number(item?.pos || 0) - Number(item?.neg || 0))) < -3).slice(0, 3)
    });
    const buckets = toBucketRows(splitIndustryRows);
    const place = (col, list) => list.forEach((item, idx) => {
      const badge = document.createElement("div");
      badge.className = "badge icon-badge";
      badge.style.left = "50%";
      badge.style.top = `${[0.3, 0.55, 0.8][Math.min(idx, 2)] * 100}%`;
      const img = document.createElement("img");
      img.src = industryIconFor(item.name || item.industry || "");
      img.alt = industryLabelFor(item.name || item.industry || "");
      const caption = document.createElement("span");
      caption.className = "icon-label";
      caption.textContent = industryLabelFor(item.name || item.industry || "");
      badge.appendChild(img);
      badge.appendChild(caption);
      col.appendChild(badge);
    });
    place(colPos, buckets.pos);
    place(colNeu, buckets.neu);
    place(colNeg, buckets.neg);
    empty?.classList.toggle("show", grid.querySelectorAll(".badge").length === 0);
    if (grid.querySelectorAll(".badge").length > 0){
      setDebugSection("industrySentiment", "snapshot:industry-sentiment", { rows: splitIndustryRows.length });
      return;
    }
  }

  if (!hasEnoughTagged) {
    const fallbackRows = safeArray(
      state.splitSnapshots?.industrySentiment?.rows ||
      state.bootstrapUsa?.industryLeaderboard ||
      state.bootstrapIndustryLeaderboard ||
      state.sentimentData?.industrySentiment
    );
    if (fallbackRows.length){
      const toBucketRows = (items = []) => ({
        pos: safeArray(items).filter((item) => Number(item?.bias ?? (Number(item?.pos || 0) - Number(item?.neg || 0))) > 3).slice(0, 3),
        neu: safeArray(items).filter((item) => Math.abs(Number(item?.bias ?? (Number(item?.pos || 0) - Number(item?.neg || 0)))) <= 3).slice(0, 3),
        neg: safeArray(items).filter((item) => Number(item?.bias ?? (Number(item?.pos || 0) - Number(item?.neg || 0))) < -3).slice(0, 3)
      });
      const fallbackBuckets = toBucketRows(fallbackRows);
      const placeFallbackIcons = (col, list) => {
        list.forEach((item, idx) => {
          const badge = document.createElement("div");
          badge.className = "badge icon-badge";
          badge.style.left = "50%";
          badge.style.top = `${[0.3, 0.55, 0.8][Math.min(idx, 2)] * 100}%`;
          const img = document.createElement("img");
          img.src = industryIconFor(item.name || item.industry || "");
          img.alt = industryLabelFor(item.name || item.industry || "");
          img.loading = "lazy";
          const caption = document.createElement("span");
          caption.className = "icon-label";
          caption.textContent = industryLabelFor(item.name || item.industry || "");
          badge.appendChild(img);
          badge.appendChild(caption);
          col.appendChild(badge);
        });
      };
      placeFallbackIcons(colPos, fallbackBuckets.pos);
      placeFallbackIcons(colNeu, fallbackBuckets.neu);
      placeFallbackIcons(colNeg, fallbackBuckets.neg);
      empty?.classList.toggle("show", grid.querySelectorAll(".badge").length === 0);
      if (grid.querySelectorAll(".badge").length > 0) return;
    }
    if (empty) {
      const updatedAt = formatLastUpdated(state.fallbackUpdatedAt || state.sentimentStaleDataTimestampISO || state.bootstrapGeneratedAt);
      empty.textContent = updatedAt && state.usingFallbackSnapshot
        ? `${SNAPSHOT_FALLBACK_MESSAGE} Last updated: ${updatedAt}`
        : "Collecting enough industry-tagged articles";
      pushDegradedReason("industrySentiment", empty.textContent);
      setDebugSection("industrySentiment", "fallback-empty", { hasEnoughTagged, taggedCounts });
    }
    empty?.classList.add("show");
    return;
  }

  const dedupeByLabel = (list = []) => {
    const seen = new Set();
    return (list || []).filter((item) => {
      const label = industryLabelFor(item?.name || "");
      if (!label || label === "Other") return false;
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    }).slice(0, 3);
  };

  const pos = dedupeByLabel(state.sentimentData?.industryBuckets?.pos || []);
  const neu = dedupeByLabel(state.sentimentData?.industryBuckets?.neu || []);
  const neg = dedupeByLabel(state.sentimentData?.industryBuckets?.neg || []);

  const TIERS = [0.3, 0.55, 0.8];
  const placeIcons = (col, list) => {
    let idx = 0;
    list.forEach(item => {
      const badge = document.createElement("div");
      badge.className = "badge icon-badge";
      const topPct = TIERS[Math.min(idx,TIERS.length-1)] * 100;
      badge.style.left = "50%";
      badge.style.top  = `${topPct}%`;
      const img = document.createElement("img");
      const label = industryLabelFor(item.name);
      img.src = label === "Other" ? GENERIC_INDUSTRY_ICON : industryIconFor(item.name);
      img.alt = label;
      img.loading = "lazy";
      img.addEventListener("error", () => {
        img.src = GENERIC_INDUSTRY_ICON;
      });
      const caption = document.createElement("span");
      caption.className = "icon-label";
      caption.textContent = label;
      badge.appendChild(img);
      badge.appendChild(caption);
      col.appendChild(badge);
      idx++;
    });
  };

  placeIcons(colPos, pos);
  placeIcons(colNeu, neu);
  placeIcons(colNeg, neg);

  const hasBadges = grid.querySelectorAll(".badge").length > 0;
  empty?.classList.toggle("show", !hasBadges);
  if (hasBadges){
    setDebugSection("industrySentiment", "live-or-bootstrap", { hasEnoughTagged, taggedCounts });
  }
}

/* glue */
function renderAll(){
  renderPoliticalIntelligence();
  if (state.category === POLITICAL_INTEL_CATEGORY) return;
  updateBriefingDateTime();
  renderHero();
  renderPinned();
  renderNews();
  $("#chooseTopicsBtn")?.addEventListener("click", openTopicPicker);
  renderDaily();
  renderTopics();
  renderIndiaSentiment();
  renderWorldSentiment();
  renderSourceSentimentV2();
  const leaderTitle = document.querySelector("#leaderWrap .leader-title");
  if (leaderTitle) leaderTitle.textContent = state.category === POTUS_CATEGORY ? "POTUS Source Sentiment" : "News Source Sentiment";
  renderIndustryBoard();
  attachSentimentTooltips();
  attachInfoButtons();
  attachShareButtons();
  $("#year").textContent = new Date().getFullYear();
  updatePinButtons();
  updateActiveSources();
  renderDebugPanel();
}

function getSearchMatches(query){
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return (state.allArticles || []).filter(article => {
    const tags = Array.isArray(article.tags) ? article.tags.join(" ") : (article.tags || "");
    const haystack = [
      article.title,
      article.source,
      article.description,
      article.category,
      article.section,
      article.topic,
      tags
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
  }).slice(0, 8);
}
function renderSearchResults(){
  const panel = $("#searchResults");
  if (!panel) return;
  const query = $("#searchInput")?.value || "";
  const matches = getSearchMatches(query);
  if (!query.trim()){
    panel.classList.remove("show");
    panel.innerHTML = "";
    return;
  }
  if (!matches.length){
    panel.innerHTML = `<div class="search-result">No matching articles yet.</div>`;
    panel.classList.add("show");
    return;
  }
  panel.innerHTML = matches.map(article => {
    const context = getArticleContext(article);
    return `
      <div class="search-result" role="option" tabindex="0" data-link="${article.link}">
        <div class="search-thumb">
          ${safeImgTag(article.image || article.imageUrl, article.link, article.source, "search-thumb-img")}
        </div>
        <div class="search-body">
          <div class="search-title">${escapeHtml(article.title)}</div>
          <div class="search-meta">
            <span>${escapeHtml(article.source)}${renderCredibilityBadge(article, "inline")}</span>
            · <span>${formatArticleDate(article.publishedAt)}</span>
          </div>
          <div class="search-sentiment">
            ${renderSentiment(article.sentiment, true, context, "mini")}
          </div>
        </div>
      </div>`;
  }).join("");
  panel.classList.add("show");
  panel.querySelectorAll(".search-result").forEach(row => {
    if (row.dataset.bound) return;
    row.dataset.bound = "1";
    const handle = () => handleSearchResultClick(row.dataset.link || "");
    row.addEventListener("click", handle);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handle();
    });
  });
  attachSentimentTooltips();
}
function closeSearchResults(){
  const panel = $("#searchResults");
  if (!panel) return;
  panel.classList.remove("show");
}
function handleSearchResultClick(link){
  if (!link) return;
  const safeLink = (window.CSS && CSS.escape)
    ? CSS.escape(link)
    : link.replace(/"/g, '\\"');
  const target = document.querySelector(`[data-article-link="${safeLink}"]`);
  if (target){
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.open(link, "_blank", "noopener");
  }
  closeSearchResults();
}

function renderTopicPickerOptions(){
  const wrap = $("#topicPickerList");
  if (!wrap) return;
  wrap.innerHTML = TOPIC_OPTIONS.map(topic => {
    const value = normalizePreferredTopic(topic);
    return `
      <label class="topic-chip">
        <input type="checkbox" value="${value}">
        ${topic}
      </label>`;
  }).join("");
}
function syncTopicPickerSelections(){
  const selected = new Set((state.preferredTopics || []).map(normalizePreferredTopic));
  $("#topicPickerList")?.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.checked = selected.has(input.value);
  });
}
function openTopicPicker(){
  const modal = $("#topicPickerModal");
  if (!modal) return;
  syncTopicPickerSelections();
  modal.showModal();
}

/* interactions */
function moveSentimentControls(){
  const dock = $("#sentimentDock");
  const controls = $(".news-section .controls");
  if (dock && controls && controls.parentElement !== dock){
    dock.appendChild(controls);
  }
}
$$(".chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", () => {
    $$(".chip[data-sent]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent;
    loadAll();
  });
});
$("#expChip")?.addEventListener("click", () => {
  state.experimental = !state.experimental;
  $("#expChip").classList.toggle("active", state.experimental);
  loadAll();
});
$("#searchForm")?.addEventListener("submit", (e)=>{
  e.preventDefault();
  renderSearchResults();
});
$("#searchInput")?.addEventListener("input", (e)=>{
  renderSearchResults();
  if (!e.target.value.trim()) closeSearchResults();
});
$("#searchInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Escape"){
    closeSearchResults();
    e.target.blur();
  }
});
document.addEventListener("click", (e) => {
  const wrap = $(".gn-search-wrap");
  if (!wrap || wrap.contains(e.target)) return;
  closeSearchResults();
});

const sentimentSheetOverlay = $("#sentimentSheetOverlay");
const sentimentSheetClose = $("#sentimentSheetClose");
sentimentSheetOverlay?.addEventListener("click", closeSentimentSheet);
sentimentSheetClose?.addEventListener("click", closeSentimentSheet);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSentimentSheet();
});

/* pinned topic input wiring */
const pinnedInput  = $("#pinnedInput");
const pinnedAddBtn = $("#pinnedAddBtn");

function handlePinnedAdd(){
  if (!pinnedInput) return;
  const value = pinnedInput.value.trim();
  if (!value) return;
  const pins = getPins();
  if (pins.length >= 2){
    showPinToast("Limit reached (2). Unpin one first.");
    pinnedInput.value = "";
    return;
  }
  const exists = pins.some(
    pin => pin.type === "topic" && pin.value.toLowerCase() === value.toLowerCase()
  );
  if (exists){
    pinnedInput.value = "";
    return;
  }
  const usedLinks = new Set(
    pins.filter(pin => pin.type === "article").map(pin => pin.value)
  );
  const match = findLatestTopicMatch(value, state.articles || [], usedLinks);
  pins.push({
    type: "topic",
    value,
    lastArticle: match ? snapshotArticle(match) : null,
    lastSeenAt: match ? Date.now() : null
  });
  savePins(pins);
  renderPinnedChips();
  renderPinned();
  updatePinButtons();
  pinnedInput.value = "";
}

pinnedAddBtn?.addEventListener("click", handlePinnedAdd);
pinnedInput?.addEventListener("keydown", (e)=>{
  if (e.key === "Enter"){
    e.preventDefault();
    handlePinnedAdd();
  }
});

$$(".gn-tabs .tab[data-cat]").forEach(tab=>{
  tab.addEventListener("click", () => {
    $$(".gn-tabs .tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const category = tab.dataset.cat;
    if (category === "foryou" && !(state.preferredTopics || []).length){
      openTopicPicker();
      return;
    }
    state.category = category;
    loadAll();
  });
});

function setDefaultHomeTab(){
  const homeTab = $('.gn-tabs .tab[data-cat="home"]');
  if (!homeTab) return;
  $$(".gn-tabs .tab").forEach(t => t.classList.remove("active"));
  homeTab.classList.add("active");
  state.category = "home";
}
/* Sign-in */
const modal = $("#signinModal");
$("#avatarBtn")?.addEventListener("click", () => {
  $("#prefName").value = state.profile?.name || "";
  $("#prefCity").value = state.profile?.city || "";
  const interests = new Set(state.profile?.interests || ["india"]);
  modal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = interests.has(cb.value);
  });
  modal.showModal();
});
$("#savePrefs")?.addEventListener("click", (e)=>{
  e.preventDefault();
  const name  = $("#prefName").value.trim();
  const city  = $("#prefCity").value.trim();
  const inter = [...modal.querySelectorAll('input[type="checkbox"]:checked')]
                .map(cb => cb.value);
  saveProfile({
    name,
    city,
    interests: inter,
    pinnedTopics: getTopicPins()
  });
  modal.close();
  const forYouTab = $('.gn-tabs .tab[data-cat="foryou"]');
  if (forYouTab) forYouTab.click();
});

/* Help + Settings */
const helpModal = $("#helpModal");
const settingsModal = $("#settingsModal");
const credibilityToggle = $("#credibilityToggle");
const pricingDrawer = $("#pricingDrawer");
const pricingOverlay = $("#pricingOverlay");
const pricingEntry = $("#pricingEntry");
const pricingClose = $("#pricingClose");
const pricingDemo = $("#pricingDemo");
$("#helpBtn")?.addEventListener("click", () => helpModal?.showModal());
$("#settingsBtn")?.addEventListener("click", () => {
  settingsModal?.querySelectorAll('input[name="theme"]').forEach(input => {
    input.checked = input.value === state.theme;
  });
  if (credibilityToggle) credibilityToggle.checked = state.showCredibilityBadges;
  settingsModal?.showModal();
});
settingsModal?.addEventListener("change", (e) => {
  if (e.target?.name === "theme") {
    state.theme = e.target.value;
    localStorage.setItem("theme", state.theme);
    applyTheme();
    return;
  }
  if (e.target?.id === "credibilityToggle") {
    saveCredibilitySetting(e.target.checked);
    renderAll();
  }
});
const openPricing = () => {
  if (!pricingDrawer) return;
  pricingDrawer.classList.add("open");
  pricingDrawer.setAttribute("aria-hidden", "false");
  pricingOverlay?.classList.add("show");
};
const closePricing = () => {
  pricingDrawer?.classList.remove("open");
  pricingDrawer?.setAttribute("aria-hidden", "true");
  pricingOverlay?.classList.remove("show");
};
pricingEntry?.addEventListener("click", openPricing);
pricingClose?.addEventListener("click", closePricing);
pricingOverlay?.addEventListener("click", closePricing);
pricingDemo?.addEventListener("click", (event) => {
  event.preventDefault();
  window.location.href = PRICING_MAILTO;
});

/* Topic picker */
$("#saveTopics")?.addEventListener("click", (e) => {
  e.preventDefault();
  const selected = [...$("#topicPickerList")?.querySelectorAll('input[type="checkbox"]:checked') || []]
    .map(input => input.value);
  savePreferredTopics(selected);
  $("#topicPickerModal")?.close();
  const active = $(".gn-tabs .tab.active");
  if (active && ["foryou","following"].includes(active.dataset.cat)){
    state.category = active.dataset.cat;
    loadAll();
  }
});

/* boot */
document.getElementById("year").textContent = new Date().getFullYear();
applyTheme();
renderTopicPickerOptions();
moveSentimentControls();
renderPinnedChips();
updateBriefingDateTime();
setDefaultHomeTab();
getWeather();
applyBootstrapCache();
applyCachedContent();
applyHomepageCache();
loadMarkets();
loadVisitorStats();
void (async () => {
  await applyStaticHomepageSnapshot();
  if (!hasCachedContent) await applyStaticBootstrapSnapshot();
  await loadSplitSnapshots();
  await refreshBootstrapSnapshot();
  if (!hasCachedContent){
    await loadAll();
  } else {
    void loadAll();
  }
})();
checkHealthWithRetry();
if (!hasCachedContent) renderAll();

if ("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/* periodic refresh */
setInterval(() => {
  void refreshBootstrapSnapshot().then((updated) => {
    if (!hasCachedContent || updated) loadAll();
  });
}, 1000 * 60 * 5);
setInterval(loadMarkets, 1000 * 60 * 2);
setInterval(updateActiveSources, 1000 * 60);
setInterval(updateBriefingDateTime, 1000 * 60);
setInterval(() => {
  if (Date.now() - state.lastLeaderboardAt > 1000 * 60 * 60)
    renderSourceSentimentV2();
}, 15 * 1000);

/* keep badge positions responsive */
let resizeRaf;
window.addEventListener("resize", () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    renderSourceSentimentV2();
    renderIndustryBoard();
  });
});
