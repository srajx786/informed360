/* ---------- helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = n => `${Math.max(0, Math.min(100, Math.round(n || 0)))}%`;
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});
const isMobile = ()=> window.matchMedia("(max-width: 767.98px)").matches;

/* ---------- state ---------- */
function prefersDark(){ return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }
const state = {
  category: "home", filter: "all", experimental: false,
  articles: [], pins: [], topics: [],
  theme: localStorage.getItem("theme") || (prefersDark() ? "dark" : "light"),
  hero: { index:0, timer:null, pause:false }
};

/* ---------- theme ---------- */
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.theme);
  const t = $("#themeToggle"); if (t) t.textContent = state.theme === "dark" ? "🌞" : "🌙";
}
$("#themeToggle")?.addEventListener("click", ()=>{
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

/* ---------- sentiment UI ---------- */
function renderSentiment(s, withNumbers=true){
  const pos = s.posP ?? s.pos ?? 0;
  const neu = s.neuP ?? s.neu ?? 0;
  const neg = s.negP ?? s.neg ?? 0;
  return `
    <div class="sentiment ${withNumbers?'':'slim'}">
      <div class="bar">
        <span class="segment pos" style="width:${fmtPct(pos)}"></span>
        <span class="segment neu" style="width:${fmtPct(neu)}"></span>
        <span class="segment neg" style="width:${fmtPct(neg)}"></span>
      </div>
      ${withNumbers ? `
      <div class="scores">
        <span>Positive ${fmtPct(pos)}</span>
        <span>Neutral ${fmtPct(neu)}</span>
        <span>Negative ${fmtPct(neg)}</span>
      </div>` : ``}
    </div>`;
}
function safeFavicon(link){ try{ const d = new URL(link).hostname.replace(/^www\./,''); return `https://logo.clearbit.com/${d}`; }catch{ return ""; } }
function wrapTip(inner, tipHtml){ return `<div class="has-tip">${inner}<div class="tip" role="tooltip">${tipHtml}</div></div>`; }

/* ---------- data load ---------- */
async function loadAll(){
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  if (state.category && !["home","foryou","local"].includes(state.category)) qs.set("category", state.category);

  let news = { articles: [] }; let topicsPayload = { topics: [] };
  try { news = await fetchJSON(`/api/news${qs.toString() ? ("?"+qs.toString()) : ""}`); } catch(e){ console.warn("news err", e); }
  try { topicsPayload = await fetchJSON(`/api/topics`); } catch(e){ console.warn("topics err", e); }

  state.articles = news.articles || [];
  state.pins = state.articles.slice(0, 3);

  // robust fallback if no Google Trends
  if (!topicsPayload.topics || topicsPayload.topics.length === 0) {
    const counts = new Map();
    for (const a of state.articles.slice(0, 60)) {
      const title = (a.title||"").toLowerCase();
      const tokens = title.match(/[a-z]{4,}/gi) || [];
      tokens.forEach(t => counts.set(t, (counts.get(t)||0)+1));
    }
    state.topics = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([word]) => ({
      title: word, count: 0, sources: 0,
      sentiment: { pos:33, neu:34, neg:33 },
      breakdown: [], icons: [],
      explain: "Fallback topics derived from frequent terms in current feed."
    }));
  } else {
    // keep up to 4 sources per topic
    state.topics = topicsPayload.topics.map(t => ({
      ...t,
      breakdown: (t.breakdown || []).slice(0,4),
      icons: (t.breakdown || []).slice(0,4).map(b => b.icon).filter(Boolean)
    })).slice(0,8);
  }

  $("#briefingDate").textContent = todayStr();
  $("#year").textContent = new Date().getFullYear();

  renderPinned();
  renderHeroAndNews(); // responsive hero
  renderTopics();
}

/* ---------- pinned ---------- */
function renderPinned(){
  const tip = `<h4>How we calculate</h4><small>We run <b>VADER</b> on each article’s <i>title + summary</i> to get Positive/Neutral/Negative.</small>`;
  $("#pinned").innerHTML = state.pins.map(a=>{
    const icon = a.sourceIcon || safeFavicon(a.link);
    const inner = `
      <div class="row">
        <a class="row-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
        <div class="row-meta">
          <span class="source-chip"><img class="favicon" src="${icon}" alt="">${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
      </div>`;
    return wrapTip(inner, tip);
  }).join("");
}

/* ---------- hero + news (responsive) ---------- */
function renderHeroAndNews(){
  const heroEl = $("#hero");
  const track = $("#heroTrack");
  const dots = $("#heroDots");
  const list = $("#newsList");

  if (isMobile()){
    // no slider on mobile; render top 2 as stacked cards
    heroEl.style.display = "";
    track.innerHTML = state.articles.slice(0,2).map(a => heroStacked(a)).join("");
    dots.innerHTML = ""; // no dots on mobile
    list.innerHTML = state.articles.slice(2, 14).map(card).join("");
    return;
  }

  // desktop/tablet → real carousel
  const slides = state.articles.slice(0, 4);
  if (!slides.length){
    heroEl.style.display = "none";
    list.innerHTML = state.articles.slice(0, 12).map(card).join("");
    return;
  }

  heroEl.style.display = "";
  track.innerHTML = slides.map(heroSlide).join("");
  dots.innerHTML = slides.map((_,i)=>`<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`).join("");
  updateHero(0);
  list.innerHTML = state.articles.slice(slides.length, slides.length + 10).map(card).join("");
}

function heroSlide(a){
  const tip = `<h4>Hero calculation</h4><small>VADER on headline + snippet.</small>`;
  const inner = `
    <article class="hero-slide">
      <div class="hero-img"><img src="${a.image}" alt=""></div>
      <div class="hero-content">
        <h3>${a.title}</h3>
        <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
        ${renderSentiment(a.sentiment, true)}
        <div class="meta">
          <span class="source-chip"><img class="favicon" src="${a.sourceIcon || safeFavicon(a.link)}" alt="">${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
      </div>
    </article>`;
  return wrapTip(inner, tip);
}
function heroStacked(a){
  // simple mobile hero card
  return `
    <article class="news-item" style="margin-bottom:.6rem">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="source-chip"><img class="favicon" src="${a.sourceIcon || safeFavicon(a.link)}" alt="">${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
        <a href="${a.link}" target="_blank" rel="noopener" class="analysis-link">Read Analysis</a>
      </div>
    </article>`;
}
function updateHero(i){
  const n = $$("#heroTrack .hero-slide").length;
  if (!n) return;
  state.hero.index = (i+n)%n;
  $("#heroTrack").style.transform = `translateX(-${state.hero.index*100}%)`;
  $$("#heroDots button").forEach((b,bi)=> b.classList.toggle("active", bi===state.hero.index));
}
$("#heroPrev")?.addEventListener("click", ()=> updateHero(state.hero.index-1));
$("#heroNext")?.addEventListener("click", ()=> updateHero(state.hero.index+1));
$("#hero")?.addEventListener("mouseenter", ()=> state.hero.pause = true);
$("#hero")?.addEventListener("mouseleave", ()=> state.hero.pause = false);
function startHeroAuto(){ stopHeroAuto(); state.hero.timer = setInterval(()=>{ if(!state.hero.pause && !isMobile()) updateHero(state.hero.index+1); }, 6000); }
function stopHeroAuto(){ if(state.hero.timer){ clearInterval(state.hero.timer); state.hero.timer=null; } }

/* ---------- card ---------- */
function card(a){
  const icon = a.sourceIcon || safeFavicon(a.link);
  const tip = `<h4>This score</h4><small>VADER on <i>headline + snippet</i> for this article.</small>`;
  const inner = `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="source-chip"><img class="favicon" src="${icon}" alt="">${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
      </div>
    </a>`;
  return wrapTip(inner, tip);
}

/* ---------- trending ---------- */
function renderTopics(){
  const container = $("#topicsList");
  if (!state.topics || state.topics.length === 0){
    container.innerHTML = `<div class="row"><div class="row-title">No trending topics yet</div></div>`;
    return;
  }
  container.innerHTML = state.topics.map(t=>{
    const rows = (t.breakdown||[]).slice(0,4).map(b=>`
      <div class="tip-row">
        <span class="tip-source"><img class="favicon" src="${b.icon}" alt=""> ${b.domain}</span>
        <span class="tip-pct">P ${fmtPct(b.pos)} · N ${fmtPct(b.neu)} · Neg ${fmtPct(b.neg)} (${b.articles})</span>
      </div>`).join("") || `<small>No per-source breakdown.</small>`;
    const tip = `
      <h4>How we calculate</h4>
      <small>${t.explain || "VADER per article → average per source → average across up to 4 sources."}</small>
      <div class="tip-breakdown">${rows}</div>
    `;
    const icons = (t.icons||[]).slice(0,4).map(ic=>`<img class="favicon" src="${ic}" alt="">`).join("");
    const inner = `
      <div class="row">
        <div class="row-title">${t.title}</div>
        <div class="row-meta"><span>${t.count||0} articles</span> · <span>${t.sources||0} sources</span> <span class="row-icons">${icons}</span></div>
        ${renderSentiment({ pos:t.sentiment?.pos||0, neu:t.sentiment?.neu||0, neg:t.sentiment?.neg||0 }, true)}
      </div>`;
    return wrapTip(inner, tip);
  }).join("");
}

/* ---------- controls ---------- */
$$(".chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".chip[data-sent]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent; loadAll();
  });
});
$("#expChip")?.addEventListener("click", ()=>{
  state.experimental = !state.experimental;
  $("#expChip").classList.toggle("active", state.experimental);
  loadAll();
});
$$(".gn-tabs .tab[data-cat]").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    $$(".gn-tabs .tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    state.category = tab.dataset.cat; loadAll();
  });
});

/* ---------- boot ---------- */
applyTheme();
$("#briefingDate").textContent = todayStr();
loadAll();
startHeroAuto();
window.addEventListener("resize", () => renderHeroAndNews());