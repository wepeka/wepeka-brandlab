// "Laporkan masalah" — how a user tells the Wepeka team something is broken,
// confusing or missing, from wherever they are: the ⋯ menu, or the "halaman
// gagal dimuat" card. One short form; what the team needs to reproduce it
// (the page, the device, the last errors) is attached by itself.
// Sent to api/report.js, read in the Wepeka admin (Brandlab → Laporan Masalah).
import { icon } from "./icons.js";
import { escapeHtml, toast, resizeImageFile } from "./dom.js";
import { openModal, closeOverlay } from "./modals.js";
import { getBrand } from "./store.js";
import { getMode } from "./mode.js";
import { recentErrors } from "./error-log.js";
import { SUPPORT_WA_NUMBER } from "./site-links.js";
import { t, getLang } from "./i18n.js";

export const REPORT_KINDS = ["bug", "confused", "payment", "idea"];
const KIND_ICON = { bug: "info", confused: "help", payment: "money", idea: "bulb" };
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 2000;
// Same ceiling as api/_report.js (screenshotChars); a phone screenshot at
// 1280 px / JPEG 0.7 lands around 100–300 KB.
const SCREENSHOT_MAX_CHARS = 700_000;

// What rides along with every report: where they are and on what. Exported
// for the test.
export function reportContext({ hash = location.hash, brandName = "" } = {}) {
  // Never an SSO token or a query string — the route only.
  const page = /^#\/sso/.test(hash) ? "#/" : String(hash || "#/").replace(/[?].*$/, "").slice(0, 200);
  const main = typeof document !== "undefined" ? document.querySelector('script[type="module"][src*="main"]')?.getAttribute("src") || "" : "";
  return {
    page,
    brandName: String(brandName || "").slice(0, 80),
    mode: getMode() === "advanced" ? "advanced" : "guided",
    lang: getLang() === "en" ? "en" : "id",
    ua: typeof navigator !== "undefined" ? String(navigator.userAgent || "").slice(0, 300) : "",
    viewport: typeof window !== "undefined" && window.innerWidth ? `${window.innerWidth}x${window.innerHeight}` : "",
    app: main.split("/").pop().slice(0, 80),
    errors: recentErrors(),
  };
}

const brandNameFromHash = () => {
  const m = location.hash.match(/^#\/brand\/([^/]+)/);
  try {
    return (m && getBrand(m[1])?.name) || "";
  } catch {
    return "";
  }
};

async function send(payload) {
  const { auth } = await import("./firebase.js");
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { ok: false, error: "auth" };
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data?.error || `http-${res.status}` };
}

const waHelpHTML = () => `<a href="https://wa.me/${SUPPORT_WA_NUMBER}" target="_blank" rel="noopener noreferrer">${t("lapor.waTeam")}</a>`;

// `kind` / `message`: start the form on a kind or with text already in it
// (the "halaman gagal dimuat" card opens it on "bug").
export function openReportProblem({ kind = "bug", message = "" } = {}) {
  let screenshot = "";
  const overlay = openModal({
    title: t("lapor.title"),
    bodyHTML: `
      <form id="lapor-form" novalidate>
        <p class="community-lead">${t("lapor.lead")}</p>
        <div class="field">
          <label id="lapor-kind-label">${t("lapor.kind")}</label>
          <div class="ann-kinds" role="radiogroup" aria-labelledby="lapor-kind-label">
            ${REPORT_KINDS.map((k) => `<label class="ann-kind"><input type="radio" name="lapor-kind" value="${k}" ${k === (REPORT_KINDS.includes(kind) ? kind : "bug") ? "checked" : ""}/><span>${icon(KIND_ICON[k], { size: 13 })}${t(`lapor.kind.${k}`)}</span></label>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="lapor-message">${t("lapor.message")}</label>
          <textarea class="textarea" id="lapor-message" rows="5" maxlength="${MESSAGE_MAX}" placeholder="${escapeHtml(t("lapor.messagePh"))}">${escapeHtml(message)}</textarea>
        </div>
        <div class="field">
          <label for="lapor-shot">${t("lapor.shot")} <span class="copy-optional">${t("lapor.optional")}</span></label>
          <div class="lapor-shot" data-lapor-shot>
            <label class="btn btn-secondary btn-sm lapor-shot-pick">${icon("image", { size: 14 })}<span>${t("lapor.shotPick")}</span><input type="file" id="lapor-shot" accept="image/*" hidden /></label>
          </div>
        </div>
        <div class="field">
          <label for="lapor-contact">${t("lapor.contact")} <span class="copy-optional">${t("lapor.optional")}</span></label>
          <input class="input" id="lapor-contact" inputmode="tel" autocomplete="tel" maxlength="40" placeholder="08…" />
        </div>
        <p class="lapor-auto">${icon("info", { size: 13 })}<span>${t("lapor.auto")}</span></p>
        <p class="lapor-error" data-lapor-error hidden></p>
      </form>
    `,
    footHTML: `
      <button type="button" class="btn btn-secondary" data-lapor-cancel>${t("common.cancel")}</button>
      <button type="submit" form="lapor-form" class="btn btn-primary" data-lapor-send>${icon("send", { size: 14 })}${t("lapor.send")}</button>
    `,
  });
  overlay.setAttribute("data-report-modal", "");
  const q = (sel) => overlay.querySelector(sel);
  const errorEl = q("[data-lapor-error]");
  const showError = (html) => { errorEl.innerHTML = html; errorEl.hidden = !html; };

  q("[data-lapor-cancel]").addEventListener("click", () => closeOverlay(overlay));

  // Screenshot: shrunk in the browser before it goes anywhere.
  const shotHost = q("[data-lapor-shot]");
  const paintShot = () => {
    shotHost.innerHTML = screenshot
      ? `<img class="lapor-shot-thumb" src="${screenshot}" alt="${escapeHtml(t("lapor.shot"))}" /><button type="button" class="btn btn-ghost btn-sm" data-lapor-shot-remove>${icon("trash", { size: 13 })}${t("common.delete")}</button>`
      : `<label class="btn btn-secondary btn-sm lapor-shot-pick">${icon("image", { size: 14 })}<span>${t("lapor.shotPick")}</span><input type="file" id="lapor-shot" accept="image/*" hidden /></label>`;
  };
  shotHost.addEventListener("change", async (e) => {
    const file = e.target instanceof HTMLInputElement ? e.target.files?.[0] : null;
    if (!file) return;
    try {
      let data = await resizeImageFile(file, { maxDimension: 1280, quality: 0.7, format: "image/jpeg" });
      if (data.length > SCREENSHOT_MAX_CHARS) data = await resizeImageFile(file, { maxDimension: 900, quality: 0.6, format: "image/jpeg" });
      if (data.length > SCREENSHOT_MAX_CHARS) throw new Error("too-large");
      screenshot = data;
      showError("");
    } catch {
      screenshot = "";
      showError(escapeHtml(t("lapor.shotFail")));
    }
    paintShot();
  });
  shotHost.addEventListener("click", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("[data-lapor-shot-remove]")) return;
    screenshot = "";
    paintShot();
  });

  let sending = false;
  q("#lapor-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    const text = q("#lapor-message").value.trim();
    if (text.length < MESSAGE_MIN) {
      showError(escapeHtml(t("lapor.needMessage")));
      q("#lapor-message").focus();
      return;
    }
    const btn = q("[data-lapor-send]");
    sending = true;
    btn.disabled = true;
    showError("");
    const payload = {
      kind: q('input[name="lapor-kind"]:checked')?.value || "bug",
      message: text,
      contact: q("#lapor-contact").value.trim(),
      screenshot,
      ...reportContext({ brandName: brandNameFromHash() }),
    };
    const r = await send(payload).catch(() => ({ ok: false, error: "network" }));
    sending = false;
    if (!overlay.isConnected) { if (r.ok) toast(t("lapor.sentToast")); return; }
    if (!r.ok) {
      btn.disabled = false;
      showError(r.error === "too-many" ? `${escapeHtml(t("lapor.tooMany"))} ${waHelpHTML()}` : `${escapeHtml(t("lapor.failed"))} ${waHelpHTML()}`);
      return;
    }
    // Sent: the form gives way to a short thank-you with the next way to
    // reach the team.
    overlay.querySelector(".modal-body").innerHTML = `
      <div class="lapor-done">
        <span class="lapor-done-icon">${icon("check", { size: 22 })}</span>
        <h3>${t("lapor.done.title")}</h3>
        <p>${t("lapor.done.body")}</p>
        <p class="text-faint">${t("lapor.done.urgent")} ${waHelpHTML()}</p>
      </div>`;
    overlay.querySelector(".modal-foot").innerHTML = `<button type="button" class="btn btn-primary" data-lapor-close>${t("common.close")}</button>`;
    overlay.querySelector("[data-lapor-close]").addEventListener("click", () => closeOverlay(overlay));
    overlay.querySelector("[data-lapor-close]").focus();
  });

  setTimeout(() => q("#lapor-message")?.focus(), 60);
  return overlay;
}
