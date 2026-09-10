export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Exact figures with thousand separators — never abbreviated to K/M, so a
// number here always matches what you'd see counting it out on Instagram.
export function formatNumber(n) {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toLocaleString();
}

export function formatPercent(n, digits = 1) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toFixed(digits) + "%";
}

export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...opts });
}

export function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(new Date(ts).toISOString());
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function initials(name = "") {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Everything gets stored as a data URL inside one localStorage slot (5-10MB
// browser cap, shared across all brands). A couple of full-resolution phone
// photos can fill that on their own, so every image upload is downscaled
// through a canvas first — this is what keeps that quota from being hit.
export function resizeImageFile(file, { maxDimension = 800, quality = 0.85, format } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const outFormat = format || (file.type === "image/png" ? "image/png" : "image/jpeg");
        resolve(canvas.toDataURL(outFormat, quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Renders a brand's photo if it has one, otherwise its initials — same
// markup shape (class="avatar") so existing size/radius rules keep working.
export function avatarHTML(brand, extraStyle = "") {
  if (brand.avatar) {
    return `<img class="avatar" style="${extraStyle}" src="${brand.avatar}" alt="" />`;
  }
  return `<div class="avatar" style="${extraStyle}">${initials(brand.name)}</div>`;
}

export function toast(message, type = "success") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const glyph = type === "success"
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></svg>';
  el.innerHTML = `${glyph}<span>${escapeHtml(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// A floating progress bar (bottom-right, survives the modal that started it
// closing) for anything long-running — importing a batch from Instagram,
// refreshing metrics, etc. — so it doesn't have to hold a blocking modal
// open, and multiple can stack if more than one thing is running.
export function showProgressBar(label) {
  const root = document.getElementById("progress-root") || (() => {
    const r = document.createElement("div");
    r.id = "progress-root";
    document.body.appendChild(r);
    return r;
  })();
  const el = document.createElement("div");
  el.className = "floating-progress";
  el.innerHTML = `
    <div class="floating-progress-label">${escapeHtml(label)}</div>
    <div class="floating-progress-track"><div class="floating-progress-fill" style="width:0%;"></div></div>
    <div class="floating-progress-sub"></div>
  `;
  root.appendChild(el);
  const fill = el.querySelector(".floating-progress-fill");
  const sub = el.querySelector(".floating-progress-sub");
  return {
    update(current, total, subLabel = "") {
      const pct = total ? Math.round((current / total) * 100) : 0;
      fill.style.width = `${pct}%`;
      sub.textContent = subLabel || `${current} / ${total}`;
    },
    done(message) {
      fill.style.width = "100%";
      el.classList.add("done");
      sub.textContent = message || "Done";
      setTimeout(() => el.remove(), 2600);
    },
    remove() {
      el.remove();
    },
  };
}

// Samples a logo/avatar image down to a handful of pixels and averages
// them — cheap, no library, good enough for a background tint (not trying
// to find the *most representative* color, just *a* plausible one).
export function getDominantColor(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const size = 12;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      let r = 0, g = 0, b = 0, n = 0;
      try {
        const data = ctx.getImageData(0, 0, size, size).data;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 40) continue; // skip near-transparent pixels
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      } catch (e) {
        reject(e);
        return;
      }
      if (!n) { reject(new Error("Image had no opaque pixels to sample.")); return; }
      resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
    };
    img.src = imageUrl;
  });
}

function parseRgb(rgb) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb || "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// A sampled logo color can land anywhere from near-black to near-white —
// pick whichever existing text color (the same two already used everywhere
// else) actually reads on top of it, rather than assuming one direction.
export function pickTintTextColor(rgb) {
  const parsed = parseRgb(rgb);
  if (!parsed) return "#1c1610";
  const [r, g, b] = parsed;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? "#1c1610" : "#f6f4f1";
}

// For using the tint itself as small text/icon color directly on the app's
// near-black page background — a dark-logo brand would otherwise produce
// near-invisible text, so blend toward white once luminance drops too low.
export function pickTintForeground(rgb) {
  const parsed = parseRgb(rgb);
  if (!parsed) return rgb;
  let [r, g, b] = parsed;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance < 90) {
    const mix = 0.55;
    r = Math.round(r + (255 - r) * mix);
    g = Math.round(g + (255 - g) * mix);
    b = Math.round(b + (255 - b) * mix);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

// One-item-per-line textarea <-> plain string array — the encoding shared by
// Brand DNA's personality/values/productsServices and Campaign's channels,
// so multi-value fields don't need a dedicated add/remove list-editor UI.
export function linesToList(text) {
  return (text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
export function listToLines(list) {
  return (list || []).join("\n");
}

// Closes any open .menu / .filter popover when clicking elsewhere.
export function closeMenusOnOutsideClick() {
  document.addEventListener("click", (e) => {
    qsa(".menu").forEach((m) => {
      if (!m.contains(e.target) && !e.target.closest("[data-menu-toggle]")) m.remove();
    });
  });
}
