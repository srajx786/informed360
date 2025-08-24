// app v19 — Compact, crisp hero; sentiment numbers always visible
// Positive=green, Neutral=grey, Caution=black

const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const posPctFromSent = (s)=>Math.round(clamp((s+1)/2,0,1)*100);

/* header/date/ticker */
function setDate(){
  const d=new Date();
  const weekday=d.toLocaleString("en-US",{weekday:"long"});
  const day=d.getDate();
  const month=d.toLocaleString("en-US",{month:"long"});
  const year=d.getFullYear();
  const dn=document.getElementById("dateNow"); if(dn) dn.textContent = `${weekday}, ${day} ${month} ,${year}`;
  const yr=document.getElementById("yr"); if(yr) yr.textContent = String(year);
}
async function loadMarkets(){
  try{
    const r=await fetch("/api/markets"); const j=await r.json();
    const text = j.ok
      ? [
          `NSE: ${j.nifty.percent>=0?"▲":"▼"} ${Math.abs(j.nifty.percent||0).toFixed(2)}%`,
          `BSE: ${j.sensex.percent>=0?"▲":"▼"} ${Math.abs(j.sensex.percent||0).toFixed(2)}%`,
          `USD/INR: ${(j.usdinr.price||0).toFixed(2)}`
        ].join(" | ")
      : "Markets unavailable";
    document.getElementById("ticker").innerHTML = `<span>${text}</span>`;
  }catch{ document.getElementById("ticker").innerHTML = `<span>Markets unavailable</span>`; }
}

/* Bias + tooltip helpers */
function biasLabel(p){ const L=p?.Left||0,C=p?.Center||0,R=p?.Right||0; const m=Math.max(L,C,R); return m===C?"Neutral":(m===L?"Left":"Right"); }
const UNCERTAIN=/\b(may|might|could|reportedly|alleged|alleges|likely|expected|appears|sources say|claims?)\b/i;
const CHARGED=/\b(slam|slams|hits out|blast|blasts|explosive|shocking|massive|furious|war of words)\b/i;
function reasonForCaution(article){
  const pos = posPctFromSent(article?.sentiment ?? 0);
  const t = (article?.title||"").toLowerCase();
  const reasons=[];
  if (pos < 40) reasons.push("headline leans negative");
  if (pos >= 40 && pos <= 60) reasons.push("headline reads mixed/neutral");
  if (UNCERTAIN.test(t)) reasons.push("uses uncertainty words");
  if (CHARGED.test(t)) reasons.push("contains charged language");
  const bias = biasLabel(article?.bias_pct);
  if (bias !== "Neutral") reasons.push(`tilts ${bias.toLowerCase()} (bias estimate)`);
  return reasons.length ? `Caution because ${reasons[0]}. (Auto-analysis)` :
    "Caution reflects the non‑positive share based on automated VADER sentiment.";
}

/* meter with labels always visible */
function setMeter(el, positive, tipText, minCautionForTooltip = 60){
  const pos = clamp(+positive || 50, 0, 100);
  const caution = 100 - pos;

  const needle = el.querySelector(".needle");
  if (needle) needle.style.left = `${pos}%`;

  const wrapper = el.closest(".tooltip");
  const labels = document.getElementById("heroLabels") || el.parentElement.parentElement.querySelector(".bar-labels");
  if (labels){
    labels.innerHTML = `
      <div class="legend-item">Positive: ${pos}%</div>
      <div class="legend-item">Caution: ${caution}%</div>
    `;
  }

  const tip = wrapper ? wrapper.querySelector(".tooltiptext") : null;
  if (wrapper && tip){
    if (caution >= minCautionForTooltip && tipText){
      wrapper.classList.remove("disabled");
      tip.textContent = tipText;
    } else {
      wrapper.classList.add("disabled");
      tip.textContent = "";
    }
  }
}

/* ===== Image selection: prefer crisp, high‑res brand logos if photo is missing ===== */
const LOGO_SVG = {
  "thehindu.com": "https://upload.wikimedia.org/wikipedia/commons/5/5c/The_Hindu_logo.svg",
  "indianexpress.com": "https://upload.wikimedia.org/wikipedia/commons/6/6b/Indian_Express_logo.png",
  "hindustantimes.com": "https://upload.wikimedia.org/wikipedia/en/3/3b/Hindustan_Times_logo.png",
  "timesofindia.indiatimes.com": "https://static.toiimg.com/photo/msid-58127550/58127550.jpg",
  "ndtv.com": "https://upload.wikimedia.org/wikipedia/commons/6/69/NDTV_Logo.png",
  "news.abplive.com": "https://upload.wikimedia.org/wikipedia/en/9/94/ABP_News_logo.png",
  "livemint.com": "https://upload.wikimedia.org/wikipedia/commons/0/0a/Mint_Logo.svg"
};

function proxied(u){ return `/img?u=${encodeURIComponent(u)}`; }
function domainOf(url){ try{ return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); }catch{ return ""; } }

function bestImage(article){
  const domain = article?.source_domain || domainOf(article?.url||"");
  // 1) use the article image if present
  if (article?.image_url) return proxied(article.image_url);
  // 2) prefer curated crisp source logo (SVG/hi-res)
  if (LOGO_SVG[domain]) return LOGO_SVG[domain];
  // 3) fallback to Clearbit/logo proxy or favicon (handled on server /img)
  return proxied(`https://www.google.com/s2/favicons?sz=128&domain=${domain}`);
}

function flagLogoish(imgEl){
  const src = imgEl.currentSrc || imgEl.src;
  if (!src) return;
  if (/\.(svg)(\?|$)/i.test(src) || /google\.com\/s2\/favicons|logo\.clearbit\.com/i.test(src)){
    imgEl.classList.add("logoish");
  } else {
    imgEl.classList.remove("logoish");
  }
}

/* ===== News rendering ===== */
function timeString(iso){ const d=iso?new Date(iso):new Date(); return d.toLocaleString(); }

function buildNewsList(container, items){
  container.innerHTML="";
  items.forEach(a=>{
    const row=document.createElement("article");
    row.className="news-row";
    const img = bestImage(a);
    row.innerHTML=`
      <div class="news-thumb" style="background-image:url(${img})"></div>
      <div class="news-src">${a.source_name||a.source_domain||""}</div>
      <div class="news-time">${timeString(a.published_at)}</div>
      <h3><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></h3>
      <div class="news-meter">
        <div class="tooltip">
          <div class="bar-meter small"><div class="needle"></div></div>
          <div class="tooltiptext"></div>
        </div>
        <div class="bar-labels" style="width:140px"></div>
      </div>`;
    container.appendChild(row);
    const pos = posPctFromSent(a.sentiment ?? 0);
    setMeter(row.querySelector(".bar-meter"), pos, reasonForCaution(a));
  });
}

function buildBriefList(container, items){
  container.innerHTML="";
  items.forEach(a=>{
    const div=document.createElement("div");
    div.className="brief-item";
    const pos = posPctFromSent(a.sentiment ?? 0);
    div.innerHTML=`
      <span><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></span>
      <div class="tooltip">
        <div class="bar-meter tiny"><div class="needle"></div></div>
        <div class="tooltiptext"></div>
      </div>
      <div class="bar-labels" style="width:100px"></div>`;
    container.appendChild(div);
    setMeter(div.querySelector(".bar-meter"), pos, reasonForCaution(a));
  });
}

/* ===== Hero: compact carousel of up to 4, fixed height, readable labels ===== */
let heroArticles=[], heroIdx=0, heroTimer=null;

function renderHero(i){
  const a = heroArticles[i]; if(!a) return;
  const img = document.getElementById("heroImg");
  img.src = bestImage(a);
  img.onload = ()=>flagLogoish(img);
  img.onerror = ()=>flagLogoish(img);

  const title = document.getElementById("heroTitle");
  title.innerHTML = `<a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a>`;

  const pos = posPctFromSent(a.sentiment ?? 0);
  setMeter(document.getElementById("heroMeter"), pos, reasonForCaution(a));
  document.getElementById("heroLink").href = a.url;
  document.getElementById("biasText").textContent =
    `Bias: ${biasLabel(a?.bias_pct)} • Source ${a.source_name||a.source_domain||""}`;

  // dots
  const dotsWrap=document.getElementById("heroDots");
  dotsWrap.innerHTML="";
  heroArticles.forEach((_,k)=>{
    const d=document.createElement("div");
    d.className="hero-dot"+(k===i?" active":"");
    d.addEventListener("click",()=>{ show(k); restart(); });
    dotsWrap.appendChild(d);
  });
}

function show(i){ heroIdx=(i+heroArticles.length)%heroArticles.length; renderHero(heroIdx); }
function next(){ show(heroIdx+1); }
function prev(){ show(heroIdx-1); }
function start(){ heroTimer=setInterval(next, 7000); }
function stop(){ if(heroTimer) clearInterval(heroTimer); heroTimer=null; }
function restart(){ stop(); start(); }

/* boot */
async function boot(){
  setDate();
  await loadMarkets();

  const r=await fetch("/api/news");
  const data=await r.json();
  if(!data.ok || !data.main){ document.getElementById("heroTitle").textContent="No news available."; return; }

  // select up to 4 for hero (mix of preferred domains already handled server-side for 'main')
  const seen=new Set(); const list=[data.main].concat((data.items||[])).filter(Boolean);
  heroArticles = list.filter(a=>{ if(seen.has(a.id)) return false; seen.add(a.id); return true; }).slice(0,4);
  renderHero(0);

  document.getElementById("heroPrev").onclick=()=>{ prev(); restart(); };
  document.getElementById("heroNext").onclick=()=>{ next(); restart(); };

  start();

  buildNewsList(document.getElementById("news-list"), (data.items||[]).slice(0,12));
  buildBriefList(document.getElementById("brief-right"), (data.daily||[]).slice(0,6));
  buildTrending(document.getElementById("trending-list"), data.items||[]);
}

/* Trending pairs (unchanged logic) */
const STOP = new Set("and or the a an to in for of on with from by after amid over under against during new india".split(" "));
function keywords(title){
  const t=(title||"").replace(/[^\w\s-]/g," ").split(/\s+/).filter(Boolean);
  const caps = t.filter(w => /^[A-Z][A-Za-z0-9\-]*$/.test(w) && !STOP.has(w.toLowerCase()));
  if (caps.length>=2) return caps.slice(0,2);
  const words = t.filter(w=>w.length>3 && !STOP.has(w.toLowerCase())).sort((a,b)=>b.length-a.length);
  return words.slice(0,2);
}
const toTitle = s => s.split(/-/).map(p => p ? p[0].toUpperCase()+p.slice(1).toLowerCase() : p).join('-');

function buildTrending(container, items){
  const map=new Map();
  items.forEach(a=>{
    const [t1,t2]=keywords(a.title); if(!t1||!t2) return;
    const key=`${toTitle(t1)} and ${toTitle(t2)}`;
    const pos=posPctFromSent(a.sentiment ?? 0);
    const x=map.get(key)||{sum:0,count:0}; x.sum+=pos; x.count++; map.set(key,x);
  });
  const pairs=[...map.entries()].map(([k,v])=>({key:k,avg:Math.round(v.sum/v.count),count:v.count}))
               .sort((a,b)=>b.count-a.count).slice(0,6);

  container.innerHTML="";
  pairs.forEach(p=>{
    const div=document.createElement("div");
    div.className="brief-item";
    div.innerHTML=`<span>${p.key}</span>
      <div class="tooltip">
        <div class="bar-meter tiny"><div class="needle"></div></div>
        <div class="tooltiptext"></div>
      </div>
      <div class="bar-labels" style="width:100px"></div>`;
    container.appendChild(div);
    const tip = `Based on ${p.count} recent headlines; Positive ≈ ${p.avg}%. Caution shows the non‑positive share.`;
    setMeter(div.querySelector(".bar-meter"), p.avg, tip);
  });
}

boot();
