const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = 'https://api.scripture.api.bible/v1';
const API_KEY = process.env.SCRIPTURE_API_KEY;

if (!API_KEY) {
  console.warn('WARNING: SCRIPTURE_API_KEY is not set. API requests will fail.');
}

app.use(express.json());

// Serve static files (your frontend) from project root
app.use(express.static(path.resolve(__dirname)));

// Proxy: list bibles
app.get('/api/bibles', async (req, res) => {
  try {
    const r = await fetch(`${API_BASE}/bibles`, {
      headers: { 'api-key': API_KEY }
    });
    const json = await r.json();
    res.status(r.status).json(json);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Proxy: search in a bible
app.get('/api/bibles/:bibleId/search', async (req, res) => {
  const { bibleId } = req.params;
  const { query, limit } = req.query;
  try {
    const url = `${API_BASE}/bibles/${encodeURIComponent(bibleId)}/search?query=${encodeURIComponent(query || '')}${limit ? `&limit=${encodeURIComponent(limit)}` : ''}`;
    const r = await fetch(url, { headers: { 'api-key': API_KEY } });
    const json = await r.json();
    res.status(r.status).json(json);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Proxy: fetch chapter content
app.get('/api/bibles/:bibleId/chapters/:chapterId', async (req, res) => {
  const { bibleId, chapterId } = req.params;
  try {
    const url = `${API_BASE}/bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(chapterId)}`;
    const r = await fetch(url, { headers: { 'api-key': API_KEY } });
    const json = await r.json();
    res.status(r.status).json(json);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Dev proxy server running at http://localhost:${PORT}`);
});
