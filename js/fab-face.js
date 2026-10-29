// A face for the floating buttons — Tanya Brandlab and the Catatan & Cari
// ide button (owner's ask, 2026-10-29: "kaya floating chat ada motionnya, ada
// mata kedip-kedip hitam yang lucu"). Two black eyes that blink now and
// then (sometimes twice) and glance toward the pointer. The look and the
// bobbing are CSS (.fab-face in css/styles.css); this only times the blinks
// and moves the eyes. Reduced motion: no blinking, no following.
export const faceHTML = () => `<span class="fab-face" aria-hidden="true"><span class="fab-eye"></span><span class="fab-eye"></span></span>`;

const faces = new Set();
let following = false;
const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function look(e) {
  for (const face of faces) {
    if (!face.isConnected) { faces.delete(face); continue; }
    const r = face.getBoundingClientRect();
    if (!r.width) continue;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 260); // nearer = a smaller glance
    face.style.setProperty("--lx", `${((dx / d) * k * 3).toFixed(2)}px`);
    face.style.setProperty("--ly", `${((dy / d) * k * 2.4).toFixed(2)}px`);
  }
}

function blink(face) {
  face.classList.remove("is-blink");
  void face.offsetWidth; // restart the animation
  face.classList.add("is-blink");
}

function blinkLater(face) {
  setTimeout(() => {
    if (!face.isConnected) { faces.delete(face); return; }
    blink(face);
    if (Math.random() < 0.3) setTimeout(() => blink(face), 240);
    blinkLater(face);
  }, 2200 + Math.random() * 3800);
}

// Call once the button is in the page.
export function wireFace(btn) {
  const face = btn?.querySelector(".fab-face");
  if (!face || faces.has(face) || calm()) return;
  faces.add(face);
  blinkLater(face);
  if (!following) {
    following = true;
    window.addEventListener("pointermove", look, { passive: true });
  }
}
