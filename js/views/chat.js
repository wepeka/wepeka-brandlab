// "Tanya Brandlab" — the full page of the app's one chat
// (js/consultant-panel.js). This file is only the frame: title, help and
// tour. The chat, its conversations (Obrolan) and what it saves (ideas,
// brand memory) are the same component the round chat button opens, so
// both sizes are one conversation with one set of features — never two
// copies. It has its own address, under no tab: it isn't part of Campaign
// or Konten, it is where the owner talks to the AI.
//
// Route: #/brand/:id/chat[/:id] (an Obrolan, or a Brainstorm thread in
// Pro). The old #/brand/:id/brainstorm[/:threadId] addresses land here too.
// Other screens open it with a navigation context (js/nav-context.js): a
// campaign or stage, a goal, a piece of content, a seed for the box, or
// intent "plot" (notes sent from the scratch pad, answered right away).
import { backLinkHTML } from "../back-link.js";
import { getBrand } from "../store.js";
import { consumeNavContext } from "../nav-context.js";
import { mountChatPage, applyChatContext, chatScopeInfo } from "../consultant-panel.js";
import { escapeHtml as esc, qs } from "../dom.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { t } from "../i18n.js";

const TOUR_STEPS = [
  { selector: ".cp-page-chat .consultant-panel-input", title: t("chat.title"), body: t("chat.tour.chat") },
  { selector: ".cp-page .bs-threads", title: t("chat.sessions.title"), body: t("chat.tour.sessions") },
  { selector: ".cp-page .bs-ideas", title: t("bs.ideas.title"), body: t("chat.tour.saved") },
];

export function render(root, { brandId, threadId = null }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  root.innerHTML = `<div class="page-head" id="chat-head"></div><div id="chat-page-host"></div>`;
  const unmount = mountChatPage(qs("#chat-page-host", root), { brandId, threadId, ctx: consumeNavContext() });

  // A conversation about a campaign links back to it; otherwise Home.
  const campaign = chatScopeInfo(brandId).campaign;
  qs("#chat-head", root).innerHTML = `
    <div>
      <div class="page-eyebrow flex items-center gap-6">${campaign ? backLinkHTML(`#/brand/${brandId}/campaigns/${campaign.id}`, campaign.name || t("nav.campaigns")) : backLinkHTML(`#/brand/${brandId}`, t("nav.home"))} · ${esc(brand.name)}${helpButtonHTML("brainstorm")}</div>
      <h1>${t("chat.title")}</h1>
      <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:680px;">${t("chat.page.sub")}</p>
    </div>`;
  wireHelpButtons(root);
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));

  // Same route, new context (e.g. "Setor ke chat" while already here).
  const onCtx = () => { const ctx = consumeNavContext(); if (ctx) applyChatContext(brandId, ctx); };
  document.addEventListener("nav:context", onCtx);
  return () => {
    document.removeEventListener("nav:context", onCtx);
    unmount();
  };
}
