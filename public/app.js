import vader from "https://esm.sh/vader-sentiment@1.1.3";

const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const toPct=v=>Math.round(clamp((v+1)/2,0,1)*100);
const pick=(a)=> typeof a?.sentiment==="number" ? clamp(a.sentiment,-1,1)
  : vader.SentimentIntensityAnalyzer.polarity_scores(((a?.title)||"")+" "+(a?.summary||"")).compound;

const favicon = (domain) =>
  `/img?u=${encodeURIComponent(`https://www.google.com/s2/favicons?sz=128&domain=${domain}`)}`;

function biasLabel(p){
  const L=p?.Left||0,C=p?.Center||0,R=p?.Right||0;
  const m=Math.max(L,C,R); return m===C?"Neutral":(m===L?"Left":"Right");
}

function gaugeSVG(value){
  const v=clamp(value,-1,1);
  const pct=toPct(v);
  const ang=Math.PI*(1-(v+1)/2), cx=60,cy=60,r=50;
  const x=cx+r*Math.cos(ang), y=cy-r*Math.sin(ang);
  const color=v>=0?"#16a34a":"#f97316";
  return `
    <div class="gauge">
      <svg width="120" height="70" viewBox="0 0 120 70">
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e5e7eb" stroke-width="12"/>
        <path d="M10 60 A50 50 0 0 1 60 10" fill="none" stroke="#16a34a" stroke-width="12"/>
        <path d="M60 10 A50 50 0 0 1 110 60" fill="none" stroke="#f97316" stroke-width="12"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${color}" stroke="#fff" stroke-width="2"/>
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-top:2px">
        <span style="color:#16a34a;font-weight:700">Positive</span>
        <span style="color:#9ca3af;font-weight:700">${pct}%</span>
        <span style="color:#f97316;font-weight:700">Caution</span>
      </div>
    </div>`;
}

function miniMeterHTML(v){
  const pct=toPct(v), cls=v>0.05?"pos":v<-0.05?"neg":"neu";
  return `<div class="mini"><div class="fill ${cls}" style="width:${pct}%"></div></div>`;
}

function setHero(main){
  const s=pick(main);
  const heroImg=document.getElementById("heroImg");
  const img = main.image_url ? `/img?u=${encodeURIComponent(main.image_url)}` : null;
  heroImg.style.backgroundImage = img ? `url(${img})` : "linear-gradient(45deg,#cfd8ff,#e8ecff)";
  document.getElementById("heroTitle").textContent=main.title;
  document.getElementById("heroBias").textContent="Bias: "+biasLabel(main.bias_pct);
  document.getElementById("heroGauge").innerHTML=gaugeSVG(s);
  document.getElementById("heroLink").href=main.url;
}

function addDaily(listEl, items){
  listEl.innerHTML="";
  items.forEach(a=>{
    const li=document.createElement("li");
    li.innerHTML=`<span class="dot"><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></span>${miniMeterHTML(pick(a))}`;
    listEl.appendChild(li);
  });
}

function cardThumb(a){
  if (a.image_url) return `/img?u=${encodeURIComponent(a.image_url)}`;
  return favicon(a.source_domain||"");
}

function addNewsCards(el, items){
  el.innerHTML="";
  items.forEach(a=>{
    const div=document.createElement("div");
    div.className="card";
    const img = cardThumb(a);
    div.innerHTML=`
      <div class="thumb" style="background-image:url(${img})"></div>
      <div>
        <div class="meta">${a.source_name||a.source_domain||""}</div>
        <div class="title"><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></div>
        <div class="meta">${new Date(a.published_at||Date.now()).toLocaleString()}</div>
      </div>`;
    el.appendChild(div);
  });
}

function addSpotlight(el, items){
  el.innerHTML="";
  items.slice(0,2).forEach(a=>{
    const row=document.createElement("div"); row.className="spot-row";
    row.innerHTML=`<div style="max-width:65%"><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></div>`+gaugeSVG(pick(a));
    el.appendChild(row);
  });
}

function addEconomy(el, items){
  el.innerHTML="";
  items.slice(0,6).forEach(a=>{
    const row=document.createElement("div"); row.className="feed-item";
    const img = cardThumb(a);
    row.innerHTML=`
      <div class="thumb" style="background-image:url(${img})"></div>
      <div>
        <div class="title"><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></div>
        <div class="meta">${a.source_name||a.source_domain||""}</div>
      </div>
      <div>${miniMeterHTML(pick(a))}</div>`;
    el.appendChild(row);
  });
}

/* ---------- Date + Stocks ---------- */
function renderDate(){
  const d=new Date();
  const weekday=d.toLocaleString("en-US",{weekday:"long"});
  const day=d.getDate();
  const month=d.toLocaleString("en-US",{month:"long"});
  const year=d.getFullYear();
  document.getElementById("nowDate").textContent = `${weekday}, ${day} ${month} ,${year}`;
}

async function loadStocks(){
  try{
    const r=await fetch("/api/stocks"); const j=await r.json();
    if(!j.ok) return;

    const setChip=(el, label, obj)=>{
      const sign = (obj.change||0) >= 0 ? "▲" : "▼";
      const cls  = (obj.change||0) >= 0 ? "up" : "down";
      const pct  = (obj.percent ?? 0).toFixed(2);
      el.className = `stockchip ${cls}`;
      el.textContent = `${label} ${sign} ${pct}%`;
    };

    setChip(document.getElementById("nseChip"), "NSE", j.nse);
    setChip(document.getElementById("bseChip"), "BSE", j.bse);
  }catch(e){
    // leave default chips
  }
}

/* ---------- Boot ---------- */
async function boot(){
  renderDate();
  loadStocks();

  const res=await fetch("/api/news");
  const data=await res.json();
  if(!data.ok || !data.main){ document.getElementById("heroTitle").textContent="No news loaded."; return; }

  const all=[data.main,...(data.daily||[])].filter(Boolean);
  setHero(data.main);

  const left=(data.daily||[]).slice(0,6);
  const left2=(data.daily||[]).slice(6,12);
  addDaily(document.getElementById("dailyList"), left);
  addDaily(document.getElementById("dailyList2"), left2);

  addNewsCards(document.getElementById("newsCards"), (data.daily||[]).slice(0,3));
  const sorted=[...all].sort((a,b)=>Math.abs(pick(b))-Math.abs(pick(a)));
  addSpotlight(document.getElementById("spotList"), sorted);

  const econ=(data.daily||[]).filter(a=>(a.category||"").match(/business|tech|markets|economy/i));
  addEconomy(document.getElementById("economyList"), econ.length?econ:(data.daily||[]));
}
boot();
