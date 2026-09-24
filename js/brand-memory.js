// Brand memory — the small, owner-approved timeline every AI feature reads
// as "what is happening in this brand right now" (brand.developmentLog,
// rendered by js/brand-pulse.js buildPulseText into Creator, Copy Studio,
// the schedule suggester, campaign playbooks and the chat itself).
//
// Two ways a moment gets in, both from the Teman tab of the chat
// (js/consultant-panel.js): the Teman proposes one right after the owner
// tells it something ([[moment:…]] → "Simpan ke Memori Brand"), or a recap
// of a stretch of chat lists several to tick. This module is the shared
// bits: the recap validator and the "Memori Brand" modal the chat, the Home
// card and Creator all open, so there is exactly one place to see and
// delete what AI keeps reading.
import { getBrand, getCompanionThread, updateBrainstorm, removeBrandLogEntry, clearBrandLog, MOMENT_KINDS, MOMENT_ACTIONS } from "./store.js";
import { openModal, closeOverlay, confirmDialog } from "./modals.js";
import { formatDate, escapeHtml as esc, toast, qsa } from "./dom.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

const RECAP_MAX_MOMENTS = 6;
const MEMORY_MODAL_LIMIT = 40;

export const momentKindLabel = (kind) => t(`companion.moment.kind.${MOMENT_KINDS.includes(kind) ? kind : "other"}`);

// The moments the owner saved (not the auto-detected signals), newest first.
export function savedMoments(brand) {
  return (brand?.developmentLog || []).filter((e) => e.source === "moment").sort((a, b) => b.at - a.at);
}

// Owner messages in the Teman thread since the last recap — what "Rangkum"
// would read. Messages that already carry a moment card are left out: the
// owner already decided on those one by one.
export function unrecappedMessages(brandId) {
  const brand = getBrand(brandId);
  const since = brand?.companion?.lastRecapAt || 0;
  return (getCompanionThread(brandId)?.messages || []).filter((m) => m.at > since && !m.blocks?.recap && m.text);
}

// What the model returned → what we're willing to store. Unknown kinds
// become "other", unknown actions are dropped, strings are cut to the
// lengths the prompt promised, empties vanish. Nothing here is trusted
// past this point.
export function validateRecap(moments) {
  return (Array.isArray(moments) ? moments : [])
    .map((m) => ({
      kind: MOMENT_KINDS.includes(m?.kind) ? m.kind : "other",
      title: String(m?.title || "").trim().slice(0, 80),
      detail: String(m?.detail || "").trim().slice(0, 160),
      action: MOMENT_ACTIONS.includes(m?.action) ? m.action : null,
    }))
    .filter((m) => m.title)
    .slice(0, RECAP_MAX_MOMENTS);
}

// Brand memory in full: every moment and auto signal, each deletable, plus
// the Teman chat's own "delete everything" — kept apart on purpose so it's
// clear which one AI features read (memory) and which one only the Teman
// does (chat).
export function openBrandMemoryModal(brandId, { refresh = () => {} } = {}) {
  const sourceTag = (e) => {
    if (e.source === "moment") return momentKindLabel(e.kind);
    if (e.source === "auto") return t("pulse.log.auto");
    return t("pulse.log.legacy");
  };
  const paintList = () => {
    const brand = getBrand(brandId);
    const log = [...(brand?.developmentLog || [])].sort((a, b) => b.at - a.at).slice(0, MEMORY_MODAL_LIMIT);
    const msgCount = getCompanionThread(brandId)?.messages?.length || 0;
    return `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("companion.memory.intro")}</p>
      ${
        log.length
          ? log
              .map(
                (e) => `
              <div class="companion-moment-row" data-memory-row="${e.id}">
                <div style="min-width:0;flex:1;">
                  <span class="tag" style="margin-right:6px;">${sourceTag(e)}</span>
                  <span class="companion-moment-text" style="white-space:normal;">${esc(e.title || "")}${e.source === "moment" && e.detail ? `<span class="text-muted"> — ${esc(e.detail)}</span>` : ""}</span>
                  <div class="text-faint" style="font-size:11px;margin-top:2px;">${esc(formatDate(new Date(e.at).toISOString().slice(0, 10)))}</div>
                </div>
                <button type="button" class="icon-btn" data-memory-delete="${e.id}" aria-label="${t("common.delete")}" style="width:28px;height:28px;flex:none;">${icon("trash", { size: 13 })}</button>
              </div>`
              )
              .join("")
          : `<div class="table-empty" style="padding:20px;">${t("companion.memory.empty")}</div>`
      }
      <div class="companion-moments" style="margin-top:18px;">
        <p class="companion-moments-title">${t("companion.memory.chatSection")}</p>
        <p class="text-muted" style="font-size:12.5px;margin:0 0 10px;">${t("companion.memory.chatNote", { n: msgCount })}</p>
        <button type="button" class="btn btn-secondary btn-sm" id="memory-clear-chat" ${msgCount ? "" : "disabled"}>${icon("trash", { size: 12 })}${t("companion.chat.clear")}</button>
      </div>
    `;
  };

  const overlay = openModal({
    title: t("companion.memory.title"),
    wide: true,
    bodyHTML: paintList(),
    footHTML: `<button type="button" class="btn btn-secondary" id="memory-clear-all">${icon("trash", { size: 13 })}${t("companion.memory.clearAll")}</button>`,
  });

  const repaint = () => {
    overlay.querySelector(".modal-body").innerHTML = paintList();
    wireBody();
    refresh();
  };
  const wireBody = () => {
    qsa("[data-memory-delete]", overlay).forEach((btn) =>
      btn.addEventListener("click", () => {
        removeBrandLogEntry(brandId, btn.dataset.memoryDelete);
        repaint();
      })
    );
    overlay.querySelector("#memory-clear-chat")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: t("companion.chat.clearConfirm.title"),
        message: t("companion.chat.clearConfirm.body"),
        confirmLabel: t("companion.chat.clear"),
        danger: true,
      });
      if (!ok) return;
      const thread = getCompanionThread(brandId);
      if (thread) updateBrainstorm(thread.id, { messages: [] });
      repaint();
      toast(t("companion.chat.cleared"));
    });
  };
  wireBody();

  overlay.querySelector("#memory-clear-all")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("companion.memory.clearConfirm.title"),
      message: t("companion.memory.clearConfirm.body"),
      confirmLabel: t("companion.memory.clearAll"),
      danger: true,
    });
    if (!ok) return;
    clearBrandLog(brandId);
    closeOverlay(overlay);
    refresh();
    toast(t("companion.memory.cleared"));
  });
  return overlay;
}
