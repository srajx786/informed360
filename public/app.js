// app v15 — 4‑slide hero (image left, content right) + crisp logo fallbacks
// Positive=green, Neutral=grey, Caution=black. Tooltip shown only when Caution ≥ 60%.

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
function setTickerText(j){
  const n = j.nifty?.percent ?? 0;
  const s = j.sensex?.percent ?? 0;
  const text = [
    `NSE: ${n>=0?"▲":"▼"} ${Math.abs(n).toFixed(2)}%`,
    `BSE: ${s>=0?"▲":"▼"} ${Math.abs(s).toFixed(2)}%`,
    `USD/INR: ${(j.usdinr?.price??0).toFixed(2)}`,
    `Sensex: ${(j.sensex?.price??0).toLocaleString()}`
  ].join(" | ");
  const tk=document.getElementById("ticker");
  if (tk) tk.innerHTML = `<span>${text}</span>`;
}
function setChips(j){
  const setChip=(id,label,obj)=>{
    const el=document.getElementById(id); if(!el) return;
    if(!obj || obj.percent==null){ el.className='chip'; el.textContent=`${label} —`; return; }
    const up=(obj.percent||0) >= 0;
    el.className=`chip ${up?'up':'down'}`;
    el.textContent=`${label} ${up?'▲':'▼'} ${Math.abs(obj.percent).toFixed(2)}%`;
  };
  setChip('nseChip','NSE', j.nifty);
  setChip('bseChip','BSE', j.sensex);
}
async function loadMarkets(){
  try{
    const r=await fetch("/api/markets"); const j=await r.json();
    if(!j.ok) throw 0;
    setTickerText(j); setChips(j);
  }catch{
    const tk=document.getElementById("ticker");
    if (tk) tk.innerHTML = `<span>Markets unavailable</span>`;
  }
}

/* Bias + tooltip helpers */
function biasLabel(p){ const L=p?.Left||0,C=p?.Center||0,R=p?.Right||0; const m=Math.max(L,C,R); return m===C?"Neutral":(m===L?"Left":"Right"); }
const UNCERTAIN=/\b(may|might|could|reportedly|alleged|alleges|likely|expected|appears|sources say|claims?)\b/i;
const CHARGED=/\b(slam|slams|hits out|blast|blasts|explosive|shocking|massive|furious|war of words)\b/i;
function reasonForCaution(article){
  const s = article?.sentiment ?? 0;
  const pos = posPctFromSent(s);
  const t = (article?.title||"").toLowerCase();
  const reasons = [];
  if (pos < 40) reasons.push("headline leans negative");
  if (pos >= 40 && pos <= 60) reasons.push("headline reads mixed/neutral");
  if (UNCERTAIN.test(t)) reasons.push("uses uncertainty words (e.g., “may”, “reportedly”)");
  if (CHARGED.test(t)) reasons.push("contains charged/sensational language");
  const bias = biasLabel(article?.bias_pct);
  if (bias !== "Neutral") reasons.push(`headline tilts ${bias.toLowerCase()} (bias estimate)`);
  if (reasons.length === 0)
    return "Caution reflects the share that is not Positive (neutral or negative) based on automated VADER sentiment.";
  return "Caution because " + reasons[0] + ". (Auto-analysis)";
}
function setMeter(el, positive, tipText, minCautionForTooltip = 60){
  const pos = clamp(+positive || 50, 0, 100);
  const caution = 100 - pos;

  const needle = el.querySelector(".needle");
  if (needle) needle.style.left = `${pos}%`;

  const wrapper = el.closest(".tooltip");
  const tip = wrapper ? wrapper.querySelector(".tooltiptext") : null;

  const labels = wrapper ? wrapper.parentElement.querySelector(".bar-labels")
                         : el.parentElement.querySelector(".bar-labels");
  if (labels){
    labels.innerHTML = `
      <div class="legend-item"><span class="swatch pos"></span> Positive: ${pos}%</div>
      <div class="legend-item"><span class="swatch cau"></span> Caution: ${caution}%</div>
    `;
  }

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

/* Image helpers — crisp fallbacks */
function proxied(u){ return `/img?u=${encodeURIComponent(u)}`; }
function clearbitLogo(domain){ return domain ? `https://logo.clearbit.com/${domain}` : null; }
function googleFavicon(domain){ return domain ? `https://www.google.com/s2/favicons?sz=128&domain=${domain}` : null; }

function bestImageFor(article){
  const domain = article?.source_domain || "";
  if (article?.image_url) return proxied(article.image_url);
  // fallbacks: clearbit hi-res logo -> google favicon
  return proxied(clearbitLogo(domain) || googleFavicon(domain));
}
function attachLogoFallback(imgEl, domain){
  const tryClearbit = clearbitLogo(domain);
  const tryFavicon = googleFavicon(domain);
  imgEl.onerror = ()=>{
    if (imgEl.dataset.fbk === "cb") { imgEl.src = proxied(tryFavicon); imgEl.dataset.fbk="fv"; }
    else if (!imgEl.dataset.fbk) { imgEl.src = proxied(tryClearbit); imgEl.dataset.fbk="cb"; }
  };
}

/* utils for lists */
function timeString(iso){ const d=iso?new Date(iso):new Date(); return d.toLocaleString(); }
function keywords(title){
  const STOP = new Set("and or the a an to in for of on with from by after amid over under against during new india".split(" "));
  const t=(title||"").replace(/[^\w\s-]/g," ").split(/\s+/).filter(Boolean);
  const caps = t.filter(w => /^[A-Z][A-Za-z0-9\-]*$/.test(w) && !STOP.has(w.toLowerCase()));
  if (caps.length>=2) return caps.slice(0,2);
  const words = t.filter(w=>w.length>3 && !STOP.has(w.toLowerCase())).sort((a,b)=>b.length-a.length);
  return words.slice(0,2);
}
const toTitle = s => s.split(/-/).map(p => p ? p[0].toUpperCase()+p.slice(1).toLowerCase() : p).join('-');

/* ====== HERO SLIDER ====== */
function makeHeroSlide(article){
  const wrap = document.createElement("div");
  wrap.className = "hero-slide";

  const imgWrap = document.createElement("div");
  imgWrap.className = "hero-img-wrap";
  const img = document.createElement("img");
  img.className = "hero-img";
  img.alt = article.title || "";
  img.src = bestImageFor(article);
  attachLogoFallback(img, article.source_domain);
  imgWrap.appendChild(img);

  const content = document.createElement("div");
  content.className = "hero-content";
  content.innerHTML = `
    <h1><a id="heroLink" target="_blank" rel="noreferrer" href="${article.url}">${article.title}</a></h1>
    <div class="hero-actions">
      <a class="btn-primary" href="${article.url}" target="_blank" rel="noreferrer">Read Analysis</a>
      <div class="tooltip">
        <div id="heroMeter" class="bar-meter" style="width:220px"><div class="needle"></div></div>
        <div class="tooltiptext"></div>
      </div>
    </div>
    <div id="heroBias" class="hero-bias">Bias: ${biasLabel(article?.bias_pct)} • Source ${article.source_name||article.source_domain||""}</div>
  `;

  wrap.appendChild(imgWrap);
  wrap.appendChild(content);

  // set meter now
  const pos = posPctFromSent(article.sentiment ?? 0);
  const meter = content.querySelector("#heroMeter");
  setMeter(meter, pos, reasonForCaution(article));
  return wrap;
}

function pickTopFour(data){
  const main = data.main;
  const items = (data.items||[]).filter(a => a && a.id !== main.id);
  const picks = [main];
  for (const a of items){
    if (picks.length>=4) break;
    picks.push(a);
  }
  return picks;
}

function buildHeroSlider(data){
  const slider = document.getElementById("heroSlider");
  const dotsWrap = document.getElementById("heroDots");
  if (!slider) return;

  const articles = pickTopFour(data);
  slider.querySelectorAll(".hero-slide").forEach(n=>n.remove());
  dotsWrap.innerHTML = "";

  const slides = articles.map(makeHeroSlide);
  slides.forEach(s => slider.insertBefore(s, slider.querySelector(".hero-nav.prev")));

  // dots
  const dots = slides.map((_,i)=>{
    const d = document.createElement("div");
    d.className = "hero-dot" + (i===0?" active":"");
    d.addEventListener("click", ()=>go(i));
    dotsWrap.appendChild(d);
    return d;
  });

  let idx = 0, timer = null;
  function show(i){
    idx = (i+slides.length)%slides.length;
    slides.forEach((s,k)=>{ s.style.display = k===idx ? "grid" : "none"; });
    dots.forEach((d,k)=>{ d.classList.toggle("active", k===idx); });
  }
  function next(){ show(idx+1); }
  function prev(){ show(idx-1); }
  function go(i){ show(i); restart(); }
  function start(){ timer = setInterval(next, 6000); }
  function stop(){ if (timer) clearInterval(timer); timer=null; }
  function restart(){ stop(); start(); }

  slider.querySelector(".hero-nav.next").onclick = ()=>{ next(); restart(); };
  slider.querySelector(".hero-nav.prev").onclick = ()=>{ prev(); restart(); };

  // swipe (mobile)
  let sx=0;
  slider.addEventListener("touchstart",e=>{ sx=e.touches[0].clientX; },{passive:true});
  slider.addEventListener("touchend",e=>{
    const dx=(e.changedTouches[0].clientX - sx);
    if (Math.abs(dx)>40){ (dx<0?next:prev)(); restart(); }
  });

  // init
  show(0); start();
}

/* ====== LISTS ====== */
function imgUrlFallback(article){
  // For list cards: still prefer article image, fallback to clearbit->favicon
  const domain = article?.source_domain || "";
  if (article?.image_url) return proxied(article.image_url);
  return proxied(clearbitLogo(domain) || googleFavicon(domain));
}

function buildNewsList(container, items){
  container.innerHTML="";
  items.forEach(a=>{
    const row=document.createElement("article");
    row.className="news-row";
    row.innerHTML=`
      <div class="news-thumb" style="background-image:url(${imgUrlFallback(a)})"></div>
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

/* boot */
async function boot(){
  setDate();
  await loadMarkets();

  const r=await fetch("/api/news");
  const data=await r.json();
  const titleEl=document.getElementById("heroTitle");
  if(!data.ok || !data.main){ if(titleEl) titleEl.textContent="No news available."; return; }

  // Build new HERO slider and the rest
  buildHeroSlider(data);
  buildNewsList(document.getElementById("news-list"), (data.items||[]).slice(0,12));
  buildBriefList(document.getElementById("brief-right"), (data.daily||[]).slice(0,6));
  buildTrending(document.getElementById("trending-list"), data.items||[]);
}
boot();
