/* app.js — v26
   - Uses API_BASE for all requests (news + markets)
   - Fixes "Markets unavailable" by handling errors + expected JSON shape
*/

//////////////////////////////
//  API BASE — EDIT THIS!  //
//////////////////////////////
const API_BASE = "https://YOUR-RENDER-APP.onrender.com";  // e.g., https://informed360-api.onrender.com
// If you set a custom domain for the API, use that instead, e.g. https://api.yourdomain.com

async function api(path) {
  const r = await fetch(`${API_BASE}${path}`, { credentials: "omit" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

///////////////////////////
//  Sentiment utilities  //
///////////////////////////
const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const posPctFromSent = (s)=>Math.round(clamp((s+1)/2,0,1)*100);

function setTickerText(j){
  const n = j.nifty?.percent ?? 0;
  const s = j.sensex?.percent ?? 0;
  const text = [
    `NSE: ${n>=0?"▲":"▼"} ${Math.abs(n).toFixed(2)}%`,
    `BSE: ${s>=0?"▲":"▼"} ${Math.abs(s).toFixed(2)}%`,
    `USD/INR: ${(j.usdinr?.price??0).toFixed(2)}`
  ].join(" | ");
  document.getElementById("ticker").innerHTML = `<span>${text}</span>`;
}
function setChips(j){
  const set=(id,label,obj)=>{
    const el=document.getElementById(id); if(!el) return;
    if(!obj || obj.percent==null){ el.className='chip'; el.textContent=`${label} —`; return; }
    const up=(obj.percent||0)>=0;
    el.className=`chip ${up?'up':'down'}`;
    el.textContent=`${label} ${up?'▲':'▼'} ${Math.abs(obj.percent).toFixed(2)}%`;
  };
  set('nseChip','NSE', j.nifty);
  set('bseChip','BSE', j.sensex);
}

//////////////////////
//  Meter rendering //
//////////////////////
function setMeter(el, positive){
  const pos = Math.max(0, Math.min(100, +positive || 50));
  const caution = 100 - pos;
  const needle = el.querySelector(".needle");
  if (needle) needle.style.left = `${pos}%`;

  const wrap = el.closest(".meter-block") || el.parentElement;
  let labels = wrap.querySelector(":scope > .bar-labels");
  if (!labels) {
    labels = document.createElement("div");
    labels.className = "bar-labels";
    wrap.appendChild(labels);
  }
  const w = Math.round(el.getBoundingClientRect().width);
  if (w) labels.style.width = `${w}px`;
  labels.innerHTML = `<div>Positive: ${pos}%</div><div>Caution: ${caution}%</div>`;
}

///////////////////////////
//  Image URL helper     //
///////////////////////////
function imgUrl(a){
  const u = a?.image_url || "";
  if (u.startsWith("/logos/") || u.startsWith("/images/")) return u;  // served by your API/static
  if (u) return `/img?u=${encodeURIComponent(u)}`;                     // keep your image proxy if you use one
  return "/images/placeholder.png";
}

///////////////////////////
//  Hero slider (4 items)
///////////////////////////
let heroArticles=[], idx=0, timer=null;

function paintHero(i){
  const a = heroArticles[i]; if(!a) return;
  document.getElementById("heroImg").src = imgUrl(a);
  document.getElementById("heroTitle").innerHTML = `<a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a>`;
  document.getElementById("heroLink").href = a.url;
  const pos = posPctFromSent(a.sentiment ?? 0);
  setMeter(document.getElementById("heroMeter"), pos);

  // dots
  const dots = document.getElementById("heroDots");
  if (dots) {
    dots.innerHTML = "";
    heroArticles.forEach((_,k)=>{
      const d=document.createElement("div");
      d.className="hero-dot"+(k===i?" active":"");
      d.onclick=()=>{show(k); restart();};
      dots.appendChild(d);
    });
  }
}

function show(i){ idx=(i+heroArticles.length)%heroArticles.length; paintHero(idx); }
function next(){ show(idx+1); }
function prev(){ show(idx-1); }
function start(){ timer=setInterval(next, 7000); }
function stop(){ if(timer) clearInterval(timer); timer=null; }
function restart(){ stop(); start(); }

//////////////////////
//  Markets loader  //
//////////////////////
async function loadMarkets(){
  let j;
  try { j = await api("/api/markets"); }
  catch { j = { ok:false }; }

  if (j && j.ok){
    setTickerText(j);
    setChips(j);
  } else {
    document.getElementById("ticker").innerHTML = `<span>Markets unavailable</span>`;
    setChips({});
  }
}

/////////////////////////
//  News + page boot   //
/////////////////////////
function timeString(iso){ const d=iso?new Date(iso):new Date(); return d.toLocaleString(); }
function buildNewsList(container, items){
  container.innerHTML="";
  items.forEach(a=>{
    const row=document.createElement("article");
    row.className="news-row";
    row.innerHTML=`
      <div class="news-thumb" style="background-image:url(${imgUrl(a)})"></div>
      <div class="news-src">${a.source_name||a.source_domain||""}</div>
      <div class="news-time">${timeString(a.published_at)}</div>
      <h3><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></h3>
      <div class="news-meter">
        <div class="meter-block">
          <div class="bar-meter small"><div class="needle"></div></div>
          <div class="bar-labels"></div>
        </div>
      </div>`;
    container.appendChild(row);
    const pos = posPctFromSent(a.sentiment ?? 0);
    setMeter(row.querySelector(".bar-meter"), pos);
  });
}

async function boot(){
  await loadMarkets();

  // news
  let data = { ok:false, items:[], main:null };
  try { data = await api("/api/news"); } catch {}

  if (data && data.main){
    const list = [data.main].concat((data.items||[])).filter(Boolean);
    heroArticles = Array.from(new Set(list.map(x=>x.id))).map(id => list.find(x=>x.id===id)).slice(0,4);
    paintHero(0);
    const prevBtn = document.getElementById("heroPrev");
    const nextBtn = document.getElementById("heroNext");
    if (prevBtn) prevBtn.onclick=()=>{prev();restart();};
    if (nextBtn) nextBtn.onclick=()=>{next();restart();};
    start();
  }

  const newsList = document.getElementById("news-list");
  if (newsList) buildNewsList(newsList, (data.items||[]).slice(0,12));
}

boot();
