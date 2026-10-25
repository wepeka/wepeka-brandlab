#!/usr/bin/env node
// Builds the Papan canvas (papan/src) into the three files Brandlab serves
// from /papan/: index.html, app.js, app.css — plus papan/version.js, which
// js/views/papan.js imports so a new build always loads fresh. Run it after
// changing anything in papan/src:   node papan/build.mjs
// The files are committed: local dev (serve.py) serves them as they are, and
// scripts/build.mjs copies them into dist/papan/ for production.
//
// The canvas source is the same code as the claude.ai prototype; only the host
// file differs (src/host/host-brandlab.js wires it to js/papan/bridge.js).
// Brandlab's CSP allows no inline script, so app.js is a separate file.
// Both are linked by absolute path: html2canvas (board and deck PDFs) copies
// the page into a blank frame whose base is Brandlab's root, where a
// relative app.css would not resolve and every capture came out unstyled.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(DIR, "src");
const read = (p) => fs.readFile(path.join(SRC, p), "utf8");

// Brandlab's own font files (same as css/styles.css), not inlined copies.
const FONTS = `@font-face{font-family:"Grift Black";src:url("/fonts/grift-black.ttf") format("truetype");font-weight:900;font-display:swap}
@font-face{font-family:"JUST Sans";src:url("/fonts/JUST%20Sans%20Regular.otf") format("opentype");font-weight:400;font-display:swap}
@font-face{font-family:"JUST Sans";src:url("/fonts/JUST%20Sans%20SemiBold.woff2") format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"JUST Sans";src:url("/fonts/JUST%20Sans%20Bold.woff2") format("woff2");font-weight:700;font-display:swap}
@font-face{font-family:"JUST Sans";src:url("/fonts/JUST%20Sans%20ExBold.woff2") format("woff2");font-weight:800;font-display:swap}
html,body{margin:0;height:100%}img{max-width:100%}
`;

async function main() {
  const jsFiles = (await fs.readdir(path.join(SRC, "js"))).filter((f) => f.endsWith(".js")).sort();
  const parts = ['"use strict";'];
  for (const f of ["guest.js", "host-brandlab.js"]) parts.push(`/* ---- ${f} ---- */\n${await read(path.join("host", f))}`);
  for (const f of jsFiles) parts.push(`/* ---- ${f} ---- */\n${await read(path.join("js", f))}`);
  const js = parts.join("\n");
  const css = FONTS + (await read("style.css"));
  const hash = crypto.createHash("sha256").update(js).update(css).digest("hex").slice(0, 12);
  const html = `<!doctype html>
<html lang="id" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Papan · Brandlab</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap">
<link rel="stylesheet" href="/papan/app.css?v=${hash}">
</head>
<body>
${(await read("body.html")).trim()}
<script src="/papan/app.js?v=${hash}"></script>
</body>
</html>
`;
  await fs.writeFile(path.join(DIR, "app.js"), js);
  await fs.writeFile(path.join(DIR, "app.css"), css);
  await fs.writeFile(path.join(DIR, "index.html"), html);
  await fs.writeFile(path.join(DIR, "version.js"), `// Written by papan/build.mjs — do not edit.\nexport const PAPAN_VERSION = "${hash}";\n`);
  console.log(`papan: app.js ${(js.length / 1024).toFixed(0)} KB, app.css ${(css.length / 1024).toFixed(0)} KB, version ${hash}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
