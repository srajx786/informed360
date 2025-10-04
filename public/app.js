/* === Helpers === */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }

/* === Sentiment UI === */
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

/* === Theme === */
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
  hero: { index:0, timer:null, pause:false, startX:0, dx:0, touching:false }
};
function loadProfile(){ try { return JSON.parse(localStorage.getItem("i360_profile") || "{}"); } catch { return {}; } }
function applyTheme(){
  const t = state.theme || preferredTheme();
  document.documentElement.setAttribute("data-theme", t);
  const btn = $("#themeToggle");
  if (btn) { btn.textContent = (t === "dark") ? "🌞" : "🌙"; }
}

/* === Date === */
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});

/* === Optional placeholders === */
function getWeather(){ $("#weatherCard").innerHTML = `<div>⛅ <strong>${(state.profile?.city)||'Your area'}</strong></div>`; }
function loadMarkets(){ $("#marketTicker").innerHTML = ``; }

/* === Data loading === */
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

/* === Favicons === */
function safeFavicon(link){ try{ const d = new URL(link).hostname.replace(/^www\./,''); return `https://logo.clearbit.com/${d}`; }catch{ return ""; } }

/* === Cards === */
function card(a){
  const icon = a.sourceIcon || safeFavicon(a.link);
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="source-chip"><img class="favicon" src="${icon}" alt="" />${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
      </div>
    </a>`;
}
function renderNews(){ $("#newsList").innerHTML = state.articles.slice(4, 12).map(card).join(""); }
function renderDaily(){ $("#daily").innerHTML = state.articles.slice(12, 20).map(card).join(""); }

/* === Pinned === */
function renderPinned(){
  $("#pinned").innerHTML = state.pins.map(a => {
    const icon = a.sourceIcon || safeFavicon(a.link);
    return `
    <div class="row">
      <a class="row-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
      <div class="row-meta">
        <span class="source-chip"><img class="favicon" src="${icon}" alt="" />${a.source}</span>
        <span>·</span>
        <span>${new Date(a.publishedAt).toLocaleString()}</span>
      </div>
      ${renderSentiment(a.sentiment, true)}
    </div>`;
  }).join("");
}

/* === Hero (swipe support) === */
function renderHero(){
  const slides = state.articles.slice(0,4);
  const track = $("#heroTrack"); const dots = $("#heroDots");
  if (!slides.length){ track.innerHTML=""; dots.innerHTML=""; return; }
  track.innerHTML = slides.map(a => `
    <article class="hero-slide">
      <div class="hero-img"><img src="${a.image}" alt=""></div>
      <div class="hero-content">
        <h3>${a.title}</h3>
        <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
        ${renderSentiment(a.sentiment, true)}
        <div class="meta"><span class="source-chip"><img class="favicon" src="${a.sourceIcon || safeFavicon(a.link)}" alt=""/>${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
      </div>
    </article>`).join("");
  dots.innerHTML = slides.map((_,i)=>`<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`).join("");
  updateHero(0);

  /* touch swipe */
  const hero = $("#hero");
  const trackEl = $("#heroTrack");
  hero.addEventListener("touchstart", (e)=>{
    state.hero.touching = true;
    state.hero.startX = e.touches[0].clientX;
    state.hero.dx = 0;
    trackEl.style.transition = "none";
  }, {passive:true});
  hero.addEventListener("touchmove", (e)=>{
    if(!state.hero.touching) return;
    state.hero.dx = e.touches[0].clientX - state.hero.startX;
    const w = hero.clientWidth;
    const offset = (-state.hero.index * w) + state.hero.dx;
    trackEl.style.transform = `translateX(${offset}px)`;
  }, {passive:true});
  const end = ()=>{
    if(!state.hero.touching) return;
    trackEl.style.transition = "";
    const w = hero.clientWidth;
    if(Math.abs(state.hero.dx) > w * 0.2){
      updateHero(state.hero.index + (state.hero.dx < 0 ? 1 : -1));
    }else{
      updateHero(state.hero.index);
    }
    state.hero.touching = false; state.hero.dx = 0;
  };
  hero.addEventListener("touchend", end, {passive:true});
  hero.addEventListener("touchcancel", end, {passive:true});
}
function updateHero(i){
  const n = $$("#heroTrack .hero-slide").length;
  if (!n) return;
  state.hero.index = (i+n)%n;
  $("#heroTrack").style.transform = `translateX(-${state.hero.index*100}%)`;
  $$("#heroDots button").forEach((b,bi)=> b.classList.toggle("active", bi===state.hero.index));
}
function startHeroAuto(){ stopHeroAuto(); state.hero.timer = setInterval(()=>{ if(!state.hero.pause) updateHero(state.hero.index+1); }, 6000); }
function stopHeroAuto(){ if(state.hero.timer) clearInterval(state.hero.timer); state.hero.timer=null; }

/* === Trending (already from Google Trends via server) === */
function renderTopics(){
  $("#topicsList").innerHTML = state.topics.map(t=>{
    const icons = (t.icons || []).map(u=> `<img class="favicon" src="${u}" alt="">`).join("");
    return `
      <div class="row">
        <div class="row-title">${t.title}</div>
        <div class="row-meta">
          <span>${t.count} articles</span> · <span>${t.sources} sources</span>
          ${icons ? `<span class="row-icons">${icons}</span>` : ``}
        </div>
        ${renderSentiment({ pos:t.sentiment.pos, neu:t.sentiment.neu, neg:t.sentiment.neg }, true)}
      </div>`;
  }).join("");
}

/* === Glue === */
function renderAll(){
  $("#briefingDate").textContent = todayStr();
  $("#year").textContent = new Date().getFullYear();
  renderHero(); renderPinned(); renderNews(); renderDaily(); renderTopics();
}

/* === Interactions === */
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
    // ensure the active tab is visible on mobile
    tab.scrollIntoView({inline:"center", behavior:"smooth", block:"nearest"});
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

/* Tap-friendly tooltip toggles (mobile) */
function wireTipButton(btn){
  const id = btn.getAttribute("data-tip-target");
  const tip = document.getElementById(id);
  if(!tip) return;
  btn.addEventListener("click", (e)=>{
    e.stopPropagation();
    const open = tip.getAttribute("aria-hidden") === "false";
    $$("[role=tooltip]").forEach(t=> t.setAttribute("aria-hidden","true"));
    tip.setAttribute("aria-hidden", open ? "true" : "false");
  });
}
$$(".info-btn").forEach(wireTipButton);
document.addEventListener("click", ()=> {
  $$("[role=tooltip]").forEach(t=> t.setAttribute("aria-hidden","true"));
});

/* === Boot === */
applyTheme();
$("#briefingDate").textContent = todayStr();
getWeather();
loadMarkets();
loadAll();
startHeroAuto();

/* Optional: periodic refresh on mobile too */
setInterval(loadAll, 1000*60*5);