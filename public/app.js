// Front-end sentiment fallback for consistent UI
import vader from "https://esm.sh/vader-sentiment@1.1.3";

const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const toPct=v=>Math.round(clamp((v+1)/2,0,1)*100);        // -1..+1  ->  0..100
const cls = v => (v >  0.05 ? "pos" : v < -0.05 ? "neg" : "neu"); // not used for mini bars now
const fmt=d=>{try{return new Date(d).toLocaleString()}catch{return ""}};

const compute=(t)=>{
  try{
    const {compound}=vader.SentimentIntensityAnalyzer.polarity_scores(t||"");
    return clamp(compound,-1,1);
  }catch{ return 0; }
};
const pickSent=(item)=>
  typeof item?.sentiment==="number" ? clamp(item.sentiment,-1,1)
  : compute((item?.title||"")+(item?.summary?(". "+item.summary):""));

function card(el,title,val){
  if(!el) return;
  const pct=toPct(val), c=cls(val);
  el.innerHTML = `
    <div class="senti-row">
      <div class="senti-title">${title}</div>
      <div class="senti-val">${pct}%</div>
    </div>
    <div class="bar"><div class="fill ${c}" style="width:${pct}%"></div></div>`;
}

/* NEW: mini-bar markup (gradient track + red indicator) */
function miniBarHTML(score){
  const pct = toPct(score);  // 0..100 position of the red tick
  return `<div class="mini-bar"><span class="indicator" style="left:${pct}%"></span></div>`;
}

async function boot(){
  document.getElementById("today").textContent =
    new Date().toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"});

  const res = await fetch("/api/news");
  const data = await res.json();
  if(!data.ok || !data.main){
    document.getElementById("mainArticle").textContent = "No news loaded.";
    return;
  }

  const main = data.main;
  const bias = main.bias_pct || {Left:.33,Center:.34,Right:.33};
  const L=Math.round((bias.Left||0)*100), C=Math.round((bias.Center||0)*100), R=Math.round((bias.Right||0)*100);
  const sMain = pickSent(main);

  const root = document.getElementById("mainArticle");
  root.innerHTML = `
    <h1>${main.title}</h1>
    <div class="meta"><span class="source">${main.source_name||main.source_domain||""}</span> — ${fmt(main.published_at)}</div>
    <div class="biasbar"><div class="left" style="width:${L}%"></div><div class="center" style="width:${C}%"></div><div class="right" style="width:${R}%"></div></div>
    <p><a href="${main.url}" target="_blank" rel="noreferrer">Read at source →</a></p>
    <div id="photoSenti" class="senti-card"></div>
  `;
  card(document.getElementById("photoSenti"), "Article sentiment", sMain);

  // Daily Briefing (NO dots/labels — just the gradient mini bar)
  const ul = document.getElementById("dailyList"); ul.innerHTML="";
  (data.daily||[]).forEach(it=>{
    const s = pickSent(it);
    const li = document.createElement("li");
    li.innerHTML = `
      <a href="${it.url}" target="_blank" rel="noreferrer">${it.title}</a>
      ${miniBarHTML(s)}
    `;
    ul.appendChild(li);
  });

  // Right-rail meters (keep standard bars with % label)
  const all = [data.main, ...(data.daily||[])].filter(Boolean);
  const topicAvg = (kw)=>{
    const k=kw.toLowerCase();
    const hits = all.filter(a => (a.title||"").toLowerCase().includes(k));
    if(!hits.length) return 0;
    return hits.reduce((sum,a)=>sum+pickSent(a),0)/hits.length;
  };
  card(document.getElementById("sc-topic1"), "Modi (topic)", topicAvg("Modi"));
  card(document.getElementById("sc-topic2"), "Sensex (topic)", topicAvg("Sensex"));
  card(document.getElementById("sc-s1"), "Main article", sMain);
  const dailyAvg = (data.daily||[]).length
    ? (data.daily||[]).reduce((a,b)=>a+pickSent(b),0)/(data.daily||[]).length
    : 0;
  card(document.getElementById("sc-s2"), "Daily average", dailyAvg);

  // Search filter
  const box=document.getElementById("search");
  if(box){
    box.addEventListener("input",()=>{
      const q=box.value.trim().toLowerCase();
      document.querySelectorAll("#dailyList li").forEach(li=>{
        const t=li.querySelector("a")?.textContent.toLowerCase()||"";
        li.style.display = t.includes(q) ? "" : "none";
      });
    });
  }
}

boot();
