const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

function renderSentiment(s, tip=""){
  const pos = Number(s.posP ?? s.pos ?? 0);
  const neu = Number(s.neuP ?? s.neu ?? 0);
  const neg = Number(s.negP ?? s.neg ?? 0);
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

const state = { articles: [], pins: [], topics: [], filter: "all", theme: localStorage.getItem("theme") || "dark" };

function applyTheme(){ document.documentElement.setAttribute("data-theme", state.theme); $("#themeToggle").textContent = state.theme==="light"?"🌙":"☀️"; }
$("#themeToggle").addEventListener("click", ()=>{ state.theme = state.theme==="light"?"dark":"light"; localStorage.setItem("theme", state.theme); applyTheme(); });

async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }

async function loadAll(){
  const query = state.filter==="all" ? "" : `?sentiment=${state.filter}`;
  const [news, topics, pins, ticker] = await Promise.all([
    fetchJSON(`/api/news${query}`),
    fetchJSON("/api/topics"),
    fetchJSON("/api/pinned"),
    fetchJSON("/api/ticker").catch(()=>({quotes:[]})),
  ]);
  state.articles = news.articles || [];
  state.topics = topics.topics || [];
  state.pins = pins.articles || [];
  renderTicker(ticker.quotes || []);
  renderHero();
  renderNews();
  renderPinned();
  renderTopics();
  renderDaily();
  $("#year").textContent = new Date().getFullYear();
  applyTheme();
}

function renderTicker(quotes){
  const indices = [
    { symbol: "^BSESN", name: "BSE Sensex" },
    { symbol: "^NSEI", name: "Nifty 50" },
    { symbol: "^NYA",  name: "NYSE Composite" }
  ];
  $("#ticker").innerHTML = indices.map((info, i)=>{
    const q = quotes[i] || {};
    const cls = (q.change || 0) >= 0 ? "up" : "down";
    const price = q.price!=null ? q.price.toFixed(2) : "--";
    const pct   = q.changePercent!=null ? (q.changePercent*100).toFixed(2)+"%" : "--";
    return `<span>${info.name}: <span class="${cls}">${price} (${pct})</span></span>`;
  }).join(" · ");
}

function card(a){
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
        ${renderSentiment(a.sentiment, a.tooltip)}
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
      ${renderSentiment(a.sentiment, a.tooltip)}
    </div>
  `).join("");
}

function renderNews(){ $("#newsList").innerHTML = state.articles.slice(1, 12).map(card).join(""); }
function renderDaily(){ $("#daily").innerHTML = state.articles.slice(12, 20).map(card).join(""); }

function renderHero(){
  const a = state.articles[0];
  const el = $("#mainHero");
  if(!a){ el.innerHTML=""; return; }
  el.innerHTML = `
    <div class="hero-img"><img src="${a.image}" alt=""></div>
    <div class="hero-content">
      <h3>${a.title}</h3>
      <a href="${a.link}" target="_blank" class="analysis-link">Read Analysis</a>
      ${renderSentiment(a.sentiment, a.tooltip)}
      <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
    </div>`;
}

function renderTopics(){
  $("#topicsList").innerHTML = state.topics.map(t=>{
    const total = t.sentiment.pos + t.sentiment.neu + t.sentiment.neg;
    const sent = { posP: total? (t.sentiment.pos/total)*100 : 0, neuP: total? (t.sentiment.neu/total)*100 : 0, negP: total? (t.sentiment.neg/total)*100 : 0 };
    return `
      <div class="topic-item">
        <div class="topic-header"><strong>${t.title.split("|")[0]}</strong></div>
        <div class="topic-meta"><span>${t.count} articles</span> <span>${t.sources} sources</span></div>
        ${renderSentiment(sent)}
      </div>`;
  }).join("");
}

// sentiment filter chips
$$(".chip").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".chip").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent;
    loadAll();
  });
});

loadAll();
setInterval(loadAll, 1000*60*5);
