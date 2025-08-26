// server.js — v27 minimal API (CORS + markets + news stub)
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

/* ✅ Allow ONLY your site */
const ALLOWED = ["https://www.informed360.news"];
app.use(cors({ origin: ALLOWED }));

/* Static (for /logos/* and /images/placeholder.png if you add them) */
app.use(express.static(path.join(__dirname, "public")));

/* Markets endpoint — expected shape */
app.get("/api/markets", (_req, res) => {
  res.json({
    ok: true,
    nifty:  { price: 24650.25, percent: 0.34 },
    sensex: { price: 81234.10, percent: -0.12 },
    usdinr: { price: 83.20 }
  });
});

/* News endpoint — stub so UI renders.
   Replace with your RSS logic later (must keep same keys). */
app.get("/api/news", (_req, res) => {
  const now = new Date().toISOString();
  const demo = (i) => ({
    id: `demo:${i}`,
    title: `Demo article #${i} to verify wiring`,
    url: "https://example.com",
    source_name: "Demo Source",
    source_domain: "example.com",
    published_at: now,
    sentiment: (i%3===0?0.3:(i%3===1?-0.2:0)),
    image_url: "/images/placeholder.png"
  });
  const items = [demo(1), demo(2), demo(3), demo(4), demo(5), demo(6)];
  res.json({ ok: true, main: items[0], items });
});

/* Boot */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on ${PORT}`));
