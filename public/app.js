/* app.js — v28
   - Auto-detects API endpoint (window.API_BASE -> same-origin /api).
   - Shows a small badge "API: OK/FAIL" for quick debugging.
   - Falls back to demo data so UI never sticks on "Loading…".
*/

/* =============== API autodetect =============== */
const candidates = [];
if (typeof window !== "undefined" && window.API_BASE) candidates.push(window.API_BASE);
candidates.push(""); // same-origin (i.e., /api/... on current host)

function join(base, path){
  if (!base) return path; // same-origin
  return `${base.replace(/\/+$/,"")}${path}`;
}

const apiState = { base: null, ok: false };

async function tryApi(base){
  // Ping a cheap endpoint (markets) to validate
  try{
    const url = join(base, "/api/markets");
    const r = await fetch(url, { credentials:"omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j && j.ok) { apiState.base = base; apiState.ok = true; return true; }
  }catch(e){}
  return false;
}

async function pickApiBase(){
  for (const base of candidates){
    const ok = await tryApi(base);
    if (ok) return base;
  }
  return null; // none worked
}

async function api(path){
  if (!apiState.base) apiState.base = await pickApiBase();
  if (apiState.base===null) throw new Error("No API reachable");
  const r = await fetch(join(apiState.base, path), { credentials:"omit" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function setBadge(status, note){
  const el = document.getElementById("apiBadge");
  if (!el) return;
  el.classList.remove("ok","fail");
  if (status==="ok"){ el.classList.add("ok"); el.innerHTML = `API: <small>OK</small>`; }
  else { el.classList.add("fail"); el.innerHTML = `API: <small>FAIL</small>${note?` — ${note}`:""}`; }
}

/* =============== Utilities =============== */
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

/* =============== Meter =============== */
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

/* =============== Images =============== */
function imgUrl(a){
  const u = a?.image_url || "";
  if (u.startsWith("/logos/") || u.startsWith("/images/")) return u;
  if (u) return `/img?u=${encodeURIComponent(u)}`;
  return "/images/placeholder.png";
}

/* =============== Hero slider =============== */
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
    imgEl.src = "/images/placeholder.png";
    biasEl.textContent = "Bias: —";
    return;
  }

  imgEl.src = imgUrl(a);
  titleEl.innerHTML = `<a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a>`;
  linkEl.href = a.url;
  biasEl.textContent = `Source ${a.source_name||a.source_domain||""}`;

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
function start(){ if(timer) clearInterval(timer); timer=setInterval(next, 7000); }
function restart(){ start(); }

/* =============== Builders =============== */
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

/* =============== Loaders with demo fallback =============== */
function demoMarkets(){
  return { ok:true, nifty:{price:24650.25,percent:0.34}, sensex:{price:81234.1,percent:-0.12}, usdinr:{price:83.2} };
}
function demoNews(){
  const now = new Date().toISOString();
  const mk=(i)=>({id:`demo:${i}`, title:`Demo article #${i}`, url:"https://example.com",
    source_name:"Demo Source", source_domain:"example.com", published_at:now,
    sentiment:(i%3===0?0.25:(i%3===1?-0.15:0.05)), image_url:"/images/placeholder.png"});
  const items=[mk(1),mk(2),mk(3),mk(4),mk(5),mk(6)];
  return { ok:true, main:items[0], items };
}

async function loadMarkets(){
  try{
    const j = await api("/api/markets");
    setBadge("ok");
    if (j && j.ok){ setTickerText(j); setChips(j); return; }
  }catch(e){
    setBadge("fail","markets");
  }
  const j = demoMarkets();
  setTickerText(j); setChips(j);
}

async function loadNews(){
  let data=null;
  try{
    data = await api("/api/news");
    setBadge("ok");
  }catch(e){
    setBadge("fail","news"); data = demoNews();
  }

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

/* =============== Boot =============== */
function boot(){
  setDate();
  loadMarkets();
  loadNews();
}
boot();
