// Links to the terms, the refund policy and the privacy policy on
// wepeka.com (site-links.js), for the places where someone signs in or
// pays: the login card, the front page's footer and the plans page.
import { t } from "./i18n.js";
import { TERMS_URL, PRIVACY_URL, REFUND_URL } from "./site-links.js";

const link = (href, key) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${t(key)}</a>`;
export const termsLink = () => link(TERMS_URL, "legal.terms");
export const privacyLink = () => link(PRIVACY_URL, "legal.privacy");
export const refundLink = () => link(REFUND_URL, "legal.refund");

// A sentence with the links in it — `key` is "legal.agreeLogin" or
// "legal.agreePay".
export const agreeLine = (key) => t(key, { terms: termsLink(), privacy: privacyLink(), refund: refundLink() });
