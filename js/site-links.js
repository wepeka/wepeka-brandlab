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

// AI credit top-ups. Ordered over WhatsApp and added to the account by the
// Wepeka team (accounts/{uid}.aiDailyLimit, see api/_aiQuota.js). Shown on
// the pricing page's add-ons and in the "AI credit habis" dialog
// (js/ai-topup.js) — one list so the two never quote different prices.
export const AI_TOPUPS = [
  { key: "credits300", credits: 300, price: 20000 },
  { key: "credits1000", credits: 1000, price: 79000 },
];
