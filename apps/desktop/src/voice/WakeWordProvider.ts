import type { WakeWordProvider } from "./types";
import { createRecognizer, containsWakeWord, stripWakeWord } from "./voice";

// Browser fallback wake word via Web Speech (continuous). Labeled clearly.
// Local Porcupine/openWakeWord will replace same interface in Phase 5.
export class WebSpeechWakeWord implements WakeWordProvider {
  id = "hey-orvix-web-speech-fallback";
  kind = "fallback" as const;
  private rec: { start:()=>void; stop:()=>void }|null = null;
  private listening = false;

  async start(onWake:(phrase:string, remainder?:string)=>void, onError?:(e:string)=>void): Promise<void> {
    this.stop();
    this.listening = true;
    const rec = createRecognizer({
      lang: "en-US",
      continuous: true,
      onPartial: (p) => {
        if (containsWakeWord(p)) {
          const rem = stripWakeWord(p);
          onWake("hey orvix", rem || undefined);
        }
      },
      onFinal: (t) => {
        if (containsWakeWord(t)) {
          const rem = stripWakeWord(t);
          onWake("hey orvix", rem || undefined);
        }
      },
      onEnd: () => {
        // Chrome ends continuous after silence; auto-restart if still listening
        if (this.listening) setTimeout(()=> { if(this.listening) this.start(onWake, onError).catch(()=>{}); }, 400);
      },
      onError: (e) => onError?.(e),
    });
    this.rec = rec;
    rec.start();
  }
  stop(): void { this.listening=false; this.rec?.stop(); this.rec=null; }
  isListening(): boolean { return this.listening; }
}

// Experimental — disabled by default until barge-in stable (per spec)
export class DisabledWakeWord implements WakeWordProvider {
  id = "disabled"; kind = "fallback" as const;
  async start(): Promise<void>{}
  stop(): void{}
  isListening(): boolean{ return false; }
}
