/* helpers */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }

/* sentiment UI */
function renderSentiment(s, showNumbers = true){
  const pos = Math.max(0, Number(s.posP ?? s.pos ?? 0));
  const neu = Math.max(0, Number(s.neuP ?? s.neu ?? 0));
  const neg = Math.max(0, Number(s.negP ?? s.neg ?? 0));
  return `
    <div class="sentiment ${showNumbers?'':'slim'}">
      <div class="bar">
        <span class="segment pos" style="width:${pos}%"></span>
        <span class="segment neu" style="width:${neu}%"></span>
        <span class="segment neg" style="width:${neg}%"></span>
      </div>
      ${showNumbers ? `
      <div class="scores">
        <span>Positive ${fmtPct(pos)}</span>
        <span>Neutral ${fmtPct(neu)}</span>
        <span>Negative ${fmtPct(neg)}</span>
      </div>` : ``}
    </div>`;
}

/* theme */
function preferredTheme(){
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
const state = {
  category: "home",
  filter: "all",
  experimental: false,
  query: "",
  articles: [],
  topics: [],
  pins: [],
  profile: loadProfile(),
  theme: localStorage.getItem("theme") || preferredTheme(),
  hero: { index:0, timer:null, pause:false }
};
function loadProfile(){ try { return JSON.parse(localStorage.getItem("i360_profile") || "{}"); } catch { return {}; } }
function applyTheme(){
  const t = state.theme || preferredTheme();
  document.documentElement.setAttribute("data-theme", t);
  const btn = $("#themeToggle");
  if (btn) { btn.textContent = (t === "dark") ? "🌞" : "🌙"; }
}

/* date/briefing placeholders */
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});

/* optional placeholders (no-ops); keep DOM happy */
function getWeather(){ $("#weatherCard").innerHTML = `<div>Weather</div>`; }
function loadMarkets(){ $("#marketTicker").innerHTML = ``; }

/* load all */
async function loadAll(){
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  if (state.category && !["home","foryou","local"].includes(state.category)) qs.set("category", state.category);

  const [news, topics] = await Promise.all([
    fetchJSON(`/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`),
    fetchJSON(`/api/topics`)
  ]);

  state.articles = news.articles || [];
  state.topics = (topics.topics || []).slice(0, 8);
  state.pins = state.articles.slice(0,3);

  if (state.category === "local" && state.profile?.city) {
    const c = state.profile.city.toLowerCase();
    state.articles = state.articles.filter(a => (a.title||"").toLowerCase().includes(c) || (a.link||"").toLowerCase().includes(c));
  }

  renderAll();
}

/* favicon helper */
function safeFavicon(link){ try{ const d = new URL(link).hostname.replace(/^www\./,''); return `https://logo.clearbit.com/${d}`; }catch{ return ""; } }

/* tooltips wrapper */
function wrapWithTip(innerHtml, tipHtml){
  return `<div class="has-tip">
    ${innerHtml}
    <div class="tip" role="tooltip">${tipHtml}</div>
  </div>`;
}

/* Pinned */
function renderPinned(){
  const tip = `
    <h4>How we calculate</h4>
    <small>We run <b>VADER</b> on each article’s <i>title + summary</i> to get Positive/Neutral/Negative.</small>
  `;
  $("#pinned").innerHTML = state.pins.map(a => {
    const icon = a.sourceIcon || safeFavicon(a.link);
    const content = `
      <div class="row">
        <a class="row-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
        <div class="row-meta">
          <span class="source-chip"><img src="${icon}" alt="" />${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
      </div>`;
    return wrapWithTip(content, tip);
  }).join("");
}

/* News & Daily list (center column) */
function card(a){
  const icon = a.sourceIcon || safeFavicon(a.link);
  const tip = `
    <h4>This score</h4>
    <small>VADER on <i>headline + snippet</i> for this article. We don’t crawl paywalls.</small>
  `;
  const inner = `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="source-chip"><img src="${icon}" alt="" />${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
      </div>
    </a>`;
  return wrapWithTip(inner, tip);
}
function renderNews(){ $("#newsList").innerHTML = state.articles.slice(4, 12).map(card).join(""); }
function renderDaily(){ $("#daily").innerHTML = state.articles.slice(12, 20).map(card).join(""); }

/* HERO */
function renderHero(){
  const slides = state.articles.slice(0,4);
  const track = $("#heroTrack"); const dots = $("#heroDots");
  if (!slides.length){ track.innerHTML=""; dots.innerHTML=""; return; }
  track.innerHTML = slides.map(a => {
    const tip = `
      <h4>Hero calculation</h4>
      <small>VADER on headline + snippet → Positive/Neutral/Negative.</small>
    `;
    const inner = `
      <article class="hero-slide">
        <div class="hero-img"><img src="${a.image}" alt=""></div>
        <div class="hero-content">
          <h3>${a.title}</h3>
          <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
          ${renderSentiment(a.sentiment, true)}
          <div class="meta"><span class="source-chip"><img src="${a.sourceIcon || safeFavicon(a.link)}" alt=""/>${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
        </div>
      </article>`;
    return wrapWithTip(inner, tip);
  }).join("");
  dots.innerHTML = slides.map((_,i)=>`<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`).join("");
  updateHero(0);
}
function updateHero(i){
  const n = $$("#heroTrack .hero-slide").length;
  state.hero.index = (i+n)%n;
  $("#heroTrack").style.transform = `translateX(-${state.hero.index*100}%)`;
  $$("#heroDots button").forEach((b,bi)=> b.classList.toggle("active", bi===state.hero.index));
}
function startHeroAuto(){ stopHeroAuto(); state.hero.timer = setInterval(()=>{ if(!state.hero.pause) updateHero(state.hero.index+1); }, 6000); }
function stopHeroAuto(){ if(state.hero.timer) clearInterval(state.hero.timer); state.hero.timer=null; }

/* Trending (from Google Trends) with per-source breakdown tooltips */
function renderTopics(){
  $("#topicsList").innerHTML = state.topics.map(t=>{
    const icons = (t.icons || []).map(u=> `<img class="favicon" src="${u}" alt="">`).join("");
    const rows = (t.breakdown || []).slice(0,6).map(b=>`
      <div class="tip-row">
        <span class="tip-source"><img class="favicon" src="${b.icon}" alt=""> ${b.domain}</span>
        <span class="tip-pct">P ${fmtPct(b.pos)} · N ${fmtPct(b.neu)} · Neg ${fmtPct(b.neg)} (${b.articles})</span>
      </div>
    `).join("") || `<small>No articles found yet.</small>`;

    const tip = `
      <h4>How we calculate</h4>
      <small>${t.explain}</small>
      <div class="tip-breakdown">${rows}</div>
    `;

    const inner = `
      <div class="row">
        <div class="row-title">${t.title}</div>
        <div class="row-meta">
          <span>${t.count} articles</span> · <span>${t.sources} sources</span>
          ${icons ? `<span class="row-icons">${icons}</span>` : ``}
        </div>
        ${renderSentiment({ pos:t.sentiment.pos, neu:t.sentiment.neu, neg:t.sentiment.neg }, true)}
      </div>`;

    return wrapWithTip(inner, tip);
  }).join("");
}

/* glue */
function renderAll(){
  $("#briefingDate").textContent = todayStr();
  $("#year").textContent = new Date().getFullYear();
  renderHero(); renderPinned(); renderNews(); renderDaily(); renderTopics();
}

/* interactions */
$$(".chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".chip[data-sent]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent; loadAll();
  });
});
$("#expChip")?.addEventListener("click", ()=>{ state.experimental = !state.experimental; $("#expChip").classList.toggle("active", state.experimental); loadAll(); });
$$(".gn-tabs .tab[data-cat]").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    $$(".gn-tabs .tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    state.category = tab.dataset.cat; loadAll();
  });
});
$("#heroPrev")?.addEventListener("click", ()=> updateHero(state.hero.index-1));
$("#heroNext")?.addEventListener("click", ()=> updateHero(state.hero.index+1));
$("#hero")?.addEventListener("mouseenter", ()=> state.hero.pause = true);
$("#hero")?.addEventListener("mouseleave", ()=> state.hero.pause = false);

$("#themeToggle")?.addEventListener("click", ()=>{
  state.theme = (state.theme === "dark") ? "light" : "dark";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

/* boot */
applyTheme();
$("#briefingDate").textContent = todayStr();
getWeather();
loadMarkets();
loadAll();
startHeroAuto();