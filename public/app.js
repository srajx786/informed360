// Minimal front-end to render the API response
function clamp(x,a,b){ return Math.min(b, Math.max(a, x)); }
function toPct(v){ return Math.round(clamp((v+1)/2, 0, 1) * 100); }
function clsFor(v){ return v < -0.05 ? "neg" : v > 0.05 ? "pos" : "neu"; }
function fmtDate(d){ try{ return new Date(d).toLocaleString(); } catch { return ""; } }

function renderCard(el, title, value){
  if (!el) return;
  const pct = toPct(value||0);
  const cls = clsFor(value||0);
  el.innerHTML = `
    <div class="senti-title">${title}</div>
    <div class="senti-value">${pct}%</div>
    <div class="senti-bar"><div class="fill ${cls}" style="width:${pct}%"></div></div>
  `;
}

function biasLabel(p){
  const L=p?.Left||0, C=p?.Center||0, R=p?.Right||0;
  const m=Math.max(L,C,R);
  return m===C ? "Centre" : (m===L ? "Left" : "Right");
}

async function boot(){
  document.querySelector(".date").textContent = new Date().toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  const res = await fetch("/api/news");
  const data = await res.json();

  const root = document.getElementById("mainArticle");
  if (!data.ok || !data.main){ root.textContent = "No news loaded."; return; }
  const main = data.main;

  const L=Math.round((main.bias_pct?.Left||0)*100), C=Math.round((main.bias_pct?.Center||0)*100), R=Math.round((main.bias_pct?.Right||0)*100);

  root.innerHTML = `
    <h1>${main.title}</h1>
    <div class="dek">${main.source_name || main.source_domain || ""}</div>
    <div class="byline"><strong>${main.source_name||main.source_domain||""}</strong> • ${fmtDate(main.published_at)}</div>
    <div class="biasbar">
      <div class="left" style="width:${L}%;"></div>
      <div class="center" style="width:${C}%;"></div>
      <div class="right" style="width:${R}%;"></div>
    </div>
    ${main.summary ? `<p>${main.summary}</p>` : ""}
    <p><a href="${main.url}" target="_blank" rel="noreferrer">Read at source →</a></p>
    <div id="photoSenti" class="senti-card"></div>
  `;
  renderCard(document.getElementById("photoSenti"), "Article sentiment", main.sentiment||0);

  const ul = document.getElementById("dailyList");
  ul.innerHTML = "";
  (data.daily||[]).forEach(item => {
    const pct = toPct(item.sentiment||0);
    const cls = clsFor(item.sentiment||0);
    const li = document.createElement("li");
    li.className = "brief-item";
    li.innerHTML = `<a href="${item.url}" target="_blank" rel="noreferrer">${item.title}</a>
      <div class="mini-bar"><div class="fill ${cls}" style="width:${pct}%"></div></div>`;
    ul.appendChild(li);
  });
}

boot();
