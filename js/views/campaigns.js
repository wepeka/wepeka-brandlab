import {
  getBrand, listContent, onChange, getSettings,
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  CAMPAIGN_OBJECTIVES, CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS, CAMPAIGN_PHASE_TEMPLATE,
  organicViews, combinedViewsWithAds,
} from "../store.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { toast, formatNumber, linesToList, listToLines, qs, qsa } from "../dom.js";
import { generateCampaignPlan, suggestPhaseContent, AiApiError } from "../ai.js";
import { openContentEditor } from "./content-editor.js";

// Reuses the existing status-pill color classes (defined for Content's own
// idea/draft/production/editing/scheduled/published/archived vocabulary)
// instead of adding new CSS for a second status vocabulary — the color
// association (grey/blue/gold/green) still reads sensibly for a campaign's
// own planning → active → completed → archived lifecycle.
const CAMPAIGN_STATUS_PILL_CLASS = { planning: "status-draft", active: "status-scheduled", completed: "status-published", archived: "status-archived" };

export function render(root, { brandId, campaignId }) {
  const state = { expandedPhaseId: null };
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
  const enabledPhases = campaign.phases.filter((p) => p.enabled);
  const filledPhases = enabledPhases.filter((p) => linked.some((c) => c.campaignPhaseId === p.id)).length;
  return `
    <div class="brand-card" data-open-campaign="${campaign.id}" style="cursor:pointer;">
      <button class="icon-btn card-menu" data-menu-toggle data-id="${campaign.id}" aria-label="Campaign actions" style="width:30px;height:30px;">${icon("dots", { size: 15 })}</button>
      <div class="flex items-center gap-8" style="margin-bottom:12px;">
        <span class="tag">${CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] || campaign.objective}</span>
        <span class="status-pill ${CAMPAIGN_STATUS_PILL_CLASS[campaign.status] || ""}"><span class="status-dot"></span>${CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</span>
      </div>
      <h3>${escapeText(campaign.name || "Untitled campaign")}</h3>
      <div class="meta" style="margin-bottom:10px;">${filledPhases}/${enabledPhases.length} phases underway · ${linked.length} content item${linked.length === 1 ? "" : "s"}</div>
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

function openNewCampaignFlow({ brandId, onSaved }) {
  const brand = getBrand(brandId);
  const state = { objective: "awareness" };

  const overlay = openModal({
    title: "New Campaign",
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
      <div id="intake-status" style="margin-top:4px;"></div>
    `,
    footHTML: `
      <button class="btn btn-secondary" data-skip>Skip, fill in manually</button>
      <button class="btn btn-primary" data-generate>${icon("bot", { size: 15 })}Generate with AI</button>
    `,
    onMount: (el) => {
      setTimeout(() => el.querySelector("#intake-goal").focus(), 30);
      qsa("#intake-objective button", el).forEach((btn) => {
        btn.addEventListener("click", () => {
          state.objective = btn.dataset.val;
          qsa("#intake-objective button", el).forEach((b) => b.classList.toggle("active", b === btn));
        });
      });
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
    const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
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
          <input class="input" id="c-cta" value="${escapeAttr(draft.cta)}" />
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
  `;

  qs("#edit-campaign", root).addEventListener("click", () => openCampaignModal({ brandId, campaign, onSaved: refresh }));

  qsa("[data-phase-node]", root).forEach((node) => {
    node.addEventListener("click", () => {
      state.expandedPhaseId = node.dataset.phaseNode;
      refresh();
    });
  });

  wireJourneyDetail(root, brandId, brand, campaign, expanded, refresh);
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
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
      const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
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
            openContentEditor({
              brandId,
              defaults: { campaignId: campaign.id, campaignPhaseId: pd.phase.id, title: idea.title, idea: idea.angle },
              onSaved: refresh,
            });
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
