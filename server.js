// server.js — v26 minimal API for Informed360
// Run with: node server.js  (Render: Start command "node server.js")

import express from "express";
import cors from "cors";
app.use(cors());
const app = express();

// --- CORS: allow your GoDaddy site to call this API ---
const ALLOWED = [
  "https://YOUR-FRONTEND-DOMAIN.com",
  "https://www.YOUR-FRONTEND-DOMAIN.com"
];
app.use(cors({ origin: ALLOWED }));

// (Optional) serve static files (logos, placeholder images)
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// --- MARKETS endpoint: JSON shape the UI expects ---
app.get("/api/markets", (_req, res) => {
  // You can later plug real market data here; keep the fields the same.
  res.json({
    ok: true,
    nifty:  { price: 24650.25, percent: 0.34 },
    sensex: { price: 81234.10, percent: -0.12 },
    usdinr: { price: 83.20 }
  });
});

// --- NEWS endpoint: placeholder (wire your real implementation here) ---
app.get("/api/news", (_req, res) => {
  // Minimal stub so the page renders; replace with your merged RSS items.
  const now = new Date().toISOString();
  const demoItem = {
    id: "demo:1",
    title: "Demo article to verify wiring",
    url: "https://example.com",
    source_name: "Demo Source",
    source_domain: "example.com",
    published_at: now,
    sentiment: 0,        // neutral
    image_url: "/images/placeholder.png"
  };
  res.json({ ok: true, main: demoItem, items: [demoItem] });
});

// --- Boot ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
