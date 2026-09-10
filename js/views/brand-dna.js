import { getBrand, updateBrand, getSettings } from "../store.js";
import { linesToList, listToLines, toast, qs, escapeHtml } from "../dom.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { suggestBrandDnaAnswer, checkBrandDnaAnswer, ANSWER_QUALITY_CRITERIA, AiApiError } from "../ai.js";

// A guided, one-question-at-a-time wizard (StoryBrand-inspired, blended with
// this app's own Brand DNA fields) instead of one long form — per the user's
// own request, so filling this out doesn't feel like staring at a blank
// form with no idea what's actually being asked. Nothing is required; every
// step can be left blank and revisited later. Answers only get written to
// the brand (one `updateBrand` call) when the user hits Save on the final
// Review screen — same "buffer locally, persist on an explicit save" pattern
// every other editor in this app already uses.
const STEPS = [
  {
    key: "audience",
    field: "targetAudience",
    title: "Who is your customer?",
    guide: "In a good story, the customer is the hero — not your brand. Describe who they are beyond demographics: what do they actually want?",
    prompts: ["Berapa kira-kira usia mereka?", "Apa pekerjaan atau peran mereka (misal: ibu bekerja, pemilik usaha kecil)?", "Apa yang sedang mereka coba capai?", "Apa yang bikin mereka khawatir soal ini sehari-hari?"],
    example: "Ibu-ibu usia 28-40 yang ingin anaknya bisa bahasa Mandarin, tapi nggak punya waktu antar-jemput les setiap hari.",
  },
  {
    key: "problem",
    field: "problemSolved",
    title: "What problem do they have?",
    guide: "There's usually a practical problem (what's literally going wrong) and an emotional one (how it makes them feel) — naming both makes this land harder.",
    prompts: ["Apa masalah praktis yang terlihat jelas?", "Bagaimana masalah itu membuat mereka merasa (frustrasi, bersalah, cemas)?", "Sudah berapa lama masalah ini mengganggu mereka?"],
    example: "Anaknya susah fokus belajar bahasa asing, dan orang tuanya merasa bersalah karena keterbatasan waktu.",
  },
  {
    key: "positioning",
    field: "positioning",
    title: "Why do you understand them?",
    guide: "Customers trust a guide who gets their pain before offering a fix. What experience or perspective makes you that guide?",
    prompts: ["Pengalaman apa yang bikin kamu paham posisi mereka?", "Apa yang pernah kamu lihat atau alami langsung dari masalah ini?"],
    example: "Kami dulu juga orang tua yang sibuk, dan tahu rasanya ingin anak berkembang tapi waktu terbatas.",
  },
  {
    key: "differentiation",
    field: "differentiation",
    title: "Why should they choose you specifically?",
    guide: "Not a feature list — the concrete reason someone picks you over every other option they could have picked instead.",
    prompts: ["Apa yang kompetitor TIDAK punya atau tidak lakukan?", "Kenapa pelanggan lama tetap bertahan pilih kamu?", "Ada bukti konkret (data, testimoni, track record)?"],
    example: "Satu-satunya kelas Mandarin online dengan guru native speaker dan jadwal fleksibel per keluarga.",
  },
  {
    key: "plan",
    field: "mission",
    title: "What's your plan?",
    guide: "A simple, few-step plan removes fear and confusion. What does someone actually go through, working with you?",
    prompts: ["Langkah pertama apa yang mereka lakukan?", "Langkah berikutnya?", "Bagaimana prosesnya berakhir/hasil akhirnya?"],
    example: "1) Sesi trial gratis 2) Tentukan jadwal mingguan 3) Kelas rutin dengan progress report bulanan.",
  },
  {
    key: "cta",
    field: "callToAction",
    title: "What should they do right now?",
    guide: "One clear, direct call to action — don't make them guess the next step.",
    prompts: ["Apa kata kerja aksinya (daftar, beli, hubungi, coba)?", "Di mana atau bagaimana cara mereka melakukannya?"],
    example: "Daftar kelas trial gratis sekarang.",
  },
  {
    key: "stakes",
    title: "What's at stake?",
    guide: "Two sides of the same coin: if they say yes, what does their life look like (the win)? If they do nothing, what do they risk (the cost of staying stuck)?",
    fields: [
      {
        field: "successOutcome", label: "If they say yes...",
        prompts: ["Bagaimana perasaan mereka setelah berhasil?", "Apa yang berubah secara konkret dalam hidup/bisnis mereka?"],
        example: "Anaknya percaya diri berbahasa Mandarin, orang tua nggak lagi merasa bersalah soal waktu.",
      },
      {
        field: "failureOutcome", label: "If they do nothing...",
        prompts: ["Apa kerugian nyata kalau mereka nggak bertindak?", "Apa risikonya dalam jangka panjang?"],
        example: "Anaknya makin tertinggal, dan momen terbaik untuk belajar bahasa keburu lewat.",
      },
    ],
  },
  {
    key: "foundation",
    title: "Why does this brand exist, and where's it headed?",
    guide: "Purpose is why this brand was started, beyond profit. Vision is the long-term future it's working toward.",
    fields: [
      { field: "purpose", label: "Purpose", prompts: ["Kalau bukan soal profit, kenapa brand ini ada?"], example: "Membuka akses belajar Mandarin berkualitas untuk semua keluarga." },
      { field: "vision", label: "Vision", prompts: ["5-10 tahun ke depan, brand ini maunya jadi seperti apa?"], example: "Jadi tempat belajar bahasa nomor satu untuk keluarga Indonesia." },
    ],
  },
  {
    key: "identity",
    title: "A few more details",
    guide: "Quick finishing touches — these help AI and your team describe the brand consistently.",
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
      tagline: dna.tagline || "", personality: dna.personality || [], values: dna.values || [], productsServices: dna.productsServices || [],
    },
    aiLoading: false,
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
        <div class="page-eyebrow">Brand DNA</div>
        <h1>${brand.name}</h1>
      </div>
    </div>
    <div style="max-width:640px;">
      <div class="flex items-center justify-between" style="margin-bottom:6px;">
        <span class="text-faint" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${isReview ? "Review" : `Step ${state.stepIndex + 1} of ${total - 1}`}</span>
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
// actually answer each question, not skip through a form.
function isStepFilled(step, answers) {
  if (step.key === "identity") {
    return !!answers.tagline.trim() && !!answers.personality.length && !!answers.values.length && !!answers.productsServices.length;
  }
  if (step.fields) return step.fields.every((f) => !!answers[f.field].trim());
  return !!answers[step.field].trim();
}

function liveStepFilled(step, root) {
  if (step.key === "identity") {
    return (
      !!qs("#ans-tagline", root).value.trim() &&
      !!linesToList(qs("#ans-personality", root).value).length &&
      !!linesToList(qs("#ans-values", root).value).length &&
      !!linesToList(qs("#ans-products", root).value).length
    );
  }
  if (step.fields) return step.fields.every((f) => !!qs(`#ans-${f.field}`, root).value.trim());
  return !!qs(`#ans-${step.field}`, root).value.trim();
}

function stepHTML(step, state) {
  const nav = navHTML(state, !isStepFilled(step, state.answers));
  if (step.key === "identity") {
    return `
      <h2 style="margin-bottom:6px;">${step.title}</h2>
      <p class="text-muted" style="font-size:13px;margin:0 0 20px;">${step.guide}</p>
      <div class="field">
        <label>Tagline</label>
        <input class="input" id="ans-tagline" placeholder="A short one-liner for this brand" value="${escapeHtml(state.answers.tagline)}" />
      </div>
      <div class="field">
        <label>Personality (one per line)</label>
        <textarea class="textarea" id="ans-personality" style="min-height:70px;" placeholder="e.g. Playful&#10;Direct&#10;Warm">${listToLines(state.answers.personality)}</textarea>
      </div>
      <div class="field">
        <label>Values (one per line)</label>
        <textarea class="textarea" id="ans-values" style="min-height:70px;" placeholder="e.g. Honesty&#10;Craft&#10;Community">${listToLines(state.answers.values)}</textarea>
      </div>
      <div class="field">
        <label>Products / Services (one per line)</label>
        <textarea class="textarea" id="ans-products" style="min-height:70px;" placeholder="e.g. Mandarin classes for kids&#10;Corporate training">${listToLines(state.answers.productsServices)}</textarea>
      </div>
      ${nav}
    `;
  }
  if (step.fields) {
    return `
      <h2 style="margin-bottom:6px;">${step.title}</h2>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${step.guide}</p>
      ${step.fields
        .map(
          (f) => `
        <div class="field">
          <label>${f.label}</label>
          ${promptsHTML(f.prompts)}
          <textarea class="textarea" id="ans-${f.field}" style="min-height:80px;" placeholder="${escapeHtml(f.example)}">${escapeHtml(state.answers[f.field])}</textarea>
          <div id="qc-${f.field}" style="margin-top:6px;"></div>
        </div>`
        )
        .join("")}
      ${nav}
    `;
  }
  return `
    <h2 style="margin-bottom:6px;">${step.title}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 10px;">${step.guide}</p>
    ${promptsHTML(step.prompts)}
    <div class="field" style="margin-bottom:8px;">
      <div class="creator-field-head">
        <label style="margin-bottom:0;">Your answer</label>
        <button type="button" class="chip-icon-btn" id="ai-help" aria-label="Help me answer this" title="Help me answer this">${icon("bot", { size: 14 })}</button>
      </div>
      <textarea class="textarea" id="ans-${step.field}" style="min-height:100px;" placeholder="${escapeHtml(step.example)}">${escapeHtml(state.answers[step.field])}</textarea>
      <div id="ai-help-status" style="margin-top:6px;"></div>
      <div id="qc-${step.field}" style="margin-top:6px;"></div>
    </div>
    <p class="text-faint" style="font-size:11.5px;margin:0 0 20px;"><em>Example: ${escapeHtml(step.example)}</em></p>
    ${nav}
  `;
}

function promptsHTML(prompts) {
  if (!prompts?.length) return "";
  return `<ul class="text-faint" style="font-size:12px;margin:0 0 10px;padding-left:18px;line-height:1.6;">${prompts.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`;
}

// Strength-meter treatment (colored bar + met/unmet checklist), same idea
// as a password-strength widget — just judged by AI per criterion instead
// of a regex, since "is this specific enough" isn't pattern-matchable.
const QUALITY_METER_COLOR = ["var(--health-poor)", "var(--health-poor)", "var(--health-average)", "var(--health-good)"];
const QUALITY_METER_LABEL = ["Weak answer", "Weak answer", "Could be sharper", "Strong answer"];
function qualityMeterHTML(criteria, feedback) {
  const score = criteria.filter(Boolean).length;
  const color = QUALITY_METER_COLOR[score];
  return `
    <div style="height:4px;background:var(--surface-2);border-radius:999px;overflow:hidden;margin-bottom:8px;">
      <div style="height:100%;width:${Math.round((score / ANSWER_QUALITY_CRITERIA.length) * 100)}%;background:${color};transition:width .3s, background .3s;"></div>
    </div>
    <div class="flex items-center justify-between" style="margin-bottom:6px;">
      <span style="font-size:11.5px;font-weight:700;color:${color};">${QUALITY_METER_LABEL[score]}</span>
      ${feedback ? `<span class="text-faint" style="font-size:11px;">${escapeHtml(feedback)}</span>` : ""}
    </div>
    <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;">
      ${ANSWER_QUALITY_CRITERIA.map(
        (text, i) => `
        <li class="flex items-center gap-8" style="font-size:11.5px;color:${criteria[i] ? "var(--health-good)" : "var(--text-faint)"};">
          ${criteria[i] ? icon("check", { size: 12 }) : icon("x", { size: 12 })}
          <span>${escapeHtml(text)}</span>
        </li>`
      ).join("")}
    </ul>
  `;
}

function navHTML(state, nextDisabled) {
  return `
    <div class="flex items-center justify-between" style="margin-top:8px;">
      <button type="button" class="btn btn-secondary" id="wiz-back" ${state.stepIndex === 0 ? "disabled" : ""}>${icon("chevronLeft", { size: 14 })}Back</button>
      <div style="text-align:right;">
        <button type="button" class="btn btn-primary" id="wiz-next" ${nextDisabled ? "disabled" : ""}>Next${icon("chevronRight", { size: 14 })}</button>
        <div id="wiz-next-hint" class="text-faint" style="font-size:11px;margin-top:6px;${nextDisabled ? "" : "display:none;"}">Answer this question to continue</div>
      </div>
    </div>
  `;
}

function wireStep(root, brandId, brand, state, refresh) {
  const step = STEPS[state.stepIndex];

  const nextBtn = qs("#wiz-next", root);
  const nextHint = qs("#wiz-next-hint", root);
  function updateNextState() {
    const filled = liveStepFilled(step, root);
    nextBtn.disabled = !filled;
    nextHint.style.display = filled ? "none" : "";
  }
  const fieldIds = step.key === "identity"
    ? ["#ans-tagline", "#ans-personality", "#ans-values", "#ans-products"]
    : (step.fields || [step]).map((f) => `#ans-${f.field}`);
  fieldIds.forEach((sel) => qs(sel, root)?.addEventListener("input", updateNextState));

  // Weak/okay/strong indicator — checked when the user leaves the field
  // (not on every keystroke, to avoid firing an AI call mid-typing), for
  // every real answer field on this step (identity's detail fields skip
  // this — there's no narrative quality to rate there).
  if (step.key !== "identity") {
    (step.fields || [step]).forEach((f) => {
      const textarea = qs(`#ans-${f.field}`, root);
      const qcEl = qs(`#qc-${f.field}`, root);
      if (!textarea || !qcEl) return;
      textarea.addEventListener("blur", async () => {
        const answer = textarea.value.trim();
        if (!answer) { qcEl.innerHTML = ""; return; }
        const ai = getSettings().ai || {};
        const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
        if (!hasKey) return;
        qcEl.innerHTML = `<div class="text-faint" style="font-size:11px;">Checking…</div>`;
        try {
          const { criteria, feedback } = await checkBrandDnaAnswer(ai, { question: f.label || step.title, guide: step.guide, answer });
          qcEl.innerHTML = qualityMeterHTML(criteria, feedback);
        } catch {
          qcEl.innerHTML = "";
        }
      });
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

  const aiBtn = qs("#ai-help", root);
  if (aiBtn) {
    aiBtn.addEventListener("click", async () => {
      const ai = getSettings().ai || {};
      const statusEl = qs("#ai-help-status", root);
      const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
      if (!hasKey) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">Add your AI API key in Settings → AI first.</div>`;
        return;
      }
      aiBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Thinking…</span></div>`;
      try {
        const textarea = qs(`#ans-${step.field}`, root);
        const suggestion = await suggestBrandDnaAnswer(ai, {
          brand,
          question: step.title,
          guide: step.guide,
          draftAnswer: textarea.value,
          priorAnswers: stepAnswerSummaries(state, state.stepIndex),
        });
        textarea.value = suggestion;
        updateNextState();
        statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 14 })}<span>Suggested — edit as needed.</span></div>`;
      } catch (e) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? e.message : "Couldn't reach the AI."}</span></div>`;
      } finally {
        aiBtn.disabled = false;
      }
    });
  }
}

function captureStep(root, step, state) {
  if (step.key === "identity") {
    state.answers.tagline = qs("#ans-tagline", root).value.trim();
    state.answers.personality = linesToList(qs("#ans-personality", root).value);
    state.answers.values = linesToList(qs("#ans-values", root).value);
    state.answers.productsServices = linesToList(qs("#ans-products", root).value);
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

function reviewHTML(state) {
  const a = state.answers;
  return `
    <h2 style="margin-bottom:6px;">Review your Brand DNA</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 20px;">This becomes the foundation Campaigns and AI read from across Brandlab. Click Back to revise anything, or Save to lock it in.</p>
    <div class="card card-tight" style="margin-bottom:20px;">
      ${reviewSection("Customer", a.targetAudience)}
      ${reviewSection("Problem", a.problemSolved)}
      ${reviewSection("Why you understand them", a.positioning)}
      ${reviewSection("Why choose you", a.differentiation)}
      ${reviewSection("Plan", a.mission)}
      ${reviewSection("Call to action", a.callToAction)}
      ${reviewSection("If they say yes", a.successOutcome)}
      ${reviewSection("If they do nothing", a.failureOutcome)}
      ${reviewSection("Purpose", a.purpose)}
      ${reviewSection("Vision", a.vision)}
      ${reviewSection("Tagline", a.tagline)}
      ${reviewSection("Personality", a.personality.join(", "))}
      ${reviewSection("Values", a.values.join(", "))}
      ${reviewSection("Products / Services", a.productsServices.join(", "))}
      ${!Object.values(a).some((v) => (Array.isArray(v) ? v.length : v)) ? `<p class="text-faint" style="font-size:12.5px;padding:12px 0;">Nothing filled in yet — go Back to answer a few questions.</p>` : ""}
    </div>
    <div class="flex items-center justify-between">
      <button type="button" class="btn btn-secondary" id="wiz-back">${icon("chevronLeft", { size: 14 })}Back</button>
      <div class="flex gap-8">
        <button type="button" class="btn btn-secondary" id="wiz-pdf">${icon("download", { size: 14 })}Download PDF</button>
        <button type="button" class="btn btn-primary" id="wiz-save">${icon("check", { size: 15 })}Save Brand DNA</button>
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
    updateBrand(brandId, { brandDNA: { ...state.answers } });
    toast("Brand DNA saved");
  });
  qs("#wiz-pdf", root).addEventListener("click", () => openBrandDnaPdf(brand, state.answers));
}

function openBrandDnaPdf(brand, answers) {
  const rows = [
    ["Customer", answers.targetAudience],
    ["Problem", answers.problemSolved],
    ["Why you understand them", answers.positioning],
    ["Why choose you", answers.differentiation],
    ["Plan", answers.mission],
    ["Call to action", answers.callToAction],
    ["If they say yes", answers.successOutcome],
    ["If they do nothing", answers.failureOutcome],
    ["Purpose", answers.purpose],
    ["Vision", answers.vision],
  ].filter(([, v]) => v);
  const listRows = [
    ["Personality", answers.personality],
    ["Values", answers.values],
    ["Products / Services", answers.productsServices],
  ].filter(([, v]) => v.length);

  const overlay = openModal({
    title: "Brand DNA — PDF Preview",
    wide: true,
    bodyHTML: `
      <div class="report-preview-wrap"><div class="report-sheet" id="dna-report-sheet">
        <div class="report-header">
          <div>
            <div class="report-brand">${escapeHtml(brand.name)}</div>
            <div class="report-title">Brand DNA${answers.tagline ? ` — ${escapeHtml(answers.tagline)}` : ""}</div>
          </div>
        </div>
        ${rows.map(([label, value]) => `<div class="report-section-title">${label}</div><p style="font-size:13.5px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(value)}</p>`).join("")}
        ${listRows.map(([label, list]) => `<div class="report-section-title">${label}</div><p style="font-size:13.5px;line-height:1.6;">${list.map(escapeHtml).join(" · ")}</p>`).join("")}
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
