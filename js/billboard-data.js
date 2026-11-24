// Wepeka Billboard cards from api/billboard.js, fetched once per 10 minutes
// per tab — shared by the Billboard page (js/views/billboard.js) and the
// banner on Beranda (js/billboard-promo.js).
import { getLang } from "./i18n.js";

export const BILLBOARD_WALL = "https://www.wepeka.com/community/billboard";
let cache = null; // { at, data }
let inflight = null;

export async function loadBillboard({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.data;
  if (!fresh && inflight) return inflight;
  inflight = fetch(`/api/billboard${getLang() === "en" ? "?lang=en" : ""}`, { headers: { accept: "application/json" } })
    .then((res) => {
      if (!res.ok) throw new Error(`billboard ${res.status}`);
      return res.json();
    })
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
