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
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, "dist");
const DIST_JS = path.join(DIST, "js");
const DIST_CSS = path.join(DIST, "css");

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
  });

  // Which hashed file esbuild gave js/main.js's own entry point, so
  // dist/index.html's <script type="module"> can point straight at it.
  let mainEntryFile = null;
  let mainEntryMeta = null;
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    if (meta.entryPoint && path.resolve(ROOT, meta.entryPoint) === path.join(ROOT, "js/main.js")) {
      mainEntryFile = path.relative(DIST_JS, path.resolve(ROOT, file));
      mainEntryMeta = meta;
      break;
    }
  }
  if (!mainEntryFile) {
    throw new Error("build.mjs: could not find js/main.js's own chunk in esbuild's metafile — did the entry point change?");
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
  // Dynamic import() chunks (the views) are deliberately left out.
  const preloadTags = (mainEntryMeta.imports || [])
    .filter((imp) => imp.kind === "import-statement" && !imp.external)
    .map((imp) => `<link rel="modulepreload" href="js/${path.relative(DIST_JS, path.resolve(ROOT, imp.path)).split(path.sep).join("/")}" />`)
    .join("\n");
  html = html.replace(
    '<script type="module" src="js/main.js"></script>',
    `${preloadTags ? `${preloadTags}\n` : ""}<script type="module" src="js/${mainEntryFile}"></script>`
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

  const jsCount = Object.keys(result.metafile.outputs).filter((f) => f.endsWith(".js")).length;
  console.log(`\ndist/ ready — entry js/${mainEntryFile}, ${jsCount} JS chunks, CSS: ${Object.values(cssHashed).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
