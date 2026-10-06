#!/usr/bin/env node
// Production build for Vercel (vercel.json's buildCommand). Local dev never
// runs this — serve.py serves js/, css/, etc. straight from source, exactly
// as before. This script only produces dist/: it bundles js/main.js (and
// everything it statically or dynamically imports) into a minified,
// code-split ESM build with esbuild, minifies + hashes the three CSS files, copies
// fonts/assets/robots.txt across, and writes a dist/index.html that points
// at all the hashed filenames.
import { build, transform } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, "dist");
const DIST_JS = path.join(DIST, "js");
const DIST_CSS = path.join(DIST, "css");

// ---------- i18n: each visitor downloads one language, not both ----------
// Source (dev via serve.py / _mharness, and the node tests): js/i18n.js
// imports every js/i18n/*.js dictionary and merges them into one DICT of
// { key: { en, id } } — both languages, ~590 KB. Production only: this build
// reads those same dictionaries once (through js/i18n.js's own
// __i18nSources(), so the merge order is exactly the app's), writes one
// module per language, and swaps the single DICT line in js/i18n.js for a
// top-level await that loads just the active language's chunk. getLang() is
// the same localStorage value the Settings language switch writes right
// before it reloads the page, so a switch still works. Every module that
// imports js/i18n.js (store.js's import-time t() labels included) waits for
// that await, so nothing can render before the strings are there. No call
// site and no dictionary changes; t() runs exactly as written.
const I18N_FILE = path.join(ROOT, "js/i18n.js");
const I18N_DICT_DIR = path.join(ROOT, "js/i18n") + path.sep;
const I18N_SEAM = "const DICT = Object.assign({}, CORE, ...Object.values(EXTRA));";
// The loaded language's text goes under both `en` and `id`, so t()'s
// entry[getLang()] can never come back undefined if another tab switches
// the language before this one reloads (it keeps reading what it loaded).
const I18N_LOAD = [
  'let __lang = "id"; try { __lang = getLang(); } catch { /* storage blocked: default */ }',
  'const DICT = (await (__lang === "en" ? import("wpk-i18n:i18n-en") : import("wpk-i18n:i18n-id"))).default;',
  "for (const k in DICT) DICT[k] = { en: DICT[k], id: DICT[k] };",
].join("\n");
// Modules other than js/i18n.js that import a dictionary file directly get
// both languages, but only the keys they read. js/store.js maps a stored
// milestone label (Indonesian or English text) back to its store.ms.* key,
// and checks a store.msd.* description exists. `uses` is every line of the
// importer that touches the dictionary: if one changes, the build stops so
// someone re-checks the prefixes instead of shipping a silently short
// subset. Any other direct import gets the whole bilingual file (a warning).
const I18N_DIRECT_SUBSETS = {
  "js/store.js": {
    dict: "js/i18n/campaigns.js",
    prefixes: ["store.ms.", "store.msd."],
    uses: [
      "Object.keys(CAMPAIGN_DICT).forEach((k) => {",
      "MS_LABEL_KEYS.set(CAMPAIGN_DICT[k].id, suffix);",
      "if (!MS_LABEL_KEYS.has(CAMPAIGN_DICT[k].en)) MS_LABEL_KEYS.set(CAMPAIGN_DICT[k].en, suffix);",
      "return k && CAMPAIGN_DICT[`store.msd.${k}`] ? t(`store.msd.${k}`) : fallback;",
    ],
  },
};
// Starts the active language's dictionary download in parallel with
// main-*.js (js/i18n.js awaits it before anything renders). Only the data-*
// paths change between builds, never this text, so its CSP hash in
// vercel.json stays valid (checked at the end of main()).
const I18N_PRELOAD_SCRIPT = 'try{var s=document.currentScript,l=document.createElement("link");l.rel="modulepreload";l.href=s.getAttribute(localStorage.getItem("wepeka-lang")==="en"?"data-en":"data-id");document.head.appendChild(l)}catch(e){}';

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const jsonModule = (obj) => `export default JSON.parse(${JSON.stringify(JSON.stringify(obj))});`;

async function i18nSplitPlugin(report) {
  const { __i18nSources } = await import(pathToFileURL(I18N_FILE).href);
  const { core, extra } = __i18nSources();
  const dict = Object.assign({}, core, ...Object.values(extra));
  const perLang = { "i18n-en": {}, "i18n-id": {} };
  for (const [key, entry] of Object.entries(dict)) {
    // Same fallback as t(): entry[lang] || entry.en.
    perLang["i18n-en"][key] = entry.en;
    perLang["i18n-id"][key] = entry.id || entry.en;
    if (!entry.en) report.noEnglish.push(key);
  }
  report.keys = Object.keys(dict).length;
  for (const [name, obj] of Object.entries(perLang)) report[name] = Buffer.byteLength(jsonModule(obj));

  return {
    name: "i18n-per-language",
    setup(b) {
      b.onResolve({ filter: /^wpk-i18n:i18n-(en|id)$/ }, (args) => ({ path: args.path.slice("wpk-i18n:".length), namespace: "wpk-i18n" }));
      b.onLoad({ filter: /.*/, namespace: "wpk-i18n" }, (args) => ({ contents: jsonModule(perLang[args.path]), loader: "js" }));

      b.onResolve({ filter: /i18n\/[^/]+\.js$/ }, (args) => {
        if (!args.importer || !args.resolveDir) return undefined;
        const target = path.resolve(args.resolveDir, args.path);
        if (!target.startsWith(I18N_DICT_DIR)) return undefined;
        // js/i18n.js's own dictionary imports: DICT comes from the
        // per-language chunk now, so these must not pull both languages in.
        if (args.importer === I18N_FILE) return { path: target, namespace: "wpk-i18n-empty" };
        const subset = I18N_DIRECT_SUBSETS[rel(args.importer)];
        if (subset && subset.dict === rel(target)) return { path: target, namespace: "wpk-i18n-subset", pluginData: { subset, importer: args.importer } };
        report.fullDirect.push(`${rel(args.importer)} → ${rel(target)}`);
        return undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "wpk-i18n-empty" }, () => ({ contents: "export default {};", loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "wpk-i18n-subset" }, async (args) => {
        const { subset, importer } = args.pluginData;
        const norm = (s) => s.trim().replace(/\s+/g, " ");
        const src = await fs.readFile(importer, "utf8");
        const binding = src.match(new RegExp(`import\\s+(\\w+)\\s+from\\s+["'][./]*i18n/${path.basename(args.path).replace(".", "\\.")}["']`))?.[1];
        const lines = binding ? src.split("\n").filter((l) => new RegExp(`\\b${binding}\\b`).test(l) && !/^\s*import\s/.test(l)).map(norm) : null;
        if (!lines || lines.join("\n") !== subset.uses.map(norm).join("\n")) {
          throw new Error(`build.mjs: ${rel(importer)} changed how it reads ${subset.dict} directly. Production gives it only the keys starting with ${subset.prefixes.join(" / ")} (I18N_DIRECT_SUBSETS) — check that still covers what it reads, then update that entry's \`uses\` to:\n${(lines || []).join("\n")}`);
        }
        const full = (await import(pathToFileURL(args.path).href)).default;
        const picked = Object.fromEntries(Object.entries(full).filter(([k]) => subset.prefixes.some((p) => k.startsWith(p))));
        return { contents: jsonModule(picked), loader: "js" };
      });

      b.onLoad({ filter: /[\\/]js[\\/]i18n\.js$/, namespace: "file" }, async (args) => {
        if (args.path !== I18N_FILE) return undefined;
        const src = await fs.readFile(args.path, "utf8");
        if (src.split(I18N_SEAM).length !== 2) {
          throw new Error(`build.mjs: js/i18n.js must contain this line exactly once — the production build swaps it for the per-language dictionary load:\n${I18N_SEAM}`);
        }
        return { contents: src.replace(I18N_SEAM, I18N_LOAD), loader: "js" };
      });
    },
  };
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

function shortHash(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);
}

// Copies one file to destDir under "<name>-<contentHash><ext>" and returns
// that new filename (not the full path) — used for the CSS files, whose
// hashed name has to be spliced back into dist/index.html's <link> tags.
// `minifyCss`: run it through esbuild's CSS minifier first (transform API:
// no bundling, so url("../fonts/…") stays exactly as written). The hash is
// taken from the minified bytes, so any real change still renames the file.
async function hashedCopy(srcFile, destDir, { minifyCss = false } = {}) {
  let buf = await fs.readFile(srcFile);
  if (minifyCss) {
    const out = await transform(buf.toString("utf8"), { loader: "css", minify: true, sourcefile: path.basename(srcFile), logLevel: "warning" });
    buf = Buffer.from(out.code, "utf8");
  }
  const ext = path.extname(srcFile);
  const base = path.basename(srcFile, ext);
  const outName = `${base}-${shortHash(buf)}${ext}`;
  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(path.join(destDir, outName), buf);
  return outName;
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  // JS. Every route's view module and every other dynamic import() in the
  // app (js/layout.js's consultant-panel.js/tour.js/guide-videos.js, the
  // ~15 js/views/*.js modules, pdf-libs.js/ocr.js/xlsx-lite.js, etc.) is
  // discovered transitively from js/main.js and split into its own chunk —
  // nothing here has to name them. The only imports esbuild is told NOT to
  // bundle are the three Firebase SDK modules js/firebase.js loads straight
  // from gstatic.com (bare https:// specifiers) — those stay exactly as
  // written and are resolved by the browser at runtime, same as in dev.
  const i18nReport = { noEnglish: [], fullDirect: [] };
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [path.join(ROOT, "js/main.js")],
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    // No public source maps: they'd publish the unminified source, comments
    // and all (quota and billing logic included) next to the bundle.
    sourcemap: false,
    outdir: DIST_JS,
    entryNames: "[name]-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    external: ["https://*"],
    metafile: true,
    logLevel: "info",
    plugins: [await i18nSplitPlugin(i18nReport)],
  });

  // Which hashed file esbuild gave js/main.js's own entry point, so
  // dist/index.html's <script type="module"> can point straight at it.
  let mainEntryFile = null;
  let mainEntryKey = null;
  const i18nChunks = {};
  const outputs = result.metafile.outputs;
  for (const [file, meta] of Object.entries(outputs)) {
    if (meta.entryPoint && path.resolve(ROOT, meta.entryPoint) === path.join(ROOT, "js/main.js")) {
      mainEntryFile = path.relative(DIST_JS, path.resolve(ROOT, file));
      mainEntryKey = file;
    }
    const lang = meta.entryPoint?.match(/^wpk-i18n:i18n-(en|id)$/)?.[1];
    if (lang) {
      // js/i18n.js awaits this chunk at the top level: if it imported any
      // shared chunk back (which may hold js/i18n.js itself), page boot would
      // wait on itself forever. It is plain data, so it must import nothing.
      if ((meta.imports || []).length) throw new Error(`build.mjs: the ${lang} dictionary chunk imports other chunks — it must be self-contained`);
      i18nChunks[lang] = path.relative(DIST_JS, path.resolve(ROOT, file)).split(path.sep).join("/");
    }
  }
  if (!mainEntryFile) {
    throw new Error("build.mjs: could not find js/main.js's own chunk in esbuild's metafile — did the entry point change?");
  }
  if (!i18nChunks.en || !i18nChunks.id) {
    throw new Error("build.mjs: the per-language dictionary chunks are missing from the build — is js/i18n.js still imported by the app?");
  }

  // CSS: hashed filenames rather than a ?v= query, so a stale cached copy
  // can never be served under an unchanged URL after a deploy. Nothing
  // else in the app references these by path (only index.html's own
  // <link> tags, rewritten below), so there's no unhashed copy left around
  // to drift out of sync with these.
  const cssFiles = ["styles.css", "auth.css", "campaign.css"];
  const cssHashed = {};
  for (const name of cssFiles) {
    cssHashed[name] = await hashedCopy(path.join(ROOT, "css", name), DIST_CSS, { minifyCss: true });
  }

  // Fonts and images: copied byte-for-byte. Keeping dist/css/ and
  // dist/fonts/ as siblings of dist/ (same layout as the source css/ and
  // fonts/) means the hashed CSS files' existing `url("../fonts/...")`
  // rules still resolve with no rewriting.
  await copyDir(path.join(ROOT, "fonts"), path.join(DIST, "fonts"));
  await copyDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));
  await fs.copyFile(path.join(ROOT, "robots.txt"), path.join(DIST, "robots.txt"));
  // Reminder service worker (push + notification tap only, no caching) —
  // must sit at the site root, unhashed, for its "/" scope. js/reminders.js
  // registers it only after the owner turns notifications on.
  await fs.copyFile(path.join(ROOT, "sw.js"), path.join(DIST, "sw.js"));
  // debug.html (raw Firestore/account inspection) is a developer-only page
  // — deliberately left out of the production bundle.

  // index.html: identical markup, three swaps for the hashed filenames
  // above (the module entry script + the three stylesheet links). Font
  // preload hrefs are untouched — fonts/ isn't hashed, so they're already
  // correct for dist/ as written.
  let html = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  // The entry's static imports (chunks shared with lazy views) are only
  // discovered once main-*.js has downloaded and parsed; a modulepreload
  // per chunk lets the browser fetch them in parallel with it instead.
  // Walked transitively (a shared chunk can statically import another one
  // the entry doesn't name), so the list always equals what the page loads
  // before main-*.js runs — whatever other modules move behind import().
  // Dynamic import() chunks (the views) are deliberately left out.
  const eager = [];
  const walk = (key) => {
    for (const imp of outputs[key].imports || []) {
      if (imp.kind !== "import-statement" || imp.external || eager.includes(imp.path)) continue;
      eager.push(imp.path);
      walk(imp.path);
    }
  };
  walk(mainEntryKey);
  const preloadTags = eager
    .map((p) => `<link rel="modulepreload" href="js/${path.relative(DIST_JS, path.resolve(ROOT, p)).split(path.sep).join("/")}" />`)
    .join("\n");
  html = html.replace(
    '<script type="module" src="js/main.js"></script>',
    `${preloadTags ? `${preloadTags}\n` : ""}<script type="module" src="js/${mainEntryFile}"></script>`
  );
  // The active language's dictionary chunk (see I18N_PRELOAD_SCRIPT).
  html = html.replace(
    "</head>",
    `<script data-en="js/${i18nChunks.en}" data-id="js/${i18nChunks.id}">${I18N_PRELOAD_SCRIPT}</script>\n</head>`
  );
  for (const name of cssFiles) {
    html = html.replaceAll(`href="css/${name}"`, `href="css/${cssHashed[name]}"`);
  }
  await fs.writeFile(path.join(DIST, "index.html"), html);

  // vercel.json serves everything under /js/ and /css/ with
  // "Cache-Control: immutable" for a year — only safe because every file
  // written there carries a content hash in its name. Fail the build rather
  // than ever ship an unhashed file under those paths.
  const HASHED_NAME = /-[A-Za-z0-9]{8,10}\.(js|css)$/;
  async function assertHashed(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await assertHashed(p);
      else if (!HASHED_NAME.test(entry.name)) throw new Error(`build.mjs: ${path.relative(DIST, p)} has no content hash, but vercel.json caches /js/ and /css/ as immutable`);
    }
  }
  await assertHashed(DIST_JS);
  await assertHashed(DIST_CSS);

  // vercel.json's Content-Security-Policy allows inline <script>s only by
  // their sha256. An edited inline script (the theme bootstrap in
  // index.html, the dictionary preload above) whose hash isn't listed would
  // be silently blocked in production — stop the build instead.
  const vercel = JSON.parse(await fs.readFile(path.join(ROOT, "vercel.json"), "utf8"));
  const csp = (vercel.headers || []).flatMap((h) => h.headers || []).find((h) => h.key.toLowerCase() === "content-security-policy")?.value || "";
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => /^script-src\s/.test(d));
  if (scriptSrc && !scriptSrc.includes("'unsafe-inline'")) {
    for (const [, body] of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const hash = `'sha256-${crypto.createHash("sha256").update(body).digest("base64")}'`;
      if (!scriptSrc.includes(hash)) throw new Error(`build.mjs: dist/index.html has an inline <script> whose hash ${hash} is not in vercel.json's script-src — add it there (and drop the old one), or the browser will refuse to run it:\n${body.slice(0, 120)}`);
    }
  }

  const gz = async (f) => zlib.gzipSync(await fs.readFile(path.join(DIST_JS, f)), { level: 9 }).length;
  console.log(`i18n: ${i18nReport.keys} keys → js/${i18nChunks.en} (${i18nReport["i18n-en"]} B, ${await gz(i18nChunks.en)} B gzip), js/${i18nChunks.id} (${i18nReport["i18n-id"]} B, ${await gz(i18nChunks.id)} B gzip); only the active one loads`);
  if (i18nReport.noEnglish.length) console.warn(`i18n: ${i18nReport.noEnglish.length} key(s) with no English text: ${i18nReport.noEnglish.slice(0, 10).join(", ")}`);
  if (i18nReport.fullDirect.length) console.warn(`i18n: bundled whole (both languages) because imported directly — add to I18N_DIRECT_SUBSETS to trim: ${[...new Set(i18nReport.fullDirect)].join(", ")}`);
  const jsCount = Object.keys(result.metafile.outputs).filter((f) => f.endsWith(".js")).length;
  console.log(`\ndist/ ready — entry js/${mainEntryFile}, ${jsCount} JS chunks (${eager.length} modulepreloaded), CSS: ${Object.values(cssHashed).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
