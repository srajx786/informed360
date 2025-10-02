/* --- helpers --- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }

/* --- sentiment --- */
function renderSentiment(s, tip=""){
  const pos = Math.max(0, Number(s.posP ?? s.pos ?? 0));
  const neu = Math.max(0, Number(s.neuP ?? s.neu ?? 0));
  const neg = Math.max(0, Number(s.negP ?? s.neg ?? 0));
  const negTip = neg > 50 ? tip || "Skews negative." : "";
  return `
    <div class="sentiment" ${negTip ? `title="${negTip}"` : ""}>
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
    </div>`;
}

/* --- state --- */
const state = {
  category: "home",
  filter: "all",
  experimental: false,
  query: "",
  articles: [],
  topics: [],
  pins: [],
  profile: loadProfile(),
  theme: localStorage.getItem("theme") || "light",   // light to match screenshot
  hero: { index:0, timer:null, pause:false }
};

/* --- theme --- */
function applyTheme(){ document.documentElement.setAttribute("data-theme", state.theme); }
$("#themeToggle")?.addEventListener("click", ()=>{
  state.theme = state.theme==="light" ? "dark" : "light";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

/* --- profile --- */
function loadProfile(){ try { return JSON.parse(localStorage.getItem("i360_profile") || "{}"); } catch { return {}; } }
function saveProfile(p){ localStorage.setItem("i360_profile", JSON.stringify(p || {})); state.profile = p || {}; }

/* --- date/weather --- */
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});
async function getWeather(){
  try{
    const coords = await new Promise((res)=>{
      if(!navigator.geolocation) return res({latitude:19.0760, longitude:72.8777});
      navigator.geolocation.getCurrentPosition(
        p => res({latitude:p.coords.latitude, longitude:p.coords.longitude}),
        () => res({latitude:19.0760, longitude:72.8777})
      );
    });
    const wx = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,weather_code&timezone=auto`);
    let city = state.profile?.city || "Your area";
    if (!state.profile?.city) {
      try{
        const rev = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${coords.latitude}&longitude=${coords.longitude}&language=en`);
        city = rev?.results?.[0]?.name || city;
      }catch{}
    }
    const t = Math.round(wx?.current?.temperature_2m ?? 0);
    const code = wx?.current?.weather_code ?? 0;
    const icon = code>=0 && code<3 ? "🌙" : (code<50 ? "⛅" : "🌧️");
    $("#weatherCard").innerHTML = `
      <div class="wx-icon">${icon}</div>
      <div><div class="wx-city">${city}</div><div class="wx-temp">${t}°C</div></div>`;
  }catch{ $("#weatherCard").textContent = "Weather unavailable"; }
}

/* --- API loads --- */
async function loadAll(){
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  if (state.category && !["home","foryou","local"].includes(state.category)) qs.set("category", state.category);

  const [news, topics, pins] = await Promise.all([
    fetchJSON(`/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`),
    fetchJSON(`/api/topics${state.experimental ? "?experimental=1" : ""}`),
    fetchJSON("/api/pinned")
  ]);

  state.articles = news.articles || [];
  state.topics = topics.topics || [];
  state.pins = pins.articles || [];

  // Local adjustments
  if (state.category === "local" && state.profile?.city) {
    const c = state.profile.city.toLowerCase();
    state.articles = state.articles.filter(a => (a.title||"").toLowerCase().includes(c) || (a.link||"").toLowerCase().includes(c));
  } else if (state.category === "foryou" && Array.isArray(state.profile?.interests) && state.profile.interests.length) {
    const wanted = new Set(state.profile.interests);
    state.articles = state.articles.filter(a => wanted.has(a.category));
  }

  renderAll();
}

/* --- renderers --- */
function card(a){
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
        ${renderSentiment(a.sentiment)}
      </div>
    </a>`;
}
function applySearchFilter(list){
  if(!state.query) return list;
  const q = state.query.toLowerCase();
  return list.filter(a =>
    (a.title || "").toLowerCase().includes(q) ||
    (a.source || "").toLowerCase().includes(q)
  );
}
function renderPinned(){
  const pins = state.pins.length ? state.pins : state.articles.slice(0,3);
  $("#pinned").innerHTML = pins.map(a => `
    <div class="card">
      <a href="${a.link}" target="_blank"><strong>${a.title}</strong></a>
      <div class="meta"><span class="source">${a.source}</span></div>
      ${renderSentiment(a.sentiment)}
    </div>`).join("");
}
function renderNews(){ $("#newsList").innerHTML = applySearchFilter(state.articles.slice(4, 15)).map(card).join(""); }
function renderDaily(){ $("#daily").innerHTML = applySearchFilter(state.articles.slice(15, 23)).map(card).join(""); }

/* --- HERO CAROUSEL (4 slides) --- */
function renderHero(){
  const slides = applySearchFilter(state.articles).slice(0,4);
  const track = $("#heroTrack"); const dots = $("#heroDots");
  if (!slides.length){ track.innerHTML = ""; dots.innerHTML=""; return; }

  track.innerHTML = slides.map(a => `
    <article class="hero-slide">
      <div class="hero-img"><img src="${a.image}" alt=""></div>
      <div class="hero-content">
        <h3>${a.title}</h3>
        <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
        ${renderSentiment(a.sentiment)}
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
      </div>
    </article>`).join("");

  dots.innerHTML = slides.map((_,i)=>`<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`).join("");
  updateHero(0);
}
function updateHero(i){
  const slidesCount = $$("#heroTrack .hero-slide").length;
  state.hero.index = (i+slidesCount) % slidesCount;
  $("#heroTrack").style.transform = `translateX(-${state.hero.index*100}%)`;
  $$("#heroDots button").forEach((b,bi)=> b.classList.toggle("active", bi===state.hero.index));
}
function startHeroAuto(){
  stopHeroAuto();
  state.hero.timer = setInterval(()=>{ if(!state.hero.pause) updateHero(state.hero.index+1); }, 6000);
}
function stopHeroAuto(){ if(state.hero.timer) clearInterval(state.hero.timer); state.hero.timer=null; }

/* --- topics --- */
function renderTopics(){
  $("#topicsList").innerHTML = state.topics.map(t=>{
    const total = (t.sentiment.pos||0) + (t.sentiment.neu||0) + (t.sentiment.neg||0);
    const sent = {
      posP: total ? (t.sentiment.pos/total)*100 : 0,
      neuP: total ? (t.sentiment.neu/total)*100 : 0,
      negP: total ? (t.sentiment.neg/total)*100 : 0
    };
    return `
      <div class="topic-item">
        <div class="topic-header"><strong>${t.title.split("|")[0]}</strong></div>
        <div class="topic-meta"><span>${t.count} articles</span> <span>${t.sources} sources</span></div>
        ${renderSentiment(sent)}
      </div>`;
  }).join("");
}

/* --- glue render --- */
function renderAll(){
  $("#briefingDate").textContent = todayStr();
  getWeather();

  renderHero();
  renderPinned();
  renderNews();
  renderDaily();
  renderTopics();
  $("#year").textContent = new Date().getFullYear();
  applyTheme();

  startHeroAuto();
}

/* --- interactions --- */
// sentiment chips
$$(".chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".chip[data-sent]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent;
    loadAll();
  });
});
// experimental toggle
$("#expChip")?.addEventListener("click", ()=>{
  state.experimental = !state.experimental;
  $("#expChip").classList.toggle("active", state.experimental);
  loadAll();
});
// search
$("#searchForm")?.addEventListener("submit", (e)=>{ e.preventDefault(); state.query = $("#searchInput").value.trim(); renderAll(); });
$("#searchInput")?.addEventListener("input", (e)=>{ state.query = e.target.value.trim(); renderAll(); });
// tabs
$$(".gn-tabs .tab[data-cat]").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    $$(".gn-tabs .tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    state.category = tab.dataset.cat;
    loadAll();
  });
});
// hero controls
$("#heroPrev")?.addEventListener("click", ()=> updateHero(state.hero.index-1));
$("#heroNext")?.addEventListener("click", ()=> updateHero(state.hero.index+1));
$("#hero")?.addEventListener("mouseenter", ()=> state.hero.pause = true);
$("#hero")?.addEventListener("mouseleave", ()=> state.hero.pause = false);
$("#heroDots")?.addEventListener("click", (e)=>{
  const b = e.target.closest("button[data-i]");
  if(!b) return; updateHero(Number(b.dataset.i));
});

/* Sign-in modal */
const modal = $("#signinModal");
$("#avatarBtn")?.addEventListener("click", ()=>{
  $("#prefName").value = state.profile?.name || "";
  $("#prefCity").value = state.profile?.city || "";
  const interests = new Set(state.profile?.interests || ["india"]);
  modal.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked = interests.has(cb.value));
  modal.showModal();
});
$("#savePrefs")?.addEventListener("click", (e)=>{
  e.preventDefault();
  const name = $("#prefName").value.trim();
  const city = $("#prefCity").value.trim();
  const interests = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(cb=>cb.value);
  saveProfile({ name, city, interests });
  modal.close();
  const forYouTab = $('.gn-tabs .tab[data-cat="foryou"]'); if (forYouTab) forYouTab.click();
});

/* boot */
document.getElementById("year").textContent = new Date().getFullYear();
applyTheme();
$("#briefingDate").textContent = todayStr();
getWeather();
loadAll();
setInterval(loadAll, 1000*60*5);
