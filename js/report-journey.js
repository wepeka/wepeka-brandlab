// The Report page's own numbers (js/views/report-page.js), worked out from
// the same computeReportData the PDF uses (js/views/report.js), so the page
// and the PDF never disagree. Nothing here is estimated or benchmarked:
// every figure is a sum, a count or an average of numbers the owner filled
// in. No DOM — the tests read these directly.
import { localISODate } from "./store.js";

const DAY = 86400000;
// The interactions a post's "Interaksi" adds up (views and reach are
// counted on their own; followers gained is a result, not an interaction).
export const INTERACTION_KEYS = ["likes", "comments", "shares", "saves", "reposts"];
// Up to this many posts the chart shows each post; past it, weekly sums
// (monthly past a year) so a long period stays readable on a phone.
export const MAX_POST_POINTS = 40;
// The posting calendar shows at most this many weeks (the latest ones).
export const MAX_CALENDAR_WEEKS = 10;

const dateOf = (c) => c.publishedDate || c.scheduleDate || "";
const noon = (iso) => new Date(iso + "T12:00:00");
const isoOf = (d) => localISODate(d);
const daysBetween = (a, b) => Math.round((noon(b) - noon(a)) / DAY);

// A post's interactions: the sum of the ones filled in, null when none is.
export function interactionsOf(nums) {
  const vals = INTERACTION_KEYS.map((k) => nums[k]).filter((v) => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}
// The period's interactions total, and how many posts had any.
export function interactionsTotal(d) {
  const per = d.posts.map((x) => interactionsOf(x.nums)).filter((v) => v !== null);
  return { total: per.reduce((a, b) => a + b, 0), n: per.length };
}

function mondayOf(iso) {
  const d = noon(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoOf(d);
}
const monthOf = (iso) => `${iso.slice(0, 7)}-01`;

// Views and interactions over time: one point per post (oldest first), or
// per week / per month when there are too many posts to tell apart.
export function trendSeries(d) {
  const posts = d.posts.filter((x) => dateOf(x.c));
  if (posts.length <= MAX_POST_POINTS) {
    return {
      unit: "post",
      points: posts.map((x) => ({ key: x.c.id, date: dateOf(x.c), title: x.c.title || "", format: x.c.format || "", views: x.nums.views, inter: interactionsOf(x.nums), n: 1 })),
    };
  }
  const first = dateOf(posts[0].c);
  const last = dateOf(posts[posts.length - 1].c);
  const unit = daysBetween(first, last) > 364 ? "month" : "week";
  const bucketOf = unit === "month" ? monthOf : mondayOf;
  const buckets = new Map();
  // Every bucket from the first to the last, empty ones too: a quiet week
  // is part of the story.
  for (let cur = bucketOf(first); cur <= last; ) {
    buckets.set(cur, { key: cur, date: cur, title: "", format: "", views: null, inter: null, n: 0 });
    const next = noon(cur);
    if (unit === "month") next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 7);
    cur = isoOf(next);
  }
  posts.forEach((x) => {
    const b = buckets.get(bucketOf(dateOf(x.c)));
    if (!b) return;
    b.n += 1;
    if (x.nums.views !== null) b.views = (b.views || 0) + x.nums.views;
    const inter = interactionsOf(x.nums);
    if (inter !== null) b.inter = (b.inter || 0) + inter;
  });
  return { unit, points: [...buckets.values()] };
}

// Which formats the brand made and how each did: posts, and the average
// views of the posts that have a views number. Most posts first.
export function formatMix(d) {
  const groups = new Map();
  d.posts.forEach((x) => {
    const name = (x.c.format || "").trim();
    const g = groups.get(name) || { format: name, count: 0, viewsSum: 0, viewsN: 0 };
    g.count += 1;
    if (x.nums.views !== null) { g.viewsSum += x.nums.views; g.viewsN += 1; }
    groups.set(name, g);
  });
  return [...groups.values()]
    .map((g) => ({ format: g.format, count: g.count, avgViews: g.viewsN ? g.viewsSum / g.viewsN : null }))
    .sort((a, b) => b.count - a.count || (b.avgViews || 0) - (a.avgViews || 0));
}

// The posting rhythm: a calendar of the period (Monday-start weeks, the
// latest MAX_CALENDAR_WEEKS of them), plus plain counts — posts per week,
// the longest wait between two posts, the weekday posted on most, and the
// days since the last post.
export function postingRhythm(d, start, end, { today = isoOf(new Date()), overallStart = "2000-01-01" } = {}) {
  const posts = d.posts.filter((x) => dateOf(x.c)).map((x) => ({ date: dateOf(x.c), title: x.c.title || "", views: x.nums.views }));
  const byDay = new Map();
  posts.forEach((p) => {
    if (!byDay.has(p.date)) byDay.set(p.date, []);
    byDay.get(p.date).push(p);
  });
  // "All time" starts at the first post; the calendar never runs past today
  // unless the period itself does (this month's days still to come).
  const from = start === overallStart ? (posts[0]?.date || today) : start;
  const lastDay = end;
  const countedTo = end < today ? end : today;
  const spanDays = Math.max(1, daysBetween(from, countedTo) + 1);

  let weekStart = mondayOf(from);
  const endWeek = mondayOf(lastDay);
  const weeks = [];
  while (weekStart <= endWeek) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const dt = noon(weekStart);
      dt.setDate(dt.getDate() + i);
      const iso = isoOf(dt);
      row.push({ date: iso, inPeriod: iso >= from && iso <= lastDay, future: iso > today, posts: byDay.get(iso) || [] });
    }
    weeks.push(row);
    const next = noon(weekStart);
    next.setDate(next.getDate() + 7);
    weekStart = isoOf(next);
  }
  const capped = weeks.length > MAX_CALENDAR_WEEKS;

  const dates = [...byDay.keys()].sort();
  let longestGap = null;
  for (let i = 1; i < dates.length; i++) {
    const gap = daysBetween(dates[i - 1], dates[i]);
    if (longestGap === null || gap > longestGap) longestGap = gap;
  }
  const weekdayCounts = Array(7).fill(0); // Monday = 0
  posts.forEach((p) => { weekdayCounts[(noon(p.date).getDay() + 6) % 7] += 1; });
  const most = Math.max(...weekdayCounts);
  const topWeekday = posts.length >= 3 && weekdayCounts.filter((n) => n === most).length === 1 ? weekdayCounts.indexOf(most) : null;
  const lastPost = dates[dates.length - 1] || null;

  return {
    weeks: capped ? weeks.slice(-MAX_CALENDAR_WEEKS) : weeks,
    capped,
    count: posts.length,
    activeDays: dates.length,
    perWeek: posts.length ? (posts.length / spanDays) * 7 : 0,
    spanDays,
    longestGap,
    topWeekday,
    sinceLast: lastPost && end >= today ? daysBetween(lastPost, today) : null,
  };
}

// ---------- Engagement rate & the analytics the old Pro Beranda had ----------
// (owner, 2026-10-27: "analytics yang dulu grafik2 dll engagement rate
// masukin di report juga") — the engagement rate over time, how the posts
// score on the ER scale, ER per platform and per format, and what the
// interactions are made of. Same posts as the rest of the page (the
// period's), same ERs as the PDF (computeReportData's `er`).

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// ER on the same points as trendSeries: a post's own ER, or the average ER
// of a week's / month's posts (null when none of them has one).
export function erSeries(d, series = trendSeries(d)) {
  const posts = d.posts.filter((x) => dateOf(x.c));
  if (series.unit === "post") {
    return {
      unit: "post",
      points: posts.map((x) => ({ key: x.c.id, date: dateOf(x.c), title: x.c.title || "", format: x.c.format || "", er: isNum(x.er) ? x.er : null, n: 1, rated: isNum(x.er) ? 1 : 0 })),
    };
  }
  const bucketOf = series.unit === "month" ? monthOf : mondayOf;
  const sums = new Map();
  posts.forEach((x) => {
    if (!isNum(x.er)) return;
    const k = bucketOf(dateOf(x.c));
    const s = sums.get(k) || { sum: 0, n: 0 };
    s.sum += x.er;
    s.n += 1;
    sums.set(k, s);
  });
  return {
    unit: series.unit,
    points: series.points.map((pt) => {
      const s = sums.get(pt.key);
      return { key: pt.key, date: pt.date, title: "", format: "", er: s ? s.sum / s.n : null, n: pt.n, rated: s ? s.n : 0 };
    }),
  };
}

// How the period's posts score on the ER scale (formulas.js health), best
// first. Posts without numbers yet are counted apart.
export const HEALTH_ORDER = ["excellent", "good", "average", "poor"];
export function healthMix(d) {
  const counts = Object.fromEntries(HEALTH_ORDER.map((h) => [h, 0]));
  let unrated = 0;
  d.posts.forEach((x) => {
    if (x.health && x.health in counts) counts[x.health] += 1;
    else unrated += 1;
  });
  const rated = HEALTH_ORDER.reduce((a, h) => a + counts[h], 0);
  return { counts, rated, unrated };
}

// The average ER per group (`keyOf(post)` → its name; "" = not set), only
// over posts that have an ER, highest first.
export function erBy(d, keyOf) {
  const groups = new Map();
  d.posts.forEach((x) => {
    if (!isNum(x.er)) return;
    const name = String(keyOf(x) || "").trim();
    const g = groups.get(name) || { name, sum: 0, n: 0 };
    g.sum += x.er;
    g.n += 1;
    groups.set(name, g);
  });
  return [...groups.values()].map((g) => ({ name: g.name, avg: g.sum / g.n, n: g.n })).sort((a, b) => b.avg - a.avg || b.n - a.n);
}

// What the interactions are made of: saves, shares, reposts, comments and
// likes each as a share of reach (%), averaged over the posts that have
// both numbers. Saves and shares are the ones the platforms push.
export const MIX_KEYS = [["saveRate", "saves"], ["shareRate", "shares"], ["repostRate", "reposts"], ["commentRate", "comments"], ["likeRate", "likes"]];
export function engagementMix(d) {
  return MIX_KEYS.map(([key, metric]) => {
    const vals = d.posts
      .filter((x) => isNum(x.nums.reach) && x.nums.reach > 0 && isNum(x.nums[metric]))
      .map((x) => (x.nums[metric] / x.nums.reach) * 100);
    return vals.length ? { key, avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
  }).filter(Boolean);
}
