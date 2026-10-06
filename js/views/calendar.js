import { listGoals, getBrand, listSeries, listContent, getContent, listCampaigns, updateContent, getSettings, onChange, STATUS_LABELS, ROUTINE_DAY_LABELS, localISODate, phaseNameLabel, eventPhaseDateLabel, listBrandIdeas } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { qs, qsa, toast, escapeHtml, openMenu, closeMenu, wireClickableCards } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { suggestSchedule, hasAiKey } from "../ai.js";
import { pulseTextFor } from "../brand-pulse.js";
import { goalItems } from "../goal-progress.js";
import { t, getLang, campaignDisplayName } from "../i18n.js";
import { draftFromIdea } from "../idea-draft.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { openContentCadenceSetup } from "../cadence-setup.js";
import { consumeNavContext, go } from "../nav-context.js";
import { isTourDemo, demoSuggestSchedule, DEMO_TOAST } from "../tour-demo.js";
import { setPageGuide } from "../section-guide.js";
import { startCalendarGuide, startCalendarGuideOnMount } from "../guides/calendar-guide.js";
import { funnelShort } from "../funnel-field.js";
import { openWeekPlanMenu, openSeriesEpisodeChat } from "../consultant-panel.js";
import { seriesDays, missingEpisodes } from "../week-plan.js";

// Series days (Jadwal Kerja: "Rabu = Bedah Brand") still waiting for their
// episode, date -> series. Only the rest of the visible range from today.
function missingEpisodeMap(brandId, start, end) {
  const days = seriesDays(getBrand(brandId)?.contentCadence, listSeries(brandId));
  const list = missingEpisodes(days, listContent(brandId), { start, end, todayISO: localISODate() });
  return new Map(list.map((m) => [m.date, m.series]));
}
// `short`: a month cell only has room for the series name; the tooltip says the rest.
const seriesGhostHTML = (date, series, { short = false } = {}) =>
  `<button type="button" class="cal-series-ghost" data-series-ghost="${escapeHtml(series.id)}" data-date="${date}" title="${escapeHtml(`${t("series.missingEpisode", { name: series.name })}. ${t("series.missingEpisodeTitle")}`)}">${icon("sparkle", { size: 10 })}<span>${escapeHtml(short ? series.name : t("series.missingEpisode", { name: series.name }))}</span></button>`;
function wireSeriesGhosts(body) {
  qsa("[data-series-ghost]", body).forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openSeriesEpisodeChat({ seriesId: btn.dataset.seriesGhost, date: btn.dataset.date });
  }));
}

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dow = () => DOW_KEYS.map((k) => t(`calendar.dow.${k}`));
const months = () => Array.from({ length: 12 }, (_, i) => t(`calendar.month.${i}`));

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function sameDay(a, b) { return iso(a) === iso(b); }
function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }

const FUNNEL_COLOR = { TOFU: "var(--tofu)", MOFU: "var(--mofu)", BOFU: "var(--bofu)" };
const GOAL_LANE_COLOR = { event: "var(--accent)", audience: "var(--track-social)", community: "var(--track-community)", rhythm: "var(--text-faint)" };

// Roadmap ke Tujuan (js/goal-progress.js): dated deadlines (checklist
// milestones + goal tasks) of every live goal, by date. Content slots need no
// help here — they are ordinary "idea" items on the calendar, tagged fromGoal.
function goalDeadlines(brandId) {
  const map = new Map();
  const today = localISODate();
  listGoals(brandId).filter((g) => g.status === "active" || g.status === "partial").forEach((g) => {
    goalItems(g, today).filter((i) => i.kind !== "slot" && i.state !== "done" && i.date).forEach((i) => map.set(i.date, [...(map.get(i.date) || []), { ...i, goalId: g.id }]));
  });
  return map;
}
// "This week: 3 posts · 1 deadline" for the header chip.
function goalWeekSummary(brandId) {
  const today = localISODate();
  const ws = iso(startOfWeek(new Date()));
  const we = iso(new Date(new Date(`${ws}T00:00:00`).getTime() + 6 * 86400000));
  let slots = 0, deadlines = 0, any = false;
  listGoals(brandId).filter((g) => g.status === "active" || g.status === "partial").forEach((g) => {
    any = true;
    goalItems(g, today).forEach((i) => { if (i.date >= ws && i.date <= we && i.state !== "done") { if (i.kind === "slot") slots += 1; else deadlines += 1; } });
  });
  return any ? { slots, deadlines } : null;
}

// Confirmed against the official SKB 3 Menteri 2026 announcement
// (setneg.go.id) — exact for 2026 only, since Islamic/lunar/Balinese
// holidays shift every year and aren't computed here. Other years fall
// back to just the fixed-date national holidays below.
// Values are i18n key suffixes (cal.holiday.* / cal.cuti.*), resolved when shown.
const HOLIDAYS_ID_2026 = {
  "2026-01-01": "newYear",
  "2026-01-16": "israMiraj",
  "2026-02-17": "chineseNewYear",
  "2026-03-19": "nyepi",
  "2026-03-21": "eidFitr",
  "2026-03-22": "eidFitr",
  "2026-04-03": "goodFriday",
  "2026-04-05": "easter",
  "2026-05-01": "labor",
  "2026-05-14": "ascension",
  "2026-05-27": "eidAdha",
  "2026-05-31": "vesak",
  "2026-06-01": "pancasila",
  "2026-06-16": "islamicNewYear",
  "2026-08-17": "independence",
  "2026-08-25": "mawlid",
  "2026-12-25": "christmas",
};
const CUTI_BERSAMA_ID_2026 = {
  "2026-02-16": "chineseNewYear",
  "2026-03-18": "nyepi",
  "2026-03-20": "eidFitr",
  "2026-03-23": "eidFitr",
  "2026-03-24": "eidFitr",
  "2026-05-15": "ascension",
  "2026-05-28": "eidAdha",
  "2026-12-24": "christmas",
};
function fixedHolidaysForYear(year) {
  return {
    [`${year}-01-01`]: "newYear",
    [`${year}-05-01`]: "labor",
    [`${year}-06-01`]: "pancasila",
    [`${year}-08-17`]: "independence",
    [`${year}-12-25`]: "christmas",
  };
}
// { label, cuti: boolean } or null — cuti (joint leave) gets a lighter
// treatment than an actual libur nasional.
function holidayForDate(dateISO) {
  const year = dateISO.slice(0, 4);
  if (year === "2026") {
    if (HOLIDAYS_ID_2026[dateISO]) return { label: t(`cal.holiday.${HOLIDAYS_ID_2026[dateISO]}`), cuti: false };
    if (CUTI_BERSAMA_ID_2026[dateISO]) return { label: t(`cal.cuti.${CUTI_BERSAMA_ID_2026[dateISO]}`), cuti: true };
    return null;
  }
  const fixed = fixedHolidaysForYear(year)[dateISO];
  return fixed ? { label: t(`cal.holiday.${fixed}`), cuti: false } : null;
}

// Whether the Content Bank was left open — a per-browser convenience, so it
// stays where the person left it between visits. Storage can be blocked
// (private window); the bank then just starts open.
const BANK_OPEN_KEY = "contentos:cal-bank-open";
function readBankOpen() {
  try { return localStorage.getItem(BANK_OPEN_KEY) !== "0"; } catch { return true; }
}
function writeBankOpen(open) {
  try { localStorage.setItem(BANK_OPEN_KEY, open ? "1" : "0"); } catch {}
}

export function render(root, { brandId }) {
  // Phones open on the week list: a 7-column month grid leaves ~46px per
  // day, too narrow to read a title. Month stays one tap away (and is used
  // when placing a piece from the Bank).
  const narrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
  const state = { view: narrow ? "week" : "month", cursor: new Date(), highlightId: null, bankOpen: readBankOpen(), bankCampaignId: null, placingId: null };
  // Arriving from a campaign ("Jadwalkan …"): jump to that piece's month,
  // or — when it has no date yet — open the Bank on it, scoped to that
  // campaign, so it can be dragged (or tapped) onto a day.
  const navCtx = consumeNavContext();
  const refresh = () => paint(root, brandId, state, refresh);
  if (navCtx) {
    const c = navCtx.contentId ? getContent(navCtx.contentId) : null;
    state.highlightId = navCtx.contentId || null;
    state.bankCampaignId = navCtx.campaignId || null;
    if (c?.scheduleDate || c?.publishedDate) state.cursor = new Date((c.scheduleDate || c.publishedDate) + "T00:00:00");
    else if (c || navCtx.campaignId || navCtx.intent === "schedule") state.bankOpen = true;
  }
  refresh();
  // Once per mount — paint() runs again on every db:change.
  startCalendarGuideOnMount(brandId);
  return onChange(refresh);
}

// Overdue-and-still-unpublished content drops off the calendar entirely
// instead of sitting stale on a day that's already passed — it moves to
// the "Overdue" reminder on the home page instead, which is a clearer
// place to actually deal with it than a grid cell in the past.
function itemsForBrand(brandId) {
  const todayISO = localISODate();
  return listContent(brandId).filter((c) => {
    if (c.publishedDate) return true;
    if (!c.scheduleDate) return false;
    // A published piece saved without a publish date (older data) stays on
    // its scheduled day — the Bank skips published pieces, so dropping it
    // here made it vanish from Kalender altogether.
    return c.status === "published" || c.scheduleDate >= todayISO;
  });
}

// ---------- Content Bank ----------
// Everything with no date yet, grouped by how far along it is — the
// backlog you drag out of and onto a day. Dropping just sets a date; it
// doesn't touch status, same as dragging an already-scheduled item.
// Content whose date passed without being published drops off the grid
// (itemsForBrand), so it sits at the top of the Bank instead, ready to be
// moved to a new date — it never just vanishes.
const BANK_GROUPS = [
  { labelKey: "calendar.bank.drafting", statuses: ["idea", "draft"] },
  { labelKey: "calendar.bank.execution", statuses: ["production"] },
  { labelKey: "calendar.bank.editing", statuses: ["editing"] },
  { labelKey: "calendar.bank.readyToUpload", statuses: ["scheduled"] },
];

function bankPool(brandId, campaignId = null) {
  const todayISO = localISODate();
  const pool = listContent(brandId).filter((c) => (!campaignId || c.campaignId === campaignId) && c.status !== "published" && c.status !== "archived" && !c.publishedDate);
  return {
    overdue: pool.filter((c) => c.scheduleDate && c.scheduleDate < todayISO),
    unscheduled: pool.filter((c) => !c.scheduleDate),
  };
}

function bankCount(brandId) {
  const { overdue, unscheduled } = bankPool(brandId);
  return overdue.length + unscheduled.length;
}

// ---------- Saved ideas in the Bank ----------
// The ideas inbox (brand.ideas — store.js listBrandIdeas) that the chat and
// the campaign pages keep, findable from Konten too: brand-level ideas plus
// each running campaign's own (only that campaign's when the Bank is scoped
// to one). An idea that already became content (status "used", its draft
// still there) has left the inbox. Tap = talk it through in the chat; drag
// or the calendar icon + a date = schedule it, which makes it content.
const IDEA_PREFIX = "idea:";
const isIdeaKey = (id) => typeof id === "string" && id.startsWith(IDEA_PREFIX);
function ideaScopes(brandId, { running = false } = {}) {
  const campaigns = listCampaigns(brandId).filter((c) => !running || !["archived", "completed"].includes(c.status));
  return [null, ...campaigns.map((c) => c.id)];
}
function bankIdeas(brandId, campaignId = null) {
  const scopes = campaignId ? [campaignId] : ideaScopes(brandId, { running: true });
  return scopes
    .flatMap((id) => listBrandIdeas(brandId, { campaignId: id }))
    .filter((i) => !(i.status === "used" && i.contentId && getContent(i.contentId)));
}
function ideaById(brandId, ideaId) {
  return ideaScopes(brandId).flatMap((id) => listBrandIdeas(brandId, { campaignId: id })).find((i) => i.id === ideaId) || null;
}
function ideaGroupHTML(ideas, state, campaignById) {
  return `
    <div class="content-bank-group is-ideas">
      <div class="content-bank-group-head">${t("bankIdea.group")} <span>${ideas.length}</span></div>
      ${ideas
        .map((i) => {
          const camp = i.campaignId ? campaignById.get(i.campaignId) : null;
          const key = IDEA_PREFIX + i.id;
          return `
        <div class="bank-item is-idea ${state.placingId === key ? "is-placing" : ""}" draggable="true" data-bank-id="${escapeHtml(key)}" title="${escapeHtml(i.description || i.text)}">
          <button type="button" class="bank-item-open" data-bank-idea-discuss="${escapeHtml(i.id)}" aria-label="${escapeHtml(t("bankIdea.discussAria", { title: i.text }))}">
            <span class="bank-item-idea-icon" aria-hidden="true">${icon("bulb", { size: 12 })}</span>
            <span class="bank-item-text">
              <span class="bank-item-title">${escapeHtml(i.text)}</span>
              <span class="bank-item-meta">${escapeHtml([t("bankIdea.discuss"), camp ? campaignDisplayName(camp.name) : ""].filter(Boolean).join(" · "))}</span>
            </span>
          </button>
          <button type="button" class="icon-btn bank-item-place" data-bank-place="${escapeHtml(key)}" title="${escapeHtml(t("bankIdea.place"))}" aria-label="${escapeHtml(t("bankIdea.place"))}">${icon("calendar", { size: 13 })}</button>
        </div>`;
        })
        .join("")}
    </div>`;
}
// Scheduling a saved idea makes it content through the same path as the
// chat's "Kirim ke Creator" (js/idea-draft.js) — its campaign kept, dated on
// the day it was dropped.
function scheduleIdea(brandId, ideaId, dateISO) {
  if (!dateISO || dateISO < localISODate()) {
    toast(t("calendar.pastDate"), "error");
    return;
  }
  const i = ideaById(brandId, ideaId);
  if (!i) return;
  const c = draftFromIdea(brandId, i, { scheduleDate: dateISO, campaignId: i.campaignId || "", campaignPhaseId: "", seriesId: "" });
  warnIfFunnelClash(brandId, c.id, dateISO);
  toast(t("bankIdea.scheduled"));
}

function contentBankHTML(brandId, state) {
  const campaigns = listCampaigns(brandId);
  const campaign = state.bankCampaignId ? campaigns.find((c) => c.id === state.bankCampaignId) : null;
  const { overdue, unscheduled } = bankPool(brandId, campaign?.id);
  const ideas = bankIdeas(brandId, campaign?.id || null);
  const groups = [
    ...(overdue.length ? [{ labelKey: "calendar.bank.overdue", items: overdue, overdue: true }] : []),
    ...BANK_GROUPS.map((g) => ({ ...g, items: unscheduled.filter((c) => g.statuses.includes(c.status)) })).filter((g) => g.items.length),
  ];
  return `
    <aside class="content-bank" id="content-bank" aria-label="${t("calendar.bank.title")}">
      <div class="content-bank-head">
        <span>${icon("layers", { size: 14 })}${t("calendar.bank.title")}</span>
        <button type="button" class="icon-btn" id="close-bank" aria-label="${t("common.close")}" title="${t("common.close")}">${icon("x", { size: 13 })}</button>
      </div>
      <p class="content-bank-hint">${t("calendar.bank.hint")}</p>
      ${campaign ? `<div class="content-bank-scope"><span class="tag">${escapeHtml(campaignDisplayName(campaign.name))}</span><button type="button" class="icon-btn" id="bank-clear-campaign" title="${t("cal.bank.showAll")}" aria-label="${t("cal.bank.showAll")}">${icon("x", { size: 11 })}</button></div>` : ""}
      <div class="content-bank-list">
        ${
          groups.length || ideas.length
            ? groups
                .map(
                  (g) => `
          <div class="content-bank-group ${g.overdue ? "is-overdue" : ""}">
            <div class="content-bank-group-head">${t(g.labelKey)} <span>${g.items.length}</span></div>
            ${g.items
              .map(
                (c) => `
              <div class="bank-item ${state.highlightId === c.id ? "is-highlight" : ""} ${state.placingId === c.id ? "is-placing" : ""}" draggable="true" data-bank-id="${escapeHtml(c.id)}" title="${escapeHtml(c.title || t("common.untitled"))}">
                <button type="button" class="bank-item-open" data-bank-open="${escapeHtml(c.id)}">
                  <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel] || "var(--text-faint)"}"></span>
                  <span class="bank-item-text">
                    <span class="bank-item-title">${escapeHtml(c.title || t("common.untitled"))}</span>
                    <span class="bank-item-meta">${escapeHtml([c.platform, c.format].filter(Boolean).join(" · ") || funnelShort(c.funnel) || "")}${g.overdue ? ` · ${escapeHtml(formatCellDate(c.scheduleDate))}` : ""}</span>
                  </span>
                </button>
                <button type="button" class="icon-btn bank-item-place" data-bank-place="${escapeHtml(c.id)}" title="${t("calendar.bank.place")}" aria-label="${t("calendar.bank.place")}">${icon("calendar", { size: 13 })}</button>
              </div>`
              )
              .join("")}
          </div>`
                )
                .join("") + (ideas.length ? ideaGroupHTML(ideas, state, new Map(campaigns.map((c) => [c.id, c]))) : "")
            : `<div class="content-bank-empty">${t("calendar.bank.empty")}</div>`
        }
      </div>
      <div class="content-bank-drop" aria-hidden="true">${icon("layers", { size: 14 })}${t("calendar.bank.dropBack")}</div>
    </aside>
  `;
}

function wireContentBank(root, brandId, state, refresh) {
  const bank = qs("#content-bank", root);
  if (!bank) return;
  qs("#close-bank", bank).addEventListener("click", () => { state.bankOpen = false; state.placingId = null; writeBankOpen(false); refresh(); });
  qs("#bank-clear-campaign", bank)?.addEventListener("click", () => { state.bankCampaignId = null; refresh(); });
  qsa("[data-bank-id]", bank).forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", el.dataset.bankId);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("is-dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("is-dragging"));
  });
  // Click the piece = open it, same as anywhere else in Konten.
  qsa("[data-bank-open]", bank).forEach((btn) => {
    btn.addEventListener("click", () => openContentEditor({ brandId, contentId: btn.dataset.bankOpen, onSaved: refresh }));
  });
  // Click a saved idea = talk it through: a new conversation in the one chat,
  // in the idea's campaign, with the same opener the chat's "Bahas lagi" uses.
  qsa("[data-bank-idea-discuss]", bank).forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = ideaById(brandId, btn.dataset.bankIdeaDiscuss);
      if (!i) return;
      go(`#/brand/${brandId}/chat`, {
        fromLabel: t("contentOs.tab.calendar"),
        campaignId: i.campaignId || null,
        mode: "chat",
        seed: t("bs.concept.discussSeed", { title: i.text, angle: i.description || "-", notes: (i.notes || "-").replace(/\n+/g, "; ") }),
      });
    });
  });
  // The calendar icon = "put this on a day" without dragging (touch
  // screens can't drag): the next date tapped gets it.
  qsa("[data-bank-place]", bank).forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.bankPlace;
      state.placingId = state.placingId === id ? null : id;
      if (state.placingId) state.view = "month";
      refresh();
      if (state.placingId) qs(".cal-grid", root)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
  // Dragging something already on the calendar back into the Bank takes
  // its date off — same as "Hapus dari kalender", just by hand.
  bank.addEventListener("dragover", (e) => {
    if (!root.classList.contains("is-cal-dragging")) return;
    e.preventDefault();
    bank.classList.add("drag-over");
  });
  bank.addEventListener("dragleave", (e) => { if (!bank.contains(e.relatedTarget)) bank.classList.remove("drag-over"); });
  bank.addEventListener("drop", (e) => {
    bank.classList.remove("drag-over");
    if (!root.classList.contains("is-cal-dragging")) return;
    e.preventDefault();
    root.classList.remove("is-cal-dragging");
    const id = e.dataTransfer.getData("text/plain");
    const c = id ? getContent(id) : null;
    if (!c || c.status === "published" || !c.scheduleDate) return;
    updateContent(id, { scheduleDate: "" });
    toast(t("calendar.bank.movedBack"));
  });
}

// "Tap a date for …" — the no-drag way to schedule from the Bank.
function placingBarHTML(state, brandId) {
  const idea = isIdeaKey(state.placingId) ? ideaById(brandId, state.placingId.slice(IDEA_PREFIX.length)) : null;
  const c = idea ? { title: idea.text } : getContent(state.placingId);
  if (!c) { state.placingId = null; return ""; }
  return `
    <div class="cal-placing-bar" role="status">
      ${icon("calendar", { size: 15 })}
      <span>${t("calendar.bank.placing", { title: `<b>${escapeHtml(c.title || t("common.untitled"))}</b>` })}</span>
      <button type="button" class="btn btn-ghost btn-sm" id="cancel-placing">${t("common.cancel")}</button>
    </div>`;
}

// This used to also read the routineTemplate collection and merge in a
// second, independently-worded copy of the very same rules (that collection
// only ever mirrored brand.contentCadence, and nothing writes it anymore —
// see js/store.js) — sending the AI both a "Custom task every day" line
// and a "Only schedule on these days" line for the same setup. Reading
// contentCadence directly (below) is the one source of truth now.
function routineNotesForBrand(brandId) {
  return cadenceNotesForBrand(brandId);
}

// The one-time Content OS setup question (js/views/content-os.js) becomes
// hard constraints here — which days are actually upload days, the daily
// cap, and the standing rule that two pieces of the same funnel stage never
// share a day even when the cap allows more than one upload.
function cadenceNotesForBrand(brandId) {
  const cadence = getBrand(brandId)?.contentCadence;
  if (!cadence || !cadence.configured) return [];
  const notes = [];
  if (cadence.uploadDays?.length) {
    notes.push(`Only schedule on these days of the week: ${cadence.uploadDays.map((d) => ROUTINE_DAY_LABELS[d]).join(", ")}.`);
  }
  notes.push(`This brand can realistically post at most ${cadence.perDay} piece(s) of content per day.`);
  const days = seriesDays(cadence, listSeries(brandId));
  if (days.size) notes.push(`Fixed series days: ${[...days].map(([d, s]) => `${ROUTINE_DAY_LABELS[d]} = "${s.name}"`).join(", ")}. Put a piece of that series on its day when there is one; keep other pieces off those days if another day fits.`);
  notes.push("Never schedule two items of the same funnel stage (TOFU/MOFU/BOFU) on the same day, even if the daily cap allows more than one upload that day.");
  return notes;
}

// Picks up everything still in progress with no date on it yet and lets
// the AI spread them across the next 3 weeks — a starting point to drag
// around afterward, not a final answer.
async function runAutoSchedule(brandId, refresh) {
  const ai = getSettings().ai || {};
  const hasKey = hasAiKey(ai);
  // During a tour this runs on sample data (js/tour-demo.js) — no key
  // needed, no tokens spent.
  const demo = isTourDemo();
  if (!hasKey && !demo) {
    toast(t("calendar.autoschedule.noKey"), "error");
    return;
  }
  const unscheduled = listContent(brandId).filter(
    (c) => !c.scheduleDate && ["idea", "draft", "production", "editing", "scheduled"].includes(c.status)
  );
  if (!unscheduled.length) {
    toast(t("calendar.autoschedule.nothingToSchedule"));
    return;
  }
  toast(demo ? DEMO_TOAST : t("calendar.autoschedule.asking", { count: unscheduled.length }));
  try {
    const startDate = localISODate();
    const brand = getBrand(brandId);
    const campaigns = listCampaigns(brandId);
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));
    const seriesById = new Map(listSeries(brandId).map((x) => [x.id, x]));
    const schedule = demo
      ? await demoSuggestSchedule({ items: unscheduled.map((c) => ({ id: c.id, funnel: c.funnel, status: c.status })), startDate, daysAhead: 21, cadence: brand?.contentCadence })
      : await suggestSchedule(ai, {
      items: unscheduled.map((c) => {
        const campaign = c.campaignId ? campaignById.get(c.campaignId) : null;
        const phase = campaign?.phases?.find((p) => p.id === c.campaignPhaseId);
        return {
          id: c.id, title: c.title, funnel: c.funnel, status: c.status,
          campaignPhase: campaign ? `${campaign.name}${phase ? ` — ${phase.name}` : ""}` : "",
          ...(c.seriesId && seriesById.get(c.seriesId) ? { series: seriesById.get(c.seriesId).name } : {}),
        };
      }),
      startDate,
      daysAhead: 21,
      routineNotes: routineNotesForBrand(brandId),
      brand,
      campaigns,
      pulseText: pulseTextFor(brand, { content: listContent(brandId), campaigns, settings: getSettings() }),
    });
    const proposed = unscheduled
      .filter((c) => schedule.has(c.id))
      .map((c) => ({ content: c, date: schedule.get(c.id) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!proposed.length) {
      toast(t("calendar.autoschedule.noResult"), "error");
      return;
    }
    openAutoScheduleConfirm(proposed, refresh);
  } catch (e) {
    toast(e.message || t("calendar.autoschedule.failed"), "error");
  }
}

// Nothing gets written to the calendar until this is explicitly confirmed —
// the AI's dates are a proposal to review (and adjust per-row) first, not
// an instant write.
function openAutoScheduleConfirm(proposed, refresh) {
  const overlay = openModal({
    title: t("calendar.autoschedule.reviewTitle"),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("calendar.autoschedule.reviewSub")}</p>
      <div class="auto-schedule-list">
        ${proposed
          .map(
            (p, i) => `
          <div class="auto-schedule-row">
            <span class="tag tag-${escapeHtml((p.content.funnel || "").toLowerCase())}">${escapeHtml(funnelShort(p.content.funnel))}</span>
            <span class="auto-schedule-title">${escapeHtml(p.content.title || t("common.untitled"))}</span>
            <input class="input" type="date" data-schedule-index="${i}" aria-label="${escapeHtml(`${t("contentEditor.tab.schedule")}: ${p.content.title || t("common.untitled")}`)}" value="${/^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : ""}" style="width:auto;" />
          </div>`
          )
          .join("")}
      </div>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="auto-schedule-cancel">${t("common.cancel")}</button>
      <button class="btn btn-primary" id="auto-schedule-confirm">${icon("check", { size: 15 })}${t("calendar.autoschedule.confirm")}</button>
    `,
  });
  overlay.querySelector("#auto-schedule-cancel").addEventListener("click", () => closeOverlay(overlay));
  qsa("[data-schedule-index]", overlay).forEach((input) => {
    input.addEventListener("change", () => {
      proposed[Number(input.dataset.scheduleIndex)].date = input.value;
    });
  });
  overlay.querySelector("#auto-schedule-confirm").addEventListener("click", () => {
    proposed.forEach((p) => updateContent(p.content.id, { scheduleDate: p.date }));
    toast(t("calendar.autoschedule.done", { count: proposed.length }));
    closeOverlay(overlay);
    refresh();
  });
}

// Bulk version of "Remove from calendar" (openCalItemMenu) for one whole
// month — only the date is cleared, so the content lands back in the
// Content Bank instead of being deleted. Published pieces are history and
// never listed; past unpublished ones aren't on the grid (itemsForBrand).
// Every piece starts ticked, so keeping one is a single untick.
function openClearMonth(brandId, monthDate, refresh) {
  const month = iso(monthDate).slice(0, 7);
  const label = monthLabel(monthDate);
  const todayISO = localISODate();
  const targets = listContent(brandId)
    .filter((c) => c.status !== "published" && !c.publishedDate && c.scheduleDate?.slice(0, 7) === month && c.scheduleDate.slice(0, 10) >= todayISO)
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate));
  if (!targets.length) {
    toast(t("calendar.clear.empty", { month: label }));
    return;
  }
  const picked = new Set(targets.map((c) => c.id));
  const overlay = openModal({
    title: t("calendar.clear.title", { month: label }),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("calendar.clear.sub")}</p>
      <div class="auto-schedule-list">
        ${targets.map((c) => `
          <label class="auto-schedule-row clear-month-row">
            <input type="checkbox" data-clear-pick="${escapeHtml(c.id)}" checked />
            <span class="clear-month-date">${formatCellDate(c.scheduleDate.slice(0, 10))}</span>
            <span class="tag tag-${escapeHtml((c.funnel || "").toLowerCase())}">${escapeHtml(funnelShort(c.funnel))}</span>
            <span class="auto-schedule-title">${escapeHtml(c.title || t("common.untitled"))}</span>
          </label>`).join("")}
      </div>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="clear-month-cancel">${t("common.cancel")}</button>
      <button class="btn btn-danger" id="clear-month-confirm">${icon("trash", { size: 15 })}<span></span></button>
    `,
  });
  const confirmBtn = overlay.querySelector("#clear-month-confirm");
  const syncConfirm = () => {
    confirmBtn.querySelector("span").textContent = t("calendar.clear.confirm", { count: picked.size });
    confirmBtn.disabled = !picked.size;
  };
  syncConfirm();
  qsa("[data-clear-pick]", overlay).forEach((box) => box.addEventListener("change", () => {
    if (box.checked) picked.add(box.dataset.clearPick);
    else picked.delete(box.dataset.clearPick);
    syncConfirm();
  }));
  overlay.querySelector("#clear-month-cancel").addEventListener("click", () => closeOverlay(overlay));
  confirmBtn.addEventListener("click", () => {
    if (!picked.size) return;
    picked.forEach((id) => updateContent(id, { scheduleDate: "" }));
    toast(t("calendar.clear.done", { count: picked.size, month: label }));
    closeOverlay(overlay);
    refresh();
  });
}

function visibleRangeISO(state) {
  const d = state.cursor;
  if (state.view === "month") {
    const gridStart = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 41);
    return { start: iso(gridStart), end: iso(gridEnd) };
  }
  if (state.view === "week") {
    const s = startOfWeek(d);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    return { start: iso(s), end: iso(e) };
  }
  return { start: iso(d), end: iso(d) };
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) { location.hash = "#/"; return; }
  const items = itemsForBrand(brandId);
  const campaigns = listCampaigns(brandId);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const deadlines = goalDeadlines(brandId);
  const goalWeek = goalWeekSummary(brandId);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("calendar.eyebrow")}${helpButtonHTML("calendar")}${guideVideoButtonHTML("calendar")}</div>
        <h1>${t("contentOs.tab.calendar")}</h1>
        <p class="page-head-brand">${escapeHtml(brand.name)}</p>
      </div>
      <div class="flex gap-8 cal-head-actions">
        <button class="btn btn-secondary ${state.bankOpen ? "is-active" : ""}" id="toggle-bank" aria-pressed="${state.bankOpen}">${icon("layers", { size: 15 })}${t("calendar.contentBankBtn")}${bankCount(brandId) ? `<span class="bank-count">${bankCount(brandId)}</span>` : ""}</button>
        <button class="btn btn-secondary" id="cal-schedule" aria-haspopup="menu">${icon("calendar", { size: 15 })}${t("cal.schedule.btn")}${icon("chevronDown", { size: 13 })}</button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("calendar.newContentBtn")}</button>
      </div>
    </div>
    <div class="cal-head">
      <div class="cal-nav">
        <button class="icon-btn" id="cal-prev" aria-label="${t("calendar.prevPeriod")}">${icon("chevronLeft", { size: 16 })}</button>
        <div class="cal-month-label">${periodLabel(state)}</div>
        <button class="icon-btn" id="cal-next" aria-label="${t("calendar.nextPeriod")}">${icon("chevronRight", { size: 16 })}</button>
        <button class="btn btn-secondary btn-sm" id="cal-today">${t("calendar.today")}</button>
      </div>
      ${goalWeek ? `<a class="cal-goalchip" href="#/brand/${brandId}/goals" title="${escapeHtml(t("roadmap.cal.goalChip"))}">${icon("target", { size: 12 })}${t("roadmap.cal.weekChip", { slots: goalWeek.slots, deadlines: goalWeek.deadlines })}</a>` : ""}
      <div class="segmented" style="width:150px;">
        ${["month", "week"].map((v) => `<button data-view="${v}" class="${state.view === v ? "active" : ""}" aria-pressed="${state.view === v}">${t(`calendar.view.${v}`)}</button>`).join("")}
      </div>
    </div>
    ${state.placingId ? placingBarHTML(state, brandId) : ""}
    <div class="cal-layout ${state.bankOpen ? "has-bank" : ""} ${state.placingId ? "is-placing" : ""}">
      <div id="cal-body"></div>
      ${state.bankOpen ? contentBankHTML(brandId, state) : ""}
    </div>
  `;

  // The header button has no date, so the new piece wouldn't show on the
  // grid — it opens in Creator instead (a date cell keeps you here).
  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));
  // "Atur jadwal": every way to fill the calendar in one place, each with
  // what it does and what it costs. "Rencanakan minggu ini" used to be its
  // own button and the other two hid in a ⋯ menu, so it read as four
  // unrelated features. Series days are set inside Jadwal Kerja.
  qs("#cal-schedule").addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const menu = openMenu(btn, { className: "sched-menu", top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 328) });
    if (!menu) return;
    const option = (act, id, ic, title, desc, cost) => `
      <button type="button" data-act="${act}" ${id ? `id="${id}"` : ""}>
        ${icon(ic, { size: 16 })}
        <span class="sched-menu-text"><b>${title}</b><small>${desc}</small><span class="btn-cost">${cost}</span></span>
      </button>`;
    menu.innerHTML = `
      ${option("week", "", "sparkle", t("chat.week.button"), t("cal.schedule.weekDesc"), t("chat.week.cost"))}
      ${option("autoschedule", "ai-autoschedule", "bot", t("calendar.autoscheduleBtn"), t("cal.schedule.autoDesc"), t("chat.week.cost"))}
      ${option("cadence", "edit-cadence", "gear", t("calendar.editCadenceBtn"), t("cal.schedule.cadenceDesc"), t("cal.schedule.noAi"))}
      <p class="sched-menu-note">${t("cal.schedule.manual")}</p>
      <div class="menu-divider"></div>
      <button type="button" data-act="clear" id="clear-month" class="danger">
        ${icon("trash", { size: 16 })}
        <span class="sched-menu-text"><b>${t("calendar.clear.btn", { month: monthLabel(state.cursor) })}</b><small>${t("calendar.clear.desc")}</small></span>
      </button>
    `;
    menu.addEventListener("click", (ev) => {
      const act = ev.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === "week") openWeekPlanMenu(btn, brandId);
      else if (act === "autoschedule") runAutoSchedule(brandId, refresh);
      else if (act === "cadence") openContentCadenceSetup(brand);
      else if (act === "clear") openClearMonth(brandId, state.cursor, refresh);
    });
  });
  wireHelpButtons(root);
  setPageGuide(() => startCalendarGuide(brandId));
  qs("#toggle-bank").addEventListener("click", () => {
    state.bankOpen = !state.bankOpen;
    if (!state.bankOpen) state.placingId = null;
    writeBankOpen(state.bankOpen);
    refresh();
  });
  qs("#cancel-placing")?.addEventListener("click", () => { state.placingId = null; refresh(); });
  wireContentBank(root, brandId, state, refresh);
  qs("#cal-prev").addEventListener("click", () => { step(state, -1); paint(root, brandId, state, refresh); });
  qs("#cal-next").addEventListener("click", () => { step(state, 1); paint(root, brandId, state, refresh); });
  qs("#cal-today").addEventListener("click", () => { state.cursor = new Date(); paint(root, brandId, state, refresh); });
  qsa("[data-view]").forEach((btn) => btn.addEventListener("click", () => { state.view = btn.dataset.view; paint(root, brandId, state, refresh); }));

  const body = qs("#cal-body");
  if (state.view === "month") renderMonth(body, brandId, state, items, campaigns, campaignById, refresh, deadlines);
  else renderAgenda(body, brandId, state, items, campaignById, refresh, deadlines);

}

const monthLabel = (d) => `${months()[d.getMonth()]} ${d.getFullYear()}`;

function periodLabel(state) {
  const d = state.cursor;
  const dayFirst = getLang() === "id";
  const md = (x, full) => {
    const m = full ? months()[x.getMonth()] : months()[x.getMonth()].slice(0, 3);
    return dayFirst ? `${x.getDate()} ${m}` : `${m} ${x.getDate()}`;
  };
  if (state.view === "month") return monthLabel(d);
  if (state.view === "week") {
    const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate() + 6);
    return `${md(s)} – ${md(e)}`;
  }
  return dayFirst ? `${md(d, true)} ${d.getFullYear()}` : `${md(d, true)}, ${d.getFullYear()}`;
}
function step(state, dir) {
  const d = new Date(state.cursor);
  if (state.view === "month") d.setMonth(d.getMonth() + dir);
  else if (state.view === "week") d.setDate(d.getDate() + dir * 7);
  else d.setDate(d.getDate() + dir);
  state.cursor = d;
}

function renderMonth(body, brandId, state, items, campaigns, campaignById, refresh, deadlines = new Map()) {
  const d = state.cursor;
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const today = new Date();
  const todayISO = localISODate();
  const eventDays = eventDayMarkers(campaigns);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);
  const ghosts = missingEpisodeMap(brandId, iso(gridStart), iso(gridEnd));

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    const outside = day.getMonth() !== d.getMonth();
    const dayItems = items.filter((c) => sameDay(new Date(c.scheduleDate || c.publishedDate), day));
    const dayDeadlines = deadlines.get(iso(day)) || [];
    const dlShown = dayDeadlines.slice(0, 2);
    const shown = dayItems.slice(0, 3 - dlShown.length);
    const extra = dayItems.length - shown.length + (dayDeadlines.length - dlShown.length);
    const holiday = holidayForDate(iso(day));
    const eventNames = eventDays.get(iso(day));
    const ghost = ghosts.get(iso(day));

    cells += `
      <div class="cal-cell ${outside ? "outside" : ""} ${sameDay(day, today) ? "today" : ""} ${iso(day) < todayISO ? "is-past" : ""} ${holiday ? (holiday.cuti ? "cuti" : "holiday") : ""} ${eventNames ? "event-day" : ""}" data-date="${iso(day)}" aria-label="${escapeHtml([formatCellDate(iso(day)), holiday?.label].filter(Boolean).join(" · "))}" ${holiday ? `title="${escapeHtml(holiday.label)}"` : eventNames ? `title="${t("cal.eventDayTitle", { names: escapeHtml(eventNames.join(", ")) })}"` : ""}>
        <div class="cal-date">${day.getDate()}${eventNames ? `<span class="cal-event-star" aria-label="${t("cal.eventDay")}">★</span>` : ""}</div>
        ${holiday ? `<div class="cal-holiday-label">${escapeHtml(holiday.label)}</div>` : ""}
        ${dlShown.map((d) => `<div class="cal-deadline ${d.state === "overdue" ? "is-overdue" : ""}" title="${escapeHtml(`${t("roadmap.cal.deadline")}: ${d.label}`)}">${escapeHtml(d.label)}</div>`).join("")}
        ${shown.map((c) => {
          const campaign = c.campaignId ? campaignById.get(c.campaignId) : null;
          const itemTitle = campaign ? `${c.title} · ${campaignDisplayName(campaign.name)}` : c.title;
          const isSlot = !!c.fromGoal && c.status === "idea";
          return `
          <div class="cal-item ${isSlot ? "is-slot" : ""} ${state.highlightId === c.id ? "is-highlight" : ""}" draggable="${c.status === "published" ? "false" : "true"}" data-id="${c.id}" title="${escapeHtml(isSlot ? `${itemTitle} — ${t("roadmap.cal.slot")}` : itemTitle)}">
            <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>
            ${campaign ? `<span class="cal-item-campaign-dot" title="${escapeHtml(campaignDisplayName(campaign.name))}" ${c.goalLane ? `style="background:${GOAL_LANE_COLOR[c.goalLane] || "var(--brand-tint)"}"` : ""}></span>` : ""}
            ${escapeHtml(c.title || t("common.untitled"))}
          </div>`;
        }).join("")}
        ${ghost ? seriesGhostHTML(iso(day), ghost, { short: true }) : ""}
        ${extra > 0 ? `<div class="cal-more">${t("calendar.more", { count: extra })}</div>` : ""}
      </div>
    `;
  }

  body.innerHTML = `
    ${campaignTimelineHTML(campaigns, d)}
    <div class="cal-grid">
      ${dow().map((dw) => `<div class="cal-dow">${dw}</div>`).join("")}
      ${cells}
    </div>
  `;

  wireDragAndOpen(body, brandId, refresh, state);
  wireSeriesGhosts(body);
  // Keyboard: Tab reaches each upcoming day and each item; Enter/Space does
  // what a click does (the handlers above). Past days only answer "can't
  // schedule in the past", so they're left out of the tab order.
  wireClickableCards(body, ".cal-item, .cal-cell:not(.is-past)");
}

// A thin Gantt-lite strip above the month grid — one row per active
// campaign whose date window overlaps the visible month, positioned by
// day-of-month percentage. Scoped to the current month only (not the
// padded 42-cell grid, which spans into neighboring months) so the math
// stays simple: no row-wrapping across week boundaries to worry about.
function campaignTimelineHTML(campaigns, monthDate) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const monthStartISO = iso(monthStart);
  const monthEndISO = iso(monthEnd);
  const active = campaigns.filter((c) => c.status !== "archived" && c.startDate && c.endDate && c.startDate <= monthEndISO && c.endDate >= monthStartISO);
  if (!active.length) return "";
  // Percent position of a day-of-month range inside this month's track.
  const span = (fromISO, toISO) => {
    const startDay = fromISO > monthStartISO ? Number(fromISO.slice(8, 10)) : 1;
    const endDay = toISO < monthEndISO ? Number(toISO.slice(8, 10)) : daysInMonth;
    return { left: ((startDay - 1) / daysInMonth) * 100, width: ((endDay - startDay + 1) / daysInMonth) * 100 };
  };
  const rows = active
    .map((c) => {
      // Event campaigns show their phases as segments (each with a name)
      // and a marker on event day, instead of one flat bar.
      const phases = (c.eventPlan?.phases || []).filter((p) => p.dateFrom && p.dateTo && p.dateFrom <= monthEndISO && p.dateTo >= monthStartISO);
      let bar;
      if (phases.length) {
        bar = phases
          .map((p, i) => {
            const { left, width } = span(p.dateFrom, p.dateTo);
            return `<div class="cal-timeline-seg seg-${i % 4}" style="left:${left}%;width:${width}%;" title="${escapeHtml(phaseNameLabel(p.name))} · ${escapeHtml(eventPhaseDateLabel(p, c.eventPlan.eventDate))}"><span>${escapeHtml(phaseNameLabel(p.name))}</span></div>`;
          })
          .join("");
        const ev = c.eventPlan.eventDate;
        if (ev && ev >= monthStartISO && ev <= monthEndISO) {
          const { left } = span(ev, ev);
          bar += `<div class="cal-timeline-event" style="left:${left}%;" title="${t("cal.eventDay")} · ${escapeHtml(ev)}">★</div>`;
        }
      } else {
        const { left, width } = span(c.startDate, c.endDate);
        bar = `<div class="cal-timeline-bar" style="left:${left}%;width:${width}%;"></div>`;
      }
      return `
        <div class="cal-timeline-row ${phases.length ? "has-phases" : ""}">
          <a class="cal-timeline-label" href="#/brand/${c.brandId}/campaigns/${c.id}" title="${escapeHtml(campaignDisplayName(c.name) || "")}">${escapeHtml(campaignDisplayName(c.name) || t("calendar.untitledCampaign"))}</a>
          <div class="cal-timeline-track">${bar}</div>
        </div>
      `;
    })
    .join("");
  return `<div class="cal-timeline">${rows}</div>`;
}

// Event-day cells get a marker so the day itself stands out on the grid.
function eventDayMarkers(campaigns) {
  const map = new Map();
  campaigns.forEach((c) => {
    const d = c.eventPlan?.eventDate;
    if (d && c.status !== "archived") map.set(d, [...(map.get(d) || []), campaignDisplayName(c.name) || t("cal.eventFallback")]);
  });
  return map;
}

function renderAgenda(body, brandId, state, items, campaignById, refresh, deadlines = new Map()) {
  const d = state.cursor;
  let rangeStart, rangeEnd;
  if (state.view === "week") { rangeStart = startOfWeek(d); rangeEnd = new Date(rangeStart); rangeEnd.setDate(rangeEnd.getDate() + 6); }
  else { rangeStart = new Date(d); rangeEnd = new Date(d); }
  rangeStart.setHours(0,0,0,0); rangeEnd.setHours(23,59,59,999);

  const filtered = items
    .filter((c) => {
      const dt = new Date(c.scheduleDate || c.publishedDate);
      return dt >= rangeStart && dt <= rangeEnd;
    })
    .sort((a, b) => (a.scheduleDate || a.publishedDate).localeCompare(b.scheduleDate || b.publishedDate));

  const dlRows = [...deadlines.entries()]
    .filter(([date]) => { const dt = new Date(`${date}T00:00:00`); return dt >= rangeStart && dt <= rangeEnd; })
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([date, list]) => list.map((d) => {
      const dt = new Date(`${date}T00:00:00`);
      return `<a class="agenda-row" href="${d.kind === "milestone" ? `#/brand/${brandId}/campaigns/${d.campaignId}` : `#/brand/${brandId}/goals/${d.goalId}`}">
        <div class="agenda-date"><div class="d">${dt.getDate()}</div><div class="m">${months()[dt.getMonth()].slice(0, 3)}</div></div>
        <div class="ti" style="flex:1;min-width:0;"><div class="t" style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.label)}</div></div>
        <span class="cal-deadline ${d.state === "overdue" ? "is-overdue" : ""}">${t("roadmap.cal.deadline")}</span></a>`;
    }));
  // Content and empty series days share one date order.
  const ghostRows = [...missingEpisodeMap(brandId, iso(rangeStart), iso(rangeEnd))].map(([date, series]) => {
    const dt = new Date(`${date}T00:00:00`);
    return { date, html: `<div class="agenda-row agenda-ghost">
        <div class="agenda-date"><div class="d">${dt.getDate()}</div><div class="m">${months()[dt.getMonth()].slice(0, 3)}</div></div>
        <div class="ti" style="flex:1;min-width:0;">${seriesGhostHTML(date, series)}</div></div>` };
  });
  const dayRows = [...filtered.map((c) => ({ date: c.scheduleDate || c.publishedDate, html: agendaRow(c, campaignById) })), ...ghostRows]
    .sort((a, b) => a.date.localeCompare(b.date));
  body.innerHTML = dayRows.length || dlRows.length
    ? `<div class="agenda-list">${dlRows.join("")}${dayRows.map((r) => r.html).join("")}</div>`
    : `<div class="empty-state card" style="margin:0;">
         <div class="icon-wrap">${icon("calendar", { size: 20 })}</div>
         <h3>${t("calendar.agendaEmpty", { view: t(`calendar.view.${state.view}`).toLowerCase() })}</h3>
         <p>${t("calendar.agendaEmptyBody")}</p>
         <button type="button" class="btn btn-primary btn-sm" id="agenda-empty-new">${icon("plus", { size: 14 })}${t("calendar.createNewContent")}</button>
       </div>`;

  qsa("[data-id]", body).forEach((el) => {
    el.addEventListener("click", () => openCalItemMenu(el, { brandId, contentId: el.dataset.id, refresh }));
  });
  wireClickableCards(body, ".agenda-row[data-id]");
  wireSeriesGhosts(body);
  qs("#agenda-empty-new", body)?.addEventListener("click", () => {
    openContentEditor({ brandId, stay: true, defaults: { scheduleDate: iso(rangeStart), status: "idea" }, onSaved: refresh });
  });
}

function agendaRow(c, campaignById) {
  const dt = new Date(c.scheduleDate || c.publishedDate);
  const campaign = c.campaignId ? campaignById.get(c.campaignId) : null;
  return `
    <div class="agenda-row" data-id="${escapeHtml(c.id)}">
      <div class="agenda-date"><div class="d">${dt.getDate()}</div><div class="m">${months()[dt.getMonth()].slice(0,3)}</div></div>
      <div class="ti" style="flex:1;min-width:0;">
        <div class="t" style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.title || t("common.untitled"))}</div>
        <div class="text-muted" style="font-size:12.5px;margin-top:2px;">${escapeHtml(c.platform || "—")} · ${escapeHtml(c.format || "—")}</div>
      </div>
      ${campaign ? `<span class="tag" style="background:color-mix(in srgb, var(--brand-tint) 14%, transparent);color:var(--brand-tint);">${escapeHtml(campaignDisplayName(campaign.name))}</span>` : ""}
      <span class="tag tag-${escapeHtml((c.funnel || "").toLowerCase())}">${escapeHtml(funnelShort(c.funnel))}</span>
      <span class="status-pill status-${escapeHtml(c.status)}"><span class="status-dot"></span>${escapeHtml(STATUS_LABELS[c.status] || c.status)}</span>
    </div>
  `;
}

function wireDragAndOpen(body, brandId, refresh, state = {}) {
  // Marks "something from the grid is being dragged" on the page, so the
  // Bank knows to take it back (a Bank item dropped on the Bank is a no-op).
  const page = body.closest(".cal-layout")?.parentElement || body;
  qsa(".cal-item", body).forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", el.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      page.classList.add("is-cal-dragging");
    });
    el.addEventListener("dragend", () => page.classList.remove("is-cal-dragging"));
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openCalItemMenu(el, { brandId, contentId: el.dataset.id, refresh });
    });
  });

  qsa(".cal-cell", body).forEach((cell) => {
    // Past days never accept a drop: skipping preventDefault on dragover is
    // what makes the browser show "not allowed" and refuse the drop.
    const isPast = () => cell.dataset.date < localISODate();
    cell.addEventListener("dragover", (e) => {
      if (isPast()) return;
      e.preventDefault();
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      page.classList.remove("is-cal-dragging");
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      assignToDate(brandId, id, cell.dataset.date);
    });
    cell.addEventListener("click", (e) => {
      // Placing from the Bank (its calendar icon): this tap is the date.
      if (state.placingId) {
        e.stopPropagation();
        if (isPast()) { toast(t("calendar.pastDate"), "error"); return; }
        const id = state.placingId;
        state.placingId = null;
        assignToDate(brandId, id, cell.dataset.date);
        refresh();
        return;
      }
      if (e.target.closest(".cal-item")) return;
      if (isPast()) {
        toast(t("calendar.pastDate"), "error");
        return;
      }
      openDateBankMenu(cell, { brandId, dateISO: cell.dataset.date, refresh });
    });
  });
}

// Same-funnel-same-day is the one rule the user wants actively enforced
// (a brand might publish 2 pieces in a day, but never two of the same
// TOFU/MOFU/BOFU stage) — informational only, never blocks the action.
function warnIfFunnelClash(brandId, contentId, dateISO) {
  const moving = listContent(brandId).find((c) => c.id === contentId);
  if (!moving) return;
  const clash = listContent(brandId).some(
    (c) => c.id !== contentId && c.scheduleDate === dateISO && c.funnel === moving.funnel
  );
  if (clash) toast(t("calendar.funnelClash", { date: formatCellDate(dateISO), funnel: moving.funnel }), "error");
}

function assignToDate(brandId, contentId, dateISO) {
  // A saved idea from the Bank (drag or "ketuk tanggal") becomes content.
  if (isIdeaKey(contentId)) {
    scheduleIdea(brandId, contentId.slice(IDEA_PREFIX.length), dateISO);
    return;
  }
  // A scheduled date in the past used to be accepted, then the item was
  // hidden from both the grid and the Bank — looked like it was deleted.
  if (!dateISO || dateISO < localISODate()) {
    toast(t("calendar.pastDate"), "error");
    return;
  }
  // Only the date. A date says when it goes out, not how far along it is —
  // setting "Siap upload" here used to drop an empty idea straight into
  // Creator's upload panel, and could turn a published post back into
  // "ready to upload". Auto-schedule (above) already writes the date alone.
  updateContent(contentId, { scheduleDate: dateISO });
  warnIfFunnelClash(brandId, contentId, dateISO);
  toast(t("common.scheduled"));
}

// Click on a placed item → a small Edit / Remove-from-calendar choice,
// instead of jumping straight into the editor — mirrors the row-menu
// pattern used in Content OS's table (content-list.js).
function openCalItemMenu(anchorEl, { brandId, contentId, refresh }) {
  const rect = anchorEl.getBoundingClientRect();
  const menu = openMenu(anchorEl, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 190) });
  if (!menu) return;
  menu.innerHTML = `
    <button data-act="edit">${icon("edit", { size: 15 })}${t("common.edit")}</button>
    <button data-act="remove" class="danger">${icon("x", { size: 15 })}${t("calendar.removeFromCalendar")}</button>
  `;
  menu.addEventListener("click", async (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-act]")?.dataset.act;
    closeMenu();
    if (act === "edit") {
      openContentEditor({ brandId, contentId, onSaved: refresh });
    } else if (act === "remove") {
      const ok = await confirmDialog({
        title: t("calendar.removeConfirmTitle"),
        message: t("calendar.removeConfirmMsg"),
        confirmLabel: t("common.remove"),
      });
      if (!ok) return;
      updateContent(contentId, { scheduleDate: "" });
      toast(t("calendar.removedToast"));
      refresh();
    }
  });
}

// Tapping an empty spot on a day cell surfaces the same unscheduled backlog
// as the Content Bank sidebar, scoped to a single click-to-assign choice —
// no dragging required — with "create new" as the fallback underneath.
function openDateBankMenu(cell, { brandId, dateISO, refresh }) {
  const unscheduled = listContent(brandId).filter((c) => !c.scheduleDate && c.status !== "published");
  const rect = cell.getBoundingClientRect();
  const menu = openMenu(cell, { className: "date-bank-menu", top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 260) });
  if (!menu) return;
  menu.innerHTML = `
    <div class="date-bank-menu-head">
      <span>${formatCellDate(dateISO)}</span>
      <button type="button" class="icon-btn" data-close aria-label="${t("common.close")}" style="width:22px;height:22px;">${icon("x", { size: 12 })}</button>
    </div>
    <div class="date-bank-menu-list">
      ${
        unscheduled.length
          ? unscheduled
              .map(
                (c) => `
          <button data-assign="${c.id}">
            <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>
            <span class="date-bank-menu-title">${escapeHtml(c.title || t("common.untitled"))}</span>
          </button>`
              )
              .join("")
          : `<div class="text-faint" style="font-size:12px;padding:8px 10px;">${t("calendar.dateBankEmpty")}</div>`
      }
    </div>
    <div class="menu-divider"></div>
    <button data-create>${icon("plus", { size: 15 })}${t("calendar.createNewContent")}</button>
  `;
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest("[data-close]")) {
      closeMenu();
      return;
    }
    const assignId = e.target.closest("[data-assign]")?.dataset.assign;
    if (assignId) {
      closeMenu();
      assignToDate(brandId, assignId, dateISO);
      refresh();
      return;
    }
    if (e.target.closest("[data-create]")) {
      closeMenu();
      openContentEditor({ brandId, stay: true, defaults: { scheduleDate: dateISO, status: "idea" }, onSaved: refresh });
    }
  });
}

function formatCellDate(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  const mon = months()[d.getMonth()].slice(0, 3);
  return getLang() === "id" ? `${dow()[d.getDay()]}, ${d.getDate()} ${mon}` : `${dow()[d.getDay()]}, ${mon} ${d.getDate()}`;
}
