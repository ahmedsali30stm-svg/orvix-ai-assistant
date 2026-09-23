import type { VADProvider, VADEngineId, VoiceEngineKind } from "./types";

// Phase 1: energy-based VAD as placeholder; Silero ONNX will replace via same interface.
// Keeps Home.tsx free from VAD logic.
export class EnergyVAD implements VADProvider {
  id: VADEngineId = "energy";
  kind: VoiceEngineKind = "fallback";
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf: number | null = null;
  private onProb: ((p:number)=>void)|null = null;
  private onSpeech: ((seg:{startMs:number;endMs?:number})=>void)|null = null;
  private speaking = false;
  private silenceMs = 0;
  private startMs = 0;
  private stream: MediaStream | null = null;

  // Silero VAD will be loaded as ONNX in phase 3; this stub keeps contract.
  async start(stream: MediaStream, onSpeech: (seg:{startMs:number;endMs?:number})=>void): Promise<void> {
    this.stop();
    this.stream = stream;
    this.onSpeech = onSpeech;
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.startMs = performance.now();
      this.loop();
    } catch (e) {
      console.warn("[VAD] init failed", e);
    }
  }
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.ctx) try { this.ctx.close(); } catch {}
    this.ctx = null; this.analyser = null; this.stream = null; this.speaking = false;
  }
  onSpeechProb(cb: (p:number)=>void): void { this.onProb = cb; }

  private loop = () => {
    if (!this.analyser) return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum=0;
    for(let i=0;i<data.length;i++){ const v=(data[i]!-128)/128; sum+=v*v; }
    const rms=Math.sqrt(sum/data.length);
    const prob = Math.min(1, Math.max(0, (rms - 0.02)/0.08)); // 0.02 silence .. 0.10 loud
    this.onProb?.(prob);
    const isSpeech = rms > 0.03;
    const now = performance.now();
    if (isSpeech && !this.speaking) {
      this.speaking = true; this.silenceMs = 0;
      this.onSpeech?.({ startMs: now });
    } else if (!isSpeech && this.speaking) {
      this.silenceMs += 16;
      if (this.silenceMs > 700) { // end of segment after 700ms silence
        this.speaking = false;
        this.onSpeech?.({ startMs: this.startMs, endMs: now });
        this.startMs = now;
      }
    } else if (isSpeech) {
      this.silenceMs = 0;
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}

// Future: SileroVADLocal will implement same interface with ONNX runtime.
export class SileroVAD implements VADProvider {
  id: VADEngineId = "silero";
  kind: VoiceEngineKind = "local";
  // placeholder - will load silero_vad.onnx via onnxruntime-web
  async start(_stream: MediaStream, _onSpeech: (seg:{startMs:number;endMs?:number})=>void): Promise<void> {
    throw new Error("Silero VAD not yet bundled — using EnergyVAD fallback");
  }
  stop(): void {}
}
