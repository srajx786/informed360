/* ---------- Tiny helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const pct = (n) => `${Math.max(0, Math.min(100, Math.round(Number(n)||0)))}%`;
async function getJSON(url){ const r = await fetch(url); if(!r.ok) throw new Error(await r.text()); return r.json(); }

/* ---------- Theme ---------- */
const prefersDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
function applyTheme(){
  const t = localStorage.getItem("theme") || (prefersDark() ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", t);
  const btn = $("#themeToggle"); if (btn) btn.textContent = (t === "dark") ? "🌞" : "🌙";
}
$("#themeToggle")?.addEventListener("click", ()=>{
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const next = (cur === "dark") ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  $("#themeToggle").textContent = (next === "dark") ? "🌞" : "🌙";
});

/* ---------- State ---------- */
const state = {
  category: "home",
  filter: "all",
  experimental: false,
  articles: [],
  pins: [],
  topics: [],
};

/* ---------- Sentiment renderer ---------- */
function renderSentiment(s){
  const pos = s.posP ?? s.pos ?? 0;
  const neu = s.neuP ?? s.neu ?? 0;
  const neg = s.negP ?? s.neg ?? 0;
  return `
    <div class="sentiment">
      <div class="bar">
        <span class="segment pos" style="width:${pct(pos)}"></span>
        <span class="segment neu" style="width:${pct(neu)}"></span>
        <span class="segment neg" style="width:${pct(neg)}"></span>
      </div>
      <div class="scores">
        <span>Positive ${pct(pos)}</span>
        <span>Neutral ${pct(neu)}</span>
        <span>Negative ${pct(neg)}</span>
      </div>
    </div>`;
}

/* ---------- Markets (RESTORED) ---------- */
async function loadMarkets(){
  try{
    const data = await getJSON("/api/markets");
    const el = $("#marketTicker");
    const q = data.quotes || [];
    el.innerHTML = q.map(it => {
      const price = (it.price ?? "--");
      const chgPct = Number(it.changePercent ?? 0);
      const sign = chgPct > 0 ? "up" : (chgPct < 0 ? "down" : "");
      const arrow = chgPct > 0 ? "▲" : (chgPct < 0 ? "▼" : "•");
      return `
        <span class="badge" title="${it.pretty}">
          <span>${it.pretty}</span>
          <span class="val">${price}</span>
          <span class="chg ${sign}">${arrow} ${Math.abs(chgPct).toFixed(2)}%</span>
        </span>`;
    }).join("");
  }catch(e){
    console.warn("markets", e);
    $("#marketTicker").innerHTML = `<span class="badge">Markets unavailable</span>`;
  }
}

/* ---------- News fetch/render ---------- */
function favicon(link){ try{ return `https://logo.clearbit.com/${new URL(link).hostname.replace(/^www\./,'')}` }catch{return ""} }

function newsCard(a){
  const icon = a.sourceIcon || favicon(a.link);
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta">
          <span><img class="favicon" src="${icon}" alt=""> ${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment)}
      </div>
    </a>`;
}

function renderPinned(){
  $("#pinned").innerHTML = state.pins.map(a => `
    <div class="row">
      <a class="row-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
      <div class="row-meta">
        <span><img class="favicon" src="${a.sourceIcon || favicon(a.link)}" alt=""> ${a.source}</span>
        <span>·</span>
        <span>${new Date(a.publishedAt).toLocaleString()}</span>
      </div>
      ${renderSentiment(a.sentiment)}
    </div>`).join("");
}

function renderNews(){ $("#newsList").innerHTML = state.articles.slice(3, 15).map(newsCard).join(""); }

function renderTopics(){
  $("#topicsList").innerHTML = state.topics.map(t => `
    <div class="row">
      <div class="row-title">${t.title}</div>
      <div class="row-meta">
        <span>${t.count} articles</span> · <span>${t.sources} sources</span>
      </div>
      ${renderSentiment({pos:t.sentiment.pos, neu:t.sentiment.neu, neg:t.sentiment.neg})}
    </div>`).join("");
}

async function loadAll(){
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  if (state.category && !["home","foryou","local"].includes(state.category)) qs.set("category", state.category);

  const [news, topics] = await Promise.all([
    getJSON(`/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`),
    getJSON(`/api/topics`)
  ]);

  state.articles = news.articles || [];
  state.pins = state.articles.slice(0,3);
  state.topics = (topics.topics || []).slice(0,8);

  renderPinned();
  renderNews();
  renderTopics();
}

/* ---------- Tabs & Filters ---------- */
$$(".gn-tabs .tab[data-cat]").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    $$(".gn-tabs .tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    state.category = tab.dataset.cat;
    loadAll();
    tab.scrollIntoView({behavior:"smooth", inline:"center", block:"nearest"});
  });
});

$$(".controls .chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".controls .chip[data-sent]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent;
    loadAll();
  });
});
$("#expChip")?.addEventListener("click", ()=>{
  state.experimental = !state.experimental;
  $("#expChip").classList.toggle("active", state.experimental);
  loadAll();
});

/* ---------- Boot ---------- */
applyTheme();
$("#briefingDate").textContent = new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});
$("#year").textContent = new Date().getFullYear();

loadMarkets();
loadAll();
setInterval(loadAll, 1000*60*5);