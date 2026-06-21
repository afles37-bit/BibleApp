Title: Improve search input UX — inline search + clear button

Summary:
Convert the multi-line `textarea` search input into a single-line `input[type=search]` with an inline clear button. Align action buttons inline and tweak spacing so the app is easier to scan and faster to use on desktop and mobile.

Files changed:
- index.html: replaced textarea with single-line input and inline clear button
- styles.css: adjusted search container alignment, input sizing, added `.input-wrap` and `.input-clear` styles
- script.js: added wiring for the inline clear button and updated initialization

Commit message:
feat(search): convert textarea to inline search input and add clear button

Why:
- Single-line search is easier to scan and quicker to use for short queries
- Inline clear button speeds up iterative searching
- Aligning actions horizontally reduces eye travel and improves perceived performance

How to test locally:
1. Serve the folder (e.g. `python3 -m http.server 8000`) and open http://localhost:8000 in your browser.

2. Verify the search control:
   - The input should be a single-line field with placeholder text.
   - Typing shows an inline clear (×) button; clicking it clears the input and focuses it.
   - The `Find Verse` button still submits the form; pressing Enter submits as well.
   - The `Clear` button clears results and status.

3. Verify layout:
   - Input and buttons align horizontally on wider screens.
   - Mobile stacking still works and buttons remain accessible.

Git commands to make this a PR (example):

```bash
git checkout -b feature/inline-search-input
git add index.html styles.css script.js
git commit -m "feat(search): convert textarea to inline search input and add clear button"
git push -u origin feature/inline-search-input
# Then open a pull request on GitHub comparing this branch against main
```

Notes:
- This is a low-risk UI change; no API or data logic was modified.
- If you want, I can also revert to the previous textarea or refine keyboard accessibility next.
