/* helpers */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
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
  "LiveMint":"livemint.com"
};

const clearbit = (d) => d ? `https://logo.clearbit.com/${d}` : "";
const logoFor = (link = "", source = "") => {
  const mapDom = LOGO_DOMAIN_MAP[source?.trim()] || "";
  const d = mapDom || domainFromUrl(link) || "";
  return clearbit(d);
};

const PLACEHOLDER =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='260'>
       <rect width='100%' height='100%' fill='#e5edf7'/>
       <text x='50%' y='52%' text-anchor='middle'
             font-family='sans-serif' font-weight='700'
             fill='#8aa3c4' font-size='18'>Image</text>
     </svg>`
  );

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
      ${slim ? "" : `
      <div class="scores">
        <span>Positive ${fmtPct(pos)}</span>
        <span>Neutral ${fmtPct(neu)}</span>
        <span>Negative ${fmtPct(neg)}</span>
      </div>`}
    </div>`;
}

/* state */
const state = {
  category: "home",
  filter: "all",
  experimental: false,
  query: "",
  articles: [],
  topics: [],
  pins: [],
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
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.theme);
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
      <div class="qpill stamp" aria-label="Markets updated at ${updatedLabel}">
        Updated ${updatedLabel}
      </div>
      ${items || ""}`;
  }catch{
    // If API fails, show static labels so the bar is never empty
    const fallback = [
      "BSE Sensex","NSE Nifty","Gold","Crude Oil","USD/INR"
    ];
    $("#marketTicker").innerHTML = `
      <div class="qpill stamp">Live markets unavailable</div>
      ${fallback.map(n => `
        <div class="qpill">
          <span class="sym">${n}</span>
          <span class="price">—</span>
          <span class="chg">—</span>
        </div>`).join("")}`;
  }
}

/* pinned topics (Grid 5) */
function getPinnedTopics(){
  const p = state.profile || {};
  return Array.isArray(p.pinnedTopics) ? p.pinnedTopics.slice(0,2) : [];
}
function setPinnedTopics(list){
  const trimmed = (list || [])
    .map(t => t && t.trim())
    .filter(Boolean)
    .slice(0,2);
  const base = state.profile || {};
  saveProfile({ ...base, pinnedTopics: trimmed });
  renderPinnedChips();
  buildPins();
  renderPinned();
}
function buildPins(){
  const topics = getPinnedTopics();
  const pins = [];
  const usedLinks = new Set();
  const arts = state.articles || [];

  topics.forEach(topic => {
    const t = topic.toLowerCase();
    const match = arts.find(a => {
      if (!a) return false;
      if (usedLinks.has(a.link)) return false;
      const hay =
        `${a.title || ""} ${(a.description || "")}`.toLowerCase();
      return hay.includes(t);
    });
    if (match){
      usedLinks.add(match.link);
      pins.push({ topic, article: match });
    }
  });

  state.pins = pins.slice(0,2);
}
function renderPinnedChips(){
  const wrap = $("#pinnedChips");
  if (!wrap) return;
  const topics = getPinnedTopics();
  if (!topics.length){
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = topics.map((t,i) => `
    <button class="pin-chip" type="button" data-i="${i}">
      <span>${t}</span>
      <span class="x">✕</span>
    </button>`).join("");

  wrap.querySelectorAll(".pin-chip").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.i);
      const topics = getPinnedTopics();
      topics.splice(i,1);
      setPinnedTopics(topics);
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

  const [news, topics] = await Promise.all([
    fetchJSON(`/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`),
    fetchJSON(`/api/topics${state.experimental ? "?experimental=1" : ""}`)
  ]);

  state.articles = news.articles || [];
  state.topics   = (topics.topics || []).slice(0,8);

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

  buildPins();
  renderAll();
}

/* image helpers */
function safeImgTag(src, link, source, cls){
  const fallback = logoFor(link, source) || PLACEHOLDER;
  const primary = src || fallback || PLACEHOLDER;
  return `<img class="${cls}" src="${primary}" loading="lazy" data-fallback="${fallback}"
              onerror="if(this.dataset.errored){this.onerror=null;this.src='${PLACEHOLDER}';this.alt='';}else{this.dataset.errored='1';this.src=this.dataset.fallback || '${PLACEHOLDER}';}" alt="">`;
}

/* card renderers */
function card(a){
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      ${safeImgTag(a.image, a.link, a.source, "thumb")}
      <div>
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="source">${a.source}</span>
          · <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment)}
      </div>
    </a>`;
}

function renderPinned(){
  const container = $("#pinned");
  if (!container) return;
  const list = state.pins || [];
  if (!list.length){
    container.innerHTML =
      `<div class="pinned-empty">
         No matches yet — we’ll show the latest news for your pinned topics here.
       </div>`;
    return;
  }
  container.innerHTML = list.map(p => {
    const a = p.article || p;
    const topicLabel = p.topic
      ? `<div class="pin-topic">Tracking: ${p.topic}</div>`
      : "";
    return `
      <div class="row">
        ${topicLabel}
        <a class="row-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
        <div class="row-meta">
          <span class="source">${a.source}</span>
          · <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
      </div>`;
  }).join("");
}

/* Grid 9: only 4 main news stories */
function renderNews(){
  $("#newsList").innerHTML =
    state.articles.slice(4, 8).map(card).join("");
}
function renderDaily(){
  $("#daily").innerHTML =
    state.articles.slice(12, 20).map(card).join("");
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
      <div class="hero-img">${safeImgTag(a.image, a.link, a.source, "")}</div>
      <div class="hero-content">
        <h3>${a.title}</h3>
        <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
        ${renderSentiment(a.sentiment)}
        <div class="meta">
          <span class="source">${a.source}</span>
          · <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
      </div>
    </article>`).join("");

  dots.innerHTML = slides.map((_,i) =>
    `<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`
  ).join("");

  updateHero(0);
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

/* ===== 4-hour mood chart – single band + lines like your reference ===== */
function renderMood4h(){
  const now = Date.now();
  const fourHrs = 4 * 60 * 60 * 1000;
  const recent = state.articles.filter(
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

  const svg = $("#moodSpark");
  if (!svg) return;
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
  $("#moodSummary").textContent =
    `Positive ${fmtPct(avg.pos/n)} · Neutral ${fmtPct(avg.neu/n)} · Negative ${fmtPct(avg.neg/n)}`;
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

function renderLeaderboard(){
  const grid = $("#leaderboard");
  if (!grid) return;
  const colPos = grid.querySelector(".col-pos");
  const colNeu = grid.querySelector(".col-neu");
  const colNeg = grid.querySelector(".col-neg");
  [colPos, colNeu, colNeg].forEach(c => c.innerHTML = "");

  const { pos, neu, neg } = computeLeaderboard();
  const TIERS = [0.35, 0.75];

  function place(col, list){
    let idx = 0;
    list.forEach(s => {
      if (!s.logo) return;
      const b = document.createElement("div");
      b.className = "badge";
      const left = (col.offsetWidth ? col.offsetWidth/2 : 110);
      const top  = (col.offsetHeight ? col.offsetHeight*TIERS[Math.min(idx,TIERS.length-1)] : 150);
      b.style.left = left + "px";
      b.style.top  = top + "px";
      b.innerHTML  = `<img src="${s.logo}" alt="${s.source}" onerror="this.remove()">`;
      col.appendChild(b);
      idx++;
    });
  }

  place(colPos, pos);
  place(colNeu, neu);
  place(colNeg, neg);

  state.lastLeaderboardAt = Date.now();
}

/* glue */
function renderAll(){
  $("#briefingDate").textContent = todayStr();
  renderHero();
  renderPinned();
  renderNews();
  renderDaily();
  renderTopics();
  renderMood4h();
  renderLeaderboard();
  $("#year").textContent = new Date().getFullYear();
}

/* interactions */
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
  const current = getPinnedTopics();
  if (current.includes(value)){
    pinnedInput.value = "";
    return;
  }
  current.push(value);
  setPinnedTopics(current);
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
    pinnedTopics: getPinnedTopics()
  });
  modal.close();
  const forYouTab = $('.gn-tabs .tab[data-cat="foryou"]');
  if (forYouTab) forYouTab.click();
});

/* boot */
document.getElementById("year").textContent = new Date().getFullYear();
applyTheme();
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
