// app v14 — Hero slider with high-quality source logos

const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const posPctFromSent = (s)=>Math.round(clamp((s+1)/2,0,1)*100);

/* header/date/ticker */
function setDate(){
  const d=new Date();
  const weekday=d.toLocaleString("en-US",{weekday:"long"});
  const day=d.getDate();
  const month=d.toLocaleString("en-US",{month:"long"});
  const year=d.getFullYear();
  document.getElementById("dateNow").textContent = `${weekday}, ${day} ${month} ,${year}`;
  document.getElementById("yr").textContent = String(year);
}

/* sentiment helpers (same as before) */
function biasLabel(p){ const L=p?.Left||0,C=p?.Center||0,R=p?.Right||0; const m=Math.max(L,C,R); return m===C?"Neutral":(m===L?"Left":"Right"); }
function reasonForCaution(article){
  const pos = posPctFromSent(article?.sentiment ?? 0);
  if (pos < 40) return "Caution because headline leans negative.";
  if (pos <= 60) return "Caution because headline reads mixed/neutral.";
  return "Caution reflects the non-positive share.";
}
function setMeter(el, positive, tipText){
  const pos = clamp(+positive||50,0,100);
  const caution = 100-pos;
  const needle=el.querySelector(".needle");
  if(needle) needle.style.left=`${pos}%`;
  const labels = el.parentElement.querySelector(".bar-labels");
  if(labels){
    labels.innerHTML = `
      <div class="legend-item"><span class="swatch pos"></span> Positive: ${pos}%</div>
      <div class="legend-item"><span class="swatch cau"></span> Caution: ${caution}%</div>`;
  }
  const tip=el.parentElement.querySelector(".tooltiptext");
  if(tip) tip.textContent = tipText || "";
}

/* better image fallback map */
const LOGO_MAP = {
  "thehindu.com":"https://upload.wikimedia.org/wikipedia/commons/5/5c/The_Hindu_logo.svg",
  "indianexpress.com":"https://upload.wikimedia.org/wikipedia/commons/6/6b/Indian_Express_logo.png",
  "hindustantimes.com":"https://upload.wikimedia.org/wikipedia/en/3/3b/Hindustan_Times_logo.png",
  "timesofindia.indiatimes.com":"https://static.toiimg.com/photo/msid-58127550/58127550.jpg",
  "ndtv.com":"https://upload.wikimedia.org/wikipedia/commons/6/69/NDTV_Logo.png",
  "pib.gov.in":"https://pib.gov.in/PressReleaseIframePage.aspx?MenuId=1&Lang=1" // fallback
};
function imgUrl(a){
  if (a.image_url) return `/img?u=${encodeURIComponent(a.image_url)}`;
  const dom=a.source_domain||"";
  if (LOGO_MAP[dom]) return LOGO_MAP[dom];
  return `/img?u=${encodeURIComponent('https://www.google.com/s2/favicons?sz=128&domain='+dom)}`;
}

/* HERO SLIDER */
let heroIndex=0, heroItems=[];
function renderHeroSlide(i){
  const a = heroItems[i];
  if(!a) return;
  document.getElementById("heroTitle").innerHTML = `<a target="_blank" href="${a.url}">${a.title}</a>`;
  document.getElementById("heroLink").href = a.url;
  document.getElementById("heroImg").src = imgUrl(a);
  const pos = posPctFromSent(a.sentiment ?? 0);
  setMeter(document.getElementById("heroMeter"), pos, reasonForCaution(a));
  document.getElementById("biasText").textContent = `Bias: ${biasLabel(a.bias_pct)} • Source ${a.source_name||a.source_domain}`;
}
function startHeroSlider(items){
  heroItems=items.slice(0,4);
  heroIndex=0;
  renderHeroSlide(heroIndex);
  setInterval(()=>{ heroIndex=(heroIndex+1)%heroItems.length; renderHeroSlide(heroIndex); },8000);
}

/* build lists (unchanged) */
function buildNewsList(c,items){ c.innerHTML=""; items.forEach(a=>{ const row=document.createElement("article"); row.className="news-row"; row.innerHTML=`
  <div class="news-thumb" style="background-image:url(${imgUrl(a)})"></div>
  <div class="news-src">${a.source_name||a.source_domain||""}</div>
  <div class="news-time">${new Date(a.published_at).toLocaleString()}</div>
  <h3><a target="_blank" href="${a.url}">${a.title}</a></h3>
  <div class="news-meter"><div class="tooltip"><div class="bar-meter small"><div class="needle"></div></div><div class="tooltiptext"></div></div><div class="bar-labels" style="width:140px"></div></div>`; c.appendChild(row); const pos=posPctFromSent(a.sentiment??0); setMeter(row.querySelector(".bar-meter"),pos,reasonForCaution(a)); }); }
function buildBriefList(c,items){ c.innerHTML=""; items.forEach(a=>{ const div=document.createElement("div"); div.className="brief-item"; const pos=posPctFromSent(a.sentiment??0); div.innerHTML=`
  <span><a target="_blank" href="${a.url}">${a.title}</a></span>
  <div class="tooltip"><div class="bar-meter tiny"><div class="needle"></div></div><div class="tooltiptext"></div></div>
  <div class="bar-labels" style="width:100px"></div>`; c.appendChild(div); setMeter(div.querySelector(".bar-meter"),pos,reasonForCaution(a)); }); }

/* boot */
async function boot(){
  setDate();
  const r=await fetch("/api/news"); const data=await r.json();
  if(!data.ok||!data.items?.length){ document.getElementById("heroTitle").textContent="No news available"; return; }
  startHeroSlider(data.items);
  buildNewsList(document.getElementById("news-list"),data.items.slice(0,12));
  buildBriefList(document.getElementById("brief-right"),data.daily||[]);
}
boot();
