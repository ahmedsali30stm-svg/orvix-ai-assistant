import type { VoiceState, AudioLevel, VoiceSessionConfig, VoiceSessionEvents } from "./types";

/**
 * VoiceSessionController — single owner of mic, VAD, STT, TTS, wake, and LLM abort.
 * Home.tsx will delegate to this instead of owning voice + chat + cancellation.
 */
export class VoiceSessionController {
  private state: VoiceState = "idle";
  private abort: AbortController | null = null;
  private level: AudioLevel | null = null;
  private events: VoiceSessionEvents;
  private cfg: VoiceSessionConfig;

  // for UI
  public onStateChange: ((s:VoiceState, d?:string)=>void)|null = null;

  constructor(cfg: VoiceSessionConfig, events: VoiceSessionEvents = {}) {
    this.cfg = cfg;
    this.events = events;
    // wire level from capture
    this.cfg.capture.onLevel?.((lvl) => {
      this.level = lvl;
      this.events.onLevel?.(lvl);
    });
    this.cfg.capture.onDeviceChange?.(() => this.events.onError?.("audio device changed — re-select in Settings"));
  }

  getState(): VoiceState { return this.state; }
  getLevel(): AudioLevel | null { return this.level; }
  getConfig(): VoiceSessionConfig { return this.cfg; }

  private setState(s:VoiceState, detail?:string){
    this.state = s;
    this.events.onState?.(s, detail);
    this.onStateChange?.(s, detail);
  }

  // ── Public: start single utterance (push-to-talk or Ctrl+Space) ───────────
  async startListening(): Promise<void> {
    if (this.state === "listening" || this.state === "transcribing") return;
    this.setState("listening", "Listening…");
    try {
      const stream = this.cfg.capture.getStream() ?? await this.cfg.capture.start();
      await this.cfg.vad.start(stream, () => {});
    } catch {}
    // STT single utterance
    try {
      await this.cfg.stt.start({
        langHint: "en-US",
        onPartial: (t) => this.events.onPartialTranscript?.(t),
        onFinal: (t) => {
          this.setState("transcribing", t.slice(0,60));
          this.events.onFinalTranscript?.(t);
        },
        onError: (e) => { this.setState("error", e); this.events.onError?.(e); this.goIdle(); }
      });
    } catch (e) {
      this.setState("error", String(e));
    }
  }

  stopListening(): void {
    try { this.cfg.stt.abort(); } catch {}
    try { this.cfg.vad.stop(); } catch {}
    this.goIdle();
  }

  // ── Barge-in: stop TTS + abort LLM/tools in-flight ─────────────────────────
  interrupt(): void {
    // 1) stop audio
    try { this.cfg.tts.stop(); } catch {}
    try { this.cfg.capture.stop(); } catch {}
    // 2) abort LLM/tools
    if (this.abort) { try{ this.abort.abort(); }catch{} this.abort=null; }
    this.setState("interrupted", "Interrupted");
    setTimeout(()=> this.goIdle(), 250);
  }

  setAbortController(ac: AbortController): void {
    // cancel previous if any
    if (this.abort && this.abort !== ac) try{ this.abort.abort(); }catch{}
    this.abort = ac;
  }
  clearAbort(): void { this.abort = null; }

  // ── TTS: English voice = English normalized text; Arabic handled per langMode ──
  async speak(text: string, opts?:{ rate?:number; volume?:number }): Promise<void> {
    if (!text.trim()) return;
    // do not speak if interrupted mid-queue
    if (this.state === "interrupted") return;
    this.setState("speaking", text.slice(0,80));
    try {
      await this.cfg.tts.speak(text, opts);
    } catch (e) {
      this.events.onError?.(String(e));
    } finally {
      if (this.state === "speaking") this.goIdle();
    }
  }
  stopSpeaking(): void {
    try{ this.cfg.tts.stop(); }catch{}
    if (this.state === "speaking") this.setState("idle");
  }

  // ── Wake word (disabled by default until barge-in stable) ─────────────────
  async startWake(onWake:(phrase:string, remainder?:string)=>void): Promise<void> {
    if (!this.cfg.wake) return;
    await this.cfg.wake.start((phrase, rem) => {
      this.setState("listening", `Wake: ${phrase}`);
      onWake(phrase, rem);
    });
  }
  stopWake(): void { try{ this.cfg.wake?.stop(); }catch{} }

  // ── Mic control ───────────────────────────────────────────────────────────
  async selectMic(deviceId:string): Promise<void> {
    await this.cfg.capture.start(deviceId);
    // restart VAD on new stream
    try{ await this.cfg.vad.start(this.cfg.capture.getStream()!, ()=>{}); }catch{}
  }
  async selectSpeaker(deviceId:string): Promise<void> {
    // HTMLAudio respects sinkId if supported
    try{
      const audio = document.createElement("audio");
      if ("setSinkId" in audio) await (audio as unknown as { setSinkId:(id:string)=>Promise<void> }).setSinkId(deviceId);
      localStorage.setItem("orvix.speakerId", deviceId);
    }catch{}
  }
  muteAll(): void {
    this.stopListening();
    this.stopSpeaking();
    try{ this.cfg.capture.stop(); }catch{}
    try{ this.cfg.wake?.stop(); }catch{}
    this.goIdle();
  }

  private goIdle(){ this.setState("idle"); }

  dispose(): void {
    this.muteAll();
    try{ this.cfg.vad.stop(); }catch{}
    try{ this.cfg.stt.abort(); }catch{}
  }
}
