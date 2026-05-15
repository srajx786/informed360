import { chromium } from 'playwright';

const checks = [];
async function waitForLogos(page, label, timeoutMs = 15000) {
  const start = Date.now();
  const samples = [];
  while (Date.now() - start < timeoutMs) {
    const snap = await page.evaluate(() => ({
      logoCount: document.querySelectorAll('#sourceSentimentV2 img.source-sentiment-v2-logo').length,
      badgeCount: document.querySelectorAll('#sourceSentimentV2 .badge').length,
      emptyText: document.querySelector('#sourceSentimentV2 .board-empty')?.textContent?.trim() || ''
    }));
    samples.push({ t: Date.now() - start, ...snap });
    if (snap.logoCount > 0) return { ok: true, label, samples };
    await page.waitForTimeout(500);
  }
  return { ok: false, label, samples };
}

function assertCheck(name, pass, details = {}) {
  checks.push({ name, pass, details });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const desktopWait = await waitForLogos(page, 'desktop');

const domChecksDesktop = await page.evaluate(() => {
  const root = document.querySelector('#sourceSentimentV2');
  const text = root?.innerText || '';
  return {
    noLeaderboard: document.querySelector('#leaderboard') === null,
    hasSourceSentimentV2: !!root,
    logoCount: document.querySelectorAll('#sourceSentimentV2 img.source-sentiment-v2-logo').length,
    badgeCount: document.querySelectorAll('#sourceSentimentV2 .badge').length,
    hasFallbackTokens: /\b(W|NN|FN|SS|WP|TV)\b/.test(text)
  };
});

await page.screenshot({ path: 'artifacts/source-v2-desktop.png', fullPage: true });

const mobilePage = await browser.newPage({ viewport: { width: 360, height: 800 } });
await mobilePage.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await mobilePage.waitForTimeout(2000);
const mobileWait = await waitForLogos(mobilePage, 'mobile');

const domChecksMobile = await mobilePage.evaluate(() => {
  const root = document.querySelector('#sourceSentimentV2');
  const text = root?.innerText || '';
  return {
    noLeaderboard: document.querySelector('#leaderboard') === null,
    hasSourceSentimentV2: !!root,
    logoCount: document.querySelectorAll('#sourceSentimentV2 img.source-sentiment-v2-logo').length,
    badgeCount: document.querySelectorAll('#sourceSentimentV2 .badge').length,
    hasFallbackTokens: /\b(W|NN|FN|SS|WP|TV)\b/.test(text)
  };
});

await mobilePage.screenshot({ path: 'artifacts/source-v2-mobile.png', fullPage: true });

assertCheck('desktop: no #leaderboard', domChecksDesktop.noLeaderboard, domChecksDesktop);
assertCheck('desktop: #sourceSentimentV2 exists', domChecksDesktop.hasSourceSentimentV2, domChecksDesktop);
assertCheck('desktop: logo count > 0', domChecksDesktop.logoCount > 0, domChecksDesktop);
assertCheck('desktop: .badge count === 0', domChecksDesktop.badgeCount === 0, domChecksDesktop);
assertCheck('desktop: no fallback tokens', !domChecksDesktop.hasFallbackTokens, domChecksDesktop);

assertCheck('mobile: no #leaderboard', domChecksMobile.noLeaderboard, domChecksMobile);
assertCheck('mobile: #sourceSentimentV2 exists', domChecksMobile.hasSourceSentimentV2, domChecksMobile);
assertCheck('mobile: logo count > 0', domChecksMobile.logoCount > 0, domChecksMobile);
assertCheck('mobile: .badge count === 0', domChecksMobile.badgeCount === 0, domChecksMobile);
assertCheck('mobile: no fallback tokens', !domChecksMobile.hasFallbackTokens, domChecksMobile);

await browser.close();

const summary = {
  domChecksDesktop,
  domChecksMobile,
  waits: { desktopWait, mobileWait },
  checks,
  passed: checks.every((c) => c.pass)
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.passed ? 0 : 1);
