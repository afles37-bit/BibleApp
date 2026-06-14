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

## Local server (optional)
If you want to run it from a local server:

```sh
cd /Users/andrewleslie/ClaudeCode
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## API key
The app is configured to use the provided API key in `script.js`.

> For production, keep API keys secure and avoid embedding them directly in client-side code.
