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

// Wepeka's Instagram handle (no @) — printed on the shareable campaign
// story card and put in the caption that gets copied alongside it.
export const WEPEKA_IG_HANDLE = "wepeka";

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
