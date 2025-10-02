// Simple DOM query helpers
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Format a number to a 0–100 percentage string
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

/**
 * Render a sentiment bar. Accepts absolute counts (pos, neu, neg)
 * or percentage keys (posP, neuP, negP). Displays all three percentages.
 */
function renderSentiment(s, tip = "") {
  let pos, neu, neg;
  if (typeof s.posP === "number") {
    pos = Math.max(0, Number(s.posP) || 0);
    neu = Math.max(0, Number(s.neuP) || 0);
    neg = Math.max(0, Number(s.negP) || 0);
  } else {
    const total = (s.pos || 0) + (s.neu || 0) + (s.neg || 0);
    pos = total ? (s.pos / total) * 100 : 0;
    neu = total ? (s.neu / total) * 100 : 0;
    neg = total ? (s.neg / total) * 100 : 0;
  }
  const negTip = neg > 50 ? tip || "This cluster skews negative." : "";
  return `
    <div class="sentiment tooltip" ${negTip ? `data-tip="${negTip}"` : ""}>
      <div class="bar">
        <span class="segment pos" style="width:${pos}%"></span>
        <span class="segment neu" style="width:${neu}%"></span>
        <span class="segment neg" style="width:${neg}%"></span>
      </div>
      <div class="scores">
        <span>Positive ${fmtPct(pos)}</span>
        <span>Neutral ${fmtPct(neu)}</span>
        <span>Negative ${fmtPct(neg)}</span>
      </div>
    </div>
  `;
}

// Global application state
const state = {
  articles: [],
  pins: [],
  topics: [],
  theme: localStorage.getItem("theme") || "dark"
};

// Apply the current theme
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  const btn = $("#themeToggle");
  if (btn) btn.textContent = state.theme === "light" ? "🌙" : "☀️";
}

// Toggle light/dark theme
function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem("theme", state.theme);
  applyTheme();
}

// Fetch JSON helper
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Load all data and render
async function loadAll() {
  const [news, pins, ticker, topics] = await Promise.all([
    fetchJSON("/api/news"),
    fetchJSON("/api/pinned"),
    fetchJSON("/api/ticker").catch(() => ({ quotes: [] })),
    fetchJSON("/api/topics").catch(() => ({ topics: [] }))
  ]);

  state.articles = news.articles || news.items || [];
  state.pins = pins.articles || [];
  state.topics = (topics.topics || []).slice(0, 10);

  renderTicker(ticker.quotes || []);
  renderMainHero();
  renderPinned();
  renderNewsList();
  renderDaily();
  renderTopics();

  $("#year").textContent = new Date().getFullYear();
  applyTheme();
}

// Render ticker for Sensex, Nifty and NYSE
function renderTicker(quotes) {
  const indices = [
    { symbol: "^BSESN", name: "BSE Sensex" },
    { symbol: "^NSEI", name: "Nifty 50" },
    { symbol: "^NYA", name: "NYSE Composite" }
  ];
  const line = indices
    .map((info, idx) => {
      const q = (quotes && quotes[idx]) || {};
      const change = typeof q.change === "number" ? q.change : 0;
      const price = typeof q.price === "number" ? q.price : null;
      const changePct = typeof q.changePercent === "number" ? (q.changePercent * 100).toFixed(2) : null;
      const cls = change >= 0 ? "up" : "down";
      const priceStr = price != null ? price.toFixed(2) : "--";
      const pctStr = changePct != null ? `${changePct}%` : "--";
      return `<span>${info.name}: <span class="${cls}">${priceStr} (${pctStr})</span></span>`;
    })
    .join(" · ");
  $("#ticker").innerHTML = line;
}

// Helper to take first n items
function pickTop(arr, n) {
  return arr.slice(0, n);
}

// Render pinned articles
function renderPinned() {
  const pins = state.pins.length ? state.pins : pickTop(state.articles, 3);
  $("#pinned").innerHTML = pins
    .map(
      (a) => `
        <div class="card">
          <a href="${a.url || a.link}" target="_blank" rel="noopener"><strong>${a.title}</strong></a>
          <div class="meta"><span class="source">${a.source_name || a.source}</span></div>
          ${renderSentiment(a.sentiment || { pos:0,neu:0,neg:0 }, a.tooltip)}
        </div>
      `
    )
    .join("");
}

// Render news list
function renderNewsList() {
  const list = state.articles.slice(1, 10);
  $("#newsList").innerHTML = list
    .map(
      (a) => `
        <a class="news-item" href="${a.url || a.link}" target="_blank" rel="noopener">
          <img class="thumb" src="${a.image || a.image_url}" alt="">
          <div>
            <div class="title">${a.title}</div>
            <div class="meta"><span class="source">${a.source_name || a.source}</span> · <span>${new Date(a.published_at || a.publishedAt).toLocaleString()}</span></div>
            ${renderSentiment(a.sentiment || { pos:0,neu:0,neg:0 }, a.tooltip)}
          </div>
        </a>
      `
    )
    .join("");
}

// Render daily feed
function renderDaily() {
  const daily = pickTop(state.articles.slice(10), 8);
  $("#daily").innerHTML = daily
    .map(
      (a) => `
        <a class="daily-item" href="${a.url || a.link}" target="_blank" rel="noopener">
          <img src="${a.image || a.image_url}" alt="">
          <div>
            <div><strong>${a.title}</strong></div>
            <div class="meta"><span class="source">${a.source_name || a.source}</span></div>
            ${renderSentiment(a.sentiment || { pos:0,neu:0,neg:0 }, a.tooltip)}
          </div>
        </a>
      `
    )
    .join("");
}

// Render main hero story
function renderMainHero() {
  const hero = state.articles.length ? state.articles[0] : null;
  const container = $("#mainHero");
  if (!container) return;
  if (!hero) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <div class="hero-img"><img src="${hero.image || hero.image_url}" alt=""></div>
    <div class="hero-content">
      <h3>${hero.title}</h3>
      <a href="${hero.url || hero.link}" target="_blank" class="analysis-link">Read Analysis</a>
      ${renderSentiment(hero.sentiment || { pos:0,neu:0,neg:0 }, hero.tooltip)}
      <div class="meta"><span class="source">${hero.source_name || hero.source}</span> · <span>${new Date(hero.published_at || hero.publishedAt).toLocaleString()}</span></div>
    </div>
  `;
}

// Render trending topics
function renderTopics() {
  const list = state.topics;
  const container = $("#topicsList");
  if (!container) return;
  container.innerHTML = list
    .map((topic) => {
      const title = topic.title.split("|")[0].trim();
      const s = topic.sentiment || { pos: 0, neg: 0, neu: 0 };
      const total = s.pos + s.neg + s.neu;
      const sent = {
        posP: total ? (s.pos / total) * 100 : 0,
        neuP: total ? (s.neu / total) * 100 : 0,
        negP: total ? (s.neg / total) * 100 : 0
      };
      return `
        <div class="topic-item">
          <div class="topic-header"><strong>${title}</strong></div>
          <div class="topic-meta">
            <span>${topic.count} articles</span>
            <span>${topic.sources} sources</span>
          </div>
          ${renderSentiment(sent)}
        </div>
      `;
    })
    .join("");
}

// Initialise
loadAll();
setInterval(loadAll, 1000 * 60 * 5); // refresh every 5 minutes
applyTheme();
const themeBtn = $("#themeToggle");
if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
