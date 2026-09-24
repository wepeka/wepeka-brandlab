// Vanilla-JS spotlight tour — dims the page, cuts a hole around a real UI
// element, shows a tooltip with Kembali/Tutup/Lanjut. runSpotlightTour() is
// generic (any step list): the onboarding tour below and the per-page
// "belajar sambil ngerjain" guides in js/guides/ all run on it.
//
// Step shape (every field except selector/title optional):
//   selector       string, or an array tried in order (first that resolves wins)
//   title, body    body supports **tebal** → <b>tebal</b> (escaped otherwise)
//   beforeStep     async fn run before the target is looked up
//   interactive    { type: "click" | "clickAny" | "input" | "change" | "until",
//                    extraSelectors, minLength, predicate }
//   skippable      show "Lewati langkah ini" on gated steps (tour keeps going)
//   skipIfMissing  default true — target never appears → move on; false → show
//                  the tooltip centered with no spotlight
//   showIf         fn evaluated first; false → step skipped without waiting
//   chapter        label shown in the progress line ("Bab 1 · 3/6")
//   hint           overrides the default gate hint text
//   waitTimeout    ms to wait for the target (default 4000)
//   placement      "auto" (default) | "top" | "bottom"
//   dim            false → only the ring, no dark strips (e.g. drag-and-drop
//                  onto a grid the user needs to actually see)
//   quiet          true → overlay fully hidden while this step waits on its
//                  gate, so the user can work undisturbed (e.g. reading terms)
//   nextLabel      text for the Lanjut button on this step
//
import { icon } from "./icons.js";
import { listBrands, getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly } from "./account.js";
import { readFlag, writeFlag } from "./seen-flags.js";
import { qsa, escapeHtml } from "./dom.js";
import { t } from "./i18n.js";

const TOUR_COMPLETE_KEY = "contentos:tour-completed:";
// Same account-first / browser-mirror shape as every other "seen once" mark
// (js/seen-flags.js): the account copy follows the person to another device,
// the local one is scoped to their uid so a second account on this browser
// isn't born having "already taken the tour".
const TOUR_SEEN_KEY = "tour:onboarding";

export function hasTourRun() {
  return !!getSettings()?.guideSeen?.[TOUR_SEEN_KEY] || readFlag(TOUR_COMPLETE_KEY);
}

function markTourDone() {
  writeFlag(TOUR_COMPLETE_KEY);
  const seen = getSettings()?.guideSeen || {};
  if (seen[TOUR_SEEN_KEY] || isReadOnly(getCachedAccount())) return;
  updateSettings({ guideSeen: { ...seen, [TOUR_SEEN_KEY]: Date.now() } });
}

function isVisible(el) {
  return !!el && el.getClientRects().length > 0;
}

// Several pages keep two elements with the same id/selector around (a
// hidden one plus a visible one, or the same field in the page and in an
// open drawer) — prefer whichever is actually on screen, and fall back to
// the first plain match so hidden-but-present targets behave as before.
export function resolveTarget(selector) {
  const list = (Array.isArray(selector) ? selector : [selector]).filter(Boolean);
  let firstHidden = null;
  for (const sel of list) {
    let matches;
    try {
      matches = qsa(sel);
    } catch {
      continue;
    }
    const visible = matches.find(isVisible);
    if (visible) return visible;
    if (!firstHidden && matches.length) firstHidden = matches[0];
  }
  return firstHidden;
}

function selectorList(selector) {
  return (Array.isArray(selector) ? selector : [selector]).filter(Boolean);
}

// **x** → <b>x</b>, everything else escaped — tooltip copy is authored in
// code, but escaping keeps a stray "<" in a brand/campaign name harmless.
export function tourRichText(text) {
  return escapeHtml(text || "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

// Polls for `selector` to exist — a step's beforeStep may change the
// route, and the new route's DOM (sometimes Firestore-derived) takes an
// unpredictable moment to actually paint. setInterval rather than
// requestAnimationFrame: rAF fully pauses while the tab is backgrounded,
// which would silently hang a step transition if the tour is mid-navigate
// right when the user switches away and back.
function waitForSelector(selector, { timeout = 4000, interval = 50, isAlive = () => true } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (!isAlive()) { clearInterval(id); resolve(null); return; }
      const el = resolveTarget(selector);
      if (el) { clearInterval(id); resolve(el); return; }
      if (Date.now() - start > timeout) { clearInterval(id); resolve(null); }
    }, interval);
  });
}

function formControlOf(el) {
  if (!el) return null;
  if (el.matches("input, select, textarea")) return el;
  return el.querySelector("input, select, textarea") || el;
}

function defaultChangePredicate(el) {
  if (!el) return false;
  if (el.type === "checkbox" || el.type === "radio") return !!el.checked;
  if (el.tagName === "SELECT") return el.value !== "";
  return true;
}

// Only one spotlight tour can be on screen at a time — starting a second
// (e.g. a section guide auto-playing on a page the onboarding tour just
// navigated to) tears the first one down instead of stacking two dimmed
// layers and two tooltips on top of each other. `keepOnNavigate` is for
// the onboarding tour, which deliberately moves between routes; every
// other tour is scoped to the page it started on and ends when the route
// changes.
let activeTourTeardown = null;
let activeTourKeepsOnNavigate = false;

export function isTourActive() {
  return !!activeTourTeardown;
}

// Returns false (and starts nothing) when the cross-page onboarding tour is
// already running and a page-scoped guide tries to start on top of it —
// the big tour has priority; the small guide gets its chance next visit.
// onFinish(reason): "done" (reached the end) or "closed" (Tutup tur / Esc).
// A route change tears a page-scoped tour down without calling onFinish.
export function runSpotlightTour(steps, { onFinish, keepOnNavigate = false } = {}) {
  if (activeTourTeardown && activeTourKeepsOnNavigate && !keepOnNavigate) return false;
  if (activeTourTeardown) activeTourTeardown();
  activeTourKeepsOnNavigate = keepOnNavigate;
  let index = 0;
  let alive = true;
  let onHashChange = null;
  const shown = []; // indices actually displayed, in order — what Back walks

  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";
  // Four plain strips around the target rect instead of a giant box-shadow
  // spread — cheap, and avoids the compositing glitches that trick is prone
  // to on a fixed element combined with scroll.
  const dimTop = document.createElement("div");
  dimTop.className = "tour-dim";
  const dimBottom = document.createElement("div");
  dimBottom.className = "tour-dim";
  const dimLeft = document.createElement("div");
  dimLeft.className = "tour-dim";
  const dimRight = document.createElement("div");
  dimRight.className = "tour-dim";
  const ring = document.createElement("div");
  ring.className = "tour-highlight-ring";
  const tooltip = document.createElement("div");
  tooltip.className = "tour-tooltip";
  tooltip.innerHTML = `
    <div class="tour-progress"></div>
    <h3></h3>
    <p class="tour-body"></p>
    <p class="tour-hint" data-tour-hint hidden></p>
    <button type="button" class="tour-skip-step" data-tour-skip-step hidden>${t("tour.skipStep")}</button>
    <div class="tour-tooltip-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-tour-back>${icon("chevronLeft", { size: 13 })}${t("common.back")}</button>
      <div class="flex gap-8">
        <button type="button" class="btn btn-secondary btn-sm" data-tour-skip>${t("tour.close")}</button>
        <button type="button" class="btn btn-primary btn-sm" data-tour-next>${t("tour.next")}</button>
      </div>
    </div>
  `;
  overlay.append(dimTop, dimBottom, dimLeft, dimRight, ring, tooltip);
  document.body.appendChild(overlay);
  document.body.classList.add("tour-active");

  let cleanupInteractive = null;
  function clearInteractive() {
    cleanupInteractive?.();
    cleanupInteractive = null;
  }

  let repositionTimer = null;
  function teardown() {
    if (!alive) return;
    alive = false;
    clearInteractive();
    overlay.remove();
    document.body.classList.remove("tour-active");
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("db:change", reposition);
    clearInterval(repositionTimer);
    if (onHashChange) window.removeEventListener("hashchange", onHashChange);
    document.removeEventListener("keydown", onKeyDown);
    if (activeTourTeardown === teardown) activeTourTeardown = null;
  }
  activeTourTeardown = teardown;
  if (!keepOnNavigate) {
    onHashChange = () => teardown();
    window.addEventListener("hashchange", onHashChange);
  }

  // Finishing only tears down and reports back — whether that counts as
  // "the onboarding tour is complete" is the caller's call (startOnboardingTour
  // marks it; section guides must not, or finishing any small guide would
  // silently mark the big tour as done).
  function finish(reason) {
    if (!alive) return;
    teardown();
    onFinish?.(reason);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") finish("closed");
  }

  function setRect(el, top, left, width, height) {
    if (width <= 0 || height <= 0) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.width = width + "px";
    el.style.height = height + "px";
  }

  function position(target, placement = "auto") {
    const rect = target.getBoundingClientRect();
    const pad = 6;
    const box = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setRect(ring, box.top, box.left, box.width, box.height);
    setRect(dimTop, 0, 0, vw, box.top);
    setRect(dimBottom, box.top + box.height, 0, vw, vh - (box.top + box.height));
    setRect(dimLeft, box.top, 0, box.left, box.height);
    setRect(dimRight, box.top, box.left + box.width, vw - (box.left + box.width), box.height);
    // A cap from the previous position must not skew this measurement; keep
    // the tooltip's own scroll offset across the (every 300 ms) reposition.
    const prevScroll = tooltip.scrollTop;
    setTooltipCap(null);
    const tooltipHeight = tooltip.offsetHeight || 180;
    const tooltipWidth = tooltip.offsetWidth || 320;
    const below = box.top + box.height + 14;
    const above = box.top - tooltipHeight - 14;
    const fitsBelow = below + tooltipHeight <= vh - 16;
    const fitsAbove = above >= 16;
    let top;
    let left = Math.min(Math.max(16, box.left), vw - tooltipWidth - 16);
    if (!fitsBelow && !fitsAbove) {
      // Too tall for either side of the target (a long step body on a short
      // screen): stacked on top it would cover the very element the step
      // waits for a click on. Beside the target when there's room;
      // on narrow screens, in the larger free band above/below it, scrolling
      // inside that band.
      const spaceBelow = vh - (box.top + box.height) - 14 - 16;
      const spaceAbove = box.top - 14 - 16;
      if (vw - (box.left + box.width) - 14 >= tooltipWidth + 16 || box.left - 14 >= tooltipWidth + 16) {
        left = vw - (box.left + box.width) - 14 >= tooltipWidth + 16 ? box.left + box.width + 14 : box.left - 14 - tooltipWidth;
        top = Math.min(Math.max(16, box.top), Math.max(16, vh - tooltipHeight - 16));
        if (tooltipHeight > vh - 32) setTooltipCap(vh - 32);
      } else if (Math.max(spaceBelow, spaceAbove) >= 140) {
        top = spaceBelow >= spaceAbove ? below : 16;
        setTooltipCap(Math.max(spaceBelow, spaceAbove));
      } else {
        top = box.top + box.height / 2 < vh / 2 ? Math.max(16, vh - tooltipHeight - 16) : 16;
      }
    } else if (placement === "top") top = fitsAbove ? above : below;
    else if (placement === "bottom") top = fitsBelow ? below : above;
    else top = fitsBelow ? below : above;
    tooltip.style.top = top + "px";
    tooltip.style.left = Math.max(8, left) + "px";
    tooltip.scrollTop = prevScroll;
  }

  function setTooltipCap(px) {
    tooltip.style.maxHeight = px ? `${Math.floor(px)}px` : "";
    tooltip.style.overflowY = px ? "auto" : "";
  }

  // skipIfMissing:false with no target — full dim, no ring, tooltip centered.
  function positionCentered() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setTooltipCap(null);
    ring.style.display = "none";
    setRect(dimTop, 0, 0, vw, vh);
    [dimBottom, dimLeft, dimRight].forEach((d) => (d.style.display = "none"));
    tooltip.style.top = Math.max(16, (vh - (tooltip.offsetHeight || 180)) / 2) + "px";
    tooltip.style.left = Math.max(8, (vw - (tooltip.offsetWidth || 320)) / 2) + "px";
  }

  // A step transition is async (beforeStep may navigate, then it polls for
  // the target to paint) — without this guard, clicking Next again before
  // that settles reads a stale `index` and replays the same step instead
  // of advancing.
  let transitioning = false;
  let nextGated = false; // true while an `interactive` step still needs the real action
  let hideNext = false; // auto-advancing gates (click/clickAny/change/until) hide Lanjut
  const backBtn = tooltip.querySelector("[data-tour-back]");
  const nextBtn = tooltip.querySelector("[data-tour-next]");
  const skipBtn = tooltip.querySelector("[data-tour-skip]");
  const skipStepBtn = tooltip.querySelector("[data-tour-skip-step]");
  const hintEl = tooltip.querySelector("[data-tour-hint]");
  const setHint = (text) => {
    hintEl.hidden = !text;
    hintEl.textContent = text || "";
  };

  // Gates listen at the document (capture phase) and re-resolve the target
  // at event time instead of binding to the element found when the step
  // opened — pages like Creator/Calendar/Campaigns rebuild their whole DOM
  // on every db:change, and a listener on the replaced node would never fire.
  // Advancing is deferred one tick so the page's own handler for the same
  // click runs first (it may open the modal the next step points at).
  function wireInteractive(step) {
    clearInteractive();
    hideNext = false;
    setHint("");
    const it = step.interactive;
    if (!it) {
      nextGated = false;
      return;
    }
    const extra = it.extraSelectors || [];
    const hitsTarget = (node) => {
      for (const sel of [...selectorList(step.selector), ...extra]) {
        const el = resolveTarget(sel);
        if (el && el.contains(node)) return el;
      }
      return null;
    };
    const advance = () =>
      setTimeout(() => {
        if (alive && steps[index] === step && !transitioning) showStep(index + 1);
      }, 0);
    const listen = (type, handler) => {
      document.addEventListener(type, handler, true);
      return () => document.removeEventListener(type, handler, true);
    };
    const kind = it.type;

    if (kind === "click" || kind === "clickAny") {
      nextGated = true;
      hideNext = true;
      setHint(step.hint || (kind === "clickAny" ? t("tour.hint.clickAny") : t("tour.hint.click")));
      const onClick = (e) => {
        if (!(e.target instanceof Element) || tooltip.contains(e.target)) return;
        const hit =
          kind === "clickAny"
            ? [...selectorList(step.selector), ...extra].some((sel) => {
                try {
                  return !!e.target.closest(sel);
                } catch {
                  return false;
                }
              })
            : !!hitsTarget(e.target);
        if (!hit) return;
        clearInteractive();
        advance();
      };
      cleanupInteractive = listen("click", onClick);
    } else if (kind === "input") {
      const minLength = it.minLength ?? 1;
      // The target may be a field's wrapper (so the spotlight also covers its
      // label and AI button) — read the input inside it, not the wrapper.
      const isValid = () => ((formControlOf(resolveTarget(step.selector))?.value || "").trim().length >= minLength);
      const update = () => {
        nextGated = !isValid();
        nextBtn.disabled = nextGated || transitioning;
        setHint(nextGated ? step.hint || t("tour.hint.input") : "");
      };
      update();
      const onInput = (e) => {
        if (hitsTarget(e.target)) update();
      };
      cleanupInteractive = listen("input", onInput);
    } else if (kind === "change") {
      const predicate = it.predicate || defaultChangePredicate;
      const targets = () => [...selectorList(step.selector), ...extra].map(resolveTarget).filter(Boolean);
      const alreadyOk = targets().some((el) => {
        try {
          return predicate(formControlOf(el));
        } catch {
          return false;
        }
      });
      nextGated = !alreadyOk;
      hideNext = !alreadyOk;
      if (!alreadyOk) setHint(step.hint || t("tour.hint.change"));
      const onChange = (e) => {
        if (!(e.target instanceof Element) || !hitsTarget(e.target)) return;
        let ok = false;
        try {
          ok = predicate(e.target);
        } catch {
          ok = false;
        }
        if (!ok) return;
        clearInteractive();
        advance();
      };
      cleanupInteractive = listen("change", onChange);
    } else if (kind === "until") {
      // No timeout on purpose — AI calls can take 10-30s. The step's own
      // skippable link stays available the whole time.
      nextGated = true;
      hideNext = true;
      setHint(step.hint || t("tour.hint.until"));
      let done = false;
      const check = () => {
        if (done) return;
        let ok = false;
        try {
          ok = !!it.predicate?.();
        } catch {
          ok = false;
        }
        if (!ok) return;
        done = true;
        clearInteractive();
        advance();
      };
      const timer = setInterval(check, 300);
      window.addEventListener("db:change", check);
      cleanupInteractive = () => {
        done = true;
        clearInterval(timer);
        window.removeEventListener("db:change", check);
      };
    } else {
      nextGated = false;
    }
  }

  function progressText(i) {
    const step = steps[i];
    if (!step.chapter) return t("tour.progress", { n: i + 1, total: steps.length });
    const same = steps.map((s, idx) => ({ s, idx })).filter(({ s }) => s.chapter === step.chapter);
    const pos = same.findIndex(({ idx }) => idx === i) + 1;
    return `${step.chapter} · ${pos}/${same.length}`;
  }

  function safeShowIf(step) {
    if (!step.showIf) return true;
    try {
      return !!step.showIf();
    } catch (e) {
      console.warn("[tour] showIf failed", e);
      return false;
    }
  }

  async function showStep(i, { back = false } = {}) {
    if (!alive || transitioning) return;
    transitioning = true;
    backBtn.disabled = true;
    nextBtn.disabled = true;
    let then = null;
    // Skipping a step keeps the direction of travel: forward moves on, Back
    // keeps walking back through what was actually shown before.
    const skip = () => (back && shown.length ? () => showStep(shown.pop(), { back: true }) : () => showStep(i + 1));
    try {
      const step = steps[i];
      if (!step) {
        then = () => finish("done");
        return;
      }
      if (!safeShowIf(step)) {
        then = skip();
        return;
      }
      if (step.beforeStep) {
        try {
          await step.beforeStep();
        } catch (e) {
          console.warn("[tour] beforeStep failed", e);
        }
      }
      if (!alive) return;
      let target = resolveTarget(step.selector);
      if (!target) {
        setHint(t("tour.hint.wait"));
        target = await waitForSelector(step.selector, { timeout: step.waitTimeout ?? 4000, isAlive: () => alive });
        if (!alive) return;
      }
      if (!target && step.skipIfMissing !== false) {
        // Target never showed up (e.g. a slow route, or an optional element
        // this brand doesn't have) — move on instead of freezing on a blank
        // spotlight.
        then = skip();
        return;
      }
      index = i;
      shown.push(i);
      overlay.classList.toggle("tour-no-dim", step.dim === false);
      overlay.classList.toggle("tour-quiet", !!step.quiet);
      tooltip.querySelector(".tour-progress").textContent = progressText(i);
      tooltip.querySelector("h3").textContent = step.title || "";
      tooltip.querySelector(".tour-body").innerHTML = tourRichText(step.body);
      backBtn.style.visibility = shown.length > 1 ? "visible" : "hidden";
      nextBtn.textContent = step.nextLabel || (i === steps.length - 1 ? t("tour.done") : t("tour.next"));
      wireInteractive(step);
      nextBtn.style.display = hideNext ? "none" : "";
      skipStepBtn.hidden = !(step.skippable && step.interactive);
      if (target) {
        // The page's own scroll position from a previous step can leave this
        // step's target outside the viewport — bring it into view first.
        target.scrollIntoView({ block: "center", behavior: "instant" });
        position(target, step.placement);
      } else {
        positionCentered();
      }
    } finally {
      transitioning = false;
      if (alive) {
        backBtn.disabled = false;
        nextBtn.disabled = nextGated;
      }
      // Inside finally on purpose: the skip/finish paths above leave via
      // `return`, which would jump straight past any code after this block.
      then?.();
    }
  }

  backBtn.addEventListener("click", () => {
    if (transitioning || shown.length < 2) return;
    shown.pop();
    showStep(shown.pop(), { back: true });
  });
  nextBtn.addEventListener("click", () => {
    if (!transitioning) showStep(index + 1);
  });
  skipStepBtn.addEventListener("click", () => {
    if (!transitioning) showStep(index + 1);
  });
  skipBtn.addEventListener("click", () => finish("closed"));
  document.addEventListener("keydown", onKeyDown);

  // Follows the target when it moves or is re-rendered: on resize/scroll,
  // on every db:change (pages repaint from the store), and on a light timer
  // for repaints that don't go through the store (switching calendar view,
  // selecting a sidebar item).
  let repositionQueued = false;
  function reposition() {
    if (repositionQueued || !alive || transitioning) return;
    repositionQueued = true;
    requestAnimationFrame(() => {
      repositionQueued = false;
      if (!alive || transitioning) return;
      const step = steps[index];
      if (!step) return;
      const target = resolveTarget(step.selector);
      if (target) position(target, step.placement);
      else if (step.skipIfMissing === false) positionCentered();
    });
  }
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("db:change", reposition);
  repositionTimer = setInterval(reposition, 300);

  showStep(0);
  return true;
}

export function startOnboardingTour() {
  const brands = listBrands();
  const hasBrands = brands.length > 0;

  const steps = [];

  // Always start from the all-brands page, whether the tour was launched
  // from Settings, a brand's own page, or anywhere else.
  const goHome = () => { location.hash = "#/"; };

  if (!hasBrands) {
    // Real first-time-ever path: walk them through actually creating their
    // first brand, field by field, gated on the real inputs — not just an
    // FYI tooltip. #add-brand's own click handler (brands.js) opens the
    // modal; nothing extra needed here to trigger it.
    steps.push(
      {
        selector: "#add-brand",
        beforeStep: goHome,
        title: t("tour.onb.addBrand.title"),
        body: t("tour.onb.addBrand.body"),
        interactive: { type: "click", extraSelectors: ["#add-brand-quick"] },
      },
      {
        selector: "#upload-avatar",
        title: t("tour.onb.avatar.title"),
        body: t("tour.onb.avatar.body"),
      },
      {
        selector: "#brand-name",
        title: t("tour.onb.name.title"),
        body: t("tour.onb.name.body"),
        interactive: { type: "input", minLength: 1 },
      },
      {
        // The whole field, not just the textarea — the spotlight used to
        // cut a hole around the box only, leaving the "Bantu tulis pakai
        // AI" button above it dimmed and looking unavailable.
        selector: ["#brand-desc-field", "#brand-description"],
        title: t("tour.onb.desc.title"),
        body: t("tour.onb.desc.body"),
        // Not skippable: the form refuses to save a brand without it (20+
        // characters), so skipping only led to a Save that couldn't work.
        interactive: { type: "input", extraSelectors: ["#brand-description"], minLength: 20 },
      },
      {
        selector: "[data-save]",
        title: t("common.save"),
        body: t("tour.onb.save.body"),
        // Moves on once the brand really exists — a click the form rejects
        // (missing name, too-short description) keeps the tour here.
        interactive: { type: "until", predicate: () => listBrands().length > 0 },
        hint: t("tour.hint.click"),
      }
    );
  } else {
    steps.push({
      selector: ".brand-tile:not(.brand-tile-add)",
      beforeStep: goHome,
      title: t("tour.onb.brands.title"),
      body: t("tour.onb.brands.body"),
      // clickAny: this doubles as the "enter a brand" gate for the rest of
      // the tour (the steps below live inside a brand's own page) — any
      // tile counts, not just the first one spotlighted.
      interactive: { type: "clickAny" },
    });
  }

  // The in-brand steps run on the brand the person just opened (the
  // clickAny gate above) or just created. Pemula lands inside a new brand by
  // itself; Pro stays on the brand list after saving, so the tour walks in —
  // otherwise every step below waited for a page that never came.
  const brandBase = () => {
    const m = location.hash.match(/^#\/brand\/([^/]+)/);
    return m ? `#/brand/${m[1]}` : null;
  };
  const enterBrand = () => {
    if (brandBase()) return;
    const newest = [...listBrands()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (newest) location.hash = `#/brand/${newest.id}`;
  };
  // Back on the brand's home, with the "langkah berikutnya" list open: once
  // every step is done it folds into a closed <details>, and a spotlight on
  // a folded row lands on nothing.
  const goBrandHome = () => {
    enterBrand();
    const base = brandBase();
    if (base && location.hash !== base) location.hash = base;
    return new Promise((r) => setTimeout(r, 60)).then(() => {
      document.querySelector("#beginner-journey.journey-collapsed:not([open])")?.setAttribute("open", "");
    });
  };
  const visible = (sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0);

  // Once inside a brand the tour stays on its home and explains each app
  // from its row there — it doesn't walk people through Builder/Campaign/
  // Konten one after another; each of those pages has its own Video and
  // Panduan buttons for when they actually open it.
  steps.push(
    {
      selector: "#brand-switch-btn",
      showIf: () => listBrands().length > 0,
      beforeStep: enterBrand,
      waitTimeout: 6000,
      title: t("tour.onb.switch.title"),
      body: t("tour.onb.switch.body"),
    },
    {
      selector: '[data-tour="tab-home"]',
      showIf: () => !!brandBase() || listBrands().length > 0,
      title: t("tour.onb.home.title"),
      body: t("tour.onb.home.body"),
    },
    {
      selector: '[data-app="builder"]',
      showIf: () => !!brandBase() || listBrands().length > 0,
      beforeStep: goBrandHome,
      waitTimeout: 6000,
      title: "Brand Builder",
      body: t("tour.onb.builder.body"),
    },
    {
      selector: '[data-app="campaigns"]',
      showIf: () => !!brandBase() || listBrands().length > 0,
      beforeStep: goBrandHome,
      title: t("tour.onb.campaigns.title"),
      body: t("tour.onb.campaigns.body"),
    },
    {
      selector: '[data-app="content-os"]',
      showIf: () => !!brandBase() || listBrands().length > 0,
      beforeStep: goBrandHome,
      title: t("cnt.os.tour.title"),
      body: t("tour.onb.contentOs.body"),
    },
    {
      // The two pills next to the page title — how every later question
      // about a page gets answered.
      selector: ["[data-page-guide-btn]:not([hidden])", "[data-guide-video-btn]:not([hidden])"],
      beforeStep: goBrandHome,
      title: t("tour.onb.help.title"),
      body: t("tour.onb.help.body"),
    },
    {
      // The round chat button hides during tours (it would sit on top of
      // tooltips) — except on the step that is about it.
      selector: "#consultant-fab",
      beforeStep: () => document.body.classList.add("tour-show-chat"),
      title: t("tour.onb.chat.title"),
      body: t("tour.onb.chat.body"),
    },
    {
      // Pro only — Pemula has no bell. Skipped at once instead of waiting.
      selector: '[data-tour="notif-bell"]',
      showIf: () => { document.body.classList.remove("tour-show-chat"); return visible('[data-tour="notif-bell"]'); },
      title: t("tour.onb.notif.title"),
      body: t("tour.onb.notif.body"),
    },
    {
      selector: '[data-tour="updates"]',
      title: t("tour.onb.updates.title"),
      body: t("tour.onb.updates.body"),
    },
    {
      selector: '[data-tour="settings"]',
      title: t("tour.onb.settings.title"),
      body: t("tour.onb.settings.body"),
    }
  );

  runSpotlightTour(steps, {
    keepOnNavigate: true,
    onFinish: () => { document.body.classList.remove("tour-show-chat"); markTourDone(); },
  });
}
