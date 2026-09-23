import type { TTSProvider, TTSVoice } from "./types";
import { speak as webSpeak, stopSpeaking as webStop } from "./voice";

// English voice = native English prompt only. No raw Arabic into English engine.
const VOICES: TTSVoice[] = [
  { id: "piper-en-us-lessac-medium", lang: "en-US", name: "Piper Lessac (local)", engine: "piper-en" },
  { id: "piper-en-us-ryan-medium", lang: "en-US", name: "Piper Ryan (local)", engine: "piper-en" },
  { id: "kokoro-af-heart", lang: "en-US", name: "Kokoro af_heart (local — pending)", engine: "kokoro-en" },
  { id: "web-speech-fallback", lang: "en-US", name: "Web Speech (browser fallback)", engine: "web-speech-fallback" },
];

// Normalize for English TTS: strip markdown, links, code, verbalize numbers/currency/dates
export function normalizeForEnglishSpeech(raw: string): string {
  let s = raw;
  // strip markdown
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^[-*]\s+/gm, "");
  s = s.replace(/<[^>]+>/g, " ");
  // currency: $1,200.50 → 1200 dollars and 50 cents (simple)
  s = s.replace(/\$\s*([\d,]+)(?:\.(\d{2}))?/g, (_m, a, b) => {
    const n = a.replace(/,/g, "");
    if (b) return `${n} dollars and ${b} cents`;
    return `${n} dollars`;
  });
  s = s.replace(/(\d+)\s*SAR\b/gi, "$1 Saudi riyals");
  s = s.replace(/(\d+)\s*EGP\b/gi, "$1 Egyptian pounds");
  // dates: 2026-09-23 → September 23, 2026 (simple)
  s = s.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_m, y, mm, dd) => {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const m = months[Number(mm)-1] ?? mm;
    return `${m} ${Number(dd)}, ${y}`;
  });
  // numbers: keep as is for Piper/Kokoro (they handle) but collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // split long: no hard 400 cut; caller will sentence-split
  return s;
}

function splitSentences(text: string): string[] {
  // keep abbreviations and numbers: split on .!? + space + capital/number
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts) return [text];
  return parts.map(p => p.trim()).filter(Boolean);
}

export class WebSpeechTTS implements TTSProvider {
  id = "web-speech-fallback" as const;
  kind = "fallback" as const;
  label = "Web Speech (browser fallback — English only)";
  private speaking = false;
  async voices(): Promise<TTSVoice[]> { return VOICES.filter(v=>v.engine==="web-speech-fallback"); }
  normalizeForSpeech(raw:string): string { return normalizeForEnglishSpeech(raw); }
  async speak(text:string, opts?:{ voiceId?:string; rate?:number; volume?:number; onSentence?:(i:number)=>void }): Promise<void> {
    const norm = this.normalizeForSpeech(text);
    const sentences = splitSentences(norm);
    this.speaking = true;
    for (let i=0;i<sentences.length;i++) {
      if (!this.speaking) break;
      opts?.onSentence?.(i);
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(sentences[i]!);
        u.lang = "en-US";
        u.rate = opts?.rate ?? 1.02;
        u.volume = opts?.volume ?? 1;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
        // poll isSpeaking to allow interruption via stop()
        const check = setInterval(() => {
          if (!this.speaking) { window.speechSynthesis.cancel(); clearInterval(check); resolve(); }
          if (!window.speechSynthesis.speaking) { clearInterval(check); }
        }, 80);
        u.onend = () => { clearInterval(check); resolve(); };
      });
    }
    this.speaking = false;
  }
  stop(): void { this.speaking = false; try{ webStop(); }catch{} }
  isSpeaking(): boolean { return this.speaking || window.speechSynthesis.speaking; }
}

// Local Piper: will call gateway /api/voice/tts (Piper binary) when available.
// For Phase 1 vertical slice, this class tries local first then falls back to WebSpeech.
// Keeps interface stable so Home.tsx never imports voice.ts directly.
export class PiperLocalTTS implements TTSProvider {
  id = "piper-en" as const;
  kind = "local" as const;
  label = "Piper — Lessac medium (local)";
  private webFallback = new WebSpeechTTS();
  private speaking = false;
  private audio: HTMLAudioElement | null = null;

  async voices(): Promise<TTSVoice[]> { return VOICES.filter(v=>v.engine==="piper-en"); }
  normalizeForSpeech(raw:string): string { return normalizeForEnglishSpeech(raw); }

  async speak(text:string, opts?:{ voiceId?:string; rate?:number; volume?:number; onSentence?:(i:number)=>void }): Promise<void> {
    const norm = this.normalizeForSpeech(text);
    const sentences = splitSentences(norm);
    // Try local Piper endpoint sentence-by-sentence for streaming (first sentence fast)
    this.speaking = true;
    for (let i=0;i<sentences.length;i++) {
      if (!this.speaking) break;
      opts?.onSentence?.(i);
      const ok = await this.tryPiperSentence(sentences[i]!, opts);
      if (!ok) {
        // fallback for this sentence
        await this.webFallback.speak(sentences[i]!, opts);
        if (!this.speaking) break;
      }
    }
    this.speaking = false;
  }
  private async tryPiperSentence(sentence:string, opts?:{ rate?:number; volume?:number }): Promise<boolean> {
    try {
      const res = await fetch(`/api/voice/tts`, {
        method: "POST",
        headers: { "content-type":"application/json" },
        body: JSON.stringify({ text: sentence, voice: "en_US-lessac-medium", rate: opts?.rate ?? 1.0 }),
      });
      if (!res.ok) return false;
      const blob = await res.blob();
      if (!this.speaking) return false;
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        const a = new Audio(url);
        this.audio = a;
        a.volume = opts?.volume ?? 1;
        a.onended = () => { URL.revokeObjectURL(url); resolve(); };
        a.onerror = () => { URL.revokeObjectURL(url); reject(new Error("audio error")); };
        // allow interruption: if stop() called, audio.pause() will trigger?
        a.play().catch(reject);
      });
      return true;
    } catch { return false; }
  }
  stop(): void {
    this.speaking = false;
    this.webFallback.stop();
    if (this.audio) { try{ this.audio.pause(); this.audio.src=""; }catch{} this.audio=null; }
  }
  isSpeaking(): boolean { return this.speaking || this.webFallback.isSpeaking() || !!this.audio && !this.audio.paused; }
}

// Kokoro placeholder — license/model name to be verified before download (see Phase 2)
export class KokoroLocalTTS implements TTSProvider {
  id = "kokoro-en" as const;
  kind = "local" as const;
  label = "Kokoro af_heart (local — pending license/benchmark)";
  async voices(): Promise<TTSVoice[]> { return VOICES.filter(v=>v.engine==="kokoro-en"); }
  normalizeForSpeech(raw:string): string { return normalizeForEnglishSpeech(raw); }
  async speak(_text:string): Promise<void>{ throw new Error("Kokoro not yet installed — running Piper benchmark first"); }
  stop(): void {}
  isSpeaking(): boolean{ return false; }
}
