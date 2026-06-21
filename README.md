# Bible Verse Finder

A simple, mobile-friendly web app to help users find Bible verses from partial memory. It searches multiple Bible versions including KJV, Amplified, and NLT using the API.Bible service.

## Files
- `index.html` — app layout and structure
- `styles.css` — mobile-friendly modern styling
- `script.js` — API integration and search logic

## Usage
1. Open `index.html` in a browser, or run a local server.
2. Paste or type the phrase you remember.
3. Click **Find Verse**.

## Run with local proxy (recommended)
This project now includes a small Express proxy server to keep the API key off the client.

1. Copy `.env.example` to `.env` and set your API key:

```sh
cp .env.example .env
# then edit .env and set SCRIPTURE_API_KEY
```

2. Install dependencies and start the dev server:

```sh
npm install
npm start
```

3. Open the app at `http://localhost:3000/index.html`.

Note: The client-side `script.js` now calls the local `/api` endpoints. The server forwards requests to `api.scripture.api.bible` using the key from `.env`.

For production, replace the dev proxy with a secure backend and never expose API keys in client-side code.

## Image assets
For best performance the app expects optimized background image variants in the project root (optional):

- `bible-bg.avif` (preferred)
- `bible-bg.webp`
- `bible-bg.jpg` (fallback)
- `bible-bg-small.avif` / `bible-bg-small.webp` / `bible-bg-small.jpg` (mobile-optimized)

If you don't provide these, the CSS will fall back to `bible-bg.jpg` for desktop and may use the same image on mobile.

## Testing
The project includes unit tests for utility functions (text normalization, scoring, query building).

Run tests:
```sh
npm test
```

Tests cover:
- `normalizeText()` — whitespace and special character handling
- `cleanSearchInput()` — bracket/brace removal
- `stemSearchWord()` — word stemming
- `buildFallbackQueries()` — query fallback generation
- `scoreMatch()` — verse relevance scoring
- `normalizeVerseId()` — verse reference formatting
- Edge cases (empty inputs, null, invalid formats)
