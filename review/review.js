// The client's review page: brandlab.wepeka.com/review/<token>
// (api/_review.js). No account: the token in the link is the key. The client
// watches the cuts Wepeka sent, approves one or sends it back with a note at
// a moment of the video; once a post is up, its Instagram post shows here
// instead of the video. Indonesian only, like the clients.
const root = document.getElementById("rv");
const toastEl = document.getElementById("rv-toast");
const token = (location.pathname.match(/^\/review\/([A-Za-z0-9_-]{20,40})\/?$/) || [])[1] || new URLSearchParams(location.search).get("t") || "";
const NAME_KEY = "rv:name";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const clock = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
const SVG = {
  check: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

function readName() {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}
function saveName(v) {
  try { localStorage.setItem(NAME_KEY, v); } catch { /* asked again next time */ }
}

function when(item) {
  if (!item.date) return "";
  const d = new Date(`${item.date}T00:00:00`);
  const day = d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
  return `Tayang ${day}${item.time ? ` · ${item.time.replace(":", ".")}` : ""}`;
}
const label = (v) => (v.n ? `Revisi ${v.n}` : "Versi pertama");

function stageHTML(item) {
  const v = item.version;
  if (!item.files.length) return `<div class="rv-gone">${SVG.clock}<span>Videonya sedang disiapkan.</span></div>`;
  if (v.kind === "set" || v.kind === "image") {
    return `<div class="rv-stage is-photo"><div class="rv-slides">${item.files.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div>${item.files.length > 1 ? `<span class="rv-slide-n">1/${item.files.length}</span>` : ""}</div>`;
  }
  return `<div class="rv-stage"><video src="${esc(item.files[0])}" controls playsinline preload="metadata"></video></div>`;
}

function cardHTML(item) {
  const v = item.version;
  const head = `
    <div class="rv-card-top">
      ${item.code ? `<span class="rv-code">${esc(item.code)}</span>` : ""}
      <div class="rv-card-title"><b>${esc(item.title || "Tanpa judul")}</b><small>${esc([when(item), item.state === "posted" ? "" : label(v)].filter(Boolean).join(" · "))}</small></div>
    </div>`;
  if (item.state === "posted") {
    const embed = item.permalink ? `${item.permalink}embed/` : "";
    return `<article class="rv-card is-posted">${head}
      ${embed ? `<iframe class="rv-ig" src="${esc(embed)}" title="Postingan Instagram" loading="lazy" allowtransparency="true"></iframe><a class="rv-ig-link" href="${esc(item.permalink)}" target="_blank" rel="noopener">${SVG.ig}Buka di Instagram</a>` : `<p class="rv-state is-ok">${SVG.check}Sudah tayang di Instagram.</p>${stageHTML(item)}`}
    </article>`;
  }
  const notes = item.notes.length ? `<ul class="rv-notes">${item.notes.map((n) => `<li class="${n.done ? "is-done" : ""}"><b>${clock(n.t)}</b><span>${esc(n.text)}</span></li>`).join("")}</ul>` : "";
  const change = v.changeNote ? `<p class="rv-change"><b>Yang diubah:</b> ${esc(v.changeNote)}</p>` : "";
  const caption = item.caption ? `<details class="rv-cap"><summary>Lihat caption</summary><p>${esc(item.caption)}</p></details>` : "";
  let tail = "";
  if (item.state === "waiting") {
    tail = `
      <div class="rv-actions" data-actions>
        <button type="button" class="rv-btn is-rev" data-rev>${SVG.edit}Minta revisi</button>
        <button type="button" class="rv-btn is-ok" data-ok>${SVG.check}Setujui</button>
      </div>
      <div class="rv-note" data-note hidden>
        <span class="rv-at" data-at>${SVG.clock}Di detik 0:00</span>
        <label for="rv-text-${esc(item.id)}">Apa yang perlu diubah?</label>
        <textarea class="rv-text" id="rv-text-${esc(item.id)}" maxlength="800" placeholder="Mis. logo kepotong, teks terlalu cepat…"></textarea>
        <input class="rv-input" data-name maxlength="60" placeholder="Nama kamu" value="${esc(readName())}" aria-label="Nama kamu">
        <div class="rv-actions"><button type="button" class="rv-btn is-rev" data-cancel>Batal</button><button type="button" class="rv-btn is-send" data-send>${SVG.send}Kirim</button></div>
      </div>`;
  } else if (item.state === "revision") {
    tail = `<p class="rv-state is-rev">${SVG.edit}Catatanmu sudah diterima. Wepeka sedang memperbaikinya.</p>${notes}`;
  } else if (item.state === "approved") {
    tail = `<p class="rv-state is-ok">${SVG.check}Kamu sudah setuju${item.name ? ` (${esc(item.name)})` : ""}. Tinggal tayang.</p>`;
  }
  return `<article class="rv-card is-${esc(item.state)}" data-id="${esc(item.id)}" data-v="${esc(v.id)}">${head}${change}${stageHTML(item)}${caption}${tail}</article>`;
}

const SECTIONS = [
  ["waiting", "Perlu kamu cek", "#2EC4B6"],
  ["revision", "Sedang diperbaiki", "#FF9F3D"],
  ["approved", "Disetujui, menunggu tayang", "#A974FF"],
  ["posted", "Sudah tayang", "#36D27F"],
];

function render(data) {
  const brand = data.brand || {};
  document.title = `Review video · ${brand.name || "Wepeka"}`;
  const n = data.items.filter((x) => x.state === "waiting").length;
  root.innerHTML = `
    <div class="rv-head">
      <span class="rv-av" ${brand.color ? `style="background:${esc(brand.color)}"` : ""}>${esc((brand.name || "?")[0])}</span>
      <div><h1>${esc(brand.name || "Brand")}</h1>${brand.handle ? `<p>@${esc(brand.handle)}</p>` : ""}</div>
    </div>
    <p class="rv-lead">${n ? `Ada ${n} video untuk kamu cek. Tonton, lalu setujui atau minta revisi.` : "Semua video sudah kamu cek. Terima kasih!"}</p>
    ${data.items.length ? SECTIONS.map(([key, title, color]) => {
      const list = data.items.filter((x) => x.state === key);
      return list.length ? `<section class="rv-sec" style="--c:${color}"><h2><i></i>${title}<span>${list.length}</span></h2>${list.map(cardHTML).join("")}</section>` : "";
    }).join("") : `<div class="rv-empty"><b>Belum ada video</b>Wepeka akan mengirim video ke link ini.</div>`}
    <p class="rv-foot">Dikelola Wepeka · Brandlab</p>`;
  wire();
}

function wire() {
  root.querySelectorAll(".rv-slides").forEach((row) => row.addEventListener("scroll", () => {
    const n = row.parentElement.querySelector(".rv-slide-n");
    if (n) n.textContent = `${Math.round(row.scrollLeft / row.clientWidth) + 1}/${row.children.length}`;
  }, { passive: true }));
  root.querySelectorAll(".rv-card[data-id]").forEach((card) => {
    const video = card.querySelector("video");
    const note = card.querySelector("[data-note]");
    const actions = card.querySelector("[data-actions]");
    if (!note) return;
    const at = () => Math.floor(video?.currentTime || 0);
    card.querySelector("[data-ok]").addEventListener("click", () => decide(card, "approve"));
    card.querySelector("[data-rev]").addEventListener("click", () => {
      video?.pause();
      card.querySelector("[data-at]").innerHTML = `${SVG.clock}${video ? `Di detik ${clock(at())}` : "Catatan"}`;
      actions.hidden = true;
      note.hidden = false;
      note.querySelector("textarea").focus();
    });
    video?.addEventListener("pause", () => { if (!note.hidden) card.querySelector("[data-at]").innerHTML = `${SVG.clock}Di detik ${clock(at())}`; });
    card.querySelector("[data-cancel]").addEventListener("click", () => { note.hidden = true; actions.hidden = false; });
    card.querySelector("[data-send]").addEventListener("click", () => {
      const text = note.querySelector("textarea").value.trim();
      if (!text) { note.querySelector("textarea").focus(); return; }
      decide(card, "revise", { t: at(), text });
    });
  });
}

async function decide(card, verdict, note) {
  const name = (card.querySelector("[data-name]")?.value || readName()).trim();
  if (name) saveName(name);
  card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch("/api/review/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: token, contentId: card.dataset.id, versionId: card.dataset.v, verdict, note, name }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || "server"), { code: json.error });
    toast(verdict === "approve" ? "Disetujui. Terima kasih!" : "Catatan terkirim. Wepeka akan memperbaikinya.");
  } catch (e) {
    toast(e.code === "stale" ? "Ada versi baru. Halaman dimuat ulang." : "Gagal mengirim. Coba lagi.");
  }
  load();
}

async function load() {
  if (!token) { showError(); return; }
  try {
    const res = await fetch(`/api/review/get?t=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (res.status === 404) { showError(); return; }
    if (!res.ok) throw new Error(String(res.status));
    render(await res.json());
  } catch {
    root.innerHTML = `<div class="rv-error"><b>Halaman belum bisa dimuat</b>Cek internetmu, lalu muat ulang.</div>`;
  }
}

function showError() {
  root.innerHTML = `<div class="rv-error"><b>Link ini tidak berlaku</b>Minta link baru ke Wepeka.</div>`;
}

load();
