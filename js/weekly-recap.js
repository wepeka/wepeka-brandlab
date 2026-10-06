// Beranda's weekly loop (js/views/home.js), in one card: "Minggu ini".
//
//   7 hari terakhir — planned vs published, the posting streak (or views),
//                     sales logged, the most-viewed post, and the weekly
//                     report PDF (its "Waktunya report mingguan" nag lives
//                     here now instead of being its own block);
//   7 hari ke depan — what's late, what's coming, and the one way to fill
//                     the week: the chat's week plan (consultant-panel.js
//                     openWeekPlan — ideas the owner ticks, nothing made
//                     until then).
//
// It replaced three Beranda blocks ("Jadwal berikutnya", the report nag and
// the header's streak line). Also here: the one-time recap card for a
// finished Event or Grow Brand ladder, with "Pasang tujuan berikutnya".
//
// The numbers use the same definitions as the report (js/views/report.js
// "week" range = today and the 6 days before, best post = organicViews,
// sales = the tracker's dated entries), so the card and the PDF it links to
// never disagree. Pure helpers are unit-tested in tests/beranda.test.mjs.
import { localISODate, organicViews, consecutiveActiveWeeks, eventCampaignEnd, campaignContentPool } from "./store.js";
import { getTracker, eventSalesStats, campaignSalesStats } from "./sales-tracker.js";
import { icon } from "./icons.js";
import { escapeHtml as esc, formatNumber, formatDate } from "./dom.js";
import { t, getLang, campaignDisplayName } from "./i18n.js";
import { funnelShort } from "./funnel-field.js";

export const RECAP_WINDOW_DAYS = 30;
const SCHEDULE_ROWS = 5;
const LATE_ROWS = 3;

function shiftISO(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localISODate(d);
}
const isLive = (c) => !c.archived && c.status !== "archived" && !c.deletedAt;
const rp = (n) => `Rp ${formatNumber(Math.round(n || 0))}`;
// "Rp 1,2 jt" / "Rp 1.2M" — a stat tile on a phone has room for ~8 characters.
export function rpCompact(n, lang = getLang()) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) < 10000) return rp(v);
  try {
    return `Rp ${new Intl.NumberFormat(lang === "en" ? "en-US" : "id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
  } catch {
    return rp(v);
  }
}
const shortDate = (isoDate) => formatDate(`${isoDate}T00:00:00`, { year: undefined });

export function lastWeekRange(now = new Date()) {
  const end = localISODate(now);
  return { start: shiftISO(end, -6), end };
}
export function nextWeekRange(now = new Date()) {
  const start = localISODate(now);
  return { start, end: shiftISO(start, 6) };
}

// The last 7 days. `planned` = everything dated into the window (scheduled
// there, or published there) — so published ≤ planned always, and a post
// that went out unplanned still counts as both.
// `exclude`: content ids another Beranda block already shows (Hari ini's
// piece) — never named again as the week's best post.
export function weekRecap({ brand, content, now = new Date(), exclude = new Set() }) {
  const { start, end } = lastWeekRange(now);
  const inRange = (d) => !!d && d >= start && d <= end;
  const live = content.filter(isLive);
  const pubDate = (c) => c.publishedDate || c.scheduleDate || "";
  const published = live.filter((c) => c.status === "published" && inRange(pubDate(c)));
  const planned = live.filter((c) => (c.status === "published" ? inRange(pubDate(c)) : inRange(c.scheduleDate)));
  let best = null;
  let views = 0;
  published.forEach((c) => {
    const v = Number(organicViews(c)) || 0;
    views += v;
    if (v > 0 && !exclude.has(c.id) && (!best || v > best.views)) best = { content: c, views: v };
  });
  const tracker = getTracker(brand);
  const entries = tracker.entries.filter((e) => inRange(e.date));
  const sales = tracker.entries.length
    ? { count: entries.length, qty: entries.reduce((a, e) => a + (Number(e.qty) || 0), 0), revenue: entries.reduce((a, e) => a + (Number(e.amount) || 0), 0) }
    : null;
  return {
    start, end,
    planned: planned.length,
    published: published.length,
    views,
    best,
    sales,
    streakWeeks: consecutiveActiveWeeks(content, 0, now, { grace: true }),
  };
}

// The next 7 days (today included): everything dated there and not out
// yet. `total` counts all of it; `rows` leaves out what another Beranda
// card already shows (`exclude` — the Hari ini piece, a plan's own slots).
export function weekAhead({ content, now = new Date(), exclude = new Set() }) {
  const { start, end } = nextWeekRange(now);
  const all = content
    .filter((c) => isLive(c) && c.status !== "published" && c.scheduleDate && c.scheduleDate >= start && c.scheduleDate <= end)
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate));
  return { start, end, total: all.length, rows: all.filter((c) => !exclude.has(c.id)).slice(0, SCHEDULE_ROWS) };
}

// Finished Events and finished Grow Brand ladders the owner hasn't closed
// the recap of yet (campaign.recapSeenAt), newest first. Only ones that
// ended in the last RECAP_WINDOW_DAYS — an old campaign finished months ago
// isn't news the day this card ships.
export function finishedCampaignRecaps({ brand, campaigns, content, now = new Date() }) {
  const today = localISODate(now);
  const since = shiftISO(today, -RECAP_WINDOW_DAYS);
  return campaigns
    .filter((c) => c.status === "completed" && !c.recapSeenAt && !c.deletedAt)
    .map((c) => {
      let kind = null;
      let endISO = "";
      if (c.eventPlan) {
        kind = "event";
        endISO = eventCampaignEnd(c);
      } else if (c.missions?.length && c.missions.every((m) => m.completedAt)) {
        kind = "ladder";
        endISO = localISODate(new Date(Math.max(...c.missions.map((m) => Number(m.completedAt) || 0))));
      }
      if (!kind || !endISO || endISO < since || endISO > today) return null;
      // An Event counts the pieces made for it; a ladder counts its own pool
      // (everything the brand makes, for one that auto-links) while it ran.
      const startISO = c.createdAt ? localISODate(new Date(c.createdAt)) : "";
      const pool = (kind === "event" ? content.filter((x) => x.campaignId === c.id) : campaignContentPool(c, content)).filter(isLive);
      const dated = (x) => x.publishedDate || x.scheduleDate || "";
      const during = kind === "event" ? pool : pool.filter((x) => dated(x) && (!startISO || dated(x) >= startISO) && dated(x) <= endISO);
      const stats = kind === "event" ? eventSalesStats(brand, c.id) : campaignSalesStats(brand, c.id);
      return {
        campaign: c,
        kind,
        endISO,
        planned: during.length,
        published: during.filter((x) => x.status === "published").length,
        sales: stats.count ? { count: stats.count, qty: stats.qty, revenue: stats.revenue } : null,
        levels: kind === "ladder" ? { done: c.missions.filter((m) => m.completedAt).length, total: c.missions.length } : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.endISO.localeCompare(a.endISO));
}

// ---- HTML ----------------------------------------------------------------------

function statHTML(value, label, { tone = "" } = {}) {
  return `<div class="wk-stat${tone ? ` is-${tone}` : ""}"><b>${value}</b><small>${esc(label)}</small></div>`;
}

function lateRowsHTML(late, lateTotal) {
  if (!lateTotal) return "";
  const bar = `<div class="home-late-bar"><span>${t("home.action.overdue.text", { n: lateTotal })}</span><button type="button" class="btn btn-secondary btn-sm" data-shift-overdue>${icon("calendar", { size: 13 })}${t("home.action.overdue.cta")}</button></div>`;
  const rows = late.slice(0, LATE_ROWS).map((c) => `
      <div class="top-content-row wk-row is-late" data-open-content="${esc(c.id)}">
        <div class="ti">
          <div class="t">${esc(c.title || t("beginner.untitled"))}</div>
          <div class="m wk-late-text">${t("beginner.todo.overdue", { date: formatDate(c.scheduleDate) })}</div>
        </div>
        <span class="tag wk-late-tag">${t("beginner.todo.late")}</span>
      </div>`).join("");
  return bar + rows;
}

function aheadRowsHTML(rows) {
  return rows.map((c) => `
      <div class="top-content-row wk-row" data-open-content="${esc(c.id)}">
        <span class="wk-date"><b>${esc(String(Number(c.scheduleDate.slice(8, 10))))}</b><small>${esc(formatDate(`${c.scheduleDate}T00:00:00`, { month: "short", day: undefined, year: undefined }))}</small></span>
        <div class="ti">
          <div class="t">${esc(c.title || t("beginner.untitled"))}</div>
          <div class="m">${esc([c.platform, formatDate(`${c.scheduleDate}T00:00:00`, { weekday: "long", month: undefined, day: undefined, year: undefined })].filter(Boolean).join(" · "))}</div>
        </div>
        ${c.funnel ? `<span class="tag tag-${esc((c.funnel || "").toLowerCase())}">${esc(funnelShort(c.funnel))}</span>` : ""}
      </div>`).join("");
}

// input: { brandId, recap, ahead, late (content list, already de-duplicated),
// lateTotal, reportIsDue, hasPublished, canPlan, guided }
// → { bodyHTML, sub, summary }
export function weekCardParts({ brandId, recap, ahead, late = [], lateTotal = 0, reportIsDue = false, hasPublished = false, canPlan = true, guided = false }) {
  const stats = [];
  stats.push(statHTML(
    recap.planned ? `${recap.published}<span>/${recap.planned}</span>` : String(recap.published),
    recap.planned ? t("beranda.week.stat.published") : t("beranda.week.stat.publishedNoPlan"),
    { tone: recap.planned && recap.published >= recap.planned ? "good" : "" }
  ));
  if (recap.streakWeeks >= 2) stats.push(statHTML(`🔥 ${recap.streakWeeks}`, t("beranda.week.stat.streak")));
  else if (recap.views > 0 && !guided) stats.push(statHTML(formatNumber(recap.views), t("beranda.week.stat.views")));
  if (recap.sales) stats.push(statHTML(rpCompact(recap.sales.revenue), t("beranda.week.stat.sales", { n: recap.sales.count })));

  const best = recap.best
    ? `<button type="button" class="wk-best" data-open-content="${esc(recap.best.content.id)}">
         <span class="wk-best-label">${icon("chart", { size: 13 })}${t("beranda.week.best")}</span>
         <span class="wk-best-title">${esc(recap.best.content.title || t("beginner.untitled"))}</span>
         <span class="wk-best-meta">${t("beranda.week.bestViews", { n: formatNumber(recap.best.views) })}</span>
       </button>`
    : !recap.published && hasPublished
      ? `<p class="wk-note">${t("beranda.week.quiet")}</p>`
      : "";

  const report = reportIsDue
    ? `<div class="wk-report" id="report-remind">
         <span class="wk-report-text">${icon("download", { size: 14 })}${t("beranda.week.report.due")}</span>
         <span class="wk-report-actions">
           <button type="button" class="btn btn-secondary btn-sm" data-report-open="week">${t("rep.downloadPdf")}</button>
           <button type="button" class="btn btn-ghost btn-sm" data-report-snooze>${t("rep.remind.later")}</button>
         </span>
       </div>`
    : "";

  const schedule = ahead.rows.length
    ? aheadRowsHTML(ahead.rows)
    : ahead.total
      ? `<p class="wk-note">${t("beranda.week.allShown")}</p>`
      : lateTotal
        ? ""
        : `<p class="wk-note">${t("beranda.week.empty")}</p>`;
  // Secondary on purpose, even for an empty week: Hari ini holds the page's
  // one filled button.
  const planBtn = canPlan
    ? `<button type="button" class="btn btn-secondary btn-sm" data-week-plan title="${esc(t("beranda.week.planTitle", { cost: t("chat.week.cost") }))}">${icon("sparkle", { size: 13 })}${t("beranda.week.plan")}</button>`
    : "";
  const reportLink = hasPublished && !reportIsDue
    ? `<button type="button" class="btn btn-ghost btn-sm" id="home-report" title="${esc(t("rep.btnTitle"))}">${icon("download", { size: 13 })}${t("rep.btn")}</button>`
    : "";

  const bodyHTML = `
    <div class="wk-section">
      <div class="wk-section-head"><span>${t("beranda.week.last")}</span></div>
      <div class="wk-stats">${stats.join("")}</div>
      ${best}
      ${report}
    </div>
    <div class="wk-section">
      <div class="wk-section-head"><span>${t("beranda.week.next")}</span>${ahead.total ? `<span class="wk-count">${t("beranda.week.scheduleCount", { n: ahead.total })}</span>` : ""}</div>
      <div class="wk-rows">${lateRowsHTML(late, lateTotal)}${schedule}</div>
    </div>
    ${planBtn || reportLink ? `<div class="wk-foot">${planBtn}${reportLink}</div>` : ""}`;

  return {
    bodyHTML,
    sub: t("beranda.week.sub", { from: shortDate(recap.start), to: shortDate(ahead.end) }),
    summary: t("beranda.week.summary", { published: recap.published, planned: recap.planned, n: ahead.total }),
  };
}

// The finished-goal card. One at a time (the newest); the next shows once
// this one is closed.
export function recapCardHTML(recap, { brandId }) {
  const c = recap.campaign;
  const name = campaignDisplayName(c.name) || "";
  const lines = [
    recap.planned ? t("beranda.recap.content", { published: recap.published, planned: recap.planned }) : t("beranda.recap.noContent"),
    recap.levels ? t("beranda.recap.levels", recap.levels) : "",
    recap.sales ? t("beranda.recap.sales", { rp: rp(recap.sales.revenue), n: recap.sales.count }) : "",
  ].filter(Boolean);
  return `
    <section class="card glass-card home-recap" data-recap="${esc(c.id)}">
      <button type="button" class="icon-btn home-recap-close" data-recap-dismiss="${esc(c.id)}" aria-label="${esc(t("beranda.recap.dismiss"))}" title="${esc(t("beranda.recap.dismiss"))}">${icon("x", { size: 14 })}</button>
      <div class="home-recap-eyebrow">${icon(recap.kind === "event" ? "calendar" : "target", { size: 13 })}${t(`beranda.recap.eyebrow.${recap.kind}`)} · ${esc(formatDate(`${recap.endISO}T00:00:00`))}</div>
      <h2>${t("beranda.recap.title", { name: esc(name) })}</h2>
      <ul class="home-recap-stats">${lines.map((l) => `<li>${icon("check", { size: 13 })}<span>${esc(l)}</span></li>`).join("")}</ul>
      <p class="home-recap-body">${t("beranda.recap.body")}</p>
      <div class="home-recap-actions">
        <button type="button" class="btn btn-secondary" data-recap-next="${esc(c.id)}">${icon("target", { size: 14 })}${t("beranda.recap.next")}</button>
        <a class="link" href="#/brand/${esc(brandId)}/campaigns/${esc(c.id)}">${t("beranda.recap.open")}</a>
      </div>
    </section>`;
}
