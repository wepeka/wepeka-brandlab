// Papan — the brand's whiteboard (#/brand/:id/papan[/:boardId]). The canvas
// itself is the small app in /papan/ (papan/src, built by papan/build.mjs),
// framed here so its tools, shortcuts and styles can never leak into the rest
// of Brandlab; it reaches Brandlab only through the bridge (js/papan/bridge.js).
import { createBridge } from "../papan/bridge.js";
import { getBrand } from "../store.js";
import { openConsultantPanel, setChatBoardContext } from "../consultant-panel.js";
import { escapeHtml } from "../dom.js";
import { t } from "../i18n.js";

// Bumped with every papan/build.mjs run (written into papan/version.js), so a
// deploy never meets a cached copy of the old canvas.
import { PAPAN_VERSION } from "../../papan/version.js";

export function render(root, { brandId, boardId = null }) {
  const brand = getBrand(brandId);
  root.classList.add("view-papan");
  root.innerHTML = `<div class="papan-host"><div class="papan-loading">${escapeHtml(t("papan.loading"))}</div></div>`;
  let frame = null, bridge = null, dead = false;
  const host = root.querySelector(".papan-host");

  // Whatever the board shows when the chat opens: the board travels with the
  // question (consultant-panel's board context) and "Taruh di papan" on a
  // chat idea lands on this board.
  const openChat = (summaryFn) => {
    setChatBoardContext(brandId, {
      summary: () => { try { return summaryFn ? summaryFn() : ""; } catch { return ""; } },
      place: (items) => { try { return frame?.contentWindow?.__papanPlace?.(items) || 0; } catch { return 0; } },
    });
    openConsultantPanel({ engine: "brainstorm" });
  };
  const onBoard = (id) => {
    const want = `#/brand/${brandId}/papan${id ? "/" + id : ""}`;
    if (location.hash !== want) history.replaceState(null, "", want);
    // keep the chat's board context (and its "Taruh di papan") pointed at this board
    setChatBoardContext(brandId, {
      summary: () => { try { return frame?.contentWindow?.__papanSummary?.() || ""; } catch { return ""; } },
      place: (items) => { try { return frame?.contentWindow?.__papanPlace?.(items) || 0; } catch { return 0; } },
    });
  };

  createBridge({ brandId, boardId, onBoard, openChat }).then((b) => {
    if (dead) { b.close(); return; }
    bridge = b;
    window.__papanBridge = bridge;
    frame = document.createElement("iframe");
    frame.className = "papan-frame";
    frame.title = t("papan.frameTitle", { name: brand?.name || "" });
    frame.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write; autoplay; encrypted-media; picture-in-picture");
    frame.allowFullscreen = true;
    frame.src = `/papan/index.html?v=${encodeURIComponent(PAPAN_VERSION)}`;
    host.innerHTML = "";
    host.appendChild(frame);
  }).catch((e) => {
    console.error("papan", e);
    host.innerHTML = `<div class="papan-loading">${escapeHtml(t("papan.loadFailed"))}</div>`;
  });

  // The canvas follows Brandlab's light/dark switch and brand colour.
  const themeObs = new MutationObserver(() => { try { frame?.contentWindow?.__papanTheme?.(bridge?.theme()); } catch {} });
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });

  return () => {
    dead = true;
    themeObs.disconnect();
    setChatBoardContext(brandId, null);
    if (window.__papanBridge === bridge) delete window.__papanBridge;
    bridge?.close();
    frame?.remove();
    root.classList.remove("view-papan");
  };
}
