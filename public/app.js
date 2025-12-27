/* helpers */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
const PIN_STORAGE_KEY = "i360_pins_v2";
const LEGACY_PIN_STORAGE_KEY = "i360_pins";
async function fetchJSON(u){
  const r = await fetch(u);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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

const clearbit = (d) => d ? `https://logo.clearbit.com/${d}` : "";
const logoFor = (link = "", source = "") => {
  const mapDom = LOGO_DOMAIN_MAP[source?.trim()] || "";
  const d = mapDom || domainFromUrl(link) || "";
  if (LOCAL_LOGOS[d]) return LOCAL_LOGOS[d];
  return clearbit(d);
};

const PLACEHOLDER =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='260'>
       <rect width='100%' height='100%' fill='#e5edf7'/>
       <text x='50%' y='48%' text-anchor='middle'
             font-family='sans-serif' font-weight='700'
             fill='#8aa3c4' font-size='18'>News</text>
       <image href='cid:logo' x='168' y='130' width='64' height='64' preserveAspectRatio='xMidYMid meet'/>
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
const isLikelyImageUrl = (url = "") => {
  const cleaned = String(url || "").trim();
  if (!cleaned) return false;
  if (cleaned.length > 220) return false;
  if (/\s/.test(cleaned)) return false;
  const lower = cleaned.toLowerCase();
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

function formatArticleDate(value){
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = ARTICLE_DATE_FORMATTER.formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  if (!parts.month || !parts.day || !parts.year) return "";
  return `${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute} IST`;
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
  markets: ["market","markets","stocks","shares","sensex","nifty","trading"],
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
function renderSentiment(s, slim = false, context = "", variant = ""){
  const pos = Math.max(0, Number(s.posP ?? s.pos ?? 0));
  const neu = Math.max(0, Number(s.neuP ?? s.neu ?? 0));
  const neg = Math.max(0, Number(s.negP ?? s.neg ?? 0));
  const classes = ["sentiment", slim ? "slim" : "", variant].filter(Boolean).join(" ");
  return `
    <div class="${classes}" data-context="${escapeHtml(context)}" data-pos="${pos}" data-neu="${neu}" data-neg="${neg}">
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

/* state */
const state = {
  category: "home",
  filter: "all",
  experimental: false,
  query: "",
  articles: [],
  allArticles: [],
  indiaArticles: [],
  topics: [],
  pins: loadPins(),
  profile: loadProfile(),
  theme: localStorage.getItem("theme") || "light",
  preferredTopics: loadPreferredTopics(),
  hero: { index: 0, timer: null, pause: false },
  lastLeaderboardAt: 0
};

function loadProfile(){
  try{
    const raw = JSON.parse(localStorage.getItem("i360_profile") || "{}");
    if (!Array.isArray(raw.pinnedTopics)) raw.pinnedTopics = [];
    return raw;
  }catch{
    return { pinnedTopics: [] };
  }
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
const todayStr = () =>
  new Date().toLocaleDateString(undefined,{
    weekday:"long", day:"numeric", month:"long"
  });

async function getWeather(){
  try{
    const coords = await new Promise((res)=>{
      if (!navigator.geolocation)
        return res({ latitude:19.0760, longitude:72.8777 });
      navigator.geolocation.getCurrentPosition(
        p => res({ latitude:p.coords.latitude, longitude:p.coords.longitude }),
        () => res({ latitude:19.0760, longitude:72.8777 })
      );
    });

    const wx = await fetchJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}` +
      `&longitude=${coords.longitude}&current=temperature_2m,weather_code&timezone=auto`
    );

    let city = state.profile?.city || "Your area";
    if (!state.profile?.city){
      try{
        const rev = await fetchJSON(
          `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${coords.latitude}` +
          `&longitude=${coords.longitude}&language=en`
        );
        city = rev?.results?.[0]?.name || city;
      }catch{}
    }

    const t = Math.round(wx?.current?.temperature_2m ?? 0);
    const code = wx?.current?.weather_code ?? 0;
    const icon = code>=0 && code<3 ? "🌙" : (code<50 ? "⛅" : "🌧️");

    $("#weatherCard").innerHTML =
      `<div class="wx-icon">${icon}</div>
       <div>
         <div class="wx-city">${city}</div>
         <div class="wx-temp">${t}°C</div>
       </div>`;
  }catch{
    $("#weatherCard").textContent = "Weather unavailable";
  }
}

/* markets – Grid 3 ticker */
async function loadMarkets(){
  try{
    const data = await fetchJSON("/api/markets");
    const el = $("#marketTicker");
    const updatedAt = new Date(data.updatedAt || Date.now());
    const updatedLabel = updatedAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    const updatedDate = updatedAt.toLocaleDateString();
    const statusText = `Website updated on ${updatedDate} · ${updatedLabel}`;
    const updatedEl = $("#updatedAt");
    if (updatedEl){
      updatedEl.textContent = statusText;
    }

    const defaults = [
      { symbol: "^BSESN", pretty: "BSE Sensex" },
      { symbol: "^NSEI", pretty: "NSE Nifty" },
      { symbol: "GC=F", pretty: "Gold" },
      { symbol: "CL=F", pretty: "Crude Oil" },
      { symbol: "USDINR=X", pretty: "USD/INR" }
    ];
    const bySymbol = new Map((data.quotes || []).map(q => [q.symbol, q]));

    const items = defaults.map(d => {
      const q = bySymbol.get(d.symbol) || {};
      const price = (q.price ?? "—");
      const pct = Number(q.changePercent ?? 0);
      const cls = pct >= 0 ? "up" : "down";
      const sign = pct >= 0 ? "▲" : "▼";
      const pctTxt = isFinite(pct)
        ? `${sign} ${Math.abs(pct).toFixed(2)}%`
        : "—";
      const changeTxt = typeof q.change === "number"
        ? q.change.toLocaleString(undefined,{ maximumFractionDigits:2 })
        : null;
      const pTxt = typeof price === "number"
        ? price.toLocaleString(undefined,{ maximumFractionDigits:2 })
        : price;
      return `
        <div class="qpill">
          <span class="sym">${d.pretty || q.pretty || q.symbol || d.symbol}</span>
          <span class="price">${pTxt}${changeTxt ? ` (${changeTxt})` : ""}</span>
          <span class="chg ${cls}">${pctTxt}</span>
        </div>`;
    }).join("");
    el.innerHTML = `
      <div class="ticker-row" role="list">${items || ""}</div>`;
  }catch{
    // If API fails, show static labels so the bar is never empty
    const fallback = [
      "BSE Sensex","NSE Nifty","Gold","Crude Oil","USD/INR"
    ];
    const now = new Date();
    const fallbackStatus = `Website updated on ${now.toLocaleDateString()} · ${now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}`;
    const updatedEl = $("#updatedAt");
    if (updatedEl){
      updatedEl.textContent = fallbackStatus;
    }
    $("#marketTicker").innerHTML = `
      <div class="ticker-row" role="list">${fallback.map(n => `
        <div class="qpill">
          <span class="sym">${n}</span>
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

/* load news + topics */
async function loadAll(){
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  if (state.category && !["home","foryou","local","showcase","following"].includes(state.category))
    qs.set("category", state.category);

  const needsIndiaFetch = !["home", "india"].includes(state.category);
  const indiaQs = new URLSearchParams();
  if (state.filter !== "all") indiaQs.set("sentiment", state.filter);
  if (state.experimental) indiaQs.set("experimental", "1");
  if (needsIndiaFetch) indiaQs.set("category", "india");

  const [news, topics, india] = await Promise.all([
    fetchJSON(`/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`),
    fetchJSON(`/api/topics${state.experimental ? "?experimental=1" : ""}`),
    needsIndiaFetch
      ? fetchJSON(`/api/news${indiaQs.toString() ? ("?" + indiaQs.toString()) : ""}`)
      : Promise.resolve(null)
  ]);

  state.allArticles = news.articles || [];
  state.articles = state.allArticles.slice();
  state.topics   = selectTrendingTopics(topics.topics || [], state.allArticles);
  if (needsIndiaFetch){
    state.indiaArticles = india?.articles || [];
  } else {
    state.indiaArticles = state.allArticles.filter(a => a.category === "india");
  }

  if (state.category === "local" && state.profile?.city){
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

  syncPinsWithArticles();
  renderPinnedChips();
  renderAll();
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

function pickRelatedArticles(featured, candidates = [], { maxItems = 4, minItems = 2, prevLinks = new Set() } = {}){
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

  const pushUnique = (article, allowPrev, allowSameSource) => {
    if (!article || usedLinks.has(article.link)) return false;
    if (!allowPrev && prevLinks.has(article.link)) return false;
    if (!allowSameSource && usedSources.has(article.source)) return false;
    selected.push(article);
    usedLinks.add(article.link);
    if (article.source) usedSources.add(article.source);
    return true;
  };

  primary.forEach(article => {
    if (selected.length >= maxItems) return;
    pushUnique(article, false, false);
  });
  primary.forEach(article => {
    if (selected.length >= maxItems) return;
    pushUnique(article, true, false);
  });
  fallback.forEach(article => {
    if (selected.length >= maxItems) return;
    pushUnique(article, false, true);
  });
  fallback.forEach(article => {
    if (selected.length >= maxItems) return;
    pushUnique(article, true, true);
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
    ? pickRelatedArticles(featured, relatedCandidates, { maxItems: 4, minItems: 2, prevLinks })
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
    related = pickRelatedArticles(featured, selectedMatches, { maxItems: 4, minItems: 2, prevLinks });
    if (related.length < 2){
      const fallback = sortByPublishedDesc(candidates).filter(article => article.link !== featured.link);
      const supplemental = pickRelatedArticles(featured, fallback, { maxItems: 4, minItems: 2, prevLinks });
      related = supplemental.length ? supplemental : related;
    }
  }

  return { mode: "Most Engaged", featured, related };
}

function buildHeroSlides(articles = []){
  const modes = ["Recent News", "Most Engaged", "Recent News", "Most Engaged"];
  const slides = [];
  let prevLinks = new Set();

  modes.forEach(mode => {
    const cluster = mode === "Recent News"
      ? buildRecentCluster(articles, prevLinks)
      : buildEngagedCluster(articles, prevLinks);
    if (!cluster.featured) return;
    slides.push(cluster);
    prevLinks = new Set([
      cluster.featured?.link,
      ...cluster.related.map(item => item.link)
    ].filter(Boolean));
  });

  return slides;
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

/* card renderers */
function card(a){
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener" data-article-link="${a.link}">
      <div class="news-side">
        ${safeImgTag(a.image, a.link, a.source, "thumb")}
        <div class="card-actions">
          <button class="pin-toggle" type="button" data-link="${a.link}" aria-pressed="false">Pin</button>
        </div>
      </div>
      <div class="news-body">
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="source">${a.source}</span>
          · <span class="meta-time">${formatArticleDate(a.publishedAt)}</span>
        </div>
        ${renderSentiment(a.sentiment, false, getArticleContext(a))}
      </div>
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
    return `
      <div class="row">
        ${topicLabel}
        <a class="row-title" href="${article.link}" target="_blank" rel="noopener">${article.title}</a>
        <div class="row-meta">
          <span class="source">${article.source}</span>
          · <span>${formatArticleDate(article.publishedAt)}</span>
        </div>
        ${ageLine}
        ${renderSentiment(article.sentiment, true, getArticleContext(article))}
      </div>`;
  }).join("");
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
  if (state.category === "following" && !(state.preferredTopics || []).length){
    list.innerHTML = `
      <div class="news-empty">
        Choose topics to build your Following feed.
        <div><button type="button" id="chooseTopicsBtn">Choose topics</button></div>
      </div>`;
    return;
  }
  list.innerHTML = state.articles.slice(4, 9).map(card).join("");
}
function renderDaily(){
  $("#daily").innerHTML =
    state.articles.slice(12, 18).map(card).join("");
}

/* HERO */
function renderHero(){
  const slides = buildHeroSlides(state.articles);
  const track = $("#heroTrack");
  const dots  = $("#heroDots");
  if (!slides.length){
    track.innerHTML = "";
    dots.innerHTML  = "";
    const modeLabel = $("#heroModeLabel");
    if (modeLabel) modeLabel.textContent = "";
    return;
  }
  track.innerHTML = slides.map(cluster => `
    <article class="hero-slide" data-mode="${cluster.mode}">
      <div class="hero-cluster">
        <div class="hero-featured">
          <a class="hero-featured-link" href="${cluster.featured.link}" target="_blank" rel="noopener" data-article-link="${cluster.featured.link}">
            <div class="hero-media">
              <div class="hero-img">${heroImgTag(cluster.featured)}</div>
            </div>
            <div class="hero-featured-body">
              <div class="hero-source">${escapeHtml(cluster.featured.source || "")}</div>
              <div class="hero-headline">${escapeHtml(cluster.featured.title || "")}</div>
              <div class="hero-time">${formatArticleDate(cluster.featured.publishedAt)}</div>
            </div>
          </a>
          <div class="hero-sentiment">${renderSentiment(cluster.featured.sentiment, true, getArticleContext(cluster.featured), "mini")}</div>
        </div>
        <div class="hero-related">
          ${cluster.related.map(item => `
            <div class="hero-related-item">
              <a href="${item.link}" target="_blank" rel="noopener" data-article-link="${item.link}">
                <div class="hero-source">${escapeHtml(item.source || "")}</div>
                <div class="hero-related-headline">${escapeHtml(item.title || "")}</div>
                <div class="hero-time">${formatArticleDate(item.publishedAt)}</div>
              </a>
              <div class="hero-sentiment">${renderSentiment(item.sentiment, true, getArticleContext(item), "mini")}</div>
            </div>`).join("")}
        </div>
      </div>
    </article>`).join("");

  dots.innerHTML = slides.map((_,i) =>
    `<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`
  ).join("");

  updateHero(0);
  hydrateHeroImages();
}
async function hydrateHeroImages(){
  const images = $$(".hero-slide img[data-hero-link]");
  if (!images.length) return;

  await Promise.all(
    images.map(async (img) => {
      if (!isFallbackLogo(img.src)) return;
      const link = decodeURIComponent(img.dataset.heroLink || "");
      if (!link) return;
      const ogImage = await fetchOgImage(link);
      if (!isLikelyImageUrl(ogImage)) return;
      img.src = ogImage;
      img.classList.remove("logo-thumb");
    })
  );
}
function updateHero(i){
  const n = $$("#heroTrack .hero-slide").length;
  if (!n) return;
  state.hero.index = (i + n) % n;
  $("#heroTrack").style.transform =
    `translateX(-${state.hero.index * 100}%)`;
  $$("#heroDots button").forEach((b,bi) =>
    b.classList.toggle("active", bi === state.hero.index)
  );
  const activeSlide = $$("#heroTrack .hero-slide")[state.hero.index];
  const modeLabel = $("#heroModeLabel");
  if (activeSlide && modeLabel){
    modeLabel.textContent = activeSlide.dataset.mode || "";
  }
}
function startHeroAuto(){
  stopHeroAuto();
  state.hero.timer = setInterval(()=>{
    if (!state.hero.pause) updateHero(state.hero.index + 1);
  }, 6000);
}
function stopHeroAuto(){
  if (state.hero.timer) clearInterval(state.hero.timer);
  state.hero.timer = null;
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

function getSourceInitials(source = ""){
  return source.split(/\s+/).slice(0,2).map(word => word[0] || "").join("").toUpperCase();
}
function renderTopicSourceLogos(matches = []){
  const sourceMap = new Map();
  matches.forEach(article => {
    if (!article?.source || sourceMap.has(article.source)) return;
    sourceMap.set(article.source, article.link || "");
  });
  const entries = [...sourceMap.entries()];
  const max = 5;
  const extra = Math.max(0, entries.length - max);
  const items = entries.slice(0, max).map(([source, link]) => {
    const logo = logoFor(link, source);
    const initials = getSourceInitials(source || "News");
    if (!logo){
      return `<span class="topic-logo-fallback" aria-label="${escapeHtml(source)}">${initials}</span>`;
    }
    return `<img class="topic-logo" src="${logo}" alt="${escapeHtml(source)}" loading="lazy"
      onerror="const span=document.createElement('span');span.className='topic-logo-fallback';span.textContent='${initials}';this.replaceWith(span);">`;
  }).join("");
  const extraBadge = extra ? `<span class="logo-count">+${extra}</span>` : "";
  return `<span class="topic-logos">${items}${extraBadge}</span>`;
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
function attachSentimentTooltips(){
  const tooltip = getSentimentTooltip();
  $$(".sentiment").forEach(el => {
    if (el.dataset.tooltipBound) return;
    el.dataset.tooltipBound = "1";
    el.addEventListener("mousemove", (event) => {
      const context = el.dataset.context || "";
      const pos = Number(el.dataset.pos || 0);
      const neg = Number(el.dataset.neg || 0);
      tooltip.textContent = buildSentimentExplanation(context, pos, neg);
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

function renderTopics(){
  $("#topicsList").innerHTML = state.topics.map(t => {
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
function renderSentimentTimeline({ sparkEl, summaryEl, titleEl, title, articles }){
  const now = Date.now();
  const fourHrs = 4 * 60 * 60 * 1000;
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

  const pts = buckets.map(b => {
    const n = Math.max(1, b.c);
    return {
      pos: Math.round(b.pos / n),
      neg: Math.round(b.neg / n),
      neu: Math.round(b.neu / n)
    };
  });

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
  return state.articles || [];
}

function renderIndiaSentiment(){
  renderSentimentTimeline({
    sparkEl: "#moodSpark",
    summaryEl: "#moodSummary",
    titleEl: "#moodIndiaTitle",
    title: "India's Sentiment",
    articles: getIndiaSentimentArticles()
  });
}

function renderWorldSentiment(){
  renderSentimentTimeline({
    sparkEl: "#moodWorldSpark",
    summaryEl: "#moodWorldSummary",
    titleEl: "#moodWorldTitle",
    title: formatSentimentTitle(getActiveCategoryLabel()),
    articles: getWorldSentimentArticles()
  });
}

/* ===== Sentiment Leaderboard (logic unchanged) ===== */
function computeLeaderboard(){
  const bySource = new Map();
  state.articles.forEach(a => {
    const key = (a.source || "").trim();
    if (!key) return;
    const s = bySource.get(key) || {
      n:0, pos:0, neg:0, neu:0, link:a.link
    };
    s.n++;
    s.pos += a.sentiment.posP;
    s.neg += a.sentiment.negP;
    s.neu += a.sentiment.neuP;
    s.link = a.link || s.link;
    bySource.set(key, s);
  });

  const arr = [...bySource.entries()].map(([src,v]) => {
    const n = Math.max(1, v.n);
    const pos = v.pos/n, neg = v.neg/n, neu = v.neu/n;
    const bias = pos - neg;
    const logo = logoFor(v.link, src);
    return { source:src, pos, neg, neu, bias, logo };
  }).filter(x => (x.pos + x.neg + x.neu) > 0.1);

  const pos = arr.filter(x => x.bias > 3)
    .sort((a,b) => b.bias - a.bias).slice(0,2);
  const neg = arr.filter(x => x.bias < -3)
    .sort((a,b) => a.bias - b.bias).slice(0,2);
  const neu = arr.slice()
    .sort((a,b) => Math.abs(a.bias) - Math.abs(b.bias))
    .slice(0,2);

  return { pos, neu, neg };
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

async function renderLeaderboard(){
  const grid = $("#leaderboard");
  if (!grid) return;
  const colPos = grid.querySelector(".col-pos");
  const colNeu = grid.querySelector(".col-neu");
  const colNeg = grid.querySelector(".col-neg");
  const empty = grid.querySelector(".board-empty");
  [colPos, colNeu, colNeg].forEach(c => c.innerHTML = "");

  const { pos, neu, neg } = computeLeaderboard();
  const TIERS = [0.35, 0.75];

  async function place(col, list){
    const results = await Promise.all(
      list.map(s => (s.logo ? loadImage(s.logo) : Promise.resolve(false)))
    );
    let idx = 0;
    results.forEach((ok, i) => {
      if (!ok) return;
      const s = list[i];
      const b = document.createElement("div");
      b.className = "badge";
      const topPct = TIERS[Math.min(idx,TIERS.length-1)] * 100;
      b.style.left = "50%";
      b.style.top  = `${topPct}%`;
      const img = document.createElement("img");
      img.src = s.logo;
      img.alt = s.source;
      img.loading = "lazy";
      img.addEventListener("error", () => {
        b.remove();
        empty?.classList.toggle("show", grid.querySelectorAll(".badge").length === 0);
      });
      b.appendChild(img);
      col.appendChild(b);
      idx++;
    });
  }

  await Promise.all([
    place(colPos, pos),
    place(colNeu, neu),
    place(colNeg, neg)
  ]);

  const hasBadges = grid.querySelectorAll(".badge").length > 0;
  empty?.classList.toggle("show", !hasBadges);

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

  state.articles.forEach(a => {
    const text = `${a.title} ${a.description}`.toLowerCase();
    const category = String(a.category || "").toLowerCase();
    const matches = rows.filter(r => {
      const keywords = INDUSTRY_KEYWORDS[r.name] || [];
      return keywords.some(k => text.includes(k)) || (category && keywords.some(k => category.includes(k)));
    });
    if (!matches.length) return;
    matches.forEach(r => {
      r.n++;
      r.pos += a.sentiment.posP;
      r.neg += a.sentiment.negP;
      r.neu += a.sentiment.neuP;
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

function renderIndustryBoard(){
  const grid = $("#industryBoard");
  if (!grid) return;
  const colPos = grid.querySelector(".col-pos");
  const colNeu = grid.querySelector(".col-neu");
  const colNeg = grid.querySelector(".col-neg");
  const empty = grid.querySelector(".board-empty");
  [colPos, colNeu, colNeg].forEach(c => c.innerHTML = "");

  const scored = scoreIndustries();
  if (!scored.length){
    empty?.classList.add("show");
    return;
  }

  const threshold = 2;
  const pos = scored.filter(x => x.bias > threshold).slice(0,3);
  const neg = scored.filter(x => x.bias < -threshold).slice(0,3);
  const neu = scored
    .filter(x => !pos.includes(x) && !neg.includes(x))
    .slice(0,3);

  const fillRemaining = (list, pool) => {
    pool.forEach(item => {
      if (list.length >= 3) return;
      if (list.includes(item)) return;
      list.push(item);
    });
  };
  const remaining = scored.filter(x => !pos.includes(x) && !neg.includes(x) && !neu.includes(x));
  fillRemaining(pos, remaining);
  fillRemaining(neu, remaining);
  fillRemaining(neg, remaining);

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
}

/* glue */
function renderAll(){
  $("#briefingDate").textContent = todayStr();
  renderHero();
  renderPinned();
  renderNews();
  $("#chooseTopicsBtn")?.addEventListener("click", openTopicPicker);
  renderDaily();
  renderTopics();
  renderIndiaSentiment();
  renderWorldSentiment();
  renderLeaderboard();
  renderIndustryBoard();
  attachSentimentTooltips();
  $("#year").textContent = new Date().getFullYear();
  updatePinButtons();
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
          ${safeImgTag(article.image, article.link, article.source, "search-thumb-img")}
        </div>
        <div class="search-body">
          <div class="search-title">${escapeHtml(article.title)}</div>
          <div class="search-meta">
            <span>${escapeHtml(article.source)}</span>
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
$("#heroPrev")?.addEventListener("click", () =>
  updateHero(state.hero.index - 1)
);
$("#heroNext")?.addEventListener("click", () =>
  updateHero(state.hero.index + 1)
);
$("#hero")?.addEventListener("mouseenter", () => { state.hero.pause = true; });
$("#hero")?.addEventListener("mouseleave", () => { state.hero.pause = false; });

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
$("#helpBtn")?.addEventListener("click", () => helpModal?.showModal());
$("#settingsBtn")?.addEventListener("click", () => {
  settingsModal?.querySelectorAll('input[name="theme"]').forEach(input => {
    input.checked = input.value === state.theme;
  });
  settingsModal?.showModal();
});
settingsModal?.addEventListener("change", (e) => {
  if (e.target?.name !== "theme") return;
  state.theme = e.target.value;
  localStorage.setItem("theme", state.theme);
  applyTheme();
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
$("#briefingDate").textContent = todayStr();
getWeather();
loadMarkets();
loadAll();
startHeroAuto();

/* periodic refresh */
setInterval(loadAll,     1000 * 60 * 5);
setInterval(loadMarkets, 1000 * 60 * 2);
setInterval(() => {
  if (Date.now() - state.lastLeaderboardAt > 1000 * 60 * 60)
    renderLeaderboard();
}, 15 * 1000);

/* keep badge positions responsive */
let resizeRaf;
window.addEventListener("resize", () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    renderLeaderboard();
    renderIndustryBoard();
  });
});
