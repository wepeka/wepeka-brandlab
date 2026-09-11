// Vanilla-JS spotlight tour — dims the page, cuts a hole around a real UI
// element, shows a tooltip with Back/Skip/Next. runSpotlightTour() is kept
// generic (any step list) even though today only one concrete tour exists,
// so a second tour later isn't a rewrite.
import { icon } from "./icons.js";
import { listBrands } from "./store.js";
import { qs } from "./dom.js";

const TOUR_COMPLETE_KEY = "contentos:tour-completed";

export function hasTourRun() {
  return !!localStorage.getItem(TOUR_COMPLETE_KEY);
}

function markTourDone() {
  localStorage.setItem(TOUR_COMPLETE_KEY, "1");
}

// Polls for `selector` to exist — a step's beforeStep may change the
// route, and the new route's DOM (sometimes Firestore-derived) takes an
// unpredictable moment to actually paint. setInterval rather than
// requestAnimationFrame: rAF fully pauses while the tab is backgrounded,
// which would silently hang a step transition if the tour is mid-navigate
// right when the user switches away and back.
function waitForSelector(selector, { timeout = 4000, interval = 50 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      const el = qs(selector);
      if (el) { clearInterval(id); resolve(el); return; }
      if (Date.now() - start > timeout) { clearInterval(id); resolve(null); }
    }, interval);
  });
}

export function runSpotlightTour(steps, { onFinish } = {}) {
  let index = 0;
  let resizeHandler;

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
    <p></p>
    <div class="tour-tooltip-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-tour-back>${icon("chevronLeft", { size: 13 })}Back</button>
      <div class="flex gap-8">
        <button type="button" class="btn btn-secondary btn-sm" data-tour-skip>Skip</button>
        <button type="button" class="btn btn-primary btn-sm" data-tour-next>Next</button>
      </div>
    </div>
  `;
  overlay.append(dimTop, dimBottom, dimLeft, dimRight, ring, tooltip);
  document.body.appendChild(overlay);

  function teardown() {
    overlay.remove();
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      window.removeEventListener("scroll", resizeHandler, true);
    }
    document.removeEventListener("keydown", onKeyDown);
  }

  function finish() {
    markTourDone();
    teardown();
    onFinish?.();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") finish();
  }

  function setRect(el, top, left, width, height) {
    if (width <= 0 || height <= 0) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.width = width + "px";
    el.style.height = height + "px";
  }

  function position(target) {
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
    const tooltipHeight = tooltip.offsetHeight || 180;
    const tooltipWidth = tooltip.offsetWidth || 320;
    let top = box.top + box.height + 14;
    if (top + tooltipHeight > window.innerHeight - 16) top = Math.max(16, box.top - tooltipHeight - 14);
    const left = Math.min(Math.max(16, box.left), window.innerWidth - tooltipWidth - 16);
    tooltip.style.top = top + "px";
    tooltip.style.left = left + "px";
  }

  // A step transition is async (beforeStep may navigate, then it polls for
  // the target to paint) — without this guard, clicking Next again before
  // that settles reads a stale `index` and replays the same step instead
  // of advancing.
  let transitioning = false;
  const backBtn = tooltip.querySelector("[data-tour-back]");
  const nextBtn = tooltip.querySelector("[data-tour-next]");
  const skipBtn = tooltip.querySelector("[data-tour-skip]");

  async function showStep(i) {
    if (transitioning) return;
    transitioning = true;
    backBtn.disabled = true;
    nextBtn.disabled = true;
    try {
      const step = steps[i];
      if (!step) { finish(); return; }
      if (step.beforeStep) await step.beforeStep();
      const target = await waitForSelector(step.selector);
      if (!target) {
        // Target never showed up (e.g. a slow route) — don't get stuck, just
        // move on rather than leaving the tour frozen on a blank spotlight.
        transitioning = false;
        showStep(i + 1);
        return;
      }
      index = i;
      position(target);
      tooltip.querySelector(".tour-progress").textContent = `Step ${i + 1} of ${steps.length}`;
      tooltip.querySelector("h3").textContent = step.title;
      tooltip.querySelector("p").textContent = step.body;
      backBtn.style.visibility = i === 0 ? "hidden" : "visible";
      nextBtn.textContent = i === steps.length - 1 ? "Done" : "Next";
    } finally {
      transitioning = false;
      backBtn.disabled = false;
      nextBtn.disabled = false;
    }
  }

  backBtn.addEventListener("click", () => showStep(Math.max(0, index - 1)));
  nextBtn.addEventListener("click", () => showStep(index + 1));
  skipBtn.addEventListener("click", finish);
  document.addEventListener("keydown", onKeyDown);

  let repositionQueued = false;
  resizeHandler = () => {
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(() => {
      repositionQueued = false;
      const step = steps[index];
      if (!step) return;
      const target = qs(step.selector);
      if (target) position(target);
    });
  };
  window.addEventListener("resize", resizeHandler);
  window.addEventListener("scroll", resizeHandler, true);

  showStep(0);
}

export function startOnboardingTour() {
  const brands = listBrands();
  const firstBrandId = brands[0]?.id;

  const steps = [
    {
      selector: brands.length ? ".brand-tile:not(.brand-tile-add)" : ".brand-tile-add",
      // Launched from Settings (or anywhere else), not just the home
      // screen — always start there so step 1's target actually exists.
      beforeStep: () => { location.hash = "#/"; },
      title: brands.length ? "Your brands" : "Add your first brand",
      body: brands.length
        ? "Every brand gets its own dashboard, calendar, and content database — click a card to open one."
        : "Start here — every brand you add gets its own dashboard, calendar, and content database.",
    },
  ];

  if (firstBrandId) {
    steps.push(
      {
        selector: "#brand-switch-btn",
        beforeStep: () => { location.hash = `#/brand/${firstBrandId}`; },
        title: "Switch brands anytime",
        body: "Click here to jump between brands without going back to the home screen.",
      },
      {
        selector: '[data-tour="tab-home"]',
        title: "Home",
        body: "This brand's command center — five clear choices, plus what's coming up next. Come back here anytime.",
      },
      {
        selector: '[data-tour="tab-dna"]',
        title: "Brand DNA",
        body: "Build this brand's identity — purpose, audience, positioning. The foundation Campaigns and AI read from.",
      },
      {
        selector: '[data-tour="tab-campaigns"]',
        title: "Campaigns",
        body: "Give a batch of content a shared goal, message, and audience — AI can suggest which campaign a new idea fits.",
      },
      {
        selector: '[data-tour="tab-content-os"]',
        title: "Content Operating System",
        body: "Where you actually run content — a performance dashboard, the content database, Creator Studio, and Calendar all live inside here.",
      },
      {
        selector: '[data-tour="notif-bell"]',
        title: "Notifications",
        body: "Anything overdue or due soon across every brand shows up here.",
      },
      {
        selector: '[data-tour="settings"]',
        title: "Settings",
        body: "Formulas, health thresholds, AI keys, and more live here.",
      }
    );
  }

  runSpotlightTour(steps);
}
