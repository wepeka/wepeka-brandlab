// "AI dummy" for tours. While any spotlight tour is on screen
// (body.tour-active, set by js/tour.js), the AI buttons a guide asks the
// user to press return canned sample output instead of calling the real
// provider — no tokens spent, no API key required, and the "tunggu
// hasilnya" step still has a short wait so it feels like the real thing.
// Every result is visibly labelled as a sample ("Contoh") so nothing saved
// from it can be mistaken for real AI output.
import { t } from "./i18n.js";

const DEMO_DELAY_MS = 1200;
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const DEMO_TOAST = t("demo.toast");

export function isTourDemo() {
  return typeof document !== "undefined" && !!document.body?.classList.contains("tour-active");
}

const wait = (ms = DEMO_DELAY_MS) => new Promise((r) => setTimeout(r, ms));

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Same contract as ai.js suggestSchedule (Map of id → "YYYY-MM-DD"), built
// from the brand's own Jadwal Kerja: only upload days, at most perDay per
// day, never the same funnel twice on one day, most-ready pieces first.
export async function demoSuggestSchedule({ items, startDate, daysAhead = 21, cadence }) {
  await wait();
  const map = new Map();
  if (!items?.length) return map;
  const allowed = cadence?.configured && cadence.uploadDays?.length ? new Set(cadence.uploadDays) : null;
  const perDay = Math.max(1, Number(cadence?.perDay) || 1);
  const readiness = { scheduled: 0, editing: 1, production: 2, draft: 3, idea: 4 };
  const sorted = [...items].sort((a, b) => (readiness[a.status] ?? 5) - (readiness[b.status] ?? 5));
  const start = new Date(`${startDate}T00:00:00`);
  const days = [];
  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (!allowed || allowed.has(DOW[d.getDay()])) days.push(iso(d));
  }
  if (!days.length) {
    const d = new Date(start);
    d.setDate(start.getDate() + 1);
    days.push(iso(d));
  }
  const slots = new Map();
  let cursor = 0;
  for (const it of sorted) {
    const funnel = it.funnel || "TOFU";
    let pick = null;
    for (let k = 0; k < days.length; k++) {
      const day = days[(cursor + k) % days.length];
      const s = slots.get(day) || { count: 0, funnels: new Set() };
      if (s.count < perDay && !s.funnels.has(funnel)) {
        pick = day;
        cursor = (cursor + k + 1) % days.length;
        break;
      }
    }
    if (!pick) {
      pick = days[cursor % days.length];
      cursor = (cursor + 1) % days.length;
    }
    const s = slots.get(pick) || { count: 0, funnels: new Set() };
    s.count++;
    s.funnels.add(funnel);
    slots.set(pick, s);
    map.set(it.id, pick);
  }
  return map;
}

// Same shape as ai.js brainstormCampaignIdeas.
export async function demoBrainstormIdeas({ brand, mission } = {}) {
  await wait();
  const name = brand?.name || t("demo.yourBrand");
  const focus = mission?.name ? ` ${t("demo.ideas.focus", { mission: mission.name })}` : "";
  return {
    demo: true,
    ideas: [
      { title: t("demo.idea1.title", { name }), angle: `${t("demo.idea1.angle", { name })}${focus}`, format: "Reels" },
      { title: t("demo.idea2.title"), angle: t("demo.idea2.angle"), format: "Carousel" },
      { title: t("demo.idea3.title"), angle: t("demo.idea3.angle"), format: "Reels" },
    ],
  };
}

// Same shape as ai.js suggestPhaseContent (array of ideas).
export async function demoPhaseContent({ phase } = {}) {
  await wait();
  const phaseName = phase?.name || t("demo.phase.fallback");
  return [
    { title: t("demo.phase1.title", { phase: phaseName }), angle: t("demo.phase1.angle"), format: "Reels" },
    { title: t("demo.phase2.title"), angle: t("demo.phase2.angle"), format: "Carousel" },
  ];
}

// Same shape as ai.js generateScript ({ hooks, script, caption }), honoring
// `only` the same way (regenerate just hooks or just script). Creator's own
// 👍/👎 strip is never mounted on this output (see creator.js) so a sample
// never lands in the aiFeedback eval set.
export async function demoGenerateScript({ only } = {}) {
  await wait();
  const hooks = [t("demo.script.hook1"), t("demo.script.hook2"), t("demo.script.hook3")];
  const script = t("demo.script.body");
  const caption = t("demo.script.caption");
  return {
    hooks: !only || only === "hooks" ? hooks : [],
    script: !only || only === "script" ? script : "",
    caption: !only || only === "caption" ? caption : "",
  };
}

// Same shape as ai.js generateCampaignPlan, plus `demo: true` so the review
// modal skips the 👍/👎 feedback strip (sample output must never land in the
// aiFeedback eval set).
export async function demoCampaignPlan({ brand, objectiveText, enabledPhases = [] } = {}) {
  await wait();
  return {
    demo: true,
    name: t("demo.plan.name", { name: brand?.name || "" }).trim(),
    targetAudience: brand?.brandDNA?.targetAudience || t("demo.plan.audience"),
    problemOrOpportunity: objectiveText || "",
    insight: t("demo.plan.insight"),
    bigIdea: t("demo.plan.bigIdea"),
    keyMessage: t("demo.plan.keyMessage"),
    offer: "",
    cta: t("demo.plan.cta"),
    channels: ["Instagram Reels", "TikTok"],
    phases: enabledPhases.map((p) => ({ name: p.name, goal: t("demo.plan.phaseGoal", { phase: p.name }) })),
  };
}

// Same shape as ai.js generateCopy ({ variants: [{ parts, note }] }). A
// testimonial is echoed back word for word, same rule as the real prompt.
// Copy Studio never mounts its 👍/👎 strip on this output.
export async function demoGenerateCopy({ brand, format, goal, details = {}, message = "", threadMode = "single", count = 3 } = {}) {
  await wait();
  const name = brand?.name || t("demo.yourBrand");
  const tag = name.toLowerCase().replace(/[^a-z0-9]/g, "") || "brand";
  const quote = details.quote || "";
  const topic = details.product || message || t("demo.copy.ourProduct");
  const core = goal === "testimoni" && quote ? `"${quote}" (${details.customer || t("demo.copy.oneCustomer")})` : t("demo.copy.about", { topic });
  const hooks = [t("demo.copy.hook1"), t("demo.copy.hook2"), t("demo.copy.hook3")];
  // Each format's sample mirrors its real rules in js/knowledge/copy-formats.js,
  // so the tour already shows why a Threads post, a Story line, a WhatsApp
  // broadcast and a feed caption are four different things.
  const variant = (hook) => {
    if (format === "threads" && threadMode === "chain") {
      return { parts: [`1/4 ${hook}`, t("demo.copy.chain2", { core }), t("demo.copy.chain3"), t("demo.copy.chain4")], note: "" };
    }
    if (format === "threads") {
      return { parts: [t("demo.copy.threads", { hook, core })], note: "" };
    }
    if (format === "story") {
      return { parts: [goal === "testimoni" && quote ? `"${quote.length > 70 ? `${quote.slice(0, 70)}…` : quote}"` : t("demo.copy.story", { name })], note: t("demo.copy.storyNote") };
    }
    if (format === "wa") {
      return { parts: [t("demo.copy.wa", { hook, core })], note: "" };
    }
    if (format === "feed") {
      return { parts: [t("demo.copy.feed", { hook, core, tag })], note: "" };
    }
    return { parts: [t("demo.copy.other", { hook, core })], note: "" };
  };
  return { demo: true, variants: Array.from({ length: count }, (_, i) => variant(hooks[i % hooks.length])) };
}

// Same shape as ai.js rewriteCopy ({ parts, note }).
export async function demoRewriteCopy({ parts = [], note = "", label = t("demo.rewrite.new") } = {}) {
  await wait(700);
  return { parts: parts.map((p, i) => (i === 0 ? `${t("demo.rewrite.prefix", { label })} ${p}` : p)), note };
}
