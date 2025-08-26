// server.js — Informed360 API with CORS restricted to your domain

import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const parser = new Parser();

// --- CORS: allow ONLY your frontend domain ---
const ALLOWED = ["https://www.informed360.news"];
app.use(cors({ origin: ALLOWED }));

// --- Serve static files (logos, images, etc) ---
app.use(express.static(path.join(__dirname, "public")));

// --- Demo MARKETS endpoint (replace with live data later) ---
app.get("/api/markets", (_req, res) => {
  res.json({
    ok: true,
    nifty:  { price: 24650.25, percent: 0.34 },
    sensex: { price: 81234.10, percent: -0.12 },
    usdinr: { price: 83.20 }
  });
});

// --- Simple NEWS endpoint (replace with full RSS merging) ---
app.get("/api/news", (_req, res) => {
  const now = new Date().toISOString();
  const demoItem = {
    id: "demo:1",
    title: "Demo article to verify wiring",
    url: "https://example.com",
    source_name: "Demo Source",
    source_domain: "example.com",
    published_at: now,
    sentiment: 0,
    image_url: "/images/placeholder.png"
  };
  res.json({ ok: true, main: demoItem, items: [demoItem] });
});

// --- BOOT ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Informed360 API running on port ${PORT}`);
});
