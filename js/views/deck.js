// Pitch Deck (#/brand/:id/deck[/:slide]): Brandlab step by step for a new
// account, as slides (owner, 2026-10-29: "pitchdeck di dalam brandlab,
// sebelah board … step by step pengguna brandlab yang baru, ada animasi dan
// motion kalau next slide atau mouse di hover, ada button yang direct menuju
// ke part itu"). The sixth card on the Beranda launcher (js/apps.js).
//
// Each step slide wears its app's own colour (js/apps.js) and ends in a
// button straight to that part of the brand; the steps the brand has already
// done get a tick. The slide number lives in the address (replaceState, so
// no new history entry and no re-render), so a reload stays on the slide.
// Motion lives in css/deck.css: slides glide in from the side you're going,
// their pieces rise one after another (--i), the background colour fades to
// the next app's, and the mockup on the right tilts toward the mouse.
import { getBrand, listContent, listCampaigns } from "../store.js";
import { icon } from "../icons.js";
import { escapeHtml as esc, initials, qs, qsa } from "../dom.js";
import { brandDnaDone, visualBasicsDone, identityDone } from "../brand-progress.js";
import { appByKey, APPS } from "../apps.js";
import { appIconSVG } from "../app-icons.js";
import { openConsultantPanel } from "../consultant-panel.js";
import { t } from "../i18n.js";

const DECK = appByKey("deck");
const BOARD = appByKey("papan");
const CHAT_COLORS = { color: "#2FD3C6", color2: "#3B9BFF" };

// One entry per slide, in order. `app` = whose colour and picture it wears;
// `step` = its number on the map; `go` = the button straight to that part;
// `how` = where each of its "Caranya" steps opens (null = no link of its own,
// "chat" = the chat panel), one per step (dk.<key>.h<n> in js/i18n/deck.js).
const SLIDES = [
  { key: "cover", app: "deck" },
  { key: "map", app: "deck" },
  { key: "dna", app: "builder", step: 1, go: (id) => `#/brand/${id}/dna`, how: ["dna", "dna/audience", null, null, "dna/review"] },
  { key: "book", app: "builder", step: 2, go: (id) => `#/brand/${id}/guidelines`, how: [null, "guidelines/color", "guidelines/typography", "guidelines/logo", "guidelines/review"] },
  { key: "goals", app: "campaigns", step: 3, go: (id) => `#/brand/${id}/campaigns`, gated: true, how: ["campaigns", null, null, null, null] },
  { key: "create", app: "content-os", step: 4, go: (id) => `#/brand/${id}/content`, how: ["content", null, null, null, "content/calendar"] },
  { key: "report", app: "report", step: 5, go: (id) => `#/brand/${id}/report`, how: ["content/list", "report", null, "report", null] },
  { key: "board", app: "papan", step: 6, go: (id) => `#/brand/${id}/papan`, how: ["papan", null, null, null, null] },
  { key: "chat", app: "chat", how: ["chat", null, null, null, null] },
  { key: "loop", app: "deck", how: ["content/calendar", "", "content/list", "content/list"] },
];

const colorsOf = (s) => (s.app === "chat" ? CHAT_COLORS : appByKey(s.app) || DECK);

// What the brand has already done, for the ticks on the map and the slides.
function progressOf(brandId, brand) {
  const content = listContent(brandId);
  return {
    dna: brandDnaDone(brand),
    book: visualBasicsDone(brand),
    goals: listCampaigns(brandId).length > 0,
    create: content.length > 0,
    report: content.some((c) => c.status === "published"),
  };
}

// Small pieces: `a(i)` = a piece that rises in, i-th in line.
const a = (i) => `data-a style="--i:${i}"`;
const pill = (done, locked) =>
  locked ? `<span class="dk-state is-locked">${icon("lock", { size: 13 })}${esc(t("dk.locked"))}</span>`
    : done ? `<span class="dk-state is-done">${icon("check", { size: 13 })}${esc(t("dk.done"))}</span>` : "";

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

// ---- The pictures on the right: small make-believe screens of each app. ----
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

// ---- Slides. ----
function coverHTML(ctx) {
  const tiles = APPS.filter((x) => x.key !== "deck").map((x, i) => {
    const target = SLIDES.findIndex((s) => s.app === x.key);
    return `<button type="button" class="dk-tile" data-goto="${target}" style="--app:${x.color};--app2:${x.color2};--k:${i}" aria-label="${esc(t(x.labelKey))}">
      <span class="dk-tile-art">${appIconSVG(x.key)}</span><b>${esc(t(x.labelKey))}</b></button>`;
  }).join("");
  return `<div class="dk-cols">
    <div class="dk-copy">
      <p class="dk-eyebrow" ${a(0)}>${esc(t("dk.cover.eyebrow"))}</p>
      <h1 class="dk-h" ${a(1)}>${esc(t("dk.cover.title"))}</h1>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.cover.lead"))}</p>
      <div class="dk-actions" ${a(3)}>
        <button type="button" class="dk-btn" data-goto="2">${esc(t("dk.cover.start"))}<span class="dk-btn-dot">${icon("arrowRight", { size: 16 })}</span></button>
        <button type="button" class="dk-btn is-ghost" data-goto="1">${esc(t("dk.cover.map"))}</button>
      </div>
      <p class="dk-keys" ${a(4)}>${esc(t("dk.keys"))}</p>
    </div>
    <div class="dk-fan" ${a(2)}>${tiles}</div>
  </div>`;
}

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
    <p class="dk-eyebrow" ${a(0)}>${esc(t("dk.map.eyebrow"))}</p>
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
      <p class="dk-eyebrow" ${a(0)}>${esc(t("dk.loop.eyebrow"))}</p>
      <h2 class="dk-h" ${a(1)}>${esc(t("dk.loop.title"))}</h2>
      <p class="dk-lead" ${a(2)}>${esc(t("dk.loop.lead"))}</p>
      <div class="dk-actions" ${a(3)}>${nextBtn}<button type="button" class="dk-btn is-ghost" data-goto="0">${icon("refresh", { size: 15 })}${esc(t("dk.loop.again"))}</button></div>
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

function slideHTML(s, i, ctx) {
  const body = s.key === "cover" ? coverHTML(ctx) : s.key === "map" ? mapHTML(ctx) : s.key === "loop" ? loopHTML(ctx) : stepHTML(s, ctx);
  return `<section class="dk-slide dk-s-${s.key}" data-slide="${i}" aria-roledescription="slide" aria-label="${esc(t("dk.count", { n: i + 1, total: SLIDES.length }))}" aria-hidden="true">${body}</section>`;
}

function slideTitle(s) {
  return s.key === "cover" ? t("dk.title") : t(`dk.${s.key}.title`);
}

export function render(root, { brandId, slide = 1 }) {
  const brand = getBrand(brandId);
  if (!brand) { root.innerHTML = ""; return null; }
  const ctx = { brandId, brand, progress: progressOf(brandId, brand), identity: identityDone(brand) };
  let index = Math.min(Math.max(1, slide), SLIDES.length) - 1;

  root.innerHTML = `
    <div class="dk" style="--dk-a:${colorsOf(SLIDES[index]).color};--dk-b:${colorsOf(SLIDES[index]).color2}">
      <span class="dk-blob dk-blob-1" aria-hidden="true"></span><span class="dk-blob dk-blob-2" aria-hidden="true"></span>
      <header class="dk-top">
        <a class="dk-back" href="#/brand/${brandId}">${icon("chevronLeft", { size: 16 })}${esc(t("dk.back"))}</a>
        <span class="dk-top-title">${esc(t("dk.title"))} · ${esc(brand.name)}</span>
        <span class="dk-count" aria-live="polite"></span>
      </header>
      <div class="dk-progress" aria-hidden="true"><i></i></div>
      <div class="dk-stage" aria-roledescription="carousel">${SLIDES.map((s, i) => slideHTML(s, i, ctx)).join("")}</div>
      <nav class="dk-nav">
        <button type="button" class="dk-arrow" data-prev aria-label="${esc(t("dk.prev"))}">${icon("chevronLeft", { size: 20 })}</button>
        <div class="dk-dots">${SLIDES.map((s, i) => `<button type="button" class="dk-dot" data-goto="${i}" data-label="${esc(slideTitle(s))}" aria-label="${esc(t("dk.goSlide", { n: i + 1, title: slideTitle(s) }))}"></button>`).join("")}</div>
        <button type="button" class="dk-arrow is-next" data-next><span>${esc(t("dk.next"))}</span>${icon("chevronRight", { size: 20 })}</button>
      </nav>
    </div>`;

  const deck = qs(".dk", root);
  const slides = qsa(".dk-slide", root);
  const dots = qsa(".dk-dot", root);
  const nextBtn = qs("[data-next]", root);
  const prevBtn = qs("[data-prev]", root);
  const count = qs(".dk-count", root);
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
    bar.style.transform = `scaleX(${(to + 1) / SLIDES.length})`;
    prevBtn.disabled = to === 0;
    const last = to === SLIDES.length - 1;
    nextBtn.classList.toggle("is-finish", last);
    qs("span", nextBtn).textContent = t(last ? "dk.finish" : "dk.next");
    // Scrolled down a long slide (phone) and moved on: back to the top of it.
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 64;
    const top = deck.getBoundingClientRect().top;
    if (!first && top < headerH) window.scrollTo({ top: window.scrollY + top - headerH - 12, behavior: "smooth" });
    const want = `#/brand/${brandId}/deck${to ? `/${to + 1}` : ""}`;
    if (location.hash !== want) history.replaceState(history.state, "", want);
  }

  const next = () => (index === SLIDES.length - 1 ? (location.hash = `#/brand/${brandId}`) : show(index + 1));
  const prev = () => show(index - 1);
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);
  root.addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) { e.preventDefault(); show(Number(go.dataset.goto)); return; }
    if (e.target.closest("[data-chat]")) { openConsultantPanel(); return; }
    if (e.target.closest("[data-gate]")) {
      import("../layout.js").then((m) => m.explainIdentityGate(brandId)).catch(() => {});
    }
  });

  // Keyboard: arrows / Page keys / space, Home and End; not while typing or
  // with a dialog or the chat open.
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

  // The mockups lean toward the mouse (--rx/--ry, css .dk-visual).
  stage.addEventListener("pointermove", (e) => {
    const v = e.target.closest?.(".dk-visual, .dk-fan, .dk-loop");
    if (!v || e.pointerType !== "mouse") return;
    const r = v.getBoundingClientRect();
    v.style.setProperty("--ry", `${(((e.clientX - r.left) / r.width) - 0.5) * 12}deg`);
    v.style.setProperty("--rx", `${(0.5 - ((e.clientY - r.top) / r.height)) * 10}deg`);
  });
  stage.addEventListener("pointerout", (e) => {
    const v = e.target.closest?.(".dk-visual, .dk-fan, .dk-loop");
    if (v && !v.contains(e.relatedTarget)) { v.style.removeProperty("--rx"); v.style.removeProperty("--ry"); }
  });

  show(index, { first: true });
  return () => document.removeEventListener("keydown", onKey);
}
