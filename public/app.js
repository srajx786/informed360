// frontend v24 — logos used only when no good image

const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const posPctFromSent = (s)=>Math.round(clamp((s+1)/2,0,1)*100);

// === Meter ===
function setMeter(el, positive){
  const pos = Math.max(0, Math.min(100, +positive || 50));
  const caution = 100 - pos;

  const needle = el.querySelector(".needle");
  if (needle) needle.style.left = `${pos}%`;

  const outer = el.parentElement.parentElement;
  let labels = outer.querySelector(":scope > .bar-labels");
  if (!labels) {
    labels = document.createElement("div");
    labels.className = "bar-labels";
    outer.appendChild(labels);
  }
  const w = Math.round(el.getBoundingClientRect().width);
  if (w) labels.style.width = `${w}px`;
  labels.innerHTML = `<div>Positive: ${pos}%</div><div>Caution: ${caution}%</div>`;
}

// === Image URL ===
function imgUrl(a){
  const u = a?.image_url || "";
  if (u.startsWith("/logos/")) return u;   // local logo file
  if (u) return `/img?u=${encodeURIComponent(u)}`;
  return "/images/placeholder.png";
}

// === Render Hero ===
let heroArticles=[], idx=0;
function paintHero(i){
  const a = heroArticles[i]; if(!a) return;
  document.getElementById("heroImg").src = imgUrl(a);
  document.getElementById("heroTitle").innerHTML = `<a target="_blank" href="${a.url}">${a.title}</a>`;
  document.getElementById("heroLink").href = a.url;
  const pos = posPctFromSent(a.sentiment ?? 0);
  setMeter(document.getElementById("heroMeter"), pos);
}
function show(i){ idx=(i+heroArticles.length)%heroArticles.length; paintHero(idx); }

// === Boot ===
async function boot(){
  const r=await fetch("/api/news"); const data=await r.json();
  heroArticles = [data.main].concat(data.items.slice(1,4));
  paintHero(0);
}
boot();
