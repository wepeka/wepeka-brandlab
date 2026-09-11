import {
  getBrand, listContent, createContent, onChange, getSettings,
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign, campaignPhaseCoverage,
  CAMPAIGN_OBJECTIVES, CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS, CAMPAIGN_PHASE_TEMPLATE,
  MISSION_LADDERS, createMissionsForTemplate, milestoneStatus, missionCanAdvance, missionState,
  EVENT_ROLES, EVENT_PARTICIPATION_TYPES, EVENT_SETUP_FIELDS, EVENT_OBJECTIVES, EVENT_STATUS_LABELS, EVENT_PLAN_TERMS, EVENT_SCALE_TIERS,
  eventScaleFor, eventPhaseTemplatesForRole, buildEventPhases, eventMilestoneStatus,
  organicViews, combinedViewsWithAds,
} from "../store.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog, promptDialog } from "../modals.js";
import { toast, formatNumber, linesToList, listToLines, qs, qsa } from "../dom.js";
import { generateCampaignPlan, suggestPhaseContent, brainstormCampaignIdeas, AiApiError, hasAiKey } from "../ai.js";
import { computeContentMetrics } from "../formulas.js";
import { openContentEditor } from "./content-editor.js";

// Reuses the existing status-pill color classes (defined for Content's own
// idea/draft/production/editing/scheduled/published/archived vocabulary)
// instead of adding new CSS for a second status vocabulary — the color
// association (grey/blue/gold/green) still reads sensibly for a campaign's
// own planning → active → completed → archived lifecycle.
const CAMPAIGN_STATUS_PILL_CLASS = { planning: "status-draft", active: "status-scheduled", completed: "status-published", archived: "status-archived" };

export function render(root, { brandId, campaignId }) {
  const state = { expandedPhaseId: null, missionIndex: null, eventPhaseIndex: null };
  const refresh = () => paint(root, brandId, campaignId, state, refresh);
  refresh();
  return onChange(refresh);
}

function paint(root, brandId, campaignId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  if (campaignId) {
    const campaign = getCampaign(campaignId);
    if (!campaign) {
      location.hash = `#/brand/${brandId}/campaigns`;
      return;
    }
    paintDetail(root, brandId, brand, campaign, state, refresh);
    return;
  }
  paintList(root, brandId, brand, refresh);
}

// ---------- List view ----------

function paintList(root, brandId, brand, refresh) {
  const campaigns = listCampaigns(brandId);
  const content = listContent(brandId);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Campaigns</div>
        <h1>${brand.name}</h1>
      </div>
      <button class="btn btn-primary" id="new-campaign">${icon("plus", { size: 16 })}New Campaign</button>
    </div>
    <p class="page-sub" style="margin-bottom:24px;">What this brand is working toward right now — Content gets linked to a campaign and a journey phase to show which goal it's actually serving.</p>
    ${
      campaigns.length
        ? `<div class="brand-grid">${campaigns.map((c) => campaignCard(brandId, c, content)).join("")}</div>`
        : `<div class="content-view-card" style="max-width:420px;cursor:default;">
             <div class="icon-wrap">${icon("target", { size: 22 })}</div>
             <h3>No campaigns yet</h3>
             <p>Create one to give a batch of content a shared goal, message, and journey — AI can draft the whole thing from one sentence about what you want to achieve.</p>
           </div>`
    }
  `;

  qs("#new-campaign").addEventListener("click", () => openNewCampaignFlow({ brandId, onSaved: refresh }));
  qsa("[data-open-campaign]", root).forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-menu-toggle]") || e.target.closest(".menu")) return;
      location.hash = `#/brand/${brandId}/campaigns/${card.dataset.openCampaign}`;
    });
  });
  qsa("[data-menu-toggle]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      qsa(".menu").forEach((m) => m.remove());
      const id = btn.dataset.id;
      const rect = btn.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.className = "menu";
      menu.style.top = rect.bottom + 6 + "px";
      menu.style.left = Math.min(rect.left, window.innerWidth - 190) + "px";
      menu.innerHTML = `
        <button data-act="edit">${icon("edit", { size: 15 })}Edit</button>
        <div class="menu-divider"></div>
        <button data-act="delete" class="danger">${icon("trash", { size: 15 })}Delete</button>
      `;
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
      menu.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const act = ev.target.closest("[data-act]")?.dataset.act;
        if (!act) return;
        menu.remove();
        const campaign = getCampaign(id);
        if (act === "edit") {
          openCampaignModal({ brandId, campaign, onSaved: refresh });
        } else if (act === "delete") {
          const linkedCount = content.filter((c) => c.campaignId === id).length;
          const ok = await confirmDialog({
            title: "Delete this campaign?",
            message: linkedCount
              ? `${linkedCount} content item(s) are linked to it — they'll stay, just unlinked from this campaign. This cannot be undone.`
              : "This cannot be undone.",
            confirmLabel: "Delete",
            danger: true,
          });
          if (ok) {
            deleteCampaign(id);
            toast("Campaign deleted");
          }
        }
      });
    });
  });
}

function campaignCard(brandId, campaign, allContent) {
  const linked = allContent.filter((c) => c.campaignId === campaign.id);
  const organic = linked.reduce((s, c) => s + (organicViews(c) || 0), 0);
  const combined = linked.reduce((s, c) => s + (combinedViewsWithAds(c) || 0), 0);
  const coverage = campaignPhaseCoverage(campaign, allContent);
  return `
    <div class="brand-card" data-open-campaign="${campaign.id}" style="cursor:pointer;">
      <button class="icon-btn card-menu" data-menu-toggle data-id="${campaign.id}" aria-label="Campaign actions" style="width:30px;height:30px;">${icon("dots", { size: 15 })}</button>
      <div class="flex items-center gap-8" style="margin-bottom:12px;">
        <span class="tag">${CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] || campaign.objective}</span>
        <span class="status-pill ${CAMPAIGN_STATUS_PILL_CLASS[campaign.status] || ""}"><span class="status-dot"></span>${CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</span>
      </div>
      <h3>${escapeText(campaign.name || "Untitled campaign")}</h3>
      <div class="meta" style="margin-bottom:10px;">${coverage.filled}/${coverage.total} phases underway · ${linked.length} content item${linked.length === 1 ? "" : "s"}</div>
      ${
        linked.length
          ? `<div class="kv" style="padding:6px 0;"><span class="k">Organic views</span><span class="v">${formatNumber(organic)}</span></div>
             <div class="kv" style="padding:6px 0;border-bottom:none;"><span class="k">Combined (+ ads)</span><span class="v">${formatNumber(combined)}</span></div>`
          : ""
      }
    </div>
  `;
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// ---------- New campaign intake (AI-first, manual fallback) ----------

// The 3 optional phases (Website/Event/Community) depend on infrastructure
// not every brand has — asked fresh for every campaign (not remembered on
// the brand) since a brand's situation can change between campaigns.
const OPTIONAL_PHASE_QUESTIONS = [
  { key: "website", phaseName: "Website", question: "Sudah punya atau berencana bikin website?" },
  { key: "event", phaseName: "Event", question: "Ada rencana bikin event?" },
  { key: "community", phaseName: "Community", question: "Ada rencana bangun community?" },
];

// The 3 goals almost everyone actually starts with — pick one, name it,
// done. No goal essay, no AI call: the phase set is decided deterministically
// (reusing CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES, the same map the
// detailed flow's objective picker uses) the instant the campaign is
// created. AI's job starts one step later — inside a phase, helping write
// content ideas that actually match this brand's voice — not drafting the
// campaign's own strategy copy nobody asked for.
const CAMPAIGN_QUICK_TEMPLATES = [
  { id: "grow-social", label: "Grow Social Media", objective: "awareness", icon: "chart", description: "Nambah followers dan awareness lewat konten organik." },
  { id: "grow-personal", label: "Grow Personal Branding", objective: "personal-branding", icon: "target", description: "Bangun personal brand kamu — dikenal dan dipercaya dulu." },
  { id: "event", label: "Event", objective: "event", icon: "calendar", description: "Bangun momentum dan kehadiran buat satu acara." },
];

function openNewCampaignFlow({ brandId, onSaved }) {
  const brand = getBrand(brandId);

  const overlay = openModal({
    title: "New Campaign",
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Pilih salah satu, kasih nama campaign-nya, langsung jadi — fase-fasenya udah disesuaikan otomatis buat goal ini.</p>
      <div class="content-view-grid">
        ${CAMPAIGN_QUICK_TEMPLATES.map((t) => `
          <button type="button" class="content-view-card" data-quick-template="${t.id}">
            <div class="icon-wrap">${icon(t.icon, { size: 20 })}</div>
            <h3>${t.label}</h3>
            <p>${t.description}</p>
          </button>
        `).join("")}
        <button type="button" class="content-view-card" disabled style="opacity:.5;cursor:not-allowed;">
          <div class="icon-wrap">${icon("edit", { size: 20 })}</div>
          <h3>Custom</h3>
          <p>Coming soon</p>
        </button>
      </div>
    `,
  });

  qsa("[data-quick-template]", overlay).forEach((btn) => {
    btn.addEventListener("click", () => {
      const template = CAMPAIGN_QUICK_TEMPLATES.find((t) => t.id === btn.dataset.quickTemplate);
      closeOverlay(overlay);
      // Event doesn't fit the Mission ladder contract at all (role-branching
      // setup, date-anchored non-blocking phases, dynamic targets) — it's a
      // separate intake entirely, only sharing the Terms gate mechanism.
      if (template.id === "event") {
        openCampaignTerms({
          template,
          ladder: { terms: EVENT_PLAN_TERMS },
          onAgree: () => openEventRoleSelect({ brandId, brand, template, onSaved }),
        });
        return;
      }
      const ladder = MISSION_LADDERS[template.id];
      const toCalibration = () => {
        if (ladder?.calibration) {
          openMissionCalibration({
            template,
            ladder,
            onContinue: ({ startIndex }) => finishQuickCampaign({ brandId, brand, template, startIndex, onSaved }),
          });
        } else {
          finishQuickCampaign({ brandId, brand, template, onSaved });
        }
      };
      if (ladder?.terms) {
        openCampaignTerms({ template, ladder, onAgree: toCalibration });
      } else {
        toCalibration();
      }
    });
  });

  qs("#open-custom-flow", overlay)?.addEventListener("click", () => {
    closeOverlay(overlay);
    openCustomCampaignFlow({ brandId, onSaved });
  });
}

// A real Terms & Conditions gate — scroll to the bottom before the "I've
// read this" checkbox even becomes clickable, same pattern apps use for
// agreements people actually need to have seen once. Only shown for
// templates whose MISSION_LADDERS entry declares `terms`.
function openCampaignTerms({ template, ladder, onAgree }) {
  const { terms } = ladder;
  const overlay = openModal({
    title: `${template.label} — Syarat & Ketentuan`,
    wide: true,
    bodyHTML: `
      ${terms.intro ? `<p class="text-muted" style="font-size:13px;margin:0 0 14px;">${escapeText(terms.intro)}</p>` : ""}
      <div id="terms-scroll" style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md);padding:16px 18px;">
        ${terms.rules
          .map(
            (r, i) => `
          <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:var(--text-muted);">
            <strong style="color:var(--text);display:block;margin-bottom:2px;">${i + 1}. ${escapeText(r.title)}</strong>
            ${escapeText(r.body)}
          </p>`
          )
          .join("")}
        <div style="height:1px;"></div>
      </div>
      <label class="checkbox-chip" id="terms-agree-label" style="margin-top:14px;opacity:.4;pointer-events:none;">
        <input type="checkbox" id="terms-agree" disabled />
        Saya udah baca dan setuju sama syarat & ketentuan ini
      </label>
      <p class="text-faint" id="terms-scroll-hint" style="font-size:11px;margin:6px 0 0;">Scroll sampai bawah dulu buat bisa centang.</p>
    `,
    footHTML: `<button class="btn btn-primary" id="terms-continue" disabled>Lanjut</button>`,
  });

  const scrollBox = qs("#terms-scroll", overlay);
  const checkbox = qs("#terms-agree", overlay);
  const agreeLabel = qs("#terms-agree-label", overlay);
  const continueBtn = qs("#terms-continue", overlay);
  const hint = qs("#terms-scroll-hint", overlay);

  function unlockAgree() {
    checkbox.disabled = false;
    agreeLabel.style.opacity = "1";
    agreeLabel.style.pointerEvents = "auto";
    hint.style.display = "none";
  }
  function checkScrolled() {
    if (scrollBox.scrollTop + scrollBox.clientHeight >= scrollBox.scrollHeight - 12) unlockAgree();
  }
  scrollBox.addEventListener("scroll", checkScrolled);
  // Short content that never needs scrolling shouldn't block on a scroll
  // event that'll never fire.
  if (scrollBox.scrollHeight <= scrollBox.clientHeight + 4) unlockAgree();

  checkbox.addEventListener("change", () => {
    continueBtn.disabled = !checkbox.checked;
  });
  continueBtn.addEventListener("click", () => {
    closeOverlay(overlay);
    onAgree();
  });
}

// One quick question before a Quick Template creates its campaign: has
// this ground already been covered? "Belum" skips straight to Mission 1
// (the default, still the recommended path even for "Sudah" — see
// skipNote). "Sudah" reveals the mission list itself as the picker, so
// someone genuinely further along doesn't have to re-clear early rungs —
// but nothing here scales targets; the ladder is one fixed staircase.
function openMissionCalibration({ template, ladder, onContinue }) {
  const { calibration } = ladder;
  const missionPreviews = ladder.missions();
  const overlay = openModal({
    title: template.label,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${escapeText(calibration.question)}</p>
      <div class="flex gap-8" id="calib-step1" style="flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" id="calib-fresh">Belum, mulai dari Mission 1</button>
        <button type="button" class="btn btn-secondary btn-sm" id="calib-pick-open">Sudah, aku mau pilih mission-nya</button>
      </div>
      <div id="calib-step2" style="display:none;margin-top:18px;">
        <div class="hint" style="margin-bottom:12px;">${icon("info", { size: 12 })}<span>${escapeText(calibration.skipNote)}</span></div>
        <div class="chip-select" id="calib-mission-pick" style="flex-wrap:wrap;">
          ${missionPreviews.map((m, i) => `<button type="button" data-val="${i}">${escapeText(m.name)}</button>`).join("")}
        </div>
      </div>
    `,
    footHTML: `<button class="btn btn-primary" id="calib-continue" style="display:none;" disabled>Lanjut</button>`,
  });

  let startIndex = 0;
  qs("#calib-fresh", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    onContinue({ startIndex: 0 });
  });
  qs("#calib-pick-open", overlay).addEventListener("click", () => {
    qs("#calib-step1", overlay).style.display = "none";
    qs("#calib-step2", overlay).style.display = "block";
    qs("#calib-continue", overlay).style.display = "inline-flex";
  });
  qsa("#calib-mission-pick button", overlay).forEach((b) => {
    b.addEventListener("click", () => {
      startIndex = Number(b.dataset.val);
      qsa("#calib-mission-pick button", overlay).forEach((x) => x.classList.toggle("active", x === b));
      qs("#calib-continue", overlay).disabled = false;
    });
  });
  qs("#calib-continue", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    onContinue({ startIndex });
  });
}

async function finishQuickCampaign({ brandId, brand, template, startIndex, onSaved }) {
  const name = await promptDialog({
    title: template.label,
    label: "Nama campaign ini apa?",
    placeholder: template.label,
    confirmLabel: "Buat Campaign",
  });
  if (!name) return;
  const optionalDefaults = CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES[template.objective] || [];
  const phases = CAMPAIGN_PHASE_TEMPLATE.map((t) => ({
    id: t.name.toLowerCase(), name: t.name, goal: "", milestones: [],
    enabled: !t.optional || optionalDefaults.includes(t.name),
  }));
  const ladder = MISSION_LADDERS[template.id];
  const missions = createMissionsForTemplate(template.id, { startIndex });
  const created = createCampaign(brandId, {
    name, objective: template.objective, status: "planning",
    targetAudience: brand?.brandDNA?.targetAudience || "",
    phases,
    ...(missions ? { missions } : {}),
    ...(ladder?.autoLinkAllContent ? { autoLinkAllContent: true } : {}),
    ...(ladder?.progressionNote ? { missionProgressionNote: ladder.progressionNote } : {}),
  });
  toast(`"${name}" dibuat — AI bisa bantu isi konten per fase di dalam.`);
  onSaved?.();
  location.hash = `#/brand/${brandId}/campaigns/${created.id}`;
}

// ---------- Event Campaign intake (role → setup → generate) ----------
// The one question that decides everything downstream — which setup form
// shows next, and which whole milestone catalog the campaign gets.
function openEventRoleSelect({ brandId, brand, template, onSaved }) {
  const overlay = openModal({
    title: template.label,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Kamu berperan sebagai apa dalam event ini?</p>
      <div class="content-view-grid">
        ${EVENT_ROLES.map(
          (r) => `
          <button type="button" class="content-view-card" data-role="${r.id}">
            <h3>${escapeText(r.label)}</h3>
            <p>${escapeText(r.description)}</p>
          </button>`
        ).join("")}
      </div>
    `,
  });
  qsa("[data-role]", overlay).forEach((btn) => {
    btn.addEventListener("click", () => {
      closeOverlay(overlay);
      openEventSetupForm({ brandId, brand, template, role: btn.dataset.role, onSaved });
    });
  });
}

function eventFieldHTML(f) {
  const label = `${escapeText(f.label)}${f.optional ? " (opsional)" : ""}`;
  if (f.type === "textarea") {
    return `<div class="field"><label>${label}</label><textarea class="textarea" id="ef-${f.key}" style="min-height:52px;"></textarea></div>`;
  }
  if (f.type === "select") {
    return `<div class="field"><label>${label}</label><select class="select" id="ef-${f.key}">${f.options.map((o) => `<option value="${escapeAttr(o.id)}">${escapeText(o.label)}</option>`).join("")}</select></div>`;
  }
  return `<div class="field"><label>${label}</label><input class="input" id="ef-${f.key}" type="${f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}" /></div>`;
}

// Role-specific fields, straight from the spec, plus a multi-select
// objective chip group (organizer/tenant) or a participation-type select
// (participant — this one also decides which Event Day milestone set gets
// built below, not just cosmetic).
function openEventSetupForm({ brandId, brand, template, role, onSaved }) {
  const fields = EVENT_SETUP_FIELDS[role];
  const objectives = EVENT_OBJECTIVES[role];
  const roleLabel = EVENT_ROLES.find((r) => r.id === role)?.label || role;
  const overlay = openModal({
    title: `${template.label} — ${roleLabel}`,
    wide: true,
    bodyHTML: `
      ${
        role === "participant"
          ? `<div class="field">
               <label>Tipe partisipasi</label>
               <select class="select" id="ef-participationType">
                 ${EVENT_PARTICIPATION_TYPES.map((t) => `<option value="${t.id}">${escapeText(t.label)}</option>`).join("")}
               </select>
             </div>`
          : ""
      }
      ${fields.map(eventFieldHTML).join("")}
      ${
        objectives
          ? `<div class="field" style="margin-bottom:0;">
               <label>Main objective (bisa lebih dari satu)</label>
               <div class="chip-select" id="ef-objectives" style="flex-wrap:wrap;">
                 ${objectives.map((o) => `<button type="button" data-val="${escapeAttr(o)}">${escapeText(o)}</button>`).join("")}
               </div>
             </div>`
          : ""
      }
    `,
    footHTML: `<button class="btn btn-primary" id="ef-submit">Lanjut</button>`,
  });

  const selectedObjectives = new Set();
  qsa("#ef-objectives button", overlay).forEach((b) => {
    b.addEventListener("click", () => {
      b.classList.toggle("active");
      if (b.classList.contains("active")) selectedObjectives.add(b.dataset.val);
      else selectedObjectives.delete(b.dataset.val);
    });
  });

  qs("#ef-submit", overlay).addEventListener("click", () => {
    const setupValues = {};
    fields.forEach((f) => {
      const el = qs(`#ef-${f.key}`, overlay);
      setupValues[f.key] = el ? el.value.trim() : "";
    });
    const participationType = role === "participant" ? qs("#ef-participationType", overlay).value : "";
    closeOverlay(overlay);
    finishEventCampaign({ brandId, brand, template, role, setupValues, objectives: [...selectedObjectives], participationType, onSaved });
  });
}

async function finishEventCampaign({ brandId, brand, template, role, setupValues, objectives, participationType, onSaved }) {
  const eventName = setupValues.eventName || template.label;
  const eventDate = setupValues.eventDate || "";
  const campaignStartDate = setupValues.campaignStartDate || new Date().toISOString().slice(0, 10);
  const expectedAudienceRaw = setupValues.expectedAudience || setupValues.expectedVisitors || setupValues.expectedExposure || 0;
  const scale = eventScaleFor(expectedAudienceRaw);
  const phaseTemplates = eventPhaseTemplatesForRole(role, participationType);
  const phases = buildEventPhases(phaseTemplates, { eventDate, campaignStartDate, scaleId: scale.id });

  const optionalDefaults = CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES[template.objective] || [];
  const legacyPhases = CAMPAIGN_PHASE_TEMPLATE.map((t) => ({
    id: t.name.toLowerCase(), name: t.name, goal: "", milestones: [],
    enabled: !t.optional || optionalDefaults.includes(t.name),
  }));

  const created = createCampaign(brandId, {
    name: eventName, objective: template.objective, status: "planning",
    targetAudience: brand?.brandDNA?.targetAudience || setupValues.targetAudience || "",
    startDate: campaignStartDate, endDate: eventDate,
    phases: legacyPhases,
    autoLinkAllContent: true,
    eventPlan: { role, participationType: participationType || "", eventDate, scale: scale.id, setup: setupValues, objectives, phases },
  });
  toast(`"${eventName}" dibuat — timeline dan milestone-nya udah disusun (${scale.label.toLowerCase()} scale).`);
  onSaved?.();
  location.hash = `#/brand/${brandId}/campaigns/${created.id}`;
}

// The old, detailed intake (free-text goal + objective + channel-setup +
// AI-drafted strategy copy) — kept as an escape hatch for anyone who wants
// the fuller brief, one step behind the 3 quick templates above instead of
// being the first thing everyone sees.
function openCustomCampaignFlow({ brandId, onSaved }) {
  const brand = getBrand(brandId);
  const state = { objective: "awareness" };

  const overlay = openModal({
    title: "Custom Campaign",
    bodyHTML: `
      <div class="field">
        <label>What do you want to achieve with this campaign?</label>
        <textarea class="textarea" id="intake-goal" style="min-height:80px;" placeholder="e.g. Saya ingin launching produk baru"></textarea>
      </div>
      <div class="field">
        <label>Objective</label>
        <div class="chip-select" id="intake-objective">
          ${CAMPAIGN_OBJECTIVES.map((o) => `<button type="button" data-val="${o}" class="${o === "awareness" ? "active" : ""}">${CAMPAIGN_OBJECTIVE_LABELS[o]}</button>`).join("")}
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Social media used (optional)</label>
        <input class="input" id="intake-social" placeholder="e.g. Instagram, TikTok" />
      </div>

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">Channel setup</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">This decides which journey phases this campaign uses — the core funnel (Awareness, WhatsApp, UGC, Retargeting) always applies, these three are optional.</p>
      ${OPTIONAL_PHASE_QUESTIONS.map(
        (q) => `
        <label class="flex items-center gap-8" style="margin-bottom:12px;cursor:pointer;">
          <input type="checkbox" id="intake-${q.key}" />
          <span style="font-size:13px;">${q.question}</span>
        </label>`
      ).join("")}
      <div id="intake-phase-note" class="text-faint" style="font-size:11px;margin:-4px 0 12px;"></div>
      <div id="intake-status" style="margin-top:4px;"></div>
    `,
    footHTML: `
      <button class="btn btn-secondary" data-skip>Skip, fill in manually</button>
      <button class="btn btn-primary" data-generate>${icon("bot", { size: 15 })}Generate with AI</button>
    `,
    onMount: (el) => {
      setTimeout(() => el.querySelector("#intake-goal").focus(), 30);
      // Picking an objective already drives the AI prompt and the
      // campaign's label — extending it to also default the 3 optional
      // phases gets the "start from a sensible template" effect for free,
      // with one concept (Objective) instead of a separate template
      // picker. Still just a default: every checkbox stays editable after.
      function applyObjectiveDefaults(objective) {
        const defaults = CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES[objective];
        const noteEl = el.querySelector("#intake-phase-note");
        if (defaults === null || defaults === undefined) {
          noteEl.textContent = "";
          return;
        }
        OPTIONAL_PHASE_QUESTIONS.forEach((q) => {
          el.querySelector(`#intake-${q.key}`).checked = defaults.includes(q.phaseName);
        });
        noteEl.textContent = "Fase disesuaikan otomatis buat goal ini — bisa diubah lagi kapan saja.";
      }
      qsa("#intake-objective button", el).forEach((btn) => {
        btn.addEventListener("click", () => {
          state.objective = btn.dataset.val;
          qsa("#intake-objective button", el).forEach((b) => b.classList.toggle("active", b === btn));
          applyObjectiveDefaults(state.objective);
        });
      });
      applyObjectiveDefaults(state.objective);
    },
  });

  function readEnabledMap() {
    const map = {};
    OPTIONAL_PHASE_QUESTIONS.forEach((q) => { map[q.phaseName] = !!overlay.querySelector(`#intake-${q.key}`).checked; });
    return map;
  }

  overlay.querySelector("[data-skip]").addEventListener("click", () => {
    const initialEnabled = readEnabledMap();
    closeOverlay(overlay);
    openCampaignModal({ brandId, initialEnabled, onSaved });
  });

  overlay.querySelector("[data-generate]").addEventListener("click", async () => {
    const objectiveText = overlay.querySelector("#intake-goal").value.trim();
    const statusEl = overlay.querySelector("#intake-status");
    const genBtn = overlay.querySelector("[data-generate]");
    if (!objectiveText) {
      toast("Describe what you want to achieve first.", "error");
      return;
    }
    const ai = getSettings().ai || {};
    const hasKey = hasAiKey(ai);
    if (!hasKey) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">Add your AI API key in Settings → AI first, or use "Skip, fill in manually" below.</div>`;
      return;
    }
    const initialEnabled = readEnabledMap();
    const enabledPhases = CAMPAIGN_PHASE_TEMPLATE.filter((t) => !t.optional || initialEnabled[t.name]);
    const socialPlatforms = overlay.querySelector("#intake-social").value.split(",").map((s) => s.trim()).filter(Boolean);
    genBtn.disabled = true;
    statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Drafting your campaign…</span></div>`;
    try {
      const aiDraft = await generateCampaignPlan(ai, { brand, objectiveText, objective: state.objective, enabledPhases, socialPlatforms });
      closeOverlay(overlay);
      openCampaignModal({ brandId, objective: state.objective, aiDraft, initialEnabled, onSaved });
    } catch (e) {
      statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? e.message : "Couldn't reach the AI."}</span></div>`;
      genBtn.disabled = false;
    }
  });
}

// ---------- Create/edit modal ----------

function phaseTemplateInfo(phaseId) {
  return CAMPAIGN_PHASE_TEMPLATE.find((t) => t.name.toLowerCase() === phaseId) || { description: "", optional: false };
}

function openCampaignModal({ brandId, campaign = null, objective = null, aiDraft = null, initialEnabled = null, onSaved } = {}) {
  const draft = {
    name: campaign?.name ?? aiDraft?.name ?? "",
    objective: campaign?.objective ?? objective ?? "awareness",
    targetAudience: campaign?.targetAudience ?? aiDraft?.targetAudience ?? "",
    problemOrOpportunity: campaign?.problemOrOpportunity ?? aiDraft?.problemOrOpportunity ?? "",
    insight: campaign?.insight ?? aiDraft?.insight ?? "",
    bigIdea: campaign?.bigIdea ?? aiDraft?.bigIdea ?? "",
    keyMessage: campaign?.keyMessage ?? aiDraft?.keyMessage ?? "",
    offer: campaign?.offer ?? aiDraft?.offer ?? "",
    cta: campaign?.cta ?? aiDraft?.cta ?? "",
    channels: campaign?.channels ?? aiDraft?.channels ?? [],
    status: campaign?.status || "planning",
    startDate: campaign?.startDate || "",
    endDate: campaign?.endDate || "",
    phases:
      campaign?.phases ||
      CAMPAIGN_PHASE_TEMPLATE.map((t) => {
        const aiGoal = aiDraft?.phases?.find((p) => p.name.toLowerCase() === t.name.toLowerCase())?.goal || "";
        const enabled = !t.optional || !!initialEnabled?.[t.name];
        return { id: t.name.toLowerCase(), name: t.name, goal: aiGoal, enabled, milestones: [] };
      }),
  };

  const overlay = openModal({
    title: campaign ? "Edit Campaign" : "New Campaign",
    bodyHTML: `
      ${aiDraft ? `<div class="hint" style="margin:0 0 16px;">${icon("bot", { size: 12 })} AI-drafted from your goal — review and edit anything before saving.</div>` : ""}
      <div class="field">
        <label>Campaign name</label>
        <input class="input" id="c-name" placeholder="e.g. Back to School 2026" value="${escapeAttr(draft.name)}" />
      </div>
      <div class="row-2">
        <div class="field">
          <label>Objective</label>
          <select class="select" id="c-objective">
            ${CAMPAIGN_OBJECTIVES.map((o) => `<option value="${o}" ${draft.objective === o ? "selected" : ""}>${CAMPAIGN_OBJECTIVE_LABELS[o]}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select class="select" id="c-status">
            ${CAMPAIGN_STATUSES.map((s) => `<option value="${s}" ${draft.status === s ? "selected" : ""}>${CAMPAIGN_STATUS_LABELS[s]}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label>Target Audience <span class="text-faint" style="font-weight:400;">(leave blank to use the brand's own)</span></label>
        <textarea class="textarea" id="c-audience" style="min-height:60px;">${draft.targetAudience}</textarea>
      </div>
      <div class="field">
        <label>Problem / Opportunity</label>
        <textarea class="textarea" id="c-problem" style="min-height:60px;" placeholder="What's driving this campaign right now">${draft.problemOrOpportunity}</textarea>
      </div>
      <div class="field">
        <label>Insight</label>
        <textarea class="textarea" id="c-insight" style="min-height:60px;" placeholder="A truth about the audience this campaign leans on">${draft.insight}</textarea>
      </div>
      <div class="field">
        <label>Big Idea</label>
        <textarea class="textarea" id="c-bigidea" style="min-height:60px;">${draft.bigIdea}</textarea>
      </div>
      <div class="field">
        <label>Key Message</label>
        <textarea class="textarea" id="c-message" style="min-height:60px;" placeholder="The one thing every piece of content should communicate">${draft.keyMessage}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label>Offer</label>
          <input class="input" id="c-offer" value="${escapeAttr(draft.offer)}" />
        </div>
        <div class="field">
          <label>CTA</label>
          <input class="input" id="c-cta" placeholder="cth. Join now!" value="${escapeAttr(draft.cta)}" />
          <div class="hint" style="margin-top:4px;">${icon("info", { size: 12 })}<span>Bikin sesingkat mungkin (2-4 kata) — ini yang dipakai ulang di mana-mana: flyer, website, bio link, story sticker, dll.</span></div>
        </div>
      </div>
      <div class="field">
        <label>Channels (one per line)</label>
        <textarea class="textarea" id="c-channels" style="min-height:60px;" placeholder="e.g. Instagram Reels&#10;Email&#10;WhatsApp Broadcast">${listToLines(draft.channels)}</textarea>
      </div>
      <div class="row-2">
        <div class="field" style="margin-bottom:0;">
          <label>Start Date</label>
          <input class="input" type="date" id="c-start" value="${draft.startDate}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>End Date</label>
          <input class="input" type="date" id="c-end" value="${draft.endDate}" />
        </div>
      </div>

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">Campaign Journey</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">Every campaign runs through the same 7-step funnel — the optional ones can be switched off any time.</p>
      ${draft.phases
        .map((p, i) => {
          const info = phaseTemplateInfo(p.id);
          return `
        <div class="field">
          <div class="creator-field-head">
            <label style="margin-bottom:0;">Phase ${i + 1} — <input class="input" id="phase-name-${i}" style="display:inline;width:auto;padding:4px 8px;font-size:13px;" value="${escapeAttr(p.name)}" /></label>
            ${
              info.optional
                ? `<label class="checkbox-chip" style="padding:4px 10px;font-size:11px;"><input type="checkbox" id="phase-enabled-${i}" ${p.enabled ? "checked" : ""} />Include this phase</label>`
                : `<span class="text-faint" style="font-size:11px;">Always included</span>`
            }
          </div>
          <div class="text-faint" style="font-size:11.5px;margin-bottom:6px;">${escapeText(info.description)}</div>
          <textarea class="textarea" id="phase-goal-${i}" style="min-height:50px;" placeholder="What should this phase accomplish?">${p.goal}</textarea>
        </div>`;
        })
        .join("")}
    `,
    footHTML: `
      <button class="btn btn-secondary" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}Save</button>
    `,
    onMount: (el) => {
      setTimeout(() => el.querySelector("#c-name").focus(), 30);
    },
  });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-save]").addEventListener("click", () => {
    const nameInput = overlay.querySelector("#c-name");
    const name = nameInput.value.trim();
    if (!name) {
      toast("Give this campaign a name first.", "error");
      nameInput.focus();
      return;
    }
    const patch = {
      name,
      objective: overlay.querySelector("#c-objective").value,
      status: overlay.querySelector("#c-status").value,
      targetAudience: overlay.querySelector("#c-audience").value.trim(),
      problemOrOpportunity: overlay.querySelector("#c-problem").value.trim(),
      insight: overlay.querySelector("#c-insight").value.trim(),
      bigIdea: overlay.querySelector("#c-bigidea").value.trim(),
      keyMessage: overlay.querySelector("#c-message").value.trim(),
      offer: overlay.querySelector("#c-offer").value.trim(),
      cta: overlay.querySelector("#c-cta").value.trim(),
      channels: linesToList(overlay.querySelector("#c-channels").value),
      startDate: overlay.querySelector("#c-start").value,
      endDate: overlay.querySelector("#c-end").value,
      phases: draft.phases.map((p, i) => {
        const info = phaseTemplateInfo(p.id);
        const enabledInput = overlay.querySelector(`#phase-enabled-${i}`);
        return {
          id: p.id,
          name: overlay.querySelector(`#phase-name-${i}`).value.trim() || p.name,
          goal: overlay.querySelector(`#phase-goal-${i}`).value.trim(),
          enabled: info.optional ? !!enabledInput?.checked : true,
          milestones: p.milestones || [],
        };
      }),
    };
    if (campaign) {
      updateCampaign(campaign.id, patch);
      toast("Campaign updated");
    } else {
      createCampaign(brandId, patch);
      toast(`${name} created`);
    }
    closeOverlay(overlay);
    onSaved?.();
  });
}

function escapeAttr(v) {
  return (v || "").replace(/"/g, "&quot;");
}

// ---------- Detail view — interactive journey ----------

function paintDetail(root, brandId, brand, campaign, state, refresh) {
  const allContent = listContent(brandId);
  const linked = allContent.filter((c) => c.campaignId === campaign.id);
  const organic = linked.reduce((s, c) => s + (organicViews(c) || 0), 0);
  const combined = linked.reduce((s, c) => s + (combinedViewsWithAds(c) || 0), 0);

  const phaseData = campaign.phases.map((phase) => ({
    phase,
    items: linked.filter((c) => c.campaignPhaseId === phase.id),
  }));
  // "Active" (the glowing, in-progress node) only ever considers enabled
  // phases — a disabled phase (e.g. Website, not built yet) shouldn't be
  // mistaken for "next thing to do".
  const enabledData = phaseData.filter((pd) => pd.phase.enabled);
  const firstEmptyEnabled = enabledData.findIndex((pd) => !pd.items.length);
  const activePhaseId = enabledData.length
    ? (firstEmptyEnabled === -1 ? enabledData[enabledData.length - 1] : enabledData[firstEmptyEnabled]).phase.id
    : null;
  if (!state.expandedPhaseId) state.expandedPhaseId = activePhaseId || phaseData[0].phase.id;
  const expanded = phaseData.find((pd) => pd.phase.id === state.expandedPhaseId) || phaseData[0];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow"><a href="#/brand/${brandId}/campaigns" style="color:inherit;">Campaigns ←</a></div>
        <h1>${escapeText(campaign.name || "Untitled campaign")}</h1>
      </div>
      <button class="btn btn-secondary" id="edit-campaign">${icon("edit", { size: 14 })}Edit</button>
    </div>
    <div class="flex items-center gap-8" style="margin-bottom:20px;">
      <span class="tag">${CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] || campaign.objective}</span>
      <span class="status-pill ${CAMPAIGN_STATUS_PILL_CLASS[campaign.status] || ""}"><span class="status-dot"></span>${CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</span>
      ${campaign.keyMessage ? `<span class="text-faint" style="font-size:12.5px;">${escapeText(campaign.keyMessage)}</span>` : ""}
    </div>
    ${
      linked.length
        ? `<div class="stat-grid" style="margin-bottom:28px;">
             ${stat("Content Linked", linked.length)}
             ${stat("Organic Views", formatNumber(organic))}
             ${stat("Combined (+ ads)", formatNumber(combined))}
           </div>`
        : ""
    }

    ${
      campaign.eventPlan
        ? eventPlanSectionHTML(campaign, allContent, state)
        : campaign.missions?.length
        ? missionJourneySectionHTML(campaign, allContent, state)
        : `
      <div class="section-title" style="margin-top:0;"><h2>Campaign Journey</h2></div>
      <div class="journey-track">
        ${phaseData
          .map((pd, i) => {
            const node = journeyNodeHTML(pd, i, activePhaseId, state.expandedPhaseId);
            const connector = i < phaseData.length - 1 ? `<div class="journey-connector ${pd.phase.enabled && pd.items.length ? "filled" : ""}"></div>` : "";
            return node + connector;
          })
          .join("")}
      </div>
      <div id="journey-detail">${journeyDetailHTML(brandId, campaign, expanded)}</div>
    `
    }
  `;

  qs("#edit-campaign", root).addEventListener("click", () => openCampaignModal({ brandId, campaign, onSaved: refresh }));

  if (campaign.eventPlan) {
    if (state.eventPhaseIndex === null || state.eventPhaseIndex === undefined) state.eventPhaseIndex = currentEventPhaseIndex(campaign);
    wireEventPlan(root, brandId, brand, campaign, allContent, state, refresh);
  } else if (campaign.missions?.length) {
    if (state.missionIndex === null || state.missionIndex === undefined) state.missionIndex = currentMissionIndex(campaign);
    wireMissionJourney(root, brandId, brand, campaign, allContent, state, refresh);
  } else {
    qsa("[data-phase-node]", root).forEach((node) => {
      node.addEventListener("click", () => {
        state.expandedPhaseId = node.dataset.phaseNode;
        refresh();
      });
    });
    wireJourneyDetail(root, brandId, brand, campaign, expanded, refresh);
  }
}

// ---------- Missions (Quick Template campaigns only) ----------

function currentMissionIndex(campaign) {
  const missions = campaign.missions || [];
  const idx = missions.findIndex((m) => !m.completedAt);
  return idx === -1 ? Math.max(0, missions.length - 1) : idx;
}

function missionJourneySectionHTML(campaign, allContent, state) {
  const missions = campaign.missions;
  if (state.missionIndex === null || state.missionIndex === undefined) state.missionIndex = currentMissionIndex(campaign);
  const activeIndex = Math.min(state.missionIndex, missions.length - 1);
  const mission = missions[activeIndex];
  const statuses = mission.milestones.map((m) => resolveMilestoneStatus(m, campaign, allContent));
  const canAdvance = missionCanAdvance(mission, campaign, allContent);
  const st = missionState(campaign, activeIndex);
  const isLast = activeIndex === missions.length - 1;
  return `
    <div class="section-title" style="margin-top:0;"><h2>Campaign Journey</h2></div>
    ${
      campaign.autoLinkAllContent
        ? `<div class="hint" style="margin:-6px 0 14px;">${icon("info", { size: 12 })}<span>Campaign ini nggak punya batas waktu — semua konten yang kamu terbitkan buat brand ini otomatis kehitung di sini, nggak perlu di-link manual.</span></div>`
        : ""
    }
    ${
      campaign.missionProgressionNote
        ? `<div class="hint" style="margin:-6px 0 14px;">${icon("info", { size: 12 })}<span>${escapeText(campaign.missionProgressionNote)}</span></div>`
        : ""
    }
    ${missionLadderHTML(campaign, activeIndex)}
    <div class="mission-panel">
      <div class="mission-panel-head">
        <div>
          <div class="page-eyebrow">Mission ${activeIndex + 1}${st === "completed" ? " · Selesai" : ""}${mission.tagline ? ` · ${escapeText(mission.tagline)}` : ""}</div>
          <h3 style="margin:2px 0 4px;">${escapeText(mission.name)}</h3>
          <p class="text-muted" style="font-size:13px;margin:0;">${escapeText(mission.description)}</p>
        </div>
        <div class="flex gap-8" style="flex:none;">
          <button type="button" class="btn btn-secondary btn-sm glow" id="brainstorm-content" style="--glow-color: color-mix(in srgb, var(--accent) 55%, transparent);">${icon("bulb", { size: 13 })}Brainstorm Konten</button>
          ${
            st === "current"
              ? `<button type="button" class="btn btn-primary btn-sm" id="mission-advance" ${canAdvance ? "" : "disabled"}>${isLast ? "Selesaikan Campaign" : "Next Mission"}${icon("check", { size: 13 })}</button>`
              : st === "completed"
              ? `<span class="status-pill status-published"><span class="status-dot"></span>Selesai</span>`
              : ""
          }
        </div>
      </div>
      ${missionTreeHTML(mission, statuses)}
      ${
        st === "locked"
          ? `<div class="hint" style="margin-bottom:8px;">${icon("info", { size: 12 })}<span>Kamu lagi intip mission berikutnya — boleh atur milestone-nya dari sekarang (tambah, hapus, ubah target), tapi progress-nya baru bisa dicatat setelah giliran mission ini beneran sampai.</span></div>`
          : `<div class="page-eyebrow" style="margin-bottom:8px;">Jalankan semua misi di bawah untuk lanjut ke level berikutnya</div>`
      }
      <div class="mission-milestone-list" id="mission-milestones">
        ${mission.milestones.map((m, i) => milestoneRowHTML(m, statuses[i], i, st === "locked")).join("")}
      </div>
      ${
        st === "current" || st === "locked"
          ? `<div class="flex gap-8" style="margin-top:10px;">
               <input class="input" id="milestone-new" placeholder="Tambah milestone kamu sendiri..." style="flex:1;" />
               <button type="button" class="btn btn-secondary btn-sm" id="milestone-add">${icon("plus", { size: 13 })}Tambah</button>
             </div>`
          : ""
      }
      ${
        st === "current" && !canAdvance
          ? `<div class="hint" style="margin-top:10px;">${icon("info", { size: 12 })}<span>Isi angka atau centang semua milestone dulu buat lanjut ke mission berikutnya — nggak harus sudah kena target, yang penting sudah dicatat.</span></div>`
          : ""
      }
    </div>
  `;
}

function missionLadderHTML(campaign, activeIndex) {
  const missions = campaign.missions;
  return `
    <div class="mission-ladder">
      ${missions
        .map((m, i) => {
          const st = missionState(campaign, i);
          const locked = st === "locked";
          const connector = i > 0 ? `<div class="mission-connector ${missionState(campaign, i - 1) === "completed" ? "filled" : ""}"></div>` : "";
          return `
        ${connector}
        <button type="button" class="mission-badge ${st} ${i === activeIndex ? "active" : ""}" data-mission-index="${i}" title="${locked ? `Lihat & atur milestone-nya lebih dulu — progress baru bisa dicatat setelah Mission ${i} selesai` : escapeAttr(m.name)}">
          <span class="mission-badge-dot">${st === "completed" ? icon("check", { size: 12 }) : locked ? icon("lock", { size: 11 }) : i + 1}</span>
          <span class="mission-badge-label">${escapeText(m.name)}</span>
        </button>`;
        })
        .join("")}
    </div>
  `;
}

// Node x/y live in a fixed 1000×460 space (matches the .mission-tree
// aspect-ratio) — outer milestones sit low, the middle one arcs up, so an
// N-node mission always reads as a small canopy branching off one trunk,
// not a straight row. Every mission in MISSION_LADDERS has exactly 3
// milestones today, but this holds for 1-4 just as well.
function missionNodePos(i, n) {
  const x = n === 1 ? 500 : 150 + (700 * i) / (n - 1);
  const t = n === 1 ? 0.5 : i / (n - 1);
  const y = 300 - Math.sin(Math.PI * t) * 150;
  return { x, y };
}

// Engagement rate lives in formulas.js, which store.js can't import
// (formulas.js already imports METRIC_KEYS from store.js — importing back
// would cycle) — so "auto-er-count" milestones get their real current/
// metTarget computed here in the view layer instead of in store.js's
// milestoneStatus (which just stubs this kind as a harmless non-blocker).
function resolveMilestoneStatus(m, campaign, content) {
  if (m.kind !== "auto-er-count") return milestoneStatus(m, campaign, content);
  const settings = getSettings();
  const relevant = campaign.autoLinkAllContent ? content : content.filter((c) => c.campaignId === campaign.id);
  const current = relevant.filter((c) => {
    if (c.status !== "published") return false;
    const er = computeContentMetrics(c, settings).engagementRate;
    return er !== null && er >= (m.threshold ?? 10);
  }).length;
  return { current, logged: true, metTarget: current >= (m.target || 1) };
}

// "logged" is trivially always true for "auto" kind (it's always
// computable) — that's the right signal for gating advancement, but the
// wrong one for "has this actually started" visually. A fresh auto
// milestone with 0 content linked should read as empty, not amber.
function missionNodeStarted(m, s) {
  return m.kind === "auto" ? s.current > 0 : s.logged;
}
function missionNodeColor(m, s) {
  return s.metTarget ? "var(--health-good)" : missionNodeStarted(m, s) ? "var(--health-average)" : "var(--border)";
}

function missionNodeTextColor(m, s) {
  return s.metTarget || missionNodeStarted(m, s) ? "var(--bg)" : "var(--text-faint)";
}

function fmtUnit(value, unit) {
  return unit === "%" ? `${value}%` : `${value}${unit ? " " + unit : ""}`;
}

// 0..1 — how far into its own target this milestone is. "check" has no
// partial state (it either happened or it didn't); "auto"/"number" read
// current against target. This drives the node's progress ring/branch fill
// below, not just a flat "in progress" color.
function missionNodeProgress(m, s) {
  if (m.kind === "check") return s.done ? 1 : 0;
  if (!m.target) return s.logged ? 1 : 0;
  return Math.max(0, Math.min(1, s.current / m.target));
}

function missionProgressText(m, s) {
  if (m.kind === "auto") return `${s.current}/${m.target}${m.unit ? " " + m.unit : ""}`;
  if (m.kind === "check") return s.done ? "Selesai" : "Belum terjadi";
  return s.logged ? `${s.current}/${m.target}${m.unit ? " " + m.unit : ""}` : `Belum diisi (target ${fmtUnit(m.target, m.unit)})`;
}

// Every milestone gets its own branch — the tree is the map, the numbered
// list below is the legend. Nodes carry only a rung number (or a check once
// met) rather than their label text, since a mission can have up to 16
// milestones and text at that density just collides; matching numbers is
// how a branch and its row in the list identify each other. A partially-
// filled milestone reads as an actual loading ring/partial branch fill
// (proportional to current/target) instead of a flat "in progress" amber,
// so the tree shows how close each one is, not just started-vs-not.
function missionTreeHTML(mission, statuses) {
  const n = mission.milestones.length;
  const trunk = { x: 500, y: 380 };
  const nodes = mission.milestones.map((m, i) => ({ ...missionNodePos(i, n), m, s: statuses[i], i, pct: missionNodeProgress(m, statuses[i]) }));

  // Every branch always has a faint full-length track, so the tree's shape
  // reads even before anything's been touched — the colored fill on top is
  // the actual progress, growing from trunk to node as pct climbs.
  const branchTracks = nodes
    .map((nd) => {
      const midY = (trunk.y + nd.y) / 2;
      return `<path d="M${trunk.x},${trunk.y} C ${trunk.x},${midY} ${nd.x},${midY} ${nd.x},${nd.y}" fill="none" stroke="var(--border)" stroke-width="4" stroke-linecap="round" opacity=".35"/>`;
    })
    .join("");
  const branchFills = nodes
    .map((nd) => {
      if (nd.pct <= 0) return "";
      const midY = (trunk.y + nd.y) / 2;
      const c = nd.pct >= 1 ? "var(--health-good)" : "var(--health-average)";
      const loading = nd.pct < 1 ? "mission-loading" : "";
      return `<path d="M${trunk.x},${trunk.y} C ${trunk.x},${midY} ${nd.x},${midY} ${nd.x},${nd.y}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${(100 * (1 - nd.pct)).toFixed(1)}" class="${loading}"/>`;
    })
    .join("");
  const halos = nodes
    .map((nd) => {
      if (nd.pct < 1) return "";
      return `<circle cx="${nd.x}" cy="${nd.y}" r="20" fill="var(--health-good)" class="mission-halo" opacity=".7"/>`;
    })
    .join("");
  // Every node dot carries something — full (check + solid fill), partial
  // (a radial ring showing exactly how far along it is, mid-fill), or empty
  // (dim, just its rung number) — instead of one flat "in progress" state.
  const RING_R = 11;
  const RING_CIRC = 2 * Math.PI * RING_R;
  const cores = nodes
    .map((nd) => {
      if (nd.pct >= 1) {
        return `
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="var(--health-good)"/>
      <g transform="translate(${nd.x - 6},${nd.y - 6}) scale(0.5)" fill="none" stroke="var(--bg)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></g>`;
      }
      if (nd.pct > 0) {
        const offset = RING_CIRC * (1 - nd.pct);
        return `
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="var(--surface-2)" stroke="var(--border)" stroke-width="2"/>
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="none" stroke="var(--health-average)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${RING_CIRC.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 ${nd.x} ${nd.y})" class="mission-loading"/>
      <text x="${nd.x}" y="${nd.y}" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="800" fill="var(--text)">${nd.i + 1}</text>`;
      }
      return `
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="var(--border)"/>
      <text x="${nd.x}" y="${nd.y}" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="800" fill="var(--text-faint)">${nd.i + 1}</text>`;
    })
    .join("");
  // No visible label here on purpose — with up to 16 branches, text at
  // every node just collides. The node is still a real hover/focus target;
  // a custom hover/focus bubble (CSS-driven, see .mission-node[data-tooltip])
  // carries the label, live progress (e.g. "Followers — 300/1000") and full
  // explanation — richer than the native title tooltip could show.
  const nodeButtons = nodes
    .map(
      (nd) => `
      <div class="mission-node" data-milestone-index="${nd.i}" tabindex="0" role="note" data-tooltip="${escapeAttr(`${nd.i + 1}. ${nd.m.label} — ${missionProgressText(nd.m, nd.s)}${nd.m.description ? `\n${nd.m.description}` : ""}`)}" style="left:${(nd.x / 10).toFixed(1)}%;top:${((nd.y / 460) * 100).toFixed(1)}%;"></div>`
    )
    .join("");
  return `
    <div class="mission-tree">
      <svg viewBox="0 0 1000 460" role="img" aria-label="Diagram mission ${escapeAttr(mission.name)}">
        <path d="M500,440 C 470,452 440,455 410,450" stroke="var(--border)" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M500,440 C 530,452 560,455 590,450" stroke="var(--border)" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M500,440 L500,380" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" opacity=".5"/>
        ${branchTracks}
        ${branchFills}
        ${halos}
        ${cores}
      </svg>
      ${nodeButtons}
    </div>
  `;
}

function milestoneRowHTML(m, s, i, lockedPreview = false) {
  const pillState = s.metTarget ? "good" : missionNodeStarted(m, s) ? "avg" : "empty";
  const pillLabel =
    m.kind === "check"
      ? s.logged
        ? "Selesai"
        : "Belum dicentang"
      : m.kind === "number"
      ? s.logged
        ? s.metTarget
          ? "Target tercapai"
          : "Tercatat"
        : "Perlu diisi"
      : s.metTarget
      ? "Selesai"
      : s.current > 0
      ? "Berjalan"
      : "Belum mulai";
  let control;
  if (m.kind === "auto") {
    control = `<span class="mono">${s.current} / ${m.target} ${escapeText(m.unit)}</span>`;
  } else if (m.kind === "auto-er-count") {
    // Read-only — computed from published content's real engagement rate,
    // never typed in by hand.
    control = `<span class="mono">${s.current} / ${m.target} ${escapeText(m.unit)}</span> <span class="text-faint" style="font-size:11px;">(ER ≥ ${m.threshold}%)</span>`;
  } else if (m.kind === "check") {
    control = `<label class="checkbox-chip"><input type="checkbox" data-milestone-check="${i}" ${m.done ? "checked" : ""} ${lockedPreview ? "disabled" : ""} />Sudah terjadi</label>`;
  } else {
    control = `<div class="flex items-center gap-8">
      <input type="number" class="input" data-milestone-number="${i}" value="${m.value ?? ""}" min="0" placeholder="${lockedPreview ? "Belum giliran mission ini" : "Isi angka asli"}" style="width:100px;display:inline-block;" ${lockedPreview ? "disabled" : ""} />
      <span class="text-faint" style="font-size:11.5px;">target ${m.target}${m.unit ? " " + escapeText(m.unit) : ""}</span>
      <button type="button" class="icon-btn" data-milestone-edit-target="${i}" title="Ubah target" style="width:22px;height:22px;">${icon("edit", { size: 11 })}</button>
    </div>`;
  }
  // The number here is the same one on its tree branch — that's the only
  // way to tell which branch a row belongs to once the tree stops labeling
  // nodes with text.
  return `
    <div class="mission-milestone-row" data-milestone-index="${i}">
      <div class="mm-num" style="background:${missionNodeColor(m, s)};color:${missionNodeTextColor(m, s)};">${s.metTarget ? icon("check", { size: 11 }) : i + 1}</div>
      <div>
        <div class="mm-label">${escapeText(m.label)}</div>
        ${m.description ? `<div class="mm-desc">${escapeText(m.description)}</div>` : ""}
      </div>
      <div class="mm-control">${control}</div>
      <div class="mm-pill" data-state="${pillState}">${pillLabel}</div>
      <button type="button" class="icon-btn" data-milestone-remove="${i}" title="Hapus milestone" style="width:24px;height:24px;">${icon("x", { size: 12 })}</button>
    </div>
  `;
}

function wireMissionJourney(root, brandId, brand, campaign, allContent, state, refresh) {
  function saveMissions(missions) {
    updateCampaign(campaign.id, { missions });
  }

  qsa("[data-mission-index]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.missionIndex = Number(btn.dataset.missionIndex);
      refresh();
    });
  });

  qsa("[data-milestone-check]", root).forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.milestoneCheck);
      const missions = campaign.missions.map((m, mi) =>
        mi !== state.missionIndex ? m : { ...m, milestones: m.milestones.map((ms, i) => (i === idx ? { ...ms, done: cb.checked } : ms)) }
      );
      saveMissions(missions);
      refresh();
    });
  });

  qsa("[data-milestone-number]", root).forEach((input) => {
    const commit = () => {
      const idx = Number(input.dataset.milestoneNumber);
      const raw = input.value.trim();
      // Cumulative totals can't go negative — clamp instead of just
      // rejecting, so a stray "-" typo doesn't just silently do nothing.
      const value = raw === "" ? null : Math.max(0, Number(raw) || 0);
      const missions = campaign.missions.map((m, mi) =>
        mi !== state.missionIndex ? m : { ...m, milestones: m.milestones.map((ms, i) => (i === idx ? { ...ms, value } : ms)) }
      );
      saveMissions(missions);
      refresh();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  });

  qsa("[data-milestone-edit-target]", root).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.milestoneEditTarget);
      const m = campaign.missions[state.missionIndex].milestones[idx];
      const raw = await promptDialog({ title: "Ubah target", label: m.label, placeholder: String(m.target ?? ""), confirmLabel: "Simpan" });
      if (!raw) return;
      const target = Math.max(1, Math.round(Number(raw) || 0));
      const missions = campaign.missions.map((mm, mi) =>
        mi !== state.missionIndex ? mm : { ...mm, milestones: mm.milestones.map((ms, i) => (i === idx ? { ...ms, target } : ms)) }
      );
      saveMissions(missions);
      refresh();
    });
  });

  qsa("[data-milestone-remove]", root).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.milestoneRemove);
      const mission = campaign.missions[state.missionIndex];
      const ok = await confirmDialog({ title: "Hapus milestone ini?", message: `"${mission.milestones[idx].label}" akan dihapus dari mission ini.`, confirmLabel: "Hapus", danger: true });
      if (!ok) return;
      const missions = campaign.missions.map((mm, mi) =>
        mi !== state.missionIndex ? mm : { ...mm, milestones: mm.milestones.filter((_, i) => i !== idx) }
      );
      saveMissions(missions);
      refresh();
    });
  });

  qs("#mission-advance", root)?.addEventListener("click", () => {
    const mission = campaign.missions[state.missionIndex];
    if (!missionCanAdvance(mission, campaign, allContent)) return;
    let missions = campaign.missions.map((m, i) => (i === state.missionIndex ? { ...m, completedAt: Date.now() } : m));
    const next = missions[state.missionIndex + 1];
    if (next) {
      // Numbers here are cumulative totals, not deltas — carry the just-
      // completed mission's recorded value forward as the next mission's
      // starting point (matched by label, since the same metric — e.g.
      // "Followers" — repeats across every level) so nobody has to retype
      // the same running total at every rung.
      const carriedMilestones = next.milestones.map((ms) => {
        if (ms.kind !== "number") return ms;
        const prev = mission.milestones.find((pm) => pm.kind === "number" && pm.label === ms.label);
        return prev && prev.value !== null && prev.value !== undefined ? { ...ms, value: prev.value } : ms;
      });
      missions = missions.map((m, i) => (i === state.missionIndex + 1 ? { ...next, milestones: carriedMilestones } : m));
    }
    saveMissions(missions);
    toast(next ? `"${mission.name}" selesai — lanjut ke "${next.name}"` : "Semua mission selesai — objective campaign ini tercapai!");
    if (next) state.missionIndex = state.missionIndex + 1;
    refresh();
  });

  qs("#milestone-add", root)?.addEventListener("click", () => {
    const input = qs("#milestone-new", root);
    const label = input.value.trim();
    if (!label) return;
    const missions = campaign.missions.map((m, mi) =>
      mi !== state.missionIndex
        ? m
        : {
            ...m,
            milestones: [
              ...m.milestones,
              { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: "check", phaseId: null, label, unit: "", target: null, highlight: false, custom: true, value: null, done: false },
            ],
          }
    );
    saveMissions(missions);
    refresh();
  });
  qs("#milestone-new", root)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") qs("#milestone-add", root)?.click();
  });

  qs("#brainstorm-content", root)?.addEventListener("click", () => {
    openBrainstormModal({ brandId, brand, campaign, mission: campaign.missions[state.missionIndex], onSaved: refresh });
  });

  qsa("[data-milestone-index]", root).forEach((el) => {
    el.addEventListener("mouseenter", () => {
      qsa(`[data-milestone-index="${el.dataset.milestoneIndex}"]`, root).forEach((x) => x.classList.add("is-synced"));
    });
    el.addEventListener("mouseleave", () => {
      qsa(`[data-milestone-index="${el.dataset.milestoneIndex}"]`, root).forEach((x) => x.classList.remove("is-synced"));
    });
  });
}

// "Brainstorm Konten" — for campaigns whose content isn't bucketed into a
// specific phase (Grow Social Media's every-post-counts ladder has none),
// this is the whole intake: AI-suggested ideas scoped to the campaign's
// current mission, or a plain title+note typed by hand — either way it
// saves immediately as a status:"idea" content item (same instant-save
// pattern as "Use this idea" elsewhere in this file), landing in Content
// OS / Creator's Drafting list with nothing else required.
function openBrainstormModal({ brandId, brand, campaign, mission, onSaved }) {
  let savedCount = 0;
  const overlay = openModal({
    title: "Brainstorm Konten",
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 14px;">Ide buat "${escapeText(campaign.name)}"${mission ? ` — fokus ke mission "${escapeText(mission.name)}" yang lagi jalan` : ""}. Cuma judul + catatan singkat, langsung masuk Ideas di Creator.</p>
      <button type="button" class="btn btn-secondary btn-sm" id="brainstorm-ai">${icon("bot", { size: 13 })}Minta AI kasih ide</button>
      <div id="brainstorm-ai-status" style="margin-top:10px;"></div>
      <div id="brainstorm-ai-ideas" style="margin-top:4px;"></div>
      <div class="divider" style="margin:18px 0;"></div>
      <div class="page-eyebrow" style="margin-bottom:10px;">Atau tulis ide sendiri</div>
      <div class="field">
        <input class="input" id="bs-title" placeholder="Judul ide" />
      </div>
      <div class="field" style="margin-bottom:10px;">
        <textarea class="textarea" id="bs-idea" style="min-height:56px;" placeholder="Catatan singkat (opsional)"></textarea>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="bs-add-manual">${icon("plus", { size: 13 })}Simpan sebagai Ide</button>
    `,
    footHTML: `<button class="btn btn-secondary" id="brainstorm-done">Selesai</button>`,
  });

  qs("#brainstorm-ai", overlay).addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    const statusEl = qs("#brainstorm-ai-status", overlay);
    const hasKey = hasAiKey(ai);
    if (!hasKey) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">Tambahin API key AI dulu di Settings → AI.</div>`;
      return;
    }
    const aiBtn = qs("#brainstorm-ai", overlay);
    aiBtn.disabled = true;
    statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Mikirin ide...</span></div>`;
    try {
      const existingTitles = listContent(brandId)
        .filter((c) => c.campaignId === campaign.id)
        .map((c) => c.title)
        .filter(Boolean);
      const { ideas } = await brainstormCampaignIdeas(ai, { brand, campaign, mission, existingTitles });
      statusEl.innerHTML = "";
      qs("#brainstorm-ai-ideas", overlay).innerHTML = ideas.map((idea, i) => brainstormIdeaCardHTML(idea, i)).join("");
      qsa("[data-use-brainstorm-idea]", overlay).forEach((btn) => {
        btn.addEventListener("click", () => {
          const idea = ideas[Number(btn.dataset.useBrainstormIdea)];
          createContent(brandId, { campaignId: campaign.id, title: idea.title, idea: idea.angle, status: "idea" });
          savedCount++;
          btn.textContent = "Tersimpan ✓";
          btn.disabled = true;
        });
      });
    } catch (e) {
      statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e.message}</span></div>`;
    } finally {
      aiBtn.disabled = false;
    }
  });

  qs("#bs-add-manual", overlay).addEventListener("click", () => {
    const titleEl = qs("#bs-title", overlay);
    const ideaEl = qs("#bs-idea", overlay);
    const title = titleEl.value.trim();
    if (!title) {
      toast("Isi judulnya dulu.", "error");
      return;
    }
    createContent(brandId, { campaignId: campaign.id, title, idea: ideaEl.value.trim(), status: "idea" });
    savedCount++;
    toast(`"${title}" disimpan ke Ideas.`);
    titleEl.value = "";
    ideaEl.value = "";
    titleEl.focus();
  });

  qs("#brainstorm-done", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    onSaved?.();
    if (savedCount > 0) location.hash = `#/brand/${brandId}/content-os/creator`;
  });
}

function brainstormIdeaCardHTML(idea, i) {
  return `
    <div class="card card-tight" style="margin-bottom:8px;padding:12px;">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:3px;">${escapeText(idea.title)}</div>
      <div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">${escapeText(idea.angle)}${idea.format ? ` · ${escapeText(idea.format)}` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-use-brainstorm-idea="${i}">${icon("plus", { size: 12 })}Simpan sebagai Ide</button>
    </div>
  `;
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

// ---------- Event Campaign detail page (date-anchored, non-blocking) ----------

const EVENT_CATEGORY_LABELS = { AWARENESS: "Awareness", CONTENT: "Content", CONVERSION: "Conversion", ENGAGEMENT: "Engagement", ATTENDANCE: "Attendance", IMPACT: "Impact" };

function eventStatusColor(status) {
  if (status === "completed") return "var(--health-good)";
  if (status === "missed") return "var(--health-poor)";
  if (status === "in_progress" || status === "partially_completed") return "var(--health-average)";
  if (status === "not_applicable") return "var(--surface-2)";
  return "var(--border)";
}

// Default to whichever phase's date window contains today — not "the
// first unfinished one," since nothing here is sequential.
function currentEventPhaseIndex(campaign) {
  const phases = campaign.eventPlan.phases;
  const now = Date.now();
  const idx = phases.findIndex((p) => now >= new Date(p.dateFrom + "T00:00:00").getTime() && now <= new Date(p.dateTo + "T23:59:59").getTime());
  if (idx !== -1) return idx;
  if (now < new Date(phases[0].dateFrom + "T00:00:00").getTime()) return 0;
  return phases.length - 1;
}

function eventPlanSectionHTML(campaign, allContent, state) {
  const { eventPlan } = campaign;
  const phases = eventPlan.phases;
  if (state.eventPhaseIndex === null || state.eventPhaseIndex === undefined) state.eventPhaseIndex = currentEventPhaseIndex(campaign);
  const activeIndex = Math.min(state.eventPhaseIndex, phases.length - 1);
  const phase = phases[activeIndex];
  const statuses = phase.milestones.map((m) => eventMilestoneStatus(m, phase, allContent));
  const roleLabel = EVENT_ROLES.find((r) => r.id === eventPlan.role)?.label || eventPlan.role;
  const scaleLabel = EVENT_SCALE_TIERS.find((t) => t.id === eventPlan.scale)?.label || eventPlan.scale;
  return `
    <div class="section-title" style="margin-top:0;"><h2>Event Timeline</h2></div>
    <div class="hint" style="margin:-6px 0 14px;">${icon("info", { size: 12 })}<span>${escapeText(roleLabel)}${eventPlan.eventDate ? ` · Event: ${escapeText(eventPlan.eventDate)}` : ""} · Skala ${escapeText(scaleLabel)}. Fase di bawah nggak saling kunci — event punya tanggal fix, jadi kamu tetap bisa lanjut ke fase berikutnya meskipun target fase sebelumnya belum tercapai.</span></div>
    <div class="event-timeline">
      ${phases.map((p, i) => eventPhasePillHTML(p, i, allContent, i === activeIndex)).join("")}
    </div>
    <div class="mission-panel">
      <div class="mission-panel-head">
        <div>
          <div class="page-eyebrow">${escapeText(phase.dateLabel)}</div>
          <h3 style="margin:2px 0 4px;">${escapeText(phase.name)}</h3>
        </div>
        <div class="flex gap-8" style="flex:none;">
          <button type="button" class="btn btn-secondary btn-sm glow" id="brainstorm-content" style="--glow-color: color-mix(in srgb, var(--accent) 55%, transparent);">${icon("bulb", { size: 13 })}Brainstorm Konten</button>
        </div>
      </div>
      <div class="mission-milestone-list" id="event-milestones">
        ${phase.milestones.map((m, i) => eventMilestoneRowHTML(m, statuses[i], i)).join("")}
      </div>
      <div class="flex gap-8" style="margin-top:10px;">
        <button type="button" class="btn btn-secondary btn-sm" id="event-add-milestone">${icon("plus", { size: 13 })}Tambah Milestone Khusus</button>
      </div>
    </div>
    ${eventFinalScoreHTML(campaign, allContent)}
  `;
}

function eventPhasePillHTML(phase, i, allContent, active) {
  const statuses = phase.milestones.map((m) => eventMilestoneStatus(m, phase, allContent));
  const relevant = statuses.filter((s, idx) => phase.milestones[idx].required && s.status !== "not_applicable");
  const allDone = relevant.length > 0 && relevant.every((s) => s.status === "completed");
  const anyMissed = relevant.some((s) => s.status === "missed");
  const anyProgress = relevant.some((s) => s.status === "in_progress" || s.status === "partially_completed" || s.status === "completed");
  const pillStatus = allDone ? "completed" : anyMissed ? "missed" : anyProgress ? "in_progress" : "not_started";
  return `
    <button type="button" class="event-phase-pill status-${pillStatus} ${active ? "active" : ""}" data-event-phase-index="${i}">
      <span class="event-phase-name">${escapeText(phase.name)}</span>
      <span class="event-phase-date">${escapeText(phase.dateLabel)}</span>
    </button>
  `;
}

function eventMilestoneRowHTML(m, s, i) {
  let control;
  if (m.kind === "auto") {
    control = `<span class="mono">${s.current} / ${m.target ?? "–"} ${escapeText(m.unit)}</span>`;
  } else if (m.kind === "check") {
    control = `<label class="checkbox-chip"><input type="checkbox" data-event-check="${i}" ${m.done ? "checked" : ""} ${m.notApplicable ? "disabled" : ""} />Sudah terjadi</label>`;
  } else {
    control = `<input type="number" class="input" data-event-number="${i}" value="${m.value ?? ""}" min="0" placeholder="Isi angka asli" style="width:100px;display:inline-block;" ${m.notApplicable ? "disabled" : ""} />`;
  }
  const statusLabel = EVENT_STATUS_LABELS[s.status] || s.status;
  return `
    <div class="mission-milestone-row event-milestone-row" data-milestone-index="${i}">
      <div class="mm-num" style="background:${eventStatusColor(s.status)};">${s.status === "completed" ? icon("check", { size: 11 }) : i + 1}</div>
      <div>
        <div class="mm-label">${escapeText(m.label)}${m.required ? "" : ` <span class="text-faint" style="font-weight:500;">(opsional)</span>`}</div>
        ${m.description ? `<div class="mm-desc">${escapeText(m.description)}</div>` : ""}
      </div>
      <div class="mm-control">
        <div class="flex items-center gap-8">
          ${control}
          ${m.kind !== "check" ? `<button type="button" class="icon-btn" data-event-edit-target="${i}" title="Ubah target" style="width:22px;height:22px;">${icon("edit", { size: 11 })}</button>` : ""}
        </div>
        ${m.target !== null ? `<div class="text-faint" style="font-size:11px;margin-top:3px;">target ${m.target}${m.unit ? " " + escapeText(m.unit) : ""} · ${s.achievementPct ?? 0}%${m.isSystemTarget ? ` · <span class="event-sys-tag">rekomendasi sistem</span>` : ""}</div>` : ""}
      </div>
      <div class="mm-pill event-status-pill" data-state="${s.status}">${statusLabel}</div>
      <div class="flex gap-6">
        <button type="button" class="icon-btn" data-event-na="${i}" title="${m.notApplicable ? "Tandai relevan lagi" : "Tandai nggak relevan"}" style="width:24px;height:24px;">${icon(m.notApplicable ? "refresh" : "x", { size: 12 })}</button>
        ${m.custom ? `<button type="button" class="icon-btn" data-event-remove="${i}" title="Hapus milestone" style="width:24px;height:24px;">${icon("trash", { size: 12 })}</button>` : ""}
      </div>
    </div>
  `;
}

function eventFinalScoreHTML(campaign, allContent) {
  const totals = {};
  Object.keys(EVENT_CATEGORY_LABELS).forEach((c) => (totals[c] = { target: 0, actual: 0, count: 0 }));
  campaign.eventPlan.phases.forEach((phase) => {
    phase.milestones.forEach((m) => {
      if (m.notApplicable || !m.target || !totals[m.category]) return;
      const s = eventMilestoneStatus(m, phase, allContent);
      totals[m.category].target += m.target;
      totals[m.category].actual += Math.min(s.current, m.target * 3);
      totals[m.category].count++;
    });
  });
  const tiles = Object.entries(totals)
    .filter(([, v]) => v.count > 0)
    .map(([cat, v]) => {
      const pct = v.target ? Math.round((v.actual / v.target) * 100) : 0;
      return `<div class="stat"><div class="label">${EVENT_CATEGORY_LABELS[cat]}</div><div class="value">${pct}%</div><div class="text-faint" style="font-size:11px;">${formatNumber(v.actual)} / ${formatNumber(v.target)}</div></div>`;
    })
    .join("");
  if (!tiles) return "";
  return `
    <div class="section-title"><h2>Final Campaign Score</h2></div>
    <div class="stat-grid">${tiles}</div>
  `;
}

function wireEventPlan(root, brandId, brand, campaign, allContent, state, refresh) {
  function savePhases(phases) {
    updateCampaign(campaign.id, { eventPlan: { ...campaign.eventPlan, phases } });
  }
  function activeMilestones() {
    return campaign.eventPlan.phases[state.eventPhaseIndex].milestones;
  }

  qsa("[data-event-phase-index]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.eventPhaseIndex = Number(btn.dataset.eventPhaseIndex);
      refresh();
    });
  });

  qsa("[data-event-check]", root).forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.eventCheck);
      const phases = campaign.eventPlan.phases.map((p, pi) =>
        pi !== state.eventPhaseIndex ? p : { ...p, milestones: p.milestones.map((m, i) => (i === idx ? { ...m, done: cb.checked } : m)) }
      );
      savePhases(phases);
      refresh();
    });
  });

  qsa("[data-event-number]", root).forEach((input) => {
    const commit = () => {
      const idx = Number(input.dataset.eventNumber);
      const raw = input.value.trim();
      const value = raw === "" ? null : Math.max(0, Number(raw) || 0);
      const phases = campaign.eventPlan.phases.map((p, pi) =>
        pi !== state.eventPhaseIndex ? p : { ...p, milestones: p.milestones.map((m, i) => (i === idx ? { ...m, value } : m)) }
      );
      savePhases(phases);
      refresh();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  });

  qsa("[data-event-na]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.eventNa);
      const phases = campaign.eventPlan.phases.map((p, pi) =>
        pi !== state.eventPhaseIndex ? p : { ...p, milestones: p.milestones.map((m, i) => (i === idx ? { ...m, notApplicable: !m.notApplicable } : m)) }
      );
      savePhases(phases);
      refresh();
    });
  });

  qsa("[data-event-remove]", root).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.eventRemove);
      const m = activeMilestones()[idx];
      const ok = await confirmDialog({ title: "Hapus milestone ini?", message: `"${m.label}" akan dihapus dari fase ini.`, confirmLabel: "Hapus", danger: true });
      if (!ok) return;
      const phases = campaign.eventPlan.phases.map((p, pi) => (pi !== state.eventPhaseIndex ? p : { ...p, milestones: p.milestones.filter((_, i) => i !== idx) }));
      savePhases(phases);
      refresh();
    });
  });

  qsa("[data-event-edit-target]", root).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.eventEditTarget);
      const m = activeMilestones()[idx];
      const raw = await promptDialog({ title: "Ubah target", label: m.label, placeholder: String(m.target ?? ""), confirmLabel: "Simpan" });
      if (!raw) return;
      const target = Math.max(1, Math.round(Number(raw) || 0));
      const phases = campaign.eventPlan.phases.map((p, pi) =>
        pi !== state.eventPhaseIndex ? p : { ...p, milestones: p.milestones.map((mm, i) => (i === idx ? { ...mm, target, isSystemTarget: false } : mm)) }
      );
      savePhases(phases);
      refresh();
    });
  });

  qs("#event-add-milestone", root)?.addEventListener("click", () => {
    openCustomEventMilestone({ campaign, phaseIndex: state.eventPhaseIndex, onSaved: refresh });
  });

  qs("#brainstorm-content", root)?.addEventListener("click", () => {
    openBrainstormModal({ brandId, brand, campaign, mission: null, onSaved: refresh });
  });

  qsa("[data-milestone-index]", root).forEach((el) => {
    el.addEventListener("mouseenter", () => {
      qsa(`[data-milestone-index="${el.dataset.milestoneIndex}"]`, root).forEach((x) => x.classList.add("is-synced"));
    });
    el.addEventListener("mouseleave", () => {
      qsa(`[data-milestone-index="${el.dataset.milestoneIndex}"]`, root).forEach((x) => x.classList.remove("is-synced"));
    });
  });
}

// The fuller custom-milestone form Event needs (vs. Missions' single text
// input) — a milestone here needs a category (it feeds Final Campaign
// Score), a phase (since phases carry the real dates), and a required flag.
function openCustomEventMilestone({ campaign, phaseIndex, onSaved }) {
  const phases = campaign.eventPlan.phases;
  const overlay = openModal({
    title: "Tambah Milestone Khusus",
    bodyHTML: `
      <div class="field"><label>Nama milestone</label><input class="input" id="cm-name" placeholder='cth. "Ajak 20 komunitas lokal share event ini"' /></div>
      <div class="field"><label>Deskripsi (opsional)</label><textarea class="textarea" id="cm-desc" style="min-height:50px;"></textarea></div>
      <div class="field"><label>Kategori</label><select class="select" id="cm-category">${Object.entries(EVENT_CATEGORY_LABELS)
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join("")}</select></div>
      <div class="flex gap-8">
        <div class="field" style="flex:1;"><label>Target</label><input class="input" type="number" id="cm-target" min="0" value="1" /></div>
        <div class="field" style="flex:1;"><label>Unit</label><input class="input" id="cm-unit" placeholder="cth. kolaborasi" /></div>
      </div>
      <div class="field"><label>Fase (deadline)</label><select class="select" id="cm-phase">${phases
        .map((p, i) => `<option value="${i}" ${i === phaseIndex ? "selected" : ""}>${escapeText(p.name)} (${escapeText(p.dateLabel)})</option>`)
        .join("")}</select></div>
      <div class="field"><label>Cara pengukuran (opsional)</label><input class="input" id="cm-method" placeholder="cth. hitung manual dari DM" /></div>
      <label class="checkbox-chip"><input type="checkbox" id="cm-required" checked />Wajib</label>
    `,
    footHTML: `<button class="btn btn-primary" id="cm-save">Tambah</button>`,
  });
  qs("#cm-save", overlay).addEventListener("click", () => {
    const label = qs("#cm-name", overlay).value.trim();
    if (!label) {
      toast("Isi nama milestone dulu.", "error");
      return;
    }
    const target = Math.max(1, Math.round(Number(qs("#cm-target", overlay).value) || 1));
    const chosenPhaseIndex = Number(qs("#cm-phase", overlay).value);
    const milestone = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      description: qs("#cm-desc", overlay).value.trim(),
      category: qs("#cm-category", overlay).value,
      kind: "number",
      unit: qs("#cm-unit", overlay).value.trim(),
      target,
      isSystemTarget: false,
      required: qs("#cm-required", overlay).checked,
      notApplicable: false,
      measurementMethod: qs("#cm-method", overlay).value.trim(),
      value: null,
      done: false,
      custom: true,
    };
    const phases = campaign.eventPlan.phases.map((p, i) => (i !== chosenPhaseIndex ? p : { ...p, milestones: [...p.milestones, milestone] }));
    updateCampaign(campaign.id, { eventPlan: { ...campaign.eventPlan, phases } });
    closeOverlay(overlay);
    toast(`"${label}" ditambahkan.`);
    onSaved?.();
  });
}

function journeyNodeHTML(pd, index, activePhaseId, expandedPhaseId) {
  const disabled = !pd.phase.enabled;
  const filled = !disabled && pd.items.length > 0;
  const isActive = pd.phase.id === activePhaseId;
  const isExpanded = pd.phase.id === expandedPhaseId;
  const dotStyle = isActive ? `--glow-color: color-mix(in srgb, var(--accent) 55%, transparent);` : "";
  const doneMilestones = (pd.phase.milestones || []).filter((m) => m.done).length;
  return `
    <button type="button" class="journey-node ${isExpanded ? "expanded" : ""} ${disabled ? "disabled" : ""}" data-phase-node="${pd.phase.id}">
      <div class="journey-node-dot ${filled ? "filled" : "empty"} ${isActive ? "active glow" : ""}" style="${dotStyle}">
        ${filled ? icon("check", { size: 20 }) : `<span>${index + 1}</span>`}
      </div>
      <div class="journey-node-label">${escapeText(pd.phase.name)}</div>
      <div class="journey-node-sub">${
        disabled
          ? "Not used"
          : pd.items.length
          ? `${pd.items.length} content${pd.phase.milestones?.length ? ` · ${doneMilestones}/${pd.phase.milestones.length} milestones` : ""}`
          : "No content yet"
      }</div>
    </button>
  `;
}

function journeyDetailHTML(brandId, campaign, pd) {
  const info = phaseTemplateInfo(pd.phase.id);
  if (!pd.phase.enabled) {
    return `
      <div class="journey-detail">
        <h3 style="font-size:16px;margin:0 0 6px;">${escapeText(pd.phase.name)}</h3>
        <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${escapeText(info.description)}</p>
        <div class="hint" style="margin:0 0 16px;">${icon("info", { size: 12 })} This phase isn't part of this campaign yet.</div>
        <button type="button" class="btn btn-secondary btn-sm" id="phase-enable">${icon("check", { size: 13 })}Enable this phase</button>
      </div>
    `;
  }
  return `
    <div class="journey-detail">
      <div class="flex items-center justify-between" style="margin-bottom:6px;">
        <h3 style="font-size:16px;margin:0;">${escapeText(pd.phase.name)}</h3>
        <div class="flex gap-8">
          <button type="button" class="btn btn-secondary btn-sm" id="phase-ai-suggest">${icon("bot", { size: 13 })}AI suggest content</button>
          <button type="button" class="btn btn-primary btn-sm" id="phase-add-content">${icon("plus", { size: 13 })}Add content</button>
        </div>
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:0 0 10px;">${escapeText(info.description)}</p>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${pd.phase.goal ? escapeText(pd.phase.goal) : "<em>No goal set for this phase yet — edit the campaign to add one.</em>"}</p>

      <div class="page-eyebrow" style="margin-bottom:8px;">Milestones</div>
      <div id="phase-milestones">${milestonesHTML(pd.phase.milestones || [])}</div>
      <div class="flex gap-8" style="margin:10px 0 20px;">
        <input class="input" id="milestone-new" placeholder="Add a milestone for this phase..." style="flex:1;" />
        <button type="button" class="btn btn-secondary btn-sm" id="milestone-add">${icon("plus", { size: 13 })}Add</button>
      </div>

      <div class="page-eyebrow" style="margin-bottom:8px;">Content</div>
      <div id="phase-ai-ideas"></div>
      ${
        pd.items.length
          ? `<div class="card card-tight">${pd.items.map((c) => phaseContentRow(brandId, c)).join("")}</div>`
          : `<div class="table-empty" style="padding:24px;">No content made for this phase yet.</div>`
      }
    </div>
  `;
}

function milestonesHTML(milestones) {
  if (!milestones.length) return `<p class="text-faint" style="font-size:12px;margin:0;">No milestones yet — add your own checkable goals for this phase.</p>`;
  return `
    <div style="display:flex;flex-direction:column;gap:2px;">
      ${milestones
        .map(
          (m) => `
        <label class="routine-task-row ${m.done ? "done" : ""}" data-milestone-id="${m.id}">
          <input type="checkbox" data-milestone-toggle="${m.id}" ${m.done ? "checked" : ""} />
          <span class="routine-task-text">${escapeText(m.text)}</span>
          <button type="button" class="icon-btn" data-milestone-remove="${m.id}" aria-label="Remove milestone" style="width:26px;height:26px;flex:none;">${icon("x", { size: 12 })}</button>
        </label>`
        )
        .join("")}
    </div>
  `;
}

function phaseContentRow(brandId, c) {
  return `
    <div class="top-content-row" data-goto-content="${c.id}" style="cursor:pointer;">
      <div class="ti">
        <div class="t">${escapeText(c.title || "Untitled")}</div>
        <div class="m">${c.platform || "—"} · <span class="status-pill status-${c.status}" style="padding:2px 8px;"><span class="status-dot"></span>${c.status}</span></div>
      </div>
    </div>
  `;
}

function ideaCardHTML(idea, index) {
  return `
    <div class="card card-tight" style="margin-bottom:8px;" data-idea-index="${index}">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:4px;">${escapeText(idea.title)}</div>
      <div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">${escapeText(idea.angle)}${idea.format ? ` · ${escapeText(idea.format)}` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-use-idea="${index}">Use this idea</button>
    </div>
  `;
}

// Mutates this phase's milestones in place, then persists the whole
// (small) phases array via the existing generic updateCampaign patch —
// same "no dedicated CRUD needed" approach the rest of this app's list
// fields (e.g. settings.js Platforms) already use.
function saveMilestones(campaign, phaseId, milestones) {
  const phases = campaign.phases.map((p) => (p.id === phaseId ? { ...p, milestones } : p));
  updateCampaign(campaign.id, { phases });
}

function wireJourneyDetail(root, brandId, brand, campaign, pd, refresh) {
  qs("#phase-enable", root)?.addEventListener("click", () => {
    const phases = campaign.phases.map((p) => (p.id === pd.phase.id ? { ...p, enabled: true } : p));
    updateCampaign(campaign.id, { phases });
  });

  qs("#milestone-add", root)?.addEventListener("click", () => {
    const input = qs("#milestone-new", root);
    const text = input.value.trim();
    if (!text) return;
    saveMilestones(campaign, pd.phase.id, [...(pd.phase.milestones || []), { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, done: false }]);
  });
  qs("#milestone-new", root)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") qs("#milestone-add", root).click();
  });
  qsa("[data-milestone-toggle]", root).forEach((cb) => {
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const milestones = (pd.phase.milestones || []).map((m) => (m.id === cb.dataset.milestoneToggle ? { ...m, done: cb.checked } : m));
      saveMilestones(campaign, pd.phase.id, milestones);
    });
  });
  qsa("[data-milestone-remove]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const milestones = (pd.phase.milestones || []).filter((m) => m.id !== btn.dataset.milestoneRemove);
      saveMilestones(campaign, pd.phase.id, milestones);
    });
  });

  qsa("[data-goto-content]", root).forEach((row) => {
    row.addEventListener("click", () => openContentEditor({ brandId, contentId: row.dataset.gotoContent, onSaved: refresh }));
  });

  qs("#phase-add-content", root)?.addEventListener("click", () => {
    openContentEditor({ brandId, defaults: { campaignId: campaign.id, campaignPhaseId: pd.phase.id }, onSaved: refresh });
  });

  const aiBtn = qs("#phase-ai-suggest", root);
  if (aiBtn) {
    aiBtn.addEventListener("click", async () => {
      const ai = getSettings().ai || {};
      const ideasEl = qs("#phase-ai-ideas", root);
      const hasKey = hasAiKey(ai);
      if (!hasKey) {
        ideasEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;margin-bottom:12px;">Add your AI API key in Settings → AI first.</div>`;
        return;
      }
      aiBtn.disabled = true;
      ideasEl.innerHTML = `<div class="ocr-status" style="margin-bottom:12px;"><div class="spinner"></div><span>Thinking…</span></div>`;
      try {
        const ideas = await suggestPhaseContent(ai, {
          brand, campaign, phase: pd.phase,
          existingTitles: pd.items.map((c) => c.title).filter(Boolean),
        });
        ideasEl.innerHTML = ideas.length
          ? ideas.map((idea, i) => ideaCardHTML(idea, i)).join("")
          : `<p class="text-faint" style="font-size:12px;margin-bottom:12px;">No ideas came back — try again.</p>`;
        qsa("[data-use-idea]", ideasEl).forEach((btn) => {
          btn.addEventListener("click", () => {
            const idea = ideas[Number(btn.dataset.useIdea)];
            // Saved the instant it's picked — not just pre-filled — so it
            // shows up in Content OS/Creator right away instead of only
            // existing once someone remembers to click Save inside the
            // editor drawer that opens next (which is now just refining an
            // already-real record, same as clicking any other content card).
            const created = createContent(brandId, {
              campaignId: campaign.id, campaignPhaseId: pd.phase.id,
              title: idea.title, idea: idea.angle, status: "idea",
            });
            openContentEditor({ brandId, contentId: created.id, onSaved: refresh });
          });
        });
      } catch (e) {
        ideasEl.innerHTML = `<div class="ocr-status" style="margin-bottom:12px;">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? e.message : "Couldn't reach the AI."}</span></div>`;
      } finally {
        aiBtn.disabled = false;
      }
    });
  }
}
