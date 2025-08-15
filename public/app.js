import vader from "https://esm.sh/vader-sentiment@1.1.3";

const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const toPct=v=>Math.round(clamp((v+1)/2,0,1)*100);
const pick=(a)=> typeof a?.sentiment==="number" ? clamp(a.sentiment,-1,1)
  : vader.SentimentIntensityAnalyzer.polarity_scores(((a?.title)||"")+" "+(a?.summary||"")).compound;

function biasLabel(p){
  const L=p?.Left||0,C=p?.Center||0,R=p?.Right||0;
  const m=Math.max(L,C,R); return m===C?"Neutral":(m===L?"Left":"Right");
}

function gaugeSVG(value){
  const v=clamp(value,-1,1);
  const pct=toPct(v);
  const ang = Math.PI * (1 - (v+1)/2); // 0..pi semicircle
  const cx=60, cy=60, r=50;
  const x = cx + r*Math.cos(ang);
  const y = cy - r*Math.sin(ang);
  const color = v>=0 ? "#16a34a" : "#f97316"; // Positive / Caution
  return `
    <div class="gauge">
      <svg width="120" height="70" viewBox="0 0 120 70">
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e5e7eb" stroke-width="12" />
        <path d="M10 60 A50 50 0 0 1 60 10" fill="none" stroke="#16a34a" stroke-width="12" />
        <path d="M60 10 A50 50 0 0 1 110 60" fill="none" stroke="#f97316" stroke-width="12" />
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
  const s = pick(main);
  const heroImg = document.getElementById("heroImg");
  heroImg.style.backgroundImage = main.image_url ? `url(${main.image_url})` : "linear-gradient(45deg,#cfd8ff,#e8ecff)";
  document.getElementById("heroTitle").textContent = main.title;
  document.getElementById("heroBias").textContent = "Bias: " + biasLabel(main.bias_pct);
  document.getElementById("heroGauge").innerHTML = gaugeSVG(s);
  const link = document.getElementById("heroLink");
  link.href = main.url;
}

function addDaily(listEl, items){
  listEl.innerHTML = "";
  items.forEach(a=>{
    const li=document.createElement("li");
    li.innerHTML = `<span class="dot"><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></span>${miniMeterHTML(pick(a))}`;
    listEl.appendChild(li);
  });
}

function addNewsCards(el, items){
  el.innerHTML = "";
  items.forEach(a=>{
    const div=document.createElement("div");
    div.className="card";
    div.innerHTML = `
      <div class="thumb" style="background-image:${a.image_url?`url(${a.image_url})`:"linear-gradient(45deg,#f3f4f6,#e5e7eb)"}"></div>
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
    row.innerHTML=`<div style="max-width:65%"><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></div>` + gaugeSVG(pick(a));
    el.appendChild(row);
  });
}

function addEconomy(el, items){
  el.innerHTML="";
  items.slice(0,6).forEach(a=>{
    const row=document.createElement("div"); row.className="feed-item";
    row.innerHTML=`
      <div class="thumb" style="background-image:${a.image_url?`url(${a.image_url})`:"linear-gradient(45deg,#f3f4f6,#e5e7eb)"}"></div>
      <div>
        <div class="title"><a target="_blank" rel="noreferrer" href="${a.url}">${a.title}</a></div>
        <div class="meta">${a.source_name||a.source_domain||""}</div>
      </div>
      <div>${miniMeterHTML(pick(a))}</div>`;
    el.appendChild(row);
  });
}

async function boot(){
  const res = await fetch("/api/news");
  const data = await res.json();
  if(!data.ok || !data.main){ document.getElementById("heroTitle").textContent="No news loaded."; return;}

  const all=[data.main,...(data.daily||[])].filter(Boolean);
  setHero(data.main);

  const left = (data.daily||[]).slice(0,6);
  const left2 = (data.daily||[]).slice(6,12);
  addDaily(document.getElementById("dailyList"), left);
  addDaily(document.getElementById("dailyList2"), left2);

  addNewsCards(document.getElementById("newsCards"), (data.daily||[]).slice(0,3));
  const sortedByPolar = [...all].sort((a,b)=>Math.abs(pick(b))-Math.abs(pick(a)));
  addSpotlight(document.getElementById("spotList"), sortedByPolar);

  const econ = (data.daily||[]).filter(a=> (a.category||"").match(/business|tech|markets|economy/i));
  addEconomy(document.getElementById("economyList"), econ.length?econ:(data.daily||[]));
}

boot();
