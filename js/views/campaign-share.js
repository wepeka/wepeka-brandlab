// Campaign progress you can take out of the app: ONE 1080×1920 (9:16) sheet
// — the same page works as a PDF and as an Instagram Story. It's drawn
// straight onto a <canvas> (exact pixels, no DOM-to-image guesswork); the
// PDF is that canvas placed on a single 9:16 jsPDF page, the PNG is the
// canvas itself.
//
// Sharing: phones with the Web Share API get the native sheet (pick
// Instagram → Story); everywhere else the PNG downloads. Instagram has no
// web API for adding a mention sticker, so the @handle is printed on the
// card and the ready-made caption is copied to the clipboard.
import { readStage, campaignHeadline, activeStageIndex } from "../campaign-metrics.js";
import { WEPEKA_IG_HANDLE, WEPEKA_SITE_URL } from "../site-links.js";
import { openModal, closeOverlay } from "../modals.js";
import { toast, formatNumber, qs, escapeHtml as esc } from "../dom.js";
import { icon } from "../icons.js";
import { t } from "../i18n.js";

let jsPdfLoading = null;
function ensureJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve();
  if (jsPdfLoading) return jsPdfLoading;
  jsPdfLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return jsPdfLoading;
}

const slug = (s) => (s || "campaign").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
const todayLabel = () => new Date().toLocaleDateString(document.documentElement.lang === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long", year: "numeric" });

// Everything both outputs need, read once.
function snapshot({ brand, campaign, stages, ctx }) {
  const index = activeStageIndex(campaign, stages, ctx.content);
  const stage = stages[index];
  const read = stage ? readStage(stage, ctx) : { readings: [], requiredMet: 0, requiredTotal: 0, met: 0, total: 0 };
  const head = stage ? campaignHeadline(campaign, stages, index, ctx) : null;
  const stageWord = stage?.kind === "level" ? t("camp.levelOf", { n: index + 1, total: stages.length }) : stage?.dateLabel || "";
  return { brand, campaign, stages, index, stage, read, head, stageWord };
}

function valueText(r) {
  if (r.isCheck) return r.met ? t("camp.detail.done") : t("camp.detail.notYet");
  return `${formatNumber(r.current)}${r.target ? ` / ${formatNumber(r.target)}` : ""}${r.unit && r.unit !== "Rp" ? ` ${r.unit}` : ""}`;
}

// ---------- The 9:16 sheet ----------


const W = 1080;
const H = 1920;
const ORANGE = "#FFA52B";
const GREEN = "#3DDC84";

function wrap(c, text, maxWidth) {
  const lines = [];
  let line = "";
  String(text || "").split(/\s+/).forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  });
  if (line) lines.push(line);
  return lines;
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

async function drawStory(s) {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const font = (weight, size) => `${weight} ${size}px ${family}`;

  c.fillStyle = "#0B0B0A";
  c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W * 0.8, 120, 0, W * 0.8, 120, 1100);
  glow.addColorStop(0, "rgba(255,165,43,0.34)");
  glow.addColorStop(1, "rgba(255,165,43,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  const x = 96;
  c.textBaseline = "alphabetic";
  c.fillStyle = ORANGE;
  c.font = font(800, 30);
  c.fillText("WEPEKA BRANDLAB", x, 170);
  const brandW = c.measureText("WEPEKA BRANDLAB").width;
  c.fillStyle = "rgba(255,255,255,0.55)";
  c.font = font(600, 30);
  c.fillText(`·  ${t("share.story.kicker").toUpperCase()}`, x + brandW + 24, 170);

  c.fillStyle = "#FFFFFF";
  c.font = font(800, 96);
  let y = 310;
  wrap(c, s.brand.name, W - x * 2).slice(0, 2).forEach((line) => {
    c.fillText(line, x, y);
    y += 106;
  });
  c.fillStyle = "rgba(255,255,255,0.6)";
  c.font = font(500, 38);
  wrap(c, s.campaign.name || "", W - x * 2).slice(0, 2).forEach((line) => {
    c.fillText(line, x, y);
    y += 54;
  });

  // Card: where the campaign stands
  const cardY = Math.max(y + 40, 560);
  const cardH = 500;
  roundRect(c, x, cardY, W - x * 2, cardH, 48);
  c.fillStyle = "#171614";
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.10)";
  c.lineWidth = 2;
  c.stroke();
  const px = x + 56;
  const innerW = W - x * 2 - 112;
  c.fillStyle = ORANGE;
  c.font = font(800, 30);
  c.fillText(String(s.stageWord || "").toUpperCase(), px, cardY + 80);
  c.fillStyle = "#FFFFFF";
  c.font = font(800, 72);
  c.fillText(wrap(c, s.stage?.name || "", innerW)[0] || "", px, cardY + 165);

  const head = s.head?.reading;
  const hasNumber = head && head.target && !head.isCheck;
  c.fillStyle = "rgba(255,255,255,0.6)";
  c.font = font(600, 32);
  c.fillText(hasNumber ? s.head.milestone.label : t("share.report.required"), px, cardY + 240);
  c.fillStyle = "#FFFFFF";
  c.font = font(800, 96);
  const big = hasNumber ? formatNumber(head.current) : String(s.read.requiredMet);
  c.fillText(big, px, cardY + 345);
  const bigW = c.measureText(`${big} `).width;
  c.fillStyle = "rgba(255,255,255,0.5)";
  c.font = font(600, 44);
  c.fillText(hasNumber ? `/ ${formatNumber(head.target)} ${head.unit || ""}` : `/ ${s.read.requiredTotal}`, px + bigW, cardY + 345);

  const pct = hasNumber ? head.pct : s.read.requiredTotal ? s.read.requiredMet / s.read.requiredTotal : 0;
  roundRect(c, px, cardY + 380, innerW, 20, 10);
  c.fillStyle = "rgba(255,255,255,0.12)";
  c.fill();
  if (pct > 0) {
    roundRect(c, px, cardY + 380, Math.max(20, innerW * Math.min(1, pct)), 20, 10);
    c.fillStyle = ORANGE;
    c.fill();
  }
  c.fillStyle = "rgba(255,255,255,0.7)";
  c.font = font(600, 32);
  c.fillText(t("share.story.targets", { met: s.read.requiredMet, total: s.read.requiredTotal }), px, cardY + 455);

  // This level's required targets, as many as fit above the journey line.
  const dotsY = H - 270;
  let my = cardY + cardH + 70;
  const rows = s.read.readings.filter((r) => r.milestone.required !== false && !r.milestone.notApplicable && r !== head);
  const ROW = 88;
  const fit = Math.max(0, Math.min(6, Math.floor((dotsY - 70 - (my + 40)) / ROW)));
  if (fit && rows.length) {
    c.fillStyle = "rgba(255,255,255,0.45)";
    c.font = font(800, 26);
    c.fillText(t("share.report.requiredTitle").toUpperCase(), x, my);
    my += 56;
    rows.slice(0, fit).forEach((r) => {
      const value = valueText(r);
      c.font = font(800, 30);
      c.textAlign = "right";
      c.fillStyle = r.met ? GREEN : "#FFFFFF";
      c.fillText(value, W - x, my);
      const valueW = c.measureText(value).width;
      c.textAlign = "left";
      c.font = font(600, 30);
      c.fillStyle = "rgba(255,255,255,0.85)";
      let label = `${r.met ? "✓ " : ""}${r.milestone.label}`;
      while (label.length > 4 && c.measureText(label).width > W - x * 2 - valueW - 30) label = `${label.slice(0, -2).trimEnd()}…`;
      c.fillText(label, x, my);
      roundRect(c, x, my + 18, W - x * 2, 10, 5);
      c.fillStyle = "rgba(255,255,255,0.10)";
      c.fill();
      if (r.pct > 0) {
        roundRect(c, x, my + 18, Math.max(10, (W - x * 2) * Math.min(1, r.pct)), 10, 5);
        c.fillStyle = r.met ? GREEN : ORANGE;
        c.fill();
      }
      my += ROW;
    });
  }

  // Journey dots
  const shown = s.stages.slice(0, 6);
  const n = shown.length;
  const gap = (W - x * 2) / Math.max(1, n - 1);
  c.strokeStyle = "rgba(255,255,255,0.18)";
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(x + 20, dotsY);
  c.lineTo(W - x - 20, dotsY);
  c.stroke();
  shown.forEach((st, i) => {
    const cx = n === 1 ? W / 2 : x + 20 + ((W - x * 2 - 40) / (n - 1)) * i;
    c.beginPath();
    c.arc(cx, dotsY, i === s.index ? 24 : 16, 0, Math.PI * 2);
    c.fillStyle = i <= s.index ? ORANGE : "#2A2926";
    c.fill();
    c.fillStyle = i === s.index ? "#FFFFFF" : "rgba(255,255,255,0.5)";
    c.font = font(i === s.index ? 800 : 600, n > 4 ? 22 : 26);
    c.textAlign = i === 0 ? "left" : i === n - 1 ? "right" : "center";
    let name = st.name;
    while (name.length > 3 && c.measureText(name).width > gap - 12) name = `${name.slice(0, -2).trimEnd()}…`;
    c.fillText(name, i === 0 ? x : i === n - 1 ? W - x : cx, dotsY + 64);
  });
  c.textAlign = "left";

  // Footer mention
  c.fillStyle = "rgba(255,255,255,0.75)";
  c.font = font(600, 34);
  c.fillText(t("share.story.with"), x, H - 130);
  c.fillStyle = ORANGE;
  c.font = font(800, 56);
  c.fillText(`@${WEPEKA_IG_HANDLE}`, x, H - 64);
  c.fillStyle = "rgba(255,255,255,0.45)";
  c.font = font(500, 28);
  c.textAlign = "right";
  c.fillText(`${todayLabel()} · ${WEPEKA_SITE_URL.replace("https://www.", "")}`, W - x, H - 64);
  c.textAlign = "left";
  return canvas;
}

export async function openCampaignReport(args) {
  const s = snapshot(args);
  const canvas = await drawStory(s);
  const caption = t("share.story.caption", { brand: s.brand.name, stage: s.stage?.name || "", handle: `@${WEPEKA_IG_HANDLE}` });
  const overlay = openModal({
    title: t("share.report.title"),
    bodyHTML: `
      <div class="cs-preview"><img alt="" src="${canvas.toDataURL("image/png")}" /></div>
      <p class="text-muted" style="font-size:12.5px;margin:12px 0 6px;">${t("share.story.hint", { handle: `@${WEPEKA_IG_HANDLE}` })}</p>
      <div class="cs-caption">${esc(caption)}</div>`,
    footHTML: `
      <button class="btn btn-secondary" id="cs-pdf">${icon("download", { size: 14 })}PDF</button>
      <button class="btn btn-secondary" id="cs-download">${icon("download", { size: 14 })}${t("share.story.download")}</button>
      <button class="btn btn-primary" id="cs-share">${icon("instagram", { size: 14 })}${t("share.story.share")}</button>`,
  });
  const baseName = `${slug(s.brand.name)}-${slug(s.campaign.name)}`;
  const fileName = `${baseName}.png`;
  qs("#cs-pdf", overlay).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = t("share.preparing");
    try {
      await ensureJsPdf();
      const pdf = new window.jspdf.jsPDF({ unit: "px", format: [W, H], orientation: "portrait", hotfixes: ["px_scaling"] });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
      pdf.save(`${baseName}.pdf`);
    } catch (err) {
      console.error("Campaign PDF failed", err);
      toast(t("share.fail"), "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
  const toBlob = () => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const copyCaption = () => navigator.clipboard?.writeText(caption).catch(() => {});
  const download = async () => {
    const url = URL.createObjectURL(await toBlob());
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    copyCaption();
    toast(t("share.story.saved", { handle: `@${WEPEKA_IG_HANDLE}` }));
  };
  qs("#cs-download", overlay).addEventListener("click", download);
  qs("#cs-share", overlay).addEventListener("click", async () => {
    const file = new File([await toBlob()], fileName, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      copyCaption();
      try {
        await navigator.share({ files: [file], text: caption });
      } catch (err) {
        if (err?.name !== "AbortError") download();
      }
    } else {
      download();
    }
  });
}
