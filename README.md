# Bible Verse Finder

Bible Verse Finder helps users find half-remembered verses across approved Bible versions using a backend search API.

## Architecture

- Frontend: static files in `public/`
- Backend: Express server in `server.js`
- Core search logic: `search-core.js`
- Tests:
  - `test.js` (utility helpers in `public/utils.js`)
  - `backend.test.js` (backend search/validation/rate limiting/grouping)

## Project Structure

```text
.
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── script.js
│   ├── utils.js
│   ├── bible-bg.png
│   ├── about.html
│   ├── contact.html
│   ├── privacy.html
│   ├── terms.html
│   ├── cookies.html
│   └── how-it-works.html
├── scripts/
│   ├── start-server.sh
│   └── stop-server.sh
├── server.js
├── search-core.js
├── test.js
├── backend.test.js
├── package.json
└── .env.example
```

## Setup

1. Create env file:

```bash
cp .env.example .env
```

2. Set API key in `.env`:

```bash
SCRIPTURE_API_KEY=your_api_key_here
PORT=3000
```

3. Install dependencies and start:

```bash
npm install
npm start
```

4. Open:

```text
http://localhost:3000
```

## NPM Scripts

```bash
npm start      # Start server in foreground
npm run dev    # Same as start
npm run start-bg
npm run stop
npm test       # Runs utility tests + backend tests
```

## API Endpoints

- `GET /api/search?query=...`
  - Validates input
  - Applies fallback query cap
  - Enforces per-IP rate limit
  - Scores and filters results
  - Groups duplicate verses across versions
  - Returns ranked grouped results

- `GET /api/chapters/:bibleId/:chapterId`
  - Returns chapter HTML content
  - Uses in-memory caching

## What Is Implemented

- API key kept server-side via `.env`
- Static serving restricted to `public/`
- Server-side caching for search and chapter content
- Rate limiting and request validation
- Fallback query caps
- Grouped duplicate verse results across versions
- Improved scoring floor (`0` for no-match)
- Legal/monetization scaffold pages linked in footer

## Notes

- In-memory cache/rate limit reset on server restart.
- For production scale, replace in-memory stores with Redis/KV.
- Confirm commercial translation licensing before monetization.
