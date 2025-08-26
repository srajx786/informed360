/* app.js — v28 (auto-detect API; shows badge; graceful fallbacks) */

/* ---- API autodetect ---- */
const candidates = [];
if (typeof window !== "undefined" && window.API_BASE) candidates.push(window.API_BASE);
candidates.push(""); // same-origin (/api on same host)

function join(base, path){
  if (!base) return path;
  return `${base.replace(/\/+$/,"")}${path}`;
}
const apiState = { base: null };

async function tryApi(base){
  try{
    const r = await fetch(join(base, "/api/markets"));
    if (!r.ok) throw new Error();
    const j = await r.json();
    return !!(j && j.ok);
  }catch{ return false; }
}
async function pickApiBase(){
  for (const b of candidates){ if (await tryApi(b)) return b; }
  return null;
}
async function api(path){
  if (!apiState.base) apiState.base = await pickApiBase();
  if (apiState.base===null) throw new Error("No API reachable");
  const r = await fetch(join(apiState.base, path));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function setBadge(ok, note){
  const el = document.getElementById("apiBadge");
  if (!el) return;
  el.classList.remove("ok","fail");
  if (ok){ el.classList.add("ok"); el.innerHTML = `API: <small>OK</small>`; }
  else   { el.classList.add("fail"); el.innerHTML = `API: <small>FAIL</small>${note?` — ${note}`:""}`; }
}

/* ---- utilities ---- */
const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const posPctFromSent = (s)=>Math.round(clamp((s+1)/2,0,1)*100);
function setDate(){
  const d=new Date();
  const weekday=d.toLocaleString("en-US",{weekday:"long"});
  const day=d.getDate();
  const month=d.toLocaleString("en-US",{month:"long"});
  const year=d.getFullYear();
  document.getElementById("dateNow").textContent = `${weekday}, ${day} ${month} ,${year}`;
  document.getElementById("yr").textContent = String(year);
}

/* ---- markets/ticker ---- */
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

/* ---- meter ---- */
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

/* ---- images ---- */
const PLACEHOLDER = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D'http%3A//www.w3.org/2000/svg'%20width%3D'800'%20height%3D'450'%3E%3Cdefs%3E%3ClinearGradient%20id%3D'g'%20x1%3D'0'%20x2%3D'1'%20y1%3D'0'%20y2%3D'1'%3E%3Cstop%20stop-color%3D'%23F3F4F6'%20offset%3D'0'/%3E%3Cstop%20stop-color%3D'%23E5E7EB'%20offset%3D'1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D'100%25'%20height%3D'100%25'%20fill%3D'url(%23g)'/%3E%3Ctext%20x%3D'50%25'%20y%3D'50%25'%20font-family%3D'Inter%2CArial%2Csans-serif'%20font-size%3D'42'%20font-weight%3D'700'%20fill%3D'%23111'%20text-anchor%3D'middle'%20dominant-baseline%3D'middle'%3EInformed360%3C/text%3E%3C/svg%3E";
function imgUrl(a){
  const u = a?.image_url || "";
  if (u.startsWith("/logos/") || u.startsWith("/images/") || u.startsWith("data:image/")) return u;
  if (u) return `/img?u=${encodeURIComponent(u)}`;
  return PLACEHOLDER;
}

/* ---- hero slider ---- */
let heroArticles=[], idx=0, timer=null;
function paintHero(i){
  const a = heroArticles[i];
  const titleEl = document.getElementById("heroTitle");
  const linkEl = document.getElementById("heroLink");
  const imgEl = document.getElementById("heroImg");
  const biasEl = document.getElementById("biasText");

  if(!a){
    titleEl.textContent = "No news available";
    linkEl.removeAttribute("href");
    imgEl.src = PLACEHOLDER;
    biasEl.textContent = "Bias: —";
    return;
  }

  imgEl.src = imgUrl(a);
  titleEl.innerHTML = `<a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a>`;
  linkEl.href = a.url;
  biasEl.textContent = `Source ${a.source_name||a.source_domain||""}`;

  const pos = posPctFromSent(a.sentiment ?? 0);
  setMeter(document.getElementById("heroMeter"), pos);

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
function start(){ if(timer) clearInterval(timer); timer=setInterval(next, 7000); }
function restart(){ start(); }

/* ---- lists ---- */
function timeString(iso){ const d=iso?new Date(iso):new Date(); return d.toLocaleString(); }
function buildNewsList(container, items){
  container.innerHTML="";
  if (!items || !items.length){
    container.innerHTML = `<div class="brief-item">No articles yet.</div>`;
    return;
  }
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
function buildBriefList(container, items){
  container.innerHTML="";
  if (!items || !items.length){
    container.innerHTML = `<div class="brief-item">No items yet.</div>`;
    return;
  }
  items.forEach(a=>{
    const div=document.createElement("div");
    div.className="brief-item";
    div.innerHTML=`<span><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></span>
      <div class="meter-block">
        <div class="bar-meter tiny"><div class="needle"></div></div>
        <div class="bar-labels"></div>
      </div>`;
    container.appendChild(div);
    const pos = posPctFromSent(a.sentiment ?? 0);
    setMeter(div.querySelector(".bar-meter"), pos);
  });
}

/* ---- loaders (with demo fallback) ---- */
function demoMarkets(){
  return { ok:true, nifty:{price:24650.25,percent:0.34}, sensex:{price:81234.1,percent:-0.12}, usdinr:{price:83.2} };
}
function demoNews(){
  const now = new Date().toISOString();
  const mk=(i)=>({ id:`demo:${i}`, title:`Demo article #${i}`, url:"https://example.com",
    source_name:"Demo", source_domain:"example.com", published_at:now, sentiment:0, image_url: PLACEHOLDER });
  const items=[mk(1),mk(2),mk(3),mk(4),mk(5),mk(6)];
  return { ok:true, main:items[0], items };
}

async function loadMarkets(){
  try {
    const j = await api("/api/markets");
    setBadge(true);
    if (j && j.ok){ setTickerText(j); setChips(j); return; }
  } catch { setBadge(false,"markets"); }
  const j = demoMarkets(); setTickerText(j); setChips(j);
}
async function loadNews(){
  let data=null;
  try { data = await api("/api/news"); setBadge(true); }
  catch { setBadge(false,"news"); data = demoNews(); }

  const list = [];
  if (data?.main) list.push(data.main);
  if (Array.isArray(data?.items)) list.push(...data.items);

  const seen = new Set();
  heroArticles = list.filter(a=>{
    if(!a || !a.id) return false;
    if(seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  }).slice(0,4);

  paintHero(0);
  const prevBtn = document.getElementById("heroPrev");
  const nextBtn = document.getElementById("heroNext");
  if (prevBtn) prevBtn.onclick=()=>{prev();restart();};
  if (nextBtn) nextBtn.onclick=()=>{next();restart();};
  start();

  buildNewsList(document.getElementById("news-list"), (data.items||[]).slice(0,12));
  buildBriefList(document.getElementById("brief-right"), (data.items||[]).slice(0,6));
  buildBriefList(document.getElementById("trending-list"), (data.items||[]).slice(6,12));
}

/* ---- boot ---- */
function boot(){ setDate(); loadMarkets(); loadNews(); }
boot();
