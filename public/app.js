// Localized date (user's locale & timezone)
(function setDate(){
  const el = document.querySelector('.date');
  if(!el) return;
  const now = new Date();
  try {
    el.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch {
    el.textContent = now.toDateString();
  }
})();

// Initialize bars (no needle) -> set labels from data-positive
(function initBars(){
  function setLabels(meter){
    const pos = Math.max(0, Math.min(100, Number(meter.getAttribute('data-positive')) || 50));
    const labels = meter.parentElement.querySelector('.bar-labels');
    if(labels){
      labels.innerHTML = `<span>Positive: ${pos}%</span><span>Caution: ${100 - pos}%</span>`;
    }
  }
  document.querySelectorAll('.bar-meter').forEach(setLabels);
})();

// Optional: build a small “Trending” example from visible news rows
(function buildTrending(){
  const tList = document.getElementById('trending-list');
  const rows = [...document.querySelectorAll('.news-row')];
  if(!tList || !rows.length) return;

  const avg = Math.round(
    rows.reduce((sum, r) => sum + (Number(r.querySelector('.bar-meter').getAttribute('data-positive')) || 50), 0) / rows.length
  );

  const item = document.createElement('div');
  item.className = 'brief-item';
  item.innerHTML = `
    <span>Cricket and Stats</span>
    <div class="bar-wrap">
      <div class="bar-meter tiny" data-positive="${avg}" data-caution="${100-avg}"></div>
      <div class="bar-labels"></div>
    </div>`;
  tList.appendChild(item);

  // Init its labels
  const meter = item.querySelector('.bar-meter');
  if (meter) {
    const labels = item.querySelector('.bar-labels');
    labels.innerHTML = `<span>Positive: ${avg}%</span><span>Caution: ${100-avg}%</span>`;
  }
})();
