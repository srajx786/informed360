// ---------- tiny DOM helpers ----------
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

// ---------- sentiment meter ----------
function renderSentiment(s, tip=""){
  const pos = Math.max(0, Number(s.posP ?? s.pos ?? 0));
  const neu = Math.max(0, Number(s.neuP ?? s.neu ?? 0));
  const neg = Math.max(0, Number(s.negP ?? s.neg ?? 0));
  const negTip = neg > 50 ? tip || "Skews negative." : "";
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

// ---------- global state ----------
const state = {
  articles: [],
  pins: [],
  topics: [],
  filter: "all",
  experimental: false,
  query: "",
  theme: localStorage.getItem("theme") || "dark"
};

// ---------- theme ----------
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.theme);
}
$("#themeToggle")?.addEventListener("click", ()=>{
  state.theme = state.theme==="light" ? "dark" : "light";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

// ---------- helpers ----------
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});

// ---------- weather (Open-Meteo; no key) ----------
async function getWeather(){
  try{
    const coords = await new Promise((res,rej)=>{
      if(!navigator.geolocation) return res({latitude:19.0760, longitude:72.8777}); // Mumbai fallback
      navigator.geolocation.getCurrentPosition(
        (p)=>res({latitude:p.coords.latitude, longitude:p.coords.longitude}),
        ()=>res({latitude:19.0760, longitude:72.8777})
      );
    });
    const wx = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,weather_code&timezone=auto`);
    let city = "Your area";
    try{
      const rev = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${coords.latitude}&longitude=${coords.longitude}&language=en`);
      city = rev?.results?.[0]?.name || city;
    }catch{}
    const t = Math.round(wx?.current?.temperature_2m ?? 0);
    const code = wx?.current?.weather_code ?? 0;
    const icon = code>=0 && code<3 ? "🌙" : (code<50 ? "⛅" : "🌧️");
    $("#weatherCard").innerHTML = `
      <div class="wx-icon">${icon}</div>
      <div>
        <div class="wx-city">${city}</div>
        <div class="wx-temp">${t}°C</div>
      </div>
    `;
  }catch{
    $("#weatherCard").textContent = "Weather unavailable";
  }
}

// ---------- fetch + render ----------
async function loadAll(){
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  const [news, topics, pins] = await Promise.all([
    fetchJSON(`/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`),
    fetchJSON(`/api/topics${state.experimental ? "?experimental=1" : ""}`),
    fetchJSON("/api/pinned")
  ]);

  state.articles = news.articles || [];
  state.topics = topics.topics || [];
  state.pins = pins.articles || [];

  renderBriefing();
  renderHero();
  renderNews();
  renderPinned();
  renderTopics();
  renderDaily();
  applyTheme();
}

function renderBriefing(){
  $("#briefingDate").textContent = todayStr();
  getWeather(); // async
}

function card(a){
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
        ${renderSentiment(a.sentiment, a.tooltip || "")}
      </div>
    </a>
  `;
}

function renderPinned(){
  const pins = state.pins.length ? state.pins : state.articles.slice(0,3);
  $("#pinned").innerHTML = pins.map(a => `
    <div class="card">
      <a href="${a.link}" target="_blank"><strong>${a.title}</strong></a>
      <div class="meta"><span class="source">${a.source}</span></div>
      ${renderSentiment(a.sentiment, a.tooltip || "")}
    </div>
  `).join("");
}

function applySearchFilter(list){
  if(!state.query) return list;
  const q = state.query.toLowerCase();
  return list.filter(a =>
    (a.title || "").toLowerCase().includes(q) ||
    (a.source || "").toLowerCase().includes(q)
  );
}

function renderNews(){
  const list = applySearchFilter(state.articles.slice(1, 12));
  $("#newsList").innerHTML = list.map(card).join("");
}
function renderDaily(){
  const list = applySearchFilter(state.articles.slice(12, 20));
  $("#daily").innerHTML = list.map(card).join("");
}
function renderHero(){
  const a = applySearchFilter(state.articles)[0];
  const el = $("#mainHero");
  if(!a){ el.innerHTML=""; return; }
  el.innerHTML = `
    <div class="hero-img"><img src="${a.image}" alt=""></div>
    <div class="hero-content">
      <h3>${a.title}</h3>
      <a href="${a.link}" target="_blank" class="analysis-link">Read Analysis</a>
      ${renderSentiment(a.sentiment, a.tooltip || "")}
      <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
    </div>`;
}
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

// ---------- interactions ----------
$$(".chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".chip[data-sent]").forEach(b=>b.classList.remove("active"));
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
$("#searchForm")?.addEventListener("submit", (e)=>{
  e.preventDefault();
  state.query = $("#searchInput").value.trim();
  renderHero(); renderNews(); renderDaily(); // filter client-side
});
$("#searchInput")?.addEventListener("input", (e)=>{
  state.query = e.target.value.trim();
  renderHero(); renderNews(); renderDaily();
});

// ---------- boot ----------
document.getElementById("year").textContent = new Date().getFullYear();
applyTheme();
loadAll();
setInterval(loadAll, 1000*60*5);
