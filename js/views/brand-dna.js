import { backLinkHTML } from "../back-link.js";
import { getBrand, updateBrand, getSettings, defaultBrandDNA, defaultPersonality } from "../store.js";
import { linesToList, listToLines, toast, qs, qsa, escapeHtml } from "../dom.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { COLOR_FEELINGS, feelingLabel, personalityProfile } from "../brandbook-data.js";
import { suggestBrandDnaOptions, generateOneLiner, AiApiError, hasAiKey, generateBrandDnaDraft } from "../ai.js";
import { getMode } from "../mode.js";
import { mountAiFeedback } from "../ai-feedback.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { sectionGuideButtonHTML, wireSectionGuideButton } from "../section-guide.js";
import { maybeAutoPlayVideo } from "../guide-videos.js";
import { brandDnaCompleteness } from "./brand-home.js";
import { markDnaJustCompleted } from "./brand-builder.js";
import { t } from "../i18n.js";

const TOUR_STEPS = [
  { selector: ".dna-progress-label", title: t("dna.tour.title"), body: t("dna.tour.body") },
];

// A guided, one-question-at-a-time wizard (StoryBrand-inspired, blended with
// this app's own Brand DNA fields) instead of one long form — per the user's
// own request, so filling this out doesn't feel like staring at a blank
// form with no idea what's actually being asked. Nothing is required; every
// step can be left blank and revisited later. Answers only get written to
// the brand (one `updateBrand` call) when the user hits Save on the final
// Review screen — same "buffer locally, persist on an explicit save" pattern
// every other editor in this app already uses.
//
// Most steps break their question into 2-4 short boxes instead of one big
// textarea — a person with zero branding background can answer "berapa
// usia mereka?" without thinking, but freezes at "describe your customer"
// with a blank page. Each box gets its own tiny AI-assist ("pakai AI buat
// mikirin ini") for when they're stuck, and a "Gabungkan jadi satu jawaban"
// button turns the short fragments into one flowing paragraph — which is
// what actually gets saved, still editable afterward with the same
// options-picker AI polish every other field here has.
// The "customer" isn't always the one paying — a kids' brand's actual
// audience can be a toddler or a preschooler, not just the parent buying
// for them — so the range starts from birth, not adulthood.
// Sentence helpers for the compose templates — keep the owner's own words,
// just fix the casing where a fragment lands mid-sentence.
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const stripEnd = (s) => (s || "").trim().replace(/[.!?]+$/, "");

const AGE_RANGES = [t("dna.age.0to2"), t("dna.age.3to5"), t("dna.age.6to12"), t("dna.age.13to17"), "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

// The wizard is StoryBrand's SB7 in order — Character, Problem, Guide,
// Plan, Call to Action, Success/Failure — plus one Identity step (brand
// name, tagline, brand character) that used to be three separate stages
// over in Brand Builder, which is why people got asked for their brand's
// personality again right after "finishing" Brand DNA.
// Deliberately few boxes: the old version asked 20+ small questions across
// 8 steps and several of them overlapped, so people froze or repeated
// themselves. One or two boxes per step, one idea each.
const STEPS = [
  {
    key: "audience",
    field: "targetAudience",
    kind: "compose",
    title: t("dna.sb7.audience.title"),
    guide: t("dna.sb7.audience.guide"),
    principle: "Hero didefinisikan dari APA YANG DIA INGINKAN secara konkret, bukan sekadar data demografis. Jawaban akhir harus jelas nyebut satu keinginan atau tujuan spesifik si pelanggan.",
    parts: [
      { key: "who", label: t("dna.sb7.audience.who"), placeholder: t("dna.sb7.audience.whoPh") },
      { key: "want", label: t("dna.sb7.audience.want"), placeholder: t("dna.sb7.audience.wantPh") },
    ],
    // These questions describe the customer for the brand's own notes —
    // the AI options must say "mereka", not address the customer.
    voice: "third-person",
    compose: (p) => {
      const who = capFirst(stripEnd(p.who));
      const want = lowerFirst(stripEnd(p.want));
      if (who && want) return t("dna.sb7.audience.compose", { who, want });
      return who ? `${who}.` : want ? `${capFirst(want)}.` : "";
    },
    example: t("dna.sb7.audience.example"),
  },
  {
    key: "problem",
    field: "problemSolved",
    kind: "compose",
    title: t("dna.sb7.problem.title"),
    guide: t("dna.sb7.problem.guide"),
    principle: "Problem StoryBrand berlapis: masalah eksternal (yang kelihatan) memicu masalah internal (perasaan). Jawaban akhir harus menyambungkan sebab-akibat itu, bukan daftar keluhan terpisah.",
    parts: [
      { key: "visible", label: t("dna.sb7.problem.visible"), placeholder: t("dna.sb7.problem.visiblePh") },
      { key: "feel", label: t("dna.sb7.problem.feel"), placeholder: t("dna.sb7.problem.feelPh") },
    ],
    voice: "third-person",
    compose: (p) => {
      const visible = capFirst(stripEnd(p.visible));
      const feel = lowerFirst(stripEnd(p.feel));
      if (visible && feel) return t("dna.sb7.problem.compose", { visible, feel });
      return visible ? `${visible}.` : feel ? `${capFirst(feel)}.` : "";
    },
    example: t("dna.sb7.problem.example"),
  },
  {
    key: "guide",
    field: "differentiation",
    syncField: "positioning",
    kind: "compose",
    title: t("dna.sb7.guide.title"),
    guide: t("dna.sb7.guide.guide"),
    principle: "Brand adalah Guide, bukan Hero — meyakinkan lewat Empathy (paham situasi pelanggan) dan Authority (bukti konkret pernah bantu orang lain). Hindari klaim kosong seperti 'terbaik' atau 'nomor satu'.",
    parts: [
      { key: "empathy", label: t("dna.sb7.guide.empathy"), placeholder: t("dna.sb7.guide.empathyPh") },
      { key: "proof", label: t("dna.sb7.guide.proof"), type: "list" },
    ],
    compose: (p) => {
      const empathy = capFirst(stripEnd(p.empathy));
      const proof = (Array.isArray(p.proof) ? p.proof : []).map(stripEnd).filter(Boolean);
      if (!empathy && !proof.length) return "";
      return t("dna.sb7.guide.compose", { empathy: empathy ? `${empathy}.` : "", proof: proof.join("; ") }).replace(/\s*Buktinya:\s*\.$/, "").replace(/\s*Proof:\s*\.$/, "").trim();
    },
    example: t("dna.sb7.guide.example"),
  },
  {
    key: "plan",
    field: "mission",
    kind: "funnel3",
    title: t("dna.sb7.plan.title"),
    guide: t("dna.sb7.plan.guide"),
    principle: "Plan yang baik bikin langkah pertama terasa kecil dan rendah risiko. Tiap langkah harus aksi konkret yang dilakukan/dialami pelanggan secara berurutan, bukan hasil akhir atau istilah abstrak.",
    parts: [
      { key: "step1", label: t("dna.plan.step", { n: 1 }), placeholder: t("dna.plan.step1Ph") },
      { key: "step2", label: t("dna.plan.step", { n: 2 }), placeholder: t("dna.plan.step2Ph") },
      { key: "step3", label: t("dna.plan.step", { n: 3 }), placeholder: t("dna.plan.step3Ph") },
    ],
    example: t("dna.plan.example"),
  },
  {
    key: "cta",
    field: "callToAction",
    title: t("dna.sb7.cta.title"),
    guide: t("dna.sb7.cta.guide"),
    principle: "Call to action StoryBrand itu satu ajakan berani dan gamblang, seperti tombol — selalu dimulai kata kerja aksi, tanpa embel-embel alasan/manfaat di kalimat yang sama.",
    example: t("dna.cta.example"),
    maxWords: 8,
  },
  {
    key: "stakes",
    title: t("dna.sb7.stakes.title"),
    guide: t("dna.sb7.stakes.guide"),
    fields: [
      {
        field: "successOutcome", label: t("dna.stakes.success"),
        example: t("dna.stakes.successExample"),
        principle: "Success StoryBrand termasuk siapa pelanggan ini JADI setelah berhasil (percaya diri, identitas baru), bukan cuma manfaat fungsional.",
      },
      {
        field: "failureOutcome", label: t("dna.stakes.failure"),
        example: t("dna.stakes.failureExample"),
        principle: "Failure di StoryBrand nyata tapi nggak didramatisir — sebutkan apa yang benar-benar hilang kalau nggak bertindak, bahasa jujur, bukan clickbait.",
      },
    ],
  },
  {
    key: "identity",
    title: t("dna.sb7.identity.title"),
    guide: t("dna.sb7.identity.guide"),
  },
];

// Pemula sees fewer boxes per question: parts marked optionalInGuided are
// the "nice to have" ones (worry, duration, loyalty). compose() already
// treats a missing part as blank, and Pro still gets every box.
function stepParts(step) {
  return getMode() === "guided" ? step.parts.filter((p) => !p.optionalInGuided) : step.parts;
}

// Reverses the funnel3 "plan" step's join format ("1) X 2) Y 3) Z") back
// into { step1, step2, step3 } so the 3 boxes can show what's actually
// saved instead of rendering blank next to a non-empty answer.
function decomposeFunnel3Plan(value) {
  if (!value) return {};
  const parts = {};
  const re = /([123])\)\s*([\s\S]*?)(?=\s[123]\)|$)/g;
  let m;
  while ((m = re.exec(value))) {
    parts[`step${m[1]}`] = m[2].trim();
  }
  return parts;
}

export function render(root, { brandId, step }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const dna = brand.brandDNA || {};
  // Deep-links from the Brand Builder hub (e.g. its "Positioning" card)
  // land here on the exact step that question actually lives in, instead
  // of always restarting at step 0 regardless of which card was clicked —
  // see STAGES' href functions in brand-builder.js.
  const requestedIndex = step ? STEPS.findIndex((s) => s.key === step) : -1;
  const state = {
    stepIndex: requestedIndex >= 0 ? requestedIndex : 0,
    answers: {
      targetAudience: dna.targetAudience || "", problemSolved: dna.problemSolved || "",
      positioning: dna.positioning || "", differentiation: dna.differentiation || "",
      mission: dna.mission || "", callToAction: dna.callToAction || "",
      successOutcome: dna.successOutcome || "", failureOutcome: dna.failureOutcome || "",
      purpose: dna.purpose || "", vision: dna.vision || "",
      tagline: dna.tagline || "", oneLiner: dna.oneLiner || "",
      personality: dna.personality || [], values: dna.values || [], productsServices: dna.productsServices || [],
    },
    // Brand name and brand character used to be their own Brand Builder
    // stages (Naming, Personality) — asked right after someone had just
    // "finished" Brand DNA. They live in the last step of this wizard now
    // and still save to exactly the same places (brand.name,
    // brand.brandBuilder.personality), so Guidelines/Brand Book/the AI
    // read them unchanged.
    brandName: brand.name || "",
    personality: (() => {
      const pb = brand.brandBuilder?.personality || {};
      return { feeling: pb.feeling || "", primary: [...(pb.primary || [])], secondary: [...(pb.secondary || [])], avoid: [...(pb.avoid || [])] };
    })(),
    // Scratch state for the broken-down questions — the short per-box
    // answers used to compose the final saved paragraph. Not persisted to
    // brandDNA itself (only the composed result is), so "compose" steps
    // (audience/problem/trust) start these boxes blank again on revisit —
    // acceptable there since the combined narrative textarea still shows
    // the real saved answer. The "plan" step (funnel3 — Langkah 1/2/3) has
    // no such textarea, so its 3 boxes are the ONLY visible trace of that
    // answer — leaving them blank made a fully-saved "mission" field look
    // completely lost, and re-typing even one box would silently overwrite
    // the other two (the live input listener rebuilds the whole combined
    // string from just what's on screen). Reconstructing them from the
    // already-saved value fixes both.
    parts: { ...(dna.parts || {}), plan: { ...decomposeFunnel3Plan(dna.mission), ...((dna.parts || {}).plan || {}) } },
  };
  const refresh = () => paint(root, brandId, brand, state, refresh);

  // Pemula answers this themselves — full stop. This page used to hand a
  // blank DNA straight to the AI before the owner had read a single
  // question, which is the exact opposite of what the wizard is for: the
  // answers are supposed to be *theirs*. AI is still here, but only behind
  // the button below, and only after a confirmation that says out loud
  // it's better to answer one by one.
  refresh();
  // One-time explainer for this page; the Video button in the page head
  // above replays it afterwards (js/guide-videos.js).
  maybeAutoPlayVideo("brand-dna");
  return () => {};
}

// One write for everything this wizard owns: the Brand DNA answers, the
// brand name (Naming), and the brand character (Personality).
// `aiDraft: true` marks what's written as AI's draft, not the owner's
// answer. Beranda's journey reads that flag so opening this page and letting
// the AI fill it in doesn't tick "Brand DNA selesai" behind the owner's
// back — only a real save of their own does. Every other call clears it,
// which is exactly right: Next, "Simpan progress" and Save are all the owner
// saying "yes, this is mine".
function persistDna(brandId, state, { aiDraft = false } = {}) {
  const brand = getBrand(brandId);
  const patch = { brandDNA: { ...state.answers, parts: state.parts, aiDraftPending: aiDraft } };
  const name = (state.brandName || "").trim();
  if (name && brand && name !== brand.name) patch.name = name;
  const p = state.personality;
  if (p?.feeling) {
    const bb = brand?.brandBuilder || {};
    const completedStages = new Set(bb.completedStages || []);
    completedStages.add("personality");
    patch.brandBuilder = {
      ...bb,
      completedStages: [...completedStages],
      personality: { feeling: p.feeling, primary: p.primary, secondary: p.secondary, avoid: p.avoid, source: "user" },
    };
  }
  updateBrand(brandId, patch);
}

function stepAnswerSummaries(state, upToIndex) {
  return STEPS.slice(0, upToIndex)
    .flatMap((s) => (s.fields ? s.fields.map((f) => state.answers[f.field]) : [state.answers[s.field]]))
    .filter(Boolean);
}

function paint(root, brandId, brand, state, refresh) {
  const total = STEPS.length + 1; // +1 for Review
  const isReview = state.stepIndex >= STEPS.length;
  const step = isReview ? null : STEPS[state.stepIndex];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brand.id}/builder`, t("nav.builder"))} · ${t("dna.eyebrowWizard")}${helpButtonHTML("brand-dna")}${sectionGuideButtonHTML("brand-dna")}</div>
        <h1>${brand.name}</h1>
      </div>
    </div>
    <div style="max-width:640px;">
      <div class="flex items-center justify-between" style="margin-bottom:6px;">
        <span class="text-faint dna-progress-label" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${isReview ? t("dna.progress.review") : t("dna.progress.step", { n: state.stepIndex + 1, total: total - 1 })}</span>
      </div>
      <div style="height:5px;background:var(--surface-2);border-radius:999px;overflow:hidden;margin-bottom:24px;">
        <div style="height:100%;background:var(--accent);width:${Math.round(((state.stepIndex + 1) / total) * 100)}%;transition:width .2s;"></div>
      </div>
      ${isReview ? "" : aiFillCardHTML(state)}
      ${isReview ? reviewHTML(state) : stepHTML(step, state, brandId)}
    </div>
  `;

  wireHelpButtons(root);
  wireSectionGuideButton(root, "brand-dna", TOUR_STEPS);
  if (!isReview) wireStep(root, brandId, brand, state, refresh);
  else wireReview(root, brandId, brand, state, refresh);
  wireAiFill(root, brandId, brand, state, refresh);
}

// ---------- "AI isi semua" ----------
// The Pemula shortcut: one click drafts every unanswered field from the
// business description (js/ai.js generateBrandDnaDraft), saves it, and
// lands on Review — where every field is editable — instead of walking
// 8 steps of questions. Answers the owner already wrote are never
// overwritten; the button says so.
function countAnswered(answers) {
  return ["targetAudience", "problemSolved", "differentiation", "mission", "callToAction", "successOutcome", "failureOutcome", "tagline"].filter((k) => (answers[k] || "").trim()).length;
}

function aiFillCardHTML(state) {
  const answered = countAnswered(state.answers);
  const compact = state.stepIndex > 0;
  return `
    <div class="card dna-ai-fill ${compact ? "is-compact" : ""}" id="dna-ai-fill-card">
      <div class="dna-ai-fill-icon">${icon("bot", { size: 18 })}</div>
      <div class="dna-ai-fill-text">
        <div class="t">${answered ? t("dna.aiFill.titleRest") : t("dna.aiFill.titleAll")}</div>
        <div class="m">${answered ? t("dna.aiFill.bodyRest", { count: answered }) : t("dna.aiFill.bodyAll")}</div>
        <div id="dna-ai-fill-status"></div>
      </div>
      <button type="button" class="btn ${compact ? "btn-secondary btn-sm" : "btn-primary"}" id="dna-ai-fill">${icon("sparkle", { size: 14 })}${answered ? t("dna.aiFill.btnRest") : t("dna.aiFill.btnAll")}</button>
    </div>
  `;
}

function wireAiFill(root, brandId, brand, state, refresh) {
  const btn = qs("#dna-ai-fill", root);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    const statusEl = qs("#dna-ai-fill-status", root);
    if (!hasAiKey(ai)) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">${t("dna.aiFill.noAi")}</div>`;
      return;
    }
    const step = STEPS[state.stepIndex];
    if (step) captureStep(root, step, state);
    // Handing the whole DNA to AI is never the silent default — it's one
    // deliberate click plus one deliberate "yes", and the dialog says
    // plainly that the AI can only be as good as the business description
    // it reads, and that answering one by one is still the better path.
    const ok = await confirmDialog({
      title: t("dna.aiFill.confirm.title"),
      message: t("dna.aiFill.confirm.message"),
      confirmLabel: t("dna.aiFill.confirm.yes"),
      cancelLabel: t("dna.aiFill.confirm.no"),
    });
    if (!ok) return;
    btn.disabled = true;
    statusEl.innerHTML = `<div class="ocr-status" style="margin-top:8px;"><div class="spinner"></div><span>${t("dna.aiFill.working")}</span></div>`;
    try {
      const draft = await generateBrandDnaDraft(ai, { brand, answers: state.answers });
      Object.entries(draft).forEach(([k, v]) => {
        if (Array.isArray(v)) { if (!state.answers[k]?.length && v.length) state.answers[k] = v; }
        else if (v && !(state.answers[k] || "").trim()) state.answers[k] = v;
      });
      state.answers.positioning = state.answers.positioning || state.answers.differentiation;
      state.parts.plan = { ...decomposeFunnel3Plan(state.answers.mission), ...(state.parts.plan || {}) };
      persistDna(brandId, state, { aiDraft: true });
      state.stepIndex = STEPS.length;
      // Review reads this to show "ini baru draf AI, baca dulu" plus the
      // "jawab sendiri aja" escape hatch — the same treatment the old
      // auto-draft got, now that a click is the only way to get here.
      state.autoDrafted = true;
      toast(t("dna.aiFill.done"));
      refresh();
    } catch (e) {
      statusEl.innerHTML = `<div class="ocr-status" style="margin-top:8px;">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? escapeHtml(e.message) : t("dna.ai.error")}</span></div>`;
      btn.disabled = false;
    }
  });
}

// A step's required field(s) must all be non-empty before Next is
// clickable — per the user's request, this wizard is meant to make someone
// actually answer each question, not skip through a form. The "identity"
// step is the one explicit exception (it has its own Skip for now).
function isStepFilled(step, state) {
  if (step.key === "identity") return true;
  if (step.fields) return step.fields.every((f) => !!state.answers[f.field].trim());
  if (step.kind === "compose") {
    // 3.2: filled boxes count as an answer too, not just the combined
    // textarea — matches liveStepFilled's rule once the step is wired up.
    if (state.answers[step.field].trim()) return true;
    const parts = state.parts[step.key] || {};
    return Object.values(parts).some((v) => (Array.isArray(v) ? v.length > 0 : !!(v || "").trim()));
  }
  return !!state.answers[step.field].trim();
}

// The funnel3 step (plan) has no #ans-${field} element at all — its
// answer is composed purely in JS state from the 3 boxes, never rendered
// as its own textarea — so it reads state.answers directly instead of
// querying a DOM node that doesn't exist for that step.
function liveStepFilled(step, root, state) {
  if (step.key === "identity") return true;
  if (step.kind === "funnel3") return !!state.answers[step.field].trim();
  if (step.fields) return step.fields.every((f) => !!qs(`#ans-${f.field}`, root).value.trim());
  if (step.kind === "compose") {
    // 3.2: Next no longer requires clicking "Gabungkan" first — the boxes
    // being filled is enough, since Next/"Simpan progress" now compose the
    // combined textarea themselves if it's still empty.
    if (qs(`#ans-${step.field}`, root)?.value.trim()) return true;
    const parts = currentPartValues(root, step);
    return Object.values(parts).some((v) => (Array.isArray(v) ? v.length > 0 : !!(v || "").trim()));
  }
  return !!qs(`#ans-${step.field}`, root).value.trim();
}

// One narrative field's whole block: the textarea for the user's OWN real
// answer, a button that asks AI for a few sharper phrasings of it (not a
// silent rewrite), and a spot to show those options as pickable cards.
// Shared by every step's final saved answer — single-field steps, the
// paired-field steps (stakes/foundation), and the composed result of the
// broken-down steps below — so nothing is a second-class field with no AI
// help.
function narrativeFieldHTML({ field, label, guide, example, value, collapsed = false }) {
  return `
    <div class="field" ${collapsed && !value ? 'style="display:none;" data-collapsed-field' : ""}>
      ${label ? `<label>${label}</label>` : ""}
      ${guide ? `<p class="text-muted" style="font-size:13px;margin:0 0 10px;">${guide}</p>` : ""}
      <p class="text-faint" style="font-size:11.5px;margin:0 0 8px;">${t("dna.field.writeFirst")}</p>
      <textarea class="textarea" id="ans-${field}" data-field="${field}" style="min-height:90px;" placeholder="${escapeHtml(example)}">${escapeHtml(value)}</textarea>
      <button type="button" class="btn btn-secondary btn-block" data-polish="${field}" style="margin-top:8px;">${icon("bot", { size: 14 })}${t("dna.field.askAi")}</button>
      <div id="polish-status-${field}" style="margin-top:8px;"></div>
      <div id="polish-options-${field}"></div>
      <p class="text-faint" style="font-size:11.5px;margin:8px 0 0;"><em>${t("dna.field.example", { example: escapeHtml(example) })}</em></p>
    </div>
  `;
}

// ---------- Broken-down question boxes (compose / funnel3 steps) ----------

function agePartInputHTML(part, value) {
  return `
    <input class="input" id="part-${part.key}" data-part="${part.key}" list="age-range-options" placeholder="${escapeHtml(t("dna.field.agePh"))}" value="${escapeHtml(value || "")}" />
    <datalist id="age-range-options">${AGE_RANGES.map((r) => `<option value="${r}"></option>`).join("")}</datalist>
  `;
}

function proofListHTML(list) {
  return `
    <div class="flex gap-8" style="margin-bottom:8px;">
      <input class="input" id="part-proof-new" placeholder="${escapeHtml(t("dna.trust.proofPh"))}" style="flex:1;" />
      <button type="button" class="btn btn-secondary" id="part-proof-add" style="flex:none;" aria-label="${t("dna.field.add")}">${icon("plus", { size: 14 })}</button>
    </div>
    <div class="chip-list" id="part-proof-list">
      ${list.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-proof-remove="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 10 })}</button></span>`).join("")}
    </div>
  `;
}

function composePartHTML(part, value) {
  const inner =
    part.type === "age" ? agePartInputHTML(part, value)
    : part.type === "list" ? proofListHTML(Array.isArray(value) ? value : [])
    : `<input class="input" id="part-${part.key}" data-part="${part.key}" placeholder="${escapeHtml(part.placeholder || "")}" value="${escapeHtml(value || "")}" />`;
  const showAiHelp = part.type !== "list";
  return `
    <div class="field" style="margin-bottom:14px;">
      <label style="font-size:12px;">${part.label}</label>
      ${inner}
      ${showAiHelp ? `
        <button type="button" class="btn btn-ghost btn-sm" data-polish-part="${part.key}" style="margin-top:4px;font-size:11.5px;">${icon("bot", { size: 12 })}${t("dna.part.aiHelp")}</button>
        <div id="polish-status-part-${part.key}" style="margin-top:4px;"></div>
        <div id="polish-options-part-${part.key}"></div>
      ` : ""}
    </div>
  `;
}

function composeStepHTML(step, state) {
  const parts = state.parts[step.key] || {};
  return `
    <h2 style="margin-bottom:6px;">${step.title}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${step.guide}</p>
    ${stepParts(step).map((p) => composePartHTML(p, parts[p.key])).join("")}
    <button type="button" class="btn btn-secondary btn-block" id="compose-answer" style="margin-bottom:14px;">${icon("check", { size: 14 })}${t("dna.compose.btn")}</button>
    <div id="compose-status" style="margin-bottom:10px;"></div>
    ${narrativeFieldHTML({ field: step.field, label: t("dna.compose.label"), example: step.example, value: state.answers[step.field], collapsed: true })}
    ${navHTML(state, !isStepFilled(step, state))}
  `;
}

function funnel3StepHTML(step, state) {
  const parts = state.parts[step.key] || {};
  return `
    <h2 style="margin-bottom:6px;">${step.title}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${step.guide}</p>
    <div class="dna-funnel3">
      ${stepParts(step).map((p, i) => `
        <div class="dna-funnel3-box">
          <div class="dna-funnel3-num">${i + 1}</div>
          ${composePartHTML(p, parts[p.key])}
        </div>
      `).join("")}
    </div>
    ${navHTML(state, !isStepFilled(step, state))}
  `;
}

// ---------- End broken-down question boxes ----------

function stepHTML(step, state, brandId) {
  if (step.kind === "compose") return composeStepHTML(step, state);
  if (step.kind === "funnel3") return funnel3StepHTML(step, state);

  const nav = navHTML(state, !isStepFilled(step, state));
  if (step.key === "identity") {
    return `
      <h2 style="margin-bottom:6px;">${step.title}</h2>
      <p class="text-muted" style="font-size:13px;margin:0 0 20px;">${step.guide}</p>
      <div class="field">
        <label>${t("dna.sb7.identity.nameLabel")}</label>
        <input class="input" id="ans-brandName" placeholder="${escapeHtml(t("dna.sb7.identity.namePh"))}" value="${escapeHtml(state.brandName)}" />
        <a href="#/brand/${brandId}/builder/naming" id="dna-name-tool" style="display:inline-block;margin-top:6px;font-size:11.5px;font-weight:700;color:var(--accent);">${t("dna.sb7.identity.nameTool")}</a>
      </div>
      <div class="field">
        <label>${t("dna.label.tagline")}</label>
        <input class="input" id="ans-tagline" placeholder="${escapeHtml(t("dna.identity.taglinePh"))}" value="${escapeHtml(state.answers.tagline)}" />
      </div>
      ${personalityFieldHTML(state)}
      ${nav}
    `;
  }
  if (step.fields) {
    return `
      <h2 style="margin-bottom:6px;">${step.title}</h2>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${step.guide}</p>
      ${step.fields
        .map((f) => `
          ${promptsHTML(f.prompts)}
          ${narrativeFieldHTML({ field: f.field, label: f.label, example: f.example, value: state.answers[f.field] })}
        `)
        .join("")}
      ${nav}
    `;
  }
  return `
    <h2 style="margin-bottom:6px;">${step.title}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 10px;">${step.guide}</p>
    ${promptsHTML(step.prompts)}
    ${narrativeFieldHTML({ field: step.field, example: step.example, value: state.answers[step.field] })}
    ${nav}
  `;
}

// The brand character picker, moved here from Brand Builder's own
// Personality stage: pick one feeling, get the e-book's recommended traits
// for it (deterministic lookup, no AI), edit them if you want. Saved to
// brand.brandBuilder.personality by persistDna, exactly where the
// Guidelines consistency check, the Brand Book and the AI already read it.
function personalityFieldHTML(state) {
  const p = state.personality;
  return `
    <div class="field">
      <label>${t("dna.sb7.identity.personality")}</label>
      <p class="text-faint" style="font-size:11.5px;margin:0 0 8px;">${t("dna.sb7.identity.personalityHint")}</p>
      <div class="bb-chip-row">
        ${COLOR_FEELINGS.map((f) => `<label class="checkbox-chip"><input type="radio" name="dna-feeling" data-feeling value="${escapeHtml(f)}" ${p.feeling === f ? "checked" : ""} />${escapeHtml(feelingLabel(f))}</label>`).join("")}
      </div>
      ${
        p.feeling
          ? `<details class="dna-traits">
               <summary>${escapeHtml(t("dna.sb7.identity.traits", { feeling: feelingLabel(p.feeling) }))}</summary>
               ${traitListHTML("primary", t("dna.sb7.identity.traitsPrimary"), p.primary)}
               ${traitListHTML("secondary", t("dna.sb7.identity.traitsSecondary"), p.secondary)}
               ${traitListHTML("avoid", t("dna.sb7.identity.traitsAvoid"), p.avoid)}
               <button type="button" class="btn btn-ghost btn-sm" id="dna-traits-reset">${icon("refresh", { size: 12 })}${t("dna.sb7.identity.traitsReset")}</button>
             </details>`
          : ""
      }
    </div>
  `;
}

function traitListHTML(key, label, items) {
  return `
    <div class="field" style="margin-bottom:12px;">
      <label style="font-size:11.5px;">${label}</label>
      <div class="chip-list" id="dna-trait-${key}-list">
        ${items.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-trait-remove="${key}" data-index="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 10 })}</button></span>`).join("")}
      </div>
      <div class="flex gap-8" style="margin-top:6px;">
        <input class="input" id="dna-trait-${key}-new" placeholder="${escapeHtml(t("dna.sb7.identity.traitAddPh"))}" style="flex:1;" />
        <button type="button" class="btn btn-secondary btn-sm" data-trait-add="${key}" aria-label="${t("dna.field.add")}">${icon("plus", { size: 12 })}</button>
      </div>
    </div>
  `;
}

// Reusable "type, click +, removable pill" list input — personality/
// values/products in the identity step, same visual pill language as the
// checkbox-chip pattern used elsewhere, just for a free-typed growable
// list instead of a fixed set of toggleable options.
function chipListHTML(id, label, items, placeholder) {
  return `
    <div class="field">
      <label>${label}</label>
      <div class="flex gap-8" style="margin-bottom:8px;">
        <input class="input" id="${id}-new" placeholder="${escapeHtml(placeholder || t("dna.field.chipPh"))}" style="flex:1;" />
        <button type="button" class="btn btn-secondary" data-chip-add="${id}" style="flex:none;" aria-label="${t("dna.field.add")}">${icon("plus", { size: 14 })}</button>
      </div>
      <div class="chip-list" id="${id}-list">
        ${items.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-chip-remove="${id}" data-index="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 10 })}</button></span>`).join("")}
      </div>
    </div>
  `;
}

function promptsHTML(prompts) {
  if (!prompts?.length) return "";
  return `<ul class="text-faint" style="font-size:12px;margin:0 0 10px;padding-left:18px;line-height:1.6;">${prompts.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`;
}

function navHTML(state, nextDisabled) {
  return `
    <div class="flex items-center justify-between" style="margin-top:8px;gap:12px;">
      <button type="button" class="btn btn-secondary" id="wiz-back" ${state.stepIndex === 0 ? "disabled" : ""}>${icon("chevronLeft", { size: 14 })}${t("common.back")}</button>
      <div class="flex items-center gap-8">
        <div style="text-align:right;">
          <button type="button" class="btn btn-ghost btn-sm" id="wiz-save-checkpoint">${icon("check", { size: 13 })}${t("dna.nav.saveProgress")}</button>
          <div id="wiz-save-status" class="text-faint" style="font-size:11px;margin-top:4px;"></div>
        </div>
        <div style="text-align:right;">
          <button type="button" class="btn btn-primary" id="wiz-next" ${nextDisabled ? "disabled" : ""}>${t("dna.nav.next")}${icon("chevronRight", { size: 14 })}</button>
          <div id="wiz-next-hint" class="text-faint" style="font-size:11px;margin-top:6px;${nextDisabled ? "" : "display:none;"}">${t("dna.nav.fillFirst")}</div>
        </div>
      </div>
    </div>
  `;
}

// Renders one round of AI options as pickable cards (same visual pattern
// as the Creator page's "Hook options" — a card per option with a small
// "Pakai" button), plus a "Coba opsi lain" action to fetch a fresh batch
// that avoids repeating what's already been shown.
function optionCardsHTML(options) {
  return `
    ${options
      .map(
        (opt, i) => `
      <div class="card card-tight" style="margin-top:8px;display:flex;justify-content:space-between;gap:10px;align-items:center;">
        <span style="font-size:13px;">${escapeHtml(opt)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-use-option="${i}" style="flex:none;">${t("dna.ai.useOption")}</button>
      </div>`
      )
      .join("")}
    <button type="button" class="btn btn-secondary btn-block" data-more-options="1" style="margin-top:8px;">${icon("bot", { size: 14 })}${t("dna.ai.moreOptions")}</button>
  `;
}

// Asks AI to sharpen the user's OWN draft into a few distinct phrasing
// options — never invents an answer from an empty field, and never
// silently overwrites the textarea. The user picks whichever option is
// actually good; "Coba opsi lain" fetches a fresh batch instead of
// repeating the same ones. Works on any element with a `.value` — used for
// the full-size textareas and the small per-box inputs alike.
async function runSuggestOptions({ brand, question, guide, principle, textarea, statusEl, optionsEl, btn, priorAnswers, count, maxWords, voice }) {
  const draft = textarea.value.trim();
  const ai = getSettings().ai || {};
  const hasKey = hasAiKey(ai);
  if (!hasKey) {
    statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("dna.ai.noKey")}</div>`;
    return;
  }
  const shownBefore = [...optionsEl.querySelectorAll("[data-option-text]")].map((el) => el.dataset.optionText);
  btn.disabled = true;
  statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("dna.ai.loadingOptions")}</span></div>`;
  try {
    const options = await suggestBrandDnaOptions(ai, { brand, question, guide, principle, draftAnswer: draft, priorAnswers, avoid: shownBefore, count: count || 3, maxWords, voice });
    statusEl.innerHTML = "";
    optionsEl.innerHTML = optionCardsHTML(options);
    const feedbackCtx = { brandId: brand?.id, feature: "brand-dna-options", prompt: { question, draftAnswer: draft, voice, maxWords } };
    mountAiFeedback(optionsEl, { ...feedbackCtx, output: options });
    optionsEl.querySelectorAll("[data-use-option]").forEach((cardBtn, i) => {
      // Stash the raw text on the card itself so a later "Coba opsi lain"
      // click can tell the AI not to repeat it — attribute, not a closure
      // variable, since this whole block gets re-rendered from scratch.
      cardBtn.closest(".card").dataset.optionText = options[i];
      cardBtn.addEventListener("click", () => {
        textarea.value = options[i];
        textarea.dispatchEvent(new Event("input"));
        // Once one's picked, the sibling options are moot — close the whole
        // bubble instead of leaving 2 unchosen cards sitting there. The
        // rating strip stays (with which option won) until it's used.
        optionsEl.innerHTML = "";
        mountAiFeedback(optionsEl, { ...feedbackCtx, output: { options, picked: options[i] } });
      });
    });
    qs("[data-more-options]", optionsEl)?.addEventListener("click", () =>
      runSuggestOptions({ brand, question, guide, principle, textarea, statusEl, optionsEl, btn, priorAnswers, count, maxWords, voice })
    );
  } catch (e) {
    statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? escapeHtml(e.message) : t("dna.ai.errorShort")}</span></div>`;
  } finally {
    btn.disabled = false;
  }
}

function wireStep(root, brandId, brand, state, refresh) {
  const step = STEPS[state.stepIndex];

  const nextBtn = qs("#wiz-next", root);
  const nextHint = qs("#wiz-next-hint", root);
  function updateNextState() {
    const filled = liveStepFilled(step, root, state);
    nextBtn.disabled = !filled;
    nextHint.style.display = filled ? "none" : "";
  }

  if (step.kind === "compose" || step.kind === "funnel3") {
    wireComposeOrFunnelStep(root, brandId, brand, state, step, refresh, updateNextState);
  } else if (step.key === "identity") {
    wireIdentityStep(root, brandId, state, refresh, updateNextState);
  } else {
    const fieldIds = (step.fields || [step]).map((f) => `#ans-${f.field}`);
    fieldIds.forEach((sel) => qs(sel, root)?.addEventListener("input", updateNextState));
    qsa("[data-polish]", root).forEach((btn) => {
      const field = btn.dataset.polish;
      const fieldDef = step.fields ? step.fields.find((f) => f.field === field) : step;
      const textarea = qs(`#ans-${field}`, root);
      const statusEl = qs(`#polish-status-${field}`, root);
      const optionsEl = qs(`#polish-options-${field}`, root);
      btn.addEventListener("click", () =>
        runSuggestOptions({
          brand, question: fieldDef.label || step.title, guide: step.guide,
          principle: fieldDef.principle, voice: fieldDef.voice || step.voice,
          textarea, statusEl, optionsEl, btn,
          priorAnswers: stepAnswerSummaries(state, state.stepIndex),
          maxWords: fieldDef.maxWords,
        })
      );
    });
  }

  // 3.2: Next and "Simpan progress" commit a "compose" step even when the
  // combined textarea itself is still empty — compose it from whatever
  // boxes are filled first (same logic the "Gabungkan" button runs), so
  // the saved answer isn't blank just because that one extra click never
  // happened.
  const ensureComposed = () => {
    if (step.kind === "compose" && !qs(`#ans-${step.field}`, root)?.value.trim()) {
      composeAnswerFromParts(root, state, step);
    }
  };

  qs("#wiz-back", root)?.addEventListener("click", () => {
    captureStep(root, step, state);
    state.stepIndex = Math.max(0, state.stepIndex - 1);
    refresh();
  });
  // Next used to only buffer the step in local state, saving nothing until
  // the user reached Review and hit Save — same tab-close data loss risk
  // the "Simpan progress" button above was already added to solve, just
  // still possible on the single most common action in the wizard. Next
  // now commits the same way that button (and Guidelines' own commit
  // wrapper) already does, so every step is a real checkpoint, not just a
  // manual one.
  nextBtn?.addEventListener("click", () => {
    if (nextBtn.disabled) return;
    ensureComposed();
    captureStep(root, step, state);
    persistDna(brandId, state);
    state.stepIndex += 1;
    refresh();
  });
  qs("#wiz-skip-identity", root)?.addEventListener("click", () => {
    captureStep(root, step, state);
    persistDna(brandId, state);
    state.stepIndex += 1;
    refresh();
  });

  // Locks in everything answered so far, right now — not just at the end.
  // Closing the tab or navigating away mid-wizard used to lose progress
  // past whatever was already on the Review screen; this writes the same
  // brandDNA patch the final Save does, just earlier and as many times as
  // the user wants, so a step is genuinely a checkpoint, not a scratchpad.
  qs("#wiz-save-checkpoint", root)?.addEventListener("click", () => {
    ensureComposed();
    captureStep(root, step, state);
    persistDna(brandId, state);
    const statusEl = qs("#wiz-save-status", root);
    if (statusEl) {
      statusEl.textContent = t("dna.nav.saved");
      setTimeout(() => { if (statusEl.isConnected) statusEl.textContent = ""; }, 2500);
    }
    toast(t("dna.nav.savedToast"));
  });
}

function currentPartValues(root, step) {
  const parts = {};
  stepParts(step).forEach((p) => {
    if (p.type === "list") {
      parts[p.key] = qsa(`#part-proof-list .dna-chip`, root).map((el) => el.firstChild.textContent);
    } else {
      parts[p.key] = qs(`#part-${p.key}`, root)?.value.trim() || "";
    }
  });
  return parts;
}

// Shared by the "Gabungkan" button and — since 3.2 — Next/"Simpan progress"
// on a "compose" step: stitches the short box answers into the combined
// textarea. Returns the composed string, or "" if every box was empty (the
// caller decides what that means: the button shows dna.compose.empty,
// Next/Simpan progress just leave the field blank and let the usual
// "required" validation handle it).
function composeAnswerFromParts(root, state, step) {
  const parts = currentPartValues(root, step);
  state.parts[step.key] = { ...(state.parts[step.key] || {}), ...parts };
  const answerField = qs(`#ans-${step.field}`, root);
  const answerWrap = answerField?.closest("[data-collapsed-field]") || answerField?.closest(".field");
  const partList = stepParts(step).map((p) => (p.type === "list" ? (parts[p.key] || []).join("; ") : parts[p.key]));
  // Prefer the step's own sentence template (a real description with
  // cause → effect) over gluing fragments together with periods.
  const composed = (step.compose ? step.compose(parts).trim() : "") || joinParts(partList);
  if (!composed) return "";
  if (answerField) answerField.value = composed;
  if (answerWrap) answerWrap.style.display = "";
  state.answers[step.field] = composed;
  if (step.syncField) state.answers[step.syncField] = composed;
  return composed;
}

function wireComposeOrFunnelStep(root, brandId, brand, state, step, refresh, updateNextState) {
  // Every plain-text part input keeps the wizard's local scratch state in
  // sync as the user types, so switching Back/Next doesn't lose progress.
  stepParts(step).forEach((p) => {
    if (p.type === "list") return;
    qs(`#part-${p.key}`, root)?.addEventListener("input", () => {
      state.parts[step.key] = { ...(state.parts[step.key] || {}), [p.key]: qs(`#part-${p.key}`, root).value };
    });
  });

  // Per-box "Pakai AI buat mikirin ini" — reuses the exact same
  // options-picker as the full narrative fields, just aimed at a small
  // <input> instead of a <textarea> (both share the same .value API).
  qsa("[data-polish-part]", root).forEach((btn) => {
    const key = btn.dataset.polishPart;
    const part = stepParts(step).find((p) => p.key === key);
    const partIndex = stepParts(step).findIndex((p) => p.key === key);
    const input = qs(`#part-${key}`, root);
    const statusEl = qs(`#polish-status-part-${key}`, root);
    const optionsEl = qs(`#polish-options-part-${key}`, root);
    btn.addEventListener("click", () => {
      // funnel3 boxes (the 3-step Plan) aren't independent questions — each
      // one only makes sense chained to its siblings, so the AI needs to
      // see what the OTHER boxes already say, not just this one in
      // isolation, or it has no way to keep the sequence coherent (e.g.
      // picking a step 2 that logically follows step 1).
      const siblingContext =
        step.kind === "funnel3"
          ? stepParts(step)
              .filter((p) => p.key !== key)
              .map((p) => {
                const v = qs(`#part-${p.key}`, root)?.value.trim();
                return v ? `${p.label} (sudah diisi): ${v}` : "";
              })
              .filter(Boolean)
          : [];
      runSuggestOptions({
        brand,
        question: step.kind === "funnel3" ? `${part.label} — langkah ke-${partIndex + 1} dari 3 dalam satu rencana kerja sama yang berurutan (bukan pertanyaan berdiri sendiri)` : part.label,
        guide: step.guide, principle: step.principle, voice: step.voice,
        textarea: input, statusEl, optionsEl, btn,
        priorAnswers: [...stepAnswerSummaries(state, state.stepIndex), ...siblingContext],
        count: 2,
      });
    });
  });

  // Testimoni/proof add-list — its own tiny add/remove wiring, kept in
  // state.parts.trust.proof as a plain string array.
  const proofAdd = qs("#part-proof-add", root);
  if (proofAdd) {
    const addProof = () => {
      const input = qs("#part-proof-new", root);
      const val = input.value.trim();
      if (!val) return;
      const current = state.parts[step.key] || {};
      const list = [...(current.proof || []), val];
      state.parts[step.key] = { ...current, proof: list };
      qs("#part-proof-list", root).innerHTML = list
        .map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-proof-remove="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 10 })}</button></span>`)
        .join("");
      wireProofRemove(root, state, step);
      input.value = "";
    };
    proofAdd.addEventListener("click", addProof);
    qs("#part-proof-new", root).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addProof(); } });
    wireProofRemove(root, state, step);
  }

  if (step.kind === "funnel3") {
    // No AI compose call needed — it's just numbering the 3 boxes together,
    // recomputed live so Next enables the instant all three are filled.
    stepParts(step).forEach((p) => {
      qs(`#part-${p.key}`, root)?.addEventListener("input", () => {
        const parts = currentPartValues(root, step);
        state.answers[step.field] = parts.step1 || parts.step2 || parts.step3
          ? [parts.step1 && `1) ${parts.step1}`, parts.step2 && `2) ${parts.step2}`, parts.step3 && `3) ${parts.step3}`].filter(Boolean).join(" ")
          : "";
        updateNextState();
      });
    });
    return;
  }

  // "compose" kind — the visible saved answer is the collapsed
  // narrativeFieldHTML below the boxes; typing in it directly still keeps
  // Next in sync, same as every other step.
  qs(`#ans-${step.field}`, root)?.addEventListener("input", updateNextState);
  qsa("[data-polish]", root).forEach((btn) => {
    const field = btn.dataset.polish;
    const textarea = qs(`#ans-${field}`, root);
    const statusEl = qs(`#polish-status-${field}`, root);
    const optionsEl = qs(`#polish-options-${field}`, root);
    btn.addEventListener("click", () =>
      runSuggestOptions({
        brand, question: step.title, guide: step.guide, principle: step.principle, voice: step.voice,
        textarea, statusEl, optionsEl, btn,
        priorAnswers: stepAnswerSummaries(state, state.stepIndex),
      })
    );
  });

  // Plain, instant, no AI/key needed — just stitches the short answers
  // into one paragraph in code. It doesn't have to sound polished; it just
  // has to save someone from staring at a blank textarea. The usual
  // "Minta opsi dari AI" button right below still offers AI-sharpened
  // phrasing afterward, same as every other field, for whoever wants it.
  qs("#compose-answer", root)?.addEventListener("click", () => {
    const composed = composeAnswerFromParts(root, state, step);
    const statusEl = qs("#compose-status", root);
    if (!composed) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("dna.compose.empty")}</div>`;
      return;
    }
    statusEl.innerHTML = "";
    updateNextState();
  });
}

// Stitches short fragment answers into one readable paragraph — plain
// string work, no AI call, so this never depends on a key being set or a
// network request succeeding. Each fragment becomes its own short
// sentence; the result reads a bit choppy on purpose (better than
// inventing connective wording that isn't theirs) and is immediately
// editable right below where it appears.
function joinParts(values) {
  return values
    .filter(Boolean)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (/[.!?]$/.test(v) ? v : v + "."))
    .map((v) => v.charAt(0).toUpperCase() + v.slice(1))
    .join(" ");
}

function wireProofRemove(root, state, step) {
  qsa("[data-proof-remove]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.proofRemove);
      const current = state.parts[step.key] || {};
      const list = (current.proof || []).filter((_, i) => i !== idx);
      state.parts[step.key] = { ...current, proof: list };
      btn.closest(".dna-chip").remove();
    });
  });
}

function captureIdentityInputs(root, state) {
  const nameEl = qs("#ans-brandName", root);
  if (nameEl) state.brandName = nameEl.value.trim();
  const taglineEl = qs("#ans-tagline", root);
  if (taglineEl) state.answers.tagline = taglineEl.value.trim();
  // Older parts of the app (Brand Book fallback, AI context) read the flat
  // brandDNA.personality list — keep it mirroring the chosen traits.
  if (state.personality?.primary?.length) state.answers.personality = [...state.personality.primary];
}

function applyPersonalityProfile(state) {
  const profile = personalityProfile(state.personality.feeling);
  state.personality.primary = [...profile.primary];
  state.personality.secondary = [...profile.secondary];
  state.personality.avoid = [...profile.avoid];
}

function wireIdentityStep(root, brandId, state, refresh, updateNextState) {
  qs("#ans-tagline", root)?.addEventListener("input", updateNextState);
  qs("#ans-brandName", root)?.addEventListener("input", updateNextState);

  qsa("[data-feeling]", root).forEach((el) =>
    el.addEventListener("change", () => {
      captureIdentityInputs(root, state);
      state.personality.feeling = el.value;
      applyPersonalityProfile(state);
      refresh();
    })
  );
  qs("#dna-traits-reset", root)?.addEventListener("click", () => {
    captureIdentityInputs(root, state);
    applyPersonalityProfile(state);
    refresh();
  });
  ["primary", "secondary", "avoid"].forEach((key) => {
    const addTrait = () => {
      const input = qs(`#dna-trait-${key}-new`, root);
      const v = input?.value.trim();
      if (!v) return;
      captureIdentityInputs(root, state);
      state.personality[key] = [...state.personality[key], v];
      refresh();
    };
    qs(`[data-trait-add="${key}"]`, root)?.addEventListener("click", addTrait);
    qs(`#dna-trait-${key}-new`, root)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addTrait(); }
    });
    qsa(`[data-trait-remove="${key}"]`, root).forEach((btn) =>
      btn.addEventListener("click", () => {
        captureIdentityInputs(root, state);
        state.personality[key] = state.personality[key].filter((_, i) => i !== Number(btn.dataset.index));
        refresh();
      })
    );
  });

  // The full AI name finder is still its own screen — save what's on this
  // one before leaving, so nothing typed here is lost.
  qs("#dna-name-tool", root)?.addEventListener("click", () => {
    captureIdentityInputs(root, state);
    persistDna(brandId, state);
  });
}

const CHIP_FIELD_BY_ID = { personality: "personality", values: "values", products: "productsServices" };
function addChip(root, state, id) {
  const input = qs(`#${id}-new`, root);
  const val = input.value.trim();
  if (!val) return;
  const field = CHIP_FIELD_BY_ID[id];
  state.answers[field] = [...state.answers[field], val];
  qs(`#${id}-list`, root).innerHTML = state.answers[field]
    .map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-chip-remove="${id}" data-index="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 10 })}</button></span>`)
    .join("");
  wireChipRemove(root, state);
  input.value = "";
  input.focus();
}
function wireChipRemove(root, state) {
  qsa("[data-chip-remove]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.chipRemove;
      const field = CHIP_FIELD_BY_ID[id];
      const idx = Number(btn.dataset.index);
      state.answers[field] = state.answers[field].filter((_, i) => i !== idx);
      btn.closest(".dna-chip").remove();
      qsa(`[data-chip-remove="${id}"]`, root).forEach((b, i) => { b.dataset.index = i; });
    });
  });
}

function captureStep(root, step, state) {
  if (step.key === "identity") {
    captureIdentityInputs(root, state);
    return;
  }
  if (step.kind === "compose") {
    state.parts[step.key] = { ...(state.parts[step.key] || {}), ...currentPartValues(root, step) };
    state.answers[step.field] = qs(`#ans-${step.field}`, root).value.trim();
    if (step.syncField) state.answers[step.syncField] = state.answers[step.field];
    return;
  }
  if (step.kind === "funnel3") {
    state.parts[step.key] = { ...(state.parts[step.key] || {}), ...currentPartValues(root, step) };
    return;
  }
  if (step.fields) {
    step.fields.forEach((f) => { state.answers[f.field] = qs(`#ans-${f.field}`, root).value.trim(); });
    return;
  }
  state.answers[step.field] = qs(`#ans-${step.field}`, root).value.trim();
}

// Review is where an AI draft gets corrected, so every field is a live
// textarea (not read-only text + "click Back to the right step"). Lists
// (personality/values/products) edit as comma-separated text.
function reviewSection(label, value, field, { list = false, hint = "" } = {}) {
  const text = list ? (value || []).join(", ") : value || "";
  return `
    <div class="review-field">
      <label>${label}</label>
      <textarea class="textarea review-textarea" ${list ? `data-review-list="${field}"` : `data-review-field="${field}"`} rows="${text.length > 90 ? 3 : 2}" placeholder="${escapeHtml(hint || t("dna.review.empty"))}">${escapeHtml(text)}</textarea>
    </div>`;
}

function captureReview(root, state) {
  qsa("[data-review-field]", root).forEach((el) => { state.answers[el.dataset.reviewField] = el.value.trim(); });
  qsa("[data-review-list]", root).forEach((el) => { state.answers[el.dataset.reviewList] = el.value.split(",").map((v) => v.trim()).filter(Boolean); });
  state.answers.positioning = state.answers.positioning || state.answers.differentiation;
  state.parts.plan = { ...decomposeFunnel3Plan(state.answers.mission), ...(state.parts.plan || {}) };
}

// The Review step's headline card — a StoryBrand-style one-liner built
// from everything already answered, generated on demand rather than asked
// as its own separate step. Same low-pressure spirit as the rest of this
// wizard: one button, editable result, "Coba lagi" once it exists.
function oneLinerCardHTML(state) {
  const hasEnough = state.answers.targetAudience || state.answers.problemSolved;
  return `
    <div class="card" style="margin-bottom:20px;border-color:var(--accent);">
      <div class="flex items-center justify-between" style="margin-bottom:4px;">
        <h3 style="margin:0;font-size:15px;">${t("dna.oneLiner.title")}</h3>
        <button type="button" class="btn btn-secondary" id="gen-oneliner" ${hasEnough ? "" : "disabled"}>
          ${icon("bot", { size: 14 })}${state.answers.oneLiner ? t("dna.oneLiner.retry") : t("dna.oneLiner.generate")}
        </button>
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:0 0 10px;">${t("dna.oneLiner.desc")}</p>
      <textarea class="textarea" id="ans-oneLiner" style="min-height:60px;font-weight:600;" placeholder="${escapeHtml(hasEnough ? t("dna.oneLiner.phReady") : t("dna.oneLiner.phNotReady"))}">${escapeHtml(state.answers.oneLiner)}</textarea>
      <div id="oneliner-status" style="margin-top:8px;"></div>
    </div>
  `;
}

function reviewHTML(state) {
  const a = state.answers;
  // Revisi: once every question is actually answered, Review offers the
  // way out it never had — "Balik ke Beranda" saves first, so it's a
  // finish button, not an abandon button. Only appears at 100%, so it
  // never reads as permission to leave half-answered.
  const { filled, total } = brandDnaCompleteness(a);
  const homeReady = total > 0 && filled >= total;
  return `
    <h2 style="margin-bottom:6px;">${t("dna.review.title")}</h2>
    <p class="text-muted" style="font-size:13px;margin:${state.autoDrafted ? "0 0 6px" : "0 0 20px"};">${state.autoDrafted ? t("dna.review.subAuto") : t("dna.review.sub")}</p>
    ${state.autoDrafted ? `<a href="#" id="dna-answer-manually" class="hint" style="display:inline-block;font-size:12.5px;margin:0 0 14px;">${t("dna.review.answerManually")}</a>` : ""}
    ${oneLinerCardHTML(state)}
    <div class="card card-tight review-card" style="margin-bottom:20px;">
      ${reviewSection(t("dna.review.customer"), a.targetAudience, "targetAudience", { hint: t("dna.review.customerHint") })}
      ${reviewSection(t("dna.review.problem"), a.problemSolved, "problemSolved", { hint: t("dna.review.problemHint") })}
      ${reviewSection(t("dna.review.trust"), a.differentiation, "differentiation", { hint: t("dna.review.trustHint") })}
      ${reviewSection(t("dna.review.plan"), a.mission, "mission", { hint: "1) ... 2) ... 3) ..." })}
      ${reviewSection(t("dna.review.cta"), a.callToAction, "callToAction", { hint: t("dna.review.ctaHint") })}
      ${reviewSection(t("dna.review.success"), a.successOutcome, "successOutcome")}
      ${reviewSection(t("dna.review.failure"), a.failureOutcome, "failureOutcome")}
      ${reviewSection(t("dna.label.tagline"), a.tagline, "tagline", { hint: t("dna.review.taglineHint") })}
    </div>
    <details class="dna-extras" style="margin-bottom:20px;">
      <summary>${t("dna.review.extras")}</summary>
      <p class="text-faint" style="font-size:11.5px;margin:6px 0 10px;">${t("dna.review.extrasHint")}</p>
      ${reviewSection(t("dna.label.purpose"), a.purpose, "purpose", { hint: t("dna.review.purposeHint") })}
      ${reviewSection(t("dna.label.vision"), a.vision, "vision", { hint: t("dna.review.visionHint") })}
      ${reviewSection(t("dna.review.personality"), a.personality, "personality", { list: true, hint: t("dna.review.personalityHint") })}
      ${reviewSection(t("dna.label.values"), a.values, "values", { list: true, hint: t("dna.identity.valuesPh") })}
      ${reviewSection(t("dna.label.products"), a.productsServices, "productsServices", { list: true, hint: t("dna.review.productsHint") })}
    </details>
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-8">
        <button type="button" class="btn btn-secondary" id="wiz-back">${icon("chevronLeft", { size: 14 })}${t("common.back")}</button>
        <button type="button" class="btn btn-ghost btn-sm" id="dna-reset">${icon("refresh", { size: 13 })}${t("dna.reset.btn")}</button>
      </div>
      <div class="flex gap-8">
        <button type="button" class="btn btn-secondary" id="wiz-pdf">${icon("download", { size: 14 })}${t("dna.review.downloadPdf")}</button>
        ${homeReady ? `<button type="button" class="btn btn-secondary" id="wiz-home">${icon("check", { size: 14 })}${t("guidelines.backHome")}</button>` : ""}
        <button type="button" class="btn btn-primary" id="wiz-save">${icon("check", { size: 15 })}${t("dna.review.save")}</button>
      </div>
    </div>
  `;
}

function wireReview(root, brandId, brand, state, refresh) {
  // Saves exactly like #wiz-save does, then always lands on Beranda —
  // where the journey card it just ticked actually lives.
  qs("#wiz-home", root)?.addEventListener("click", () => {
    captureReview(root, state);
    state.answers.oneLiner = qs("#ans-oneLiner", root)?.value.trim() || state.answers.oneLiner;
    persistDna(brandId, state);
    toast(t("dna.review.savedToast"));
    const { filled, total } = brandDnaCompleteness(state.answers);
    if (total && filled >= total) markDnaJustCompleted(brandId);
    location.hash = `#/brand/${brandId}`;
  });
  qs("#dna-answer-manually", root)?.addEventListener("click", (e) => {
    e.preventDefault();
    captureReview(root, state);
    state.stepIndex = 0;
    refresh();
  });
  qs("#wiz-back", root).addEventListener("click", () => {
    captureReview(root, state);
    state.stepIndex = STEPS.length - 1;
    refresh();
  });
  qs("#wiz-save", root).addEventListener("click", () => {
    captureReview(root, state);
    state.answers.oneLiner = qs("#ans-oneLiner", root)?.value.trim() || state.answers.oneLiner;
    persistDna(brandId, state);
    toast(t("dna.review.savedToast"));
    // Send them back to the place that actually shows what they just moved
    // — staying on the Review screen after Save left no visible
    // confirmation that anything changed. The completion flag is only set
    // on a real 100%, so the celebration only plays when this save is what
    // pushed it there, not on every save. Pemula (3.3): straight back to
    // Beranda, the map every step returns to — beginner-home.js reads the
    // same flag for its own toast. Pro: unchanged, back to the hub.
    const { filled, total } = brandDnaCompleteness(state.answers);
    if (total && filled >= total) markDnaJustCompleted(brandId);
    location.hash = getMode() === "guided" ? `#/brand/${brandId}` : `#/brand/${brandId}/builder`;
  });
  // Reset lived on the Brand Builder group page, which is gone now that
  // Brand DNA is one flow — it belongs with the answers it clears.
  qs("#dna-reset", root)?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("dna.reset.title"),
      message: t("dna.reset.message"),
      confirmLabel: t("dna.reset.confirm"),
      danger: true,
    });
    if (!ok) return;
    const fresh = getBrand(brandId);
    const bb = fresh?.brandBuilder || {};
    updateBrand(brandId, {
      brandDNA: defaultBrandDNA(),
      brandBuilder: {
        ...bb,
        personality: defaultPersonality(),
        completedStages: (bb.completedStages || []).filter((x) => x !== "personality"),
      },
    });
    toast(t("dna.reset.done"));
    location.hash = `#/brand/${brandId}/builder`;
  });
  qs("#wiz-pdf", root).addEventListener("click", () => {
    captureReview(root, state);
    state.answers.oneLiner = qs("#ans-oneLiner", root)?.value.trim() || state.answers.oneLiner;
    openBrandDnaPdf(brand, state.answers);
  });

  const oneLinerBtn = qs("#gen-oneliner", root);
  if (oneLinerBtn) {
    oneLinerBtn.addEventListener("click", async () => {
      const ai = getSettings().ai || {};
      const statusEl = qs("#oneliner-status", root);
      const hasKey = hasAiKey(ai);
      if (!hasKey) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("dna.ai.noKey")}</div>`;
        return;
      }
      oneLinerBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("dna.oneLiner.loading")}</span></div>`;
      try {
        const line = await generateOneLiner(ai, { brand, answers: state.answers });
        state.answers.oneLiner = line;
        qs("#ans-oneLiner", root).value = line;
        oneLinerBtn.innerHTML = `${icon("bot", { size: 14 })}${t("dna.oneLiner.retry")}`;
        statusEl.innerHTML = "";
      } catch (e) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? escapeHtml(e.message) : t("dna.ai.errorShort")}</span></div>`;
      } finally {
        oneLinerBtn.disabled = false;
      }
    });
  }
}

// A short row inside one PDF narrative section — only rendered when it has
// something to say, so an unanswered field just doesn't take up space
// rather than showing an empty label.
function dnaRowHTML(label, value) {
  if (!value) return "";
  return `<div class="dna-row"><div class="dna-row-label">${escapeHtml(label)}</div><p class="dna-row-text">${escapeHtml(value)}</p></div>`;
}

// One narrative "beat" of the PDF — a labeled group of 1-2 related answers
// (e.g. audience + problem together as "who they're for"), matching how the
// wizard's own steps read as a story instead of a flat Q&A transcript. The
// whole section disappears if every row inside it is empty.
function dnaSectionHTML(eyebrow, rows) {
  const html = rows.map(([label, value]) => dnaRowHTML(label, value)).join("");
  if (!html) return "";
  return `<div class="dna-section"><div class="brandbook-page-eyebrow">${escapeHtml(eyebrow)}</div>${html}</div>`;
}

function dnaStakesHTML(success, failure) {
  if (!success && !failure) return "";
  return `
    <div class="dna-section">
      <div class="brandbook-page-eyebrow">${escapeHtml(t("dna.pdf.stakes"))}</div>
      <div class="dna-stakes-grid">
        <div class="dna-stakes-col dna-stakes-win">
          <div class="dna-row-label">${escapeHtml(t("dna.review.success"))}</div>
          <p class="dna-row-text">${escapeHtml(success || "—")}</p>
        </div>
        <div class="dna-stakes-col dna-stakes-risk">
          <div class="dna-row-label">${escapeHtml(t("dna.review.failure"))}</div>
          <p class="dna-row-text">${escapeHtml(failure || "—")}</p>
        </div>
      </div>
    </div>
  `;
}

function openBrandDnaPdf(brand, answers) {
  const listRows = [
    [t("dna.review.personality"), answers.personality],
    [t("dna.label.values"), answers.values],
    [t("dna.label.products"), answers.productsServices],
  ].filter(([, v]) => v.length);

  const overlay = openModal({
    title: t("dna.pdf.title"),
    wide: true,
    bodyHTML: `
      <div class="report-preview-wrap"><div class="report-sheet dna-sheet" id="dna-report-sheet">
        <img class="brandbook-wpk-mark" src="assets/wepeka-logo.png" alt="" />
        <div class="dna-cover">
          <div class="brandbook-page-eyebrow">Brand DNA</div>
          <div class="brandbook-cover-name">${escapeHtml(brand.name)}</div>
          ${answers.oneLiner ? `<p class="dna-oneliner">&ldquo;${escapeHtml(answers.oneLiner)}&rdquo;</p>` : ""}
          ${answers.tagline ? `<p class="brandbook-cover-tagline">${escapeHtml(answers.tagline)}</p>` : ""}
        </div>
        ${dnaSectionHTML(t("dna.pdf.customerSection"), [[t("dna.review.customer"), answers.targetAudience], [t("dna.review.problem"), answers.problemSolved]])}
        ${dnaSectionHTML(t("dna.pdf.trustSection"), [[t("dna.review.trust"), answers.differentiation]])}
        ${dnaSectionHTML(t("dna.pdf.planSection"), [[t("dna.pdf.plan"), answers.mission], [t("dna.review.cta"), answers.callToAction]])}
        ${dnaStakesHTML(answers.successOutcome, answers.failureOutcome)}
        ${dnaSectionHTML(t("dna.pdf.whySection"), [[t("dna.label.purpose"), answers.purpose], [t("dna.label.vision"), answers.vision]])}
        ${listRows.length ? `<div class="dna-section"><div class="brandbook-page-eyebrow">${escapeHtml(t("dna.pdf.details"))}</div>${listRows.map(([label, list]) => dnaRowHTML(label, list.join(" · "))).join("")}</div>` : ""}
        <div class="report-footer">Wepeka Brandlab — ${escapeHtml(brand.name)}</div>
      </div></div>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="dna-pdf-close">${t("common.close")}</button>
      <button class="btn btn-primary" id="dna-pdf-download">${icon("download", { size: 14 })}${t("dna.review.downloadPdf")}</button>
    `,
  });
  qs("#dna-pdf-close", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("#dna-pdf-download", overlay).addEventListener("click", () => {
    toast(t("dna.pdf.printHint"));
    setTimeout(() => window.print(), 400);
  });
}
