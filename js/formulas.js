// Configurable-formula engine. The user defines Engagement Rate / Follower
// Conversion Rate as plain arithmetic expressions over known metric names —
// nothing is hard-coded. Expressions are validated against a whitelist before
// being evaluated, since they're just local settings, not remote input.

import { METRIC_KEYS } from "./store.js";
import { t } from "./i18n.js";

const VAR_NAMES = METRIC_KEYS.map((m) => m.key);
const SAFE_EXPR = /^[0-9a-zA-Z_+\-*/().\s]*$/;

// Turns a formula into a function of the metric values (in VAR_NAMES
// order), or throws on anything that isn't plain arithmetic. A small parser
// instead of new Function(): the production Content-Security-Policy
// (vercel.json) has no 'unsafe-eval', so the browser refuses to turn a
// string into code. Same grammar SAFE_EXPR lets through — numbers (12,
// 1.5, .5), metric names, + - * / ** and ( ) — with JavaScript's
// precedence (** right to left and never after a bare unary sign, then
// unary, then * /, then + -, left to right), so results are identical.
function compileFormula(expr) {
  const tokens = expr.match(/\d+\.?\d*|\.\d+|[A-Za-z_]\w*|\+\+|--|\*\*|\S/g) || [];
  let i = 0;
  const fail = () => {
    throw new SyntaxError("not a formula");
  };
  const unary = () => {
    const tk = tokens[i++];
    if (tk === "(") {
      const inner = sum();
      if (tokens[i++] !== ")") fail();
      return inner;
    }
    if (tk === "-" || tk === "+") {
      const operand = unary();
      return tk === "-" ? (v) => -operand(v) : operand;
    }
    if (/^[\d.]/.test(tk || "")) {
      // A leading zero reads the way new Function read it: "010" is octal 8,
      // "09" / "09.5" are decimal, "01.5" is an error.
      if (/^0[0-7]+\./.test(tk)) fail();
      const n = /^0[0-7]+$/.test(tk) ? parseInt(tk, 8) : Number(tk);
      if (!Number.isFinite(n)) fail();
      return () => n;
    }
    const at = VAR_NAMES.indexOf(tk);
    if (at < 0) fail(); // unknown name, an operator out of place, or the end
    return (v) => v[at];
  };
  // a ** b ** c = a ** (b ** c); "-a ** b" is a SyntaxError in JavaScript,
  // so it is one here too ("(-a) ** b" and "a ** -b" are fine).
  const power = () => {
    const first = tokens[i];
    const base = unary();
    if (tokens[i] !== "**") return base;
    if (first === "-" || first === "+") fail();
    i++;
    const exponent = power();
    return (v) => base(v) ** exponent(v);
  };
  const product = () => {
    let left = power();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++];
      const l = left;
      const r = power();
      left = op === "*" ? (v) => l(v) * r(v) : (v) => l(v) / r(v);
    }
    return left;
  };
  const sum = () => {
    let left = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      const l = left;
      const r = product();
      left = op === "+" ? (v) => l(v) + r(v) : (v) => l(v) - r(v);
    }
    return left;
  };
  const fn = sum();
  if (i !== tokens.length) fail();
  return fn;
}

export function validateFormula(expr) {
  if (!expr || !expr.trim()) return { valid: false, error: t("cnt.formula.empty") };
  if (!SAFE_EXPR.test(expr)) return { valid: false, error: t("cnt.formula.chars") };
  const idents = expr.match(/[a-zA-Z_]+/g) || [];
  const unknown = idents.filter((i) => !VAR_NAMES.includes(i));
  if (unknown.length) return { valid: false, error: t("cnt.formula.unknown", { names: unknown.join(", ") }) };
  try {
    compileFormula(expr)(VAR_NAMES.map(() => 1));
  } catch (e) {
    return { valid: false, error: t("cnt.formula.invalid") };
  }
  return { valid: true, usedVars: [...new Set(idents)] };
}

// Returns a number, or null if a metric the formula depends on isn't available yet.
export function evaluateFormula(expr, metrics) {
  const check = validateFormula(expr);
  if (!check.valid) return null;
  for (const v of check.usedVars) {
    const val = metrics[v];
    if (val === null || val === undefined || val === "") return null;
  }
  try {
    const fn = compileFormula(expr);
    const args = VAR_NAMES.map((v) => Number(metrics[v]) || 0);
    const result = fn(args);
    if (!isFinite(result)) return null;
    return result;
  } catch (e) {
    return null;
  }
}

// rating: 'good' | 'average' | 'poor' | null
export function rateValue(value, threshold) {
  if (value === null || value === undefined || !threshold) return null;
  if (value >= threshold.good) return "good";
  if (value >= threshold.average) return "average";
  return "poor";
}

const RANK = { poor: 0, average: 1, good: 2 };

// Combines engagement + follower-conversion ratings into one overall health.
// Takes the worse of whichever ratings are actually available.
export function overallHealth(erRating, fcrRating) {
  const ratings = [erRating, fcrRating].filter(Boolean);
  if (!ratings.length) return null;
  return ratings.reduce((worst, r) => (RANK[r] < RANK[worst] ? r : worst));
}

// A platform-specific threshold set wins over the funnel defaults when one
// exists for this content's platform (Settings → Tolok Ukur → per
// platform); otherwise the shared defaults apply. Matched on the exact
// platform name stored on the content.
export function resolveThresholds(settings, funnel, platform) {
  const byPlatform = platform ? settings.thresholdsByPlatform?.[platform] : null;
  return (byPlatform && byPlatform[funnel]) || settings.thresholds[funnel] || {};
}

export function computeContentMetrics(content, settings) {
  const m = content.performance || {};
  const er = evaluateFormula(settings.formulas.engagementRate, m);
  const fcr = evaluateFormula(settings.formulas.followerConversionRate, m);
  const th = resolveThresholds(settings, content.funnel, content.platform);
  const erRating = rateValue(er, th.engagementRate);
  const fcrRating = rateValue(fcr, th.followerConversionRate);
  const health = overallHealth(erRating, fcrRating);
  return { engagementRate: er, followerConversionRate: fcr, erRating, fcrRating, health };
}

// Language switches reload the page, so resolving these once at load is fine.
export const HEALTH_LABEL = { good: t("dashboard.healthy"), average: t("dashboard.average"), poor: t("dashboard.underperforming") };
