import { getBrand, updateBrand } from "../store.js";
import { qs, qsa, escapeHtml, toast } from "../dom.js";
import { icon } from "../icons.js";
import { COLOR_FEELINGS, PERSONALITY_PROFILES, TONE_AXES, toneAxisLabel, toneExampleMessage } from "../brandbook-data.js";

// The Brand Builder hub — Phase 1 of turning brand setup into one guided,
// stage-by-stage flow instead of two disconnected wizards (Brand DNA for
// Foundation, Brand Guidelines for Color/Typography/Logo/Visual Direction).
// Most of these 12 conceptual stages already have a real home; this view is
// mainly a status stepper that routes to wherever each stage's UI actually
// lives, plus the one genuinely new stage this phase introduces
// (Personality). Existing "Brand DNA"/"Brand Guidelines" nav entries are
// left alone — this is an additional entry point for now, not a
// replacement, per the phased plan.
const STAGES = [
  { key: "foundation", label: "Brand Foundation", desc: "Purpose, audience, masalah, positioning — di Brand DNA.", href: (id) => `#/brand/${id}/dna`, status: foundationStatus },
  { key: "personality", label: "Brand Personality", desc: "Karakter brand kamu, biar konsisten ke semua keputusan lain.", internal: true, status: personalityStatus },
  { key: "positioning", label: "Positioning", desc: "Kenapa mereka harus pilih kamu — bagian dari Brand DNA.", href: (id) => `#/brand/${id}/dna`, status: positioningStatus },
  { key: "naming", label: "Naming", desc: "Bantu mikirin nama brand.", soon: true },
  { key: "tagline", label: "Tagline", desc: "Bisa diisi di Brand DNA — generator 3-pendekatan nyusul.", href: (id) => `#/brand/${id}/dna`, status: taglineStatus },
  { key: "color", label: "Color System", desc: "Palet warna berdasarkan karakter brand — di Brand Guidelines.", href: (id) => `#/brand/${id}/guidelines`, status: colorStatus },
  { key: "typography", label: "Typography", desc: "Pasangan font sesuai karakter — di Brand Guidelines.", href: (id) => `#/brand/${id}/guidelines`, status: typographyStatus },
  { key: "logo", label: "Logo", desc: "Upload atau tandai belum punya — di Brand Guidelines.", href: (id) => `#/brand/${id}/guidelines`, status: logoStatus },
  { key: "visualDirection", label: "Visual Direction", desc: "Gaya visual keseluruhan — di Brand Guidelines.", href: (id) => `#/brand/${id}/guidelines`, status: visualDirectionStatus },
  { key: "toneOfVoice", label: "Tone of Voice", desc: "Cara brand ngomong — 4 spektrum, langsung ada contoh pesannya.", internal: true, status: toneOfVoiceStatus },
  { key: "imagery", label: "Imagery Style", desc: "Gaya foto/visual konten — otomatis dari Visual Direction, di Brand Guidelines.", href: (id) => `#/brand/${id}/guidelines`, status: visualDirectionStatus },
  { key: "guidelines", label: "Brand Guidelines Document", desc: "Dokumen lengkapnya — hasil dari semua tahap di atas.", href: (id) => `#/brand/${id}/guidelines`, status: guidelinesDocStatus },
];

function filledCount(fields) {
  return fields.filter((v) => (Array.isArray(v) ? v.length : !!v)).length;
}
function foundationStatus(brand) {
  const dna = brand.brandDNA || {};
  const fields = [dna.purpose, dna.vision, dna.mission, dna.targetAudience, dna.problemSolved, dna.positioning];
  const n = filledCount(fields);
  return n === 0 ? "todo" : n === fields.length ? "done" : "progress";
}
function personalityStatus(brand) {
  return brand.brandBuilder?.personality?.primary?.length ? "done" : "todo";
}
function positioningStatus(brand) {
  const dna = brand.brandDNA || {};
  const n = filledCount([dna.positioning, dna.differentiation]);
  return n === 2 ? "done" : n === 1 ? "progress" : "todo";
}
function taglineStatus(brand) {
  return brand.brandDNA?.tagline ? "done" : "todo";
}
function toneOfVoiceStatus(brand) {
  return brand.brandBuilder?.toneOfVoice?.source ? "done" : "todo";
}
function colorStatus(brand) {
  const g = brand.brandGuidelines || {};
  return g.colors?.primary ? "done" : g.colorFeelings?.length ? "progress" : "todo";
}
function typographyStatus(brand) {
  const g = brand.brandGuidelines || {};
  return g.fonts?.primary && g.fonts?.secondary ? "done" : g.typographyFeelings?.length ? "progress" : "todo";
}
function logoStatus(brand) {
  const l = brand.brandGuidelines?.logo || {};
  if (l.hasLogo === false || (l.hasLogo === true && l.dataUrl)) return "done";
  return l.hasLogo === true ? "progress" : "todo";
}
function visualDirectionStatus(brand) {
  return brand.brandGuidelines?.visualDirection?.length ? "done" : "todo";
}
function guidelinesDocStatus(brand) {
  const all = [colorStatus, typographyStatus, logoStatus, visualDirectionStatus].map((f) => f(brand));
  if (all.every((s) => s === "done")) return "done";
  return all.some((s) => s !== "todo") ? "progress" : "todo";
}

const STATUS_LABEL = { done: "Selesai", progress: "Berjalan", todo: "Belum mulai", soon: "Segera hadir" };

export function render(root, { brandId, stage }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  if (stage === "personality") paintPersonality(root, brandId, brand);
  else if (stage === "toneOfVoice") paintToneOfVoice(root, brandId, brand);
  else paintHub(root, brand);
  return () => {};
}

function paintHub(root, brand) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Brand Builder</div>
        <h1>${escapeHtml(brand.name)}</h1>
        <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">Alur terpandu buat nyusun identitas brand kamu tahap demi tahap — mulai dari fondasi sampai jadi Brand Guidelines lengkap. Boleh keluar-masuk kapan aja, progress tersimpan otomatis di tiap tahap.</p>
      </div>
    </div>
    <div class="bb-stage-grid">
      ${STAGES.map((s, i) => stageCardHTML(s, i, brand)).join("")}
    </div>
  `;
  qsa("[data-soon]", root).forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      toast("Tahap ini belum tersedia — nyusul ya.");
    });
  });
}

function stageCardHTML(s, i, brand) {
  const status = s.soon ? "soon" : s.status(brand);
  const href = s.soon ? "#" : s.internal ? `#/brand/${brand.id}/builder/${s.key}` : s.href(brand.id);
  return `
    <a class="card card-tight bb-stage-card bb-stage-${status}" href="${href}" ${s.soon ? "data-soon" : ""}>
      <div class="bb-stage-num">${status === "done" ? icon("check", { size: 13 }) : i + 1}</div>
      <div class="bb-stage-body">
        <div class="bb-stage-label">${escapeHtml(s.label)}</div>
        <div class="bb-stage-desc">${escapeHtml(s.desc)}</div>
      </div>
      <div class="bb-stage-status bb-stage-status-${status}">${STATUS_LABEL[status]}</div>
    </a>
  `;
}

// ---------- Personality stage ----------
function paintPersonality(root, brandId, brand) {
  const saved = brand.brandBuilder.personality;
  const state = {
    feeling: saved.feeling || "",
    primary: [...(saved.primary || [])],
    secondary: [...(saved.secondary || [])],
    avoid: [...(saved.avoid || [])],
  };

  function refresh() {
    const profile = state.feeling ? PERSONALITY_PROFILES[state.feeling] : null;
    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-eyebrow"><a href="#/brand/${brand.id}/builder" style="color:inherit;">${icon("chevronLeft", { size: 11 })} Brand Builder</a> · Personality</div>
          <h1>Brand Personality</h1>
          <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">Anggap brand kamu kayak orang — punya karakter yang konsisten di semua hal, dari warna sampai cara ngomong. Pilih karakter utamanya, nanti direkomendasiin sifat-sifat yang cocok (dan yang sebaiknya dihindari).</p>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div style="font-size:12.5px;font-weight:700;margin-bottom:10px;">Karakter utama brand kamu</div>
        <div class="bb-chip-row">${COLOR_FEELINGS.map(
          (f) => `<label class="checkbox-chip"><input type="radio" name="pb-feeling" data-feeling value="${f}" ${state.feeling === f ? "checked" : ""} />${f}</label>`
        ).join("")}</div>
      </div>
      ${
        profile
          ? `
      <div class="card" style="margin-bottom:16px;">
        <div class="flex items-center justify-between" style="margin-bottom:12px;">
          <span style="font-size:12.5px;font-weight:700;">Rekomendasi buat "${escapeHtml(state.feeling)}"</span>
          <button type="button" class="btn btn-secondary btn-sm" id="pb-reset">${icon("refresh", { size: 12 })}Pakai rekomendasi lagi</button>
        </div>
        ${traitListHTML("primary", "Sifat utama", state.primary)}
        ${traitListHTML("secondary", "Sifat pendukung", state.secondary)}
        ${traitListHTML("avoid", "Sebaiknya dihindari", state.avoid)}
      </div>
      <button type="button" class="btn btn-primary" id="pb-save">${icon("check", { size: 14 })}Simpan Personality</button>
      `
          : `<p class="text-faint" style="font-size:12.5px;">Pilih satu karakter di atas buat lihat rekomendasinya.</p>`
      }
    `;
    wire();
  }

  function traitListHTML(key, label, items) {
    return `
      <div class="field" style="margin-bottom:12px;">
        <label style="font-size:11.5px;">${label}</label>
        <div class="chip-list" id="pb-${key}-list">
          ${items.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-pb-remove="${key}" data-index="${i}" aria-label="Hapus">${icon("x", { size: 10 })}</button></span>`).join("")}
        </div>
        <div class="flex gap-8" style="margin-top:6px;">
          <input class="input" id="pb-${key}-new" placeholder="Tambah sifat lain..." style="flex:1;" />
          <button type="button" class="btn btn-secondary btn-sm" data-pb-add="${key}" aria-label="Tambah">${icon("plus", { size: 12 })}</button>
        </div>
      </div>
    `;
  }

  function applyProfile() {
    const profile = PERSONALITY_PROFILES[state.feeling];
    state.primary = [...profile.primary];
    state.secondary = [...profile.secondary];
    state.avoid = [...profile.avoid];
  }

  function wire() {
    qsa("[data-feeling]", root).forEach((el) =>
      el.addEventListener("change", () => {
        state.feeling = el.value;
        applyProfile();
        refresh();
      })
    );
    qs("#pb-reset", root)?.addEventListener("click", () => {
      applyProfile();
      refresh();
    });
    ["primary", "secondary", "avoid"].forEach((key) => {
      qsa(`[data-pb-remove="${key}"]`, root).forEach((btn) =>
        btn.addEventListener("click", () => {
          state[key].splice(Number(btn.dataset.index), 1);
          refresh();
        })
      );
      const addBtn = qs(`[data-pb-add="${key}"]`, root);
      const addField = () => {
        const input = qs(`#pb-${key}-new`, root);
        const v = input.value.trim();
        if (!v) return;
        state[key].push(v);
        refresh();
      };
      addBtn?.addEventListener("click", addField);
      qs(`#pb-${key}-new`, root)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); addField(); }
      });
    });
    qs("#pb-save", root)?.addEventListener("click", () => {
      const profile = PERSONALITY_PROFILES[state.feeling];
      const edited =
        JSON.stringify(state.primary) !== JSON.stringify(profile.primary) ||
        JSON.stringify(state.secondary) !== JSON.stringify(profile.secondary) ||
        JSON.stringify(state.avoid) !== JSON.stringify(profile.avoid);
      const completedStages = new Set(brand.brandBuilder.completedStages || []);
      completedStages.add("personality");
      updateBrand(brandId, {
        brandBuilder: {
          ...brand.brandBuilder,
          stage: "personality",
          completedStages: [...completedStages],
          personality: { feeling: state.feeling, primary: state.primary, secondary: state.secondary, avoid: state.avoid, source: edited ? "user" : "recommended" },
        },
      });
      toast("Brand Personality disimpan");
    });
  }

  refresh();
}

// ---------- Tone of Voice stage ----------
// 4 spectrum sliders instead of one free-text box — moving them updates a
// live rewrite of the e-book's own worked example (a store closing early
// for renovations) in real time, so the choice is felt, not just labeled.
function paintToneOfVoice(root, brandId, brand) {
  const saved = brand.brandBuilder.toneOfVoice || { formal: 50, language: 50, character: 50, emotion: 50, avoidWords: [] };
  const state = {
    formal: saved.formal ?? 50,
    language: saved.language ?? 50,
    character: saved.character ?? 50,
    emotion: saved.emotion ?? 50,
    avoidWords: [...(saved.avoidWords || [])],
  };

  function refresh() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-eyebrow"><a href="#/brand/${brand.id}/builder" style="color:inherit;">${icon("chevronLeft", { size: 11 })} Brand Builder</a> · Tone of Voice</div>
          <h1>Tone of Voice</h1>
          <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">Brand kamu udah punya wajah (logo) dan pakaian (warna/font). Sekarang: gimana cara dia ngomong? Geser tiap slider, lihat contoh pesannya berubah langsung di bawah.</p>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        ${TONE_AXES.map(
          (axis) => `
          <div style="margin-bottom:18px;">
            <div class="flex items-center justify-between" style="margin-bottom:6px;font-size:12.5px;font-weight:700;">
              <span>${axis.left}</span>
              <span style="color:var(--accent);">${escapeHtml(toneAxisLabel(axis, state[axis.key]))}</span>
              <span>${axis.right}</span>
            </div>
            <input type="range" min="0" max="100" value="${state[axis.key]}" data-tov-axis="${axis.key}" style="width:100%;accent-color:var(--accent);" />
          </div>
        `
        ).join("")}
      </div>
      <div class="card card-tight" style="margin-bottom:16px;">
        <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;">Contoh — brand kamu lagi kasih tahu toko tutup lebih awal hari ini</div>
        <p style="font-size:13px;line-height:1.7;font-style:italic;margin:0;">${toneExampleMessage(state.formal, state.character)}</p>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="field" style="margin-bottom:0;">
          <label style="font-size:11.5px;">Kata/gaya yang dihindari (opsional)</label>
          <div class="chip-list" id="tov-avoid-list">
            ${state.avoidWords.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-tov-avoid-remove="${i}" aria-label="Hapus">${icon("x", { size: 10 })}</button></span>`).join("")}
          </div>
          <div class="flex gap-8" style="margin-top:6px;">
            <input class="input" id="tov-avoid-new" placeholder="misal: bahasa gaul berlebihan, jargon teknis..." style="flex:1;" />
            <button type="button" class="btn btn-secondary btn-sm" id="tov-avoid-add" aria-label="Tambah">${icon("plus", { size: 12 })}</button>
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-primary" id="tov-save">${icon("check", { size: 14 })}Simpan Tone of Voice</button>
    `;
    wire();
  }

  function wire() {
    qsa("[data-tov-axis]", root).forEach((el) =>
      el.addEventListener("input", () => {
        state[el.dataset.tovAxis] = Number(el.value);
        refresh();
      })
    );
    qsa("[data-tov-avoid-remove]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        state.avoidWords.splice(Number(btn.dataset.tovAvoidRemove), 1);
        refresh();
      })
    );
    const addWord = () => {
      const input = qs("#tov-avoid-new", root);
      const v = input.value.trim();
      if (!v) return;
      state.avoidWords.push(v);
      refresh();
    };
    qs("#tov-avoid-add", root)?.addEventListener("click", addWord);
    qs("#tov-avoid-new", root)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addWord(); }
    });
    qs("#tov-save", root)?.addEventListener("click", () => {
      const completedStages = new Set(brand.brandBuilder.completedStages || []);
      completedStages.add("toneOfVoice");
      updateBrand(brandId, {
        brandBuilder: {
          ...brand.brandBuilder,
          completedStages: [...completedStages],
          toneOfVoice: { formal: state.formal, language: state.language, character: state.character, emotion: state.emotion, avoidWords: state.avoidWords, source: "user" },
        },
      });
      toast("Tone of Voice disimpan");
    });
  }

  refresh();
}
