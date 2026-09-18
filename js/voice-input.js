// Web Speech API (built into Chrome/Edge) — no AI provider or key needed,
// purely browser-native speech-to-text. Silently disables the mic button
// where it isn't supported (notably Firefox) rather than erroring.
import { toast } from "./dom.js";
import { t, getLang } from "./i18n.js";

export function wireMic(button, targetEl) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    button.disabled = true;
    button.title = t("ai.voice.unsupported");
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = getLang() === "en" ? "en-US" : "id-ID";
  recognition.interimResults = false;
  let listening = false;
  recognition.addEventListener("start", () => {
    listening = true;
    button.classList.add("mic-active");
  });
  recognition.addEventListener("end", () => {
    listening = false;
    button.classList.remove("mic-active");
  });
  recognition.addEventListener("result", (e) => {
    const text = e.results[0][0].transcript;
    targetEl.value = targetEl.value ? `${targetEl.value} ${text}` : text;
    // Pages that track the field's value (and tour input gates) listen for input.
    targetEl.dispatchEvent(new Event("input", { bubbles: true }));
  });
  recognition.addEventListener("error", (e) => {
    if (e.error !== "aborted") toast(t("ai.voice.error", { error: e.error }), "error");
  });
  button.addEventListener("click", () => {
    if (listening) recognition.stop();
    else recognition.start();
  });
}
