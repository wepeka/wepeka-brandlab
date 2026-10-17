// Links back to wepeka.com. One Wepeka account covers both products: the
// site mints a Firebase custom token for the signed-in Community member and
// hands it to this app at `#/sso?t=<token>` (see js/main.js). The token
// rides in the hash fragment on purpose — fragments are never sent to a
// server, so it can't end up in an access log or a Referer header.
export const WEPEKA_SITE_URL = "https://www.wepeka.com";

// The site route that checks the Wepeka session and sends the user back
// here already signed in; logged-out visitors get the sign-up/login screen
// there first.
export const WEPEKA_CONNECT_URL = `${WEPEKA_SITE_URL}/brandlab/connect`;
// The same door for a signed-out visitor who pressed a plan's buy button:
// sign in (or register) there, then come back with that plan's checkout
// opening straight away (js/buy-intent.js). `planKey` as in api/_plans.js.
export const buyUrl = (planKey) => `${WEPEKA_CONNECT_URL}?to=pricing&plan=${encodeURIComponent(planKey)}`;

// The terms and the privacy policy live on the site, one copy for Community
// and Brandlab; the refund policy is a section of the terms. Linked where
// someone signs in or pays (js/legal-links.js) and in the invoice email
// (api/_community.js — kept equal by tests/community.test.mjs).
export const TERMS_URL = `${WEPEKA_SITE_URL}/syarat-ketentuan`;
export const PRIVACY_URL = `${WEPEKA_SITE_URL}/kebijakan-privasi`;
export const REFUND_URL = `${TERMS_URL}#refund`;

// Wepeka's Instagram handle (no @) — printed on the shareable campaign
// story card and put in the caption that gets copied alongside it.
export const WEPEKA_IG_HANDLE = "wepeka.id";

// Community (js/community.js): Brandlab's own WhatsApp group — news, fixes
// and tips for everyone with an account — and the accounts a new buyer is
// asked to follow, the founder's first, then Wepeka's. Same values as the
// email after payment (api/_community.js, kept equal by
// tests/community.test.mjs). Not Wepeka Community's group (wepeka.com/gabung),
// which this pointed at by mistake until 2026-10-13. The second group, for
// Lifetime accounts, is deliberately NOT here: its link never ships in the
// bundle — the server hands it to a Lifetime account (api/community.js).
export const BRANDLAB_WA_GROUP_URL = "https://chat.whatsapp.com/G3QM3TVztrH5jkFcoULjdu";
export const FOLLOW_INSTAGRAM = ["winkhsin", WEPEKA_IG_HANDLE];
// Wepeka Community's own WhatsApp group (wpk-dp src/lib/site.ts
// communityWhatsappGroupUrl, wepeka.com/gabung) — NOT a Brandlab group. Its
// description carries the community discount code (api/_promo.js), so the
// Founder's Deal page and the plans page's code field send people there to
// fetch it. Free to join.
export const COMMUNITY_WA_GROUP_URL = "https://chat.whatsapp.com/CCk7zkSbXhrBxKyjG92Yt1";
export const instagramUrl = (handle) => `https://www.instagram.com/${String(handle).replace(/^@/, "")}`;

// Wepeka support WhatsApp — payments, top-ups, extra brands (same number as
// wpk-dp src/lib/support.ts).
export const SUPPORT_WA_NUMBER = "6285196627609";

// AI credit top-ups, paid on the spot through Midtrans (`payKey` =
// api/_plans.js AI_ADDONS, which sets the real price — keep in sync). Top-up
// credits never expire. Shown on the pricing page's add-ons and in the
// "AI credit habis" offer (js/ai-topup.js) — one list so the two never quote
// different prices.
export const AI_TOPUPS = [
  { key: "credits300", credits: 300, price: 15000, payKey: "ai-300" },
  { key: "credits500", credits: 500, price: 23000, payKey: "ai-500" },
  { key: "credits1000", credits: 1000, price: 39000, payKey: "ai-1000", best: true },
];
// AI Sepuasnya: no credit limit for 30 days, on any paid plan
// (api/_aiQuota.js extrasFor).
export const AI_UNLIMITED = { key: "aiUnlimited", days: 30, price: 50000, payKey: "ai-unlimited" };
// Extra brand slots (api/_plans.js ADDONS): any paid account can rent one
// for 30 days (renewKey extends the one ending soonest); only pay-once
// plans can buy them for good — subscribers move to Lifetime first.
export const BRAND_ADDONS = {
  sub: [{ key: "brandSub", n: 1, price: 29000, payKey: "addon-brand-sub", renewKey: "addon-brand-sub-renew", days: 30 }],
  lifetime: [
    { key: "brandLife1", n: 1, price: 99000, payKey: "addon-brand-1" },
    { key: "brandLife3", n: 3, price: 249000, payKey: "addon-brand-3", save: 48000 },
  ],
};
