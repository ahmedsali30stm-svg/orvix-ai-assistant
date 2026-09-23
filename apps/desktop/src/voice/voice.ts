// ── Voice I/O via Web Speech API (§38, §40) ───────────────────────────────
// Browser-native STT/TTS keeps V1 dependency-free; a realtime audio pipeline
// (Whisper + neural TTS) slots behind the same interface later.

export interface VoiceSupport {
  stt: boolean;
  tts: boolean;
}

export function voiceSupport(): VoiceSupport {
  const w = window as unknown as Record<string, unknown>;
  return { stt: Boolean(w.SpeechRecognition || w.webkitSpeechRecognition), tts: "speechSynthesis" in window };
}

export const WAKE_WORDS = ["hey orvix", "hey orvix", "hi orvix", "hey orviks", "orvix"] as const;

export function containsWakeWord(text: string): boolean {
  const s = text.toLowerCase().replace(/[^a-z\u0600-\u06FF ]/g, " ").replace(/\s+/g, " ").trim();
  // English variants
  if (s.includes("hey orvix") || s.includes("hi orvix") || s.includes("hay orvix") || s === "orvix" || s.endsWith(" orvix")) return true;
  // Arabic variant يا أورفكس
  if (s.includes("يا اورفكس") || s.includes("يا أورفكس") || s.includes("اورفكس")) return true;
  return false;
}

export function stripWakeWord(text: string): string {
  return text.replace(/hey\s+orvix|hi\s+orvix|hay\s+orvix|orvix/gi, "").replace(/يا\s+أورفكس|يا\s+اورفكس|أورفكس|اورفكس/g, "").trim().replace(/^[,،\s]+/, "");
}

export function createRecognizer(opts: {
  lang: string;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (err: string) => void;
  continuous?: boolean;
}): { start: () => void; stop: () => void } {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
        onend: (() => void) | null;
        onerror: ((e: { error: string }) => void) | null;
        start: () => void;
        stop: () => void;
      })
    | undefined;
  if (!Ctor) {
    opts.onError("Speech recognition not supported in this browser");
    return { start: () => {}, stop: () => {} };
  }
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.continuous = opts.continuous ?? false;
  rec.interimResults = true;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0]!.transcript;
      else interim += r[0]!.transcript;
    }
    if (interim) opts.onPartial(interim);
    if (finalText) {
      opts.onFinal(finalText.trim());
      finalText = "";
    }
  };
  rec.onend = () => opts.onEnd();
  rec.onerror = (e) => opts.onError(e.error);
  return {
    start: () => {
      try {
        rec.start();
      } catch (err) {
        opts.onError(String(err));
      }
    },
    stop: () => rec.stop(),
  };
}

export function speak(text: string, lang = "en-US"): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1.05;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
