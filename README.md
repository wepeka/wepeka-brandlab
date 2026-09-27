# Wepeka Brandlab

A content planner and performance tracker for managing content across multiple brands — plan, publish, upload insight screenshots, and see automatically what's healthy vs. underperforming.

Plain HTML/CSS/JS, no framework. Firebase/Firestore is the real backend now (see "Login" below) — the `localStorage` note above is historical.

## Run it (dev)

Dev always runs straight from source, unbundled — no build step in the loop:

```bash
python3 serve.py
```

Then open `http://localhost:8743`.

## Production build

Vercel builds the app for every deploy (`vercel.json`'s `buildCommand`, `node scripts/build.mjs` / `npm run build`): esbuild bundles `js/main.js` into a minified, code-split ESM build (hashed filenames, one chunk per route/dynamic import), the three CSS files get hashed filenames too, and `fonts/`, `assets/`, `robots.txt` are copied alongside a rewritten `index.html` — all into `dist/`, which is git-ignored and only ever exists as a build artifact. `api/` (the Vercel serverless functions) and `vercel.json`'s cron stay exactly where they are; Vercel picks them up regardless of `outputDirectory`. Run it locally with `npm run build`, then serve `dist/` with any static server to check the production build before a deploy.

## How it's organized

- `index.html` — shell, loads fonts + one script
- `css/styles.css` — the entire design system (tokens at the top)
- `js/store.js` — all data (brands, content, settings) — the only place that talks to `localStorage`
- `js/formulas.js` — the configurable Engagement Rate / Follower Conversion Rate formulas and the health-rating logic
- `js/ocr.js` — screenshot → metrics extraction (lazy-loads Tesseract.js only when you drop a screenshot)
- `js/auth.js` — Firebase Auth sign-in (see below)
- `js/views/*` — one file per screen (login, brands, dashboard, content list, content editor, creator studio, teleprompter, calendar, analytics, settings)
- `js/main.js` — the router (also gates every route behind login)

## Login

Real authentication via Firebase Auth (project `wepeka-ba996`) — `js/auth.js`
wraps the Firebase web SDK (email+password, Google, and the one-time
custom-token hand-off from wepeka.com's `/brandlab/connect`). Account
creation happens exclusively on wepeka.com (Community sign-up); this screen
only ever signs in to a Firebase user that already exists. `js/account.js`
holds the per-account Firestore doc (`accounts/{uid}`: plan, status,
30-day trial) — a new one is only ever created server-side (wpk-dp's Admin
SDK, after the trial starter mission, or this repo's own Midtrans webhook on
a first-time purchase), never by this client (`firestore.rules`:
`allow create: if false` on `accounts`). See `.claude/handoff-satu-akun.md`
for the full "one Wepeka account across both products" design and its
current rollout status.

## Creator Studio & Teleprompter

The **Creator** tab is a focused writing view: pick a piece of content on the left, edit its title/idea/script/caption/CTA/notes on the right (autosaves as you move between fields), and open the full editor (platform, funnel, schedule, performance, etc.) any time via "Full Editor". Click the script icon next to the Script field to open the **teleprompter** — a centered, dimmed overlay with adjustable scroll speed and text size for reading the script aloud.

## Configuring formulas & thresholds

Settings → Performance Benchmarks. Formulas are plain arithmetic over: `views, reach, likes, comments, shares, saves, profileVisits, followersGained`. Thresholds (Good/Average/Poor) are set independently per funnel stage (TOFU/MOFU/BOFU). Nothing is hard-coded — change these any time and every content record re-evaluates automatically.

## Backup

Settings → Data → Export JSON. Since everything lives in this browser's local storage, export a backup occasionally or before switching browsers/devices.

## Integrating into wepeka.com later

This is self-contained (no globals leak outside `#app` / `#toast-root`, no external CSS framework). To fold it into the main site:

1. Drop the `css/`, `js/` folders and this app's markup under a route like `/brandlab/`.
2. Or embed it as an `<iframe>` pointed at wherever it's hosted — simplest option, guarantees zero CSS collisions with the main site.
3. If merging into an existing build pipeline, the only external network calls are Google Fonts (Fraunces + Inter) and, lazily, Tesseract.js from cdnjs when a screenshot is analyzed — swap either for self-hosted copies if needed.
