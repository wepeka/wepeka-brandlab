// "Perbarui Insights": the one place account-level Instagram numbers are
// entered (followers, reach, profile visits, as shown in the app's own
// Insights screen). Saved to brand.insights + a short history; every
// campaign milestone that reads profile.* updates on its own from there.
// Accounts with the Instagram API can pull followers with one click.
import { getBrand, getBrandInsights, updateBrandInsights, localISODate } from "../store.js";
import { openModal, closeOverlay } from "../modals.js";
import { icon } from "../icons.js";
import { qs, toast, formatNumber, escapeHtml } from "../dom.js";
import { canUseInstagramApi } from "../account.js";
import { getAccountProfile } from "../instagram.js";
import { ageLabel } from "../campaign-metrics.js";
import { t } from "../i18n.js";

export function openInsightsModal({ brandId, onSaved, reason = "", platform = "instagram" } = {}) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const ins = getBrandInsights(brand, platform);
  // The Instagram API fetch only exists for Instagram — every other
  // platform (TikTok, Facebook, Other) falls back to manual entry in this
  // same form, same as Instagram did before the API integration existed.
  const igApi = platform === "instagram" && canUseInstagramApi() && !!(brand.instagram?.accessToken && brand.instagram?.igUserId);
  const overlay = openModal({
    title: platform === "instagram" ? t("ins.title") : t("ins.titleFor", { platform: t(`goal.launch.platform.${platform}`) }),
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${t("ins.intro")} ${ins?.updatedAt ? t("ins.lastRecorded", { age: escapeHtml(ageLabel(ins.updatedAt)), source: ins.source === "instagram" ? t("ins.fromApi") : "" }) : t("ins.never")}</p>
      ${reason ? `<div class="hint" style="margin:0 0 14px;">${icon("info", { size: 12 })}<span>${escapeHtml(reason)}</span></div>` : ""}
      ${igApi ? `<button type="button" class="btn btn-secondary btn-sm" id="ins-fetch" style="margin-bottom:14px;">${icon("refresh", { size: 13 })}${t("ins.fetchFollowers")}</button>` : ""}
      <div class="field">
        <label for="ins-followers">${t("ins.followers")} <span class="copy-required">*</span></label>
        <input class="input" id="ins-followers" type="number" min="0" inputmode="numeric" value="${ins?.followers ?? ""}" placeholder="${t("ins.followersPlaceholder")}" />
      </div>
      <div class="ev-row">
        <div class="field">
          <label for="ins-reach">${t("ins.reach30")} <span class="copy-optional">${t("ins.optional")}</span></label>
          <input class="input" id="ins-reach" type="number" min="0" inputmode="numeric" value="${ins?.reach30d ?? ""}" placeholder="${t("ins.reachPlaceholder")}" />
        </div>
        <div class="field">
          <label for="ins-visits">${t("ins.visits30")} <span class="copy-optional">${t("ins.optional")}</span></label>
          <input class="input" id="ins-visits" type="number" min="0" inputmode="numeric" value="${ins?.profileVisits30d ?? ""}" placeholder="${t("ins.visitsPlaceholder")}" />
        </div>
      </div>
      <div class="field">
        <label for="ins-date">${t("ins.date")}</label>
        <input class="input" id="ins-date" type="date" max="${localISODate()}" value="${localISODate()}" />
      </div>
      <p class="ev-error" id="ins-error" hidden></p>
    `,
    footHTML: `<button type="button" class="btn btn-primary" id="ins-save">${icon("check", { size: 14 })}${t("common.save")}</button>`,
  });

  qs("#ins-fetch", overlay)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const profile = await getAccountProfile(brand.instagram);
      const count = Number(profile.followers_count);
      if (!Number.isFinite(count)) throw new Error(t("ins.noFollowerCount"));
      qs("#ins-followers", overlay).value = count;
      toast(t("ins.fetchedToast", { count: formatNumber(count) }));
    } catch (err) {
      toast(t("ins.fetchFailed", { msg: err.message }), "error");
    } finally {
      btn.disabled = false;
    }
  });

  qs("#ins-save", overlay).addEventListener("click", () => {
    const followers = qs("#ins-followers", overlay).value.trim();
    const err = qs("#ins-error", overlay);
    if (followers === "" || Number(followers) < 0) {
      err.textContent = t("ins.needFollowers");
      err.hidden = false;
      return;
    }
    const dateStr = qs("#ins-date", overlay).value || localISODate();
    const at = Math.min(Date.now(), new Date(dateStr + "T12:00:00").getTime() || Date.now());
    updateBrandInsights(brandId, platform, {
      followers,
      reach30d: qs("#ins-reach", overlay).value.trim(),
      profileVisits30d: qs("#ins-visits", overlay).value.trim(),
      at,
      source: "manual",
    });
    closeOverlay(overlay);
    toast(t("ins.savedToast"));
    onSaved?.();
  });
  qs("#ins-followers", overlay)?.focus();
}
