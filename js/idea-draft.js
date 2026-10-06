// A saved idea becoming content — ONE path for every place that does it
// (the chat's "Kirim ke Creator", dropping an idea on a date in Bank Konten):
// its title, its angle as the idea, notes and hook candidates carried along,
// status "idea", and the idea marked "used" with the new contentId. Callers
// only decide where it lands (campaign/phase/series/date).
import { createContent, updateBrandIdea } from "./store.js";
import { t } from "./i18n.js";

export function ideaDraftNotes(idea) {
  return [idea.notes, idea.hooks?.length ? `${t("bs.concept.hooksLabel")}:\n${idea.hooks.map((h) => `- ${h}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
}

export function draftFromIdea(brandId, idea, placement = {}) {
  const notes = ideaDraftNotes(idea);
  const c = createContent(brandId, {
    ...placement,
    title: idea.text, funnel: "TOFU", idea: idea.description || "", status: "idea", ...(notes ? { notes } : {}),
  });
  updateBrandIdea(brandId, idea.id, { status: "used", contentId: c.id });
  return c;
}
