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
const isFallbackLogo = (url = "") => {
  const lower = String(url || "").toLowerCase();
  if (!lower) return true;
  if (lower.startsWith("data:image")) return true;
  if (lower.includes("logo.clearbit.com")) return true;
  if (lower.includes("/logo/")) return true;
  if (lower.includes("favicon")) return true;
  return lower.includes("logo.");
};
const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

/* sentiment meter */
function renderSentiment(s, slim = false){
  const pos = Math.max(0, Number(s.posP ?? s.pos ?? 0));
  const neu = Math.max(0, Number(s.neuP ?? s.neu ?? 0));
  const neg = Math.max(0, Number(s.negP ?? s.neg ?? 0));
  return `
    <div class="sentiment ${slim ? "slim" : ""}">
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
  document.documentElement.setAttribute("data-theme", state.theme);
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
      <div class="ticker-row" role="list">${items || ""}</div>
      <div class="ticker-status" aria-label="${statusText}">
        ${statusText}
      </div>`;
  }catch{
    // If API fails, show static labels so the bar is never empty
    const fallback = [
      "BSE Sensex","NSE Nifty","Gold","Crude Oil","USD/INR"
    ];
    const now = new Date();
    const fallbackStatus = `Website updated on ${now.toLocaleDateString()} · ${now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}`;
    $("#marketTicker").innerHTML = `
      <div class="ticker-row" role="list">${fallback.map(n => `
        <div class="qpill">
          <span class="sym">${n}</span>
          <span class="price">—</span>
          <span class="chg">—</span>
        </div>`).join("")}</div>
      <div class="ticker-status" aria-label="${fallbackStatus}">
        ${fallbackStatus}
      </div>`;
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
  if (state.category && !["home","foryou","local"].includes(state.category))
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
  state.topics   = (topics.topics || []).slice(0,8);
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
  } else if (
    state.category === "foryou" &&
    Array.isArray(state.profile?.interests) &&
    state.profile.interests.length
  ){
    const wanted = new Set(state.profile.interests);
    state.articles = state.articles.filter(a => wanted.has(a.category));
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
  const primary = (article.image || "").trim() || fallback;
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

function safeImgTag(src, link, source, cls){
  const fallbackLogo = logoFor(link, source);
  const primary = (src || "").trim();
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
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
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
          · <span class="meta-time">${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment)}
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
          · <span>${new Date(article.publishedAt).toLocaleString()}</span>
        </div>
        ${ageLine}
        ${renderSentiment(article.sentiment, true)}
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
  $("#newsList").innerHTML =
    state.articles.slice(4, 8).map(card).join("");
}
function renderDaily(){
  $("#daily").innerHTML =
    state.articles.slice(12, 18).map(card).join("");
}

/* HERO */
function renderHero(){
  const slides = state.articles.slice(0,4);
  const track = $("#heroTrack");
  const dots  = $("#heroDots");
  if (!slides.length){
    track.innerHTML = "";
    dots.innerHTML  = "";
    return;
  }
  track.innerHTML = slides.map(a => `
    <article class="hero-slide">
      <div class="hero-media">
        <div class="hero-img">${heroImgTag(a)}</div>
        <div class="hero-sentiment">${renderSentiment(a.sentiment, true)}</div>
      </div>
      <div class="hero-actions">
        <button class="pin-toggle" type="button" data-link="${a.link}" aria-pressed="false">Pin</button>
      </div>
      <div class="hero-content">
        <h3>${a.title}</h3>
        <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
        <div class="meta">
          <span class="source">${a.source}</span>
          · <span class="meta-time">${new Date(a.publishedAt).toLocaleString()}</span>
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
      if (!ogImage) return;
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
    return `
      <div class="row">
        <div class="row-title">${t.title.split("|")[0]}</div>
        <div class="row-meta">
          <span>${t.count} articles</span>
          · <span>${t.sources} sources</span>
        </div>
        ${renderSentiment(sent, true)}
      </div>`;
  }).join("");
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
    summary.textContent =
      `Positive ${fmtPct(avg.pos/n)} · Neutral ${fmtPct(avg.neu/n)} · Negative ${fmtPct(avg.neg/n)}`;
  }
}

function getActiveCategoryLabel(){
  const active = $(".gn-tabs .tab.active");
  if (!active) return "World";
  if (active.dataset.cat === "home") return "World";
  return (active.textContent || "World").trim();
}

function formatSentimentTitle(label){
  if (!label) return "World’s Sentiment (Last 4h)";
  if (label.toLowerCase() === "for you") return "For You Sentiment (Last 4h)";
  const possessive = label.endsWith("s") ? `${label}’` : `${label}’s`;
  return `${possessive} Sentiment (Last 4h)`;
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
    title: "India’s Sentiment (Last 4h)",
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

function scoreIndustries(){
  const rows = INDUSTRY_GROUPS.map(name => ({ name, pos:0, neg:0, neu:0, n:0 }));
  const byName = new Map(rows.map(r => [r.name, r]));

  state.articles.forEach(a => {
    const text = `${a.title} ${a.description}`.toLowerCase();
    const matches = rows.filter(r => text.includes(r.name.toLowerCase()));
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
    .sort((a,b) => Math.abs(b.bias) - Math.abs(a.bias));
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

  const pos = scored.filter(x => x.bias > 3).slice(0,3);
  const neg = scored.filter(x => x.bias < -3).slice(0,3);
  const neu = scored
    .filter(x => !pos.includes(x) && !neg.includes(x))
    .slice(0,3);

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
  renderDaily();
  renderTopics();
  renderIndiaSentiment();
  renderWorldSentiment();
  renderLeaderboard();
  renderIndustryBoard();
  $("#year").textContent = new Date().getFullYear();
  updatePinButtons();
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
  state.query = $("#searchInput").value.trim();
  renderAll();
});
$("#searchInput")?.addEventListener("input", (e)=>{
  state.query = e.target.value.trim();
  renderAll();
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
    state.category = tab.dataset.cat;
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

/* boot */
document.getElementById("year").textContent = new Date().getFullYear();
applyTheme();
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
