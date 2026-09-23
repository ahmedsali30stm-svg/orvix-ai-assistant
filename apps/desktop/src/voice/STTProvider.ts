import type { STTProvider } from "./types";
import { createRecognizer as createWebRec } from "./voice";

// Web Speech = browser fallback, NOT local. Labeled clearly per Phase 0 correction.
export class WebSpeechSTT implements STTProvider {
  id = "web-speech-fallback" as const;
  kind = "fallback" as const;
  label = "Web Speech (browser fallback — not local)";
  private rec: { start:()=>void; stop:()=>void } | null = null;
  private onPartial: ((t:string)=>void)|null = null;
  private onFinal: ((t:string)=>void)|null = null;
  private onError: ((e:string)=>void)|null = null;

  async start(opts:{ langHint?:string; onPartial:(t:string)=>void; onFinal:(t:string)=>void; onError:(e:string)=>void }): Promise<void> {
    this.onPartial = opts.onPartial;
    this.onFinal = opts.onFinal;
    this.onError = opts.onError;
    const lang = opts.langHint ?? "en-US";
    // continuous false for single utterance; VAD will handle segmentation
    this.rec = createWebRec({
      lang,
      onPartial: (p) => this.onPartial?.(p),
      onFinal: (t) => this.onFinal?.(t),
      onEnd: () => {},
      onError: (e) => this.onError?.(e),
    });
    this.rec.start();
  }
  async stop(): Promise<string> {
    this.rec?.stop();
    this.rec = null;
    return "";
  }
  abort(): void {
    this.rec?.stop();
    this.rec = null;
  }
}

// Placeholder for local whisper.cpp — will be backed by gateway /api/voice/stt
// Keeps interface stable; Phase 3 will swap without Home.tsx changes.
export class WhisperLocalSTT implements STTProvider {
  id = "whisper.cpp-base" as const;
  kind = "local" as const;
  label = "whisper.cpp base (local — not yet installed)";
  async start(_opts:{ langHint?:string; onPartial:(t:string)=>void; onFinal:(t:string)=>void; onError:(e:string)=>void }): Promise<void> {
    throw new Error("Whisper local not installed — install whisper.cpp model first. Falling back to Web Speech.");
  }
  async stop(): Promise<string>{ return ""; }
  abort(): void {}
}

export class WhisperTinySTT implements STTProvider {
  id = "whisper.cpp-tiny" as const;
  kind = "local" as const;
  label = "whisper.cpp tiny (local — lighter, not yet installed)";
  async start(_opts:unknown): Promise<void>{ throw new Error("Whisper tiny not installed"); }
  async stop(): Promise<string>{ return ""; }
  abort(): void{}
}
