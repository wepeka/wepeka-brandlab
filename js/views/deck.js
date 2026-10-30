// Pitch Deck (#/brand/:id/deck[/:slide]): why Brandlab exists, then
// Brandlab step by step, as slides. The sixth card on the Beranda launcher
// (js/apps.js). First version (owner, 2026-10-29: "pitchdeck di dalam
// brandlab, sebelah board … step by step pengguna brandlab yang baru, ada
// animasi dan motion kalau next slide atau mouse di hover, ada button yang
// direct menuju ke part itu") was the step tour only; 2026-10-30 he added
// the story in front of it from his Founders Lifetime session brief:
// problem → why we built it → vision → what Brandlab is → why it's different
// → the ecosystem → demo (the step tour) → closing. Every slide has speaker
// notes (N) and the deck can go full screen (F) for presenting live.
//
// Each step slide wears its app's own colour (js/apps.js) and ends in a
// button straight to that part of the brand; the steps the brand has already
// done get a tick. Story slides wear their chapter's colour. The slide number
// lives in the address (replaceState, so no new history entry and no
// re-render), so a reload stays on the slide. Motion lives in css/deck.css:
// slides glide in from the side you're going, their pieces rise one after
// another (--i), the background colour fades to the next slide's, and the
// pictures tilt toward the mouse.
import { getBrand, listContent, listCampaigns } from "../store.js";
import { icon } from "../icons.js";
import { escapeHtml as esc, initials, qs, qsa } from "../dom.js";
import { brandDnaDone, visualBasicsDone, identityDone } from "../brand-progress.js";
import { appByKey, APPS } from "../apps.js";
import { appIconSVG } from "../app-icons.js";
import { getTracker } from "../sales-tracker.js";
import { getCachedAccount, isLifetime, isAdmin, currentUid } from "../account.js";
import { openConsultantPanel } from "../consultant-panel.js";
import { readFlag, writeFlag, clearFlag } from "../seen-flags.js";
import { t } from "../i18n.js";

const DECK = appByKey("deck");
const CHAT_COLORS = { color: "#2FD3C6", color2: "#3B9BFF" };
// The story's chapters, each in its own colours (taken from the apps', so
// the deck stays in the launcher's palette).
const CH = {
  open: { color: "#FFD23F", color2: "#FF9F1C" },
  why: { color: "#FF8A6B", color2: "#FF4F9A" },
  vision: { color: "#30D97D", color2: "#0FA3A3" },
  meet: { color: "#3B9BFF", color2: "#4F55F5" },
  diff: { color: "#A974FF", color2: "#E04FD8" },
  eco: CHAT_COLORS,
};
export const CHAPTERS = ["open", "why", "vision", "meet", "diff", "eco", "demo", "close"];

// One entry per slide, in order. `ch` = its chapter (dk.ch.<ch>); `colors` =
// a story slide's colours, `app` = whose colour and picture a step slide
// wears; `step` = its number on the map; `go` = the button straight to that
// part; `how` = where each of its "Caranya" steps opens (null = no link of
// its own, "chat" = the chat panel), one per step (dk.<key>.h<n> in
// js/i18n/deck.js). Every slide has dk.<key>.notes (speaker notes).
export const SLIDES = [
  { key: "cover", ch: "open", colors: CH.open },
  { key: "welcome", ch: "open", colors: CH.open },
  { key: "problem", ch: "why", colors: CH.why },
  { key: "scatter", ch: "why", colors: CH.why },
  { key: "market", ch: "why", colors: CH.why },
  { key: "whatif", ch: "vision", colors: CH.vision },
  { key: "home", ch: "vision", colors: CH.vision },
  { key: "intro", ch: "meet", colors: CH.meet },
  { key: "ai", ch: "meet", colors: CH.meet },
  { key: "diff", ch: "diff", colors: CH.diff },
  { key: "before", ch: "diff", colors: CH.diff },
  { key: "flow", ch: "diff", colors: CH.diff },
  { key: "eco", ch: "eco", colors: CH.eco },
  { key: "together", ch: "eco", colors: CH.eco },
  { key: "feedback", ch: "eco", colors: CH.eco },
  { key: "map", ch: "demo", app: "deck" },
  { key: "dna", ch: "demo", app: "builder", step: 1, go: (id) => `#/brand/${id}/dna`, how: ["dna", "dna/audience", null, null, "dna/review"] },
  { key: "book", ch: "demo", app: "builder", step: 2, go: (id) => `#/brand/${id}/guidelines`, how: [null, "guidelines/color", "guidelines/typography", "guidelines/logo", "guidelines/review"] },
  { key: "goals", ch: "demo", app: "campaigns", step: 3, go: (id) => `#/brand/${id}/campaigns`, gated: true, how: ["campaigns", null, null, null, null] },
  { key: "create", ch: "demo", app: "content-os", step: 4, go: (id) => `#/brand/${id}/content`, how: ["content", null, null, null, "content/calendar"] },
  { key: "report", ch: "demo", app: "report", step: 5, go: (id) => `#/brand/${id}/report`, how: ["content/list", "report", null, "report", null] },
  { key: "sales", ch: "demo", app: "sales", step: 6, go: (id) => `#/brand/${id}/sales`, how: ["sales", "sales", "sales", null, null] },
  { key: "board", ch: "demo", app: "papan", step: 7, go: (id) => `#/brand/${id}/papan`, how: ["papan", null, null, null, null] },
  { key: "chat", ch: "demo", app: "chat", how: ["chat", null, null, null, null] },
  { key: "loop", ch: "demo", app: "deck", how: ["content/calendar", "", "content/list", "content/list"] },
  { key: "closing", ch: "close", colors: CH.open },
];

const idx = (key) => SLIDES.findIndex((s) => s.key === key);
const colorsOf = (s) => s.colors || (s.app === "chat" ? CHAT_COLORS : appByKey(s.app) || DECK);
const appColors = (key) => { const x = appByKey(key) || DECK; return `--app:${x.color};--app2:${x.color2}`; };
// Lifetime accounts (and the team, presenting) get the Founders wording;
// the keys that differ carry a ".lt" twin in js/i18n/deck.js.
const lk = (ctx, key) => (ctx.lifetime ? `${key}.lt` : key);
const NOTES_FLAG = "deck:notes:";

// What the brand has already done, for the ticks on the map and the slides.
function progressOf(brandId, brand) {
  const content = listContent(brandId);
  const sales = getTracker(brand);
  return {
    dna: brandDnaDone(brand),
    book: visualBasicsDone(brand),
    goals: listCampaigns(brandId).length > 0,
    create: content.length > 0,
    report: content.some((c) => c.status === "published"),
    sales: sales.entries.length > 0,
  };
}

// Small pieces: `a(i)` = a piece that rises in, i-th in line.
const a = (i) => `data-a style="--i:${i}"`;
const eyebrow = (key, i = 0) => `<p class="dk-eyebrow" ${a(i)}>${esc(t(key))}</p>`;
const quote = (key, i) => `<p class="dk-quote" ${a(i)}><span aria-hidden="true">“</span>${esc(t(key))}</p>`;
const pill = (done, locked) =>
  locked ? `<span class="dk-state is-locked">${icon("lock", { size: 13 })}${esc(t("dk.locked"))}</span>`
    : done ? `<span class="dk-state is-done">${icon("check", { size: 13 })}${esc(t("dk.done"))}</span>` : "";
const arrowBtn = (label, attrs, ic = "arrowRight") =>
  `<button type="button" class="dk-btn" ${attrs}>${esc(label)}<span class="dk-btn-dot">${icon(ic, { size: 16 })}</span></button>`;

// "Caranya": the step's own steps in a row on a line that draws itself in;
// under the mouse the line fills up to that step (--upto, wired in render).
// A step with somewhere to go is a link straight there (a locked one opens
// the identity gate instead).
function howHTML(s, ctx, from) {
  const locked = !!s.gated && !ctx.identity;
  const items = s.how.map((to, i) => {
    const n = i + 1;
    const body = `<span class="dk-how-n">${n}</span><b>${esc(t(`dk.${s.key}.h${n}.t`))}</b><span class="dk-how-d">${esc(t(`dk.${s.key}.h${n}.d`))}</span>`;
    const go = `<span class="dk-how-go" aria-hidden="true">${icon(locked ? "lock" : "arrowRight", { size: 13 })}</span>`;
    let inner = `<div class="dk-how-link is-static">${body}</div>`;
    if (to === "chat") inner = `<button type="button" class="dk-how-link" data-chat>${body}${go}</button>`;
    else if (to != null && locked) inner = `<button type="button" class="dk-how-link" data-gate>${body}${go}</button>`;
    else if (to != null) inner = `<a class="dk-how-link" href="#/brand/${ctx.brandId}${to ? `/${to}` : ""}">${body}${go}</a>`;
    return `<li class="dk-how-step" ${a(from + i)}>${inner}</li>`;
  }).join("");
  return `<section class="dk-how" style="--n:${s.how.length}">
    <p class="dk-how-label" ${a(from - 1)}>${esc(t("dk.how"))}</p>
    <ol><span class="dk-how-line" aria-hidden="true"><i></i></span>${items}</ol>
  </section>`;
}

// ---- The pictures on the right of a step: small make-believe screens. ----
function visualHTML(s, ctx) {
  const { brand } = ctx;
  switch (s.key) {
    case "dna":
      return `<div class="dk-device dk-dna">
        <div class="dk-dev-head"><span class="dk-dev-dot"></span><b>Brand DNA</b><span class="dk-ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="dk-ring-fill" cx="18" cy="18" r="15"/></svg></span></div>
        ${[1, 2, 3].map((n) => `<div class="dk-qa" style="--q:${n}"><span class="dk-q">${esc(t(`dk.dna.q${n}`))}</span><span class="dk-a"><i></i><i></i></span></div>`).join("")}
        <span class="dk-spark">${icon("sparkle", { size: 14 })} AI</span>
      </div>`;
    case "book": {
      const logo = brand.brandGuidelines?.logo?.dataUrl || "";
      return `<div class="dk-device dk-book">
        <div class="dk-logo">${/^(data:image|https?:)/.test(logo) ? `<img src="${esc(logo)}" alt="" />` : esc(initials(brand.name))}</div>
        <div class="dk-swatches">${["#FF5F2E", "#FFA52B", "#FFD23F", "#1b1a17", "#fff6e8"].map((c, i) => `<span style="--c:${c};--k:${i}"></span>`).join("")}</div>
        <div class="dk-type"><b>Aa</b><span><i></i><i></i><i></i></span></div>
      </div>`;
    }
    case "goals":
      return `<div class="dk-device dk-goals">
        <div class="dk-kinds">${[["instagram", 1], ["users", 2], ["money", 3], ["calendar", 4]].map(([ic, n]) => `<span class="dk-kind" style="--k:${n}">${icon(ic, { size: 20 })}<b>${esc(t(`dk.goals.k${n}`))}</b></span>`).join("")}</div>
        <div class="dk-goal"><div class="dk-goal-top"><b>${esc(t("dk.goals.demo"))}</b><span>${esc(t("dk.goals.week"))}</span></div><div class="dk-bar"><i></i></div></div>
      </div>`;
    case "create":
      return `<div class="dk-device dk-create">
        <div class="dk-stages">${[1, 2, 3, 4, 5, 6].map((n) => `<span style="--k:${n}">${esc(t(`dk.create.s${n}`))}</span>`).join("")}</div>
        <div class="dk-script"><span class="dk-tag">${esc(t("dk.create.hook"))}</span><i></i><i></i><i></i><span class="dk-tele">${icon("teleprompter", { size: 16 })}</span></div>
      </div>`;
    case "report":
      return `<div class="dk-device dk-report">
        <div class="dk-stats"><span><small>${esc(t("dk.report.views"))}</small><b>12,4K</b></span><span><small>${esc(t("dk.report.er"))}</small><b>8,1%</b></span></div>
        <div class="dk-bars">${[38, 62, 46, 80, 58, 96].map((h, i) => `<i style="--h:${h}%;--k:${i}"></i>`).join("")}</div>
        <span class="dk-pdf">${icon("download", { size: 14 })} PDF</span>
      </div>`;
    case "sales":
      return `<div class="dk-device dk-sales">
        <div class="dk-money">
          <span class="is-in"><small>${icon("arrowUp", { size: 13 })}${esc(t("dk.sales.in"))}</small><b>Rp 4,2 jt</b></span>
          <span class="is-out"><small>${esc(t("dk.sales.out"))}</small><b>Rp 1,1 jt</b></span>
        </div>
        <p class="dk-sales-label">${esc(t("dk.sales.from"))}</p>
        ${[["Instagram", 72], ["WhatsApp", 48], [t("dk.sales.fair"), 30]].map(([name, w], k) => `<div class="dk-chan" style="--w:${w}%;--k:${k}"><span>${esc(name)}</span><i></i></div>`).join("")}
        <span class="dk-xls">${icon("download", { size: 14 })} Excel</span>
      </div>`;
    case "board":
      return `<div class="dk-device dk-board">
        ${[["#FFD23F", -6], ["#FF8FC0", 4], ["#8CC8FF", -3], ["#8EE6B0", 6]].map(([c, r], i) => `<span class="dk-note" style="--c:${c};--r:${r}deg;--k:${i}">${esc(t(`dk.board.n${i + 1}`))}</span>`).join("")}
        <span class="dk-cursor is-you">${cursorSVG()}<b>${esc(t("dk.board.you"))}</b></span>
        <span class="dk-cursor is-team">${cursorSVG()}<b>${esc(t("dk.board.team"))}</b></span>
      </div>`;
    case "chat":
      return `<div class="dk-device dk-chat">
        <div class="dk-dev-head"><span class="dk-dev-dot"></span><b>Tanya Brandlab</b></div>
        <p class="dk-msg is-me">${esc(t("dk.chat.m1"))}</p>
        <p class="dk-msg is-ai">${esc(t("dk.chat.m2"))}</p>
        <p class="dk-msg is-ai is-typing"><i></i><i></i><i></i></p>
      </div>`;
    default:
      return "";
  }
}

const cursorSVG = () => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 2 L17 9 L10 11 L7 18 Z"/></svg>`;
const tileApps = () => APPS.filter((x) => x.key !== "deck");

// ---- Opening. ----
function coverHTML(ctx) {
  const tiles = tileApps().map((x, i) => {
    const target = SLIDES.findIndex((s) => s.app === x.key);
    return `<button type="button" class="dk-tile" data-goto="${target}" style="--app:${x.color};--app2:${x.color2};--k:${i}" aria-label="${esc(t(x.labelKey))}">
      <span class="dk-tile-art">${appIconSVG(x.key)}</span><b>${esc(t(x.labelKey))}</b></button>`;
  }).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      ${eyebrow(lk(ctx, "dk.cover.eyebrow"))}
      <h1 class="dk-h" ${a(1)}>Wepeka Brandlab</h1>
      <p class="dk-tagline" ${a(2)}>${esc(t("dk.cover.tagline"))}</p>
      <p class="dk-lead" ${a(3)}>${esc(t("dk.cover.lead"))}</p>
      <div class="dk-actions" ${a(4)}>
        ${arrowBtn(t("dk.cover.start"), `data-goto="1"`)}
        <button type="button" class="dk-btn is-ghost" data-goto="${idx("map")}">${esc(t("dk.cover.map"))}</button>
      </div>
      <p class="dk-keys" ${a(5)}>${esc(t("dk.keys"))}</p>
    </div>
    <div class="dk-fan" style="--n:${tileApps().length}" ${a(2)}>${tiles}</div>
  </div>`;
}

function welcomeHTML(ctx) {
  // The agenda: one chip per chapter after this one, each a jump.
  const chips = CHAPTERS.slice(1).map((ch, k) => {
    const first = SLIDES.findIndex((s) => s.ch === ch);
    return `<button type="button" class="dk-agenda-chip" data-goto="${first}" style="--k:${k}"><span>${String(k + 1).padStart(2, "0")}</span>${esc(t(`dk.ch.${ch}`))}</button>`;
  }).join("");
  return `<div class="dk-center">
    ${eyebrow(lk(ctx, "dk.welcome.eyebrow"))}
    <h2 class="dk-h" ${a(1)}>${esc(t("dk.welcome.title"))}</h2>
    <p class="dk-lead" ${a(2)}>${esc(t(lk(ctx, "dk.welcome.lead")))}</p>
    <p class="dk-agenda-label" ${a(3)}>${esc(t("dk.welcome.agenda"))}</p>
    <div class="dk-agenda" ${a(4)}>${chips}</div>
  </div>`;
}

// ---- Why we built it. ----
function problemHTML() {
  const cards = [["target", "builder"], ["megaphone", "campaigns"], ["edit", "content-os"], ["wallet", "sales"], ["chart", "report"]].map(([ic, app], k) =>
    `<div class="dk-aspect" style="${appColors(app)};--k:${k}">
      <span class="dk-aspect-ic">${icon(ic, { size: 22 })}</span>
      <b>${esc(t(`dk.problem.a${k + 1}`))}</b>
      <span>${esc(t(`dk.problem.a${k + 1}.q`))}</span>
    </div>`).join("");
  return `<div class="dk-stack">
    ${eyebrow("dk.problem.eyebrow")}
    <h2 class="dk-h" ${a(1)}>${esc(t("dk.problem.title"))}</h2>
    <p class="dk-lead" ${a(2)}>${esc(t("dk.problem.lead"))}</p>
    <div class="dk-aspects" ${a(3)}><span class="dk-aspects-line" aria-hidden="true"></span>${cards}</div>
    <p class="dk-punch" ${a(5)}>${esc(t("dk.problem.punch"))}</p>
  </div>`;
}

function scatterHTML() {
  // Where each piece of the work ends up living, thrown about the picture.
  const bits = [["compass", 8, 10, -8], ["bulb", 56, 4, 6], ["edit", 30, 34, -3], ["calendar", 66, 38, 9], ["money", 6, 62, 5], ["folder", 50, 70, -7], ["chart", 74, 72, 4]];
  const chips = bits.map(([ic, x, y, r], k) =>
    `<span class="dk-bit" style="left:${x}%;top:${y}%;--r:${r}deg;--k:${k}">${icon(ic, { size: 16 })}<b>${esc(t(`dk.scatter.b${k + 1}`))}</b><small>${esc(t(`dk.scatter.b${k + 1}.w`))}</small></span>`).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      ${eyebrow("dk.scatter.eyebrow")}
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.scatter.title"))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.scatter.lead"))}</p>
      ${quote("dk.scatter.quote", 3)}
    </div>
    <div class="dk-visual dk-scatter" ${a(2)}>${chips}
      <span class="dk-q-mark" style="left:40%;top:14%">?</span><span class="dk-q-mark" style="left:22%;top:84%">?</span><span class="dk-q-mark" style="left:86%;top:22%">?</span>
    </div>
  </div>`;
}

function marketHTML() {
  const bubbles = [1, 2, 3, 4, 5, 6].map((n) => `<span class="dk-bubble" style="--k:${n}">${esc(t(`dk.market.q${n}`))}</span>`).join("");
  return `<div class="dk-center">
    ${eyebrow("dk.market.eyebrow")}
    <h2 class="dk-h" ${a(1)}>${esc(t("dk.market.title"))}</h2>
    <div class="dk-bubbles" ${a(2)}>${bubbles}</div>
    <p class="dk-lead" ${a(3)}>${esc(t("dk.market.lead"))}</p>
    ${quote("dk.market.quote", 4)}
  </div>`;
}

// ---- The vision. ----
function whatifHTML() {
  // Six coloured pieces, one per app, fly in from all sides into one block.
  const from = [[-160, -90], [150, -110], [-190, 40], [180, 60], [-70, 120], [90, 130]];
  const dots = tileApps().map((x, k) => `<span class="dk-gather-dot" style="--app:${x.color};--app2:${x.color2};--fx:${from[k % 6][0]}px;--fy:${from[k % 6][1]}px;--k:${k}"></span>`).join("");
  return `<div class="dk-center">
    ${eyebrow("dk.whatif.eyebrow")}
    <div class="dk-gather" ${a(1)} aria-hidden="true">${dots}<span class="dk-gather-core">${icon("layers", { size: 30 })}</span></div>
    <h2 class="dk-h dk-h-q" ${a(2)}>${esc(t("dk.whatif.title"))}</h2>
    <p class="dk-lead" ${a(3)}>${esc(t("dk.whatif.lead"))}</p>
  </div>`;
}

function homeHTML() {
  const rooms = [["target", "builder"], ["flag", "campaigns"], ["megaphone", "campaigns"], ["edit", "content-os"], ["wallet", "sales"], ["chart", "report"]].map(([ic, app], k) =>
    `<span class="dk-room" style="${appColors(app)};--k:${k}">${icon(ic, { size: 18 })}<b>${esc(t(`dk.home.r${k + 1}`))}</b></span>`).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      ${eyebrow("dk.home.eyebrow")}
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.home.title"))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.home.lead"))}</p>
      ${quote("dk.home.quote", 3)}
    </div>
    <div class="dk-visual" ${a(2)}>
      <div class="dk-house">
        <span class="dk-roof"><b>Brandlab</b></span>
        <div class="dk-rooms">${rooms}</div>
        <span class="dk-ground">${esc(t("dk.home.ground"))}</span>
      </div>
    </div>
  </div>`;
}

// ---- Meet Brandlab. ----
function introHTML(ctx) {
  const side = tileApps().map((x, k) => `<span class="dk-ws-item" style="--app:${x.color};--k:${k}"><i></i>${esc(t(x.labelKey))}</span>`).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      ${eyebrow("dk.intro.eyebrow")}
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.intro.title"))}</h2>
      <p class="dk-def" ${a(2)}>${esc(t("dk.intro.def"))}</p>
      <p class="dk-lead" ${a(3)}>${esc(t("dk.intro.lead"))}</p>
    </div>
    <div class="dk-visual" ${a(2)}>
      <div class="dk-device dk-ws">
        <div class="dk-ws-bar"><i></i><i></i><i></i><b>brandlab.wepeka.com</b></div>
        <div class="dk-ws-body">
          <div class="dk-ws-side">${side}</div>
          <div class="dk-ws-main">
            <div class="dk-ws-brand"><span>${esc(initials(ctx.brand.name))}</span><b>${esc(ctx.brand.name)}</b></div>
            <div class="dk-ws-cards"><i></i><i></i><i></i></div>
            <div class="dk-ws-ai">${icon("sparkle", { size: 13 })}<span>${esc(t("dk.intro.ai"))}</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function aiHTML() {
  const chips = [["bulb", 1], ["compass", 2], ["target", 3], ["chart", 4], ["edit", 5], ["clock", 6]].map(([ic, n], k) => {
    const ang = (-90 + k * 60) * Math.PI / 180;
    return `<span class="dk-orbit-chip" style="left:${(50 + 41 * Math.cos(ang)).toFixed(1)}%;top:${(50 + 41 * Math.sin(ang)).toFixed(1)}%;--k:${k}">${icon(ic, { size: 15 })}<b>${esc(t(`dk.ai.c${n}`))}</b></span>`;
  }).join("");
  return `<div class="dk-cols is-flip">
    <div class="dk-visual" ${a(2)}>
      <div class="dk-orbit"><span class="dk-orbit-ring" aria-hidden="true"><i></i></span>${chips}
        <span class="dk-orbit-core">${icon("users", { size: 22 })}<b>${esc(t("dk.ai.core"))}</b></span>
      </div>
    </div>
    <div class="dk-copy">
      ${eyebrow("dk.ai.eyebrow")}
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.ai.title"))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.ai.lead"))}</p>
      ${quote("dk.ai.quote", 3)}
    </div>
  </div>`;
}

// ---- Why it's different. ----
function diffHTML() {
  const cards = ["layers", "sparkle", "grid", "arrowRight", "target", "refresh"].map((ic, k) =>
    `<div class="dk-diff" style="--k:${k}"><span class="dk-diff-n">${String(k + 1).padStart(2, "0")}</span>${icon(ic, { size: 20 })}<b>${esc(t(`dk.diff.d${k + 1}`))}</b><span>${esc(t(`dk.diff.d${k + 1}.d`))}</span></div>`).join("");
  return `<div class="dk-stack">
    ${eyebrow("dk.diff.eyebrow")}
    <h2 class="dk-h" ${a(1)}>${esc(t("dk.diff.title"))}</h2>
    <p class="dk-lead is-wide" ${a(2)}>${esc(t("dk.diff.lead"))}</p>
    <div class="dk-diffs" ${a(3)}>${cards}</div>
    ${quote("dk.diff.quote", 5)}
  </div>`;
}

function beforeHTML() {
  const list = (side, ic) => [1, 2, 3, 4, 5, 6].map((n) => `<li style="--k:${n}">${icon(ic, { size: 14 })}${esc(t(`dk.before.${side}${n}`))}</li>`).join("");
  return `<div class="dk-stack">
    ${eyebrow("dk.before.eyebrow")}
    <h2 class="dk-h" ${a(1)}>${esc(t("dk.before.title"))}</h2>
    <div class="dk-vs" ${a(2)}>
      <section class="dk-vs-side is-before"><h3>${esc(t("dk.before.b"))}</h3><ul>${list("b", "x")}</ul></section>
      <span class="dk-vs-arrow" aria-hidden="true">${icon("arrowRight", { size: 22 })}</span>
      <section class="dk-vs-side is-after"><h3>${esc(t("dk.before.a"))}</h3><ul>${list("a", "check")}</ul></section>
    </div>
    <p class="dk-fine" ${a(4)}>${icon("info", { size: 14 })}${esc(t("dk.before.fine"))}</p>
  </div>`;
}

function flowHTML() {
  // Six parts round one ring, each a jump to the step that shows it.
  const parts = [["builder", "dna"], ["campaigns", "goals"], ["builder", "book"], ["content-os", "create"], ["report", "report"], ["deck", "loop"]];
  const nodes = parts.map(([app, to], k) => {
    const ang = (-90 + k * 60) * Math.PI / 180;
    return `<button type="button" class="dk-flow-node" data-goto="${idx(to)}" style="${appColors(app)};left:${(50 + 40 * Math.cos(ang)).toFixed(1)}%;top:${(50 + 40 * Math.sin(ang)).toFixed(1)}%;--k:${k}" data-tip="${esc(t(`dk.flow.f${k + 1}.d`))}">
      <span>${k + 1}</span><b>${esc(t(`dk.flow.f${k + 1}`))}</b></button>`;
  }).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      ${eyebrow("dk.flow.eyebrow")}
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.flow.title"))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.flow.lead"))}</p>
      <p class="dk-keys" ${a(3)}>${esc(t("dk.flow.hint"))}</p>
    </div>
    <div class="dk-visual" ${a(2)}>
      <div class="dk-flow"><span class="dk-loop-orbit" aria-hidden="true"><i></i></span>${nodes}
        <span class="dk-flow-core">${icon("refresh", { size: 22 })}<b>${esc(t("dk.flow.core"))}</b></span>
      </div>
    </div>
  </div>`;
}

// ---- The ecosystem. ----
function ecoHTML(ctx) {
  const circles = [["grid", 1], ["users", 2], ["calendar", 3]].map(([ic, n]) =>
    `<div class="dk-eco-c is-${n}">${icon(ic, { size: 24 })}<b>${esc(t(`dk.eco.p${n}`))}</b><span>${esc(t(n === 3 ? lk(ctx, "dk.eco.p3.d") : `dk.eco.p${n}.d`))}</span></div>`).join("");
  return `<div class="dk-stack">
    ${eyebrow("dk.eco.eyebrow")}
    <h2 class="dk-h" ${a(1)}>${esc(t("dk.eco.title"))}</h2>
    <p class="dk-lead is-wide" ${a(2)}>${esc(t("dk.eco.lead"))}</p>
    <div class="dk-eco" ${a(3)}>${circles}<span class="dk-eco-you">${esc(t("dk.eco.you"))}</span></div>
  </div>`;
}

function togetherHTML(ctx) {
  const people = ["#FFA52B", "#30D97D", "#3B9BFF", "#A974FF", "#FF4F9A", "#2FD3C6"].map((c, k) => `<span class="dk-face" style="--c:${c};--k:${k}"></span>`).join("");
  const cta = ctx.lifetime
    ? `<a class="dk-btn" href="#/updates/sesi">${esc(t("dk.together.cta"))}<span class="dk-btn-dot">${icon("calendar", { size: 16 })}</span></a>`
    : `<button type="button" class="dk-btn" data-chat>${esc(t("dk.chat.cta"))}<span class="dk-btn-dot">${icon("chat", { size: 16 })}</span></button>`;
  return `<div class="dk-center">
    ${eyebrow("dk.together.eyebrow")}
    <div class="dk-faces" ${a(1)} aria-hidden="true">${people}<span class="dk-face-chat">${icon("chat", { size: 18 })}</span></div>
    <h2 class="dk-h" ${a(2)}>${esc(t("dk.together.title"))}</h2>
    <p class="dk-lead" ${a(3)}>${esc(t(lk(ctx, "dk.together.lead")))}</p>
    <div class="dk-actions is-center" ${a(4)}>${cta}</div>
  </div>`;
}

function feedbackHTML() {
  const next = [1, 2, 3, 4, 5].map((n) => `<li style="--k:${n}"><i></i>${esc(t(`dk.feedback.n${n}`))}</li>`).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      ${eyebrow("dk.feedback.eyebrow")}
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.feedback.title"))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.feedback.lead"))}</p>
      ${quote("dk.feedback.quote", 3)}
      <div class="dk-actions" ${a(4)}>${arrowBtn(t("dk.feedback.cta"), "data-feedback", "send")}</div>
    </div>
    <div class="dk-visual" ${a(2)}>
      <div class="dk-device dk-road">
        <div class="dk-road-in">${icon("comment", { size: 16 })}<span>${esc(t("dk.feedback.in"))}</span></div>
        <p class="dk-sales-label">${esc(t("dk.feedback.next"))}</p>
        <ol>${next}</ol>
      </div>
    </div>
  </div>`;
}

// ---- The demo: the map, then one slide per step. ----
function mapHTML(ctx) {
  const steps = SLIDES.map((s, i) => ({ s, i })).filter(({ s }) => s.step || s.key === "chat" || s.key === "loop");
  const nodes = steps.map(({ s, i }, n) => {
    const c = colorsOf(s);
    const done = ctx.progress[s.key];
    const label = s.step ? t("dk.step", { n: s.step }) : s.key === "chat" ? "AI" : "∞";
    return `<button type="button" class="dk-node${done ? " is-done" : ""}" data-goto="${i}" style="--app:${c.color};--app2:${c.color2};--i:${n + 3}" data-a>
      <span class="dk-node-num">${done ? icon("check", { size: 16 }) : esc(s.step ? String(s.step) : label)}</span>
      <span class="dk-node-kicker">${esc(s.step ? label : t(`dk.${s.key}.eyebrow`).split("·")[0].trim())}</span>
      <b>${esc(t(`dk.${s.key}.title`))}</b>
      <span class="dk-node-go">${icon("arrowRight", { size: 14 })}</span>
    </button>`;
  }).join("");
  return `<div class="dk-map">
    ${eyebrow("dk.map.eyebrow")}
    <h2 class="dk-h" ${a(1)}>${esc(t("dk.map.title"))}</h2>
    <p class="dk-lead" ${a(2)}>${esc(t("dk.map.lead"))}</p>
    <div class="dk-nodes">${nodes}</div>
  </div>`;
}

function stepHTML(s, ctx) {
  const locked = !!s.gated && !ctx.identity;
  const done = ctx.progress[s.key];
  let actions;
  if (s.key === "chat") {
    actions = `<button type="button" class="dk-btn" data-chat>${esc(t("dk.chat.cta"))}<span class="dk-btn-dot">${icon("chat", { size: 16 })}</span></button>`;
  } else if (locked) {
    actions = `<button type="button" class="dk-btn" data-gate>${icon("lock", { size: 15 })}${esc(t(`dk.${s.key}.cta`))}<span class="dk-btn-dot">${icon("arrowRight", { size: 16 })}</span></button>`;
  } else {
    actions = `<a class="dk-btn" href="${s.go(ctx.brandId)}">${esc(t(`dk.${s.key}.cta`))}<span class="dk-btn-dot">${icon("arrowRight", { size: 16 })}</span></a>`;
  }
  if (s.key === "board") actions += `<a class="dk-btn is-ghost" href="#/settings/team">${icon("userPlus", { size: 16 })}${esc(t("dk.board.invite"))}</a>`;
  return `<div class="dk-cols">
    <div class="dk-copy">
      <div class="dk-eyebrow-row" ${a(0)}><p class="dk-eyebrow">${esc(t(`dk.${s.key}.eyebrow`))}</p>${pill(done, locked)}</div>
      <h2 class="dk-h" ${a(1)}>${esc(t(`dk.${s.key}.title`))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t(`dk.${s.key}.lead`))}</p>
      <p class="dk-result" ${a(3)}>${icon("target", { size: 15 })}<span>${esc(t("dk.result"))}:</span> <b>${esc(t(`dk.${s.key}.result`))}</b></p>
      <div class="dk-actions" ${a(4)}>${actions}</div>
    </div>
    <div class="dk-visual" ${a(2)}>
      <span class="dk-visual-art" aria-hidden="true">${appIconSVG(s.app === "chat" ? "" : s.app)}</span>
      ${visualHTML(s, ctx)}
    </div>
  </div>
  ${howHTML(s, ctx, 6)}`;
}

function loopHTML(ctx) {
  // The first step not done yet; all done = back to Beranda.
  const next = SLIDES.find((s) => s.step && s.go && !ctx.progress[s.key] && !(s.gated && !ctx.identity));
  const nextBtn = next
    ? `<a class="dk-btn" href="${next.go(ctx.brandId)}">${esc(t("dk.loop.next", { step: t(`dk.${next.key}.title`) }))}<span class="dk-btn-dot">${icon("arrowRight", { size: 16 })}</span></a>`
    : `<a class="dk-btn" href="#/brand/${ctx.brandId}">${esc(t("dk.loop.allDone"))}<span class="dk-btn-dot">${icon("arrowRight", { size: 16 })}</span></a>`;
  // Clockwise from the top, in step with the dot going round.
  const spots = [[50, 14], [86, 50], [50, 86], [14, 50]];
  const ring = spots.map(([x, y], k) => `<span class="dk-loop-node" style="--k:${k};left:${x}%;top:${y}%"><b>${esc(t(`dk.loop.l${k + 1}`))}</b></span>`).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      ${eyebrow("dk.loop.eyebrow")}
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.loop.title"))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.loop.lead"))}</p>
      <div class="dk-actions" ${a(3)}>${nextBtn}</div>
      <p class="dk-keys" ${a(4)}>${esc(t("dk.loop.note"))}</p>
    </div>
    <div class="dk-loop" ${a(2)}>
      <span class="dk-loop-orbit"><i></i></span>
      ${ring}
      <span class="dk-loop-center">${icon("refresh", { size: 22 })}<b>${esc(t("dk.loop.center"))}</b></span>
    </div>
  </div>
  ${howHTML(SLIDES.find((x) => x.key === "loop"), ctx, 6)}`;
}

// ---- Closing. ----
function closingHTML(ctx) {
  const icons = tileApps().map((x, k) => `<span class="dk-close-ic" style="--app:${x.color};--app2:${x.color2};--k:${k}">${appIconSVG(x.key)}</span>`).join("");
  return `<div class="dk-center">
    <div class="dk-close-row" ${a(0)} aria-hidden="true">${icons}</div>
    <h2 class="dk-h dk-h-xl" ${a(1)}>${esc(t("dk.closing.title"))}</h2>
    <p class="dk-lead" ${a(2)}>${esc(t("dk.closing.lead"))}</p>
    <p class="dk-punch" ${a(3)}>${esc(t("dk.closing.punch"))}</p>
    <div class="dk-actions is-center" ${a(4)}>
      <a class="dk-btn" href="#/brand/${ctx.brandId}">${esc(t("dk.loop.allDone"))}<span class="dk-btn-dot">${icon("arrowRight", { size: 16 })}</span></a>
      <button type="button" class="dk-btn is-ghost" data-goto="0">${icon("refresh", { size: 15 })}${esc(t("dk.loop.again"))}</button>
    </div>
  </div>`;
}

const STORY = {
  cover: coverHTML, welcome: welcomeHTML, problem: problemHTML, scatter: scatterHTML, market: marketHTML,
  whatif: whatifHTML, home: homeHTML, intro: introHTML, ai: aiHTML, diff: diffHTML, before: beforeHTML,
  flow: flowHTML, eco: ecoHTML, together: togetherHTML, feedback: feedbackHTML, map: mapHTML, loop: loopHTML, closing: closingHTML,
};

function slideHTML(s, i, ctx) {
  const body = (STORY[s.key] || ((c) => stepHTML(s, c)))(ctx);
  return `<section class="dk-slide dk-s-${s.key}" data-slide="${i}" aria-roledescription="slide" aria-label="${esc(t("dk.count", { n: i + 1, total: SLIDES.length }))}" aria-hidden="true">${body}</section>`;
}

function slideTitle(s) {
  return s.key === "cover" ? t("dk.title") : t(`dk.${s.key}.title`);
}

// The speaker notes of a slide (the Founders wording where it differs).
const NOTES_LT = new Set(["cover", "welcome", "eco", "together"]);
const notesOf = (s, ctx) => t(NOTES_LT.has(s.key) ? lk(ctx, `dk.${s.key}.notes`) : `dk.${s.key}.notes`);

export function render(root, { brandId, slide = 1 }) {
  const brand = getBrand(brandId);
  if (!brand) { root.innerHTML = ""; return null; }
  const acc = getCachedAccount();
  const ctx = {
    brandId, brand, progress: progressOf(brandId, brand), identity: identityDone(brand),
    lifetime: isLifetime(acc) || isAdmin(currentUid()),
  };
  let index = Math.min(Math.max(1, slide), SLIDES.length) - 1;
  let notesOn = readFlag(NOTES_FLAG, "on");

  // The dots, one group per chapter, so the deck's shape reads at a glance.
  const dotsHTML = CHAPTERS.map((ch) => {
    const dots = SLIDES.map((s, i) => ({ s, i })).filter(({ s }) => s.ch === ch)
      .map(({ s, i }) => `<button type="button" class="dk-dot" data-goto="${i}" data-label="${esc(slideTitle(s))}" aria-label="${esc(t("dk.goSlide", { n: i + 1, title: slideTitle(s) }))}"></button>`).join("");
    return `<span class="dk-dot-group" title="${esc(t(`dk.ch.${ch}`))}">${dots}</span>`;
  }).join("");

  root.innerHTML = `
    <div class="dk${notesOn ? " has-notes" : ""}" style="--dk-a:${colorsOf(SLIDES[index]).color};--dk-b:${colorsOf(SLIDES[index]).color2}">
      <span class="dk-blob dk-blob-1" aria-hidden="true"></span><span class="dk-blob dk-blob-2" aria-hidden="true"></span>
      <header class="dk-top">
        <a class="dk-back" href="#/brand/${brandId}">${icon("chevronLeft", { size: 16 })}${esc(t("dk.back"))}</a>
        <span class="dk-chapter" aria-live="polite"></span>
        <span class="dk-top-title">${esc(t("dk.title"))} · ${esc(brand.name)}</span>
        <button type="button" class="dk-tool" data-notes aria-pressed="${notesOn}" title="${esc(t("dk.notesKey"))}">${icon("comment", { size: 16 })}<span>${esc(t("dk.notes"))}</span></button>
        <button type="button" class="dk-tool" data-full title="${esc(t("dk.fullKey"))}" aria-label="${esc(t("dk.full"))}">${icon("expand", { size: 16 })}</button>
        <span class="dk-count"></span>
      </header>
      <div class="dk-progress" aria-hidden="true"><i></i></div>
      <div class="dk-stage" aria-roledescription="carousel">${SLIDES.map((s, i) => slideHTML(s, i, ctx)).join("")}</div>
      <aside class="dk-notes" aria-label="${esc(t("dk.notes"))}"><b>${esc(t("dk.notes"))}</b><p></p></aside>
      <nav class="dk-nav">
        <button type="button" class="dk-arrow" data-prev aria-label="${esc(t("dk.prev"))}">${icon("chevronLeft", { size: 20 })}</button>
        <div class="dk-dots">${dotsHTML}</div>
        <button type="button" class="dk-arrow is-next" data-next><span>${esc(t("dk.next"))}</span>${icon("chevronRight", { size: 20 })}</button>
      </nav>
    </div>`;

  const deck = qs(".dk", root);
  const slides = qsa(".dk-slide", root);
  const dots = qsa(".dk-dot", root);
  const nextBtn = qs("[data-next]", root);
  const prevBtn = qs("[data-prev]", root);
  const count = qs(".dk-count", root);
  const chapter = qs(".dk-chapter", root);
  const notes = qs(".dk-notes p", root);
  const notesBtn = qs("[data-notes]", root);
  const bar = qs(".dk-progress i", root);

  function show(to, { first = false } = {}) {
    to = Math.min(Math.max(0, to), SLIDES.length - 1);
    if (!first && to === index) return;
    const from = index;
    index = to;
    deck.dataset.dir = to >= from ? "next" : "back";
    slides.forEach((el, i) => {
      el.classList.remove("is-leaving");
      if (i === from && !first && from !== to) {
        el.classList.remove("is-active");
        el.classList.add("is-leaving");
        el.addEventListener("animationend", () => el.classList.remove("is-leaving"), { once: true });
      }
      if (i !== to) { el.classList.remove("is-active"); el.setAttribute("aria-hidden", "true"); el.inert = true; }
    });
    const el = slides[to];
    el.classList.remove("is-active");
    void el.offsetWidth; // replay the entrance on a revisit
    el.classList.add("is-active");
    el.removeAttribute("aria-hidden");
    el.inert = false;
    const c = colorsOf(SLIDES[to]);
    deck.style.setProperty("--dk-a", c.color);
    deck.style.setProperty("--dk-b", c.color2);
    dots.forEach((d, i) => { d.classList.toggle("is-active", i === to); d.classList.toggle("is-past", i < to); });
    count.textContent = t("dk.count", { n: String(to + 1).padStart(2, "0"), total: String(SLIDES.length).padStart(2, "0") });
    chapter.textContent = t(`dk.ch.${SLIDES[to].ch}`);
    notes.textContent = notesOf(SLIDES[to], ctx);
    bar.style.transform = `scaleX(${(to + 1) / SLIDES.length})`;
    prevBtn.disabled = to === 0;
    const last = to === SLIDES.length - 1;
    nextBtn.classList.toggle("is-finish", last);
    qs("span", nextBtn).textContent = t(last ? "dk.finish" : "dk.next");
    // Scrolled down a long slide (phone) and moved on: back to the top of it.
    if (!document.fullscreenElement) {
      const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 64;
      const top = deck.getBoundingClientRect().top;
      if (!first && top < headerH) window.scrollTo({ top: window.scrollY + top - headerH - 12, behavior: "smooth" });
    } else if (!first) deck.scrollTo({ top: 0, behavior: "smooth" });
    const want = `#/brand/${brandId}/deck${to ? `/${to + 1}` : ""}`;
    if (location.hash !== want) history.replaceState(history.state, "", want);
  }

  const toggleNotes = () => {
    notesOn = !notesOn;
    deck.classList.toggle("has-notes", notesOn);
    notesBtn.setAttribute("aria-pressed", String(notesOn));
    (notesOn ? writeFlag : clearFlag)(NOTES_FLAG, "on");
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else deck.requestFullscreen?.().catch(() => {});
  };

  const next = () => (index === SLIDES.length - 1 ? (location.hash = `#/brand/${brandId}`) : show(index + 1));
  const prev = () => show(index - 1);
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);
  root.addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) { e.preventDefault(); show(Number(go.dataset.goto)); return; }
    if (e.target.closest("[data-notes]")) { toggleNotes(); return; }
    if (e.target.closest("[data-full]")) { toggleFull(); return; }
    if (e.target.closest("[data-chat]")) { openConsultantPanel(); return; }
    if (e.target.closest("[data-feedback]")) {
      import("../report-problem.js").then((m) => m.openReportProblem({ kind: "idea", source: "deck" })).catch(() => {});
      return;
    }
    if (e.target.closest("[data-gate]")) {
      import("../layout.js").then((m) => m.explainIdentityGate(brandId)).catch(() => {});
    }
  });
  // Leaving the deck while it's full screen (a link on a slide): leave full
  // screen too, so the app doesn't open inside it.
  root.addEventListener("click", (e) => {
    if (document.fullscreenElement === deck && e.target.closest("a[href^='#/']")) document.exitFullscreen?.().catch(() => {});
  });

  // Keyboard: arrows / Page keys / space, Home and End, N = notes, F = full
  // screen; not while typing or with a dialog or the chat open.
  const onKey = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (document.querySelector(".overlay, dialog[open]")) return;
    if (el && el !== document.body && !root.contains(el)) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || (k === " " && !el?.closest?.("button, a"))) { e.preventDefault(); next(); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); prev(); }
    else if (k === "Home") { e.preventDefault(); show(0); }
    else if (k === "End") { e.preventDefault(); show(SLIDES.length - 1); }
    else if (k === "n" || k === "N") { e.preventDefault(); toggleNotes(); }
    else if (k === "f" || k === "F") { e.preventDefault(); toggleFull(); }
  };
  document.addEventListener("keydown", onKey);

  // Swipe on touch screens: a mostly sideways drag of 50px or more.
  const stage = qs(".dk-stage", root);
  let sx = null, sy = 0;
  stage.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { sx = e.clientX; sy = e.clientY; } });
  stage.addEventListener("pointerup", (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) (dx < 0 ? next : prev)();
  });
  stage.addEventListener("pointercancel", () => { sx = null; });

  // "Caranya": the line fills up to the step under the mouse.
  stage.addEventListener("pointerover", (e) => {
    const li = e.target.closest?.(".dk-how-step");
    const ol = li?.parentElement;
    if (!li || !ol) return;
    const steps = qsa(".dk-how-step", ol);
    const k = steps.indexOf(li);
    ol.style.setProperty("--upto", steps.length > 1 ? String(k / (steps.length - 1)) : "1");
    steps.forEach((x, i) => x.classList.toggle("is-lit", i <= k));
  });
  stage.addEventListener("pointerout", (e) => {
    const ol = e.target.closest?.(".dk-how ol");
    if (!ol || ol.contains(e.relatedTarget)) return;
    ol.style.removeProperty("--upto");
    qsa(".dk-how-step", ol).forEach((x) => x.classList.remove("is-lit"));
  });

  // The pictures lean toward the mouse (--rx/--ry, css .dk-visual).
  const TILT = ".dk-visual, .dk-fan, .dk-loop";
  stage.addEventListener("pointermove", (e) => {
    const v = e.target.closest?.(TILT);
    if (!v || e.pointerType !== "mouse") return;
    const r = v.getBoundingClientRect();
    v.style.setProperty("--ry", `${(((e.clientX - r.left) / r.width) - 0.5) * 12}deg`);
    v.style.setProperty("--rx", `${(0.5 - ((e.clientY - r.top) / r.height)) * 10}deg`);
  });
  stage.addEventListener("pointerout", (e) => {
    const v = e.target.closest?.(TILT);
    if (v && !v.contains(e.relatedTarget)) { v.style.removeProperty("--rx"); v.style.removeProperty("--ry"); }
  });

  show(index, { first: true });
  return () => {
    document.removeEventListener("keydown", onKey);
    if (document.fullscreenElement === deck) document.exitFullscreen?.().catch(() => {});
  };
}
