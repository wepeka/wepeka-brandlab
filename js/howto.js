// "Where do I find this number?" — a collapsible how-to with numbered steps
// and a small mock of the platform's own screen, highlighting the exact
// rows to copy. Used wherever someone has to type a number that only the
// Instagram/TikTok app shows (account Insights, per-post performance).
// Drawn with plain HTML/CSS instead of screenshots: no image assets to
// keep in sync with Instagram's UI, and it follows the app's theme.
import { t, getLang } from "./i18n.js";
import { tourRichText } from "./tour.js";

const GUIDES = {
  insights: {
    summary: "howto.insights.summary",
    steps: ["howto.insights.s1", "howto.insights.s2", "howto.insights.s3", "howto.insights.s4"],
    screen: "howto.insights.screen",
    rows: [
      { label: "howto.insights.reached", value: 12480, mark: true },
      { label: "howto.insights.visits", value: 1203, mark: true },
      { label: "howto.insights.followers", value: 1486, mark: true },
    ],
  },
  post: {
    summary: "howto.post.summary",
    steps: ["howto.post.s1", "howto.post.s2", "howto.post.s3"],
    screen: "howto.post.screen",
    rows: [
      { label: "howto.post.views", value: 8920, mark: true },
      { label: "howto.post.likes", value: 412, mark: true },
      { label: "howto.post.comments", value: 36, mark: true },
      { label: "howto.post.shares", value: 58, mark: true },
      { label: "howto.post.saves", value: 91, mark: true },
    ],
  },
};

export function howToHTML(kind, { open = false } = {}) {
  const g = GUIDES[kind];
  if (!g) return "";
  return `
    <details class="howto" ${open ? "open" : ""}>
      <summary>${t(g.summary)}</summary>
      <div class="howto-body">
        <ol class="howto-steps">${g.steps.map((k) => `<li>${tourRichText(t(k))}</li>`).join("")}</ol>
        <div class="howto-phone" aria-label="${t("howto.example")}">
          <div class="howto-phone-caption">${t("howto.example")}</div>
          <div class="howto-phone-head">${t(g.screen)}</div>
          ${g.rows.map((r) => `<div class="howto-phone-row ${r.mark ? "is-mark" : ""}"><span>${t(r.label)}</span><b>${r.value.toLocaleString(getLang() === "id" ? "id-ID" : "en-US")}</b></div>`).join("")}
        </div>
      </div>
    </details>
  `;
}
