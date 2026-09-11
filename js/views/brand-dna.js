import { getBrand, updateBrand, getSettings } from "../store.js";
import { linesToList, listToLines, toast, qs, qsa, escapeHtml } from "../dom.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { suggestBrandDnaOptions, generateOneLiner, AiApiError, hasAiKey } from "../ai.js";

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
const AGE_RANGES = ["0-2 (balita)", "3-5 (anak kecil)", "6-12 (anak-anak)", "13-17 (remaja)", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

const STEPS = [
  {
    key: "audience",
    field: "targetAudience",
    kind: "compose",
    title: "Siapa pelanggan kamu?",
    guide: "Bayangin pelanggan kamu itu tokoh utama di cerita ini, bukan brand kamu. Jawab satu-satu, nanti digabung jadi satu cerita.",
    parts: [
      { key: "age", label: "Usia mereka kira-kira berapa?", type: "age" },
      { key: "role", label: "Apa pekerjaan atau peran mereka?", placeholder: "misal: ibu bekerja, pemilik usaha kecil" },
      { key: "goal", label: "Apa yang sedang mereka coba capai?", placeholder: "misal: pengen anaknya lancar bahasa Mandarin sebelum SMP" },
      { key: "worry", label: "Apa yang bikin mereka khawatir soal ini sehari-hari?", placeholder: "misal: takut anaknya keteteran karena kesibukan kerja" },
    ],
    example: "Ibu-ibu usia 28-40 yang ingin anaknya bisa bahasa Mandarin, tapi nggak punya waktu antar-jemput les setiap hari.",
  },
  {
    key: "problem",
    field: "problemSolved",
    kind: "compose",
    title: "Masalah apa yang mereka punya?",
    guide: "Biasanya ada dua sisi: masalah yang keliatan jelas, dan perasaan yang muncul karena masalah itu.",
    parts: [
      { key: "practical", label: "Apa masalah praktis yang terlihat jelas?", placeholder: "misal: anaknya susah fokus belajar bahasa asing" },
      { key: "feeling", label: "Masalah itu bikin mereka merasa gimana?", placeholder: "misal: frustrasi, bersalah, cemas" },
      { key: "duration", label: "Sudah berapa lama masalah ini mengganggu mereka?", placeholder: "misal: udah dari 6 bulan lalu" },
    ],
    example: "Anaknya susah fokus belajar bahasa asing, dan orang tuanya merasa bersalah karena keterbatasan waktu.",
  },
  {
    key: "trust",
    field: "differentiation",
    syncField: "positioning",
    kind: "compose",
    title: "Kenapa mereka harus percaya & pilih kamu?",
    guide: "Orang butuh dua alasan sekaligus: kenapa kamu ngerti posisi mereka, dan kenapa kamu — bukan yang lain.",
    parts: [
      { key: "different", label: "Apa yang membedakan brandmu dari kompetitor lain?", placeholder: "misal: satu-satunya yang punya guru native speaker" },
      { key: "loyalty", label: "Kenapa pelanggan lama tetap bertahan pilih kamu?", placeholder: "misal: karena jadwalnya fleksibel banget" },
      { key: "proof", label: "Bukti konkret / testimoni", type: "list" },
    ],
    example: "Satu-satunya kelas Mandarin online dengan guru native speaker dan jadwal fleksibel per keluarga.",
  },
  {
    key: "plan",
    field: "mission",
    kind: "funnel3",
    title: "Apa langkah-langkahnya?",
    guide: "Rencana simpel 3 langkah bikin orang nggak takut atau bingung duluan. Kalau orang kerja sama kamu, mereka bakal ngelewatin apa aja?",
    parts: [
      { key: "step1", label: "Langkah 1", placeholder: "misal: Sesi trial gratis" },
      { key: "step2", label: "Langkah 2", placeholder: "misal: Tentukan jadwal mingguan" },
      { key: "step3", label: "Langkah 3", placeholder: "misal: Kelas rutin dengan progress report" },
    ],
    example: "1) Sesi trial gratis 2) Tentukan jadwal mingguan 3) Kelas rutin dengan progress report bulanan.",
  },
  {
    key: "cta",
    field: "callToAction",
    title: "Apa yang harus mereka lakukan sekarang?",
    guide: "Satu ajakan yang jelas dan langsung — jangan bikin mereka nebak-nebak langkah berikutnya.",
    prompts: ["Apa kata kerja aksinya (daftar, beli, hubungi, coba)?", "Di mana atau bagaimana cara mereka melakukannya?"],
    example: "Daftar kelas trial gratis sekarang.",
  },
  {
    key: "stakes",
    title: "Apa yang dipertaruhkan?",
    guide: "Dua sisi mata uang, dijawab simpel.",
    fields: [
      {
        field: "successOutcome", label: "Kalau mereka pilih kamu, kenapa?",
        example: "Anaknya percaya diri berbahasa Mandarin, orang tua nggak lagi merasa bersalah soal waktu.",
      },
      {
        field: "failureOutcome", label: "Kalau mereka nggak pilih kamu, kenapa?",
        example: "Anaknya makin tertinggal, dan momen terbaik untuk belajar bahasa keburu lewat.",
      },
    ],
  },
  {
    key: "foundation",
    title: "Kenapa brand ini ada, dan mau ke mana?",
    guide: "Purpose itu alasan brand ini dimulai, di luar soal profit. Vision itu masa depan jangka panjang yang brand ini tuju. Kosongin aja kalau belum kepikiran — klik \"Minta opsi dari AI\" dan biarkan AI bikinkan draf dari jawaban kamu sebelumnya.",
    fields: [
      { field: "purpose", label: "Purpose", example: "Membuka akses belajar Mandarin berkualitas untuk semua keluarga." },
      { field: "vision", label: "Vision", example: "Jadi tempat belajar bahasa nomor satu untuk keluarga Indonesia." },
    ],
  },
  {
    key: "identity",
    title: "Detail terakhir, dikit lagi",
    guide: "Sentuhan akhir yang cepat — ini bantu AI dan tim kamu jelasin brand ini secara konsisten. Boleh dilewatin dulu kalau belum kepikiran.",
  },
];

export function render(root, { brandId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const dna = brand.brandDNA || {};
  const state = {
    stepIndex: 0,
    answers: {
      targetAudience: dna.targetAudience || "", problemSolved: dna.problemSolved || "",
      positioning: dna.positioning || "", differentiation: dna.differentiation || "",
      mission: dna.mission || "", callToAction: dna.callToAction || "",
      successOutcome: dna.successOutcome || "", failureOutcome: dna.failureOutcome || "",
      purpose: dna.purpose || "", vision: dna.vision || "",
      tagline: dna.tagline || "", oneLiner: dna.oneLiner || "",
      personality: dna.personality || [], values: dna.values || [], productsServices: dna.productsServices || [],
    },
    // Scratch state for the broken-down questions — the short per-box
    // answers used to compose the final saved paragraph. Not persisted to
    // brandDNA itself (only the composed result is); revisiting a step
    // after saving starts these boxes blank again, same as any AI-draft
    // scratchpad elsewhere in this app.
    parts: {},
  };
  const refresh = () => paint(root, brandId, brand, state, refresh);
  refresh();
  return () => {};
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
        <div class="page-eyebrow"><a href="#/brand/${brand.id}/builder" style="color:inherit;">${icon("chevronLeft", { size: 11 })} Brand Builder</a> · Brand DNA</div>
        <h1>${brand.name}</h1>
      </div>
    </div>
    <div style="max-width:640px;">
      <div class="flex items-center justify-between" style="margin-bottom:6px;">
        <span class="text-faint" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${isReview ? "Review" : `Langkah ${state.stepIndex + 1} dari ${total - 1}`}</span>
      </div>
      <div style="height:5px;background:var(--surface-2);border-radius:999px;overflow:hidden;margin-bottom:24px;">
        <div style="height:100%;background:var(--accent);width:${Math.round(((state.stepIndex + 1) / total) * 100)}%;transition:width .2s;"></div>
      </div>
      ${isReview ? reviewHTML(state) : stepHTML(step, state)}
    </div>
  `;

  if (!isReview) wireStep(root, brandId, brand, state, refresh);
  else wireReview(root, brandId, brand, state, refresh);
}

// A step's required field(s) must all be non-empty before Next is
// clickable — per the user's request, this wizard is meant to make someone
// actually answer each question, not skip through a form. The "identity"
// step is the one explicit exception (it has its own Skip for now).
function isStepFilled(step, answers) {
  if (step.key === "identity") return true;
  if (step.fields) return step.fields.every((f) => !!answers[f.field].trim());
  return !!answers[step.field].trim();
}

// The funnel3 step (plan) has no #ans-${field} element at all — its
// answer is composed purely in JS state from the 3 boxes, never rendered
// as its own textarea — so it reads state.answers directly instead of
// querying a DOM node that doesn't exist for that step.
function liveStepFilled(step, root, state) {
  if (step.key === "identity") return true;
  if (step.kind === "funnel3") return !!state.answers[step.field].trim();
  if (step.fields) return step.fields.every((f) => !!qs(`#ans-${f.field}`, root).value.trim());
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
      <p class="text-faint" style="font-size:11.5px;margin:0 0 8px;">Tulis jawaban kamu sendiri dulu, lalu klik tombol di bawah buat minta beberapa opsi kalimat yang lebih tajam dari AI.</p>
      <textarea class="textarea" id="ans-${field}" data-field="${field}" style="min-height:90px;" placeholder="${escapeHtml(example)}">${escapeHtml(value)}</textarea>
      <button type="button" class="btn btn-secondary btn-block" data-polish="${field}" style="margin-top:8px;">${icon("bot", { size: 14 })}Minta opsi dari AI</button>
      <div id="polish-status-${field}" style="margin-top:8px;"></div>
      <div id="polish-options-${field}"></div>
      <p class="text-faint" style="font-size:11.5px;margin:8px 0 0;"><em>Contoh: ${escapeHtml(example)}</em></p>
    </div>
  `;
}

// ---------- Broken-down question boxes (compose / funnel3 steps) ----------

function agePartInputHTML(part, value) {
  return `
    <input class="input" id="part-${part.key}" data-part="${part.key}" list="age-range-options" placeholder="contoh: 28-40" value="${escapeHtml(value || "")}" />
    <datalist id="age-range-options">${AGE_RANGES.map((r) => `<option value="${r}"></option>`).join("")}</datalist>
  `;
}

function proofListHTML(list) {
  return `
    <div class="flex gap-8" style="margin-bottom:8px;">
      <input class="input" id="part-proof-new" placeholder="Ketik satu bukti/testimoni, lalu tambah" style="flex:1;" />
      <button type="button" class="btn btn-secondary" id="part-proof-add" style="flex:none;" aria-label="Tambah">${icon("plus", { size: 14 })}</button>
    </div>
    <div class="chip-list" id="part-proof-list">
      ${list.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-proof-remove="${i}" aria-label="Hapus">${icon("x", { size: 10 })}</button></span>`).join("")}
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
        <button type="button" class="btn btn-ghost btn-sm" data-polish-part="${part.key}" style="margin-top:4px;font-size:11.5px;">${icon("bot", { size: 12 })}Pakai AI buat mikirin ini</button>
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
    ${step.parts.map((p) => composePartHTML(p, parts[p.key])).join("")}
    <button type="button" class="btn btn-secondary btn-block" id="compose-answer" style="margin-bottom:14px;">${icon("check", { size: 14 })}Gabungkan jadi satu jawaban</button>
    <div id="compose-status" style="margin-bottom:10px;"></div>
    ${narrativeFieldHTML({ field: step.field, label: "Jawaban gabungan (bisa diedit)", example: step.example, value: state.answers[step.field], collapsed: true })}
    ${navHTML(state, !isStepFilled(step, state.answers))}
  `;
}

function funnel3StepHTML(step, state) {
  const parts = state.parts[step.key] || {};
  return `
    <h2 style="margin-bottom:6px;">${step.title}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${step.guide}</p>
    <div class="dna-funnel3">
      ${step.parts.map((p, i) => `
        <div class="dna-funnel3-box">
          <div class="dna-funnel3-num">${i + 1}</div>
          ${composePartHTML(p, parts[p.key])}
        </div>
      `).join("")}
    </div>
    ${navHTML(state, !isStepFilled(step, state.answers))}
  `;
}

// ---------- End broken-down question boxes ----------

function stepHTML(step, state) {
  if (step.kind === "compose") return composeStepHTML(step, state);
  if (step.kind === "funnel3") return funnel3StepHTML(step, state);

  const nav = navHTML(state, !isStepFilled(step, state.answers));
  if (step.key === "identity") {
    return `
      <h2 style="margin-bottom:6px;">${step.title}</h2>
      <p class="text-muted" style="font-size:13px;margin:0 0 20px;">${step.guide}</p>
      <div class="field">
        <label>Tagline</label>
        <input class="input" id="ans-tagline" placeholder="Satu kalimat pendek buat brand ini" value="${escapeHtml(state.answers.tagline)}" />
      </div>
      ${chipListHTML("personality", "Kepribadian brand", state.answers.personality, "misal: Playful, Direct, Warm")}
      ${chipListHTML("values", "Values", state.answers.values, "misal: Jujur, Teliti, Komunitas")}
      ${chipListHTML("products", "Produk / Layanan", state.answers.productsServices, "misal: Kelas Mandarin untuk anak")}
      ${nav}
      <div style="text-align:center;margin-top:10px;">
        <button type="button" class="btn btn-ghost btn-sm" id="wiz-skip-identity">Skip for now →</button>
      </div>
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

// Reusable "type, click +, removable pill" list input — personality/
// values/products in the identity step, same visual pill language as the
// checkbox-chip pattern used elsewhere, just for a free-typed growable
// list instead of a fixed set of toggleable options.
function chipListHTML(id, label, items, placeholder) {
  return `
    <div class="field">
      <label>${label}</label>
      <div class="flex gap-8" style="margin-bottom:8px;">
        <input class="input" id="${id}-new" placeholder="${escapeHtml(placeholder || "Ketik lalu tambah")}" style="flex:1;" />
        <button type="button" class="btn btn-secondary" data-chip-add="${id}" style="flex:none;" aria-label="Tambah">${icon("plus", { size: 14 })}</button>
      </div>
      <div class="chip-list" id="${id}-list">
        ${items.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-chip-remove="${id}" data-index="${i}" aria-label="Hapus">${icon("x", { size: 10 })}</button></span>`).join("")}
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
      <button type="button" class="btn btn-secondary" id="wiz-back" ${state.stepIndex === 0 ? "disabled" : ""}>${icon("chevronLeft", { size: 14 })}Kembali</button>
      <div class="flex items-center gap-8">
        <div style="text-align:right;">
          <button type="button" class="btn btn-ghost btn-sm" id="wiz-save-checkpoint">${icon("check", { size: 13 })}Simpan progress</button>
          <div id="wiz-save-status" class="text-faint" style="font-size:11px;margin-top:4px;"></div>
        </div>
        <div style="text-align:right;">
          <button type="button" class="btn btn-primary" id="wiz-next" ${nextDisabled ? "disabled" : ""}>Lanjut${icon("chevronRight", { size: 14 })}</button>
          <div id="wiz-next-hint" class="text-faint" style="font-size:11px;margin-top:6px;${nextDisabled ? "" : "display:none;"}">Isi dulu jawabannya buat lanjut</div>
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
        <button type="button" class="btn btn-secondary btn-sm" data-use-option="${i}" style="flex:none;">Pakai</button>
      </div>`
      )
      .join("")}
    <button type="button" class="btn btn-secondary btn-block" data-more-options="1" style="margin-top:8px;">${icon("bot", { size: 14 })}Coba opsi lain</button>
  `;
}

// Asks AI to sharpen the user's OWN draft into a few distinct phrasing
// options — never invents an answer from an empty field, and never
// silently overwrites the textarea. The user picks whichever option is
// actually good; "Coba opsi lain" fetches a fresh batch instead of
// repeating the same ones. Works on any element with a `.value` — used for
// the full-size textareas and the small per-box inputs alike.
async function runSuggestOptions({ brand, question, guide, textarea, statusEl, optionsEl, btn, priorAnswers, count }) {
  const draft = textarea.value.trim();
  const ai = getSettings().ai || {};
  const hasKey = hasAiKey(ai);
  if (!hasKey) {
    statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">Tambahin API key AI dulu di Settings → AI.</div>`;
    return;
  }
  const shownBefore = [...optionsEl.querySelectorAll("[data-option-text]")].map((el) => el.dataset.optionText);
  btn.disabled = true;
  statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Lagi nyari opsi...</span></div>`;
  try {
    const options = await suggestBrandDnaOptions(ai, { brand, question, guide, draftAnswer: draft, priorAnswers, avoid: shownBefore, count: count || 3 });
    statusEl.innerHTML = "";
    optionsEl.innerHTML = optionCardsHTML(options);
    optionsEl.querySelectorAll("[data-use-option]").forEach((cardBtn, i) => {
      // Stash the raw text on the card itself so a later "Coba opsi lain"
      // click can tell the AI not to repeat it — attribute, not a closure
      // variable, since this whole block gets re-rendered from scratch.
      cardBtn.closest(".card").dataset.optionText = options[i];
      cardBtn.addEventListener("click", () => {
        textarea.value = options[i];
        textarea.dispatchEvent(new Event("input"));
        // Once one's picked, the sibling options are moot — close the whole
        // bubble instead of leaving 2 unchosen cards sitting there.
        optionsEl.innerHTML = "";
      });
    });
    qs("[data-more-options]", optionsEl)?.addEventListener("click", () =>
      runSuggestOptions({ brand, question, guide, textarea, statusEl, optionsEl, btn, priorAnswers, count })
    );
  } catch (e) {
    statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? e.message : "Gagal menghubungi AI."}</span></div>`;
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
          textarea, statusEl, optionsEl, btn,
          priorAnswers: stepAnswerSummaries(state, state.stepIndex),
        })
      );
    });
  }

  qs("#wiz-back", root)?.addEventListener("click", () => {
    captureStep(root, step, state);
    state.stepIndex = Math.max(0, state.stepIndex - 1);
    refresh();
  });
  nextBtn?.addEventListener("click", () => {
    if (nextBtn.disabled) return;
    captureStep(root, step, state);
    state.stepIndex += 1;
    refresh();
  });
  qs("#wiz-skip-identity", root)?.addEventListener("click", () => {
    captureStep(root, step, state);
    state.stepIndex += 1;
    refresh();
  });

  // Locks in everything answered so far, right now — not just at the end.
  // Closing the tab or navigating away mid-wizard used to lose progress
  // past whatever was already on the Review screen; this writes the same
  // brandDNA patch the final Save does, just earlier and as many times as
  // the user wants, so a step is genuinely a checkpoint, not a scratchpad.
  qs("#wiz-save-checkpoint", root)?.addEventListener("click", () => {
    captureStep(root, step, state);
    updateBrand(brandId, { brandDNA: { ...state.answers } });
    const statusEl = qs("#wiz-save-status", root);
    if (statusEl) {
      statusEl.textContent = "Tersimpan ✓";
      setTimeout(() => { if (statusEl.isConnected) statusEl.textContent = ""; }, 2500);
    }
    toast("Progress tersimpan — aman kalau mau lanjut nanti");
  });
}

function currentPartValues(root, step) {
  const parts = {};
  step.parts.forEach((p) => {
    if (p.type === "list") {
      parts[p.key] = qsa(`#part-proof-list .dna-chip`, root).map((el) => el.firstChild.textContent);
    } else {
      parts[p.key] = qs(`#part-${p.key}`, root)?.value.trim() || "";
    }
  });
  return parts;
}

function wireComposeOrFunnelStep(root, brandId, brand, state, step, refresh, updateNextState) {
  // Every plain-text part input keeps the wizard's local scratch state in
  // sync as the user types, so switching Back/Next doesn't lose progress.
  step.parts.forEach((p) => {
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
    const part = step.parts.find((p) => p.key === key);
    const input = qs(`#part-${key}`, root);
    const statusEl = qs(`#polish-status-part-${key}`, root);
    const optionsEl = qs(`#polish-options-part-${key}`, root);
    btn.addEventListener("click", () =>
      runSuggestOptions({
        brand, question: part.label, guide: step.guide,
        textarea: input, statusEl, optionsEl, btn,
        priorAnswers: stepAnswerSummaries(state, state.stepIndex),
        count: 2,
      })
    );
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
        .map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-proof-remove="${i}" aria-label="Hapus">${icon("x", { size: 10 })}</button></span>`)
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
    step.parts.forEach((p) => {
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
        brand, question: step.title, guide: step.guide,
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
    const parts = currentPartValues(root, step);
    state.parts[step.key] = { ...(state.parts[step.key] || {}), ...parts };
    const answerField = qs(`#ans-${step.field}`, root);
    const answerWrap = answerField.closest("[data-collapsed-field]") || answerField.closest(".field");
    const partList = step.parts.map((p) => (p.type === "list" ? (parts[p.key] || []).join("; ") : parts[p.key]));
    const composed = joinParts(partList);
    if (!composed) {
      qs("#compose-status", root).innerHTML = `<div class="text-faint" style="font-size:11.5px;">Isi minimal satu kotak dulu sebelum digabung.</div>`;
      return;
    }
    answerField.value = composed;
    if (answerWrap) answerWrap.style.display = "";
    state.answers[step.field] = composed;
    if (step.syncField) state.answers[step.syncField] = composed;
    qs("#compose-status", root).innerHTML = "";
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

function wireIdentityStep(root, brandId, state, refresh, updateNextState) {
  qs("#ans-tagline", root)?.addEventListener("input", updateNextState);
  [["personality", state.answers.personality], ["values", state.answers.values], ["products", state.answers.productsServices]].forEach(([id]) => {
    qs(`[data-chip-add="${id}"]`, root)?.addEventListener("click", () => addChip(root, state, id));
    qs(`#${id}-new`, root)?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addChip(root, state, id); } });
  });
  wireChipRemove(root, state);
}

const CHIP_FIELD_BY_ID = { personality: "personality", values: "values", products: "productsServices" };
function addChip(root, state, id) {
  const input = qs(`#${id}-new`, root);
  const val = input.value.trim();
  if (!val) return;
  const field = CHIP_FIELD_BY_ID[id];
  state.answers[field] = [...state.answers[field], val];
  qs(`#${id}-list`, root).innerHTML = state.answers[field]
    .map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-chip-remove="${id}" data-index="${i}" aria-label="Hapus">${icon("x", { size: 10 })}</button></span>`)
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
    state.answers.tagline = qs("#ans-tagline", root).value.trim();
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

function reviewSection(label, value) {
  if (!value) return "";
  return `<div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px;padding:12px 0;"><span class="k" style="font-weight:700;">${label}</span><span class="v" style="font-weight:400;text-align:left;white-space:pre-wrap;">${escapeHtml(value)}</span></div>`;
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
        <h3 style="margin:0;font-size:15px;">One-liner brand kamu</h3>
        <button type="button" class="btn btn-secondary" id="gen-oneliner" ${hasEnough ? "" : "disabled"}>
          ${icon("bot", { size: 14 })}${state.answers.oneLiner ? "Coba lagi" : "Buatkan one-liner"}
        </button>
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:0 0 10px;">Satu kalimat yang langsung bikin orang ngerti: masalahnya apa, kamu bantu apa, hasilnya apa.</p>
      <textarea class="textarea" id="ans-oneLiner" style="min-height:60px;font-weight:600;" placeholder="${hasEnough ? "Klik “Buatkan one-liner” di atas" : "Isi dulu Langkah 1 & 2 (pelanggan & masalah)"}">${escapeHtml(state.answers.oneLiner)}</textarea>
      <div id="oneliner-status" style="margin-top:8px;"></div>
    </div>
  `;
}

function reviewHTML(state) {
  const a = state.answers;
  return `
    <h2 style="margin-bottom:6px;">Review Brand DNA kamu</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 20px;">Ini jadi dasar yang dibaca Campaigns dan AI di seluruh Brandlab. Klik Kembali buat ubah sesuatu, atau Simpan buat mengunci.</p>
    ${oneLinerCardHTML(state)}
    <div class="card card-tight" style="margin-bottom:20px;">
      ${reviewSection("Pelanggan", a.targetAudience)}
      ${reviewSection("Masalah", a.problemSolved)}
      ${reviewSection("Kenapa percaya & pilih kamu", a.differentiation)}
      ${reviewSection("Rencana", a.mission)}
      ${reviewSection("Ajakan bertindak", a.callToAction)}
      ${reviewSection("Kalau mereka pilih kamu", a.successOutcome)}
      ${reviewSection("Kalau mereka nggak pilih kamu", a.failureOutcome)}
      ${reviewSection("Purpose", a.purpose)}
      ${reviewSection("Vision", a.vision)}
      ${reviewSection("Tagline", a.tagline)}
      ${reviewSection("Kepribadian", a.personality.join(", "))}
      ${reviewSection("Values", a.values.join(", "))}
      ${reviewSection("Produk / Layanan", a.productsServices.join(", "))}
      ${!Object.values(a).some((v) => (Array.isArray(v) ? v.length : v)) ? `<p class="text-faint" style="font-size:12.5px;padding:12px 0;">Belum ada yang diisi — klik Kembali buat jawab beberapa pertanyaan.</p>` : ""}
    </div>
    <div class="flex items-center justify-between">
      <button type="button" class="btn btn-secondary" id="wiz-back">${icon("chevronLeft", { size: 14 })}Kembali</button>
      <div class="flex gap-8">
        <button type="button" class="btn btn-secondary" id="wiz-pdf">${icon("download", { size: 14 })}Download PDF</button>
        <button type="button" class="btn btn-primary" id="wiz-save">${icon("check", { size: 15 })}Simpan Brand DNA</button>
      </div>
    </div>
  `;
}

function wireReview(root, brandId, brand, state, refresh) {
  qs("#wiz-back", root).addEventListener("click", () => {
    state.stepIndex = STEPS.length - 1;
    refresh();
  });
  qs("#wiz-save", root).addEventListener("click", () => {
    state.answers.oneLiner = qs("#ans-oneLiner", root)?.value.trim() || state.answers.oneLiner;
    updateBrand(brandId, { brandDNA: { ...state.answers } });
    toast("Brand DNA tersimpan");
  });
  qs("#wiz-pdf", root).addEventListener("click", () => {
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
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">Tambahin API key AI dulu di Settings → AI.</div>`;
        return;
      }
      oneLinerBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Lagi bikin one-liner...</span></div>`;
      try {
        const line = await generateOneLiner(ai, { brand, answers: state.answers });
        state.answers.oneLiner = line;
        qs("#ans-oneLiner", root).value = line;
        oneLinerBtn.innerHTML = `${icon("bot", { size: 14 })}Coba lagi`;
        statusEl.innerHTML = "";
      } catch (e) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? e.message : "Gagal menghubungi AI."}</span></div>`;
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
      <div class="brandbook-page-eyebrow">Yang Dipertaruhkan</div>
      <div class="dna-stakes-grid">
        <div class="dna-stakes-col dna-stakes-win">
          <div class="dna-row-label">Kalau mereka pilih kamu</div>
          <p class="dna-row-text">${escapeHtml(success || "—")}</p>
        </div>
        <div class="dna-stakes-col dna-stakes-risk">
          <div class="dna-row-label">Kalau mereka nggak pilih kamu</div>
          <p class="dna-row-text">${escapeHtml(failure || "—")}</p>
        </div>
      </div>
    </div>
  `;
}

function openBrandDnaPdf(brand, answers) {
  const listRows = [
    ["Kepribadian", answers.personality],
    ["Values", answers.values],
    ["Produk / Layanan", answers.productsServices],
  ].filter(([, v]) => v.length);

  const overlay = openModal({
    title: "Brand DNA — PDF Preview",
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
        ${dnaSectionHTML("Siapa Pelanggan Kamu", [["Pelanggan", answers.targetAudience], ["Masalah", answers.problemSolved]])}
        ${dnaSectionHTML("Kenapa Mereka Percaya & Pilih Kamu", [["Kenapa percaya & pilih kamu", answers.differentiation]])}
        ${dnaSectionHTML("Rencana & Langkah Selanjutnya", [["Rencana", answers.mission], ["Ajakan bertindak", answers.callToAction]])}
        ${dnaStakesHTML(answers.successOutcome, answers.failureOutcome)}
        ${dnaSectionHTML("Kenapa Brand Ini Ada", [["Purpose", answers.purpose], ["Vision", answers.vision]])}
        ${listRows.length ? `<div class="dna-section"><div class="brandbook-page-eyebrow">Detail Brand</div>${listRows.map(([label, list]) => dnaRowHTML(label, list.join(" · "))).join("")}</div>` : ""}
        <div class="report-footer">Wepeka Brandlab — ${escapeHtml(brand.name)}</div>
      </div></div>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="dna-pdf-close">Close</button>
      <button class="btn btn-primary" id="dna-pdf-download">${icon("download", { size: 14 })}Download PDF</button>
    `,
  });
  qs("#dna-pdf-close", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("#dna-pdf-download", overlay).addEventListener("click", () => {
    toast('In the print dialog, choose "Save as PDF" as the destination.');
    setTimeout(() => window.print(), 400);
  });
}
